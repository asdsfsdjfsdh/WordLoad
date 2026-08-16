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
  // 伤害（raw 随 day 上升，无上限：后期任何失误都致命，形成对攻墙）
  WRONG_BASE: 1,
  WRONG_GROW: 0.05,
  LEAK_BASE: 1,
  LEAK_GROW: 0.13,
  BOSS_DMG_BASE: 1,
  BOSS_DMG_GROW: 0.35,
  // 对攻曲线（dayK 无上限：怪 HP 随天数无限增长）
  DAY_K_GROW: 0.12,
  BASE_HP: 2.5,         // 怪 HP 基值（保底 ≥2 击）
  MIN_HITS: 2,
  TIER_FACTOR: [1, 1.25, 1.6, 2],   // Ⅰ/Ⅱ/Ⅲ/Ⅳ 词难度加权（怪 HP）
  TIER_K: [1, 1.3, 1.6, 2],         // Ⅰ/Ⅱ/Ⅲ/Ⅳ 档位（怪速度）
  TIER_DIST: [0.4, 0.3, 0.2, 0.1],  // 默认词池 tier 分布
  MAX_FIELD: 5,         // 场上怪数上限（自动补位）
  MONSTERS_DIV: 3,      // 每天怪数 = ceil(QUESTIONS_PER_DAY/3)
  // 速度逼近漏怪（时间驱动）
  SPEED_BASE: 8,
  SPEED_GROW: 0.02,
  SPEED_CAP: 1.3,
  MIN_TRAVEL: 4,
  MAX_TRAVEL: 9,
  // 新词首击
  NEW_WORD_DMG_X: 2,
  // 注入（轻量 Q + 保底 5）
  INJECT_MIN: 5,
  INJECT_MAX: 15,
  INJECT_ACC_GATE: 0.75,
  INJECT_ACC_FORCE_STOP: 0.65,
  INJECT_STRICT_STOP_DAYS: 2,
  INJECT_COOLDOWN_DAYS: 2,   // 严格隔天交替
  // 红宝书肉鸽词池跨关卡扩展（双队列判定：干净队列占比达标 → 并池下一 Unit）
  POOL_EXPAND_CLEAN_RATE: 0.8, // 当前池内干净队列词占比 ≥80% → 并池下一 Unit
  POOL_QPD_STEP: 5,            // 每并池 1 个 Unit，每日题量 +5
  POOL_QPD_CAP: 60,            // 每日题量封顶
  // Boss 双驱动
  BOSS_WORD_INTERVAL: 20,
  BOSS_MIN_GAP_DAYS: 2,
  BOSS_FIRST_DAY: 3,
  BOSS_MAX_GAP_DAYS: 4,
  BOSS_BASE: 5,
  BOSS_HEAL: 0,          // 首领战前回复（0=不回血，Boss 为纯消耗战）
  BOSS_HIT_REQUIRE: 2,   // P2 段题需答对 2 次
  BOSS_REUSE_PENALTY: 0.5, // 上一波 Boss 已考词软降权（拉长跨波复现间隔）
  // 传说技能获取：首领击破后概率出传说三选一（单局每种一次）
  LEGEND_DROP_RATE: 0.1,
  // 首领/普通 buff
  BUFF_MAXHP: 2,
  BUFF_MAXHP_MAX: 3,
  BUFF_DMG_MAX: 3,
  BUFF_LEECH_MAX: 2,
  BUFF_DODGE_MAX: 2,
  BUFF_FREEZE_MAX: 2,
  // 词长伤害：len≤4→1，每 +LEN_DMG_STEP 字母 +1，封顶 +LEN_DMG_MAX
  LEN_DMG_STEP: 4,
  LEN_DMG_MAX: 2,
  // 连击里程碑（连续答对，答错清零）
  COMBO_CRIT: 3,          // ×3 会心：本击 +1
  COMBO_CRIT_BONUS: 1,
  COMBO_SPLASH: 5,        // ×5 溅射：额外对前排打 1
  COMBO_SPLASH_DMG: 1,
  COMBO_WAVE: 7,          // ×7 全场波：全怪 -1
  COMBO_WAVE_DMG: 1,
  // 敌人特性
  TRAIT_ARMOR_RED: 1,     // 护甲：受击 -1（最低 1）
  TRAIT_TANK_MULT: 1.6,   // 厚皮：HP ×1.6
  TRAIT_ELITE_MULT: 1.4,  // 精英：HP ×1.4
  TRAIT_SWIFT_BUDGET: 1,  // 迅捷：逼近预算 -1
  TRAIT_REGEN_EVERY: 2,   // 再生：每 2 题回 1
  TRAIT_REGEN_AMOUNT: 1,
  TRAIT_SPLIT_COUNT: 2,   // 分裂：死亡裂 2 只 mini
  TRAIT_SPLIT_TIMER: 2,   // 分裂 mini 逼近预算相对缩短
  // 结算
  XP_DAY_BASE: 3,
  XP_DAY_CAP: 20,
  COINS_PER_CORRECT: 2,
  COINS_PER_BOSS: 5,
  SURRENDER_RATE: 0.5,
  // 材料稀有度按天数解锁
  MAT_TIER_DAY: [3, 5, 8],   // day≥3 →Ⅱ, ≥5 →Ⅲ, ≥8 →Ⅳ
  // 局内遗忘曲线（复习段选词：已掌握曲线 + 答错曲线 + 双队列恢复 + 随机抖动）
  FORGETTING: {
    // 已掌握曲线（干净队列）
    REST_BASE_DAYS: 2,        // 答对后基础静默期（天），期内不复现
    REST_PER_CORRECT: 0.5,    // 每多答对 1 次，静默期 +0.5 天
    REST_CAP_DAYS: 4,         // 静默期封顶
    STRENGTH_GAIN: 0.2,       // 每次答对记忆强度增量
    DECAY_BASE: 0.5,          // 每日遗忘率基准（静默期后紧迫度上升斜率）
    DECAY_STABILIZE: 0.06,    // 每答对 1 次遗忘率下降（稳定化）
    PRE_MASTERY_BONUS: 0.4,   // 局前 mastery(0..1) 对遗忘率的减免系数
    PRE_MASTERY_REST: 0.8,    // 局前 mastery≥0.8 → 额外静默期 +1 天
    // 答错曲线（错词队列）
    WRONG_URGENCY_BASE: 1.0,  // 答错后紧迫度基准
    WRONG_DECAY_DAYS: 3,      // 错后紧迫度随天数衰减到 0 的尺度
    // 局内未出现的兜底紧迫度（全局错题本走 WRONG_URGENCY_BASE，日历到期走此值）
    FALLBACK_DUE_URGENCY: 0.5,
    // 恢复迁移
    RECOVER_STREAK: 3,        // 连续答对 3 次 → 迁回干净队列
    RECOVER_WEIGHT: 1.5,      // 恢复词在干净队列中的加权系数（仍优先于从未错过词）
    // 随机
    JITTER: 0.15,             // 紧迫度随机抖动 ±（打破确定性重复）
  },
} as const;

