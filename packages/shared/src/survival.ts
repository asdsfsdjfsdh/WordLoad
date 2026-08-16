// 生存模式战斗引擎（服务端权威 · 单一来源）
//
// 按题驱动（question-driven）：每答一题调一次 step(correct)，引擎内部维护
// 怪场（HP/逼近预算/补位/眩晕/漏怪）与 Boss（HP/P2/击破），返回逐题数值事件。
// 服务端用它重放答案定生死；前端用它预测并驱动表现层。同一答案序列产出同一 HP。
//
// 数值模型（v2.7，v2.6 基础上接入 buff 效果层）：
// - 场上怪数 = ceil(QUESTIONS_PER_DAY / MONSTERS_DIV)，错峰入场 + 击杀/漏怪补位
// - 逼近预算 = travelBudget(day) + freeze（冻结加时）
// - 词长伤害：基础伤害 = wordLenDmg(len)，新词首击 ×2
// - 连击里程碑：×3 会心（本击 +1）/ ×5 溅射（再打前排 1）/ ×7 全场波（全怪 -1）
// - 敌人特性（确定性分配，引擎零随机）：护甲减伤 / 迅捷加速 / 厚皮高血 /
//   再生回血 / 分裂 / 精英强化
// - buff 效果（由 resolveEffects 从 buff 代号解析，确定性）：
//   会心(critEvery 每 N 击必会心) / 护甲(受击-N) / 反伤(受击对前排反射) /
//   再生(每 N 题回 1) / 斩杀(HP≤斩杀线被击中即死) / 连击爆发(×5 额外全场 1) /
//   霜冻新星(连击≥N 冻结全场 1 回合) / 超载(连击门槛-1) / 冰甲(受击冻结全场) /
//   强攻吸血(击杀回血+1)
// - 错/漏/Boss 失误扣血（dodge 免伤 / armor / defRed 减免）
// - 连错 2 → 眩晕：当回合怪不逼近（不额外消耗题目）
// - 每 leechN 对回 1；kill-heal 击杀回 1（vampiric 2）；no-leak-dmg 漏怪不扣血
// - Boss 波：全 Boss 题，对伤 = boss-x2 ? 2 : 1，累计 ≥ bossHp 击破；
//   P2 半血后 boss-immunity 使失误伤归零；Boss 波无漏怪
import {
  BUFF_DEFS,
  SURVIVAL,
  SPECIALIZE_EXECUTE_BONUS,
  SPECIALIZE_EXECUTE_MIN_LEN,
  applyDef,
  bossHits,
  leechN,
  monsterHits,
  monsterTraitAt,
  travelBudget,
  wordLenDmg,
  type MonsterTrait,
} from './game.js';

export type TierIdx = 0 | 1 | 2 | 3;

export interface WaveBuffState {
  dmg: number;    // 伤害+1 buff 次数
  leech: number;  // 吸血+1 次数
  dodge: number;  // 免伤剩余次数
  freeze: number; // 冻结加时次数
}

export interface SurvivalLegendState {
  bossImmunity: boolean; // P2 免伤免疫
  killHeal: boolean;     // 击杀回血
  bossX2: boolean;       // Boss 段伤害×2
  noLeakDmg: boolean;    // 漏怪不扣血
}

// ── buff 效果层（引擎消费的扁平效果，由 resolveEffects 确定性解析）──
export interface CombatEffects {
  dmg: number;          // 伤害+1 buff 次数
  leech: number;        // 吸血+1 次数
  dodge: number;        // 免伤剩余次数
  freeze: number;       // 冻结加时次数
  critEvery: number;    // 每 N 击必会心(+1)，0=关闭
  armor: number;        // 受击减伤 N（最低 1）
  thorns: number;       // 受击反伤 N，0=关闭
  regenEvery: number;   // 每 N 题回 1，0=关闭
  executeLine: number;  // 斩杀线：HP≤N 被击中即死，0=关闭
  comboBurst: boolean;  // 连击×5 时额外全场 1 点
  freezeAllAt: number;  // 连击≥N 冻结全场 1 回合，0=关闭
  overload: number;     // 连击里程碑门槛 -N
  iceArmor: boolean;    // 受击冻结全场 1 回合
  vampiric: boolean;    // 击杀回血 +1
  bossImmunity: boolean;
  killHeal: boolean;
  bossX2: boolean;
  noLeakDmg: boolean;
}

