// 生存模式波内数值计算 + 血量账本（逻辑层，可测/可回放）
// 表现层完全复用普通模式 BattleField 引擎；sim 只负责数值查询、血量账本与波末 finalHp
import {
  SURVIVAL,
  applyDef,
  bossHits,
  leechN,
  monsterHits,
  monsterSpeed,
} from '@word-journey/shared';

export type TierIdx = 0 | 1 | 2 | 3;

export interface SurvivalBuffState {
  dmg: number; // 伤害+1 buff 次数（并入 monsterHits 分母）
  leech: number; // 吸血+1 次数
  dodge: number; // 免伤剩余次数
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
  // 本波问题元数据（按答题顺序，与服务端 pending 对齐）
  questions: { tier: TierIdx; isNew: boolean; isBoss: boolean }[];
  // Boss 波：为 true 时该波全是 Boss 题
  bossWave: boolean;
  bossHp?: number;
}

// 实时逼近速度 px/sec 基准（与普通模式怪速同量级，M7 可调）
const VISUAL_SPEED_BASE = 26;

export class SurvivalBattle {
  private meta: SurvivalWaveMeta;
  private hp: number;
  private correct = 0;
  private wrong = 0;
  private leaked = 0;
  private consecWrong = 0;
  private dodge: number;
  private bossHp: number;
  private bossMax: number;
  private bossP2 = false;
  private bossCleared = false;

  constructor(meta: SurvivalWaveMeta) {
    this.meta = meta;
    this.hp = meta.hp;
    this.dodge = meta.buffs.dodge;
    this.bossMax = meta.bossWave ? (meta.bossHp ?? bossHits(meta.day, meta.atkLv)) : 0;
    this.bossHp = this.bossMax;
  }

  get currentHp(): number {
    return Math.max(0, this.hp);
  }

  get stats(): { correct: number; wrong: number; leaked: number } {
    return { correct: this.correct, wrong: this.wrong, leaked: this.leaked };
  }

  get correctCount(): number {
    return this.correct;
  }

  get isBossCleared(): boolean {
    return this.bossCleared;
  }

  get bossRemaining(): number {
    return Math.max(0, this.bossHp);
  }

  get bossP2Active(): boolean {
    return this.bossP2;
  }

  // ── 数值查询（普通引擎据此生成怪 / 结算伤害）──
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
    return this.bossP2 && this.meta.legend.bossImmunity ? 0 : applyDef(this.bossRaw(), this.meta.defLv);
  }
  bossHpNow(): number {
    return this.bossMax;
  }
  leechEvery(): number {
    return leechN(this.meta.buffs.leech);
  }
  bossX2Active(): boolean {
    return this.meta.legend.bossX2;
  }
  spawnTier(): TierIdx {
    const i = this.correct + this.wrong;
    return this.meta.questions[Math.min(i, Math.max(0, this.meta.questions.length - 1))]?.tier ?? 0;
  }
  currentQuestionIsNew(): boolean {
    const i = this.correct + this.wrong;
    return this.meta.questions[Math.min(i, Math.max(0, this.meta.questions.length - 1))]?.isNew ?? false;
  }

  // ── 账本操作（普通引擎在事件发生时调用）──
  // 扣血（免伤/防御生效），返回实际扣除
  hurt(raw: number): number {
    if (this.dodge > 0) {
      this.dodge--;
      return 0;
    }
    const d = applyDef(raw, this.meta.defLv);
    this.hp -= d;
    return d;
  }
  heal(amount: number): number {
    const before = this.hp;
    this.hp = Math.min(this.meta.maxHp, this.hp + amount);
    return this.hp - before;
  }
  onCorrect(): void {
    this.correct++;
  }
  // 返回是否触发连错眩晕
  onWrong(): boolean {
    this.wrong++;
    this.consecWrong++;
    if (this.consecWrong >= 2) {
      this.consecWrong = 0;
      return true;
    }
    return false;
  }
  onKill(): void {
    if (this.meta.legend.killHeal) this.heal(1);
  }
  onLeak(): void {
    this.leaked++;
  }
  // Boss 命中：扣 boss HP，返回 P2 是否触发 / 是否击破
  onBossHit(dmg: number): { p2: boolean; cleared: boolean } {
    this.bossHp -= dmg;
    if (this.bossHp <= this.bossMax / 2 && !this.bossP2) this.bossP2 = true;
    const cleared = this.bossHp <= 0;
    if (cleared && !this.bossCleared) {
      this.bossCleared = true;
      this.heal(SURVIVAL.BOSS_HEAL);
    }
    return { p2: this.bossP2, cleared };
  }
  // Boss P2 由普通引擎判定后同步
  setBossP2(v: boolean): void {
    this.bossP2 = v;
  }

  private wrongRaw(): number {
    return Math.min(
      SURVIVAL.WRONG_BASE + SURVIVAL.WRONG_GROW * (this.meta.day - 1),
      SURVIVAL.WRONG_CAP,
    );
  }
  private leakRaw(): number {
    return Math.min(
      SURVIVAL.LEAK_BASE + SURVIVAL.LEAK_GROW * (this.meta.day - 1),
      SURVIVAL.LEAK_CAP,
    );
  }
  private bossRaw(): number {
    return Math.min(
      SURVIVAL.BOSS_DMG_BASE + SURVIVAL.BOSS_DMG_GROW * (this.meta.day - 1),
      SURVIVAL.BOSS_DMG_CAP,
    );
  }
}
