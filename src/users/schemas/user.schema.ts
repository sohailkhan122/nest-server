import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

export enum UserRole {
  STUDENT = 'student',
  COMPANY = 'company',
  ADMIN = 'admin',
}

export enum UserStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  BLOCKED = 'blocked',
}

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: true })
  password: string;

  @Prop({ type: String, enum: UserRole, default: UserRole.STUDENT })
  role: UserRole;

  @Prop({ type: String, enum: UserStatus, default: UserStatus.PENDING })
  status: UserStatus;

  @Prop({ type: Boolean, default: false })
  isApproved: boolean;

  @Prop({ type: Boolean, default: false })
  profileCompleted: boolean;

  @Prop({ type: String, default: null })
  refreshToken: string | null;

  @Prop({ type: String, default: null })
  resetPasswordToken: string | null;

  @Prop({ type: Date, default: null })
  resetPasswordExpiry: Date | null;

  @Prop({ type: [String], default: [] })
  fcmTokens: string[];
}

export const UserSchema = SchemaFactory.createForClass(User);
