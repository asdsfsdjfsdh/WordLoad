// buff 选择（上下文感知纯函数）：HP/acc 分支、满叠剔除、首领前对策；传说技能三选一
import { LEGEND_BUFF_POOL, NORMAL_BUFF_POOL, SURVIVAL, type LegendBuff, type NormalBuff } from '@word-journey/shared';

export interface BuffCounts {
  maxHp: number;
  leech: number;
  dmg: number;
  dodge: number;
  freeze: number;
}

export interface BuffPickInput {
  hp: number;
  maxHp: number;
  counts: BuffCounts;
  recentAcc?: number;   // 近 20 题正确率（undefined=无数据）
  bossSoon?: boolean;   // 首领前一日：必含对策
}

// 某 buff 是否已达叠加上限
export function buffAtCap(buff: NormalBuff, counts: BuffCounts): boolean {
  switch (buff) {
    case 'maxhp': return counts.maxHp >= SURVIVAL.BUFF_MAXHP_MAX;
    case 'dmg': return counts.dmg >= SURVIVAL.BUFF_DMG_MAX;
    case 'leech': return counts.leech >= SURVIVAL.BUFF_LEECH_MAX;
    case 'dodge': return counts.dodge >= SURVIVAL.BUFF_DODGE_MAX;
    case 'freeze': return counts.freeze >= SURVIVAL.BUFF_FREEZE_MAX;
  }
}

// 近 20 题 acc 分支
function accTier(acc: number | undefined): 'low' | 'mid' | 'high' {
  if (acc === undefined) return 'mid';
  if (acc < 0.75) return 'low';
  if (acc >= 0.85) return 'high';
  return 'mid';
}

// 上下文感知三选一：HP<30% 必含防御；acc<0.75 加权吸血/免伤；acc≥0.85 加权伤害/冻结；首领前必含对策
export function pickBuffs(input: BuffPickInput): NormalBuff[] {
  const { hp, maxHp, counts } = input;
  const lowHp = maxHp > 0 && hp / maxHp < 0.3;
  const tier = accTier(input.recentAcc);

  // 全池剔除满叠
  const available = NORMAL_BUFF_POOL.filter((b) => !buffAtCap(b, counts));
  if (available.length === 0) return [];

  const result: NormalBuff[] = [];
  const pushIfAvailable = (wanted: NormalBuff[]): void => {
    for (const b of wanted) {
      if (result.length >= 3) return;
      if (available.includes(b) && !result.includes(b)) result.push(b);
    }
  };

  // 首领前一日：必含 1 项对策（免伤 / Boss 伤害），其余按状态
  if (input.bossSoon) {
    pushIfAvailable(['dodge', 'dmg', 'leech', 'maxhp', 'freeze']);
    pushIfAvailable(['dodge', 'dmg', 'maxhp', 'leech', 'freeze']);
  } else if (lowHp) {
    // HP<30%：防御优先
    pushIfAvailable(['dodge', 'leech', 'maxhp']);
    pushIfAvailable(['maxhp', 'dodge', 'leech', 'freeze', 'dmg']);
  } else if (tier === 'low') {
    // acc<0.75：弱势保命
    pushIfAvailable(['leech', 'dodge']);
    pushIfAvailable(['maxhp', 'leech', 'dodge', 'freeze', 'dmg']);
  } else if (tier === 'high') {
    // acc≥0.85：高手提速
    pushIfAvailable(['dmg', 'freeze']);
    pushIfAvailable(['dmg', 'freeze', 'maxhp', 'leech', 'dodge']);
  } else {
    // 均衡
    pushIfAvailable(['maxhp', 'dmg', 'leech']);
    pushIfAvailable(['maxhp', 'dmg', 'leech', 'freeze', 'dodge']);
  }

  // 全池满叠返回空
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