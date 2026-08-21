// 红宝书 Unit 试卷模式（看中填英）：出卷 → 答题 → 服务端批改 → 计入统计
// 契约原则：试卷只下发音标（题面无音标、无答案），英文答案与音标在批改后回传
import type { Rating } from './api.js';

// 试卷题目（答前下发）：仅中文释义 + 词性标签，不含答案/音标
export interface ExamQuestion {
  seq: number;
  wordId: string;
  pos?: string;      // 词性标签（从释义开头解析，如 n. / adj. / vt.）
  meaning: string;   // 中文释义（已剥离词性前缀）
}

// 出卷响应
export interface ExamPaper {
  paperId: string;
  bankCode: string;
  stageId: number;
  total: number;
  title: string;            // 如 "Unit 1 试卷"
  questions: ExamQuestion[];
}

// 客户端上报的单题作答
export interface ExamAnswerInput {
  seq: number;
  typed: string;            // 用户实际输入的英文
  elapsedMs: number;
}

// 批改后的单题
export interface ExamGradedQuestion extends ExamQuestion {
  text: string;             // 正确英文
  phonetic?: string;        // 音标（答错时展示）
  typed: string;            // 用户输入
  correct: boolean;
  misspelled?: boolean;     // 拼写接近但非完全正确（错因：typo）
}

// 批改完成后的卷面
export interface ExamSubmitResult {
  paperId: string;
  bankCode: string;
  stageId: number;
  total: number;
  correct: number;
  wrong: number;
  accuracy: number;         // 0-100
  rating: Rating;
  xp: number;
  coins: number;
  wrongbookAdded: number;   // 新增进错题本的词数
  questions: ExamGradedQuestion[];
}
