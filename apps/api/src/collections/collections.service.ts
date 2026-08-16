import { Injectable, NotFoundException } from '@nestjs/common';
import type { CollectedWord, CollectionStats, ConfusableInfo, DifficultyTier, SrsTrajectory } from '@word-journey/shared';
import { intervalDays } from '@word-journey/shared';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CollectionsService {
  constructor(private readonly prisma: PrismaService) {}

  async listWords(
    userId: number,
    opts: {
      tier?: string;
      status?: 'new' | 'learning' | 'mastered' | 'wrongbook' | 'skipped' | 'due';
      sort?: string;
      search?: string;
      page?: number;
      pageSize?: number;
    },
  ): Promise<{ words: CollectedWord[]; total: number; page: number; pageSize: number }> {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(100, Math.max(10, opts.pageSize ?? 50));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = { userId };

    if (opts.tier) {
      where.word = { tier: opts.tier };
    }
    switch (opts.status) {
      case 'wrongbook':
        where.inWrongBook = true;
        break;
      case 'skipped':
        where.skipped = true;
        break;
      case 'mastered':
        // 已掌握不含已斩（斩=永久不再考，与掌握区分展示）
        where.mastery = 100;
        where.skipped = false;
        break;
      case 'learning':
        // 与 stats.learning 同口径：学习中 = 已遇未掌握 且 不在错题本 且 未斩
        where.mastery = { gt: 0, lt: 100 };
        where.inWrongBook = false;
        where.skipped = false;
        break;
      case 'due':
        // 待复习：已到期 且 未掌握 且 未斩（行动导向）
        where.nextReviewAt = { lte: new Date() };
        where.mastery = { lt: 100 };
        where.skipped = false;
        break;
      case 'new':
        // "新遇" = 今日首次遇到的单词（结算后 mastery 恒 > 0，原 mastery=0 永远为空）
        where.firstEncounteredAt = { gte: startOfToday() };
        break;
    }
    if (opts.search) {
      // 双语搜索：英文词形 或 中文释义
      where.word = {
        ...(where.word ?? {}),
        OR: [
          { text: { contains: opts.search } },
          { senses: { some: { meaning: { contains: opts.search } } } },
        ],
      };
    }

    // 排序（MySQL 无 NULLS LAST：due 排序仅在与 due 筛选组合时使用，此时 nextReviewAt 恒非空）
    let orderBy: Record<string, unknown> | Record<string, unknown>[];
    if (opts.status === 'due' && opts.sort !== 'stage') {
      orderBy = [{ nextReviewAt: 'asc' }, { wordId: 'asc' }];
    } else {
      switch (opts.sort) {
        case 'stage':
          orderBy = [{ reviewStage: 'desc' }, { firstEncounteredAt: 'desc' }];
          break;
        case 'due':
          orderBy = [{ nextReviewAt: 'asc' }, { wordId: 'asc' }];
          break;
        default:
          orderBy = [{ firstEncounteredAt: 'desc' }, { wordId: 'asc' }];
      }
    }

    const [rows, total] = await Promise.all([
      this.prisma.userWordProgress.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          word: {
            include: {
              senses: { orderBy: { idx: 'asc' }, take: 3 },
              bankWords: { take: 1, include: { bank: { select: { code: true } } } },
            },
          },
        },
      }),
      this.prisma.userWordProgress.count({ where }),
    ]);

    // 页内单词的易混对（word_pairs 双向引用）批量查询
    const ids = rows.map((r) => r.word.id);
    const [asA, asB] = await Promise.all([
      this.prisma.wordPair.findMany({
        where: { wordAId: { in: ids } },
        include: { wordB: { select: { text: true } } },
      }),
      this.prisma.wordPair.findMany({
        where: { wordBId: { in: ids } },
        include: { wordA: { select: { text: true } } },
      }),
    ]);
    const confusablesById = new Map<string, ConfusableInfo[]>();
    for (const p of asA) {
      const list = confusablesById.get(p.wordAId) ?? [];
      list.push({ counterpart: p.wordB.text, type: p.type as ConfusableInfo['type'], note: p.note });
      confusablesById.set(p.wordAId, list);
    }
    for (const p of asB) {
      const list = confusablesById.get(p.wordBId) ?? [];
      list.push({ counterpart: p.wordA.text, type: p.type as ConfusableInfo['type'], note: p.note });
      confusablesById.set(p.wordBId, list);
    }

    const words: CollectedWord[] = rows.map((r) => ({
      wordId: r.word.id,
      text: r.word.text,
      phonetic: r.word.phoneticAm ?? r.word.phoneticEn ?? undefined,
      tier: r.word.tier as DifficultyTier,
      firstEncounteredAt: r.firstEncounteredAt?.toISOString() ?? null,
      reviewStage: r.reviewStage,
      ease: r.ease,
      nextReviewAt: r.nextReviewAt?.toISOString() ?? null,
      mastery: r.mastery,
      inWrongBook: r.inWrongBook,
      skipped: r.skipped,
      meanings: r.word.senses.map((s) => ({ meaning: s.meaning, example: s.example })),
      examples: Array.from(new Set(r.word.senses.map((s) => s.example).filter(Boolean))),
      confusables: confusablesById.get(r.word.id) ?? [],
      mnemonic: r.word.mnemonic ?? undefined,
      bankCode: r.word.bankWords[0]?.bank.code ?? undefined,
    }));

    return { words, total, page, pageSize };
  }

  async srsTrajectory(userId: number, wordId: string): Promise<SrsTrajectory> {
    const [word, progress] = await Promise.all([
      this.prisma.word.findUnique({
        where: { id: wordId },
        include: { senses: { orderBy: { idx: 'asc' } } },
      }),
      this.prisma.userWordProgress.findUnique({
        where: { userId_wordId: { userId, wordId } },
      }),
    ]);
    if (!word) throw new NotFoundException('单词不存在');
    if (!progress) throw new NotFoundException('尚未相遇该单词');

    const [asA, asB] = await Promise.all([
      this.prisma.wordPair.findMany({
        where: { wordAId: wordId },
        include: { wordB: { select: { text: true } } },
      }),
      this.prisma.wordPair.findMany({
        where: { wordBId: wordId },
        include: { wordA: { select: { text: true } } },
      }),
    ]);
    const confusables: ConfusableInfo[] = [
      ...asA.map((p) => ({ counterpart: p.wordB.text, type: p.type as ConfusableInfo['type'], note: p.note })),
      ...asB.map((p) => ({ counterpart: p.wordA.text, type: p.type as ConfusableInfo['type'], note: p.note })),
    ];

    const rawPoints = Array.isArray(progress.srsHistory)
      ? (progress.srsHistory as { stage?: number; at?: string }[]).filter(
          (e) => e && typeof e === 'object' && typeof e.stage === 'number' && typeof e.at === 'string',
        )
      : [];
    const points = rawPoints.map((p) => ({
      stage: p.stage as number,
      intervalDays: intervalDays(p.stage as number),
      at: p.at as string,
    }));
    const lastPoint = points[points.length - 1];

    return {
      current: {
        stage: progress.reviewStage,
        ease: progress.ease,
        mastery: progress.mastery,
        nextReviewAt: progress.nextReviewAt?.toISOString() ?? null,
        inWrongBook: progress.inWrongBook,
        skipped: progress.skipped,
      },
      points,
      lastReviewedAt: lastPoint?.at ?? null,
      word: {
        text: word.text,
        phonetic: word.phoneticAm ?? word.phoneticEn ?? undefined,
        tier: word.tier as DifficultyTier,
        meanings: word.senses.map((s) => ({ meaning: s.meaning, example: s.example })),
        examples: Array.from(new Set(word.senses.map((s) => s.example).filter(Boolean))),
        confusables,
        mnemonic: word.mnemonic ?? undefined,
      },
    };
  }

  async stats(userId: number): Promise<CollectionStats> {
    const now = new Date();
    const [tierTotals, progress] = await Promise.all([
      // 全词库按 tier 聚合（避免每次全表拉取所有词）
      this.prisma.word.groupBy({ by: ['tier'], _count: { _all: true } }),
      this.prisma.userWordProgress.findMany({
        where: { userId },
        select: {
          wordId: true,
          mastery: true,
          firstEncounteredAt: true,
          inWrongBook: true,
          skipped: true,
          nextReviewAt: true,
        },
      }),
    ]);
    const totalByTier = new Map<string, number>();
    for (const g of tierTotals) totalByTier.set(g.tier, g._count._all);

    const mastered = new Set(progress.filter((p) => p.mastery >= 100 && !p.skipped).map((p) => p.wordId));
    const encountered = new Set(progress.map((p) => p.wordId));
    const wrongbook = new Set(progress.filter((p) => p.inWrongBook).map((p) => p.wordId));
    const skipped = new Set(progress.filter((p) => p.skipped).map((p) => p.wordId));
    // 与列表 learning 过滤同口径
    const learning = progress.filter((p) => p.mastery < 100 && !p.inWrongBook && !p.skipped).length;
    const dueToday = progress.filter(
      (p) => !p.skipped && p.mastery < 100 && p.nextReviewAt != null && p.nextReviewAt.getTime() <= now.getTime(),
    ).length;
    const newToday = progress.filter(
      (p) => p.firstEncounteredAt != null && p.firstEncounteredAt.getTime() >= startOfToday().getTime(),
    ).length;

    // 已遇词的 tier 分布：仅查用户进度覆盖的词，避免全词库扫描
    const encounteredTier = new Map<string, number>();
    if (encountered.size > 0) {
      const rows = await this.prisma.word.findMany({
        where: { id: { in: [...encountered] } },
        select: { id: true, tier: true },
      });
      for (const w of rows) {
        if (encountered.has(w.id)) encounteredTier.set(w.tier, (encounteredTier.get(w.tier) ?? 0) + 1);
      }
    }

    const tiers: DifficultyTier[] = ['I', 'II', 'III', 'IV'];
    const byTier = tiers.map((tier) => ({
      tier,
      total: totalByTier.get(tier) ?? 0,
      encountered: encounteredTier.get(tier) ?? 0,
    }));

    return {
      totalWords: tiers.reduce((sum, t) => sum + (totalByTier.get(t) ?? 0), 0),
      encountered: encountered.size,
      mastered: mastered.size,
      learning,
      wrongbook: wrongbook.size,
      skipped: skipped.size,
      newToday,
      dueToday,
      byTier,
    };
  }
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