// 关键词计数（协同合成用）：御/击/愈/霜/雷/火 各自被选中 buff 命中的次数
export interface TagTally {
  御: number; 击: number; 愈: number; 霜: number; 雷: number; 火: number;
}
export function tallyTags(codes: readonly string[]): TagTally {
  const t: TagTally = { 御: 0, 击: 0, 愈: 0, 霜: 0, 雷: 0, 火: 0 };
  for (const code of codes) {
    const d = BUFF_DEFS[code];
    if (!d) continue;
    for (const tag of d.tags) {
      if (tag in t) t[tag as keyof TagTally]++;
    }
  }
  return t;
}

// 已激活的隐藏协同（供 UI 展示，不影响引擎判定，判定仍走 resolveEffects）
export interface SynergyInfo {
  code: string;
  label: string;
  icon: string;
  desc: string;
}

// 全部协同配方（图鉴/教学展示用；activeSynergies 按当前 tally 筛选已激活项）
export const SYNERGY_RECIPES: readonly SynergyInfo[] = [
  { code: 'overload', label: '超载', icon: '⚡', desc: '雷≥1 + 击≥2 → 连击里程碑门槛-1' },
  { code: 'ice-armor', label: '冰甲', icon: '🧊', desc: '霜≥1 + 御≥1 → 受击冻结全场' },
  { code: 'vampiric-combo', label: '生命虹吸', icon: '🧛', desc: '愈≥1 + 击≥2 → 击杀回血' },
  { code: 'combo-burst', label: '轰雷连打', icon: '💥', desc: '雷≥1 + 火≥1 → 连击×5 时全场额外 1 点' },
  { code: 'execute-line', label: '霜火处决', icon: '🔥', desc: '霜≥1 + 火≥1 → 斩杀线 1（HP≤1 被击中即死）' },
  { code: 'thorns-synergy', label: '雷御反伤', icon: '🛡️', desc: '御≥1 + 雷≥1 → 受击反伤 +1' },
];

export function activeSynergies(codes: readonly string[]): SynergyInfo[] {
  const t = tallyTags(codes);
  const out: SynergyInfo[] = [];
  if (t.雷 >= 1 && t.击 >= 2) out.push(SYNERGY_RECIPES[0]!);
  if (t.霜 >= 1 && t.御 >= 1) out.push(SYNERGY_RECIPES[1]!);
  if (t.愈 >= 1 && t.击 >= 2) out.push(SYNERGY_RECIPES[2]!);
  if (t.雷 >= 1 && t.火 >= 1) out.push(SYNERGY_RECIPES[3]!);
  if (t.霜 >= 1 && t.火 >= 1) out.push(SYNERGY_RECIPES[4]!);
  if (t.御 >= 1 && t.雷 >= 1) out.push(SYNERGY_RECIPES[5]!);
  return out;
}

