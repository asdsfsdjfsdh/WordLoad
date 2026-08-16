// 红宝书 Unit 肉鸽 Run 通关判定与出题选择（纯函数）：
// 核心信号 = "错词"（本局未恢复错词 + 全局错题本），"会了" = 历史答对过（correctCount≥1）或本局答对且无需重测。
// - 错词层 = 本局答错未恢复 或 全局错题本 → 每天第一优先重测
// - 新词层 = 本局未出场且非"预会" → 第二优先（按难度混合 + 弱项 tier 提前）
// - 复习词层 = 本局出场且已会 → 仅填空位
// 胜利条件 = Unit 全部词（排除已斩）done（预会 或 出场且无未恢复错词）→ 触发 Final Boss。
import { UNIT_BOSS } from '@word-journey/shared';
import type { DifficultyTier } from '@word-journey/shared';

export interface UnitWordState {
  wordId: string;
  preKnown: boolean;     // 重开继承：局前全局 correctCount ≥ 1（历史答对过）
  preMastery: number;    // 局前全局掌握度 0..100（复习排序用）
  inWrongBook: boolean;  // 全局错题本（历史答错未摘标）
  rc: number;            // 本局答对数
  wrongCount: number;    // 本局答错数
  streak: number;        // 距最近一次答错以来的连续答对数（从未错 = 累计答对数）
  hasSlowWrong: boolean; // 本局是否存在"慢错"（elapsedMs ≥ SLOW_WRONG_MS，视为真不会）
  served: boolean;       // 本局是否已出场（有 RunItem）
  skipped: boolean;      // 已斩词：不参与出题与通关判定
}

// 错词恢复门槛：慢错（真不会）需更多连续答对
export function requiredStreak(s: UnitWordState): number {
  return s.hasSlowWrong ? UNIT_BOSS.RECOVER_SLOW : UNIT_BOSS.RECOVER_STREAK;
}

// 本局错词未恢复（连续答对 < requiredStreak）
export function isInRunWrong(s: UnitWordState): boolean {
  return s.wrongCount > 0 && s.streak < requiredStreak(s);
}

// 需要重测：本局错词未恢复 或 全局错题本
export function needsRetest(s: UnitWordState): boolean {
  return isInRunWrong(s) || s.inWrongBook;
}

// 预会：重开继承，历史答对过 → 直接算完成（但若仍在全局错题本则需重测）
export function isPreKnown(s: UnitWordState): boolean {
  return s.preKnown;
}

// 已会：预会（且不在错题本）或（本局出场过 且 答对过 且 无需重测）
export function isUnitDone(s: UnitWordState): boolean {
  if (s.skipped) return true;
  if (isPreKnown(s) && !s.inWrongBook) return true;
  return s.served && s.rc >= 1 && !needsRetest(s);
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

// ── 新词挑选（O3 难度混合 + C4 弱项 tier 提前）──
// 从候选新词中取 need 个：弱项 tier（本局错得最多的难度档）优先，其余按 tier 轮转取，保证每天混有易/中/难词。
export interface NewWordCandidate {
  wordId: string;
  tier: DifficultyTier; // I / II / III / IV
}

const TIER_ORDER: DifficultyTier[] = ['I', 'II', 'III', 'IV'];

export function pickNewWords(
  candidates: NewWordCandidate[], // 已按难度升序传入
  need: number,
  weakTier: DifficultyTier | null,
): NewWordCandidate[] {
  if (need <= 0 || candidates.length === 0) return [];
  // 按 tier 分组（保持组内难度升序）
  const byTier = new Map<DifficultyTier, NewWordCandidate[]>();
  for (const c of candidates) {
    const list = byTier.get(c.tier) ?? [];
    list.push(c);
    byTier.set(c.tier, list);
  }
  // 出词顺序：弱项 tier 优先，随后按 I→IV 轮转（round-robin 保证混有各档）
  const order: DifficultyTier[] = [];
  if (weakTier && byTier.has(weakTier)) order.push(weakTier);
  for (const t of TIER_ORDER) if (!order.includes(t) && byTier.has(t)) order.push(t);

  const picked: NewWordCandidate[] = [];
  const cursors = new Map<DifficultyTier, number>(order.map((t) => [t, 0]));
  while (picked.length < need) {
    let progress = false;
    for (const t of order) {
      const bucket = byTier.get(t) ?? [];
      const i = cursors.get(t) ?? 0;
      if (i < bucket.length) {
        picked.push(bucket[i]!);
        cursors.set(t, i + 1);
        progress = true;
        if (picked.length >= need) break;
      }
    }
    if (!progress) break; // 全部候选耗尽
  }
  return picked;
}

// 首通判定：此前无通关记录 → 结算给一次性加成
export function isFirstClear(hasPriorClear: boolean): boolean {
  return !hasPriorClear;
}
