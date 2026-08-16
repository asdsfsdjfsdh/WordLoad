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
  // 该词全部义项（答错后展示选错词的完整释义）
  meanings?: string[];
}

// 易混词巩固提示（仅答错巩固（膨胀重写）阶段展示）
export interface ConsolidationHint {
  counterpart: string;
  note: string;
}

// 认证
export interface AuthUser {
  id: number;
  username: string;
  coins: number;
  // 是否后台管理员（可编辑单词库/阅读库）
  isAdmin?: boolean;
  character?: {
    level: number;
    exp: number;
    hpLv: number;
    atkLv: number;
    defLv: number;
    // 角色特化（永久成长，一次点亮）
    executeSpec: boolean;
    vampireSpec: boolean;
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
  // 词书结构：flat=单层阶段地图；hierarchical=两层地图（外层阶段 → 内层关卡）
  structure: 'flat' | 'hierarchical';
}

// 内层关卡（阶段内地图）：红宝书每单元一关
export interface LevelInfo {
  id: number; // 复合 stage 编码（如 101）
  name: string; // 关卡名（如 "Unit 1"）
  wordCount: number;
  status: 'locked' | 'available' | 'cleared';
  // 闯关模式：评级 ≥ 门槛（默认 A）即通关
  cleared: boolean;
  bestRating?: Rating;
  encountered: number;
  mastered: number;
  progress: number; // 0-100
  bestDays: number;
}

// 外层阶段（hierarchical 词书）：红宝书必考/基础/超纲
export interface RegionInfo {
  id: number; // 外层阶段号（1=必考 2=基础 3=超纲）
  name: string; // 必考词 / 基础词 / 超纲词
  wordCount: number;
  levelCount: number;
  clearedLevels: number;
  unlocked: boolean;
  status: 'locked' | 'available' | 'cleared';
  progress: number; // 0-100
  tier: DifficultyTier;
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
  confusable?: ConsolidationHint; // 易混词巩固提示（仅答错阶段展示）
  mnemonic?: string; // 记忆锚点（仅答错巩固（膨胀重写）阶段展示）
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
  confusable?: ConsolidationHint; // 易混词巩固提示（仅答错巩固（膨胀重写）阶段展示）
  mnemonic?: string; // 记忆锚点（仅答错巩固（膨胀重写）阶段展示）
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
  reviewStage: number; // SRS 记忆档位（0 新词 / 1+ 档位递增）
  ease: number; // 简易度因子（记忆强度）
  nextReviewAt: string | null; // 下次复习时间
  mastery: number;
  inWrongBook: boolean;
  skipped: boolean; // 已斩：永久不再出题
  meanings: { meaning: string; example: string }[];
  examples: string[]; // 全部例句（去重）
  confusables: ConfusableInfo[]; // 易混词（形近/音近/义近）
  mnemonic?: string; // 记忆锚点：词根/联想一句话
  bankCode?: string; // 所属词书 code（弱词复习跳转用）
}

// 图鉴：SRS 复习轨迹（词详情弹窗）
export interface SrsStagePoint {
  stage: number;
  intervalDays: number; // 该档位对应间隔天数（intervalDays(stage)）
  at: string; // 到达该档位的时间
}

export interface SrsTrajectory {
  // 当前记忆状态
  current: {
    stage: number;
    ease: number;
    mastery: number;
    nextReviewAt: string | null;
    inWrongBook: boolean;
    skipped: boolean;
  };
  // 档位变更史（按时间升序，仅记录档位变化点）
  points: SrsStagePoint[];
  // 最近一次复习时间（最后一条 history 的时间），可能为 null
  lastReviewedAt: string | null;
  // 词详情：全部义项 / 例句 / 易混词 / 记忆锚点
  word: {
    text: string;
    phonetic?: string;
    tier: DifficultyTier;
    meanings: { meaning: string; example: string }[];
    examples: string[];
    confusables: ConfusableInfo[];
    mnemonic?: string;
  };
}

// 图鉴：总览统计
export interface CollectionStats {
  totalWords: number;
  encountered: number;
  mastered: number;
  learning: number; // 学习中（已遇未掌握）
  wrongbook: number; // 错题本
  skipped: number; // 已斩（永久不再出题）
  newToday: number; // 今日首次遇到的单词数（"新遇"筛选）
  dueToday: number; // 待复习：已到期且未掌握且未斩的单词数
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

// ── Run（红宝书 Unit 肉鸽 / 生存 Run 共用的战局状态）──
export type RunStatus = 'active' | 'finished';
// kind：unit=红宝书 Unit 肉鸽（新闯关，胜利条件=全词掌握+Final Boss 击破）；survival=旧生存 Run（入口已移除，后端休眠保留）
export type RunKind = 'unit' | 'survival';

export interface RunInfo {
  id: number;
  bankId: number;
  stageId: number;
  mode: GameMode;
  kind: RunKind;
  day: number;
  hp: number;
  maxHp: number;
  buffs: string[];          // 已选局内 buff 代号
  status: RunStatus;
  surrendered: boolean;
  cleared: boolean;         // unit Run：击破 Final Boss 即通关
  createdAt: string;
  // 本局累计游玩时长（秒；客户端秒表上报，服务端权威存储）
  playSeconds: number;
}

export interface RunQuestion extends Question {
  isNew: boolean;   // 本局首现词：答对攻击×2
}

// POST /runs 创建
export interface CreateRunRequest {
  bankCode: string;
  stageId: number;
  mode: GameMode;
  // 缺省 'unit'（红宝书 Unit 肉鸽）；'survival' 旧生存 Run 入口已移除，仅供后端休眠保留
  kind?: RunKind;
}

// 红宝书肉鸽词池跨关卡扩展信息（非红宝书词书恒为空池/不扩展）
export interface PoolExpandInfo {
  pooledStages: number[];   // 当前已并池的 stage 列表（如 [101,102,103]）
  pooledUnits: number;      // 已并池 Unit 数（1 = 仅起始 Unit）
  cleanRate: number;        // 当前池内双队列干净占比 0..1
  canExpand: boolean;       // 已达扩展阈值（下一波将并池）
  questionsPerDay: number;  // 当前每日题量（随扩展递增）
}

export interface CreateRunResponse {
  run: RunInfo;
  kind: RunKind;
  cleared: boolean;
  // Unit Run 通关进度 HUD：已掌握词数 / Unit 总词数（非 unit 恒 undefined）
  masteredCount?: number;
  totalCount?: number;
  // Final Boss 波：随机血量（服务端进波时 roll 并落库；非首领波恒 undefined）
  finalBossHp?: number;
  // unit：开局已全掌握 → Day1 直接 Final Boss（此时 questions 为 Boss 题）
  bossWave?: boolean;
  bossHp?: number;
  day: number;
  hp: number;
  maxHp: number;
  // 本局当前全局连击（跨波累计，错答归零）
  combo: number;
  questions: RunQuestion[];
  previewWords: LevelWord[];   // 新词首战日前预习页
  injectedNew: number;
  // 红宝书肉鸽词池扩展信息（非红宝书词书 pooledStages=[]）
  poolExpand?: PoolExpandInfo;
  // 本局词池大小（累计去重词数，day1=20，注入逐日增加）
  poolUsed: number;
  // 选中文模式干扰项候选池（服务端从同阶段词池抽样下发，保证每题 ≥3 干扰项）
  foilPool?: FoilOption[];
  // 角色权威三围（客户端预测用，避免 auth store 陈旧导致怪 HP/Boss 血量分歧）
  atkLv: number;
  defLv: number;
  // 角色特化（客户端预测口径，与服务端引擎一致）
  executeSpec: boolean;
  vampireSpec: boolean;
  // 近期正确率（近一窗口已答 acc，用于"手感/节奏"HUD；无数据时不返回）
  recentAcc?: number;
  // 角色金币（用于显示/校验重抽消耗）与本波是否已重抽（每波 1 次）
  coins: number;
  rerolledToday: boolean;
}

// GET /runs/active
export interface ActiveRunResponse {
  run: RunInfo;
  kind: RunKind;
  cleared: boolean;
  // Unit Run 通关进度 HUD（非 unit 恒 undefined）
  masteredCount?: number;
  totalCount?: number;
  // Final Boss 波随机血量（进波时服务端 roll 落库；非首领波恒 undefined）
  finalBossHp?: number;
  questions: RunQuestion[];    // 未答题
  previewWords: LevelWord[];
  injectedNew: number;
  // 红宝书肉鸽词池扩展信息（非红宝书词书 pooledStages=[]）
  poolExpand?: PoolExpandInfo;
  // 本局当前全局连击（跨波累计，错答归零；续 Run 恢复时不为 0）
  combo: number;
  // 本局词池大小（累计去重词数，day1=20，注入逐日增加）
  poolUsed: number;
  // 续 Run 恢复阶段所需（当波/下一波）
  bossWave?: boolean;
  bossHp?: number;
  buffChoices?: string[];
  legendChoices?: string[];
  // 选中文模式干扰项候选池（服务端从同阶段词池抽样下发）
  foilPool?: FoilOption[];
  ended: false;
  atkLv: number;
  defLv: number;
  // 角色特化（客户端预测口径，与服务端引擎一致）
  executeSpec: boolean;
  vampireSpec: boolean;
  // 近期正确率（近一窗口已答 acc，用于"手感/节奏"HUD；无数据时不返回）
  recentAcc?: number;
  // 角色金币（用于显示/校验重抽消耗）与本波是否已重抽（每波 1 次）
  coins: number;
  rerolledToday: boolean;
}

// POST /runs/:id/advance
export interface RunAdvanceRequest {
  answers: AnswerInput[];
  buffChoice?: string;
  legendChoice?: string;
  // 幂等守卫：须与 run.day 一致，否则服务端拒绝（防重复提交/过期覆盖）
  expectedDay?: number;
  // 客户端累计游玩时长（秒）：本波开始前到提交时的秒表值，服务端取 max 持久化
  playSeconds?: number;
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
  // unit Run：终局是否通关（Final Boss 击破）；推进中恒 false
  cleared: boolean;
  // Unit Run 通关进度 HUD（非 unit 恒 undefined）
  masteredCount?: number;
  totalCount?: number;
  // Final Boss 波随机血量（进波时服务端 roll 落库；非首领波恒 undefined）
  finalBossHp?: number;
  // 本局当前全局连击（跨波累计，错答归零）
  combo: number;
  questions: RunQuestion[];
  previewWords: LevelWord[];
  injectedNew: number;
  nextDayNewWords: number;
  // 红宝书肉鸽词池扩展信息（非红宝书词书 pooledStages=[]）
  poolExpand?: PoolExpandInfo;
  // 本局词池大小（累计去重词数，day1=20，注入逐日增加）
  poolUsed: number;
  // 首领波前置信息（首领波日返回）
  bossHp?: number;
  legendChoices?: string[];    // 首领战后传说三选一
  buffChoices?: string[];      // 当日结算后的普通 buff 三选一
  // 选中文模式干扰项候选池（服务端从同阶段词池抽样下发）
  foilPool?: FoilOption[];
  atkLv: number;
  defLv: number;
  // 角色特化（客户端预测口径，与服务端引擎一致）
  executeSpec: boolean;
  vampireSpec: boolean;
  // 近期正确率（刚结算波的 acc，用于"手感/节奏"HUD）
  recentAcc?: number;
  // 角色金币（用于显示/校验重抽消耗）与本波是否已重抽（每波 1 次）
  coins: number;
  rerolledToday: boolean;
  // 本局累计游玩时长（秒；客户端秒表上报后服务端权威回传，客户端据此续跑秒表）
  playSeconds: number;
}

// POST /runs/:id/reroll（金币重抽增益：每波 1 次）
export interface RerollRunResponse {
  buffChoices?: string[];
  legendChoices?: string[];
  coins: number;           // 重抽后余额
  rerolledToday: boolean;  // 恒为 true（本波已用掉重抽机会）
}

// POST /auth/specialize（角色特化：消耗高阶材料一次点亮）
export interface SpecializeRequest {
  spec: 'execute' | 'vampire';
}

// POST /runs/:id/finish（收枪/死亡结算）
export interface RunFinishRequest {
  answers?: AnswerInput[];
  surrender: boolean;
  // 客户端累计游玩时长（秒）：收枪时秒表值，服务端取 max 持久化
  playSeconds?: number;
}

// POST /runs/:id/replenish（预览斩词后补词：加入本波待答题，返回其题与单词）
export interface ReplenishResult {
  question: RunQuestion;
  word: LevelWord;
  poolUsed: number; // 补词后本局词池大小（累计去重词数，刷新前端显示）
}

// POST /runs/:id/backup-words（预习页候补词池批量预取：先上替补再减总量，池低时再取一批）
export interface BackupWordsResult {
  words: LevelWord[]; // 未用/未掌握的候补新词（未落库，仅供闪卡预习展示）
  poolUsed: number;   // 当前词池大小（与 replenish 口径一致）
}

// 本局词项统计（Run 结算附带）
export interface RunWordStats {
  totalWords: number;
  newLearned: number;
  reviewed: number;
  mastered: number;
  wrong: number;
}

export interface RunFinish {
  runId: number;
  daysSurvived: number;
  bossClearedCount: number;
  bestDays: number;            // 该 (user,stage) 历史最高生存天数（结算后）
  recordBroken: boolean;
  surrendered: boolean;
  // unit Run：本次是否通关（击破 Final Boss）；非 unit 恒 false
  cleared: boolean;
  // unit Run：首次通关该 Unit 的一次性加成是否触发（幂等）
  unitFirstClear?: boolean;
  xp: number;
  coins: number;
  materials: DropItem[];
  rating: Rating;
  // 本局累计游玩时长（秒，结算展示）
  playSeconds: number;
  wordStats?: RunWordStats;
  // 本局最高连击（结算时已落库）
  maxCombo: number;
}

// GET /runs/leaderboard?bankCode=xx&stageId=xx 排行榜项
export interface LeaderboardEntry {
  rank: number;
  username: string;
  days: number;              // unit：通关者=通关天数，未通关=存活天数；survival：最高存活天数
  bossClearedCount: number;
  // unit Run：该纪录局是否通关（未通关按已掌握词数降序补位）
  cleared: boolean;
  masteredCount?: number;    // unit：该纪录局结束时已掌握词数
  isMe: boolean;
}

export interface StageLeaderboard {
  bankCode: string;
  stageId: number;
  totalPlayers: number;
  entries: LeaderboardEntry[];
  me: { rank: number; days: number; bossClearedCount: number; cleared: boolean; masteredCount?: number } | null;
}
