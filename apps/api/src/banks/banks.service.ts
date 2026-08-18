// 词书与阶段：大厅列表 + 阶段地图（tier / 关卡 / 解锁状态 / 最佳评级）+ 阶段排行榜
// hierarchical 词书（红宝书）：两层地图 = 外层阶段（regions）+ 内层关卡（levels）
import { Injectable, NotFoundException } from '@nestjs/common';
import type { Bank, DifficultyTier, LeaderboardEntry, LevelInfo, Rating, RegionInfo, StageInfo, StageLeaderboard } from '@word-journey/shared';
import { PrismaService } from '../prisma/prisma.service';

// 复合 stage 编码解析：外层阶段=百位，内层关卡=个位
export function regionOf(stage: number): number {
  return Math.floor(stage / 100);
}
export function levelOf(stage: number): number {
  return stage % 100;
}
// 词书是否为两层地图结构（stage ≥ 100 即分层编码）
function isHierarchical(stages: number[]): boolean {
  return stages.some((s) => s >= 100);
}

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

    // 今日已学：按词书聚合（只统计实际已答题目，忽略未作答/中途阵亡的题）
    const sessionsToday = await this.prisma.learningSession.findMany({
      where: { userId, createdAt: { gte: startOfDay() }, result: true },
      select: { bankId: true, _count: { select: { items: { where: { elapsedMs: { gt: 0 } } } } } },
    });
    const learnedByBank = new Map<number, number>();
    for (const s of sessionsToday) {
      learnedByBank.set(s.bankId, (learnedByBank.get(s.bankId) ?? 0) + s._count.items);
    }

    return banks.map((b) => {
      const stageIds = [...new Set(b.bankWords.map((bw) => bw.stage))].sort((x, y) => x - y);
      const hierarchical = isHierarchical(stageIds);
      // 每个阶段：wordId 集合 + 已遇词计数
      const wordsByStage = new Map<number, Set<string>>();
      for (const bw of b.bankWords) {
        const set = wordsByStage.get(bw.stage) ?? new Set<string>();
        set.add(bw.wordId);
        wordsByStage.set(bw.stage, set);
      }

      // hierarchical：外层阶段解锁 = 前一外层阶段通关关数 ≥ 80%
      if (hierarchical) {
        const regions = [...new Set(stageIds.map(regionOf))].sort((a, b) => a - b);
        const clearedLevelsByRegion = new Map<number, number>();
        const levelsByRegion = new Map<number, number>();
        for (const sid of stageIds) {
          const reg = regionOf(sid);
          levelsByRegion.set(reg, (levelsByRegion.get(reg) ?? 0) + 1);
          const words = wordsByStage.get(sid);
          if (words) {
            let cleared = 0;
            for (const wid of words) {
              if (bankOfWord.get(wid) === b.id) {
                const p = progressByWord.get(wid);
                if (p && p.mastery >= 100) cleared++;
              }
            }
            if (words.size > 0 && cleared / words.size >= 0.8) {
              clearedLevelsByRegion.set(reg, (clearedLevelsByRegion.get(reg) ?? 0) + 1);
            }
          }
        }
        let unlocked = 1; // 第一外层阶段始终解锁
        for (let i = 1; i < regions.length; i++) {
          const prev = regions[i - 1]!;
          const total = levelsByRegion.get(prev) ?? 0;
          const cleared = clearedLevelsByRegion.get(prev) ?? 0;
          if (total > 0 && cleared / total >= 0.8) unlocked++;
          else break;
        }
        return {
          id: String(b.id),
          code: b.code,
          name: b.name,
          structure: 'hierarchical' as const,
          totalWords: b.bankWords.length,
          masteredWords: masteredByBank.get(b.id) ?? 0,
          dueReviews: dueByBank.get(b.id) ?? 0,
          learnedToday: learnedByBank.get(b.id) ?? 0,
          unlockedStages: Math.max(1, unlocked),
          totalStages: regions.length,
        };
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
        structure: 'flat' as const,
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

    // 生存 Run：该 stage 历史最高生存天数（finished runs 取 max day）
    const finishedRuns = await this.prisma.run.findMany({
      where: { userId, bankId: bank.id, status: 'finished' },
      select: { stageId: true, day: true },
    });
    const bestDaysByStage = new Map<number, number>();
    for (const r of finishedRuns) {
      const cur = bestDaysByStage.get(r.stageId) ?? 0;
      if (r.day > cur) bestDaysByStage.set(r.stageId, r.day);
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
        bestDays: bestDaysByStage.get(stageId) ?? 0,
      };
    });
  }

  // 外层阶段地图（hierarchical 词书）：必考/基础/超纲，进度 = 内层关卡通关数占比
  async regions(userId: number, bankCode: string): Promise<RegionInfo[]> {
    const bank = await this.prisma.wordBank.findUnique({
      where: { code: bankCode },
      include: { bankWords: true },
    });
    if (!bank) throw new NotFoundException(`词书不存在: ${bankCode}`);

    const stageIds = [...new Set(bank.bankWords.map((bw) => bw.stage))];
    if (!isHierarchical(stageIds)) {
      throw new NotFoundException('该词书为单层阶段结构，请使用 /stages');
    }

    const REGION_NAMES: Record<number, string> = { 1: '必考词', 2: '基础词', 3: '超纲词' };

    // 词 → 所属词书归属（per-bank 统计用）
    const bankOfWord = new Map<string, number>();
    for (const b of bank.bankWords) bankOfWord.set(b.wordId, bank.id);

    // 词级进度
    const progress = await this.prisma.userWordProgress.findMany({
      where: { userId, wordId: { in: bank.bankWords.map((bw) => bw.wordId) } },
      select: { wordId: true, mastery: true },
    });
    const wordMastery = new Map(progress.map((p) => [p.wordId, p.mastery]));

    // 通关状态：unit Run 击破 Final Boss 即通关（替代旧 LearningSession 评级判定）
    const clearedRuns = await this.prisma.run.findMany({
      where: { userId, bankId: bank.id, kind: 'unit', status: 'finished', cleared: true },
      select: { stageId: true },
    });
    const clearedLevelIds = new Set(clearedRuns.map((r) => r.stageId));

    // 按外层阶段聚合
    const regions = new Map<number, { levels: Map<number, { total: number; words: string[] }> }>();
    for (const bw of bank.bankWords) {
      const reg = regionOf(bw.stage);
      const entry = regions.get(reg) ?? { levels: new Map<number, { total: number; words: string[] }>() };
      const lvl = entry.levels.get(bw.stage) ?? { total: 0, words: [] };
      lvl.total++;
      lvl.words.push(bw.wordId);
      entry.levels.set(bw.stage, lvl);
      regions.set(reg, entry);
    }

    const regionIds = [...regions.keys()].sort((a, b) => a - b);
    const result: RegionInfo[] = [];
    let prevRegionUnlocked = true;
    for (const reg of regionIds) {
      const entry = regions.get(reg)!;
      const levelIds = [...entry.levels.keys()].sort((a, b) => a - b);
      const wordCount = levelIds.reduce((s, lid) => s + entry.levels.get(lid)!.total, 0);
      const clearedLevels = levelIds.filter((lid) => clearedLevelIds.has(lid)).length;
      const progressPct = levelIds.length > 0 ? Math.round((clearedLevels / levelIds.length) * 100) : 0;
      const unlocked = prevRegionUnlocked;
      const status: 'locked' | 'available' | 'cleared' = unlocked
        ? clearedLevels === levelIds.length && levelIds.length > 0 ? 'cleared' : 'available'
        : 'locked';
      // 本区域是否已全部通关 → 解锁下一区域
      prevRegionUnlocked = levelIds.length > 0 && clearedLevels === levelIds.length;

      result.push({
        id: reg,
        name: REGION_NAMES[reg] ?? `阶段 ${reg}`,
        wordCount,
        levelCount: levelIds.length,
        clearedLevels,
        unlocked,
        status,
        progress: progressPct,
        tier: tierOf(reg * 100),
      });
    }
    return result;
  }

  // 内层关卡地图（hierarchical 词书）：某外层阶段内的关卡链（每单元一关）
  async levels(userId: number, bankCode: string, regionId: number): Promise<LevelInfo[]> {
    const bank = await this.prisma.wordBank.findUnique({
      where: { code: bankCode },
      include: { bankWords: true },
    });
    if (!bank) throw new NotFoundException(`词书不存在: ${bankCode}`);

    const levelWords = bank.bankWords.filter((bw) => regionOf(bw.stage) === regionId);
    if (levelWords.length === 0) throw new NotFoundException(`外层阶段 ${regionId} 无关卡`);

    const progress = await this.prisma.userWordProgress.findMany({
      where: { userId, wordId: { in: levelWords.map((bw) => bw.wordId) } },
      select: { wordId: true, mastery: true, correctCount: true },
    });
    const wordMastery = new Map(progress.map((p) => [p.wordId, p.mastery]));
    // O6 口径统一：Run HUD 的"已会"= 历史答对过（correctCount≥1），LevelMap 同口径，避免双轨脱节
    const wordKnown = new Map(progress.map((p) => [p.wordId, (p.correctCount ?? 0) >= 1]));

    // 通关状态：unit Run 击破 Final Boss 即通关（替代旧 LearningSession 评级判定）
    const clearedRuns = await this.prisma.run.findMany({
      where: { userId, bankId: bank.id, kind: 'unit', status: 'finished', cleared: true },
      select: { stageId: true },
    });
    const clearedLevelIds = new Set(clearedRuns.map((r) => r.stageId));

    const finishedRuns = await this.prisma.run.findMany({
      where: { userId, bankId: bank.id, kind: 'unit', status: 'finished' },
      select: { stageId: true, day: true },
    });
    const bestDaysByStage = new Map<number, number>();
    for (const r of finishedRuns) {
      const cur = bestDaysByStage.get(r.stageId) ?? 0;
      if (r.day > cur) bestDaysByStage.set(r.stageId, r.day);
    }

    const byLevel = new Map<number, { total: number; words: string[] }>();
    for (const bw of levelWords) {
      const entry = byLevel.get(bw.stage) ?? { total: 0, words: [] };
      entry.total++;
      entry.words.push(bw.wordId);
      byLevel.set(bw.stage, entry);
    }
    const levelIds = [...byLevel.keys()].sort((a, b) => a - b);

    return levelIds.map((stageId, i) => {
      const entry = byLevel.get(stageId)!;
      const encountered = entry.words.filter((wid) => wordMastery.has(wid)).length;
      const mastered = entry.words.filter((wid) => wordKnown.get(wid) ?? false).length;
      // 进度 = 已会词占比（"全词会了 → Final Boss"通关语义一致）
      const progressPct = entry.total > 0 ? Math.round((mastered / entry.total) * 100) : 0;
      const cleared = clearedLevelIds.has(stageId);

      // 解锁链：第一关恒解锁；前一关通关（unit Run cleared）解锁本关
      const unlocked = i === 0 || clearedLevelIds.has(levelIds[i - 1]!);

      const status: 'locked' | 'available' | 'cleared' = unlocked
        ? cleared ? 'cleared' : 'available'
        : 'locked';

      return {
        id: stageId,
        name: `Unit ${levelOf(stageId)}`,
        wordCount: entry.total,
        status,
        cleared,
        encountered,
        mastered,
        progress: progressPct,
        bestDays: bestDaysByStage.get(stageId) ?? 0,
      };
    });
  }

  // 阶段排行榜：按 (词书, 阶段) 分榜
  // hierarchical（unit Run）：通关者优先（通关天数升序）→ 未通关按已掌握词数降序；
  // flat（survival 旧纪录）：每用户最高生存天数，并列破序取首领数更多/更早达成
  async leaderboard(userId: number, bankCode: string, stageId: number): Promise<StageLeaderboard> {
    const bank = await this.prisma.wordBank.findUnique({
      where: { code: bankCode },
      select: { id: true, bankWords: { select: { stage: true } } },
    });
    if (!bank) throw new NotFoundException(`词书不存在: ${bankCode}`);
    if (!bank.bankWords.some((bw) => bw.stage === stageId)) {
      throw new NotFoundException(`阶段不存在: ${stageId}`);
    }

    const unitMode = stageId >= 100;
    const runs = await this.prisma.run.findMany({
      where: {
        bankId: bank.id,
        stageId,
        status: 'finished',
        kind: unitMode ? 'unit' : 'survival',
      },
      select: { id: true, userId: true, day: true, bossClearedCount: true, cleared: true, createdAt: true },
    });

    // unit：每局结束时已掌握词数（结算口径：该局出题词中 mastery≥100 的去重个数）+ 作答正确率（效率排序用）
    let masteredByRun = new Map<number, number>();
    let accuracyByRun = new Map<number, number>();
    if (unitMode && runs.length > 0) {
      const runIds = runs.map((r) => r.id);
      const userIdOfRun = new Map(runs.map((r) => [r.id, r.userId]));
      const items = await this.prisma.runItem.findMany({
        where: { runId: { in: runIds } },
        select: { runId: true, wordId: true, correct: true },
      });
      const wordIds = [...new Set(items.map((i) => i.wordId))];
      const progress = wordIds.length
        ? await this.prisma.userWordProgress.findMany({
            where: { userId: { in: [...new Set(runs.map((r) => r.userId))] }, wordId: { in: wordIds } },
            select: { userId: true, wordId: true, mastery: true },
          })
        : [];
      const mastered = new Set(progress.filter((p) => p.mastery >= 100).map((p) => `${p.userId}:${p.wordId}`));
      const countByRun = new Map<number, number>();
      const accByRun = new Map<number, { ok: number; total: number }>();
      const seen = new Set<string>();
      for (const it of items) {
        const key = `${it.runId}:${it.wordId}`;
        if (it.correct === true) {
          const a = accByRun.get(it.runId) ?? { ok: 0, total: 0 };
          a.ok++;
          accByRun.set(it.runId, a);
        }
        if (it.correct !== null) {
          const a = accByRun.get(it.runId) ?? { ok: 0, total: 0 };
          a.total++;
          accByRun.set(it.runId, a);
        }
        if (seen.has(key)) continue;
        seen.add(key);
        const uid = userIdOfRun.get(it.runId);
        if (uid != null && mastered.has(`${uid}:${it.wordId}`)) {
          countByRun.set(it.runId, (countByRun.get(it.runId) ?? 0) + 1);
        }
      }
      masteredByRun = countByRun;
      for (const [rid, a] of accByRun) {
        if (a.total > 0) accuracyByRun.set(rid, Math.round((a.ok / a.total) * 1000) / 1000);
      }
    }

    const userIds = [...new Set(runs.map((r) => r.userId))];
    const users = userIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true } })
      : [];
    const usernames = new Map(users.map((u) => [u.id, u.username]));

    const leaderRuns: LeaderRun[] = runs.map((r) => ({
      userId: r.userId,
      day: r.day,
      bossClearedCount: r.bossClearedCount,
      cleared: r.cleared,
      masteredCount: masteredByRun.get(r.id) ?? 0,
      accuracy: accuracyByRun.get(r.id),
      createdAt: r.createdAt,
    }));
    const { entries, me, totalPlayers } = buildLeaderboard(leaderRuns, usernames, userId, 10, unitMode);
    return { bankCode, stageId, totalPlayers, entries, me };
  }
}

