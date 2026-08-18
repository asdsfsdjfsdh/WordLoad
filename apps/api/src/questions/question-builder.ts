// 服务端出题核心（纯函数）：抽词比例 / 义项轮换 / 易混补抽 / 挖空模板
// 契约：Question 由 shared 定义；本模块只做算法编排，不触碰数据库
import type { ConsolidationHint, DifficultyTier, FoilOption, GameMode, Question } from '@word-journey/shared';

// 抽词来源
export type QuestionSource = 'new' | 'review' | 'wrongbook';

// 抽词比例 60:25:15（新词 / 复习 / 错题本）
export const MIX_RATIO: readonly [number, number, number] = [60, 25, 15];

// 会话混合抽词比例 7:2:1（新词 / 复习 / 错题本）
export const SESSION_MIX_RATIO = [0.7, 0.2, 0.1] as const;

// 加权随机抽词（无放回）：weightOf 返回权重（越大越易被抽中），全 0 时退化为随机
export function pickWeighted<T>(
  items: T[],
  count: number,
  weightOf: (item: T, index: number) => number,
  rng: () => number = Math.random,
): T[] {
  const n = Math.min(count, items.length);
  if (n <= 0) return [];
  const pool = items.map((item, i) => ({ item, weight: Math.max(0, weightOf(item, i)) }));
  const result: T[] = [];
  while (result.length < n && pool.length > 0) {
    const total = pool.reduce((a, b) => a + b.weight, 0);
    if (total <= 0) {
      result.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]!.item);
      continue;
    }
    let r = rng() * total;
    let idx = 0;
    for (let i = 0; i < pool.length; i++) {
      r -= pool[i]!.weight;
      if (r < 0) {
        idx = i;
        break;
      }
    }
    result.push(pool.splice(idx, 1)[0]!.item);
  }
  return result;
}

// 按比例混合抽词：fresh/review/wrongbook 三类各取一段，缺额由新词补足（其次复习），保证总和=size
// 输入数组由调用方预先排序（fresh/wrongbook 随机、review 按到期优先——头部为已到期词）。
// 注意：review 只取头部（到期优先），未到期复习词仅在新词+到期复习不足时兜底占位。
export function allocSessionMix<T extends { wordId: string }>(opts: {
  fresh: T[];
  review: T[];
  wrongbook: T[];
  size: number;
}): T[] {
  const { fresh, review, wrongbook, size } = opts;
  const wantNew = Math.round(size * SESSION_MIX_RATIO[0]);
  const wantReview = Math.round(size * SESSION_MIX_RATIO[1]);
  let wantWrong = size - wantNew - wantReview;

  const takeNew = Math.min(wantNew, fresh.length);
  const takeReview = Math.min(wantReview, review.length);
  let takeWrong = Math.min(wantWrong, wrongbook.length);

  // 某类不够时，缺口由新词补足（其次复习）
  let deficit = (wantNew - takeNew) + (wantReview - takeReview) + (wantWrong - takeWrong);
  const extraNew = Math.min(deficit, fresh.length - takeNew);
  deficit -= extraNew;
  const extraReview = Math.min(deficit, review.length - takeReview);
  deficit -= extraReview;
  takeWrong = Math.min(takeWrong + deficit, wrongbook.length);

  let chosenNew = takeNew + extraNew;
  let chosenReview = takeReview + extraReview;
  const chosenWrong = takeWrong;
  let totalChosen = chosenNew + chosenReview + chosenWrong;
  if (totalChosen < size) {
    const short = size - totalChosen;
    const fillNew = Math.min(short, fresh.length - chosenNew);
    chosenNew += fillNew;
    chosenReview += Math.min(short - fillNew, review.length - chosenReview);
  }

  return [
    ...fresh.slice(0, chosenNew),
    ...review.slice(0, chosenReview),
    ...wrongbook.slice(0, chosenWrong),
  ];
}

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
  meanings: string[]; // 全部义项（答错后展示选错词完整释义）
  confusableTexts: string[]; // 易混词形（优先作干扰项）
}
export function buildFoilPool(pool: FoilPoolInput[]): FoilOption[] {
  return pool.map((p) => ({
    text: p.text,
    meaning: p.meaning,
    meanings: p.meanings.length > 0 ? p.meanings : undefined,
    confusableTexts: p.confusableTexts.length > 0 ? p.confusableTexts : undefined,
  }));
}

// ── 提示强度（合意难度）：随掌握度/复习次数收紧拼写提示 ──
export type HintLevel = 0 | 1 | 2;
// L0 新词/低掌握：保留首字母（听写保留首尾）｜L1 中等：中译英无字母/听写仅首字母｜L2 高掌握：全挖空
export const HINT_LEVEL_MAP: readonly { label: string; minReviewStage: number; minMastery: number }[] = [
  { label: 'L0 首字母提示', minReviewStage: 0, minMastery: 0 },
  { label: 'L1 收紧提示', minReviewStage: 3, minMastery: 50 },
  { label: 'L2 无字母提示', minReviewStage: 5, minMastery: 80 },
];
export function hintLevelFor(
  mastery: number | null | undefined,
  reviewStage: number | null | undefined,
  source?: string,
): HintLevel {
  if (source === 'new') return 0; // 新词永远最友好
  const m = mastery ?? 0;
  const r = reviewStage ?? 0;
  if (r >= 5 && m >= 80) return 2;
  if (r >= 3 && m >= 50) return 1;
  return 0;
}
// 给定挖空档位 → 要挖空的字母索引（保留哪些由各档位规则决定）
export function blankIndexesFor(mode: GameMode, len: number, hintLevel: HintLevel): number[] {
  const all = Array.from({ length: len }, (_, i) => i);
  if (hintLevel === 0) {
    if (mode === 'dictation') return len >= 3 ? all.slice(1, len - 1) : [];
    return all.slice(1); // 中译英保留首字母
  }
  if (hintLevel === 1) {
    if (mode === 'dictation') return all.slice(1); // 听写保留首字母
    return all; // 中译英全挖空
  }
  return all; // L2：两种模式都全挖空（仅释义/音标提示）
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
  confusable?: ConsolidationHint; // 仅答错巩固（膨胀重写）阶段展示，不参与正常答题
  mnemonic?: string; // 仅答错巩固（膨胀重写）阶段展示
  hintLevel?: HintLevel; // 拼写提示强度（0 保留首字母…2 全挖空）；缺省按 L0
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
      confusable: opts.confusable,
      mnemonic: opts.mnemonic,
    };
  }
  // 挖空策略：按提示强度档位决定保留哪些字母（L0 保留首字母，听写模式保留首尾；L1/L2 逐级收紧）
  const blanks = blankIndexesFor(mode, text.length, opts.hintLevel ?? 0);
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
    confusable: opts.confusable,
    mnemonic: opts.mnemonic,
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