// 从 buff 代号解析为引擎效果（含关键词协同）
export function resolveEffects(codes: readonly string[]): CombatEffects {
  let dmg = 0, leech = 0, dodge = 0, freeze = 0;
  let crit = 0, armor = 0, thorns = 0, regen = 0;
  let combo = false, freezeAll = false, execute = false;
  let bossImmunity = false, killHeal = false, bossX2 = false, noLeakDmg = false;
  let thornsAura = false, vampiric = false;

  for (const code of codes) {
    switch (code) {
      case 'dmg': dmg++; break;
      case 'leech': leech++; break;
      case 'dodge': dodge++; break;
      case 'freeze': freeze++; break;
      case 'crit': crit++; break;
      case 'armor': armor++; break;
      case 'thorns': thorns++; break;
      case 'regen': regen++; break;
      case 'combo': combo = true; break;
      case 'freezeAll': freezeAll = true; break;
      case 'execute': execute = true; break;
      case 'boss-immunity': bossImmunity = true; break;
      case 'kill-heal': killHeal = true; break;
      case 'boss-x2': bossX2 = true; break;
      case 'no-leak-dmg': noLeakDmg = true; break;
      case 'thorns-aura': thornsAura = true; break;
      case 'vampiric': vampiric = true; break;
    }
  }

  const { 御, 击, 愈, 霜, 雷, 火 } = tallyTags(codes);
  const overload = 雷 >= 1 && 击 >= 2 ? 1 : 0;
  return {
    dmg,
    leech,
    dodge,
    freeze,
    critEvery: crit > 0 ? Math.max(3, 7 - 2 * crit) : 0,
    armor,
    thorns: thorns + (thornsAura ? 2 : 0) + (御 >= 1 && 雷 >= 1 ? 1 : 0),
    regenEvery: regen > 0 ? Math.max(3, 6 - regen) : 0,
    executeLine: execute ? 2 : (霜 >= 1 && 火 >= 1 ? 1 : 0),
    comboBurst: combo || (雷 >= 1 && 火 >= 1),
    freezeAllAt: freezeAll ? Math.max(4, 7 - overload) : 0,
    overload,
    iceArmor: 霜 >= 1 && 御 >= 1,
    vampiric: vampiric || (愈 >= 1 && 击 >= 2),
    bossImmunity,
    killHeal,
    bossX2,
    noLeakDmg,
  };
}

// 旧版 buffs/legend 输入 → 效果（向后兼容 balance-sim / 旧测试）
function legacyEffects(buffs: WaveBuffState, legend: SurvivalLegendState): CombatEffects {
  return {
    dmg: buffs.dmg,
    leech: buffs.leech,
    dodge: buffs.dodge,
    freeze: buffs.freeze,
    critEvery: 0,
    armor: 0,
    thorns: 0,
    regenEvery: 0,
    executeLine: 0,
    comboBurst: false,
    freezeAllAt: 0,
    overload: 0,
    iceArmor: false,
    vampiric: false,
    bossImmunity: legend.bossImmunity,
    killHeal: legend.killHeal,
    bossX2: legend.bossX2,
    noLeakDmg: legend.noLeakDmg,
  };
}

export type BattleEvent =
  | { kind: 'monster-hit'; killed: boolean; isNew: boolean; dmg: number; crit: boolean; trait: MonsterTrait }
  | { kind: 'splash-hit'; dmg: number; killed: boolean }
  | { kind: 'wave-hit'; dmg: number; killedCount: number }
  | { kind: 'thorns-hit'; dmg: number; killed: boolean }
  | { kind: 'freeze-all' }
  | { kind: 'combo'; tier: number }
  | { kind: 'elite-killed' }
  | { kind: 'wrong-hit'; dmg: number }
  | { kind: 'leak'; dmg: number }
  | { kind: 'stun' }
  | { kind: 'heal'; amount: number; source: 'leech' | 'kill' | 'regen' }
  | { kind: 'boss-hit'; dmg: number; p2: boolean }
  | { kind: 'boss-miss'; dmg: number }
  | { kind: 'boss-clear' };

export interface WaveStep {
  hp: number;
  dodgeLeft: number;
  bossCleared: boolean;
  events: BattleEvent[];
}

export interface WaveSimInput {
  day: number;
  atkLv: number;
  defLv: number;
  maxHp: number;
  startHp: number;
  buffs: WaveBuffState;
  legend: SurvivalLegendState;
  /** 效果层（推荐）；缺省由 buffs/legend 推导，向后兼容 */
  effects?: CombatEffects;
  /** 角色特化（持久化、非局内 buff），服务端/客户端必须一致传入 */
  specs?: RunSpecs;
  /** 本波题目元数据（按答题顺序，与服务端 pending / 前端 questions 对齐） */
  questions: { tier: TierIdx; isNew: boolean; isBoss: boolean; len?: number }[];
  bossWave: boolean;
  bossHp?: number;
  /** 测试注入：自定义特性分配（默认 monsterTraitAt，客户端/服务端必须一致） */
  traitFor?: (tier: number, seq: number, day: number) => MonsterTrait;
  /** 局内全局连击初值（跨波累计，由服务端持久化；缺省 0） */
  initialCombo?: number;
}

