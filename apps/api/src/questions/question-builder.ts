// 服务端出题核心（纯函数）：抽词比例 / 义项轮换 / 易混补抽 / 挖空模板
// 契约：Question 由 shared 定义；本模块只做算法编排，不触碰数据库
import type { DifficultyTier, GameMode, Question } from '@word-journey/shared';

// 抽词来源
export type QuestionSource = 'new' | 'review' | 'wrongbook';

// 抽词比例 60:25:15（新词 / 复习 / 错题本）
export const MIX_RATIO: readonly [number, number, number] = [60, 25, 15];

// 按比例把总数分配到三个来源（贪心取整，保证总和=total）
export function allocMix(total: number): { new: number; review: number; wrongbook: number } {
  const [n, r, w] = MIX_RATIO;
  const sum = n + r + w;
  let fresh = Math.floor((total * n) / sum);
  let review = Math.floor((total * r) / sum);
  let wrongbook = Math.floor((total * w) / sum);
  let rest = total - fresh - review - wrongbook;
  // 余数按比例最大的来源优先补齐
  const orderAlphabet: ('new' | 'review' | 'wrongbook')[] = ['new', 'review', 'wrongbook'];
  const order: ('new' | 'review' | 'wrongbook')[] = orderAlphabet.sort((a, b) => {
    const target = (k: 'new' | 'review' | 'wrongbook'): number =>
      (k === 'new' ? n : k === 'review' ? r : w) / sum;
    return target(b) - target(a);
  });
  for (let i = 0; i < rest; i++) {
    const k = order[i % order.length];
    if (k === 'new') fresh++;
    else if (k === 'review') review++;
    else wrongbook++;
  }
  return { new: fresh, review, wrongbook };
}

// 义项轮换：在多次考核间尽量平均覆盖各义项
// states: 每个义项的最近状态（reviewStage 越大越熟、lastTestedAt 越久远越优先）
export function rotateSense(
  states: { idx: number; reviewStage: number; lastTestedAt: number }[],
): number {
  if (states.length === 0) return 0;
  const sorted = [...states].sort((a, b) => {
    if (a.reviewStage !== b.reviewStage) return a.reviewStage - b.reviewStage;
    if (a.lastTestedAt !== b.lastTestedAt) return a.lastTestedAt - b.lastTestedAt;
    return a.idx - b.idx;
  });
  return (sorted[0] as { idx: number }).idx;
}

// 易混补抽：从词对表里找出与给定词构成易混对的另一侧
export interface ConfusableLookup {
  wordA: string;
  wordB: string;
  type: 'orthographic' | 'homophone' | 'near-synonym';
}
export function findConfusable(wordText: string, pairs: ConfusableLookup[]): string | null {
  for (const p of pairs) {
    if (p.wordA === wordText) return p.wordB;
    if (p.wordB === wordText) return p.wordA;
  }
  return null;
}

// 挖空模板：按给定索引把字母换成下划线，返回模板与填空位置数组
export function maskTemplate(
  word: string,
  blankIndexes: number[],
  mark = '_',
): { template: string; blanks: number[] } {
  const chars = word.split('');
  const blanks: number[] = [];
  blankIndexes.forEach((i) => {
    if (i >= 0 && i < chars.length) {
      chars[i] = mark;
      blanks.push(i);
    }
  });
  return { template: chars.join(''), blanks };
}

// 生成一道题：中译英（释义打底 + 拼写挖空）或听写（音标打底 + 拼写挖空）
export function buildQuestion(opts: {
  seq: number;
  wordId: string;
  senseIdx: number;
  text: string;
  promptBase: string; // 中文释义（中译英）或音标（听写）
  example?: string;
  tier: DifficultyTier;
  mode: GameMode;
  confusable?: { counterpart: string; note: string } | null;
}): Question {
  const { text, mode } = opts;
  // 挖空策略：保留首字母，其余挖空（听写模式保留首尾，降低全听写出错率）
  const blanks =
    mode === 'dictation'
      ? Array.from({ length: text.length - 2 }, (_, i) => i + 1)
      : Array.from({ length: text.length - 1 }, (_, i) => i + 1);
  const { template } = maskTemplate(text, blanks);
  const note = opts.confusable;
  return {
    seq: opts.seq,
    wordId: opts.wordId,
    senseIdx: opts.senseIdx,
    type: 'fill-blank',
    prompt: opts.promptBase,
    template,
    blanks,
    note: note ? `${note.note}（区分 ${note.counterpart}）` : opts.example ?? undefined,
    tier: opts.tier,
  };
}