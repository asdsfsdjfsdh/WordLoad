// 认证服务：注册 / 登录 / refresh 轮换 / 角色初始化
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'node:crypto';
import type { AuthTokens, AuthUser } from '@word-journey/shared';
import { PrismaService } from '../prisma/prisma.service';

const BCRYPT_ROUNDS = 10;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  // access token：负载仅含 userId / username，TTL 短
  private signAccess(userId: number, username: string): string {
    const ttl = (this.config.get<string>('JWT_ACCESS_TTL') ?? '15m') as unknown as number;
    return this.jwt.sign(
      { sub: userId, username },
      { secret: this.config.get<string>('JWT_ACCESS_SECRET'), expiresIn: ttl },
    );
  }

  // refresh token：随机串，仅存哈希到库里，登录/轮换时签发
  private async issueRefresh(userId: number): Promise<string> {
    const token = crypto.randomBytes(48).toString('base64url');
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshTokenHash: hash },
    });
    return token;
  }

  private toAuthUser(u: {
    id: number;
    username: string;
    coins: number;
    character: { level: number; hpLv: number; atkLv: number; defLv: number } | null;
  }): AuthUser {
    const { id, username, coins, character } = u;
    return {
      id,
      username,
      coins,
      character: character
        ? {
            level: character.level,
            hpLv: character.hpLv,
            atkLv: character.atkLv,
            defLv: character.defLv,
          }
        : undefined,
    };
  }

  async register(username: string, password: string): Promise<AuthTokens & { user: AuthUser }> {
    const exists = await this.prisma.user.findUnique({ where: { username } });
    if (exists) throw new UnauthorizedException('用户名已存在');
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = await this.prisma.user.create({
      data: { username, passwordHash },
      include: { character: true },
    });
    return {
      user: this.toAuthUser(user),
      accessToken: this.signAccess(user.id, user.username),
      refreshToken: await this.issueRefresh(user.id),
    };
  }

  async login(username: string, password: string): Promise<AuthTokens & { user: AuthUser }> {
    const user = await this.prisma.user.findUnique({
      where: { username },
      include: { character: true },
    });
    if (!user) throw new UnauthorizedException('用户名或密码错误');
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('用户名或密码错误');
    return {
      user: this.toAuthUser(user),
      accessToken: this.signAccess(user.id, user.username),
      refreshToken: await this.issueRefresh(user.id),
    };
  }

  // refresh 轮换：校验哈希匹配 → 签发新 access + 新 refresh（旧 refresh 立即失效）
  async refresh(refreshToken: string): Promise<AuthTokens> {
    const hash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const user = await this.prisma.user.findFirst({
      where: { refreshTokenHash: hash },
    });
    if (!user) throw new UnauthorizedException('refresh token 无效');
    const next = await this.issueRefresh(user.id);
    return {
      accessToken: this.signAccess(user.id, user.username),
      refreshToken: next,
    };
  }

  async me(userId: number): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { character: true },
    });
    if (!user) throw new UnauthorizedException('用户不存在');
    return this.toAuthUser(user);
  }

  // 角色初始化：幂等（已有则更新三围，无则创建），默认 1 级
  async initCharacter(
    userId: number,
    hpLv = 1,
    atkLv = 1,
    defLv = 1,
  ): Promise<AuthUser> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        character: {
          upsert: {
            create: { hpLv, atkLv, defLv },
            update: { hpLv, atkLv, defLv },
          },
        },
      },
      include: { character: true },
    });
    return this.toAuthUser(user);
  }
}