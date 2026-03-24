import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy, StrategyOptionsWithoutRequest } from 'passport-jwt';
import type { Request } from 'express';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  isApproved: boolean;
  profileCompleted: boolean;
}

@Injectable()
export class JwtAccessStrategy extends PassportStrategy(Strategy, 'jwt-access') {
  constructor(configService: ConfigService) {
    const options: StrategyOptionsWithoutRequest = {
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request) => req?.cookies?.access_token ?? null,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      secretOrKey: configService.get<string>('JWT_ACCESS_SECRET') as string,
      ignoreExpiration: false,
    };
    super(options);
  }

  async validate(payload: JwtPayload) {
    if (!payload?.sub) throw new UnauthorizedException();
    return {
      userId: payload.sub,
      email: payload.email,
      role: payload.role,
      isApproved: payload.isApproved,
      profileCompleted: payload.profileCompleted,
    };
  }
}
