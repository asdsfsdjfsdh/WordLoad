// 复习队列优先级（纯函数）：错词优先 → 已学未二次复测 → 日历到期 → 将到期 → 其余
export interface ReviewCandidate {
  wordId: string;
  inWrongBook?: boolean;   // 本局答错过
  seenCount?: number;      // 本局已出现次数（1=未二次复测）
  dueAt?: number;          // SRS 到期时间戳（0=未到期）
  mastery?: number;        // 0-100
}

export interface ReviewQueueInput {
  candidates: ReviewCandidate[];
  need: number;
  usedInDay?: Set<string>; // 当天已排词，避免重复
}

export type ReviewPriority =
  | 'wrong'       // 本局错词（boss 未修正最优先）
  | 'seen-once'   // 已学未二次复测
  | 'due'         // 日历到期
  | 'soon-due'    // 将到期（今+1）
  | 'low-mastery' // 池内 mastery<50
  | 'other';

// 优先级映射：数字越小越优先
export function reviewPriorityOf(c: ReviewCandidate): ReviewPriority {
  if (c.inWrongBook) return 'wrong';
  if ((c.seenCount ?? 0) === 1) return 'seen-once';
  if ((c.dueAt ?? 0) > 0 && (c.dueAt ?? 0) <= Date.now()) return 'due';
  if ((c.dueAt ?? 0) > 0) return 'soon-due';
  if ((c.mastery ?? 0) < 50) return 'low-mastery';
  return 'other';
}

const PRIORITY_ORDER: Record<ReviewPriority, number> = {
  wrong: 0,
  'seen-once': 1,
  due: 2,
  'soon-due': 3,
  'low-mastery': 4,
  other: 5,
};

// 排序键：先优先级，再按到期时间升序（同优先级到期早的优先）
export function sortReviews(candidates: ReviewCandidate[]): ReviewCandidate[] {
  return [...candidates].sort((a, b) => {
    const pa = PRIORITY_ORDER[reviewPriorityOf(a)];
    const pb = PRIORITY_ORDER[reviewPriorityOf(b)];
    if (pa !== pb) return pa - pb;
    return (a.dueAt ?? 0) - (b.dueAt ?? 0);
  });
}

// 组队：按优先级取 need 个，剔除当天已排词
export function buildReviewQueue(input: ReviewQueueInput): ReviewCandidate[] {
  const { candidates, need, usedInDay } = input;
  if (need <= 0) return [];
  const usable = candidates.filter((c) => !usedInDay?.has(c.wordId));
  return sortReviews(usable).slice(0, need);
}