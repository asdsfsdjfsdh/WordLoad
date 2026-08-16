// ── 后台管理（单词库 / 阅读库编辑）──
import type { DifficultyTier } from './api.js';
import type { ReadingPassageCode, ReadingSentenceStructure, ReadingSentenceView } from './reading.js';
import type { ReadingGlossaryEntry, ReadingQuestionView } from './reading.js';

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
