// 服务端出题核心（纯函数）：抽词比例 / 义项轮换 / 易混补抽 / 挖空模板
// 契约：Question 由 shared 定义；本模块只做算法编排，不触碰数据库
import type { DifficultyTier, FoilOption, GameMode, Question } from '@word-journey/shared';

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

// 选中文模式候选池项（服务端一次性打包，前端据此组选项；不包含正确答案本体，仅做干扰项来源）
export interface FoilPoolInput {
  text: string;
  meaning: string;
  confusableTexts: string[]; // 易混词形（优先作干扰项）
}
export function buildFoilPool(pool: FoilPoolInput[]): FoilOption[] {
  return pool.map((p) => ({
    text: p.text,
    meaning: p.meaning,
    confusableTexts: p.confusableTexts.length > 0 ? p.confusableTexts : undefined,
  }));
}

// 生成一道题：中译英（释义打底 + 拼写挖空）、听写（音标打底 + 拼写挖空）或选中文（英文打底 + 选项组）
export function buildQuestion(opts: {
  seq: number;
  wordId: string;
  senseIdx: number;
  text: string;
  promptBase: string; // 中文释义（中译英/选中文）或音标（听写）
  example?: string;
  phonetic?: string; // 音标（两种模式均下发展示/发音用）
  tier: DifficultyTier;
  mode: GameMode;
  source?: 'new' | 'review' | 'wrongbook' | 'boss';
}): Question {
  const { text, mode } = opts;
  // 选中文：不挖空，前端从 foilPool 组 4 选项，服务端只下发正确答案对应释义
  if (mode === 'choice') {
    return {
      seq: opts.seq,
      wordId: opts.wordId,
      senseIdx: opts.senseIdx,
      type: 'choice',
      prompt: text,
      template: '',
      blanks: [],
      phonetic: opts.phonetic,
      example: opts.example,
      tier: opts.tier,
      answer: text,
      answerMeaning: opts.promptBase,
      source: opts.source,
    };
  }
  // 挖空策略：保留首字母，其余挖空（听写模式保留首尾，降低全听写出错率）
  const blanks =
    mode === 'dictation'
      ? Array.from({ length: text.length - 2 }, (_, i) => i + 1)
      : Array.from({ length: text.length - 1 }, (_, i) => i + 1);
  const { template } = maskTemplate(text, blanks);
  return {
    seq: opts.seq,
    wordId: opts.wordId,
    senseIdx: opts.senseIdx,
    type: 'fill-blank',
    prompt: opts.promptBase,
    template,
    blanks,
    phonetic: opts.phonetic,
    example: opts.example,
    tier: opts.tier,
    answer: text,
    source: opts.source,
  };
}

// Boss 段词池分配：错词（优先）→ 通过词（抽 passedRatio）→ 历史错词 → 随机打乱
export function allocBossPool(
  opts: {
    wrong: string[];
    passed: string[];
    history: string[];
    passedRatio?: number;
    capacity?: number;
  },
  rng: () => number = Math.random,
): string[] {
  const { wrong, passed, history, passedRatio = 0.25, capacity = 20 } = opts;
  const result: string[] = [];
  // 1. 本局错词（全部）
  for (const w of wrong) result.push(w);
  // 2. 通过词抽 passedRatio
  if (passedRatio > 0 && passed.length > 0) {
    for (const w of passed) {
      if (rng() < passedRatio) result.push(w);
    }
  }
  // 3. 历史错词补满
  for (const w of history) {
    if (result.length >= capacity) break;
    result.push(w);
  }
  // 随机打乱（interleaved，避免失败堆积）
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = result[i] as string;
    result[i] = result[j] as string;
    result[j] = tmp;
  }
  return result.slice(0, capacity);
}

// Boss extend 分配：本批错词 → 剩余历史错词 → 未学新词兜底
export function allocExtend(
  opts: {
    batchWrong: string[];
    history: string[];
    unseen: string[];
    used: Set<string>;
    capacity?: number;
  },
  rng: () => number = Math.random,
): string[] {
  const { batchWrong, history, unseen, used, capacity = 6 } = opts;
  const result: string[] = [];
  // 1. 本批错词（excl used）
  for (const w of batchWrong) {
    if (!used.has(w) && result.length < capacity) result.push(w);
  }
  // 2. 历史错词补充
  if (result.length < capacity) {
    for (const w of history) {
      if (!used.has(w) && result.length < capacity) result.push(w);
    }
  }
  // 3. 未学词兜底
  if (result.length < capacity) {
    for (const w of unseen) {
      if (!used.has(w) && result.length < capacity) result.push(w);
    }
  }
  // 桶内轻微打乱
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = result[i] as string;
    result[i] = result[j] as string;
    result[j] = tmp;
  }
  return result;
}