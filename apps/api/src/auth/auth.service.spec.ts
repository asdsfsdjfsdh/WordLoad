import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

const prisma = {
  user: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  userCharacter: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
} as unknown as PrismaService;

const jwt = {
  sign: jest.fn((_payload: unknown, opts: { secret?: string; expiresIn?: unknown }) => {
    void opts;
    return 'signed-token';
  }),
} as unknown as JwtService;

const config = {
  get: jest.fn((k: string) => {
    if (k === 'JWT_ACCESS_SECRET') return 'secret';
    if (k === 'JWT_ACCESS_TTL') return '15m';
    return null;
  }),
} as unknown as ConfigService;

describe('AuthService', () => {
  let auth: AuthService;
  beforeEach(() => {
    jest.clearAllMocks();
    auth = new AuthService(prisma, jwt, config);
  });

  const userRow = {
    id: 1,
    username: 'alice',
    passwordHash: 'x',
    coins: 0,
    character: { level: 1, hpLv: 1, atkLv: 1, defLv: 1 },
  };

  it('register：用户名已存在抛 409', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(userRow);
    await expect(auth.register('alice', 'pass123456')).rejects.toThrow(ConflictException);
  });

  it('register：新用户创建并返回 token 与 user', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.user.create as jest.Mock).mockImplementation(async ({ data }) => ({
      ...userRow,
      username: data.username,
      passwordHash: data.passwordHash,
    }));
    (prisma.user.update as jest.Mock).mockResolvedValue(userRow);
    const r = await auth.register('alice', 'pass123456');
    expect(r.accessToken).toBe('signed-token');
    expect(r.refreshToken).toHaveLength(64); // 48 字节 base64url
    expect(r.user.id).toBe(1);
    // 密码哈希存储，不存明文
    const created = (prisma.user.create as jest.Mock).mock.calls[0]?.[0].data;
    expect(created.passwordHash).not.toBe('pass123456');
    expect(created.passwordHash.startsWith('$2')).toBe(true);
  });

  it('login：密码正确返回 token，错误抛 401', async () => {
    const hash = await bcrypt.hash('pass123456', 4);
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ ...userRow, passwordHash: hash });
    (prisma.user.update as jest.Mock).mockResolvedValue(userRow);
    const ok = await auth.login('alice', 'pass123456');
    expect(ok.accessToken).toBe('signed-token');

    (prisma.user.update as jest.Mock).mockClear();
    await expect(auth.login('alice', 'wrongpass')).rejects.toThrow(UnauthorizedException);
  });

  it('refresh：哈希匹配则轮换新 token，不匹配抛 401', async () => {
    (prisma.user.findFirst as jest.Mock).mockResolvedValue(userRow);
    (prisma.user.update as jest.Mock).mockResolvedValue(userRow);
    const r = await auth.refresh('some-token');
    expect(r.accessToken).toBe('signed-token');
    expect(r.refreshToken).not.toBe('some-token');

    (prisma.user.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(auth.refresh('stale-token')).rejects.toThrow(UnauthorizedException);
  });

  it('initCharacter：仅首次创建三围，重复调用不覆盖', async () => {
    // 首次：无角色 → 创建
    (prisma.userCharacter.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.userCharacter.create as jest.Mock).mockResolvedValue({});
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      ...userRow,
      character: { level: 1, hpLv: 2, atkLv: 3, defLv: 1 },
    });
    const u = await auth.initCharacter(1, 2, 3, 1);
    expect(prisma.userCharacter.create).toHaveBeenCalled();
    expect(u.character?.hpLv).toBe(2);
    expect(u.character?.atkLv).toBe(3);

    // 二次：已有角色 → 不覆盖
    (prisma.userCharacter.create as jest.Mock).mockClear();
    (prisma.userCharacter.findUnique as jest.Mock).mockResolvedValue({ id: 1 });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      ...userRow,
      character: { level: 5, hpLv: 5, atkLv: 5, defLv: 5 },
    });
    const again = await auth.initCharacter(1, 1, 1, 1);
    expect(prisma.userCharacter.create).not.toHaveBeenCalled();
    expect(again.character?.hpLv).toBe(5);
  });

  it('login：连续失败触发限流 429', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    for (let i = 0; i < 11; i++) {
      try {
        await auth.login('mallory', 'badpass');
      } catch {
        /* 前 10 次 401，第 11 次起 429 */
      }
    }
    await expect(auth.login('mallory', 'badpass')).rejects.toThrow('尝试次数过多');
  });
});