// ── 红宝书 Unit 肉鸽 Run（替代经典闯关的 Unit Run 专属数值）──
export const UNIT_BOSS = {
  // Final Boss 基础血量：固定基数，不随 Unit 递增；仅按 ±JITTER 浮动（随机性进波时服务端 roll 并落库）
  BASE_HP: 10,
  // 随机浮动幅度（±）：血量 = BASE_HP × (1 + (rand−0.5)×JITTER)
  JITTER: 0.4,
  // 每天固定出题上限：错词 → 新词 → 复习 按序填充，不再随天数膨胀
  DAILY_CAP: 20,
  // 错词恢复：本局答错后连续答对 RECOVER_STREAK 次 → 离开错词层（比全局 FORGETTING.RECOVER_STREAK 更宽松，降重复）
  RECOVER_STREAK: 2,
  // 重开继承：局前全局 mastery 达到该值视为"预会"，直接算完成、不再出题
  MASTERY_THRESHOLD: 100,
  // 首通一次性加成：该 (user, stage) 首次通关该 Unit 时额外金币（防重复通关刷收益）
  FIRST_CLEAR_COINS: 100,
} as const;

// ── Buff 体系（v2.7：稀有度 + 关键词协同 + 触发技）──
export type BuffKind = 'passive' | 'active' | 'legend';
export type Rarity = 0 | 1 | 2 | 3; // 白 / 蓝 / 紫 / 金

