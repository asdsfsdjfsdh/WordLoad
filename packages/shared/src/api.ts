export type Rating = 'C' | 'B' | 'A' | 'S' | 'SS' | 'SSS';

export type DifficultyTier = 'I' | 'II' | 'III' | 'IV';

export type GameMode = 'zh2en' | 'dictation' | 'choice';

export type QuestionType = 'fill-blank' | 'sense-match' | 'choice';

// 选中文模式的候选池项（会话创建时服务端一次性下发，前端据此组 4 个选项）
export interface FoilOption {
  text: string;
  meaning: string;
  // 与本题相关的易混词形（优先选用作干扰项），可为空
  confusableTexts?: string[];
}

// 认证
export interface AuthUser {
  id: number;
  username: string;
  coins: number;
  character?: {
    level: number;
    exp: number;
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
  // 生存 Run：该 stage 历史最高生存天数
  bestDays: number;
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
  answerMeaning?: string; // 选中文模式：正确答案对应的中文释义（前端组选项用）
  phonetic?: string; // 音标（听写/发音展示用）
  example?: string; // 语境例句（仅膨胀重写模式展示）
  isRevenge?: boolean; // Boss 段：本局错词再次出现，答对打 Boss 双倍伤害
  source?: 'new' | 'review' | 'wrongbook' | 'boss'; // 单词来源标签
}

export interface Session {
  sessionId: string;
  bankId: string;
  stageId: number;
  mode: GameMode;
  questions: Question[];
  // 选中文模式候选池（同阶段全部单词 + 该用户本词书错题词），前端据此生成 4 选项
  foilPool?: FoilOption[];
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

// Boss 段：进入 Boss 阶段
export interface EnterBossRequest {
  answers: AnswerInput[];
}

export interface EnterBossResponse {
  questions: Question[];
  exhausted: boolean;
  bossHp: number;
}

// Boss 段：词尽未死续战
export interface BossExtendRequest {
  missedWordIds: string[];
}

export interface BossExtendResponse {
  questions: Question[];
  exhausted: boolean;
}

export interface SessionFinish {
  rating: Rating;
  xp: number;
  coins: number;
  drops: DropItem[];
  newMastered: number;
  reviewedWords: number;
  progressDelta: number;
  bossCleared: boolean;
  bossFought: boolean;
  wrongConverted?: number; // Boss 段纠正的错词数
  totalWrong?: number;    // 学习段错词总数
  tomorrowPreview?: { text: string; meaning: string }[]; // 明天预告 3 词
  leveledUp?: boolean; // 本局是否升级
  wordResults?: { text: string; correct: boolean; type: string }[]; // 每题对错明细
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
  learning: number; // 学习中（已遇未掌握）
  wrongbook: number; // 错题本
  newToday: number; // 今日首次遇到的单词数（"新遇"筛选）
  byTier: { tier: DifficultyTier; total: number; encountered: number }[];
}

// 材料：合成（3×tierN → 1×tier(N+1)，N=1,2,3）
export interface SynthesizeRequest {
  fromTier: 1 | 2 | 3;
}

// 用户材料持有快照（GET /materials）
export interface MaterialHolding {
  code: string;
  tier: number;
  name: string;
  count: number;
}

export interface SynthesizeResult {
  fromTier: number;
  toTier: number;
  // 合成后余额快照
  materials: { code: string; tier: number; count: number }[];
  coins: number;
}

// ── 生存 Run（无限生存模式）──
export type RunStatus = 'active' | 'finished';

export interface RunInfo {
  id: number;
  bankId: number;
  stageId: number;
  mode: GameMode;
  day: number;
  hp: number;
  maxHp: number;
  buffs: string[];          // 已选局内 buff 代号
  status: RunStatus;
  surrendered: boolean;
  createdAt: string;
}

export interface RunQuestion extends Question {
  isNew: boolean;   // 本局首现词：答对攻击×2
}

// POST /runs 创建
export interface CreateRunRequest {
  bankCode: string;
  stageId: number;
  mode: GameMode;
}

export interface CreateRunResponse {
  run: RunInfo;
  day: number;
  hp: number;
  maxHp: number;
  questions: RunQuestion[];
  previewWords: LevelWord[];   // 新词首战日前预习页
  injectedNew: number;
}

// GET /runs/active
export interface ActiveRunResponse {
  run: RunInfo;
  questions: RunQuestion[];    // 未答题
  previewWords: LevelWord[];
  injectedNew: number;
  // 续 Run 恢复阶段所需（当波/下一波）
  bossWave?: boolean;
  bossHp?: number;
  buffChoices?: string[];
  legendChoices?: string[];
  ended: false;
}

// POST /runs/:id/advance
export interface RunAdvanceRequest {
  answers: AnswerInput[];
  buffChoice?: string;
  legendChoice?: string;
  // 前端实时模拟出的波末血量（客户端权威，服务端直接采信）；缺省回退 run.hp
  finalHp?: number;
  // Boss 波：本波是否击破首领（客户端实时模拟判定）
  bossCleared?: boolean;
}

export interface RunAdvanceResponse {
  day: number;
  hp: number;
  maxHp: number;
  buffs: string[];
  bossWave: boolean;
  bossCleared: boolean;
  ended: boolean;
  result?: RunFinish;
  questions: RunQuestion[];
  previewWords: LevelWord[];
  injectedNew: number;
  nextDayNewWords: number;
  // 首领波前置信息（首领波日返回）
  bossHp?: number;
  legendChoices?: string[];    // 首领战后传说三选一
  buffChoices?: string[];      // 当日结算后的普通 buff 三选一
}

// POST /runs/:id/finish（收枪/死亡结算）
export interface RunFinishRequest {
  answers?: AnswerInput[];
  surrender: boolean;
}

// POST /runs/:id/replenish（预览斩词后补词：加入本波待答题，返回其题与单词）
export interface ReplenishResult {
  question: RunQuestion;
  word: LevelWord;
}

export interface RunFinish {
  runId: number;
  daysSurvived: number;
  bossClearedCount: number;
  bestDays: number;            // 该 (user,stage) 历史最高生存天数（结算后）
  recordBroken: boolean;
  surrendered: boolean;
  xp: number;
  coins: number;
  materials: DropItem[];
  rating: Rating;
}
