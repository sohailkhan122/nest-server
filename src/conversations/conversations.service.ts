import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Conversation,
  ConversationDocument,
} from './schemas/conversation.schema';
import { Message, MessageDocument } from './schemas/message.schema';
import { User, UserDocument, UserRole } from '../users/schemas/user.schema';
import { Job, JobDocument } from '../jobs/schemas/job.schema';

@Injectable()
export class ConversationsService {
  constructor(
    @InjectModel(Conversation.name)
    private readonly conversationModel: Model<ConversationDocument>,
    @InjectModel(Message.name)
    private readonly messageModel: Model<MessageDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(Job.name)
    private readonly jobModel: Model<JobDocument>,
  ) {}

  async createOrGetConversation(
    currentUserId: string,
    participantId: string,
  ): Promise<Conversation> {
    if (currentUserId === participantId) {
      throw new BadRequestException(
        'You cannot create a conversation with yourself',
      );
    }

    const [currentUser, participantUser] = await Promise.all([
      this.userModel.findById(currentUserId).select('role').exec(),
      this.userModel.findById(participantId).select('role').exec(),
    ]);

    if (!currentUser || !participantUser) {
      throw new NotFoundException('User not found');
    }

    const hasStudent =
      currentUser.role === UserRole.STUDENT ||
      participantUser.role === UserRole.STUDENT;
    const hasCompany =
      currentUser.role === UserRole.COMPANY ||
      participantUser.role === UserRole.COMPANY;

    if (!hasStudent || !hasCompany) {
      throw new BadRequestException(
        'Conversation is only allowed between a student applicant and a company',
      );
    }

    const participantsKey = this.buildParticipantsKey(
      currentUserId,
      participantId,
    );

    const existingConversation = await this.conversationModel
      .findOne({ participantsKey })
      .populate('participants', '-password -refreshToken -resetPasswordToken -resetPasswordExpiry')
      .populate('lastMessageSenderId', 'name email role')
      .exec();

    if (existingConversation) {
      return existingConversation;
    }

    const studentId =
      currentUser.role === UserRole.STUDENT ? currentUserId : participantId;
    const companyId =
      currentUser.role === UserRole.COMPANY ? currentUserId : participantId;

    const hasApplied = await this.jobModel.exists({
      companyId: new Types.ObjectId(companyId),
      'applicants.userId': new Types.ObjectId(studentId),
    });

    if (!hasApplied) {
      throw new ForbiddenException(
        'Conversation is allowed only when the student has applied to a job posted by this company',
      );
    }

    const conversation = await this.conversationModel.create({
      participantsKey,
      participants: [
        new Types.ObjectId(currentUserId),
        new Types.ObjectId(participantId),
      ],
      lastMessage: null,
      lastMessageSenderId: null,
      lastMessageAt: new Date(),
    });

    return this.getConversationByIdOrThrow((conversation._id as Types.ObjectId).toString());
  }

  async getConversations(userId: string): Promise<Conversation[]> {
    return this.conversationModel
      .find({ participants: new Types.ObjectId(userId) })
      .populate('participants', '-password -refreshToken -resetPasswordToken -resetPasswordExpiry')
      .populate('lastMessageSenderId', 'name email role')
      .sort({ lastMessageAt: -1, updatedAt: -1 })
      .exec();
  }

  async getMessages(conversationId: string, userId: string): Promise<Message[]> {
    await this.ensureConversationAccess(conversationId, userId);

    return this.messageModel
      .find({ conversationId: new Types.ObjectId(conversationId) })
      .populate('senderId', 'name email role')
      .sort({ createdAt: 1 })
      .exec();
  }

  async sendMessage(
    conversationId: string,
    senderId: string,
    content: string,
  ): Promise<Message> {
    const trimmedContent = content.trim();
    if (!trimmedContent) {
      throw new BadRequestException('Message content cannot be empty');
    }

    const conversation = await this.ensureConversationAccess(
      conversationId,
      senderId,
    );

    const message = await this.messageModel.create({
      conversationId: new Types.ObjectId(conversationId),
      senderId: new Types.ObjectId(senderId),
      content: trimmedContent,
    });

    conversation.lastMessage = trimmedContent;
    conversation.lastMessageSenderId = new Types.ObjectId(senderId);
    conversation.lastMessageAt = message.createdAt ?? new Date();
    await conversation.save();

    const savedMessage = await this.messageModel
      .findById(message._id)
      .populate('senderId', 'name email role')
      .exec();

    if (!savedMessage) throw new NotFoundException('Message not found');
    return savedMessage;
  }

