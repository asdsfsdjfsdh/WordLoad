// 奖励与纪录（纯函数）：天数奖励封顶、收枪衰减、破纪录幂等、材料稀有度
import type { Rating } from '@word-journey/shared';
import { SURVIVAL, materialTierAt } from '@word-journey/shared';
import { ratingExp } from '../sessions/settlement';

export interface RewardInput {
  rating: Rating;
  correctCount: number;
  daysSurvived: number;
  bossClearedCount: number;
  surrender: boolean;
  perfect: boolean;
}

export interface Rewards {
  xp: number;
  coins: number;
  materialTier: number; // 结算可掉落的最高材料稀有度（1~4）
}

// xp = ratingExp + 3·min(day,20)；coins = 答对数×2 + (SSS?10) + 首领数×5 + day；收枪 ×0.5
export function computeRewards(input: RewardInput): Rewards {
  const { rating, correctCount, daysSurvived, bossClearedCount, surrender, perfect } = input;
  const dayBonus = SURVIVAL.XP_DAY_BASE * Math.min(daysSurvived, SURVIVAL.XP_DAY_CAP);
  const xp = ratingExp(rating) + dayBonus;

  let coins =
    correctCount * SURVIVAL.COINS_PER_CORRECT +
    (perfect ? 10 : 0) +
    bossClearedCount * SURVIVAL.COINS_PER_BOSS +
    daysSurvived;
  if (surrender) coins = Math.round(coins * SURVIVAL.SURRENDER_RATE);

  return { xp, coins, materialTier: materialTierAt(daysSurvived) };
}

// 破纪录判定：仅死亡结算（非收枪）且 day > 历史最大
export function isRecordBroken(daysSurvived: number, prevBest: number, surrender: boolean): boolean {
  if (surrender) return false;
  return daysSurvived > prevBest;
}