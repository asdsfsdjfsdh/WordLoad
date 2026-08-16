// ── 考研英语一真题阅读 ──
// 协议真源：reading 模块的前后端共享类型与纯函数

export type ReadingPassageStatus = 'not-started' | 'reading' | 'done';

export type ReadingPassageCode = 'A' | 'B' | 'C' | 'D';

// 题目视图（作答前不含答案）
export interface ReadingQuestionView {
  seq: number;
  stem: string;
  options: { A: string; B: string; C: string; D: string };
}

// 词表条目（点词查义数据；词库联动时带掌握状态）
export interface ReadingGlossaryEntry {
  word: string;
  phonetic?: string;
  meaning: string;
  // 词库联动（可选）：若该词已存在于 Word 总表
  wordId?: string;
  mastered?: boolean; // 用户已掌握该词
  inVocabBook?: boolean; // 该词已在用户生词本
}

export interface ReadingSentenceView {
  seq: number;
  para: number;
  en: string;
  zh: string;
  // 句子结构（长难句拆解，可选；由标注管线写入）
  structure?: ReadingSentenceStructure;
}

// ── 句子结构：长难句拆解（主句/从句/主干）──
export type ReadingClauseRole =
  | 'main' // 主句
  | 'noun' // 名词性从句（主语/宾语/表语从句）
  | 'adj' // 定语从句
  | 'adv' // 状语从句
  | 'participle' // 分词短语
  | 'prep' // 介词短语
  | 'infinitive' // 不定式
  | 'appositive' // 同位语
  | 'coordinate' // 并列结构
  | 'other'; // 其他成分

export interface ReadingSentenceClause {
  role: ReadingClauseRole;
  label: string; // 中文标签（如 定语从句）
  text: string; // 原文子串（必须能在原句中定位）
}

// 句子主干（主谓宾，可缺）
export interface ReadingSentenceMain {
  subject: string;
  predicate: string;
  object?: string;
}

export interface ReadingSentenceStructure {
  clauses: ReadingSentenceClause[];
  main?: ReadingSentenceMain;
}

export const READING_CLAUSE_ROLES = [
  'main',
  'noun',
  'adj',
  'adv',
  'participle',
  'prep',
  'infinitive',
  'appositive',
  'coordinate',
  'other',
] as const;

// 角色 → 展示信息（固定字面量 Tailwind 类，保证 JIT 扫描得到）
const CLAUSE_ROLE_INFO: Record<ReadingClauseRole, { label: string; spanClass: string; dotClass: string }> = {
  main: { label: '主句', spanClass: 'bg-sky-500/10 text-sky-100 border-b-2 border-sky-400/50', dotClass: 'bg-sky-400' },
  noun: { label: '名词性从句', spanClass: 'bg-emerald-500/10 text-emerald-100 border-b-2 border-emerald-400/50', dotClass: 'bg-emerald-400' },
  adj: { label: '定语从句', spanClass: 'bg-amber-500/10 text-amber-100 border-b-2 border-amber-400/50', dotClass: 'bg-amber-400' },
  adv: { label: '状语从句', spanClass: 'bg-violet-500/10 text-violet-100 border-b-2 border-violet-400/50', dotClass: 'bg-violet-400' },
  participle: { label: '分词短语', spanClass: 'bg-rose-500/10 text-rose-100 border-b-2 border-rose-400/50', dotClass: 'bg-rose-400' },
  prep: { label: '介词短语', spanClass: 'bg-teal-500/10 text-teal-100 border-b-2 border-teal-400/50', dotClass: 'bg-teal-400' },
  infinitive: { label: '不定式', spanClass: 'bg-fuchsia-500/10 text-fuchsia-100 border-b-2 border-fuchsia-400/50', dotClass: 'bg-fuchsia-400' },
  appositive: { label: '同位语', spanClass: 'bg-orange-500/10 text-orange-100 border-b-2 border-orange-400/50', dotClass: 'bg-orange-400' },
  coordinate: { label: '并列结构', spanClass: 'bg-lime-500/10 text-lime-100 border-b-2 border-lime-400/50', dotClass: 'bg-lime-400' },
  other: { label: '其他成分', spanClass: 'bg-slate-500/10 text-slate-200 border-b-2 border-slate-500/50', dotClass: 'bg-slate-400' },
};

