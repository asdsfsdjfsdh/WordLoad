// 红宝书 Unit 肉鸽 Run 通关判定（纯函数）：
// 出题与通关都以"错词"为核心信号：
// - 错词层 = 本局答错过且未恢复（连续答对 < RECOVER_STREAK）→ 每天第一优先重测
// - 新词层 = 本局未出场且非"预会" → 第二优先
// - 复习词层 = 本局出场且已会 → 仅填空位
// 胜利条件 = Unit 全部词（排除已斩）done（预会 或 出场且无未恢复错词）→ 触发 Final Boss。
// 首通一次性加成：该 (user, stage) 此前无 cleared unit run 记录。
import { UNIT_BOSS } from '@word-journey/shared';

export interface UnitWordState {
  wordId: string;
  preMastery: number;   // 局前全局掌握度 0..100（重开继承信号）
  rc: number;           // 本局答对数
  wrongCount: number;   // 本局答错数
  streak: number;       // 距最近一次答错以来的连续答对数（从未错 = 累计答对数）
  served: boolean;      // 本局是否已出场（有 RunItem）
  skipped: boolean;     // 已斩词：不参与出题与通关判定
}

// 预会：重开继承，全局已掌握 → 直接算完成
export function isPreKnown(s: UnitWordState): boolean {
  return s.preMastery >= UNIT_BOSS.MASTERY_THRESHOLD;
}

// 错词层：本局答错过且未恢复（连续答对 < RECOVER_STREAK）
export function isUnitWrong(s: UnitWordState): boolean {
  return s.wrongCount > 0 && s.streak < UNIT_BOSS.RECOVER_STREAK;
}

// 已会：预会 或（本局出场过 且 当前不在错词层）
export function isUnitDone(s: UnitWordState): boolean {
  if (s.skipped) return true;
  if (isPreKnown(s)) return true;
  return s.served && s.rc >= 1 && !isUnitWrong(s);
}

export interface UnitProgress {
  total: number;          // 参与判定的词数（排除已斩）
  doneCount: number;      // 已会词数（用于 HUD 展示）
  doneAll: boolean;       // 全部非斩词已会（→ 触发 Final Boss）
}

export function unitProgressOf(entries: UnitWordState[]): UnitProgress {
  const active = entries.filter((e) => !e.skipped);
  const done = active.filter(isUnitDone).length;
  return {
    total: active.length,
    doneCount: done,
    doneAll: active.length > 0 && done === active.length,
  };
}

// 首通判定：此前无通关记录 → 结算给一次性加成
export function isFirstClear(hasPriorClear: boolean): boolean {
  return !hasPriorClear;
}
