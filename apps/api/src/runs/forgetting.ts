// 局内遗忘曲线（复习段选词，纯函数）：
// 双队列（干净/错词）+ 记忆强度随天数遗忘 + 答错恢复迁移 + 随机抖动。
// 每词的局内记忆状态从 RunItem 序列推导（无需持久化/迁移），
// 复习段按"遗忘紧迫度"降序取词，替代旧 review-queue 的一次性优先级。
//
// 与全局 SRS（UserWordProgress.nextReviewAt）的关系（有意脱钩，勿轻易对齐）：
// - 局内曲线只决定"本局复习位选哪些词"，作答后仍由 commitWaveSrs 走全局 SM-2 排程推进；
// - 二者的唯一交汇点：preMastery（局前掌握度作初始记忆强度）与 fallbackUrgency（错题本/日历到期，
//   仅对"局内从未出现"的词生效）。本局已用词一律按局内曲线复现，不受全局 nextReviewAt 约束——
//   局内重考会正常推进全局 SRS（答对 +1 档并重排间隔），属设计行为；
// - 改动本模块参数会直接影响 balance-sim.ts 的存活分布标定，须同步重跑仿真复核。
//
// 队列规则：
// - 干净队列（一次都没错过）：答对后进入静默期（REST_* 天），静默期后紧迫度随时间上升，
//   多次答对 / 局前掌握度高 → 遗忘更慢、复现间隔更长（Ebbinghaus 稳定化）。
// - 错词队列（答错过且未恢复）：错后次日即高紧迫复测，随后随时间衰减；
//   连续答对 RECOVER_STREAK 次 → 迁回干净队列，但以 RECOVER_WEIGHT 加权（仍优先复习）。
// - 随机：紧迫度 ±JITTER 抖动，打破"同类词每天选同一批"的确定性重复。
import { SURVIVAL } from '@word-journey/shared';

// ── 每词的局内记忆状态 ──
export interface RunWordMemory {
  lastSeq: number;       // 局内最后一次出现 seq（-1=未出现）
  lastWrongSeq: number;  // 局内最近一次答错 seq（-1=从未错）
  correctCount: number;  // 局内累计答对
  wrongCount: number;    // 局内累计答错
  streak: number;        // 距最近一次答错以来的连续答对数（从未错 = 累计答对数）
}

export type RunQueue = 'clean' | 'wrong';

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

// 从 RunItem 序列聚合每词内存（输入须按 seq 升序）
export function memoryOf(items: { seq: number; correct: boolean }[]): RunWordMemory {
  let lastSeq = -1;
  let lastWrongSeq = -1;
  let correctCount = 0;
  let wrongCount = 0;
  let streak = 0;
  for (const it of items) {
    if (it.seq > lastSeq) lastSeq = it.seq;
    if (it.correct) {
      correctCount++;
      streak++;
    } else {
      wrongCount++;
      lastWrongSeq = it.seq;
      streak = 0;
    }
  }
  return { lastSeq, lastWrongSeq, correctCount, wrongCount, streak };
}

export const emptyMemory = (): RunWordMemory => ({
  lastSeq: -1,
  lastWrongSeq: -1,
  correctCount: 0,
  wrongCount: 0,
  streak: 0,
});

// 队列划分：从未错 或 已连续答对 RECOVER_STREAK 次 → 干净队列；否则错词队列
export function queueOf(m: RunWordMemory): RunQueue {
  if (m.wrongCount === 0) return 'clean';
  return m.streak >= SURVIVAL.FORGETTING.RECOVER_STREAK ? 'clean' : 'wrong';
}

// 是否"恢复词"（曾答错、现已连续答对 ≥ RECOVER_STREAK，迁回干净队列后仍加权）
export function isRecovered(m: RunWordMemory): boolean {
  return m.wrongCount > 0 && m.streak >= SURVIVAL.FORGETTING.RECOVER_STREAK;
}

