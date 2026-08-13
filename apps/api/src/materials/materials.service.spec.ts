import { BadRequestException, ConflictException } from '@nestjs/common';
import { MaterialsService } from './materials.service';
import { PrismaService } from '../prisma/prisma.service';

const prisma = {
  userMaterial: {
    findMany: jest.fn(),
    upsert: jest.fn(),
    updateMany: jest.fn(),
  },
  material: {
    findUnique: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
    updateMany: jest.fn(),
  },
  $transaction: jest.fn(),
} as unknown as PrismaService;

describe('MaterialsService 合成', () => {
  let svc: MaterialsService;
  beforeEach(() => {
    jest.clearAllMocks();
    svc = new MaterialsService(prisma);
  });

  it('fromTier 越界抛 400', async () => {
    await expect(svc.synthesize(1, 4 as never)).rejects.toThrow(BadRequestException);
    await expect(svc.synthesize(1, 0 as never)).rejects.toThrow(BadRequestException);
  });

  it('来源材料不足抛 409（乐观锁语义）', async () => {
    (prisma.userMaterial.findMany as jest.Mock).mockResolvedValue([
      { materialId: 1, count: 2, material: { id: 1, code: 'essence_1', tier: 1 } },
    ]);
    await expect(svc.synthesize(1, 1)).rejects.toThrow(ConflictException);
  });

  it('成功：3×tier1 精华 → 1×tier2，扣 20 金币，返回余额快照', async () => {
    (prisma.userMaterial.findMany as jest.Mock)
      .mockResolvedValueOnce([
        { materialId: 1, count: 5, material: { id: 1, code: 'essence_1', tier: 1 } },
      ])
      .mockResolvedValueOnce([
        { materialId: 1, count: 2, material: { id: 1, code: 'essence_1', tier: 1 } },
        { materialId: 2, count: 1, material: { id: 2, code: 'essence_2', tier: 2 } },
      ]);
    (prisma.material.findUnique as jest.Mock).mockResolvedValue({
      id: 2,
      code: 'essence_2',
      tier: 2,
    });
    (prisma.$transaction as jest.Mock).mockImplementation(async (fn) => {
      const coinUpdate = jest.fn().mockResolvedValue({ count: 1 });
      await fn({
        userMaterial: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          upsert: jest.fn().mockResolvedValue({}),
        },
        user: {
          updateMany: coinUpdate,
        },
      });
      // 手续费 20·1=20：updateMany 以 coins>=20 守卫
      expect(coinUpdate.mock.calls[0]?.[0].where.coins.gte).toBe(20);
    });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 1, coins: 180 });

    const r = await svc.synthesize(1, 1);
    expect(r.fromTier).toBe(1);
    expect(r.toTier).toBe(2);
    expect(r.coins).toBe(180);
    expect(r.materials).toHaveLength(2);
    expect(r.materials.find((m) => m.code === 'essence_2')?.count).toBe(1);
  });

  it('事务内扣减 count<3 时回滚抛 409（并发防双消耗）', async () => {
    (prisma.userMaterial.findMany as jest.Mock).mockResolvedValue([
      { materialId: 1, count: 5, material: { id: 1, code: 'essence_1', tier: 1 } },
    ]);
    (prisma.material.findUnique as jest.Mock).mockResolvedValue({
      id: 2,
      code: 'essence_2',
      tier: 2,
    });
    (prisma.$transaction as jest.Mock).mockImplementation(async (fn) =>
      fn({
        userMaterial: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        user: { updateMany: jest.fn() },
      }),
    );
    await expect(svc.synthesize(1, 1)).rejects.toThrow(ConflictException);
  });

  it('金币不足抛 409', async () => {
    (prisma.userMaterial.findMany as jest.Mock).mockResolvedValue([
      { materialId: 1, count: 5, material: { id: 1, code: 'essence_1', tier: 1 } },
    ]);
    (prisma.material.findUnique as jest.Mock).mockResolvedValue({
      id: 2,
      code: 'essence_2',
      tier: 2,
    });
    (prisma.$transaction as jest.Mock).mockImplementation(async (fn) =>
      fn({
        userMaterial: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          upsert: jest.fn().mockResolvedValue({}),
        },
        user: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      }),
    );
    await expect(svc.synthesize(1, 1)).rejects.toThrow(ConflictException);
  });

  it('holdings：仅返回 count>0 的持有，按 tier/code 排序', async () => {
    (prisma.userMaterial.findMany as jest.Mock).mockResolvedValue([
      { count: 3, material: { code: 'essence_2', tier: 2, name: '稀有精华' } },
      { count: 5, material: { code: 'essence_1', tier: 1, name: '普通精华' } },
    ]);
    const h = await svc.holdings(7);
    expect(prisma.userMaterial.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 7, count: { gt: 0 } } }),
    );
    expect(h).toEqual([
      { code: 'essence_2', tier: 2, name: '稀有精华', count: 3 },
      { code: 'essence_1', tier: 1, name: '普通精华', count: 5 },
    ]);
  });

  it('holdings：无持有返回空数组', async () => {
    (prisma.userMaterial.findMany as jest.Mock).mockResolvedValue([]);
    await expect(svc.holdings(7)).resolves.toEqual([]);
  });
});
