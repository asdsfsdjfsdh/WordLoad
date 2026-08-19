// SRS 展示层纯函数：档位文案 / 间隔天数 / 下次复习标签
// 与 apps/api/src/sessions/settlement.ts 的 srsSchedule 同源口径（intervalDays 唯一定义于此）
import type { DifficultyTier } from './api.js';

// 记忆学常量（真源）
export const EASE_BASELINE = 2.5; // 标准难度系数（ease 相对此值缩放间隔）
export const INTERVAL_CAP_DAYS = 180; // 间隔上限（大师级长间隔；原 90 天偏保守，放宽到 180）

// 间隔天数：随 reviewStage 指数增长（迁移自 settlement.ts，settlement 处 re-export 保持兼容）
export function intervalDays(stage: number): number {
  if (stage <= 0) return 0;
  if (stage === 1) return 1;
  if (stage === 2) return 3;
  if (stage === 3) return 7;
  if (stage === 4) return 14;
  if (stage === 5) return 30;
  return Math.min(30 + (stage - 5) * 10, INTERVAL_CAP_DAYS);
}

// 实际间隔：intervalDays × (ease / 基线)，让"吃力"(ease<2.5)的词缩短间隔、"稳定"(ease>2.5)的词拉长间隔。
// 这是 SM-2 的核心：ease 因子调节间隔、反映个人难度（此前 ease 只存不用，此处真正生效）。
export function effectiveIntervalDays(stage: number, ease: number): number {
  const base = intervalDays(stage);
  if (base <= 0) return 0;
  const e = Math.min(Math.max(ease, 1.3), 2.8);
  const days = Math.round(base * (e / EASE_BASELINE));
  return Math.max(1, Math.min(days, INTERVAL_CAP_DAYS));
}

// 新词初始 ease：按难度档位联动（难词从更低 ease 起步 → 更频繁复习，ease 参与间隔后即真正生效）
export function initialEaseForTier(tier: DifficultyTier | string | null | undefined): number {
  switch (tier) {
    case 'I': return 2.6;
    case 'II': return 2.5;
    case 'III': return 2.3;
    case 'IV': return 2.1;
    default: return EASE_BASELINE;
  }
}

// 记忆档位元信息（reviewStage → 文案/图标/色系），供图鉴卡片与轨迹展示
// 掌握门槛上调（MASTER_STAGE 3→4）后：stage 3 为"熟练"，stage 4 才是"已掌握"
export interface SrsStageMeta {
  stage: number;
  label: string;
  icon: string;
  tone: 'sky' | 'amber' | 'emerald' | 'cyan' | 'violet';
}

export function srsStageMeta(stage: number): SrsStageMeta {
  const s = Math.max(0, stage);
  if (s === 0) return { stage: 0, label: '新词', icon: '✨', tone: 'sky' };
  if (s === 1) return { stage: 1, label: '学习中', icon: '📖', tone: 'amber' };
  if (s === 2) return { stage: 2, label: '熟悉', icon: '📗', tone: 'cyan' };
  if (s === 3) return { stage: 3, label: '熟练', icon: '📘', tone: 'cyan' };
  if (s === 4) return { stage: 4, label: '已掌握', icon: '⭐', tone: 'emerald' };
  if (s === 5) return { stage: 5, label: '长期记忆', icon: '🧠', tone: 'violet' };
  return { stage: 6, label: '大师', icon: '👑', tone: 'violet' };
}

// 下次复习时间 → 人性化标签（"已到期 / 今天 / 明天 / N 天后 / 未排程"）
export function nextReviewLabel(nextReviewAt: string | null, now: number = Date.now()): string {
  if (!nextReviewAt) return '未排程';
  const t = new Date(nextReviewAt).getTime();
  if (t <= now) return '已到期';
  const ms = t - now;
  const days = Math.ceil(ms / 86400000);
  if (days <= 1) return '今天';
  if (days === 2) return '明天';
  return `${days}天后`;
}