export interface BuffDef {
  code: string;
  name: string;
  desc: string;
  kind: BuffKind;
  rarity: Rarity;
  tags: string[]; // 关键词：御 / 击 / 愈 / 霜 / 雷 / 火（协同合成用）
  cap: number;    // 叠加上限（1 = 一次性）
  icon: string;
}

export const BUFF_DEFS: Record<string, BuffDef> = {
  maxhp: { code: 'maxhp', name: '生命上限', desc: '+2 maxHp', kind: 'passive', rarity: 0, tags: ['御'], cap: 3, icon: '❤️' },
  dmg: { code: 'dmg', name: '伤害', desc: '伤害 +1', kind: 'passive', rarity: 0, tags: ['击'], cap: 3, icon: '⚔️' },
  leech: { code: 'leech', name: '吸血', desc: '吸血阈值 -2（最低 3）', kind: 'passive', rarity: 0, tags: ['愈'], cap: 2, icon: '🩸' },
  dodge: { code: 'dodge', name: '免伤', desc: '免伤 1 次', kind: 'passive', rarity: 0, tags: ['御'], cap: 2, icon: '🛡️' },
  freeze: { code: 'freeze', name: '冻结', desc: '逼近预算 +1', kind: 'passive', rarity: 0, tags: ['霜'], cap: 2, icon: '❄️' },
  crit: { code: 'crit', name: '会心', desc: '每 5 击必会心(+1)', kind: 'passive', rarity: 1, tags: ['击', '雷'], cap: 3, icon: '💥' },
  armor: { code: 'armor', name: '护甲', desc: '受击 -1', kind: 'passive', rarity: 1, tags: ['御'], cap: 3, icon: '⛨' },
  thorns: { code: 'thorns', name: '反伤', desc: '受击反伤 1', kind: 'passive', rarity: 1, tags: ['火', '御'], cap: 2, icon: '🌵' },
  regen: { code: 'regen', name: '再生', desc: '每 5 题回 1', kind: 'passive', rarity: 2, tags: ['愈'], cap: 2, icon: '💚' },
  combo: { code: 'combo', name: '连击爆发', desc: '连击×5 全场 1 点', kind: 'active', rarity: 2, tags: ['雷', '击'], cap: 1, icon: '🌀' },
  freezeAll: { code: 'freezeAll', name: '霜冻新星', desc: '连击×7 冻结全场', kind: 'active', rarity: 2, tags: ['霜', '雷'], cap: 1, icon: '🌨️' },
  execute: { code: 'execute', name: '斩杀', desc: 'HP≤2 被击中即死', kind: 'active', rarity: 2, tags: ['火', '击'], cap: 1, icon: '⚡' },
  'boss-immunity': { code: 'boss-immunity', name: '免伤免疫', desc: 'Boss P2 失误免疫', kind: 'legend', rarity: 3, tags: ['御'], cap: 1, icon: '🛡️' },
  'kill-heal': { code: 'kill-heal', name: '击杀回血', desc: '击杀 +1 HP', kind: 'legend', rarity: 3, tags: ['愈'], cap: 1, icon: '💚' },
  'boss-x2': { code: 'boss-x2', name: '首领×2', desc: 'Boss 段伤害×2', kind: 'legend', rarity: 3, tags: ['击'], cap: 1, icon: '⚡' },
  'no-leak-dmg': { code: 'no-leak-dmg', name: '漏怪无伤', desc: '漏怪不扣血', kind: 'legend', rarity: 3, tags: ['御'], cap: 1, icon: '🌊' },
  'thorns-aura': { code: 'thorns-aura', name: '反伤光环', desc: '受击反伤 2', kind: 'legend', rarity: 3, tags: ['火'], cap: 1, icon: '🔥' },
  vampiric: { code: 'vampiric', name: '生命虹吸', desc: '击杀回血 +2', kind: 'legend', rarity: 3, tags: ['愈', '雷'], cap: 1, icon: '🧛' },
};