// 单局纪录（prisma run 精选字段的扁平视图）
interface LeaderRun {
  userId: number;
  day: number;
  bossClearedCount: number;
  cleared: boolean;
  masteredCount: number;
  accuracy?: number;
  createdAt: Date;
}

// 纯函数：聚合每用户最佳局 → 排序定名次 → 裁剪 topN + 当前用户名次
export function buildLeaderboard(
  runs: LeaderRun[],
  usernames: Map<number, string>,
  selfUserId: number,
  top = 10,
  unitMode = false,
): { entries: LeaderboardEntry[]; me: StageLeaderboard['me']; totalPlayers: number } {
  // 两局优劣比较：unit = 通关者优先、通关天数少者优、同天数正确率（效率）高者优；未通关按已掌握词数降序；
  // survival = 天数降序、首领数更多、更早达成
  const better = (a: LeaderRun, b: LeaderRun): boolean => {
    if (unitMode) {
      if (a.cleared !== b.cleared) return a.cleared;
      if (a.cleared) {
        if (a.day !== b.day) return a.day < b.day;
        return (a.accuracy ?? 0) > (b.accuracy ?? 0);
      }
      if (a.masteredCount !== b.masteredCount) return a.masteredCount > b.masteredCount;
      return a.createdAt.getTime() < b.createdAt.getTime();
    }
    if (a.day !== b.day) return a.day > b.day;
    if (a.bossClearedCount !== b.bossClearedCount) return a.bossClearedCount > b.bossClearedCount;
    return a.createdAt.getTime() < b.createdAt.getTime();
  };

  // 每用户纪录局
  const best = new Map<number, LeaderRun>();
  for (const r of runs) {
    const cur = best.get(r.userId);
    if (!cur || better(r, cur)) best.set(r.userId, r);
  }

  const list = [...best.values()].sort((a, b) => {
    if (unitMode) {
      if (a.cleared !== b.cleared) return a.cleared ? -1 : 1;
      if (a.cleared) {
        return a.day - b.day || (b.accuracy ?? 0) - (a.accuracy ?? 0) || a.createdAt.getTime() - b.createdAt.getTime();
      }
      return b.masteredCount - a.masteredCount || b.day - a.day || a.createdAt.getTime() - b.createdAt.getTime();
    }
    return b.day - a.day || b.bossClearedCount - a.bossClearedCount || a.createdAt.getTime() - b.createdAt.getTime();
  });
  const rankOf = new Map<number, number>(list.map((r, i) => [r.userId, i + 1]));

  const entries: LeaderboardEntry[] = list.slice(0, top).map((r) => ({
    rank: rankOf.get(r.userId)!,
    username: usernames.get(r.userId) ?? `玩家${r.userId}`,
    days: r.day,
    bossClearedCount: r.bossClearedCount,
    cleared: r.cleared,
    masteredCount: unitMode ? r.masteredCount : undefined,
    accuracy: unitMode ? r.accuracy : undefined,
    isMe: r.userId === selfUserId,
  }));

  const my = best.get(selfUserId);
  const me = my
    ? {
        rank: rankOf.get(selfUserId)!,
        days: my.day,
        bossClearedCount: my.bossClearedCount,
        cleared: my.cleared,
        masteredCount: unitMode ? my.masteredCount : undefined,
        accuracy: unitMode ? my.accuracy : undefined,
      }
    : null;

  return { entries, me, totalPlayers: list.length };
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