export function clauseRoleInfo(role: ReadingClauseRole): { label: string; spanClass: string; dotClass: string } {
  return CLAUSE_ROLE_INFO[role] ?? CLAUSE_ROLE_INFO.other;
}

// 从句在原文中的字符区间
export interface ReadingClauseSpan {
  role: ReadingClauseRole;
  label: string;
  start: number; // 含
  end: number; // 不含
}

// 忽略空白差异地在原句中定位 clause.text
export function locateClauseSpans(sentence: string, clauses: ReadingSentenceClause[]): ReadingClauseSpan[] {
  const compact = (s: string): string => s.replace(/\s+/g, '');
  const target = compact(sentence);
  const spans: ReadingClauseSpan[] = [];
  for (const c of clauses) {
    if (!c.text || !c.text.trim()) continue;
    const needle = compact(c.text);
    if (!needle) continue;
    const at = target.indexOf(needle);
    if (at < 0) continue; // 无法定位：跳过（导入时校验会告警）
    // 把 compact 下标映射回原始下标
    let start = -1;
    let seen = 0;
    for (let i = 0; i < sentence.length && seen <= at; i++) {
      if (sentence[i] !== ' ' && sentence[i] !== '\t' && sentence[i] !== '\n') {
        if (seen === at) start = i;
        seen++;
      }
    }
    if (start < 0) continue;
    const end = start + c.text.length;
    spans.push({ role: c.role, label: c.label, start, end });
  }
  return spans;
}

// 为每个 token 归属一个从句：最具体（最短）优先；无归属 → undefined
export function assignTokenClauses(
  tokens: ReadingToken[],
  spans: ReadingClauseSpan[],
): (ReadingClauseRole | undefined)[] {
  const ordered = [...spans].sort((a, b) => a.end - a.start - (b.end - b.start));
  return tokens.map((t) => {
    const s = t.index;
    const e = t.index + t.text.length;
    for (const sp of ordered) {
      if (sp.start <= s && e <= sp.end) return sp.role;
    }
    return undefined;
  });
}

export interface ReadingProgressView {
  status: ReadingPassageStatus;
  bestScore: number;
  totalQuestions: number;
  correctCount: number;
  currentSentence: number;
  // 已答选择：seq -> choice（重新进入阅读页可回显）
  answered: Record<number, string>;
}

export interface ReadingPassageSummary {
  id: number;
  code: ReadingPassageCode;
  title: string;
  subtitle?: string;
  questionCount: number;
  status: ReadingPassageStatus;
  bestScore: number;
  correctCount: number;
  totalQuestions: number;
}

export interface ReadingPaperSummary {
  id: number;
  year: number;
  examName: string;
  passages: ReadingPassageSummary[];
}

export interface ReadingPassageDetail {
  id: number;
  paperId: number;
  year: number;
  examName: string;
  code: ReadingPassageCode;
  title: string;
  subtitle?: string;
  questionsStart: number;
  content: string;
  translation: string;
  sentences: ReadingSentenceView[];
  questions: ReadingQuestionView[];
  glossary: ReadingGlossaryEntry[];
  progress: ReadingProgressView;
  savedWords: string[]; // 已收藏生词（词形集合）
}

// 提交答案
export interface ReadingSubmitAnswerInput {
  seq: number;
  choice: string; // A-D
}

export interface ReadingQuestionResult extends ReadingQuestionView {
  choice?: string; // 用户选择
  correct: boolean; // 是否答对
  answer: string; // 正确答案
  analysis: string; // 解析
}

export interface ReadingSubmitResponse {
  totalQuestions: number;
  correctCount: number;
  score: number; // 每题 2 分（真题口径）
  results: ReadingQuestionResult[];
  status: ReadingPassageStatus;
  bestScore: number; // 更新后历史最高分
  recordBroken: boolean;
}

