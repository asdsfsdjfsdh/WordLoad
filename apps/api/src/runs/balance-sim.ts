/**
 * 生存模式 v2.4 平衡仿真（M3 蒙特卡洛）
 *
 * v2.4 模型升级（四角度评审结论）：
 * 1. 词难度接入对攻：怪 HP = baseHp·tierFactor(word)·tierK·dayK / atkMult（越难越硬）
 * 2. 速度/眩晕驱动漏怪：场上怪逐问逼近（travelBudget 题数内未击杀 → 漏怪）；
 *    连错 2 → 眩晕（下一回合禁答、展示答案、怪不逼近）
 * 3. 注入门控改"轻量 Q（仅错词）+ 保底注入 5"
 *
 * 以 §4.9 标定值为基线，输出存活天数分布，供 Jest 断言目标带（中位 5–15 天）。
 *
 * 用法（脚本）:
 *   pnpm --filter @word-journey/api exec ts-node src/runs/balance-sim.ts
 * 用法（测试）:
 *   pnpm --filter @word-journey/api test
 */

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

/** §4.9 标定值（v2.4 基线） */
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
  bossHeal: 6,
  questionsPerDay: 20,
  maxDays: 80,
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

const dayK = (d: number) => Math.min(1 + 0.12 * (d - 1), 2.8);
const atkMult = (atkLv: number) => 1 + 0.25 * (atkLv - 1);
const defRed = (defLv: number) => Math.min(0.4, 0.1 * (defLv - 1));
const applyDef = (raw: number, defLv: number) =>
  Math.max(1, Math.ceil(raw * (1 - defRed(defLv))));

/** 怪所需答对数（v2.4：词难度 tierFactor 接入 + atk 成长 + 局内伤害 buff），保底 ≥2 */
export function monsterHitsOf(
  cfg: Pick<SimConfig, 'baseHp' | 'tierFactor'>,
  tier: number,
  day: number,
  atkLv: number,
  dmgBuff = 0,
): number {
  return Math.max(
    2,
    Math.ceil(
      (cfg.baseHp * (cfg.tierFactor[tier] ?? 1) * dayK(day)) /
        atkMult(atkLv) /
        (1 + dmgBuff),
    ),
  );
}

/** 逼近预算（题数）：速度加成越高预算越短，封顶范围 [minTravel, maxTravel] */
export function travelBudgetOf(
  cfg: Pick<SimConfig, 'speedBase' | 'speedCap' | 'minTravel' | 'maxTravel'>,
  day: number,
): number {
  const speedMult = Math.min(1 + 0.02 * day, cfg.speedCap);
  return Math.max(
    cfg.minTravel,
    Math.min(cfg.maxTravel, Math.ceil(cfg.speedBase / speedMult)),
  );
}

interface Word {
  c: number; // 答对次数
  w: number; // 答错次数
}

interface Monster {
  hp: number;
  timer: number;
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
  diedOnBoss: boolean;
  bossClearedCount: number;
  log?: DailyLogRow[];
}