// 角色特化（永久成长，见 肉鸽模式优化方案.md 第 7 条）
export interface RunSpecs {
  /** 斩杀词根：词长 ≥ SPECIALIZE_EXECUTE_MIN_LEN 时对该怪首击 +SPECIALIZE_EXECUTE_BONUS */
  executeSpec: boolean;
  /** 复习专精：复习词（非新词）触发吸血时回 2（默认回 1） */
  vampireSpec: boolean;
}

export interface WaveSimStats {
  correct: number;
  wrong: number;
  leaked: number;
  stuns: number;
  eliteKills: number;
}

export interface WaveSim {
  /** 处理一题（按顺序逐题调用）；返回本题目触发的事件与当前血量 */
  step(correct: boolean): WaveStep;
  readonly hp: number;
  readonly bossCleared: boolean;
  readonly bossHpLeft: number;
  readonly bossP2: boolean;
  readonly stats: WaveSimStats;
  /** 当前全局连击（跨波累计，错答归零） */
  readonly combo: number;
  /** 本 sim 生命周期内连击峰值（含 initialCombo） */
  readonly maxCombo: number;
}

interface FieldMonster {
  hp: number;
  maxHp: number;
  timer: number;
  trait: MonsterTrait;
}

const wrongRaw = (day: number): number =>
  SURVIVAL.WRONG_BASE + SURVIVAL.WRONG_GROW * (day - 1);
const leakRaw = (day: number): number =>
  SURVIVAL.LEAK_BASE + SURVIVAL.LEAK_GROW * (day - 1);
const bossRaw = (day: number): number =>
  SURVIVAL.BOSS_DMG_BASE + SURVIVAL.BOSS_DMG_GROW * (day - 1);

