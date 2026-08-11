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
}

export interface Question {
  seq: number;
  wordId: string;
  senseIdx: number;
  type: QuestionType;
  prompt: string;
  template: string;
  blanks: number[];
  note?: string;
  tier: DifficultyTier;
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
}

// 单题答案（客户端上报）
export interface AnswerInput {
  seq: number;
  correct: boolean;
  elapsedMs: number;
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
