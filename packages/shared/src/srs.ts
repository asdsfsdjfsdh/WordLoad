// SRS 展示层纯函数：档位文案 / 间隔天数 / 下次复习标签
// 与 apps/api/src/sessions/settlement.ts 的 srsSchedule 同源口径（intervalDays 唯一定义于此）

// 间隔天数：随 reviewStage 指数增长（迁移自 settlement.ts，settlement 处 re-export 保持兼容）
export function intervalDays(stage: number): number {
  if (stage <= 0) return 0;
  if (stage === 1) return 1;
  if (stage === 2) return 3;
  if (stage === 3) return 7;
  if (stage === 4) return 14;
  if (stage === 5) return 30;
  return Math.min(30 + (stage - 5) * 10, 90);
}

// 记忆档位元信息（reviewStage → 文案/图标/色系），供图鉴卡片与轨迹展示
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
  if (s === 3) return { stage: 3, label: '已掌握', icon: '⭐', tone: 'emerald' };
  if (s === 4) return { stage: 4, label: '长期记忆', icon: '🧠', tone: 'violet' };
  return { stage: 5, label: '大师', icon: '👑', tone: 'violet' };
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
