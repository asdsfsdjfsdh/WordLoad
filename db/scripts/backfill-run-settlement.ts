// Run 结算统计回填：为已结算（status=finished）但尚未落库 rating/xpEarned/coinsEarned 的 Run 重算并写回。
// 用法: pnpm --filter @word-journey/db exec tsx scripts/backfill-run-settlement.ts
//
// 与 apps/api/src/runs/runs.service.ts settle() 同一口径（一次性迁移工具，改动须同步）：
//   rating = computeRating({total, correct, avgElapsedMs, perfectBonus})
//   xp     = ratingExp(state) + XP_DAY_BASE*min(day,XP_DAY_CAP)（dictation ×1.5）
//   coins  = correct*COINS_PER_CORRECT + (perfect?10) + bossClearedCount*COINS_PER_BOSS + day（收枪 ×0.5）
//   unit 首通额外 +UNIT_BOSS.FIRST_CLEAR_COINS（幂等）
import { PrismaClient } from '@prisma/client';
import { readFileSync, existsSync } from 'node:fs';

const MASTER_STAGE = 3; // 非本脚本所需，保留占位

// shared/game.ts SURVIVAL 奖励常量（与 rewards.ts 同源副本）
const XP_DAY_BASE = 3;
const XP_DAY_CAP = 20;
const COINS_PER_CORRECT = 2;
const COINS_PER_BOSS = 5;
const SURRENDER_RATE = 0.5;
const FIRST_CLEAR_COINS = 100; // UNIT_BOSS.FIRST_CLEAR_COINS

const RATING_EXP: Record<string, number> = { C: 5, B: 10, A: 18, S: 30, SS: 50, SSS: 80 };

function ratingExp(r: string): number {
  return RATING_EXP[r] ?? RATING_EXP.C;
}

function computeRating(opts: { total: number; correct: number; avgElapsedMs: number; perfectBonus: boolean }): string {
  const { total, correct, avgElapsedMs, perfectBonus } = opts;
  if (total === 0) return 'C';
  const accuracy = correct / total;
  const speedScore = Math.max(0, 25 * (1 - avgElapsedMs / 15000));
  const bonus = perfectBonus ? 15 : 0;
  const score = accuracy * 60 + speedScore + bonus;
  if (score >= 95) return 'SSS';
  if (score >= 85) return 'SS';
  if (score >= 75) return 'S';
  if (score >= 60) return 'A';
  if (score >= 45) return 'B';
  return 'C';
}

interface RunRow { id: number; userId: number; day: number; mode: string; surrendered: boolean; bossClearedCount: number; cleared: boolean; kind: string; rating: string; xpEarned: number; coinsEarned: number; stageId: number; }

