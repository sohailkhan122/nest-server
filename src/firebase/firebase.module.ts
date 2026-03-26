import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FirebaseAdminService } from './firebase-admin.service';
import { NotificationService } from './notification.service';

@Module({
  imports: [ConfigModule],
  providers: [FirebaseAdminService, NotificationService],
  exports: [FirebaseAdminService, NotificationService],
})
export class FirebaseModule {}
