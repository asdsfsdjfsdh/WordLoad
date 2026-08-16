// 注入决策（纯函数）：轻量 Q + 保底 5，严格隔天，首领波日不注，acc 门控
// 例外：当天全对（acc=1）视为学习节奏优秀 → 次日强制注入（绕过冷却与首领日限制）
import { SURVIVAL, injectAmount } from '@word-journey/shared';

export interface InjectDecisionInput {
  day: number;             // 次日天数（day+1）
  lastInjectDay: number;   // 上次注入日（0=从未）
  acc: number;             // 近 20 题正确率
  qLight: number;          // 本局累计错词数
  bossJustCleared: boolean; // 首领波日不注
}

export interface InjectDecision {
  inject: boolean;
  amount: number;
}

// acc < 强制停止阈值：停止注入（弱玩家纯复习）；连续低于仍继续则不再注入
export function shouldInject(input: InjectDecisionInput): InjectDecision {
  const { day, lastInjectDay, acc, qLight, bossJustCleared } = input;
  const perfect = acc >= 1;
  // 首领波日不注；全对例外：Boss 天全对 → 次日仍注入
  if (bossJustCleared && !perfect) return { inject: false, amount: 0 };
  // 严格隔天交替；全对例外：当天全对 → 次日即注入
  if (day - lastInjectDay < SURVIVAL.INJECT_COOLDOWN_DAYS && !perfect) return { inject: false, amount: 0 };
  if (acc < SURVIVAL.INJECT_ACC_GATE) return { inject: false, amount: 0 };
  const amount = injectAmount(qLight);
  if (amount <= 0) return { inject: false, amount: 0 };
  return { inject: true, amount };
}

// acc 连续低天数（弱玩家保护）：返回是否应强制停止注入
export function shouldForceStop(accHistory: number[]): boolean {
  const recent = accHistory.slice(-SURVIVAL.INJECT_STRICT_STOP_DAYS);
  if (recent.length < SURVIVAL.INJECT_STRICT_STOP_DAYS) return false;
  return recent.every((a) => a < SURVIVAL.INJECT_ACC_FORCE_STOP);
}