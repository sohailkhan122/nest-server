import { Controller, Get, Post, Body, UseGuards, Req, Res, HttpCode, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { FcmTokenDto } from './dto/fcm-token.dto';
import { JwtAccessGuard } from './guards/jwt-access.guard';
import { JwtRefreshGuard } from './guards/jwt-refresh.guard';

const isProduction = process.env.NODE_ENV === 'production';

const COOKIE_BASE = {
  httpOnly: true,
  secure: isProduction,
  sameSite: (isProduction ? 'none' : 'lax') as 'none' | 'lax',
};

const COOKIE_OPTIONS_ACCESS = { ...COOKIE_BASE, maxAge: 15 * 60 * 1000 };
const COOKIE_OPTIONS_REFRESH = { ...COOKIE_BASE, maxAge: 7 * 24 * 60 * 60 * 1000 };
const COOKIE_CLEAR = { ...COOKIE_BASE };

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { accessToken, refreshToken, user } = await this.authService.login(dto);
    res.cookie('access_token', accessToken, COOKIE_OPTIONS_ACCESS);
    res.cookie('refresh_token', refreshToken, COOKIE_OPTIONS_REFRESH);
    return { message: 'Login successful', user };
  }

  @UseGuards(JwtRefreshGuard)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = req.user as { userId: string; refreshToken: string };
    const { accessToken, refreshToken } = await this.authService.refreshTokens(
      user.userId,
      user.refreshToken,
    );
    res.cookie('access_token', accessToken, COOKIE_OPTIONS_ACCESS);
    res.cookie('refresh_token', refreshToken, COOKIE_OPTIONS_REFRESH);
    return { message: 'Tokens refreshed' };
  }

  @UseGuards(JwtAccessGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = req.user as { userId: string };
    await this.authService.logout(user.userId);
    res.clearCookie('access_token', COOKIE_CLEAR);
    res.clearCookie('refresh_token', COOKIE_CLEAR);
    return { message: 'Logged out successfully' };
  }

  @UseGuards(JwtAccessGuard)
  @Get('me')
  async getMe(@Req() req: Request) {
    const user = req.user as { userId: string };
    return this.authService.getMe(user.userId);
  }

  @UseGuards(JwtAccessGuard)
  @Get('socket-token')
  async getSocketToken(@Req() req: Request) {
    const user = req.user as { userId: string };
    return this.authService.createSocketToken(user.userId);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.password);
  }

  @UseGuards(JwtAccessGuard)
  @Post('fcm-token')
  @HttpCode(HttpStatus.OK)
  async registerFcmToken(@Req() req: Request, @Body() dto: FcmTokenDto) {
    const user = req.user as { userId: string };
    await this.authService.registerFcmToken(user.userId, dto.token);
    return { message: 'FCM token saved' };
  }

  @UseGuards(JwtAccessGuard)
  @Post('fcm-token/remove')
  @HttpCode(HttpStatus.OK)
  async removeFcmToken(@Req() req: Request, @Body() dto: FcmTokenDto) {
    const user = req.user as { userId: string };
    await this.authService.removeFcmToken(user.userId, dto.token);
    return { message: 'FCM token removed' };
  }
}