// 遗忘紧迫度（0..1，越高越该复现）：已掌握曲线 / 答错曲线 + 恢复加权 + 随机抖动
export function scoreOf(input: {
  memory: RunWordMemory;
  daysSince: number;      // 距最近一次出现（天）
  daysSinceWrong: number; // 距最近一次答错（天；从未错传 -1）
  preMastery?: number;    // 局前掌握度 0..1（初始记忆强度）
  fallbackUrgency?: number; // 局内从未出现的兜底紧迫度（如全局错题本/日历到期）
  rng?: () => number;
}): number {
  const g = SURVIVAL.FORGETTING;
  const rng = input.rng ?? Math.random;
  const { memory } = input;
  const s0 = clamp(input.preMastery ?? 0, 0, 1);
  const corrects = memory.correctCount;

  // 局内从未出现：直接按兜底紧迫度 + 抖动（供全局错题本/日历到期词使用）
  if (memory.lastSeq < 0 && input.fallbackUrgency !== undefined) {
    return clamp(input.fallbackUrgency + (rng() * 2 - 1) * g.JITTER, 0, 1);
  }

  let urgency: number;
  if (queueOf(memory) === 'wrong') {
    // 答错曲线：错后次日即高紧迫（daysSinceWrong≈1），随后按天衰减
    urgency = g.WRONG_URGENCY_BASE * Math.exp(-input.daysSinceWrong / g.WRONG_DECAY_DAYS);
  } else {
    // 已掌握曲线：答对后静默期（期内不复现），之后紧迫度随时间上升
    const strength = Math.min(1, s0 + corrects * g.STRENGTH_GAIN);
    let rest = g.REST_BASE_DAYS + g.REST_PER_CORRECT * Math.min(corrects, 4);
    if (s0 >= g.PRE_MASTERY_REST) rest += 1;
    rest = Math.min(rest, g.REST_CAP_DAYS + 1);
    const decayRate = Math.max(
      0.02,
      g.DECAY_BASE *
        (1 - g.DECAY_STABILIZE * Math.min(corrects, 4)) *
        (1 - g.PRE_MASTERY_BONUS * s0),
    );
    urgency = input.daysSince < rest ? 0 : 1 - strength * Math.exp(-decayRate * (input.daysSince - rest));
    if (isRecovered(memory)) urgency *= g.RECOVER_WEIGHT;
  }
  return clamp(urgency + (rng() * 2 - 1) * g.JITTER, 0, 1);
}

// ── 复习候选 ──
export interface ReviewCandidate {
  wordId: string;
  memory: RunWordMemory;
  preMastery?: number; // 局前掌握度 0..1
  fallbackUrgency?: number; // 局内从未出现的兜底紧迫度（0..1）
}

// 按遗忘紧迫度降序取 need 个，剔除 usedInDay（当日已排词）
export function pickReviewWords(opts: {
  candidates: ReviewCandidate[];
  need: number;
  maxSeq: number; // 当前最大已答 seq，折算遗忘天数
  usedInDay?: Set<string>;
  rng?: () => number;
}): ReviewCandidate[] {
  const { candidates, need, maxSeq, usedInDay, rng = Math.random } = opts;
  if (need <= 0) return [];
  const qpd = SURVIVAL.QUESTIONS_PER_DAY;
  // 天折算：刚完成的那波视为"1 天前"（+1 偏移），波内相对位置取整近似
  const toDays = (seq: number): number => (seq >= 0 ? 1 + Math.max(0, (maxSeq - seq) / qpd) : 0);
  const scored = candidates
    .filter((c) => !usedInDay?.has(c.wordId))
    .map((c) => ({
      c,
      score: scoreOf({
        memory: c.memory,
        daysSince: toDays(c.memory.lastSeq),
        daysSinceWrong: toDays(c.memory.lastWrongSeq),
        preMastery: c.preMastery,
        fallbackUrgency: c.fallbackUrgency,
        rng,
      }),
    }))
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, need).map((s) => s.c);
}
