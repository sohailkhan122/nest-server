import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

@Injectable()
export class FirebaseAdminService {
  private readonly logger = new Logger(FirebaseAdminService.name);
  private readonly app: admin.app.App | null;
  private static readonly requiredServiceAccountKeys = [
    'project_id',
    'private_key',
    'client_email',
  ] as const;

  constructor(private readonly configService: ConfigService) {
    this.app = this.initializeAdmin();
  }

  get messaging(): admin.messaging.Messaging | null {
    if (!this.app) return null;
    return this.app.messaging();
  }

  private initializeAdmin(): admin.app.App | null {
    if (admin.apps.length > 0) {
      return admin.app();
    }

    const serviceAccount = this.resolveServiceAccount();
    if (!serviceAccount) {
      this.logger.warn('Firebase Admin not initialized: service account JSON is missing.');
      return null;
    }

    try {
      const app = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
      });
      this.logger.log('Firebase Admin initialized successfully.');
      return app;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown initialization error';
      this.logger.error(`Failed to initialize Firebase Admin: ${message}`);
      return null;
    }
  }

  private resolveServiceAccount(): Record<string, unknown> | null {
    const inlineJson = this.normalizeEnvValue(
      this.configService.get<string>('FIREBASE_SERVICE_ACCOUNT_JSON'),
    );
    if (inlineJson) {
      try {
        const parsed = JSON.parse(inlineJson) as Record<string, unknown>;
        return this.normalizeServiceAccount(parsed);
      } catch {
        this.logger.warn('Invalid FIREBASE_SERVICE_ACCOUNT_JSON value.');
      }
    }

    const base64Json = this.normalizeEnvValue(
      this.configService.get<string>('FIREBASE_SERVICE_ACCOUNT_BASE64'),
    );
    if (base64Json) {
      try {
        const parsed = JSON.parse(
          Buffer.from(base64Json, 'base64').toString('utf8'),
        ) as Record<string, unknown>;
        return this.normalizeServiceAccount(parsed);
      } catch {
        this.logger.warn('Invalid FIREBASE_SERVICE_ACCOUNT_BASE64 value.');
      }
    }

    const configuredPath = this.normalizeEnvValue(
      this.configService.get<string>('FIREBASE_SERVICE_ACCOUNT_PATH'),
    );
    const filePath = configuredPath
      ? resolve(process.cwd(), configuredPath)
      : resolve(process.cwd(), 'src/firebase/service-account.json');

    if (!existsSync(filePath)) {
      return null;
    }

    try {
      const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
      return this.normalizeServiceAccount(parsed);
    } catch {
      this.logger.warn(`Unable to parse Firebase service account JSON at ${filePath}.`);
      return null;
    }
  }

  private normalizeEnvValue(value: string | undefined): string | null {
    if (!value) return null;
    const trimmed = value.trim();
    if (!trimmed) return null;

    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      return trimmed.slice(1, -1);
    }

    return trimmed;
  }

  private normalizeServiceAccount(
    serviceAccount: Record<string, unknown>,
  ): Record<string, unknown> | null {
    if (typeof serviceAccount.private_key === 'string') {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }

    const missing = FirebaseAdminService.requiredServiceAccountKeys.filter(
      (key) => !serviceAccount[key] || typeof serviceAccount[key] !== 'string',
    );

    if (missing.length > 0) {
      this.logger.warn(
        `Firebase service account is missing required keys: ${missing.join(', ')}`,
      );
      return null;
    }

    return serviceAccount;
  }
}
