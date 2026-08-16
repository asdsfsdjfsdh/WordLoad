// 会话结算核心（纯函数）：评级 / 经验 / 掉落 / SRS 排程
import type { Rating } from '@word-journey/shared';
// 间隔天数唯一定义在 shared（图鉴/结算共用），此处 re-export 保持现有调用方兼容
export { intervalDays } from '@word-journey/shared';

// 单题提交结果（客户端上报）
export interface AnswerInput {
  seq: number;
  correct: boolean;
  elapsedMs: number;
  // 用户实际输入（可选）：提供后服务端以它与标准答案比对为准，忽略 correct 字段
  typed?: string;
}

// SRS 排程：SM-2 简化版。正确提升等级并延长间隔，错误降级重置
export interface ReviewState {
  reviewStage: number; // 0 表示新词未排程
  ease: number; // 简易度因子
}

// 服务端权威判题：必须有 typed 且与标准答案一致才判对；无 typed 一律按错（防客户端伪造 correct）
export function isAnswerCorrect(typed: string | null | undefined, truth: string): boolean {
  if (typed === undefined || typed === null || typed === '') return false;
  return typed.trim().toLowerCase() === truth.trim().toLowerCase();
}

// 掌握度统一口径：reviewStage 达到 MASTER_STAGE 次正确复习视为掌握（mastery 100）
export const MASTER_STAGE = 3;
export function masteryFromStage(stage: number): number {
  return Math.min(100, Math.round((Math.max(0, stage) / MASTER_STAGE) * 100));
}

// 错题本摘标门槛：连续答对次数达到该值才出错题本
export const WRONGBOOK_CLEAR_STREAK = 2;

// 错题本状态（inWrongBook + 连续答对计数）
export interface WrongbookState {
  inWrongBook: boolean;
  wrongStreak: number;
}

// 错题本状态转移（普通会话与生存 Run 共用同一口径）：
// - 不在本 + 答错 → 进错题本，streak 归零
// - 在本 + 答错 → streak 归零
// - 在本 + 答对 → streak+1，≥ WRONGBOOK_CLEAR_STREAK 摘标
// - 不在本 + 答对 → 保持
export function applyWrongbookState(
  cur: WrongbookState | null,
  answers: { correct: boolean }[],
): WrongbookState {
  let state: WrongbookState = cur ?? { inWrongBook: false, wrongStreak: 0 };
  for (const a of answers) {
    if (a.correct) {
      if (state.inWrongBook) {
        const streak = state.wrongStreak + 1;
        state = streak >= WRONGBOOK_CLEAR_STREAK
          ? { inWrongBook: false, wrongStreak: 0 }
          : { inWrongBook: true, wrongStreak: streak };
      }
    } else {
      state = { inWrongBook: true, wrongStreak: 0 };
    }
  }
  return state;
}

export function srsSchedule(state: ReviewState | null, correct: boolean): ReviewState {
  const ease = (state?.ease ?? 2.5) + (correct ? 0.1 : -0.5);
  const clamped = Math.min(Math.max(ease, 1.3), 2.8);
  if (!correct) {
    // 阶梯降级而非归零：错一次降 2 级（不低于 1），避免“前功尽弃”
    const prevStage = state?.reviewStage ?? 0;
    const newStage = Math.max(1, prevStage - 2);
    return { reviewStage: newStage, ease: clamped };
  }
  const stage = (state?.reviewStage ?? 0) + 1;
  return { reviewStage: stage, ease: clamped };
}

// 图鉴 SRS 档位变更史（粗粒度复习轨迹）：仅在档位变化时追加一条 {stage, at}
export function appendStageHistory(
  prev: unknown,
  prevStage: number,
  newStage: number,
  at: Date,
): { stage: number; at: string }[] {
  const list: { stage: number; at: string }[] = Array.isArray(prev)
    ? (prev as { stage?: number; at?: string }[])
        .filter((e) => e && typeof e === 'object' && typeof e.stage === 'number')
        .map((e) => ({ stage: e.stage as number, at: String(e.at) }))
    : [];
  if (newStage === prevStage) return list;
  return [...list, { stage: newStage, at: at.toISOString() }];
}

// 角色等级：达到 level 所需累计经验 = 100 * (level-1) * level / 2（三角递增，早期快后期慢）
export function expForLevel(level: number): number {
  const l = Math.max(1, level);
  return (100 * (l - 1) * l) / 2;
}

// 由累计经验推导等级
export function levelFromExp(exp: number): number {
  let level = 1;
  while (expForLevel(level + 1) <= Math.max(0, exp)) level++;
  return level;
}

// 评级：根据正确率与平均耗时打分，映射 C~SSS
export function computeRating(opts: {
  total: number;
  correct: number;
  avgElapsedMs: number;
  perfectBonus: boolean;
}): Rating {
  const { total, correct, avgElapsedMs, perfectBonus } = opts;
  if (total === 0) return 'C';
  const accuracy = correct / total;
  // 满分 100：正确率 60 + 速度分 25 + 无错奖励 15
  const speedScore = Math.max(0, 25 * (1 - avgElapsedMs / 15000));
  const bonus = perfectBonus ? 15 : 0;
  const score = accuracy * 60 + speedScore + bonus;
  if (score >= 95) return 'SSS';
  if (score >= 85) return 'SS';
  if (score >= 75) return 'S';
  if (score >= 60) return 'A';
  if (score >= 45) return 'B';
  return 'C';
}

export function ratingExp(r: Rating): number {
  const map: Record<Rating, number> = { C: 5, B: 10, A: 18, S: 30, SS: 50, SSS: 80 };
  return map[r];
}

// 金币：正确每题 +2 基础，SSS 额外 +10
export function computeCoins(answers: AnswerInput[], rating: Rating): number {
  const base = answers.filter((a) => a.correct).length * 2;
  return base + (rating === 'SSS' ? 10 : 0);
}

// 掉落：评级越高掉稀有材料概率越大（材料 tier 1~4）
export interface Drop {
  materialCode: string;
  tier: 1 | 2 | 3 | 4;
  count: number;
}

export const MATERIAL_TIERS: { tier: 1 | 2 | 3 | 4; name: string; code: string }[] = [
  { tier: 1, name: '普通精华', code: 'essence_1' },
  { tier: 2, name: '稀有精华', code: 'essence_2' },
  { tier: 3, name: '史诗精华', code: 'essence_3' },
  { tier: 4, name: '传说精华', code: 'essence_4' },
];

// 掉落概率：rating 越高，高 tier 材料概率越高
export function rollDrops(rating: Rating, rng: () => number = Math.random): Drop[] {
  const dropRates: Record<Rating, number[]> = {
    C: [0.3, 0, 0, 0],
    B: [0.5, 0.2, 0, 0],
    A: [0.7, 0.4, 0.1, 0],
    S: [0.9, 0.6, 0.25, 0.05],
    SS: [1, 0.8, 0.4, 0.1],
    SSS: [1, 1, 0.6, 0.2],
  };
  const rates = dropRates[rating];
  const drops: Drop[] = [];
  rates.forEach((rate, i) => {
    if (rng() < rate) {
      const m = MATERIAL_TIERS[i];
      if (m) drops.push({ materialCode: m.code, tier: m.tier, count: 1 });
    }
  });
  return drops;
}