export function createWaveSim(input: WaveSimInput): WaveSim {
  const questions = input.questions;
  const fx = input.effects ?? legacyEffects(input.buffs, input.legend);
  const totalMonsters = Math.max(1, Math.ceil(SURVIVAL.QUESTIONS_PER_DAY / SURVIVAL.MONSTERS_DIV));
  const maxField = SURVIVAL.MAX_FIELD;
  const spawnGap = Math.max(1, Math.floor(SURVIVAL.QUESTIONS_PER_DAY / totalMonsters));
  const budget = travelBudget(input.day) + fx.freeze;
  const traitOf = input.traitFor ?? monsterTraitAt;

  let hp = Math.max(0, input.startHp);
  let dodge = fx.dodge;
  let correct = 0;
  let wrong = 0;
  let leaked = 0;
  let stuns = 0;
  let eliteKills = 0;
  let consecWrong = 0;
  let combo = input.initialCombo ?? 0;
  let maxCombo = combo;
  let hitCount = 0;
  let index = 0;
  let done = hp <= 0;
  let regenTick = 0;
  let fxRegenTick = 0;
  let freezeFieldTurns = 0;

  // Boss 状态
  const bossMax = input.bossWave ? (input.bossHp ?? bossHits(input.day, input.atkLv)) : 0;
  let bossHp = bossMax;
  let bossP2 = false;
  let bossCleared = false;

  // 怪场
  const field: FieldMonster[] = [];
  const spawn = (i: number): FieldMonster => {
    const tier = questions[i]?.tier ?? 0;
    const trait = traitOf(tier, i, input.day);
    let mhp = monsterHits(tier, input.day, input.atkLv, fx.dmg);
    if (trait === 'tank') mhp = Math.ceil(mhp * SURVIVAL.TRAIT_TANK_MULT);
    if (trait === 'elite') mhp = Math.ceil(mhp * SURVIVAL.TRAIT_ELITE_MULT);
    let timer = budget;
    if (trait === 'swift') timer = Math.max(1, timer - SURVIVAL.TRAIT_SWIFT_BUDGET);
    return { hp: mhp, maxHp: mhp, timer, trait };
  };
  let spawnIdx = 0;
  if (!input.bossWave && questions.length > 0) {
    field.push(spawn(0));
    spawnIdx = 1;
  }

  const heal = (amount: number): number => {
    const before = hp;
    hp = Math.min(input.maxHp, hp + amount);
    return hp - before;
  };

  const takeDamage = (raw: number): number => {
    if (dodge > 0) {
      dodge--;
      return 0;
    }
    const d = Math.max(1, applyDef(raw, input.defLv) - fx.armor);
    hp -= d;
    return d;
  };

  const maybeLeech = (events: BattleEvent[], isReview: boolean): void => {
    const n = leechN(fx.leech);
    if (correct > 0 && correct % n === 0) {
      // 复习专精：复习词（非新词）触发吸血回 2
      const amt = heal(input.specs?.vampireSpec && isReview ? 2 : 1);
      if (amt > 0) events.push({ kind: 'heal', amount: amt, source: 'leech' });
    }
  };

  const maybeKillHeal = (events: BattleEvent[]): void => {
    if (fx.killHeal) {
      const amt = heal(fx.vampiric ? 2 : 1);
      if (amt > 0) events.push({ kind: 'heal', amount: amt, source: 'kill' });
    }
  };

  // 命中结算（怪护甲减伤）
  const applyHit = (m: FieldMonster, raw: number): number => {
    const dmg = m.trait === 'armor' ? Math.max(1, raw - SURVIVAL.TRAIT_ARMOR_RED) : raw;
    m.hp -= dmg;
    return dmg;
  };

  // 击杀前排：分裂 / 补位 / 精英计数 / 击杀回血
  const removeFront = (events: BattleEvent[], idx: number): void => {
    const dead = field.shift()!;
    if (dead.trait === 'elite') {
      eliteKills++;
      events.push({ kind: 'elite-killed' });
    }
    let replaced = false;
    if (dead.trait === 'split' && field.length < maxField) {
      for (let s = 0; s < SURVIVAL.TRAIT_SPLIT_COUNT; s++) {
        if (field.length >= maxField) break;
        field.unshift({
          hp: 1,
          maxHp: 1,
          timer: Math.max(1, budget - SURVIVAL.TRAIT_SPLIT_TIMER),
          trait: 'none',
        });
      }
      replaced = true;
    }
    if (!replaced && spawnIdx < totalMonsters) {
      field.push(spawn(idx));
      spawnIdx++;
    }
    maybeKillHeal(events);
  };

  // 漏怪前排（不触发分裂/回血/精英）
  const leakFront = (events: BattleEvent[], idx: number): void => {
    field.shift();
    if (spawnIdx < totalMonsters) {
      field.push(spawn(idx));
      spawnIdx++;
    }
    const taken = fx.noLeakDmg ? 0 : takeDamage(leakRaw(input.day));
    events.push({ kind: 'leak', dmg: taken });
  };

  // 全场伤害（含补位 / 击杀回血）
  const applyFieldDamage = (dmg: number, events: BattleEvent[], idx: number): number => {
    let killedCount = 0;
    for (let fi = 0; fi < field.length; ) {
      const m = field[fi]!;
      applyHit(m, dmg);
      if (m.hp <= 0) {
        field.splice(fi, 1);
        killedCount++;
      } else {
        fi++;
      }
    }
    while (field.length < maxField && spawnIdx < totalMonsters) {
      field.push(spawn(idx));
      spawnIdx++;
    }
    if (field.length === 0 && spawnIdx < totalMonsters) {
      field.push(spawn(idx));
      spawnIdx++;
    }
    for (let i = 0; i < killedCount; i++) maybeKillHeal(events);
    return killedCount;
  };

  const snapshot = (events: BattleEvent[]): WaveStep => ({
    hp: Math.max(0, hp),
    dodgeLeft: dodge,
    bossCleared,
    events,
  });

  return {
    get hp() {
      return Math.max(0, hp);
    },
    get bossCleared() {
      return bossCleared;
    },
    get bossHpLeft() {
      return Math.max(0, bossHp);
    },
    get bossP2() {
      return bossP2;
    },
    get combo() {
      return combo;
    },
    get maxCombo() {
      return maxCombo;
    },
    get stats() {
      return { correct, wrong, leaked, stuns, eliteKills };
    },
    step(correctAnswer: boolean): WaveStep {
      if (done) return snapshot([]);
      const idx = index;
      if (idx >= questions.length) {
        done = true;
        return snapshot([]);
      }
      index++;
      const events: BattleEvent[] = [];

      if (input.bossWave) {
        if (correctAnswer) {
          correct++;
          consecWrong = 0;
          combo++;
          maxCombo = Math.max(maxCombo, combo);
          const dmg = fx.bossX2 ? 2 : 1;
          bossHp -= dmg;
          if (bossHp <= bossMax / 2 && !bossP2) bossP2 = true;
          events.push({ kind: 'boss-hit', dmg, p2: bossP2 });
          if (bossHp <= 0 && !bossCleared) {
            bossCleared = true;
            events.push({ kind: 'boss-clear' });
          }
        } else {
          wrong++;
          consecWrong++;
          combo = 0;
          // 击破后剩余题不再造成失误伤害（Boss 已倒，仅清残余题）
          const taken = bossCleared
            ? 0
            : bossP2 && fx.bossImmunity
              ? 0
              : takeDamage(bossRaw(input.day));
          events.push({ kind: 'boss-miss', dmg: taken });
          if (consecWrong >= 2) {
            consecWrong = 0;
            events.push({ kind: 'stun' });
          }
        }
        // Boss 波不回血（吸血/再生失效）：Boss 为纯消耗战
        if (hp <= 0) done = true;
        return snapshot(events);
      }

      // 普通波：错峰入场
      if (idx > 0 && idx % spawnGap === 0 && field.length < maxField && spawnIdx < totalMonsters) {
        field.push(spawn(idx));
        spawnIdx++;
      }

      if (correctAnswer) {
        correct++;
        consecWrong = 0;
        combo++;
        maxCombo = Math.max(maxCombo, combo);
        const q = questions[idx] ?? { tier: 0 as TierIdx, isNew: false, len: 4 };
        const off = fx.overload;
        const critAt = combo === Math.max(1, SURVIVAL.COMBO_CRIT - off);
        const splashAt = combo === Math.max(1, SURVIVAL.COMBO_SPLASH - off);
        const waveAt = combo === Math.max(1, SURVIVAL.COMBO_WAVE - off);
        if (critAt) events.push({ kind: 'combo', tier: SURVIVAL.COMBO_CRIT });
        if (splashAt) events.push({ kind: 'combo', tier: SURVIVAL.COMBO_SPLASH });
        if (waveAt) events.push({ kind: 'combo', tier: SURVIVAL.COMBO_WAVE });

        if (field.length > 0) {
          let dmg = wordLenDmg(q.len) * (q.isNew ? SURVIVAL.NEW_WORD_DMG_X : 1);
          let isCrit = false;
          if (fx.critEvery > 0) {
            hitCount++;
            isCrit = hitCount % fx.critEvery === 0;
            if (isCrit) dmg += 1;
          }
          if (critAt) dmg += SURVIVAL.COMBO_CRIT_BONUS;

          const front = field[0]!;
          // 斩杀词根：词长≥阈值 且 该怪满血（首击）时额外伤害
          if (input.specs?.executeSpec && (q.len ?? 4) >= SPECIALIZE_EXECUTE_MIN_LEN && front.hp >= front.maxHp) {
            dmg += SPECIALIZE_EXECUTE_BONUS;
          }
          const executeKill = fx.executeLine > 0 && front.hp <= fx.executeLine;
          let dealt: number;
          if (executeKill) {
            dealt = front.hp; // 斩杀：实际造成的伤害 = 剩余 HP（事件上报贴近真实）
            front.hp = 0;
          } else {
            dealt = applyHit(front, dmg);
          }
          const killed = front.hp <= 0;
          const deadTrait = front.trait;
          if (killed) removeFront(events, idx);
          events.push({
            kind: 'monster-hit',
            killed,
            isNew: !!q.isNew,
            dmg: dealt,
            crit: critAt || isCrit || executeKill,
            trait: deadTrait,
          });

          // 溅射：额外对当前前排打 1
          if (splashAt && field.length > 0) {
            const f2 = field[0]!;
            const d2 = applyHit(f2, SURVIVAL.COMBO_SPLASH_DMG);
            const k2 = f2.hp <= 0;
            if (k2) removeFront(events, idx);
            events.push({ kind: 'splash-hit', dmg: d2, killed: k2 });
            // 连击爆发：×5 时额外全场 1 点
            if (fx.comboBurst && field.length > 0) {
              const kc = applyFieldDamage(SURVIVAL.COMBO_SPLASH_DMG, events, idx);
              events.push({ kind: 'wave-hit', dmg: SURVIVAL.COMBO_SPLASH_DMG, killedCount: kc });
            }
          }

          // 全场波：全怪 -1
          if (waveAt && field.length > 0) {
            const kc = applyFieldDamage(SURVIVAL.COMBO_WAVE_DMG, events, idx);
            events.push({ kind: 'wave-hit', dmg: SURVIVAL.COMBO_WAVE_DMG, killedCount: kc });
          }

          // 霜冻新星：连击恰达 freezeAllAt → 本回合怪不逼近（一次性里程碑，避免连击不断则永久冻结）
          if (fx.freezeAllAt > 0 && combo === fx.freezeAllAt) {
            freezeFieldTurns = Math.max(freezeFieldTurns, 1);
            events.push({ kind: 'freeze-all' });
          }
        }
      } else {
        wrong++;
        consecWrong++;
        combo = 0;
        const taken = takeDamage(wrongRaw(input.day));
        events.push({ kind: 'wrong-hit', dmg: taken });
        // 反伤：受击对前排反射
        if (taken > 0 && fx.thorns > 0 && field.length > 0) {
          const d = applyHit(field[0]!, fx.thorns);
          const k = field[0]!.hp <= 0;
          if (k) removeFront(events, idx);
          events.push({ kind: 'thorns-hit', dmg: d, killed: k });
        }
        // 冰甲：受击冻结全场 1 回合
        if (taken > 0 && fx.iceArmor) {
          freezeFieldTurns = Math.max(freezeFieldTurns, 1);
          events.push({ kind: 'freeze-all' });
        }
      }

      let stunned = false;
      if (consecWrong >= 2) {
        consecWrong = 0;
        stunned = true;
        stuns++;
        events.push({ kind: 'stun' });
      }

      // 怪逼近：眩晕/冻结当回合不逼近；仅前锋预算耗尽 → 漏怪
      if (!stunned) {
        if (freezeFieldTurns > 0) {
          freezeFieldTurns--;
        } else {
          // 玩家再生：每 regenEvery 题回 1
          fxRegenTick++;
          if (fx.regenEvery > 0 && fxRegenTick >= fx.regenEvery) {
            fxRegenTick = 0;
            const amt = heal(1);
            if (amt > 0) events.push({ kind: 'heal', amount: amt, source: 'regen' });
          }
          // 怪再生特性
          regenTick++;
          if (regenTick >= SURVIVAL.TRAIT_REGEN_EVERY) {
            regenTick = 0;
            for (const m of field) {
              if (m.trait === 'regen') m.hp = Math.min(m.maxHp, m.hp + SURVIVAL.TRAIT_REGEN_AMOUNT);
            }
          }

          for (const m of field) m.timer -= 1;
          if (field.length > 0 && field[0]!.timer <= 0) {
            leaked++;
            leakFront(events, idx);
          }
          while (field.length < maxField && spawnIdx < totalMonsters) {
            field.push(spawn(idx));
            spawnIdx++;
          }
        }
      }

      maybeLeech(events, !(questions[idx]?.isNew ?? false));
      if (hp <= 0) done = true;
      return snapshot(events);
    },
  };
}