  async updateOwnMessage(
    conversationId: string,
    messageId: string,
    userId: string,
    content: string,
  ): Promise<Message> {
    await this.ensureConversationAccess(conversationId, userId);

    const trimmedContent = content.trim();
    if (!trimmedContent) {
      throw new BadRequestException('Message content cannot be empty');
    }

    const message = await this.messageModel.findById(messageId).exec();
    if (!message) throw new NotFoundException('Message not found');

    if (message.conversationId.toString() !== conversationId) {
      throw new BadRequestException('Message does not belong to this conversation');
    }

    if (message.senderId.toString() !== userId) {
      throw new ForbiddenException('You can update only your own messages');
    }

    message.content = trimmedContent;
    await message.save();

    await this.refreshConversationLastMessage(conversationId);

    const updatedMessage = await this.messageModel
      .findById(message._id)
      .populate('senderId', 'name email role')
      .exec();

    if (!updatedMessage) throw new NotFoundException('Message not found');
    return updatedMessage;
  }

  async deleteOwnMessage(
    conversationId: string,
    messageId: string,
    userId: string,
  ): Promise<{ deleted: true; messageId: string }> {
    await this.ensureConversationAccess(conversationId, userId);

    const message = await this.messageModel.findById(messageId).exec();
    if (!message) throw new NotFoundException('Message not found');

    if (message.conversationId.toString() !== conversationId) {
      throw new BadRequestException('Message does not belong to this conversation');
    }

    if (message.senderId.toString() !== userId) {
      throw new ForbiddenException('You can delete only your own messages');
    }

    await this.messageModel.deleteOne({ _id: message._id }).exec();
    await this.refreshConversationLastMessage(conversationId);

    return { deleted: true, messageId };
  }

  async sendMessageAndEmit(
    conversationId: string,
    senderId: string,
    content: string,
    server: any, // Socket.IO Server instance
  ): Promise<Message> {
    const savedMessage = await this.sendMessage(conversationId, senderId, content);
    
    // Broadcast newMessage event
    server.to(conversationId).emit('newMessage', savedMessage);
    
    return savedMessage;
  }
  private buildParticipantsKey(userAId: string, userBId: string): string {
    return [userAId, userBId].sort().join(':');
  }

  async assertConversationAccess(conversationId: string, userId: string): Promise<void> {
    await this.ensureConversationAccess(conversationId, userId);
  }

  private async ensureConversationAccess(
    conversationId: string,
    userId: string,
  ): Promise<ConversationDocument> {
    const conversation = await this.conversationModel.findById(conversationId).exec();
    if (!conversation) throw new NotFoundException('Conversation not found');

    const isParticipant = conversation.participants.some(
      (participantId) => participantId.toString() === userId,
    );

    if (!isParticipant) {
      throw new ForbiddenException('You do not have access to this conversation');
    }

    return conversation;
  }

  private async refreshConversationLastMessage(
    conversationId: string,
  ): Promise<void> {
    const conversation = await this.conversationModel.findById(conversationId).exec();
    if (!conversation) throw new NotFoundException('Conversation not found');

    const latestMessage = await this.messageModel
      .findOne({ conversationId: new Types.ObjectId(conversationId) })
      .sort({ createdAt: -1, _id: -1 })
      .exec();

    if (!latestMessage) {
      conversation.lastMessage = null;
      conversation.lastMessageSenderId = null;
      conversation.lastMessageAt = null;
      await conversation.save();
      return;
    }

    conversation.lastMessage = latestMessage.content;
    conversation.lastMessageSenderId = latestMessage.senderId;
    conversation.lastMessageAt = latestMessage.createdAt ?? new Date();
    await conversation.save();
  }

  private async getConversationByIdOrThrow(
    conversationId: string,
  ): Promise<Conversation> {
    const conversation = await this.conversationModel
      .findById(conversationId)
      .populate('participants', '-password -refreshToken -resetPasswordToken -resetPasswordExpiry')
      .populate('lastMessageSenderId', 'name email role')
      .exec();

    if (!conversation) throw new NotFoundException('Conversation not found');
    return conversation;
  }
}