async function main(): Promise<void> {
  const prisma = new PrismaClient({ datasources: { db: { url: resolveDatabaseUrl() } } });
  await prisma.$connect();

  const runs = (await prisma.run.findMany({
    where: { status: 'finished' },
    select: { id: true, userId: true, day: true, mode: true, surrendered: true, bossClearedCount: true, cleared: true, kind: true, rating: true, xpEarned: true, coinsEarned: true, stageId: true },
  })) as RunRow[];

  // 需要回填：无有效统计（active 占位默认）——以 xpEarned=0 且 rating 默认 'C' 无法区分真实 C 结算；
  // 但所有历史 finished Run 结算时都未写这三列，故按 xpEarned=0 且 rating='C' 判定为待回填。
  const pending = runs.filter((r) => r.xpEarned === 0 && r.rating === 'C');
  console.log(`共 ${runs.length} 个已结算 Run，待回填 ${pending.length} 个`);
  if (pending.length === 0) {
    await prisma.$disconnect();
    return;
  }

  const runIds = pending.map((r) => r.id);
  // 首通判定：该 (user, stage, kind=unit, cleared) 是否存在 id < 当前 run 的已结算纪录
  const priorUnits = (await prisma.run.findMany({
    where: {
      userId: { in: Array.from(new Set(pending.filter((r) => r.kind === 'unit').map((r) => r.userId))) },
      kind: 'unit', stageId: { in: Array.from(new Set(pending.filter((r) => r.kind === 'unit').map((r) => r.stageId))) },
      status: 'finished', cleared: true,
    },
    select: { id: true, userId: true, stageId: true },
  })) as { id: number; userId: number; stageId: number }[];
  const priorUnitKeys = new Set(priorUnits.map((u) => `${u.userId}:${u.stageId}:${u.id}`));

  const itemAggs = (await prisma.runItem.groupBy({
    by: ['runId'],
    where: { runId: { in: runIds }, answered: true },
    _count: { _all: true },
    _sum: { elapsedMs: true },
  })) as { runId: number; _count: { _all: number }; _sum: { elapsedMs: number | null } }[];
  const wrongAggs = (await prisma.runItem.groupBy({
    by: ['runId'],
    where: { runId: { in: runIds }, answered: true, correct: false },
    _count: { _all: true },
  })) as { runId: number; _count: { _all: number } }[];
  const timedAggs = (await prisma.runItem.groupBy({
    by: ['runId'],
    where: { runId: { in: runIds }, answered: true, elapsedMs: { gt: 0 } },
    _count: { _all: true },
    _sum: { elapsedMs: true },
  })) as { runId: number; _count: { _all: number }; _sum: { elapsedMs: number | null } }[];

  const aggMap = new Map<number, { total: number; wrong: number; timed: number; elapsed: number }>();
  for (const a of itemAggs) aggMap.set(a.runId, { total: a._count._all, wrong: 0, timed: 0, elapsed: a._sum.elapsedMs ?? 0 });
  for (const a of wrongAggs) { const e = aggMap.get(a.runId); if (e) e.wrong += a._count._all; }
  for (const a of timedAggs) { const e = aggMap.get(a.runId); if (e) { e.timed += a._count._all; e.elapsed = a._sum.elapsedMs ?? e.elapsed; } }

  const updates: { id: number; rating: string; xpEarned: number; coinsEarned: number }[] = [];
  for (const run of pending) {
    const agg = aggMap.get(run.id) ?? { total: 0, wrong: 0, timed: 0, elapsed: 0 };
    const total = agg.total;
    const correct = total - agg.wrong;
    const acc = total > 0 ? correct / total : 0;
    const avgElapsedMs = agg.timed > 0 ? agg.elapsed / agg.timed : 8000;
    const rating = computeRating({ total: Math.max(1, total), correct, avgElapsedMs, perfectBonus: acc === 1 });

    const dayBonus = XP_DAY_BASE * Math.min(run.day, XP_DAY_CAP);
    let xp = ratingExp(rating) + dayBonus;
    let coins = correct * COINS_PER_CORRECT + (acc === 1 ? 10 : 0) + (run.bossClearedCount ?? 0) * COINS_PER_BOSS + run.day;
    if (run.surrendered) coins = Math.round(coins * SURRENDER_RATE);
    // dictation ×1.5
    if (run.mode === 'dictation') xp = Math.round(xp * 1.5);
    // unit 首通一次性加成（幂等：该 (user,stage) 无更早 cleared 纪录）
    if (run.kind === 'unit' && run.cleared) {
      const earlier = Array.from(priorUnitKeys).some((k) => {
        const [uid, sid, rid] = k.split(':');
        return Number(uid) === run.userId && Number(sid) === run.stageId && Number(rid) < run.id;
      });
      if (!earlier) coins += FIRST_CLEAR_COINS;
    }
    updates.push({ id: run.id, rating, xpEarned: xp, coinsEarned: coins });
  }

  const CHUNK = 200;
  for (let i = 0; i < updates.length; i += CHUNK) {
    const chunk = updates.slice(i, i + CHUNK);
    await prisma.$transaction(
      chunk.map((u) =>
        prisma.run.update({ where: { id: u.id }, data: { rating: u.rating, xpEarned: u.xpEarned, coinsEarned: u.coinsEarned } }),
      ),
    );
    console.log(`已回填 ${Math.min(i + CHUNK, updates.length)}/${updates.length}`);
  }
  await prisma.$disconnect();
  console.log('完成：Run 结算统计已回填');
}

function resolveDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  let dir = process.cwd();
  for (;;) {
    const p = `${dir}\\.env`;
    if (existsSync(p)) {
      const raw = readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
      const line = raw.split(/\r?\n/).find((l) => l.trim().startsWith('DATABASE_URL='));
      if (line) {
        const eq = line.indexOf('=');
        return line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      }
    }
    const parent = dir.split('\\').slice(0, -1).join('\\');
    if (!parent || parent === dir) break;
    dir = parent;
  }
  throw new Error('未找到 DATABASE_URL（根 .env 或环境变量）');
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});