import { Injectable, NotFoundException } from '@nestjs/common';
import type { CollectedWord, CollectionStats, ConfusableInfo, DifficultyTier, SrsTrajectory } from '@word-journey/shared';
import { intervalDays } from '@word-journey/shared';
import { PrismaService } from '../prisma/prisma.service';

type StatusFilter = 'new' | 'learning' | 'mastered' | 'wrongbook' | 'skipped' | 'due' | 'weak' | 'vocabbook';

@Injectable()
export class CollectionsService {
  constructor(private readonly prisma: PrismaService) {}

  async listWords(
    userId: number,
    opts: {
      tier?: string;
      status?: StatusFilter;
      sort?: string;
      search?: string;
      page?: number;
      pageSize?: number;
    },
  ): Promise<{ words: CollectedWord[]; total: number; page: number; pageSize: number }> {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(100, Math.max(10, opts.pageSize ?? 50));

    const where = this.buildWhere(userId, opts);
    const orderBy = this.buildOrderBy(opts.status, opts.sort);

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

    const confusablesById = await this.loadConfusables(rows.map((r) => r.word.id));

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
      inVocabBook: r.inVocabBook,
      skipped: r.skipped,
      wrongCount: r.wrongCount,
      masteredAt: r.masteredAt?.toISOString() ?? null,
      meanings: r.word.senses.map((s) => ({ meaning: s.meaning, example: s.example })),
      examples: Array.from(new Set(r.word.senses.map((s) => s.example).filter(Boolean))),
      confusables: confusablesById.get(r.word.id) ?? [],
      mnemonic: r.word.mnemonic ?? undefined,
      bankCode: r.word.bankWords[0]?.bank.code ?? undefined,
    }));

    return { words, total, page, pageSize };
  }

  // 全量弱词复习：仅返回匹配词 id（无分页/无重负载），供图鉴 CTA 一次拉全量后跳复习战
  async listWordIds(
    userId: number,
    opts: { status?: StatusFilter; limit?: number },
  ): Promise<{ wordIds: string[]; bankCode?: string }> {
    const where = this.buildWhere(userId, opts);
    const orderBy = this.buildOrderBy(opts.status, opts.status === 'due' ? 'due' : 'firstEncounteredAt');
    const limit = Math.min(60, Math.max(1, opts.limit ?? 60));
    const rows = await this.prisma.userWordProgress.findMany({
      where,
      orderBy,
      take: limit,
      select: {
        wordId: true,
        word: { select: { bankWords: { take: 1, select: { bank: { select: { code: true } } } } } },
      },
    });
    return {
      wordIds: rows.map((r) => r.wordId),
      bankCode: rows[0]?.word.bankWords[0]?.bank.code ?? undefined,
    };
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

    const confusables = await this.loadConfusables([wordId]);
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
        masteredAt: progress.masteredAt?.toISOString() ?? null,
      },
      points,
      lastReviewedAt: lastPoint?.at ?? null,
      word: {
        text: word.text,
        phonetic: word.phoneticAm ?? word.phoneticEn ?? undefined,
        tier: word.tier as DifficultyTier,
        meanings: word.senses.map((s) => ({ meaning: s.meaning, example: s.example })),
        examples: Array.from(new Set(word.senses.map((s) => s.example).filter(Boolean))),
        confusables: confusables.get(wordId) ?? [],
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
          inVocabBook: true,
          skipped: true,
          nextReviewAt: true,
          wrongCount: true,
          masteredAt: true,
          reviewStage: true,
          word: { select: { tier: true } },
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
    const weak = progress.filter((p) => p.wrongCount >= 3 && p.mastery < 100 && !p.skipped).length;
    const vocabbook = progress.filter((p) => p.inVocabBook).length;
    const newToday = progress.filter(
      (p) => p.firstEncounteredAt != null && p.firstEncounteredAt.getTime() >= startOfToday().getTime(),
    ).length;
    const masteredToday = progress.filter(
      (p) => p.masteredAt != null && p.masteredAt.getTime() >= startOfToday().getTime(),
    ).length;

    // 记忆深度分布（0~5+，排除已斩词以聚焦学习进度）
    const stageHistogram = [0, 1, 2, 3, 4, 5].map((stage) => ({ stage, count: 0 }));
    for (const p of progress) {
      if (p.skipped) continue;
      const bucket = Math.min(5, Math.max(0, p.reviewStage));
      stageHistogram[bucket]!.count += 1;
    }

    // 已遇词的 tier 分布：直接取自 progress 的 word.tier（关系 include，避免二次全表扫描）
    const encounteredTier = new Map<string, number>();
    for (const p of progress) {
      const tier = p.word.tier;
      encounteredTier.set(tier, (encounteredTier.get(tier) ?? 0) + 1);
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
      weak,
      vocabbook,
      masteredToday,
      stageHistogram,
      byTier,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private buildWhere(userId: number, opts: { tier?: string; status?: StatusFilter; search?: string }): any {
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
        where.mastery = 100;
        where.skipped = false;
        break;
      case 'learning':
        where.mastery = { gt: 0, lt: 100 };
        where.inWrongBook = false;
        where.skipped = false;
        break;
      case 'due':
        where.nextReviewAt = { lte: new Date() };
        where.mastery = { lt: 100 };
        where.skipped = false;
        break;
      case 'weak':
        where.wrongCount = { gte: 3 };
        where.mastery = { lt: 100 };
        where.skipped = false;
        break;
      case 'vocabbook':
        where.inVocabBook = true;
        break;
      case 'new':
        where.firstEncounteredAt = { gte: startOfToday() };
        break;
    }
    if (opts.search) {
      where.word = {
        ...(where.word ?? {}),
        OR: [
          { text: { contains: opts.search } },
          { senses: { some: { meaning: { contains: opts.search } } } },
        ],
      };
    }
    return where;
  }

  private buildOrderBy(status: StatusFilter | undefined, sort: string | undefined): Record<string, unknown> | Record<string, unknown>[] {
    if (status === 'due' && sort !== 'stage' && sort !== 'weakest') {
      return [{ nextReviewAt: 'asc' }, { wordId: 'asc' }];
    }
    switch (sort) {
      case 'stage':
        return [{ reviewStage: 'desc' }, { firstEncounteredAt: 'desc' }];
      case 'weakest':
        return [{ wrongCount: 'desc' }, { firstEncounteredAt: 'desc' }];
      case 'due':
        return [{ nextReviewAt: 'asc' }, { wordId: 'asc' }];
      default:
        return [{ firstEncounteredAt: 'desc' }, { wordId: 'asc' }];
    }
  }

  private async loadConfusables(wordIds: string[]): Promise<Map<string, ConfusableInfo[]>> {
    if (wordIds.length === 0) return new Map();
    const [asA, asB] = await Promise.all([
      this.prisma.wordPair.findMany({
        where: { wordAId: { in: wordIds } },
        include: { wordB: { select: { text: true, id: true } } },
      }),
      this.prisma.wordPair.findMany({
        where: { wordBId: { in: wordIds } },
        include: { wordA: { select: { text: true, id: true } } },
      }),
    ]);
    const map = new Map<string, ConfusableInfo[]>();
    for (const p of asA) {
      const list = map.get(p.wordAId) ?? [];
      list.push({ counterpart: p.wordB.text, type: p.type as ConfusableInfo['type'], note: p.note, wordId: p.wordB.id });
      map.set(p.wordAId, list);
    }
    for (const p of asB) {
      const list = map.get(p.wordBId) ?? [];
      list.push({ counterpart: p.wordA.text, type: p.type as ConfusableInfo['type'], note: p.note, wordId: p.wordA.id });
      map.set(p.wordBId, list);
    }
    return map;
  }
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
