/**
 * 生存模式平衡仿真（M3 蒙特卡洛）
 *
 * v2.6：重构为复用共享引擎 createWaveSim（消除双份实现漂移）。
 * 血量 / 漏怪 / 眩晕 / 词长伤害 / 连击里程碑 / 敌人特性 / Boss 击破全部由
 * 引擎按题重放决定；本模块只负责宏观流程（注入、Boss 排程、buff 选择、词级 Q）。
 *
 * 用法（脚本）:
 *   pnpm --filter @word-journey/api exec ts-node src/runs/balance-sim.ts
 * 用法（测试）:
 *   pnpm --filter @word-journey/api test
 */

import { SURVIVAL, bossHits, createWaveSim, monsterHits, resolveEffects, travelBudget } from '@word-journey/shared';
import { pickBuffs, pickLegends } from './buff-picker';

export interface SimConfig {
  maxHpBase: number;
  hpPerLv: number;
  baseHp: number;
  tierFactor: number[]; // I..IV 词级难度倍率
  tierDist: number[]; // I..IV 词池占比（权重）
  maxField: number; // 场上怪数上限
  speedBase: number; // 逼近预算基准（题数）
  speedCap: number; // 速度加成封顶（×1.3）
  minTravel: number;
  maxTravel: number;
  wrongBase: number;
  wrongGrow: number;
  wrongCap: number;
  leakBase: number;
  leakGrow: number;
  leakCap: number;
  bossDmgBase: number;
  bossDmgGrow: number;
  bossDmgCap: number;
  leechN: number;
  leechMin: number;
  bossBase: number;
  bossHeal: number;
  questionsPerDay: number;
  maxDays: number;
}

/** §4.9 标定值（v2.4 基线，与共享 SURVIVAL 一致） */
export const CALIBRATED: SimConfig = {
  maxHpBase: 20,
  hpPerLv: 2,
  baseHp: 2,
  tierFactor: [1, 1.25, 1.6, 2],
  tierDist: [0.4, 0.3, 0.2, 0.1],
  maxField: 5,
  speedBase: 12,
  speedCap: 1.3,
  minTravel: 4,
  maxTravel: 12,
  wrongBase: 1,
  wrongGrow: 0.04,
  wrongCap: 2,
  leakBase: 1,
  leakGrow: 0.1,
  leakCap: 3,
  bossDmgBase: 1,
  bossDmgGrow: 0.2,
  bossDmgCap: 4,
  leechN: 6,
  leechMin: 3,
  bossBase: 5,
  bossHeal: 0,
  questionsPerDay: 20,
  maxDays: 1000, // 无 MAX_DAYS 硬停：跑局由死亡终结，仿真实为安全上限
};

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 怪所需答对数（委托共享引擎公式，保持 cfg 兼容签名） */
export function monsterHitsOf(
  cfg: Pick<SimConfig, 'baseHp' | 'tierFactor'>,
  tier: number,
  day: number,
  atkLv: number,
  dmgBuff = 0,
): number {
  return monsterHits(tier, day, atkLv, dmgBuff);
}

/** 逼近预算（题数）（委托共享引擎公式） */
export function travelBudgetOf(
  cfg: Pick<SimConfig, 'speedBase' | 'speedCap' | 'minTravel' | 'maxTravel'>,
  day: number,
): number {
  return travelBudget(day);
}

interface Word {
  c: number; // 答对次数
  w: number; // 答错次数
}

interface DailyLogRow {
  day: number;
  hpPre: number;
  hp: number;
  maxHp: number;
  newQs: number;
  injected: number;
  q: number;
  correct: number;
  wrong: number;
  leaked: number;
  leech: number;
  monH: number;
  stuns: number;
  bossResult: string;
  buffPick: string;
}

export interface RunResult {
  days: number;
  bossClearedCount: number;
  log?: DailyLogRow[];
}

/**
 * 跑单局。log=true 时记录逐日状态。
 * 随机数用 mulberry32(seed) 确定性序列；每日本波交共享引擎重放。
 */
