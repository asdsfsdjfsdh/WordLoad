import { Injectable } from '@nestjs/common';
import type { Rating, StatsHeatmapResult, StatsOverview, StatsTrendPoint } from '@word-journey/shared';
import type { DifficultyTier } from '@word-journey/shared';
import { PrismaService } from '../prisma/prisma.service';

const RATINGS: Rating[] = ['C', 'B', 'A', 'S', 'SS', 'SSS'];

@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(userId: number): Promise<StatsOverview> {
    const [sessions, answered, correct, timeAgg, tierTotals, progress, runs, activeRuns] = await Promise.all([
      this.prisma.learningSession.findMany({
        where: { userId },
        select: { result: true, phase: true, bossCleared: true, maxCombo: true, rating: true, xpEarned: true, coinsEarned: true, createdAt: true },
      }),
      this.prisma.learningSessionItem.count({ where: { answered: true, session: { userId } } }),
      this.prisma.learningSessionItem.count({ where: { answered: true, correct: true, session: { userId } } }),
      this.prisma.learningSessionItem.aggregate({ where: { answered: true, session: { userId } }, _sum: { elapsedMs: true } }),
      // 全词库按 tier 聚合，避免每次全表拉取所有词
      this.prisma.word.groupBy({ by: ['tier'], _count: { _all: true } }),
      this.prisma.userWordProgress.findMany({
        where: { userId },
        select: { wordId: true, mastery: true, inWrongBook: true, skipped: true, word: { select: { tier: true } } },
      }),
      this.prisma.run.findMany({
        where: { userId, status: 'finished' },
        select: { day: true, bossClearedCount: true },
      }),
      this.prisma.run.count({ where: { userId, status: 'active' } }),
    ]);

    const settled = sessions.filter((s) => s.result);
    const totalSessions = settled.length;
    const totalWins = settled.filter((s) => {
      const idx = RATINGS.indexOf(s.rating as Rating);
      return idx >= RATINGS.indexOf('B');
    }).length;
    const totalXpEarned = settled.reduce((acc, s) => acc + s.xpEarned, 0);
    const totalCoinsEarned = settled.reduce((acc, s) => acc + s.coinsEarned, 0);
    const bestMaxCombo = settled.reduce((acc, s) => Math.max(acc, s.maxCombo), 0);
    const bossSessions = settled.filter((s) => s.phase === 'boss');
    const bossFights = bossSessions.length;
    const bossWins = bossSessions.filter((s) => s.bossCleared).length;

    const ratingCounts: Record<Rating, number> = { C: 0, B: 0, A: 0, S: 0, SS: 0, SSS: 0 };
    for (const s of settled) {
      const r = s.rating as Rating;
      if (RATINGS.includes(r)) ratingCounts[r] += 1;
    }

    const { current, longest } = this.streaks(sessions.map((s) => toDateStr(s.createdAt)));

    const mastered = new Set(progress.filter((p) => p.mastery >= 100 && !p.skipped).map((p) => p.wordId));
    const encountered = new Set(progress.map((p) => p.wordId));
    const wrongbook = new Set(progress.filter((p) => p.inWrongBook).map((p) => p.wordId));
    const skipped = new Set(progress.filter((p) => p.skipped).map((p) => p.wordId));
    const totalByTier = new Map<string, number>();
    for (const g of tierTotals) totalByTier.set(g.tier, g._count._all);
    const encounteredTier = new Map<string, number>();
    const masteredTier = new Map<string, number>();
    for (const p of progress) {
      const tier = p.word.tier;
      encounteredTier.set(tier, (encounteredTier.get(tier) ?? 0) + 1);
      if (mastered.has(p.wordId)) masteredTier.set(tier, (masteredTier.get(tier) ?? 0) + 1);
    }
    const tiers: DifficultyTier[] = ['I', 'II', 'III', 'IV'];
    const tierStats = tiers.map((tier) => ({
      tier,
      total: totalByTier.get(tier) ?? 0,
      mastered: masteredTier.get(tier) ?? 0,
      encountered: encounteredTier.get(tier) ?? 0,
    }));

    const totalAnswered = answered;
    const totalCorrect = correct;
    return {
      totalSessions,
      totalWins,
      winRate: totalSessions ? Math.round((totalWins / totalSessions) * 100) : 0,
      totalStudyMs: timeAgg._sum.elapsedMs ?? 0,
      totalXpEarned,
      totalCoinsEarned,
      totalAnswered,
      totalCorrect,
      totalWrong: totalAnswered - totalCorrect,
      accuracy: totalAnswered ? Math.round((totalCorrect / totalAnswered) * 100) : 0,
      masteredWords: mastered.size,
      wrongbookWords: wrongbook.size,
      skippedWords: skipped.size,
      bestMaxCombo,
      bossFights,
      bossWins,
      currentStreak: current,
      longestStreak: longest,
      ratingCounts,
      tierStats,
      ...aggregateRuns(runs, activeRuns),
    };
  }

  async trend(userId: number, days: number): Promise<StatsTrendPoint[]> {
    const start = addDays(startOfToday(), -(days - 1));
    const [sessions, progress] = await Promise.all([
      this.prisma.learningSession.findMany({
        where: { userId, createdAt: { gte: start } },
        select: { id: true, createdAt: true, xpEarned: true, coinsEarned: true },
      }),
      this.prisma.userWordProgress.findMany({
        where: {
          userId,
          OR: [{ firstEncounteredAt: { gte: start } }, { masteredAt: { gte: start } }],
        },
        select: { firstEncounteredAt: true, masteredAt: true },
      }),
    ]);

    const byDate = new Map<string, StatsTrendPoint>();
    for (const s of sessions) {
      const d = toDateStr(s.createdAt);
      const p = byDate.get(d) ?? emptyPoint(d);
      p.sessions += 1;
      p.xpEarned += s.xpEarned;
      p.coinsEarned += s.coinsEarned;
      byDate.set(d, p);
    }

    if (sessions.length) {
      const [items, corrects] = await Promise.all([
        this.prisma.learningSessionItem.groupBy({
          by: ['sessionId'],
          where: { answered: true, session: { userId, createdAt: { gte: start } } },
          _count: { _all: true },
          _sum: { elapsedMs: true },
        }),
        this.prisma.learningSessionItem.groupBy({
          by: ['sessionId', 'correct'],
          where: { answered: true, session: { userId, createdAt: { gte: start } } },
          _count: { _all: true },
        }),
      ]);
      const dateBySession = new Map(sessions.map((s) => [s.id, toDateStr(s.createdAt)]));
      for (const r of items) {
        const d = dateBySession.get(r.sessionId);
        if (!d) continue;
        const p = byDate.get(d)!;
        p.answered += r._count._all;
        p.studyMs += r._sum.elapsedMs ?? 0;
      }
      const correctBySession = new Map<number, number>();
      for (const r of corrects) {
        if (r.correct === true) {
          correctBySession.set(r.sessionId, (correctBySession.get(r.sessionId) ?? 0) + r._count._all);
        }
      }
      for (const [sessionId, c] of correctBySession) {
        const d = dateBySession.get(sessionId);
        if (!d) continue;
        byDate.get(d)!.correct += c;
      }
    }

    for (const p of progress) {
      if (!p.firstEncounteredAt) continue;
      const d = toDateStr(p.firstEncounteredAt);
      if (!byDate.has(d)) byDate.set(d, emptyPoint(d));
      byDate.get(d)!.newWords += 1;
    }

    for (const p of progress) {
      if (!p.masteredAt) continue;
      const d = toDateStr(p.masteredAt);
      if (!byDate.has(d)) byDate.set(d, emptyPoint(d));
      byDate.get(d)!.mastered += 1;
    }

    // 补齐整段日期（含无活动日）
    const points: StatsTrendPoint[] = [];
    for (let i = 0; i < days; i++) {
      const d = toDateStr(addDays(start, i));
      const p = byDate.get(d) ?? emptyPoint(d);
      p.accuracy = p.answered ? Math.round((p.correct / p.answered) * 100) : 0;
      points.push(p);
    }
    return points;
  }

  async heatmap(userId: number, weeks: number): Promise<StatsHeatmapResult> {
    const end = startOfToday();
    const start = addDays(end, -(weeks * 7 - 1));
    const cells = await this.answeredByDay(userId, start);
    const out: StatsHeatmapResult['cells'] = [];
    for (let i = 0; i < weeks * 7; i++) {
      const d = toDateStr(addDays(start, i));
      out.push({ date: d, value: cells.get(d) ?? 0 });
    }
    return { weeks, start: out[0]?.date ?? toDateStr(start), end: out[out.length - 1]?.date ?? toDateStr(end), cells: out };
  }

  private async answeredByDay(userId: number, start: Date): Promise<Map<string, number>> {
    const sessions = await this.prisma.learningSession.findMany({
      where: { userId, createdAt: { gte: start } },
      select: { id: true, createdAt: true },
    });
    const map = new Map<string, number>();
    if (!sessions.length) return map;
    const dateBySession = new Map(sessions.map((s) => [s.id, toDateStr(s.createdAt)]));
    const rows = await this.prisma.learningSessionItem.groupBy({
      by: ['sessionId'],
      where: { answered: true, session: { userId, createdAt: { gte: start } } },
      _count: { _all: true },
    });
    for (const r of rows) {
      const d = dateBySession.get(r.sessionId);
      if (!d) continue;
      map.set(d, (map.get(d) ?? 0) + r._count._all);
    }
    return map;
  }

  private streaks(dates: string[]): { current: number; longest: number } {
    const set = new Set(dates);
    // 当前连续：从今天（无记录则昨天）向前数
    let current = 0;
    const cursor = new Date();
    if (!set.has(toDateStr(cursor))) cursor.setDate(cursor.getDate() - 1);
    while (set.has(toDateStr(cursor))) {
      current += 1;
      cursor.setDate(cursor.getDate() - 1);
    }

    let longest = 0;
    let run = 0;
    let prev: string | null = null;
    for (const d of [...set].sort()) {
      run = prev && isNextDay(prev, d) ? run + 1 : 1;
      longest = Math.max(longest, run);
      prev = d;
    }
    return { current, longest };
  }
}

function emptyPoint(date: string): StatsTrendPoint {
  return { date, sessions: 0, answered: 0, correct: 0, accuracy: 0, xpEarned: 0, coinsEarned: 0, studyMs: 0, newWords: 0, mastered: 0 };
}

// 生存 Run 聚合（纯函数，可单测）
export interface RunAggregate {
  totalRuns: number;
  bestRunDays: number;
  totalBossCleared: number;
  activeRunCount: number;
}

export function aggregateRuns(runs: { day: number; bossClearedCount: number }[], activeRunCount: number): RunAggregate {
  let bestRunDays = 0;
  let totalBossCleared = 0;
  for (const r of runs) {
    if (r.day > bestRunDays) bestRunDays = r.day;
    totalBossCleared += r.bossClearedCount;
  }
  return { totalRuns: runs.length, bestRunDays, totalBossCleared, activeRunCount };
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function toDateStr(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function isNextDay(prev: string, cur: string): boolean {
  const parts = prev.split('-').map(Number);
  const p = new Date(parts[0] ?? 0, (parts[1] ?? 1) - 1, parts[2] ?? 1);
  p.setDate(p.getDate() + 1);
  return toDateStr(p) === cur;
}
