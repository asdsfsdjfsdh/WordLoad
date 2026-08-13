export type MonsterKind = 'triangle' | 'square' | 'circle' | 'elite' | 'boss';

export type GameEvent =
  | { type: 'answer-correct'; wordId: string; dmg: number }
  | { type: 'answer-wrong'; wordId: string }
  | { type: 'stun-start' }
  | { type: 'stun-end' }
  | { type: 'monster-spawn'; kind: MonsterKind }
  | { type: 'monster-hit'; kind: MonsterKind }
  | { type: 'monster-killed'; kind: MonsterKind }
  | { type: 'monster-escaped'; kind: MonsterKind }
  | { type: 'player-hit'; hpLeft: number }
  | { type: 'boss-hit'; segment: number }
  | { type: 'rating-revealed'; rating: string }
  | { type: 'combat-end'; cleared: boolean };

export interface BattleConfig {
  maxMonsters: number;
  spawnIntervalMs: number;
  approachSpeed: number;
  playerHp: number;
  stunRounds: number;
  bossSegments: number;
  minHitsToKill: number;
  perfectBonus: number;
  effectLevel: 0 | 1 | 2;
}

// ── 生存 Run 数值（M1 共享配置，仿真与战斗唯一数据源）──
export const SURVIVAL = {
  QUESTIONS_PER_DAY: 20,
  MAX_DAYS: 80,
  // 三围
  MAX_HP_BASE: 20,
  HP_PER_LV: 2,
  ATK_MULT_STEP: 0.25,
  DEF_RED_STEP: 0.1,
  DEF_RED_CAP: 0.4,
  // 吸血
  LEECH_N: 6,
  LEECH_MIN: 3,
  LEECH_BUFF_STEP: 2,   // 吸血+1 → N−2
  // 伤害（raw 随 day 上升）
  WRONG_BASE: 1,
  WRONG_GROW: 0.04,
  WRONG_CAP: 2,
  LEAK_BASE: 1,
  LEAK_GROW: 0.1,
  LEAK_CAP: 3,
  BOSS_DMG_BASE: 1,
  BOSS_DMG_GROW: 0.2,
  BOSS_DMG_CAP: 4,
  // 对攻曲线
  DAY_K_GROW: 0.12,
  DAY_K_CAP: 2.8,
  BASE_HP: 2,           // 怪 HP 基值（保底 ≥2 击）
  MIN_HITS: 2,
  TIER_FACTOR: [1, 1.25, 1.6, 2],   // Ⅰ/Ⅱ/Ⅲ/Ⅳ 词难度加权（怪 HP）
  TIER_K: [1, 1.3, 1.6, 2],         // Ⅰ/Ⅱ/Ⅲ/Ⅳ 档位（怪速度）
  TIER_DIST: [0.4, 0.3, 0.2, 0.1],  // 默认词池 tier 分布
  MAX_FIELD: 5,         // 场上怪数上限（自动补位）
  MONSTERS_DIV: 3,      // 每天怪数 = ceil(QUESTIONS_PER_DAY/3)
  // 速度逼近漏怪（时间驱动）
  SPEED_BASE: 12,
  SPEED_GROW: 0.02,
  SPEED_CAP: 1.3,
  MIN_TRAVEL: 4,
  MAX_TRAVEL: 12,
  // 新词首击
  NEW_WORD_DMG_X: 2,
  // 注入（轻量 Q + 保底 5）
  INJECT_MIN: 5,
  INJECT_MAX: 15,
  INJECT_ACC_GATE: 0.75,
  INJECT_ACC_FORCE_STOP: 0.65,
  INJECT_STRICT_STOP_DAYS: 2,
  INJECT_COOLDOWN_DAYS: 2,   // 严格隔天交替
  // Boss 双驱动
  BOSS_WORD_INTERVAL: 20,
  BOSS_MIN_GAP_DAYS: 2,
  BOSS_FIRST_DAY: 3,
  BOSS_MAX_GAP_DAYS: 4,
  BOSS_BASE: 5,
  BOSS_HEAL: 6,          // 首领战前 +6 HP
  BOSS_HIT_REQUIRE: 2,   // P2 段题需答对 2 次
  // 首领/普通 buff
  BUFF_MAXHP: 2,
  BUFF_MAXHP_MAX: 3,
  BUFF_DMG_MAX: 3,
  BUFF_LEECH_MAX: 2,
  BUFF_DODGE_MAX: 2,
  BUFF_FREEZE_MAX: 2,
  // 结算
  XP_DAY_BASE: 3,
  XP_DAY_CAP: 20,
  COINS_PER_CORRECT: 2,
  COINS_PER_BOSS: 5,
  SURRENDER_RATE: 0.5,
  // 材料稀有度按天数解锁
  MAT_TIER_DAY: [3, 5, 8],   // day≥3 →Ⅱ, ≥5 →Ⅲ, ≥8 →Ⅳ
} as const;