/**
 * 跑单局。log=true 时记录逐日状态。
 * 随机数用 mulberry32(seed) 确定性序列。
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
  const buffs = { maxHp: 0, leech: 0, dmg: 0, dodge: 0, freeze: 0 };
  let bossClearedCount = 0;
  let diedOnBoss = false;
  let dead = false;
  let days = 0;
  const logRows: DailyLogRow[] = [];

  const qSize = () => words.filter((w) => w.w > 0).length; // 轻量 Q：仅错词
  const pickQ = (): Word | null => {
    const q = words.filter((w) => w.w > 0);
    return q.length ? (q[Math.floor(rng() * q.length)] ?? null) : null;
  };
  const sampleTier = (): number => {
    const total = cfg.tierDist.reduce((a, b) => a + b, 0);
    let r = rng() * total;
    for (let i = 0; i < cfg.tierDist.length; i++) {
      r -= cfg.tierDist[i]!;
      if (r <= 0) return i;
    }
    return 0;
  };
  const travelBudget = () => travelBudgetOf(cfg, day);
  const monHitsOf_ = (tier: number) => monsterHitsOf(cfg, tier, day, atkLv, buffs.dmg);
  const bossH = () =>
    Math.max(2, Math.ceil((cfg.bossBase * (day / 3)) / atkMult(atkLv)));
  const dWrong = () =>
    applyDef(
      Math.min(cfg.wrongBase + cfg.wrongGrow * (day - 1), cfg.wrongCap),
      defLv,
    );
  const dLeak = () =>
    applyDef(
      Math.min(cfg.leakBase + cfg.leakGrow * (day - 1), cfg.leakCap),
      defLv,
    );
  const dBoss = () =>
    applyDef(
      Math.min(cfg.bossDmgBase + cfg.bossDmgGrow * (day - 1), cfg.bossDmgCap),
      defLv,
    );

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
    const batted: Word[] = Array.from({ length: newQs }, () => ({ c: 0, w: 0 }));

    // 本日怪物波：按可消耗击数折算总怪数（≈每天怪数/3），逐问错峰入场（≤maxField）
    const totalMonsters = Math.max(1, Math.ceil(cfg.questionsPerDay / 3));
    const waveTiers: number[] = Array.from({ length: totalMonsters }, () =>
      sampleTier(),
    );
    let spawnIdx = 0;
    const spawn = (): Monster => {
      const tier = waveTiers[spawnIdx] ?? 0;
      spawnIdx++;
      return { hp: monHitsOf_(tier), timer: travelBudget() };
    };
    const field: Monster[] = [];
    const spawnGap = Math.max(1, Math.floor(cfg.questionsPerDay / totalMonsters));
    // 首怪立即入场
    field.push(spawn());

    let correct = 0;
    let wrong = 0;
    let leaked = 0;
    let stuns = 0;
    let consecWrong = 0;
    let stunNext = false;

    for (let i = 0; i < cfg.questionsPerDay; i++) {
      if (hp <= 0) break;
      // 错峰入场：每隔 spawnGap 题补一只（场上未满且还有怪）
      if (i > 0 && i % spawnGap === 0 && field.length < cfg.maxField && spawnIdx < totalMonsters) {
        field.push(spawn());
      }
      if (stunNext) {
        // 眩晕回合：禁答、展示答案、怪不逼近（消耗一题，不计数）
        stunNext = false;
        stuns++;
        continue;
      }

      let gotHit = false;
      if (i < newQs) {
        const bt = batted[i]!;
        if (rng() < acc) {
          bt.c++;
          correct++;
          gotHit = true;
          consecWrong = 0;
        } else {
          bt.w++;
          wrong++;
          consecWrong++;
          hp -= buffs.dodge > 0 ? (buffs.dodge--, 0) : dWrong();
          if (hp <= 0) break;
        }
      } else {
        const w = pickQ();
        if (w) {
          if (rng() < acc) {
            w.c++;
            correct++;
            gotHit = true;
            consecWrong = 0;
          } else {
            w.w++;
            wrong++;
            consecWrong++;
            hp -= buffs.dodge > 0 ? (buffs.dodge--, 0) : dWrong();
            if (hp <= 0) break;
          }
        } else if (rng() < acc) {
          correct++;
          gotHit = true;
          consecWrong = 0;
        } else {
          wrong++;
          consecWrong++;
          hp -= buffs.dodge > 0 ? (buffs.dodge--, 0) : dWrong();
          if (hp <= 0) break;
        }
      }

      // 答对 → 攻击最近怪（新词首击×2，复习 1 击）
      if (gotHit && field[0]) {
        field[0]!.hp -= i < newQs ? 2 : 1;
        if (field[0]!.hp <= 0) {
          field.shift();
          if (spawnIdx < totalMonsters) field.push(spawn());
        }
      }

      if (consecWrong >= 2) {
        stunNext = true;
        consecWrong = 0;
      }

      // 本轮结束：场上怪逼近；最近怪预算耗尽未击杀 → 抵达漏怪（后排怪未到身侧不提前漏）
      if (stunNext) continue; // 眩晕回合不逼近
      for (const m of field) m.timer -= 1;
      if (field[0] && field[0]!.timer <= 0) {
        leaked++;
        field.shift();
        hp -= buffs.dodge > 0 ? (buffs.dodge--, 0) : dLeak();
        if (spawnIdx < totalMonsters) field.push(spawn());
      }
      // 清场补位
      while (field.length < cfg.maxField && spawnIdx < totalMonsters) field.push(spawn());
      if (hp <= 0) break;
    }
    words.push(...batted);

    if (hp <= 0) dead = true;

    const leech = Math.floor(
      correct / Math.max(cfg.leechMin, cfg.leechN - 2 * buffs.leech),
    );
    hp = Math.min(maxHp, hp + leech);

    let bossResult = '-';
    if (boss && !dead) {
      const bh = bossH();
      let streak = 0;
      while (hp > 0 && streak < bh) {
        if (rng() < acc) streak++;
        else {
          streak = 0;
          hp -= buffs.dodge > 0 ? (buffs.dodge--, 0) : dBoss();
        }
      }
      if (streak >= bh) {
        bossClearedCount++;
        everBoss = true;
        lastBossDay = day;
        lastBossConsumed = cumulativeConsumed;
        bossResult = 'BOSS✓';
      } else {
        dead = true;
        diedOnBoss = true;
        bossResult = 'BOSS✗';
      }
    }

    if (hp <= 0) dead = true;

    let buffPick = '-';
    if (!dead && !boss && day > 1) {
      const avail: string[] = [];
      if (buffs.maxHp < 3) avail.push('maxhp');
      if (buffs.leech < 2) avail.push('leech');
      if (buffs.dmg < 3) avail.push('dmg');
      if (buffs.dodge < 2) avail.push('dodge');
      if (buffs.freeze < 2) avail.push('freeze');
      if (avail.length) {
        const pool = avail.slice();
        if (hp / maxHp < 0.3 && pool.includes('maxhp')) {
          buffs.maxHp++;
          maxHp += 2;
          hp += 2;
          buffPick = 'maxhp';
        } else if (hp / maxHp < 0.3 && pool.includes('dodge')) {
          buffs.dodge++;
          buffPick = 'dodge';
        } else {
          const pick = pool[Math.floor(rng() * pool.length)] ?? 'dmg';
          if (pick === 'maxhp') {
            buffs.maxHp++;
            maxHp += 2;
            hp += 2;
          } else if (pick === 'leech') buffs.leech++;
          else if (pick === 'dmg') buffs.dmg++;
          else if (pick === 'dodge') buffs.dodge++;
          else if (pick === 'freeze') buffs.freeze++;
          buffPick = pick;
        }
      }
    }

    // 注入：轻量 Q（仅错词）+ 保底 5
    let injected = 0;
    if (!boss && !dead && day - lastInjectDay >= 2 && acc >= 0.75) {
      injected = Math.max(0, Math.min(15, Math.max(5, 15 - qSize())));
      if (injected > 0) {
        unbattled += injected;
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
        leech,
        monH: totalMonsters,
        stuns,
        bossResult,
        buffPick,
      });
    }
    day++;
  }

  return {
    days: dead ? days : cfg.maxDays,
    diedOnBoss,
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
  console.log('=== 单词之旅 · 生存模式 v2.4 平衡仿真 ===');
  console.log(
    `机制: 每天${cfg.questionsPerDay}题 | 吸血${cfg.leechN}:1 | 保底≥2击 | 词tier加权HP | 速度逼近漏怪 | 连错2眩晕 | 保底注入5 | Boss(每20新词/首见day3/最长4天/基值${cfg.bossBase})\n`,
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
