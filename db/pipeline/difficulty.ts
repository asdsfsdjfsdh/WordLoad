// 多维度难度评估：拼写复杂度 / 多义度 / 易混度 / 词频+考纲
// 产出 difficulty_score(0~1) 与 tier(Ⅰ~Ⅳ)

export type DifficultyTier = 'I' | 'II' | 'III' | 'IV';

export interface Dimensions {
  polysemy: number;
  spellingComplexity: number;
  confusability: number;
  frequency: number;
}

export interface DifficultyResult {
  score: number;
  tier: DifficultyTier;
  dimensions: Dimensions;
}

// 权重可配置（保留扩展入口）
export interface DifficultyWeights {
  polysemy: number;
  spelling: number;
  confusability: number;
  frequency: number;
}

export const DEFAULT_WEIGHTS: DifficultyWeights = {
  polysemy: 0.25,
  spelling: 0.3,
  confusability: 0.2,
  frequency: 0.25,
};

// 义项分隔符（源数据用 / 或 ，分离一个义项；句号后为新义项）
const SENSE_SPLIT = /[；;]/;

export function countSenses(paraphrase: string | null): number {
  if (!paraphrase) return 1;
  const trimmed = paraphrase.trim();
  if (!trimmed) return 1;
  return Math.max(1, trimmed.split(SENSE_SPLIT).length);
}

// 拼写复杂度：长度 + 不规则拼写信号 + 不规则词尾
export function spellingComplexity(word: string): number {
  const len = word.length;
  let score = Math.min(len / 16, 1) * 0.5; // 长度最大贡献 0.5

  // 双字母
  const doubleLetter = /(.)\1/.test(word) ? 0.15 : 0;
  // 不发音字母 e 结尾 + 前长元音常见模式词（-le/-re/-ge）
  const silentLetter = /[aeiou]?[bcdfgklmnptz]e$/i.test(word) ? 0.1 : 0;
  // 不规则词尾
  const irregularEnding = /(ght|ough|ique|eau|ph|qu|mn|stle)/i.test(word) ? 0.15 : 0;
  // 罕见元音组合
  const rareVowel = /[aeiou]{2,}/i.test(word) ? 0.1 : 0;

  // 下划线/连字符/数字视为非常规拼写
  const unusualChar = /[^a-z]/i.test(word) ? 0.2 : 0;

  const s = score + doubleLetter + silentLetter + irregularEnding + rareVowel + unusualChar;
  return Math.min(Math.max(s, 0), 1);
}

// 词频行频：frequency 0~1，词频越高越简单 → 反转为难度分量
export function frequencyDifficulty(frequency: number): number {
  if (frequency <= 0) return 1; // 超纲罕见词视为最难
  return Math.max(0, 1 - Math.min(frequency, 1));
}

// 易混度：由外部输入的 confusable 数量归一（0~N），无对比词则低分
export function confusability(pairCount: number): number {
  // 0 对 ~ 3+ 对映射 0~1
  return Math.min(pairCount / 3, 1);
}

export function normalizeTo4Tier(score: number): DifficultyTier {
  if (score < 0.35) return 'I';
  if (score < 0.55) return 'II';
  if (score < 0.75) return 'III';
  return 'IV';
}

export function evaluateDifficulties(opts: {
  senses: number;
  spelling: string;
  frequency: number;
  confusableCount: number;
  weights?: Partial<DifficultyWeights>;
}): DifficultyResult {
  const w = { ...DEFAULT_WEIGHTS, ...(opts.weights ?? {}) };
  // 一词多义按 1-5 义归一
  const polysemyNorm = Math.min((opts.senses - 1) / 4, 1);

  const dimensions: Dimensions = {
    polysemy: polysemyNorm,
    spellingComplexity: spellingComplexity(opts.spelling),
    confusability: confusability(opts.confusableCount),
    frequency: frequencyDifficulty(opts.frequency),
  };

  const score =
    dimensions.polysemy * w.polysemy +
    dimensions.spellingComplexity * w.spelling +
    dimensions.confusability * w.confusability +
    dimensions.frequency * w.frequency;

  return {
    score: Math.min(Math.max(score, 0), 1),
    tier: normalizeTo4Tier(score),
    dimensions,
  };
}

// 分位数归一化：将一组原始分映射到 0~1 均匀分布，再按分位切 4 档
// 解决绝对分整体偏低导致 tier 失衡的问题
export function normalizeByQuantile(scores: number[]): {
  normalized: Map<number, number>; // index -> 0~1
  tiers: Map<number, DifficultyTier>;
} {
  const sorted = [...scores].sort((a, b) => a - b);
  const rankOf = (v: number): number => {
    // 返回 v 在 sorted 中的分位（0~1），最小项=0
    const eq = sorted.length - sorted.filter((s) => s > v).length;
    return sorted.length === 0 ? 0 : Math.max(0, eq - 1) / Math.max(1, sorted.length - 1);
  };

  const normalized = new Map<number, number>();
  const tiers = new Map<number, DifficultyTier>();
  scores.forEach((s, i) => {
    const q = rankOf(s);
    normalized.set(i, q);
    if (q < 0.25) tiers.set(i, 'I');
    else if (q < 0.5) tiers.set(i, 'II');
    else if (q < 0.75) tiers.set(i, 'III');
    else tiers.set(i, 'IV');
  });
  return { normalized, tiers };
}