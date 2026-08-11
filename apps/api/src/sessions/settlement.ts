// 会话结算核心（纯函数）：评级 / 经验 / 掉落 / SRS 排程
import type { Rating } from '@word-journey/shared';

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

export function srsSchedule(state: ReviewState | null, correct: boolean): ReviewState {
  const ease = (state?.ease ?? 2.5) + (correct ? 0.1 : -0.5);
  const clamped = Math.min(Math.max(ease, 1.3), 2.8);
  if (!correct) return { reviewStage: 1, ease: clamped };
  const stage = (state?.reviewStage ?? 0) + 1;
  return { reviewStage: stage, ease: clamped };
}

// 间隔天数：随 reviewStage 指数增长
export function intervalDays(stage: number): number {
  if (stage <= 0) return 0;
  if (stage === 1) return 1;
  if (stage === 2) return 3;
  if (stage === 3) return 7;
  if (stage === 4) return 14;
  if (stage === 5) return 30;
  return Math.min(30 + (stage - 5) * 10, 90);
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
  tier: number;
  count: number;
}

export const MATERIAL_TIERS: { tier: number; name: string; code: string }[] = [
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