export function runTrial(
  cfg: SimConfig,
  hpLv: number,
  atkLv: number,
  defLv: number,
  acc: number,
  seed: number,
  log = false,
): RunResult {
  const rng = mulberry32(seed);
  let maxHp = cfg.maxHpBase + cfg.hpPerLv * hpLv;
  let hp = maxHp;
  let day = 1;
  let unbattled = 20;
  let cumulativeConsumed = 20;
  let lastBossConsumed = 20;
  let lastBossDay = 0;
  let everBoss = false;
  let lastInjectDay = 1;
  const words: Word[] = [];
  const codes: string[] = []; // 本局已选 buff（真实 buff-picker + resolveEffects）
  let bossClearedCount = 0;
  let dead = false;
  let days = 0;
  const logRows: DailyLogRow[] = [];

  const qSize = () => words.filter((w) => w.w > 0).length; // 轻量 Q：仅错词
  const pickQ = (): Word | null => {
    const q = words.filter((w) => w.w > 0);
    return q.length ? (q[Math.floor(rng() * q.length)] ?? null) : null;
  };
  const sampleTier = (): 0 | 1 | 2 | 3 => {
    const total = cfg.tierDist.reduce((a, b) => a + b, 0);
    let r = rng() * total;
    for (let i = 0; i < cfg.tierDist.length; i++) {
      r -= cfg.tierDist[i]!;
      if (r <= 0) return i as 0 | 1 | 2 | 3;
    }
    return 0;
  };
  const sampleLen = (): number => 4 + Math.floor(rng() * 5); // 4~8

  while (!dead && day <= cfg.maxDays) {
    days = day;
    const boss = (() => {
      if (day < 3) return false;
      const gap = day - lastBossDay;
      if (gap < 2) return false;
      if (cumulativeConsumed - lastBossConsumed >= 20) return true;
      if (gap >= 4) return true;
      if (day === 3 && !everBoss) return true;
      return false;
    })();
    if (boss) hp = Math.min(maxHp, hp + cfg.bossHeal);

    const hpPre = hp;
    const newQs = Math.min(cfg.questionsPerDay, unbattled);
    unbattled -= newQs;
    cumulativeConsumed += newQs;

    let correct = 0;
    let wrong = 0;
    let leaked = 0;
    let stuns = 0;
    let bossResult = '-';

    if (boss) {
      // 首领日：全 Boss 题，交共享引擎
      const bh = bossHits(day, atkLv);
      const sim = createWaveSim({
        day,
        atkLv,
        defLv,
        maxHp,
        startHp: hp,
        buffs: { dmg: 0, leech: 0, dodge: 0, freeze: 0 },
        legend: { bossImmunity: false, killHeal: false, bossX2: false, noLeakDmg: false },
        effects: resolveEffects(codes),
        questions: Array.from({ length: bh }, () => ({ tier: 0 as const, isNew: false, isBoss: true, len: 5 })),
        bossWave: true,
        bossHp: bh,
      });
      for (let i = 0; i < bh; i++) {
        sim.step(rng() < acc);
        if (sim.hp <= 0) break;
      }
      hp = sim.hp;
      correct = sim.stats.correct;
      wrong = sim.stats.wrong;
      // 无论击破与否都记波日/首刷标记（与引擎一致）
      everBoss = true;
      lastBossDay = day;
      if (sim.bossCleared) {
        bossClearedCount++;
        lastBossConsumed = cumulativeConsumed;
        bossResult = 'BOSS✓';
        // 首领击破 → LEGEND_DROP_RATE 概率出传说三选一（随机取一，单局一次）
        if (rng() < SURVIVAL.LEGEND_DROP_RATE) {
          const legends = pickLegends(codes);
          if (legends.length > 0) {
            codes.push(legends[Math.floor(rng() * legends.length)]!);
          }
        }
      } else {
        bossResult = 'BOSS✗';
      }
    } else {
      // 普通日：新词 + 复习补足，交共享引擎
      const batted: Word[] = Array.from({ length: newQs }, () => ({ c: 0, w: 0 }));
      const questions = Array.from({ length: cfg.questionsPerDay }, (_, i) => ({
        tier: sampleTier(),
        isNew: i < newQs,
        isBoss: false,
        len: sampleLen(),
      }));
      const sim = createWaveSim({
        day,
        atkLv,
        defLv,
        maxHp,
        startHp: hp,
        buffs: { dmg: 0, leech: 0, dodge: 0, freeze: 0 },
        legend: { bossImmunity: false, killHeal: false, bossX2: false, noLeakDmg: false },
        effects: resolveEffects(codes),
        questions,
        bossWave: false,
      });
      for (let i = 0; i < cfg.questionsPerDay; i++) {
        if (sim.hp <= 0) break;
        let ok: boolean;
        if (i < newQs) {
          ok = rng() < acc;
          const bt = batted[i]!;
          if (ok) bt.c++;
          else bt.w++;
        } else {
          const w = pickQ();
          if (w) {
            ok = rng() < acc;
            if (ok) w.c++;
            else w.w++;
          } else {
            ok = rng() < acc;
          }
        }
        sim.step(ok);
      }
      hp = sim.hp;
      correct = sim.stats.correct;
      wrong = sim.stats.wrong;
      leaked = sim.stats.leaked;
      stuns = sim.stats.stuns;
      words.push(...batted);
    }

    if (hp <= 0) dead = true;

    let buffPick = '-';
    if (!dead && day > 1) {
      // 真实 buff-picker：稀有度按天解锁 + 上下文感知 + BUFF_DEFS 上限
      // 首领日后同样提供普通三选一（与服务端 nextDay 一致）
      const cands = pickBuffs({ hp, maxHp, codes, day, recentAcc: acc });
      if (cands.length > 0) {
        const pick = cands[Math.floor(rng() * cands.length)]!;
        codes.push(pick);
        buffPick = pick;
        if (pick === 'maxhp') {
          maxHp += SURVIVAL.BUFF_MAXHP;
          hp += SURVIVAL.BUFF_MAXHP;
        }
      }
    }

    // 注入：轻量 Q（仅错词）+ 保底 5
    let injected = 0;
    if (!boss && !dead && day - lastInjectDay >= 2 && acc >= 0.75) {
      injected = Math.max(0, Math.min(15, Math.max(5, 15 - qSize())));
      if (injected > 0) {
        unbattled += injected;
        // 与服务端 consumedNewCount 口径一致：注入创建即计入新词消耗（Boss 每 20 新词触发）
        cumulativeConsumed += injected;
        lastInjectDay = day;
      }
    }

    if (log) {
      logRows.push({
        day,
        hpPre,
        hp: Math.max(0, hp),
        maxHp,
        newQs,
        injected,
        q: qSize(),
        correct,
        wrong,
        leaked,
        leech: Math.floor(
          correct / Math.max(cfg.leechMin, cfg.leechN - 2 * codes.filter((c) => c === 'leech').length),
        ),
        monH: Math.max(1, Math.ceil(cfg.questionsPerDay / 3)),
        stuns,
        bossResult,
        buffPick,
      });
    }
    day++;
  }

  return {
    days: dead ? days : cfg.maxDays,
    bossClearedCount,
    log: log ? logRows : undefined,
  };
}