export interface ReadingProgressUpdateRequest {
  currentSentence?: number;
  status?: ReadingPassageStatus;
}

// 生词收集
export interface ReadingMarkWordRequest {
  word: string;
  action: 'save' | 'remove';
}

export interface ReadingMarkWordResponse {
  word: string;
  saved: boolean;
  savedWords: string[];
  inVocabBook?: boolean; // 词库联动：同步到图鉴生词本后的状态
}

// ── 纯函数：原文分词与词表查找（点词 / 生词高亮用，前后端一致）──

export interface ReadingToken {
  text: string; // 原始片段
  word?: string; // 轻量归一化词形（小写、去所有格；非单词 token 无此字段）
  index: number; // token 在句子中的起始偏移
}

const WORD_RE = /[A-Za-z][A-Za-z'-]*/g;

// 将句子切分为 token 流：单词 / 空白 / 标点
export function tokenizeReadingSentence(sentence: string): ReadingToken[] {
  const tokens: ReadingToken[] = [];
  const re = new RegExp(WORD_RE.source, 'g');
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sentence)) !== null) {
    const word = m[0];
    if (m.index > last) {
      tokens.push({ text: sentence.slice(last, m.index), index: last });
    }
    tokens.push({ text: word, word: normalizeReadingWord(word), index: m.index });
    last = m.index + word.length;
  }
  if (last < sentence.length) {
    tokens.push({ text: sentence.slice(last), index: last });
  }
  return tokens;
}

// 轻量归一化：小写 + 去所有格（保留屈折形式，供候选词干匹配）
export function normalizeReadingWord(raw: string): string {
  let w = raw.toLowerCase();
  // 全大写缩写（如 PRH、CEO、CEO'S）保持小写原样
  if (raw.length >= 2 && raw === raw.toUpperCase() && /[A-Z]{2,}/.test(raw.replace(/'/g, ''))) {
    return raw.toLowerCase().replace(/'s$/, '');
  }
  // 撇号所有格 / 缩写
  w = w.replace(/'s$/, '').replace(/s'$/, '');
  return w;
}

// 保守词干：剥离常见屈折后缀（-ing/-ed/-es/-s/复数），用于候选回退
function stemReadingWord(w: string): string {
  if (w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.endsWith('ing')) {
    const stem = w.slice(0, -3);
    return stem.endsWith('e') ? stem.slice(0, -1) : stem;
  }
  if (w.endsWith('ed')) {
    const stem = w.slice(0, -2);
    if (stem.endsWith('e')) return stem;
    if (stem.endsWith('c')) return stem + 'k';
    return stem;
  }
  if (w.endsWith('es')) {
    return w.endsWith('ies') ? w.slice(0, -3) + 'y' : w.slice(0, -2);
  }
  if (w.endsWith('s') && w.length > 4) {
    return w.slice(0, -1);
  }
  return w;
}

// 词表查找候选：轻量原形 → 词干 → 词干+e（如 raise/raised）/词干+y
export function readingWordCandidates(raw: string): string[] {
  const light = normalizeReadingWord(raw);
  const out = [light];
  const stem = stemReadingWord(light);
  if (stem && stem !== light) {
    out.push(stem, stem + 'e', stem + 'y');
  }
  return [...new Set(out)];
}

function glossaryGet(
  glossary: ReadonlyMap<string, ReadingGlossaryEntry> | Record<string, ReadingGlossaryEntry>,
  key: string,
): ReadingGlossaryEntry | undefined {
  return glossary instanceof Map ? glossary.get(key) : (glossary as Record<string, ReadingGlossaryEntry>)[key];
}

// 点词查义：依次尝试候选词形，返回首个命中条目
export function lookupReadingWord(
  glossary: ReadonlyMap<string, ReadingGlossaryEntry> | Record<string, ReadingGlossaryEntry>,
  raw: string,
): ReadingGlossaryEntry | undefined {
  for (const candidate of readingWordCandidates(raw)) {
    const entry = glossaryGet(glossary, candidate);
    if (entry) return entry;
  }
  return undefined;
}
