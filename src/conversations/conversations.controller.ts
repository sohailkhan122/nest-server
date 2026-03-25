import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ConversationsService } from './conversations.service';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/schemas/user.schema';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { UpdateMessageDto } from './dto/update-message.dto';
import { ConversationsGateway } from './conversations.gateway';

@UseGuards(JwtAccessGuard, RolesGuard)
@Roles(UserRole.STUDENT, UserRole.COMPANY)
@Controller('conversations')
export class ConversationsController {
  constructor(
    private readonly conversationsService: ConversationsService,
    private readonly conversationsGateway: ConversationsGateway,
  ) {}

  @Post()
  createOrGet(@Req() req: Request, @Body() dto: CreateConversationDto) {
    const userId = (req.user as any).userId;
    return this.conversationsService.createOrGetConversation(
      userId,
      dto.participantId,
    );
  }

  @Get()
  getAllForMe(@Req() req: Request) {
    const userId = (req.user as any).userId;
    return this.conversationsService.getConversations(userId);
  }

  @Get(':conversationId/messages')
  async getMessages(@Req() req: Request, @Param('conversationId') conversationId: string) {
    const userId = (req.user as any).userId;
    const messages = await this.conversationsService.getMessages(conversationId, userId);

    const notifiedUsers = await this.conversationsService.markAsRead(conversationId, userId);
    const unreadCount = await this.conversationsService.getTotalUnreadCount(userId);
    this.conversationsGateway.server.to(userId).emit('unreadCountUpdate', unreadCount);
    this.conversationsGateway.server.to(userId).emit('conversationRead', { _id: conversationId });
    notifiedUsers.forEach((otherUserId) => {
      this.conversationsGateway.server
        .to(otherUserId)
        .emit('messagesRead', { conversationId });
    });

    return messages;
  }

  @Post(':conversationId/messages')
  sendMessage(
    @Req() req: Request,
    @Param('conversationId') conversationId: string,
    @Body() dto: SendMessageDto,
  ) {
    const userId = (req.user as any).userId;
    return this.conversationsService.sendMessageAndEmit(
      conversationId,
      userId,
      dto.content,
      this.conversationsGateway.server,
    );
  }

  @Patch(':conversationId/messages/:messageId')
  updateMessage(
    @Req() req: Request,
    @Param('conversationId') conversationId: string,
    @Param('messageId') messageId: string,
    @Body() dto: UpdateMessageDto,
  ) {
    const userId = (req.user as any).userId;
    return this.conversationsService.updateOwnMessageAndEmit(
      conversationId,
      messageId,
      userId,
      dto.content,
      this.conversationsGateway.server,
    );
  }

  @Delete(':conversationId/messages/:messageId')
  deleteMessage(
    @Req() req: Request,
    @Param('conversationId') conversationId: string,
    @Param('messageId') messageId: string,
  ) {
    const userId = (req.user as any).userId;
    return this.conversationsService.deleteOwnMessageAndEmit(
      conversationId,
      messageId,
      userId,
      this.conversationsGateway.server,
    );
  }
}