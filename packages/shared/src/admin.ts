// ── 后台管理（单词库 / 阅读库编辑）──
import type { DifficultyTier } from './api.js';
import type {
  ReadingGlossaryEntry,
  ReadingPassageCode,
  ReadingQuestionView,
  ReadingSentenceKnowledge,
  ReadingSentenceStructure,
  ReadingSentenceView,
} from './reading.js';

// 单词列表项
export interface AdminWordSummary {
  id: string;
  text: string;
  phoneticAm?: string;
  phoneticEn?: string;
  tier: DifficultyTier;
  stage: number | null; // 所属词书阶段（首个匹配）
  bankCode?: string;
  senseCount: number;
  inReadingGlossary: boolean; // 是否被阅读库词表引用
}

export interface AdminWordListResult {
  items: AdminWordSummary[];
  total: number;
}

// 单词详情（编辑用）
export interface AdminWordDetail {
  id: string;
  text: string;
  phoneticAm?: string;
  phoneticEn?: string;
  tier: DifficultyTier;
  difficultyScore: number;
  mnemonic?: string;
  senses: { id: number; idx: number; meaning: string; example: string }[];
  banks: { bankId: number; code: string; name: string; stage: number }[];
}

export interface AdminWordSenseInput {
  id?: number; // 已有义项：更新；缺失：新建
  meaning: string;
  example: string;
}

// 保存单词：基础字段 + 义项全量替换
export interface AdminWordSaveInput {
  text?: string;
  phoneticAm?: string | null;
  phoneticEn?: string | null;
  tier?: DifficultyTier;
  mnemonic?: string | null;
  senses: AdminWordSenseInput[];
}

export interface AdminWordCreateInput {
  text: string;
  phoneticAm?: string;
  phoneticEn?: string;
  tier?: DifficultyTier;
  senses?: { meaning: string; example: string }[];
  bankCode?: string;
  stage?: number;
}

// 阅读库：整篇可编辑数据
export interface AdminReadingSentenceRow extends ReadingSentenceView {
  id: number;
}

export interface AdminReadingQuestionRow extends ReadingQuestionView {
  id: number;
  answer: string;
  analysis: string;
}
export interface AdminReadingGlossaryRow extends ReadingGlossaryEntry {
  id: number;
}

export interface AdminPassageEdit {
  id: number;
  paperYear: number;
  examName: string;
  code: ReadingPassageCode;
  title: string;
  subtitle?: string;
  questionsStart: number;
  content: string;
  translation: string;
  sentences: AdminReadingSentenceRow[];
  questions: AdminReadingQuestionRow[];
  glossary: AdminReadingGlossaryRow[];
}

export interface AdminSentenceUpdate {
  en?: string;
  zh?: string;
  structure?: ReadingSentenceStructure | null;
  knowledge?: ReadingSentenceKnowledge | null;
}

export interface AdminQuestionUpdate {
  stem?: string;
  options?: { A: string; B: string; C: string; D: string };
  answer?: string;
  analysis?: string;
}

export interface AdminGlossaryUpdate {
  word?: string;
  meaning?: string;
}

// ── 后台 · 运营总览 ──
export interface AdminStatsOverview {
  users: { total: number; todayNew: number; admins: number };
  words: { total: number; senses: number; banks: number; wordPairs: number };
  runs: { total: number; active: number; todayNew: number; completed: number };
  sessions: { total: number; todayNew: number };
  reading: { papers: number; passages: number; sentences: number; questions: number };
  recentSignups: { id: number; username: string; createdAt: string }[];
}

// 后台 · 运营趋势（近 N 天逐日）
export interface AdminTrendDay {
  date: string; // YYYY-MM-DD
  newUsers: number; // 当日注册
  activeUsers: number; // 当日活跃（注册/Run/关卡/阅读任一动作去重）
  runs: number; // 当日发起的 Run
  sessions: number; // 当日创建的关卡会话
  readingAnswers: number; // 当日阅读答题数
}

export interface AdminStatsTrend {
  days: number; // 覆盖天数
  daysData: AdminTrendDay[];
}

// ── 后台 · 用户管理 ──
export interface AdminUserSummary {
  id: number;
  username: string;
  isAdmin: boolean;
  coins: number;
  createdAt: string;
  lastActiveAt: string | null;
  charLevel: number;
  runCount: number;
  sessionCount: number;
  wordsLearned: number;
  inWrongBook: number;
}

export interface AdminUserListResult {
  items: AdminUserSummary[];
  total: number;
}

export interface AdminUserDetail {
  id: number;
  username: string;
  isAdmin: boolean;
  coins: number;
  createdAt: string;
  character: {
    level: number;
    exp: number;
    hpLv: number;
    atkLv: number;
    defLv: number;
    executeSpec: boolean;
    vampireSpec: boolean;
  } | null;
  progress: {
    wordsLearned: number;
    inWrongBook: number;
    inVocabBook: number;
    senseProgress: number;
    readingPapers: number;
  };
  runs: { id: number; kind: string; status: string; day: number; rating: string; maxCombo: number; cleared: boolean; coinsEarned: number; createdAt: string }[];
  sessions: { id: number; result: boolean; rating: string; xpEarned: number; coinsEarned: number; createdAt: string }[];
}

// ── 后台 · 审计日志 ──
export interface AdminAuditLogRow {
  id: number;
  adminUsername: string;
  action: string;
  table: string;
  recordId: string;
  before?: unknown;
  after?: unknown;
  createdAt: string;
}

export interface AdminAuditLogListResult {
  items: AdminAuditLogRow[];
  total: number;
}

