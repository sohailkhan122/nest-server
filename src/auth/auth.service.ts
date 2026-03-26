import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import * as nodemailer from 'nodemailer';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { UserStatus } from '../users/schemas/user.schema';

@Injectable()
export class AuthService {
  private readonly mailTransporter: nodemailer.Transporter;

  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {
    // Strip spaces from app password (Gmail displays them grouped but ignores spaces)
    const mailPass = (this.configService.get<string>('MAIL_PASS') ?? '').replace(/\s/g, '');

    this.mailTransporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,   // port 465 = direct SSL (no STARTTLS handshake, less likely to be blocked)
      auth: {
        user: this.configService.get<string>('MAIL_USER'),
        pass: mailPass,
      },
      tls: {
        rejectUnauthorized: false,
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000,
    });
  }

  // ─── Login ────────────────────────────────────────────────────────────────
  async login(dto: LoginDto) {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const passwordMatch = await bcrypt.compare(dto.password, user.password);
    if (!passwordMatch) throw new UnauthorizedException('Invalid credentials');

    if (user.status === UserStatus.BLOCKED) {
      throw new ForbiddenException('Your account has been blocked. Please contact support.');
    }

    const isApproved =
      user.role === 'admin' ||
      user.isApproved === true ||
      user.status === UserStatus.APPROVED;

    const tokens = await this.generateTokens(
      (user._id as any).toString(),
      user.email,
      user.role,
      isApproved,
      user.profileCompleted,
    );
    await this.storeRefreshToken((user._id as any).toString(), tokens.refreshToken);

    const { password, refreshToken: _rt, ...userDetails } = (user as any).toObject ? (user as any).toObject() : user;
    return { ...tokens, user: userDetails };
  }

  // ─── Refresh tokens ───────────────────────────────────────────────────────
  async refreshTokens(userId: string, refreshToken: string) {
    const user = await this.usersService.findById(userId);
    if (!user || !user.refreshToken)
      throw new ForbiddenException('Access denied');

    const tokenMatch = await bcrypt.compare(refreshToken, user.refreshToken);
    if (!tokenMatch) throw new ForbiddenException('Access denied');

    const isApproved =
      user.role === 'admin' ||
      user.isApproved === true ||
      user.status === UserStatus.APPROVED;

    const tokens = await this.generateTokens(
      (user._id as any).toString(),
      user.email,
      user.role,
      isApproved,
      user.profileCompleted,
    );
    await this.storeRefreshToken((user._id as any).toString(), tokens.refreshToken);

    return { ...tokens, name: user.name, email: user.email, role: user.role, profileCompleted: user.profileCompleted };
  }

  // ─── Get Me ───────────────────────────────────────────────────────────────
  async getMe(userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user) throw new UnauthorizedException('User not found');
    const { password, refreshToken, ...userDetails } = (user as any).toObject
      ? (user as any).toObject()
      : (user as any);
    return userDetails;
  }

  async createSocketToken(userId: string): Promise<{ token: string }> {
    const user = await this.usersService.findById(userId);
    if (!user) throw new UnauthorizedException('User not found');

    const isApproved =
      user.role === 'admin' ||
      user.isApproved === true ||
      user.status === UserStatus.APPROVED;

    const payload = {
      sub: (user._id as any).toString(),
      email: user.email,
      role: user.role,
      isApproved,
      profileCompleted: user.profileCompleted,
    };

    const token = await this.jwtService.signAsync(payload, {
      secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
      expiresIn: '5m',
    });

    return { token };
  }

  // ─── Logout ────────────────────────────────────────────────────────────────
  async logout(userId: string) {
    await this.usersService.updateRefreshToken(userId, null);
    return { message: 'Logged out successfully' };
  }

  async registerFcmToken(userId: string, token: string): Promise<void> {
    await this.usersService.addFcmToken(userId, token);
  }

  async removeFcmToken(userId: string, token: string): Promise<void> {
    await this.usersService.removeFcmTokens(userId, [token]);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────
  private async generateTokens(
    userId: string,
    email: string,
    role: string,
    isApproved: boolean,
    profileCompleted: boolean,
  ) {
    const payload = { sub: userId, email, role, isApproved, profileCompleted };

    const accessSecret = this.configService.get<string>('JWT_ACCESS_SECRET')!;
    const accessExpires = this.configService.get<string>('JWT_ACCESS_EXPIRES')!;
    const refreshSecret = this.configService.get<string>('JWT_REFRESH_SECRET')!;
    const refreshExpires = this.configService.get<string>('JWT_REFRESH_EXPIRES')!;

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: accessSecret,
        expiresIn: accessExpires as any,
      }),
      this.jwtService.signAsync(payload, {
        secret: refreshSecret,
        expiresIn: refreshExpires as any,
      }),
    ]);

    return { accessToken, refreshToken };
  }

  private async storeRefreshToken(userId: string, refreshToken: string) {
    const hashed = await bcrypt.hash(refreshToken, 10);
    await this.usersService.updateRefreshToken(userId, hashed);
  }

  // ─── Forgot Password ──────────────────────────────────────────────────────
  async forgotPassword(email: string): Promise<{ message: string }> {
    const user = await this.usersService.findByEmail(email);
    // Always return success to avoid email enumeration
    if (!user) return { message: 'If that email exists, a reset link has been sent.' };

    const token = crypto.randomBytes(32).toString('hex');
    const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await this.usersService.setResetToken((user._id as any).toString(), token, expiry);

    const clientUrl = this.configService.get<string>('CLIENT_URL') ?? 'http://localhost:3000';
    const resetUrl = `${clientUrl}/reset-password?token=${token}`;

    try {
      await this.mailTransporter.sendMail({
        from: `"JobBridge" <${this.configService.get<string>('MAIL_USER')}>`,
        to: user.email,
        subject: 'Reset your JobBridge password',
        html: `
          <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;border:1px solid #e2e8f0;border-radius:12px">
            <h2 style="color:#1e1b4b;margin-bottom:8px">Reset Your Password</h2>
            <p style="color:#475569;margin-bottom:24px">Hi ${user.name},<br/>We received a request to reset your password. Click the button below — the link is valid for <strong>1 hour</strong>.</p>
            <a href="${resetUrl}" style="display:inline-block;background:#4f46e5;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600">Reset Password</a>
            <p style="color:#94a3b8;font-size:13px;margin-top:24px">If you didn't request this, please ignore this email. Your password will not change.</p>
            <hr style="border:none;border-top:1px solid #e2e8f0;margin-top:24px"/>
            <p style="color:#94a3b8;font-size:12px">Or copy this link: ${resetUrl}</p>
          </div>
        `,
      });
    } catch (mailError) {
      console.error('[Auth] Failed to send reset email:', mailError);
      throw new BadRequestException('Failed to send reset email. Please check your email address and try again.');
    }

    return { message: 'If that email exists, a reset link has been sent.' };
  }

  // ─── Reset Password ───────────────────────────────────────────────────────
  async resetPassword(token: string, newPassword: string): Promise<{ message: string }> {
    const user = await this.usersService.findByResetToken(token);
    if (!user) throw new BadRequestException('Invalid or expired reset token.');

    const hashed = await bcrypt.hash(newPassword, 10);
    await this.usersService.updatePasswordAndClearResetToken((user._id as any).toString(), hashed);

    return { message: 'Password reset successfully. You can now log in.' };
  }
}
