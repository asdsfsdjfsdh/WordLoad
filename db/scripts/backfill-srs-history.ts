// 图鉴 srsHistory 历史回填：为 srsHistory 列为空（NULL/[]）的历史学习记录重建 SRS 档位变更史。
// 用法: pnpm --filter @word-journey/db run backfill:srs-history
//
// 策略：
//  - 按词重放 LearningSessionItem（关卡）+ RunItem（生存/Unit）的作答序列（按时间+seq 升序），
//    逐题过 srsSchedule 记录档位变化点；
//  - 若重放终态档位与当前 reviewStage 一致 → 采用重放轨迹；
//  - 否则（dictation 额外 +1 档、skip/反斩 等无法精确重放的情形）→ 兜底单点
//    [{ stage: 当前档, at: masteredAt ?? lastEncounteredAt }]；已斩词固定 [{ stage: 6, ... }]。
// 注意：srsSchedule 与 apps/api/src/sessions/settlement.ts 同源口径，改动须同步（此脚本为一次性迁移工具）。
import { PrismaClient } from '@prisma/client';
import { readFileSync, existsSync } from 'node:fs';

interface ReviewState {
  reviewStage: number;
  ease: number;
}

// 与 settlement.ts srsSchedule 同源（迁移用一次性副本）
function srsSchedule(state: ReviewState | null, correct: boolean): ReviewState {
  const ease = (state?.ease ?? 2.5) + (correct ? 0.1 : -0.5);
  const clamped = Math.min(Math.max(ease, 1.3), 2.8);
  if (!correct) {
    const prevStage = state?.reviewStage ?? 0;
    return { reviewStage: Math.max(1, prevStage - 2), ease: clamped };
  }
  return { reviewStage: (state?.reviewStage ?? 0) + 1, ease: clamped };
}

interface Event {
  wordId: string;
  correct: boolean;
  at: number; // epoch ms
  seq: number;
}

async function main(): Promise<void> {
  const prisma = new PrismaClient({ datasources: { db: { url: resolveDatabaseUrl() } } });
  await prisma.$connect();

  const rows = await prisma.userWordProgress.findMany({
    select: {
      userId: true,
      wordId: true,
      reviewStage: true,
      skipped: true,
      firstEncounteredAt: true,
      lastEncounteredAt: true,
      masteredAt: true,
      srsHistory: true,
    },
  });

  const empty = rows.filter(
    (r) => !Array.isArray(r.srsHistory) || (r.srsHistory as unknown[]).length === 0,
  );
  console.log(`总进度 ${rows.length} 条，待回填 ${empty.length} 条`);

  if (empty.length === 0) {
    await prisma.$disconnect();
    return;
  }

  const wordIds = Array.from(new Set(empty.map((r) => r.wordId)));
  const userWordKeys = new Set(empty.map((r) => `${r.userId}:${r.wordId}`));

  // 全部作答事件（仅命中待回填词，避免拉全表）
  const [sessionItems, runItems] = await Promise.all([
    prisma.learningSessionItem.findMany({
      where: { answered: true, correct: { not: null }, wordId: { in: wordIds } },
      select: { wordId: true, correct: true, seq: true, session: { select: { userId: true, createdAt: true } } },
    }),
    prisma.runItem.findMany({
      where: { answered: true, correct: { not: null }, wordId: { in: wordIds } },
      select: { wordId: true, correct: true, seq: true, run: { select: { userId: true, createdAt: true } } },
    }),
  ]);

  const eventsByWord = new Map<string, Event[]>();
  for (const it of sessionItems) {
    const key = `${it.session.userId}:${it.wordId}`;
    if (!userWordKeys.has(key)) continue;
    const list = eventsByWord.get(key) ?? [];
    list.push({ wordId: it.wordId, correct: it.correct === true, at: it.session.createdAt.getTime(), seq: it.seq });
    eventsByWord.set(key, list);
  }
  for (const it of runItems) {
    const key = `${it.run.userId}:${it.wordId}`;
    if (!userWordKeys.has(key)) continue;
    const list = eventsByWord.get(key) ?? [];
    list.push({ wordId: it.wordId, correct: it.correct === true, at: it.run.createdAt.getTime(), seq: it.seq + 1000000 });
    eventsByWord.set(key, list);
  }
  for (const list of eventsByWord.values()) list.sort((a, b) => a.at - b.at || a.seq - b.seq);

  const emptyByKey = new Map(empty.map((r) => [`${r.userId}:${r.wordId}`, r]));
  const buildHistory = (userId: number, key: string): { stage: number; at: string }[] => {
    const row = emptyByKey.get(key);
    if (!row) return [];
    // 已斩：固定单点 6 档
    if (row.skipped) {
      const at = (row.masteredAt ?? row.lastEncounteredAt ?? row.firstEncounteredAt);
      return at ? [{ stage: 6, at: at.toISOString() }] : [];
    }
    const events = eventsByWord.get(key) ?? [];
    if (events.length === 0) {
      // 无作答日志：非零档 → 兜底单点；零档 → 保持空
      if (row.reviewStage <= 0) return [];
      const at = (row.masteredAt ?? row.lastEncounteredAt ?? row.firstEncounteredAt);
      return at ? [{ stage: row.reviewStage, at: at.toISOString() }] : [];
    }
    // 重放
    let state: ReviewState | null = null;
    let prevStage = 0;
    const points: { stage: number; at: string }[] = [];
    for (const e of events) {
      const next = srsSchedule(state, e.correct);
      if (next.reviewStage !== prevStage) {
        points.push({ stage: next.reviewStage, at: new Date(e.at).toISOString() });
      }
      prevStage = next.reviewStage;
      state = next;
    }
    // 终态档位一致 → 采用重放；否则兜底单点
    if (state && state.reviewStage === row.reviewStage && points.length > 0) return points;
    const at = (row.masteredAt ?? row.lastEncounteredAt ?? row.firstEncounteredAt);
    return at && row.reviewStage > 0 ? [{ stage: row.reviewStage, at: at.toISOString() }] : [];
  };

  const updates: { userId: number; wordId: string; srsHistory: { stage: number; at: string }[] }[] = [];
  for (const r of empty) {
    const key = `${r.userId}:${r.wordId}`;
    updates.push({ userId: r.userId, wordId: r.wordId, srsHistory: buildHistory(r.userId, key) });
  }

  const CHUNK = 200;
  for (let i = 0; i < updates.length; i += CHUNK) {
    const chunk = updates.slice(i, i + CHUNK);
    await prisma.$transaction(
      chunk.map((u) =>
        prisma.userWordProgress.update({
          where: { userId_wordId: { userId: u.userId, wordId: u.wordId } },
          data: { srsHistory: u.srsHistory },
        }),
      ),
    );
    console.log(`已回填 ${Math.min(i + CHUNK, updates.length)}/${updates.length}`);
  }

  const nonEmpty = updates.filter((u) => u.srsHistory.length > 0).length;
  console.log(`完成：${updates.length} 条待回填，${nonEmpty} 条获得轨迹点`);
  await prisma.$disconnect();
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
