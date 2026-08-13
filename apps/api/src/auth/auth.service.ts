// 认证服务：注册 / 登录 / refresh 轮换 / 角色初始化
import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { AuthTokens, AuthUser } from '@word-journey/shared';
import { PrismaService } from '../prisma/prisma.service';

const BCRYPT_ROUNDS = 10;
const LOGIN_MAX_FAILS = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const FAIL_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

@Injectable()
export class AuthService implements OnModuleInit, OnModuleDestroy {
  // 进程内登录失败计数（单实例足够；多实例需换 Redis，v1.1）
  private readonly failTimes = new Map<string, number[]>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, times] of this.failTimes) {
        const recent = times.filter((t) => now - t < LOGIN_WINDOW_MS);
        if (recent.length === 0) this.failTimes.delete(key);
        else this.failTimes.set(key, recent);
      }
    }, FAIL_CLEANUP_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  // access token：负载仅含 userId / username，TTL 短
  private signAccess(userId: number, username: string): string {
    const ttl = this.config.get<string>('JWT_ACCESS_TTL') ?? '15m';
    return this.jwt.sign(
      { sub: userId, username },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { secret: this.config.get<string>('JWT_ACCESS_SECRET'), expiresIn: ttl as any },
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
    character: { level: number; exp: number; hpLv: number; atkLv: number; defLv: number } | null;
  }): AuthUser {
    const { id, username, coins, character } = u;
    return {
      id,
      username,
      coins,
      character: character
        ? {
            level: character.level,
            exp: character.exp,
            hpLv: character.hpLv,
            atkLv: character.atkLv,
            defLv: character.defLv,
          }
        : undefined,
    };
  }

  // 登录限流：窗口内失败次数过多则锁定
  private assertAllowed(username: string): void {
    const now = Date.now();
    const recent = (this.failTimes.get(username) ?? []).filter(
      (t) => now - t < LOGIN_WINDOW_MS,
    );
    this.failTimes.set(username, recent);
    if (recent.length >= LOGIN_MAX_FAILS) {
      throw new HttpException('尝试次数过多，请 15 分钟后再试', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private recordFail(username: string): void {
    const list = this.failTimes.get(username) ?? [];
    list.push(Date.now());
    this.failTimes.set(username, list);
  }

  private clearFails(username: string): void {
    this.failTimes.delete(username);
  }

  async register(username: string, password: string): Promise<AuthTokens & { user: AuthUser }> {
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    try {
      const user = await this.prisma.user.create({
        data: { username, passwordHash },
        include: { character: true },
      });
      return {
        user: this.toAuthUser(user),
        accessToken: this.signAccess(user.id, user.username),
        refreshToken: await this.issueRefresh(user.id),
      };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('用户名已存在');
      }
      throw err;
    }
  }

  async login(username: string, password: string): Promise<AuthTokens & { user: AuthUser }> {
    this.assertAllowed(username);
    // 先记录失败（防止并发竞态），成功时清除
    this.recordFail(username);
    const user = await this.prisma.user.findUnique({
      where: { username },
      include: { character: true },
    });
    if (!user) {
      throw new UnauthorizedException('用户名或密码错误');
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('用户名或密码错误');
    }
    this.clearFails(username);
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

  // 退出登录：清空 refresh token 哈希，使已签发 refresh 失效
  async logout(userId: number): Promise<{ ok: boolean }> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshTokenHash: null },
    });
    return { ok: true };
  }

  // 角色初始化：仅首次创建生效；已存在则原样返回（防止覆盖已养成属性）
  async initCharacter(
    userId: number,
    hpLv = 1,
    atkLv = 1,
    defLv = 1,
  ): Promise<AuthUser> {
    await this.prisma.userCharacter.upsert({
      where: { userId },
      update: {},
      create: { userId, hpLv, atkLv, defLv },
    });
    return this.me(userId);
  }
}