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
import { User, UserDocument, UserRole, UserStatus } from '../users/schemas/user.schema';
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
    await this.ensureUserApproved(currentUserId);

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
    const conversations = await this.conversationModel
      .find({ participants: new Types.ObjectId(userId) })
      .populate('participants', '-password -refreshToken -resetPasswordToken -resetPasswordExpiry')
      .populate('lastMessageSenderId', 'name email role')
      .sort({ lastMessageAt: -1, updatedAt: -1 })
      .lean()
      .exec();

    // Attach unread count to each conversation
    const conversationsWithUnread = await Promise.all(
      conversations.map(async (conversation: any) => {
        const unreadCount = await this.messageModel.countDocuments({
          conversationId: conversation._id,
          senderId: { $ne: new Types.ObjectId(userId) },
          isRead: false,
        });
        return { ...conversation, unreadCount };
      }),
    );

    return conversationsWithUnread;
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

  async markAsRead(
    conversationId: string,
    userId: string,
  ): Promise<string[]> {
    const conversation = await this.ensureConversationAccess(conversationId, userId);

    // Update messages sent by OTHER people (not me)
    const result = await this.messageModel.updateMany(
      {
        conversationId: new Types.ObjectId(conversationId),
        senderId: { $ne: new Types.ObjectId(userId) },
        isRead: false,
      },
      {
        $set: { isRead: true },
      },
    );

    if (result.modifiedCount > 0) {
      // Find the other participant(s) to notify
      const otherParticipants = conversation.participants
        .filter((p) => p.toString() !== userId)
        .map((p) => p.toString());
      return otherParticipants;
    }

    return [];
  }

  async getTotalUnreadCount(userId: string): Promise<number> {
    const conversations = await this.conversationModel
      .find({ participants: new Types.ObjectId(userId) }, '_id')
      .exec();

    const conversationIds = conversations.map((c) => c._id);

    return this.messageModel.countDocuments({
      conversationId: { $in: conversationIds },
      senderId: { $ne: new Types.ObjectId(userId) },
      isRead: false,
    });
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
    if (server) {
      server.to(conversationId).emit('newMessage', savedMessage);

      // Fetch participants to find recipient
      const conversation = await this.conversationModel
        .findById(conversationId)
        .select('participants')
        .exec();
      const recipientId = conversation?.participants.find((p) => p.toString() !== senderId);

      if (recipientId) {
        // Send updated unread count to the recipient
        // But this requires 'getTotalUnreadCount' to be quick
        const unreadCount = await this.getTotalUnreadCount(recipientId.toString());
        server.to(recipientId.toString()).emit('unreadCountUpdate', unreadCount);

        // Emit conversation update
        const conversationUnreadCount = await this.messageModel.countDocuments({
          conversationId: new Types.ObjectId(conversationId),
          senderId: { $ne: recipientId },
          isRead: false,
        });

        server.to(recipientId.toString()).emit('conversationUpdated', {
           _id: conversationId,
           lastMessage: savedMessage.content,
           lastMessageSenderId: senderId,
           lastMessageAt: savedMessage.createdAt,
           unreadCount: conversationUnreadCount,
        });
      }

      // Keep sender's conversation list in sync too.
      server.to(senderId).emit('conversationUpdated', {
        _id: conversationId,
        lastMessage: savedMessage.content,
        lastMessageSenderId: senderId,
        lastMessageAt: savedMessage.createdAt,
      });
    }
    
    return savedMessage;
  }

  async updateOwnMessageAndEmit(
    conversationId: string,
    messageId: string,
    userId: string,
    content: string,
    server: any,
  ): Promise<Message> {
    const updatedMessage = await this.updateOwnMessage(
      conversationId,
      messageId,
      userId,
      content,
    );

    if (server) {
      server.to(conversationId).emit('messageUpdated', updatedMessage);

      const conversation = await this.conversationModel
        .findById(conversationId)
        .select('participants lastMessage lastMessageAt lastMessageSenderId')
        .exec();

      if (conversation) {
        for (const participantId of conversation.participants) {
          const participantIdStr = participantId.toString();
          const unreadCount = await this.messageModel.countDocuments({
            conversationId: new Types.ObjectId(conversationId),
            senderId: { $ne: participantId },
            isRead: false,
          });

          server.to(participantIdStr).emit('conversationUpdated', {
            _id: conversationId,
            lastMessage: conversation.lastMessage,
            lastMessageSenderId: conversation.lastMessageSenderId,
            lastMessageAt: conversation.lastMessageAt,
            unreadCount,
          });
        }
      }
    }
    return updatedMessage;
  }

  async deleteOwnMessageAndEmit(
    conversationId: string,
    messageId: string,
    userId: string,
    server: any,
  ): Promise<{ deleted: true; messageId: string }> {
    const result = await this.deleteOwnMessage(conversationId, messageId, userId);

    if (server) {
      server.to(conversationId).emit('messageDeleted', result.messageId);

      const conversation = await this.conversationModel
        .findById(conversationId)
        .select('participants lastMessage lastMessageAt lastMessageSenderId')
        .exec();

      if (conversation) {
        for (const participantId of conversation.participants) {
          const participantIdStr = participantId.toString();
          const unreadCount = await this.messageModel.countDocuments({
            conversationId: new Types.ObjectId(conversationId),
            senderId: { $ne: participantId },
            isRead: false,
          });

          server.to(participantIdStr).emit('conversationUpdated', {
            _id: conversationId,
            lastMessage: conversation.lastMessage,
            lastMessageSenderId: conversation.lastMessageSenderId,
            lastMessageAt: conversation.lastMessageAt,
            unreadCount,
          });
        }
      }
    }
    return result;
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
    await this.ensureUserApproved(userId);

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

  private async ensureUserApproved(userId: string): Promise<void> {
    const user = await this.userModel
      .findById(userId)
      .select('isApproved role status')
      .exec();
    if (!user) throw new NotFoundException('User not found');

    const approved = user.isApproved === true || user.status === UserStatus.APPROVED;
    if (user.role !== UserRole.ADMIN && !approved) {
      throw new ForbiddenException('Your account is under review. Please wait for admin approval.');
    }
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