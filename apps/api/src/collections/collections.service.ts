import { Injectable, NotFoundException } from '@nestjs/common';
import type { CollectedWord, CollectionStats, ConfusableInfo, EncounterRecord } from '@word-journey/shared';
import type { DifficultyTier } from '@word-journey/shared';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CollectionsService {
  constructor(private readonly prisma: PrismaService) {}

  async listWords(
    userId: number,
    opts: {
      tier?: string;
      status?: 'new' | 'learning' | 'mastered' | 'wrongbook';
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
    if (opts.status === 'wrongbook') {
      where.inWrongBook = true;
    } else if (opts.status === 'mastered') {
      where.mastery = 100;
    } else if (opts.status === 'learning') {
      where.mastery = { gt: 0, lt: 100 };
    } else if (opts.status === 'new') {
      where.mastery = 0;
    }
    if (opts.search) {
      where.word = { ...(where.word ?? {}), text: { contains: opts.search } };
    }

    let orderBy = {};
    switch (opts.sort) {
      case 'firstEncounteredAt': orderBy = { firstEncounteredAt: 'desc' }; break;
      case 'lastEncounteredAt': orderBy = { lastEncounteredAt: 'desc' }; break;
      case 'encounterCount': orderBy = { correctCount: 'desc' }; break;
      default: orderBy = { firstEncounteredAt: 'desc' };
    }

    const [rows, total] = await Promise.all([
      this.prisma.userWordProgress.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          word: { include: { senses: { orderBy: { idx: 'asc' }, take: 3 } } },
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
      lastEncounteredAt: r.lastEncounteredAt?.toISOString() ?? null,
      encounterCount: r.correctCount + r.wrongCount,
      correctCount: r.correctCount,
      wrongCount: r.wrongCount,
      mastery: r.mastery,
      inWrongBook: r.inWrongBook,
      meanings: r.word.senses.map((s) => ({ meaning: s.meaning, example: s.example })),
      examples: Array.from(new Set(r.word.senses.map((s) => s.example).filter(Boolean))),
      confusables: confusablesById.get(r.word.id) ?? [],
    }));

    return { words, total, page, pageSize };
  }

  async confusables(userId: number, wordId: string): Promise<ConfusableInfo[]> {
    const word = await this.prisma.word.findUnique({ where: { id: wordId } });
    if (!word) throw new NotFoundException('单词不存在');
    // 主键双向引用：正向 + 反向都从 word_pairs 表查
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
    return [
      ...asA.map((p) => ({ counterpart: p.wordB.text, type: p.type as ConfusableInfo['type'], note: p.note })),
      ...asB.map((p) => ({ counterpart: p.wordA.text, type: p.type as ConfusableInfo['type'], note: p.note })),
    ];
  }

  async timeline(userId: number, wordId: string): Promise<EncounterRecord[]> {
    const word = await this.prisma.word.findUnique({ where: { id: wordId } });
    if (!word) throw new NotFoundException('单词不存在');

    const items = await this.prisma.learningSessionItem.findMany({
      where: { wordId, session: { userId } },
      include: { session: { select: { createdAt: true, mode: true } } },
      orderBy: { session: { createdAt: 'desc' } },
    });

    return items.map((it) => ({
      date: it.session.createdAt.toISOString(),
      mode: it.session.mode as 'zh2en' | 'dictation',
      correct: it.correct ?? false,
      elapsedMs: it.elapsedMs,
    }));
  }

  async stats(userId: number): Promise<CollectionStats> {
    const allWords = await this.prisma.word.findMany({ select: { id: true, tier: true } });
    const progress = await this.prisma.userWordProgress.findMany({
      where: { userId },
      select: { wordId: true, mastery: true },
    });
    const mastered = new Set(progress.filter((p) => p.mastery >= 100).map((p) => p.wordId));
    const encountered = new Set(progress.map((p) => p.wordId));

    const tiers: DifficultyTier[] = ['I', 'II', 'III', 'IV'];
    const byTier = tiers.map((tier) => {
      const tierWords = allWords.filter((w) => w.tier === tier);
      return {
        tier,
        total: tierWords.length,
        encountered: tierWords.filter((w) => encountered.has(w.id)).length,
      };
    });

    return {
      totalWords: allWords.length,
      encountered: encountered.size,
      mastered: mastered.size,
      byTier,
    };
  }
}