// 普通 buff 池（每天末三选一）
export const NORMAL_BUFF_POOL = [
  'maxhp', 'dmg', 'leech', 'dodge', 'freeze',
  'crit', 'armor', 'thorns', 'regen',
  'combo', 'freezeAll', 'execute',
] as const;

// 传说技能池（首领战后三选一，单局一次）
export const LEGEND_BUFF_POOL = [
  'boss-immunity', 'kill-heal', 'boss-x2', 'no-leak-dmg', 'thorns-aura', 'vampiric',
] as const;

export type NormalBuff = (typeof NORMAL_BUFF_POOL)[number];
export type LegendBuff = (typeof LEGEND_BUFF_POOL)[number];

// 稀有度解锁天数（day ≥ 该值才出现在普通三选一）
export const RARITY_UNLOCK_DAY: Record<0 | 1 | 2, number> = { 0: 1, 1: 2, 2: 4 };

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

// 肉鸽增益"重抽"：每次消耗金币，每波（每天）限 1 次
export const REROLL_COIN_COST = 50;

// 角色特化（永久成长）：消耗高阶材料一次点亮，见 肉鸽模式优化方案.md 第 7 条
export const SPECIALIZE = {
  execute: { coins: 200, materialTier: 3, materialCount: 1 },
  vampire: { coins: 200, materialTier: 3, materialCount: 1 },
} as const;
export type SpecializeKind = 'execute' | 'vampire';
// 斩杀词根引擎参数：词长 ≥ 该值 且 该怪满血（首击）时 +该值伤害
export const SPECIALIZE_EXECUTE_MIN_LEN = 8;
export const SPECIALIZE_EXECUTE_BONUS = 1;

// θ 公式（纯函数，仿真与战斗共用）
export const dayK = (day: number): number =>
  1 + SURVIVAL.DAY_K_GROW * (day - 1);
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
// Boss HP（无上限，随 day 线性增长；Boss 波题数 = bossHp，可击破）
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

// ── 词长伤害 & 敌人特性（确定性纯函数，客户端/服务端共用同一结果）──

// 词长基础伤害：len≤4→1，每 +LEN_DMG_STEP 字母 +1，封顶 +LEN_DMG_MAX
export function wordLenDmg(len?: number): number {
  const L = Math.max(4, len ?? 4);
  return 1 + Math.min(SURVIVAL.LEN_DMG_MAX, Math.floor((L - 4) / SURVIVAL.LEN_DMG_STEP));
}

export type MonsterTrait = 'none' | 'armor' | 'swift' | 'tank' | 'regen' | 'split' | 'elite';

export const MONSTER_TRAITS: readonly MonsterTrait[] = [
  'none',
  'armor',
  'swift',
  'tank',
  'regen',
  'split',
  'elite',
];

// 特性权重（按 tier 升档：Ⅳ 更容易出 elite/护甲/厚皮/分裂）
// 顺序与 MONSTER_TRAITS 对齐：[none, armor, swift, tank, regen, split, elite]
const TRAIT_WEIGHTS: readonly (readonly number[])[] = [
  [5, 2, 2, 1, 1, 1, 0], // I
  [4, 2, 2, 2, 1, 2, 1], // II
  [3, 3, 2, 3, 2, 2, 2], // III
  [2, 3, 3, 4, 2, 3, 4], // IV
];

// 确定性哈希（引擎内禁止随机；同 (tier, seq, day) 永远同结果）
function hash3(a: number, b: number, c: number): number {
  let h = ((a + 1) * 73856093) ^ ((b + 1) * 19349663) ^ ((c + 1) * 83492791);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  return (h ^ (h >>> 15)) >>> 0;
}

export function monsterTraitAt(tier: number, seq: number, day: number): MonsterTrait {
  const weights = TRAIT_WEIGHTS[Math.min(3, Math.max(0, tier))] ?? TRAIT_WEIGHTS[0]!;
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return 'none';
  let r = hash3(tier, seq, day) % total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]!;
    if (r < 0) return MONSTER_TRAITS[i]!;
  }
  return 'none';
}
