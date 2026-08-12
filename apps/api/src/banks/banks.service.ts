// 词书与阶段：大厅列表 + 阶段地图（tier / 关卡 / 解锁状态 / 最佳评级）
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
    const allWordIds = [...new Set(banks.flatMap((b) => b.bankWords.map((bw) => bw.wordId)))];
    const progress = await this.prisma.userWordProgress.findMany({
      where: { userId, wordId: { in: allWordIds } },
      select: { wordId: true, mastery: true, nextReviewAt: true },
    });
    const masteredByBank = new Map<number, number>();
    const dueByBank = new Map<number, number>();
    const progressByWord = new Map<string, { mastery: number; nextReviewAt: Date | null }>();
    for (const p of progress) {
      const bid = bankOfWord.get(p.wordId);
      progressByWord.set(p.wordId, p);
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

    return banks.map((b) => {
      const stageIds = [...new Set(b.bankWords.map((bw) => bw.stage))].sort((x, y) => x - y);
      // 每个阶段：wordId 集合 + 已遇词计数
      const wordsByStage = new Map<number, Set<string>>();
      for (const bw of b.bankWords) {
        const set = wordsByStage.get(bw.stage) ?? new Set<string>();
        set.add(bw.wordId);
        wordsByStage.set(bw.stage, set);
      }
      let unlocked = 0;
      for (let i = 0; i < stageIds.length; i++) {
        if (i > 0) {
          const prevWords = wordsByStage.get(stageIds[i - 1] as number);
          if (prevWords && prevWords.size > 0) {
            let prevEncountered = 0;
            for (const wid of prevWords) {
              if (bankOfWord.get(wid) === b.id) {
                const p = progressByWord.get(wid);
                if (p) prevEncountered++;
              }
            }
            // 前一阶段已遇 ≥ 80% 才解锁本阶段
            if (prevEncountered / prevWords.size < 0.8) break;
          }
        }
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

  // 阶段地图：连续进度制（阶段=词池，进度条替代关节点）
  async stages(userId: number, bankCode: string): Promise<StageInfo[]> {
    const bank = await this.prisma.wordBank.findUnique({
      where: { code: bankCode },
      include: { bankWords: true },
    });
    if (!bank) throw new NotFoundException(`词书不存在: ${bankCode}`);

    const sessions = await this.prisma.learningSession.findMany({
      where: { userId, bankId: bank.id, result: true },
      select: { stageId: true, rating: true },
    });

    // 阶段 → 最佳评级
    const bestByStage = new Map<number, Rating>();
    const order: Rating[] = ['C', 'B', 'A', 'S', 'SS', 'SSS'];
    for (const s of sessions) {
      const cur = bestByStage.get(s.stageId);
      if (!cur || order.indexOf(s.rating as Rating) > order.indexOf(cur)) {
        bestByStage.set(s.stageId, s.rating as Rating);
      }
    }

    // 用户已遇词（per stage）
    const progress = await this.prisma.userWordProgress.findMany({
      where: { userId, wordId: { in: bank.bankWords.map((bw) => bw.wordId) } },
      select: { wordId: true, mastery: true },
    });
    const wordMastery = new Map(progress.map((p) => [p.wordId, p.mastery]));

    const byStage = new Map<number, { total: number; words: string[] }>();
    for (const bw of bank.bankWords) {
      const entry = byStage.get(bw.stage) ?? { total: 0, words: [] };
      entry.total++;
      entry.words.push(bw.wordId);
      byStage.set(bw.stage, entry);
    }
    const stageIds = [...byStage.keys()].sort((a, b) => a - b);

    return stageIds.map((stageId, i) => {
      const entry = byStage.get(stageId)!;
      const encountered = entry.words.filter((wid) => wordMastery.has(wid)).length;
      const mastered = entry.words.filter((wid) => (wordMastery.get(wid) ?? 0) >= 100).length;
      const progressPct = entry.total > 0 ? Math.round((encountered / entry.total) * 100) : 0;

      // 解锁链：前一阶段已遇 ≥ 80% 解锁本阶段
      const stageUnlocked =
        i === 0 || (() => {
          const prev = byStage.get(stageIds[i - 1] as number);
          if (!prev) return false;
          const prevEncountered = prev.words.filter((wid) => wordMastery.has(wid)).length;
          return prev.total > 0 && prevEncountered / prev.total >= 0.8;
        })();

      const status: 'locked' | 'available' | 'cleared' = stageUnlocked
        ? progressPct >= 80 ? 'cleared' : 'available'
        : 'locked';

      return {
        id: stageId,
        tier: tierOf(stageId),
        wordCount: entry.total,
        status,
        bestRating: bestByStage.get(stageId),
        encountered,
        mastered,
        progress: progressPct,
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