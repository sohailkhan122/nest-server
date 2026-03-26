import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type MessageDocument = HydratedDocument<Message>;

@Schema({ timestamps: true })
export class Message {
  @Prop({ type: Types.ObjectId, ref: 'Conversation', required: true, index: true })
  conversationId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  senderId: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true })
  content: string;

  @Prop({ type: Boolean, default: false })
  isRead: boolean;

  @Prop({ type: Boolean, default: false })
  isEdited: boolean;

  createdAt: Date;

  updatedAt: Date;
}

export const MessageSchema = SchemaFactory.createForClass(Message);