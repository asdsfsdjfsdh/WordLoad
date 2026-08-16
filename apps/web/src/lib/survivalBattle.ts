// 生存模式波内数值 + 状态（客户端表现层镜像）
// 服务端权威：HP / 漏怪 / Boss 击破由共享引擎 createWaveSim 按题重放决定。
// 客户端仅用同一引擎做表现层镜像（数值查询 + 事件驱动视觉），结果以
// 服务端权威：步进结果以 advance 返回为准（服务端重放引擎定生死）。
import {
  SURVIVAL,
  applyDef,
  bossHits,
  createWaveSim,
  leechN,
  monsterHits,
  monsterSpeed,
  monsterTraitAt,
  type BattleEvent,
  type CombatEffects,
  type MonsterTrait,
} from '@word-journey/shared';

export type TierIdx = 0 | 1 | 2 | 3;

export interface SurvivalBuffState {
  dmg: number; // 伤害+1 buff 次数
  leech: number; // 吸血+1 次数
  dodge: number; // 免伤剩余次数
  freeze: number; // 冻结加时次数
}

export interface SurvivalLegendState {
  bossImmunity: boolean; // P2 免伤免疫
  killHeal: boolean; // 击杀回血
  bossX2: boolean; // Boss 段伤害×2
  noLeakDmg: boolean; // 漏怪不扣血
}

export interface SurvivalWaveMeta {
  day: number;
  atkLv: number;
  defLv: number;
  hpLv: number;
  maxHp: number;
  hp: number;
  buffs: SurvivalBuffState;
  legend: SurvivalLegendState;
  // buff 效果层（resolveEffects 解析，与引擎一致）
  effects?: CombatEffects;
  // 角色特化（与服务端引擎口径一致）
  executeSpec?: boolean;
  vampireSpec?: boolean;
  // 本局词池大小（累计去重词数，day1=20，注入逐日增加）
  poolUsed?: number;
  // 本局已生效 buff 代号（含待生效候选），HUD 徽章展示用
  buffCodes?: string[];
  // 本波问题元数据（按答题顺序，与服务端 pending 对齐）
  questions: { tier: TierIdx; isNew: boolean; isBoss: boolean; len?: number }[];
  // Boss 波：为 true 时该波全是 Boss 题
  bossWave: boolean;
  bossHp?: number;
  // 局内全局连击初值（跨波累计，服务端持久化；续 Run/次日需透传）
  initialCombo?: number;
}

// 实时逼近速度 px/sec 基准（与普通模式怪速同量级，M7 可调）
const VISUAL_SPEED_BASE = 26;

export class SurvivalBattle {
  private meta: SurvivalWaveMeta;
  private sim: ReturnType<typeof createWaveSim>;
  private answeredCount = 0;

  constructor(meta: SurvivalWaveMeta) {
    this.meta = meta;
    this.sim = createWaveSim({
      day: meta.day,
      atkLv: meta.atkLv,
      defLv: meta.defLv,
      maxHp: meta.maxHp,
      startHp: meta.hp,
      buffs: {
        dmg: meta.buffs.dmg,
        leech: meta.buffs.leech,
        dodge: meta.buffs.dodge,
        freeze: meta.buffs.freeze,
      },
      legend: meta.legend,
      effects: meta.effects,
      specs: meta.executeSpec || meta.vampireSpec
        ? { executeSpec: !!meta.executeSpec, vampireSpec: !!meta.vampireSpec }
        : undefined,
      questions: meta.questions,
      bossWave: meta.bossWave,
      bossHp: meta.bossWave ? (meta.bossHp ?? bossHits(meta.day, meta.atkLv)) : undefined,
      initialCombo: meta.initialCombo ?? 0,
    });
  }

  get currentHp(): number {
    return this.sim.hp;
  }

  get stats(): { correct: number; wrong: number; leaked: number } {
    return this.sim.stats;
  }

  get correctCount(): number {
    return this.sim.stats.correct;
  }

  get isBossCleared(): boolean {
    return this.sim.bossCleared;
  }

  get bossRemaining(): number {
    return this.sim.bossHpLeft;
  }

  get bossMax(): number {
    return this.meta.bossWave ? (this.meta.bossHp ?? bossHits(this.meta.day, this.meta.atkLv)) : 0;
  }

  get bossP2Active(): boolean {
    return this.sim.bossP2;
  }

  get combo(): number {
    return this.sim.combo;
  }

  get answered(): number {
    return this.answeredCount;
  }

  // ── 逐问推进：返回事件，表现层据此播放视觉（血量/击破已由引擎结算）──
  step(correct: boolean): BattleEvent[] {
    this.answeredCount++;
    return this.sim.step(correct).events;
  }

  // ── 数值查询（表现层据此生成怪 / 结算视觉）──
  monsterHpFor(tier: TierIdx): number {
    return monsterHits(tier, this.meta.day, this.meta.atkLv, this.meta.buffs.dmg);
  }
  monsterSpeedFor(tier: TierIdx): number {
    return monsterSpeed(this.meta.day, tier, VISUAL_SPEED_BASE);
  }
  wrongDmg(): number {
    return applyDef(this.wrongRaw(), this.meta.defLv);
  }
  leakDmg(): number {
    return this.meta.legend.noLeakDmg ? 0 : applyDef(this.leakRaw(), this.meta.defLv);
  }
  bossMissDmg(): number {
    return this.bossP2Active && this.meta.legend.bossImmunity ? 0 : applyDef(this.bossRaw(), this.meta.defLv);
  }
  leechEvery(): number {
    return leechN(this.meta.buffs.leech);
  }
  bossX2Active(): boolean {
    return this.meta.legend.bossX2;
  }
  spawnTier(): TierIdx {
    // 引擎按「当前题 idx」补怪；本封装 answeredCount 在 step 后已 +1 → 用刚答完的题
    const i = this.answeredCount - 1;
    return this.meta.questions[Math.min(Math.max(0, i), Math.max(0, this.meta.questions.length - 1))]?.tier ?? 0;
  }
  currentQuestionIsNew(): boolean {
    const i = this.answeredCount - 1;
    return this.meta.questions[Math.min(Math.max(0, i), Math.max(0, this.meta.questions.length - 1))]?.isNew ?? false;
  }
  // 当前题对应怪特性（与引擎 monsterTraitAt 同源，确定性一致；视觉用）
  currentTrait(): MonsterTrait {
    const i = Math.max(0, this.answeredCount - 1);
    const q = this.meta.questions[Math.min(i, Math.max(0, this.meta.questions.length - 1))];
    return monsterTraitAt(q?.tier ?? 0, i, this.meta.day);
  }
  // 视觉怪 HP（含厚皮/精英特性加成）
  monsterHpForTrait(tier: TierIdx): number {
    let hp = this.monsterHpFor(tier);
    const t = this.currentTrait();
    if (t === 'tank') hp = Math.ceil(hp * SURVIVAL.TRAIT_TANK_MULT);
    if (t === 'elite') hp = Math.ceil(hp * SURVIVAL.TRAIT_ELITE_MULT);
    return hp;
  }

  private wrongRaw(): number {
    return SURVIVAL.WRONG_BASE + SURVIVAL.WRONG_GROW * (this.meta.day - 1);
  }
  private leakRaw(): number {
    return SURVIVAL.LEAK_BASE + SURVIVAL.LEAK_GROW * (this.meta.day - 1);
  }
  private bossRaw(): number {
    return SURVIVAL.BOSS_DMG_BASE + SURVIVAL.BOSS_DMG_GROW * (this.meta.day - 1);
  }
}