/** 蒙特卡洛：N 局 → 存活天数分布统计 */
export interface DistStats {
  max: number;
  median: number;
  p25: number;
  p75: number;
  mean: number;
  gte15Pct: number;
  bossAvg: number;
}

export function monte(
  cfg: SimConfig,
  hpLv: number,
  atkLv: number,
  defLv: number,
  acc: number,
  n: number,
  seedBase = 2000,
): DistStats {
  const ds: number[] = [];
  let bossAvg = 0;
  for (let i = 0; i < n; i++) {
    const r = runTrial(cfg, hpLv, atkLv, defLv, acc, seedBase + i);
    ds.push(r.days);
    bossAvg += r.bossClearedCount;
  }
  ds.sort((a, b) => a - b);
  const med = (p: number) => ds[Math.min(n - 1, Math.floor(n * p))] ?? 0;
  return {
    max: ds[n - 1] ?? 0,
    median: med(0.5),
    p25: med(0.25),
    p75: med(0.75),
    mean: ds.reduce((a, b) => a + b, 0) / n,
    gte15Pct: (ds.filter((d) => d >= 15).length / n) * 100,
    bossAvg: bossAvg / n,
  };
}

/* ---- 命令行输出 ---- */
const pad = (x: string | number, w: number) => String(x).padStart(w);

