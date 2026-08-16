// buff 选择（上下文感知纯函数）：稀有度按天解锁、BUFF_DEFS 叠加上限、HP/acc 分支、首领前对策
import {
  BUFF_DEFS,
  LEGEND_BUFF_POOL,
  NORMAL_BUFF_POOL,
  RARITY_UNLOCK_DAY,
  type LegendBuff,
  type NormalBuff,
} from '@word-journey/shared';

export interface BuffPickInput {
  hp: number;
  maxHp: number;
  codes: string[];      // 已选 buff 代号（服务端 run.buffs）
  day: number;          // 稀有度解锁依据
  recentAcc?: number;   // 近 20 题正确率（undefined=无数据）
  bossSoon?: boolean;   // 首领前一日：必含对策
}

// 某 buff 是否已达叠加上限（按 BUFF_DEFS.cap 计）
export function buffAtCap(code: string, codes: string[]): boolean {
  const def = BUFF_DEFS[code];
  if (!def) return true;
  return codes.filter((c) => c === code).length >= def.cap;
}

// 近 20 题 acc 分支
function accTier(acc: number | undefined): 'low' | 'mid' | 'high' {
  if (acc === undefined) return 'mid';
  if (acc < 0.75) return 'low';
  if (acc >= 0.85) return 'high';
  return 'mid';
}

// 稀有度是否已解锁（白 day1 / 蓝 day2 / 紫 day4；金=传说不进普通池）
function unlocked(def: { rarity: number }, day: number): boolean {
  const need = RARITY_UNLOCK_DAY[def.rarity as 0 | 1 | 2] ?? 1;
  return day >= need;
}

// 上下文感知三选一（受控随机）：保留"上下文收窄候选池"，但候选内加权随机而非固定顺序，
// 同状态下重开一局/重抽仍可得到不同的三选一；仅首领前一日"必含对策"为硬约束。
export function pickBuffs(input: BuffPickInput, rng: () => number = Math.random): NormalBuff[] {
  const { hp, maxHp, codes } = input;
  const lowHp = maxHp > 0 && hp / maxHp < 0.3;
  const tier = accTier(input.recentAcc);

  // 可用池：未达上限 + 稀有度已解锁
  const available = NORMAL_BUFF_POOL.filter(
    (b) => !buffAtCap(b, codes) && unlocked(BUFF_DEFS[b]!, input.day),
  );
  if (available.length === 0) return [];

  // 上下文收窄：按优先级分组（组0 权重最高）
  let groups: NormalBuff[][];
  if (input.bossSoon) {
    // 首领前一日：必含对策（免伤优先）
    groups = [
      ['dodge', 'dmg', 'thorns', 'armor', 'leech', 'maxhp', 'crit'],
      ['dodge', 'dmg', 'armor', 'maxhp', 'leech', 'freeze', 'crit'],
    ];
  } else if (lowHp) {
    // HP<30%：防御优先
    groups = [
      ['dodge', 'leech', 'armor', 'maxhp'],
      ['maxhp', 'dodge', 'armor', 'leech', 'regen', 'freeze', 'dmg'],
    ];
  } else if (tier === 'low') {
    // acc<0.75：弱势保命
    groups = [
      ['leech', 'dodge', 'armor'],
      ['maxhp', 'leech', 'dodge', 'armor', 'regen', 'freeze', 'dmg'],
    ];
  } else if (tier === 'high') {
    // acc≥0.85：高手提速
    groups = [
      ['dmg', 'crit', 'freeze', 'combo', 'freezeAll', 'execute'],
      ['dmg', 'crit', 'freeze', 'maxhp', 'leech', 'armor'],
    ];
  } else {
    // 均衡
    groups = [
      ['maxhp', 'dmg', 'leech', 'crit', 'armor'],
      ['maxhp', 'dmg', 'leech', 'crit', 'armor', 'freeze', 'regen'],
    ];
  }

  const pool = groups.flat();
  const result: NormalBuff[] = [];
  // 硬约束：各上下文"核心对策"必含（组0 首位，可用则强制），其余槽位再受控随机 → 兼顾语义与多样性
  const core = groups[0]![0]!;
  if (available.includes(core) && result.length < 3) result.push(core);

  // 受控随机：候选内加权抽样（越靠前优先级权重越大），确保同上下文仍有随机多样性
  while (result.length < 3) {
    const candidates = pool.filter((b) => available.includes(b) && !result.includes(b));
    if (candidates.length === 0) break;
    const weights = candidates.map((c) => pool.length - pool.indexOf(c));
    const total = weights.reduce((a, b) => a + b, 0);
    let r = rng() * total;
    let pick = candidates[candidates.length - 1]!;
    for (let i = 0; i < candidates.length; i++) {
      r -= weights[i]!;
      if (r <= 0) {
        pick = candidates[i]!;
        break;
      }
    }
    result.push(pick);
  }

  // 补足（池外可用项）
  for (const b of available) {
    if (result.length >= 3) break;
    if (!result.includes(b)) result.push(b);
  }
  return result.slice(0, 3);
}

// 传说技能三选一（首领战后单局一次）：剔除已选传说，返回至多 3 项
export function pickLegends(chosen: string[]): LegendBuff[] {
  const used = new Set(chosen);
  return LEGEND_BUFF_POOL.filter((b) => !used.has(b)).slice(0, 3);
}
