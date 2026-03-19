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
  profileCompleted: boolean;
};

@WebSocketGateway({ cors: { origin: '*' } })
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

      client.data.userId = payload.sub;
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
