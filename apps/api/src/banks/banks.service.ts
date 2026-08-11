// 词书与阶段：大厅列表 + 阶段地图（tier / 词数 / 解锁状态 / 最佳评级）
import { Injectable, NotFoundException } from '@nestjs/common';
import type { Bank, DifficultyTier, Rating, StageInfo } from '@word-journey/shared';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BanksService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: number): Promise<Bank[]> {
    const banks = await this.prisma.wordBank.findMany({
      include: { bankWords: true },
      orderBy: { id: 'asc' },
    });

    // wordId → 所属词书（per-book 统计用）
    const bankOfWord = new Map<string, number>();
    for (const b of banks) {
      for (const bw of b.bankWords) bankOfWord.set(bw.wordId, b.id);
    }

    // 掌握/待复习：按词书聚合（词→词书 归属映射）
    const progress = await this.prisma.userWordProgress.findMany({
      where: { userId },
      select: { wordId: true, mastery: true, nextReviewAt: true },
    });
    const masteredByBank = new Map<number, number>();
    const dueByBank = new Map<number, number>();
    for (const p of progress) {
      const bid = bankOfWord.get(p.wordId);
      if (bid === undefined) continue;
      if (p.mastery >= 100) masteredByBank.set(bid, (masteredByBank.get(bid) ?? 0) + 1);
      if (p.nextReviewAt && p.nextReviewAt.getTime() <= Date.now())
        dueByBank.set(bid, (dueByBank.get(bid) ?? 0) + 1);
    }

    // 今日已学：按词书聚合（会话逐题计数）
    const sessionsToday = await this.prisma.learningSession.findMany({
      where: { userId, createdAt: { gte: startOfDay() } },
      select: { bankId: true, _count: { select: { items: true } } },
    });
    const learnedByBank = new Map<number, number>();
    for (const s of sessionsToday) {
      learnedByBank.set(s.bankId, (learnedByBank.get(s.bankId) ?? 0) + s._count.items);
    }

    // 每个词书：已结算过的 stage 集合（用于解锁链）
    const clearedByBank = new Map<number, Set<number>>();
    const sessions = await this.prisma.learningSession.findMany({
      where: { userId },
      select: { bankId: true, stageId: true },
    });
    for (const s of sessions) {
      const set = clearedByBank.get(s.bankId) ?? new Set<number>();
      set.add(s.stageId);
      clearedByBank.set(s.bankId, set);
    }

    return banks.map((b) => {
      const stageIds = [...new Set(b.bankWords.map((bw) => bw.stage))].sort((x, y) => x - y);
      const cleared = clearedByBank.get(b.id) ?? new Set<number>();
      let unlocked = 0;
      for (let i = 0; i < stageIds.length; i++) {
        if (i > 0 && !cleared.has(stageIds[i - 1] as number)) break;
        unlocked++;
      }
      return {
        id: String(b.id),
        code: b.code,
        name: b.name,
        totalWords: b.bankWords.length,
        masteredWords: masteredByBank.get(b.id) ?? 0,
        dueReviews: dueByBank.get(b.id) ?? 0,
        learnedToday: learnedByBank.get(b.id) ?? 0,
        unlockedStages: Math.max(1, unlocked),
        totalStages: stageIds.length,
      };
    });
  }

  // 阶段地图：每阶段 词数 / 解锁状态 / 最佳评级
  async stages(userId: number, bankCode: string): Promise<StageInfo[]> {
    const bank = await this.prisma.wordBank.findUnique({
      where: { code: bankCode },
      include: { bankWords: true },
    });
    if (!bank) throw new NotFoundException(`词书不存在: ${bankCode}`);

    const sessions = await this.prisma.learningSession.findMany({
      where: { userId, bankId: bank.id },
      select: { stageId: true, rating: true },
    });
    const bestByStage = new Map<number, Rating>();
    const order: Rating[] = ['C', 'B', 'A', 'S', 'SS', 'SSS'];
    for (const s of sessions) {
      const cur = bestByStage.get(s.stageId);
      if (!cur || order.indexOf(s.rating as Rating) > order.indexOf(cur)) {
        bestByStage.set(s.stageId, s.rating as Rating);
      }
    }

    const byStage = new Map<number, number>();
    for (const bw of bank.bankWords) {
      byStage.set(bw.stage, (byStage.get(bw.stage) ?? 0) + 1);
    }
    const stageIds = [...byStage.keys()].sort((a, b) => a - b);

    return stageIds.map((stageId, i) => {
      const best = bestByStage.get(stageId);
      const prevCleared = i === 0 || bestByStage.has(stageIds[i - 1] as number);
      const cleared = bestByStage.has(stageId);
      return {
        id: stageId,
        tier: tierOf(stageId),
        wordCount: byStage.get(stageId) ?? 0,
        status: cleared ? 'cleared' : prevCleared ? 'available' : 'locked',
        bestRating: best,
      };
    });
  }
}

function startOfDay(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// 阶段 1~4 对应 tier Ⅰ~Ⅳ
function tierOf(stage: number): DifficultyTier {
  if (stage <= 1) return 'I';
  if (stage === 2) return 'II';
  if (stage === 3) return 'III';
  return 'IV';
}