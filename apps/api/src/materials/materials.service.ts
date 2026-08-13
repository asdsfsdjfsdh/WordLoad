// 材料服务：合成（3×tierN → 1×tier(N+1)），事务 + 乐观锁防并发重复消耗
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import type { MaterialHolding, SynthesizeResult } from '@word-journey/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// 合成手续费：20·N 金币（N = 来源 tier）
const FEE_PER_TIER = 20;
const SOURCE_COUNT = 3;
const MAX_TIER = 4;

@Injectable()
export class MaterialsService {
  constructor(private readonly prisma: PrismaService) {}

  // 用户持有材料（count>0，按 tier/code 排序），供强化/合成面板展示
  async holdings(userId: number): Promise<MaterialHolding[]> {
    const rows = await this.prisma.userMaterial.findMany({
      where: { userId, count: { gt: 0 } },
      include: { material: true },
      orderBy: [{ material: { tier: 'asc' } }, { material: { code: 'asc' } }],
    });
    return rows.map((m) => ({
      code: m.material.code,
      tier: m.material.tier,
      name: m.material.name,
      count: m.count,
    }));
  }

  async synthesize(
    userId: number,
    fromTier: 1 | 2 | 3,
  ): Promise<SynthesizeResult> {
    if (fromTier < 1 || fromTier >= MAX_TIER) {
      throw new BadRequestException('fromTier 仅支持 1/2/3');
    }
    const toTier = fromTier + 1;

    // 找出用户在该 tier 持有 ≥3 的来源材料（按 materialId 序取其一）
    const holdings = await this.prisma.userMaterial.findMany({
      where: { userId, count: { gte: SOURCE_COUNT } },
      include: { material: true },
    });
    const source = holdings
      .filter((h) => h.material.tier === fromTier)
      .sort((a, b) => a.materialId - b.materialId)[0];
    if (!source) {
      throw new ConflictException(`材料不足：至少需要 3× tier${fromTier} 材料`);
    }

    // 同族（code 前缀如 essence）高一档目标材料
    const family = source.material.code.replace(/_\d+$/, '');
    const targetCode = `${family}_${toTier}`;
    const target = await this.prisma.material.findUnique({
      where: { code: targetCode },
    });
    if (!target) {
      throw new ConflictException(`tier${toTier} 目标材料不存在（${targetCode}）`);
    }

    const fee = FEE_PER_TIER * fromTier;

    // 事务 + 乐观锁：材料扣减（count≥3 才更新）与金币扣减（coins≥fee 才更新）任一失败整体回滚
    try {
      await this.prisma.$transaction(async (tx) => {
        const mat = await tx.userMaterial.updateMany({
          where: { userId, materialId: source.materialId, count: { gte: SOURCE_COUNT } },
          data: { count: { decrement: SOURCE_COUNT } },
        });
        if (mat.count === 0) {
          throw new ConflictException('材料不足（并发已消耗）');
        }
        await tx.userMaterial.upsert({
          where: { userId_materialId: { userId, materialId: target.id } },
          update: { count: { increment: 1 } },
          create: { userId, materialId: target.id, count: 1 },
        });
        const coin = await tx.user.updateMany({
          where: { id: userId, coins: { gte: fee } },
          data: { coins: { decrement: fee } },
        });
        if (coin.count === 0) {
          throw new ConflictException('金币不足');
        }
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) throw err;
      throw err;
    }

    return this.snapshot(userId, fromTier, toTier);
  }

  private async snapshot(
    userId: number,
    fromTier: number,
    toTier: number,
  ): Promise<SynthesizeResult> {
    const [user, materials] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.userMaterial.findMany({
        where: { userId, material: { tier: { in: [fromTier, toTier] } } },
        include: { material: true },
      }),
    ]);
    return {
      fromTier,
      toTier,
      materials: materials.map((m) => ({
        code: m.material.code,
        tier: m.material.tier,
        count: m.count,
      })),
      coins: user?.coins ?? 0,
    };
  }
}
