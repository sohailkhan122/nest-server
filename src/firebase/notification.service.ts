import { Injectable, Logger } from '@nestjs/common';
import { FirebaseAdminService } from './firebase-admin.service';

export type PushNotificationResult = {
  successCount: number;
  failureCount: number;
  invalidTokens: string[];
};

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(private readonly firebaseAdminService: FirebaseAdminService) {}

  async sendPushNotification(
    tokens: string | string[],
    title: string,
    body: string,
    data: Record<string, string> = {},
  ): Promise<PushNotificationResult> {
    const normalizedTokens = Array.from(
      new Set((Array.isArray(tokens) ? tokens : [tokens]).map((token) => token.trim()).filter(Boolean)),
    );

    if (normalizedTokens.length === 0) {
      return { successCount: 0, failureCount: 0, invalidTokens: [] };
    }

    const messaging = this.firebaseAdminService.messaging;
    if (!messaging) {
      this.logger.warn('Skipping push notification: Firebase messaging is not initialized.');
      return { successCount: 0, failureCount: normalizedTokens.length, invalidTokens: [] };
    }

    const clickAction = data.clickAction ?? data.url ?? '/messages';
    const payloadData = {
      ...Object.fromEntries(Object.entries(data).map(([key, value]) => [key, String(value)])),
      clickAction,
      url: data.url ?? clickAction,
    };

    if (normalizedTokens.length === 1) {
      try {
        await messaging.send({
          token: normalizedTokens[0],
          notification: { title, body },
          data: payloadData,
          webpush: {
            fcmOptions: { link: payloadData.url },
            notification: {
              title,
              body,
              data: payloadData,
            },
          },
        });
        return { successCount: 1, failureCount: 0, invalidTokens: [] };
      } catch (error) {
        const code = this.extractErrorCode(error);
        const invalidTokens = this.isInvalidTokenError(code) ? [normalizedTokens[0]] : [];
        this.logger.warn(`Failed to send push notification: ${code}`);
        return { successCount: 0, failureCount: 1, invalidTokens };
      }
    }

    const response = await messaging.sendEachForMulticast({
      tokens: normalizedTokens,
      notification: { title, body },
      data: payloadData,
      webpush: {
        fcmOptions: { link: payloadData.url },
        notification: {
          title,
          body,
          data: payloadData,
        },
      },
    });

    const invalidTokens: string[] = [];
    response.responses.forEach((result, index) => {
      if (!result.success) {
        const code = this.extractErrorCode(result.error);
        if (this.isInvalidTokenError(code)) {
          invalidTokens.push(normalizedTokens[index]);
        }
      }
    });

    return {
      successCount: response.successCount,
      failureCount: response.failureCount,
      invalidTokens,
    };
  }

  private extractErrorCode(error: unknown): string {
    if (typeof error === 'object' && error && 'code' in error) {
      const code = (error as { code?: string }).code;
      return code ?? 'unknown-error';
    }
    return 'unknown-error';
  }

  private isInvalidTokenError(code: string): boolean {
    return [
      'messaging/registration-token-not-registered',
      'messaging/invalid-registration-token',
      'messaging/invalid-argument',
    ].includes(code);
  }
}
