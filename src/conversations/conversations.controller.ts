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

@UseGuards(JwtAccessGuard, RolesGuard)
@Roles(UserRole.STUDENT, UserRole.COMPANY)
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

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
  getMessages(@Req() req: Request, @Param('conversationId') conversationId: string) {
    const userId = (req.user as any).userId;
    return this.conversationsService.getMessages(conversationId, userId);
  }

  @Post(':conversationId/messages')
  sendMessage(
    @Req() req: Request,
    @Param('conversationId') conversationId: string,
    @Body() dto: SendMessageDto,
  ) {
    const userId = (req.user as any).userId;
    return this.conversationsService.sendMessage(
      conversationId,
      userId,
      dto.content,
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
    return this.conversationsService.updateOwnMessage(
      conversationId,
      messageId,
      userId,
      dto.content,
    );
  }

  @Delete(':conversationId/messages/:messageId')
  deleteMessage(
    @Req() req: Request,
    @Param('conversationId') conversationId: string,
    @Param('messageId') messageId: string,
  ) {
    const userId = (req.user as any).userId;
    return this.conversationsService.deleteOwnMessage(
      conversationId,
      messageId,
      userId,
    );
  }
}