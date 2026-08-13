// Boss 双驱动触发判定（决策 9，纯函数）
import { SURVIVAL } from '@word-journey/shared';

export interface BossTriggerState {
  day: number;
  lastBossDay: number;            // 上次首领波天（0=未打过）
  everBoss: boolean;              // 是否已打过首领
  cumulativeConsumed: number;     // 本局累计消耗新词数
  lastBossConsumed: number;       // 上次首领波时累计消耗
}

/**
 * 双驱动：
 *  - 距上次首领 < minGap → 不触发
 *  - 累计新词消耗 ≥ 上次首领时 + BOSS_WORD_INTERVAL → 触发（学习量驱动）
 *  - 距上次首领 ≥ maxGap → 强制触发（防拖）
 *  - day==firstBossDay 且从未打 → 首次触发（新手缓冲）
 */
export function shouldTriggerBoss(s: BossTriggerState): boolean {
  if (s.day < SURVIVAL.BOSS_FIRST_DAY) return false;
  const gap = s.day - s.lastBossDay;
  if (gap < SURVIVAL.BOSS_MIN_GAP_DAYS) return false;
  if (s.cumulativeConsumed - s.lastBossConsumed >= SURVIVAL.BOSS_WORD_INTERVAL) return true;
  if (gap >= SURVIVAL.BOSS_MAX_GAP_DAYS) return true;
  if (s.day === SURVIVAL.BOSS_FIRST_DAY && !s.everBoss) return true;
  return false;
}
