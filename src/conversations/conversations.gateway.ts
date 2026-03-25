import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { UnauthorizedException } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { ConversationsService } from './conversations.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

type SocketJwtPayload = {
  sub: string;
  email: string;
  role: string;
  isApproved: boolean;
  profileCompleted: boolean;
};

@WebSocketGateway({
  cors: {
    origin: process.env.CORS_ORIGIN?.split(',').map((o) => o.trim()) ?? true,
    credentials: true,
  },
})
export class ConversationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly conversationsService: ConversationsService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const tokenFromAuth = client.handshake.auth?.token;
      const cookieHeader = client.handshake.headers.cookie ?? '';
      const tokenFromCookie = cookieHeader
        .split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith('access_token='))
        ?.split('=')[1];

      const token = tokenFromAuth || tokenFromCookie;
      if (!token) {
        throw new UnauthorizedException('Missing access token');
      }

      const payload = await this.jwtService.verifyAsync<SocketJwtPayload>(token, {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
      });

      if (payload.role !== 'admin' && !payload.isApproved) {
        throw new UnauthorizedException('Account is not approved yet');
      }

      client.data.userId = payload.sub;
      client.join(payload.sub); // Join a room named after the user ID for personal notifications
    } catch {
      client.emit('error', { message: 'Unauthorized socket connection' });
      client.disconnect();
      return;
    }

    console.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);
  }

  // Handle joining a conversation room
  @SubscribeMessage('joinConversation')
  async handleJoinConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() conversationId: string,
  ) {
    const userId = client.data.userId as string | undefined;
    if (!userId) throw new UnauthorizedException('Unauthorized');

    await this.conversationsService.assertConversationAccess(conversationId, userId);
    client.join(conversationId);
    return { success: true };
  }

  @SubscribeMessage('mark_as_read')
  async handleMarkAsRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() conversationId: string,
  ) {
    const userId = client.data.userId as string | undefined;
    if (!userId) throw new UnauthorizedException('Unauthorized');

    const notifiedUsers = await this.conversationsService.markAsRead(conversationId, userId);

    // Update unread count for current user (reader)
    const unreadCount = await this.conversationsService.getTotalUnreadCount(userId);
    this.server.to(userId).emit('unreadCountUpdate', unreadCount);
    // Notify reader to clear badge
    this.server.to(userId).emit('conversationRead', { _id: conversationId });

    // Notify Senders that their messages were read
    if (notifiedUsers.length > 0) {
      notifiedUsers.forEach((uId) => {
        this.server.to(uId).emit('messagesRead', { conversationId });
      });
    }
    
    return { success: true };
  }

  @SubscribeMessage('sendMessage')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { conversationId: string; content: string },
  ) {
    try {
      const senderId = client.data.userId as string | undefined;
      if (!senderId) {
        throw new UnauthorizedException('Unauthorized');
      }

      await this.conversationsService.assertConversationAccess(payload.conversationId, senderId);

      const message = await this.conversationsService.sendMessageAndEmit(
        payload.conversationId,
        senderId,
        payload.content,
        this.server,
      );
      return { success: true, message };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Failed to send message';
      client.emit('error', { message: errMsg });
      return { success: false, error: errMsg };
    }
  }
}