// 普通 buff 池（每天末三选一）
export const NORMAL_BUFF_POOL = [
  'maxhp',  // +2 本局 maxHp（≤3 次）
  'dmg',    // 伤害+1（≥2 击保底）
  'leech',  // 吸血+1（≤2 次）
  'freeze', // 冻结加时
  'dodge',  // 免伤 1 次（≤2 次）
] as const;

// 传说技能池（首领战后三选一，单局一次）
export const LEGEND_BUFF_POOL = [
  'boss-immunity', // P2 免伤免疫
  'kill-heal',     // 击杀回血
  'boss-x2',       // Boss 段伤害×2
  'no-leak-dmg',   // 漏怪不扣血
] as const;

export type NormalBuff = (typeof NORMAL_BUFF_POOL)[number];
export type LegendBuff = (typeof LEGEND_BUFF_POOL)[number];

// strengthen 消耗表（三围 +1 的金币/材料）
export const STRENGTHEN_COST = {
  hp: { coins: 60, materialTier: 1, materialCount: 2 },
  atk: { coins: 40, materialTier: 1, materialCount: 2 },
  def: { coins: 50, materialTier: 1, materialCount: 2 },
} as const;

// 合成：3×tierN + 手续费 20·N 金币 → 1×tier(N+1)
export const SYNTHESIZE = {
  SOURCE_COUNT: 3,
  FEE_PER_TIER: 20,
  MAX_TIER: 4,
} as const;

export interface SurvivalBuffState {
  maxHp: number;    // +2 × 次数
  leech: number;    // 吸血 N−2 × 次数
  dmg: number;      // 伤害 +1 × 次数
  dodge: number;    // 免伤剩余次数
  freeze: number;   // 冻结加时剩余次数
}

// θ 公式（v2.4，纯函数，仿真与战斗共用）
export const dayK = (day: number): number =>
  Math.min(1 + SURVIVAL.DAY_K_GROW * (day - 1), SURVIVAL.DAY_K_CAP);
export const atkMult = (atkLv: number): number =>
  1 + SURVIVAL.ATK_MULT_STEP * (atkLv - 1);
export const defRed = (defLv: number): number =>
  Math.min(SURVIVAL.DEF_RED_CAP, SURVIVAL.DEF_RED_STEP * (defLv - 1));
export const applyDef = (raw: number, defLv: number): number =>
  Math.max(1, Math.ceil(raw * (1 - defRed(defLv))));
// 怪所需答对数（保底 ≥2），dmgBuff=局内伤害 buff
export const monsterHits = (
  tier: number,
  day: number,
  atkLv: number,
  dmgBuff = 0,
): number =>
  Math.max(
    SURVIVAL.MIN_HITS,
    Math.ceil(
      (SURVIVAL.BASE_HP * (SURVIVAL.TIER_FACTOR[tier] ?? 1) * dayK(day)) /
        atkMult(atkLv) /
        (1 + dmgBuff),
    ),
  );
// 逼近预算（题数内未击杀 → 漏怪）
export const travelBudget = (day: number): number => {
  const speedMult = Math.min(1 + SURVIVAL.SPEED_GROW * day, SURVIVAL.SPEED_CAP);
  return Math.max(
    SURVIVAL.MIN_TRAVEL,
    Math.min(SURVIVAL.MAX_TRAVEL, Math.ceil(SURVIVAL.SPEED_BASE / speedMult)),
  );
};
// 怪实时逼近速度（px/sec）：base·√tierK·(1+0.02·day)，封顶 +30%
// base 默认 SPEED_BASE（预算基准）；前端实时战斗用更高 px/sec 量级
export const monsterSpeed = (day: number, tier: number, base: number = SURVIVAL.SPEED_BASE): number => {
  const dayMult = Math.min(1 + SURVIVAL.SPEED_GROW * (day - 1), SURVIVAL.SPEED_CAP);
  return base * Math.sqrt(SURVIVAL.TIER_K[tier] ?? 1) * dayMult;
};
// Boss HP
export const bossHits = (day: number, atkLv: number): number =>
  Math.max(2, Math.ceil((SURVIVAL.BOSS_BASE * (day / 3)) / atkMult(atkLv)));
// 吸血题数（buff 使 N−2，最低 LEECH_MIN）
export const leechN = (leechBuff: number): number =>
  Math.max(SURVIVAL.LEECH_MIN, SURVIVAL.LEECH_N - SURVIVAL.LEECH_BUFF_STEP * leechBuff);
// 注入量：轻量 Q（错词数）驱动 + 保底 5
export const injectAmount = (qLight: number): number =>
  Math.max(0, Math.min(SURVIVAL.INJECT_MAX, Math.max(SURVIVAL.INJECT_MIN, SURVIVAL.INJECT_MAX - qLight)));
// 材料稀有度（按到达天数）：返回 1~4
export const materialTierAt = (day: number): number => {
  let t = 1;
  if (day >= SURVIVAL.MAT_TIER_DAY[0]) t = 2;
  if (day >= SURVIVAL.MAT_TIER_DAY[1]) t = 3;
  if (day >= SURVIVAL.MAT_TIER_DAY[2]) t = 4;
  return t;
};