export function printTables(cfg = CALIBRATED): void {
  const N = 3000;
  console.log('=== 单词之旅 · 生存模式 v2.6 平衡仿真（共享引擎）===');
  console.log(
    `机制: 每天${cfg.questionsPerDay}题 | 词长伤害+连击里程碑 | 敌人特性 | 吸血${cfg.leechN}:1 | 保底≥2击 | 词tier加权HP | 速度逼近漏怪 | 连错2眩晕 | 保底注入5 | Boss(每20新词/首见day3/最长4天/基值${cfg.bossBase})\n`,
  );

  console.log('【表1】随机三围 → 最大/分布生存天数 (acc=0.75, N=3000)');
  console.log(
    pad('三围', 14),
    pad('最大', 5),
    pad('中位', 5),
    pad('均值', 6),
    pad('P25', 5),
    pad('P75', 5),
    pad('≥15天%', 7),
  );
  const trios: [number, number, number][] = [
    [1, 1, 1], [3, 3, 3], [5, 5, 5], [1, 3, 5], [5, 1, 3], [3, 5, 1],
    [8, 4, 2], [2, 8, 4], [4, 2, 8], [6, 6, 6], [8, 8, 8],
  ];
  for (const [hpLv, atkLv, defLv] of trios) {
    const r = monte(cfg, hpLv, atkLv, defLv, 0.75, N, 5000);
    console.log(
      pad(`hp${hpLv}/atk${atkLv}/def${defLv}`, 14),
      pad(r.max, 5),
      pad(r.median, 5),
      pad(r.mean.toFixed(1), 6),
      pad(r.p25, 5),
      pad(r.p75, 5),
      pad(r.gte15Pct.toFixed(1), 7),
    );
  }

  console.log('\n【表2】正确率敏感性（hp3/atk3/def3, N=3000）');
  console.log(
    pad('acc', 6), pad('最大', 5), pad('中位', 5), pad('均值', 6),
    pad('P75', 5), pad('≥15天%', 7), pad('Boss均破', 8),
  );
  for (const acc of [0.6, 0.7, 0.75, 0.85, 0.92]) {
    const r = monte(cfg, 3, 3, 3, acc, N, 9000);
    console.log(
      pad(acc, 6), pad(r.max, 5), pad(r.median, 5), pad(r.mean.toFixed(1), 6),
      pad(r.p75, 5), pad(r.gte15Pct.toFixed(1), 7), pad(r.bossAvg.toFixed(2), 8),
    );
  }

  console.log('\n【表3】词池 tier 分布敏感性（hp3/atk3/def3, acc=0.75, N=3000）');
  console.log(
    pad('tierDist', 14), pad('最大', 5), pad('中位', 5), pad('均值', 6),
    pad('P75', 5), pad('≥15天%', 7),
  );
  const dists: [string, number[]][] = [
    ['Ⅰ为主 0.7/0.2/0.1/0', [0.7, 0.2, 0.1, 0]],
    ['默认 0.4/0.3/0.2/0.1', [0.4, 0.3, 0.2, 0.1]],
    ['均衡 0.25/0.25/0.25/0.25', [0.25, 0.25, 0.25, 0.25]],
    ['Ⅳ偏重 0.1/0.2/0.3/0.4', [0.1, 0.2, 0.3, 0.4]],
  ];
  for (const [name, d] of dists) {
    const c2: SimConfig = { ...cfg, tierDist: d };
    const r = monte(c2, 3, 3, 3, 0.75, N, 13000);
    console.log(
      pad(name, 14), pad(r.max, 5), pad(r.median, 5), pad(r.mean.toFixed(1), 6),
      pad(r.p75, 5), pad(r.gte15Pct.toFixed(1), 7),
    );
  }

  console.log('\n【表4】逐日状态（hp3/atk3/def3 中位局, acc=0.75）');
  console.log('天 | HP(前→后)/max | 新词 | 注入 | Q | 对/错 | 漏怪 | 眩晕 | 吸血 | 怪数 | Boss | buff');
  const ds: [number, number][] = [];
  for (let i = 0; i < N; i++) ds.push([i, runTrial(cfg, 3, 3, 3, 0.75, 17000 + i).days]);
  ds.sort((a, b) => a[1] - b[1]);
  const r = runTrial(cfg, 3, 3, 3, 0.75, 17000 + ds[1500]![0], true);
  console.log(`◆ 存活 ${r.days} 天 · Boss击破 ${r.bossClearedCount} 次`);
  for (const row of r.log ?? []) {
    console.log(
      `  ${pad(row.day, 3)}  ${pad(`${row.hpPre}→${row.hp}`, 10)}/${row.maxHp}  ${pad(row.newQs, 4)}  ${pad(row.injected, 4)}  ${pad(row.q, 3)}  ${pad(`${row.correct}/${row.wrong}`, 6)}  ${pad(row.leaked, 4)}  ${pad(row.stuns, 4)}  ${pad(row.leech, 4)}  ${pad(row.monH, 4)}  ${pad(row.bossResult, 7)}  ${row.buffPick}`,
    );
  }
}

/* 直接运行（ts-node）时打印表格 */
if (require.main === module) {
  printTables();
}
