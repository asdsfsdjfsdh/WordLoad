import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

export interface JwtUser {
  sub: number;
  username: string;
}

// 校验 Bearer access token，挂载 req.user
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { user?: JwtUser }>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('缺少 access token');
    }
    const token = header.slice('Bearer '.length);
    try {
      const payload = await this.jwt.verifyAsync<JwtUser>(token, {
        secret: this.config.get<string>('JWT_ACCESS_SECRET'),
      });
      req.user = { sub: payload.sub, username: payload.username };
      return true;
    } catch {
      throw new UnauthorizedException('access token 无效或已过期');
    }
  }
}