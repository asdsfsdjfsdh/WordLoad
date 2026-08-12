export type Rating = 'C' | 'B' | 'A' | 'S' | 'SS' | 'SSS';

export type DifficultyTier = 'I' | 'II' | 'III' | 'IV';

export type GameMode = 'zh2en' | 'dictation';

export type QuestionType = 'fill-blank' | 'sense-match';

// 认证
export interface AuthUser {
  id: number;
  username: string;
  coins: number;
  character?: {
    level: number;
    hpLv: number;
    atkLv: number;
    defLv: number;
  };
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface Bank {
  id: string;
  code: string;
  name: string;
  totalWords: number;
  masteredWords: number;
  dueReviews: number;
  learnedToday: number;
  unlockedStages: number;
  totalStages: number;
}

export interface StageInfo {
  id: number;
  tier: DifficultyTier;
  wordCount: number;
  status: 'locked' | 'available' | 'cleared';
  bestRating?: Rating;
  // 连续进度制：已遇词数 / 已掌握词数 / 进度百分比
  encountered: number;
  mastered: number;
  progress: number; // 0-100
}

// 学习页单词项：战斗前学习该关卡的全部单词
export interface LevelWord {
  wordId: string;
  text: string;
  phonetic?: string;
  tier?: string;
  status: 'new' | 'review' | 'wrongbook' | 'mastered';
  meanings: { meaning: string; example: string }[];
}

export interface Question {
  seq: number;
  wordId: string;
  senseIdx: number;
  type: QuestionType;
  prompt: string;
  template: string;
  blanks: number[];
  tier: DifficultyTier;
  answer: string; // 完整正确答案（打字判定用）
  phonetic?: string; // 音标（听写/发音展示用）
  example?: string; // 语境例句（仅膨胀重写模式展示）
}

export interface Session {
  sessionId: string;
  bankId: string;
  stageId: number;
  mode: GameMode;
  questions: Question[];
}

// 创建会话请求
export interface CreateSessionRequest {
  bankCode: string;
  stageId: number;
  mode: GameMode;
  size?: number;
  // 可选：指定词ID，确保战斗单词和预习列表一致
  wordIds?: string[];
}

// 单题答案（客户端上报）
export interface AnswerInput {
  seq: number;
  correct: boolean;
  elapsedMs: number;
  // 用户实际输入（可选）：提供后服务端以它与标准答案比对为准，忽略 correct 字段
  typed?: string;
}

export interface SubmitResult {
  seq: number;
  correct: boolean;
  correctAnswer: string;
  dmg: number;
  comboAt: number;
  bossHit?: boolean;
}

export interface DropItem {
  materialCode: string;
  tier: 1 | 2 | 3 | 4;
  count: number;
}

export interface SessionFinish {
  rating: Rating;
  xp: number;
  coins: number;
  drops: DropItem[];
  newMastered: number;
  reviewedWords: number;
  progressDelta: number;
}

export interface ConfusableInfo {
  counterpart: string;
  type: 'orthographic' | 'homophone' | 'near-synonym';
  note: string;
}

// 图鉴：单词收藏卡片
export interface CollectedWord {
  wordId: string;
  text: string;
  phonetic?: string;
  tier: DifficultyTier;
  firstEncounteredAt: string | null;
  lastEncounteredAt: string | null;
  encounterCount: number;
  correctCount: number;
  wrongCount: number;
  mastery: number;
  inWrongBook: boolean;
  meanings: { meaning: string; example: string }[];
  examples: string[]; // 全部例句（去重）
  confusables: ConfusableInfo[]; // 易混词（形近/音近/义近）
}

// 图鉴：单词相遇时间线
export interface EncounterRecord {
  date: string;
  mode: GameMode;
  correct: boolean;
  elapsedMs: number;
}

// 图鉴：单词易混词列表（GET /collections/words/:wordId/confusables）
export type ConfusablesResponse = ConfusableInfo[];

// 图鉴：总览统计
export interface CollectionStats {
  totalWords: number;
  encountered: number;
  mastered: number;
  byTier: { tier: DifficultyTier; total: number; encountered: number }[];
}
