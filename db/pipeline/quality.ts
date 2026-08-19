// 词库质量校验：重复词 / 缺音标 / 缺释义 / 例句词干缺失 / 标点异常
// 输入：候选词清单（含释义、例句），输出检查报告，供导入前拦截

import type { RawExample, RawWord } from './types';

export interface WordCandidate {
  word: string;
  ukPhonetic: string | null;
  usPhonetic: string | null;
  paraphrase: string | null;
  frequency: number;
  examples: { en: string; cn: string }[];
}

export interface QualityIssue {
  word: string;
  type:
    | 'duplicate-word'
    | 'no-phonetic'
    | 'empty-paraphrase'
    | 'example-missing-stem'
    | 'example-too-short'
    | 'bad-punctuation'
    | 'suspicious-spelling';
  detail: string;
  fatal: boolean; // true = 无数据无法出题，阻塞导入
}

const WORD_RE = /^[a-zA-Z][a-zA-Z'.\- ]*[a-zA-Z]?$/;
const PHRASE_RE = /\s/; // 短语

// 词干匹配：容忍复数、属格、时态、常见派生后缀与撇号切分（o'clock / haven't / Rock'n'roll）
const STEM_SUFFIX = /^(s|es|ed|ing|er|est|'s|ly|ally|ies|ied|able|ible|ous|ive|tion|sion|ation|ment|ness|ful|ity|ities|al|ial|ical|ize|ise|ic|ist|ism|ian|an)$/;

function stemOf(token: string): string[] {
  // 先按撇号拆出候选段，再剥离非字母（o'clock → o|clock；haven't → haven|t）
  return token
    .toLowerCase()
    .split(/['’]/)
    .map((part) => part.replace(/[^a-z]/g, ''))
    .filter(Boolean);
}

function stemMatch(token: string, target: string): boolean {
  const w = target.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return false;
  return stemOf(token).some((t) => {
    if (t === w) return true;
    if (t.startsWith(w)) {
      if (STEM_SUFFIX.test(t.slice(w.length))) return true;
      // 拼写变体：-ise/-ize、-our/-or 互换
      if (/ise$/.test(w) && t.startsWith(w.slice(0, -3) + 'ize')) return true;
      if (/ize$/.test(w) && t.startsWith(w.slice(0, -3) + 'ise')) return true;
      if (/our$/.test(w) && t.startsWith(w.slice(0, -3) + 'or')) return true;
      if (/or$/.test(w) && t.startsWith(w.slice(0, -2) + 'our')) return true;
    }
    // 辅音双写（run→running / big→bigger）：词尾元音 + 重复辅音 + 后缀
    if (
      w.length > 3 &&
      /[aeiou]$/.test(w) &&
      t.startsWith(w + w[w.length - 1]) &&
      STEM_SUFFIX.test(t.slice(w.length + 1))
    ) {
      return true;
    }
    return false;
  });
}

export interface QualityReport {
  total: number;
  issues: QualityIssue[];
  fatal: number;
}

export function collectCandidates(
  words: RawWord[],
  examples: RawExample[],
): WordCandidate[] {
  const exByWord = new Map<number, { en: string; cn: string }[]>();
  for (const ex of examples) {
    const list = exByWord.get(ex.wordid) ?? [];
    list.push({ en: ex.en, cn: ex.cn });
    exByWord.set(ex.wordid, list);
  }

  return words
    .filter((w) => w.spelling && w.spelling.trim())
    .map((w) => {
      const exs = (exByWord.get(w.wordid) ?? []).filter(
        (e) => e.en && e.cn && /[a-zA-Z]/.test(e.en),
      );
      return {
        word: w.spelling.trim(),
        ukPhonetic: w.UKphonetic,
        usPhonetic: w.USphonetic,
        paraphrase: w.paraphrase,
        frequency: w.frequency,
        examples: exs,
      };
    });
}

export function checkQuality(candidates: WordCandidate[]): QualityReport {
  const issues: QualityIssue[] = [];
  const seen = new Set<string>();
  let duplicates = 0;

  for (const c of candidates) {
    const word = c.word;
    const lower = word.toLowerCase();

    if (seen.has(lower)) {
      duplicates++;
      issues.push({ word, type: 'duplicate-word', detail: `重复词：${lower}`, fatal: false });
      continue;
    }
    seen.add(lower);

    // 合法拼写：纯字母或允许的符号，且为主体单词
    if (!WORD_RE.test(word)) {
      issues.push({
        word,
        type: 'suspicious-spelling',
        detail: `拼写异常：${word}（含不允许字符或非单词形态）`,
        fatal: true,
      });
    }

    // 音标：中译英模式需英式或美式至少其一
    if (!c.ukPhonetic && !c.usPhonetic) {
      issues.push({ word, type: 'no-phonetic', detail: '缺英/美音标', fatal: true });
    }

    // 释义
    if (!c.paraphrase || !c.paraphrase.trim()) {
      issues.push({ word, type: 'empty-paraphrase', detail: '缺中文释义', fatal: true });
    }

    // 例句词干缺失 & 标点异常（warning，不全阻塞）
    for (const ex of c.examples.slice(0, 4)) {
      const enBase = ex.en.toLowerCase();
      const target = word.toLowerCase().replace(/[.'\-]/g, '');
      const enStem = enBase.replace(/[^a-z']/g, ' ').replace(/\s+/g, ' ').trim();

      // 该词（词干）是否出现在例句
      const isPhrase = PHRASE_RE.test(word);
      const appears = isPhrase
        ? enBase.includes(target)
        : enStem.split(' ').some((t) => stemMatch(t, target));

      if (!appears) {
        issues.push({
          word,
          type: 'example-missing-stem',
          detail: `例句未含目标词干：${ex.en.slice(0, 60)}…`,
          fatal: false,
        });
      }

      if ((ex.en.match(/[a-zA-Z]/g) ?? []).length < 5) {
        issues.push({
          word,
          type: 'example-too-short',
          detail: `例句过短：${ex.en.slice(0, 40)}`,
          fatal: false,
        });
      }
    }

    // 释义标点异常：释义不应以 "，" 结尾且无后续
    if (c.paraphrase && /，[，,、]+/.test(c.paraphrase)) {
      issues.push({ word, type: 'bad-punctuation', detail: '释义连续标点', fatal: false });
    }
  }

  return {
    total: candidates.length,
    issues,
    fatal: issues.filter((i) => i.fatal).length,
  };
}

export function reportToText(report: QualityReport): string {
  const lines: string[] = [];
  lines.push(`词条总数: ${report.total}`);
  lines.push(`问题总数: ${report.issues.length}（fatal: ${report.fatal}）`);
  const byType = new Map<string, number>();
  for (const i of report.issues) byType.set(i.type, (byType.get(i.type) ?? 0) + 1);
  lines.push('按类型: ' + [...byType.entries()].map(([k, v]) => `${k}=${v}`).join(', '));
  if (report.issues.length > 0) {
    lines.push('--- 样例(前40条) ---');
    for (const i of report.issues.slice(0, 40)) {
      lines.push(`[${i.type}] ${i.word}: ${i.detail}`);
    }
  }
  return lines.join('\n');
}