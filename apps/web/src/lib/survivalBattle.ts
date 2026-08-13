// 生存模式波内逐问模拟（M4）：镜像服务端 replayDay 的纯逻辑，驱动 BattleField 战斗层
// 服务端权威不变：波末 advance 定死亡；此处仅为客户端波内预测显示与战斗视觉
// θ/吸血/漏怪/Boss 全走 shared 配置，与服务端同一公式
import {
  SURVIVAL,
  applyDef,
  bossHits,
  leechN,
  monsterHits,
  travelBudget,
} from '@word-journey/shared';

export type TierIdx = 0 | 1 | 2 | 3;

export interface SurvivalBuffState {
  dmg: number; // 伤害+1 buff 次数（已并入 monsterHits 分母）
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

export interface SurvivalMonster {
  id: number;
  tier: TierIdx;
  hp: number; // 剩余所需答对数
  maxHp: number;
  timer: number; // 剩余逼近题数
  initTimer: number;
  progress: number; // 0..1 逼近进度（前端 x 插值用）
  splitOnDeath: boolean;
}

export type SurvivalEvent =
  | { type: 'spawn'; monster: SurvivalMonster }
  | { type: 'attack'; targetId: number; dmg: number; crit: boolean }
  | { type: 'kill'; targetId: number; heal: number } // heal>0 = 击杀回血
  | { type: 'wrong'; dmg: number; blocked: boolean } // blocked = 免伤消耗
  | { type: 'leak'; dmg: number; blocked: boolean }
  | { type: 'stun' }
  | { type: 'leech'; amount: number } // "+♥ 回血"
  | { type: 'boss-hit'; dmg: number; bossHp: number; p2: boolean; cleared: boolean }
  | { type: 'boss-miss'; dmg: number; immune: boolean; bossHp: number }
  | { type: 'death' };

// 与服务端 replayDay 相同的怪场常量（QUESTIONS_PER_DAY=20, MONSTERS_DIV=3）
const TOTAL_MONSTERS = Math.max(
  1,
  Math.ceil(SURVIVAL.QUESTIONS_PER_DAY / SURVIVAL.MONSTERS_DIV),
);
const MAX_FIELD = SURVIVAL.MAX_FIELD;
const SPAWN_GAP = Math.max(1, Math.floor(SURVIVAL.QUESTIONS_PER_DAY / TOTAL_MONSTERS));

let nextId = 1;

export class SurvivalBattle {
  private meta: SurvivalWaveMeta;
  private hp: number;
  private correct = 0;
  private wrong = 0;
  private leaked = 0;
  private stuns = 0;
  private consecWrong = 0;
  private stunNext = false;
  private field: SurvivalMonster[] = [];
  private spawnIdx = 0;
  private qIdx = 0;
  private bossHp: number;
  private bossP2 = false;
  private bossCleared = false;
  private dodge: number;

  constructor(meta: SurvivalWaveMeta) {
    this.meta = meta;
    this.hp = meta.hp;
    this.dodge = meta.buffs.dodge;
    this.bossHp = meta.bossWave ? (meta.bossHp ?? bossHits(meta.day, meta.atkLv)) : 0;
    if (!meta.bossWave) {
      this.field.push(this.spawn(0));
      this.spawnIdx = 1;
    }
  }

  get currentHp(): number {
    return Math.max(0, this.hp);
  }

  get monsters(): SurvivalMonster[] {
    return this.field;
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

  get correctCount(): number {
    return this.correct;
  }

  private spawn(i: number): SurvivalMonster {
    const q = this.meta.questions[i] ?? { tier: 0 as TierIdx, isNew: false, isBoss: false };
    const hits = monsterHits(q.tier, this.meta.day, this.meta.atkLv, this.meta.buffs.dmg);
    const budget = travelBudget(this.meta.day);
    return {
      id: nextId++,
      tier: q.tier,
      hp: hits,
      maxHp: hits,
      timer: budget,
      initTimer: budget,
      progress: 0,
      splitOnDeath: false,
    };
  }

  private heal(amount: number): number {
    const before = this.hp;
    this.hp = Math.min(this.meta.maxHp, this.hp + amount);
    return this.hp - before;
  }

  // 返回实际扣血量（免伤/免伤 legend 时 0）
  private hurt(raw: number): number {
    if (this.dodge > 0) {
      this.dodge--;
      return 0;
    }
    const dmg = applyDef(raw, this.meta.defLv);
    this.hp -= dmg;
    return dmg;
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

  // 逐问推进（服务端权威在波末 advance；此处返回视觉事件）
  tick(correct: boolean): SurvivalEvent[] {
    const events: SurvivalEvent[] = [];
    const q = this.meta.questions[this.qIdx];
    const qi = this.qIdx;
    this.qIdx++;

    if (this.meta.bossWave) {
      return this.tickBoss(correct);
    }

    // 与服务端一致：错峰入场（i>0 && i%spawnGap==0 && 场上未满）
    if (
      qi > 0 &&
      qi % SPAWN_GAP === 0 &&
      this.field.length < MAX_FIELD &&
      this.spawnIdx < TOTAL_MONSTERS
    ) {
      const m = this.spawn(qi);
      this.field.push(m);
      this.spawnIdx++;
      events.push({ type: 'spawn', monster: m });
    }

    if (this.stunNext) {
      this.stunNext = false;
      this.stuns++;
      return [];
    }

    // 答对 → 攻击前锋
    if (correct) {
      this.correct++;
      this.consecWrong = 0;
      if (this.field.length > 0) {
        const front = this.field[0]!;
        const dmg = q?.isNew ? SURVIVAL.NEW_WORD_DMG_X : 1;
        front.hp -= dmg;
        events.push({ type: 'attack', targetId: front.id, dmg, crit: q?.isNew ?? false });
        if (front.hp <= 0) {
          this.field.shift();
          let heal = 0;
          if (this.meta.legend.killHeal) heal = this.heal(1);
          events.push({ type: 'kill', targetId: front.id, heal });
          if (this.spawnIdx < TOTAL_MONSTERS) {
            const m = this.spawn(this.qIdx - 1);
            this.field.push(m);
            this.spawnIdx++;
            events.push({ type: 'spawn', monster: m });
          }
        }
      }
    } else {
      this.wrong++;
      this.consecWrong++;
      const taken = this.hurt(this.wrongRaw());
      events.push({ type: 'wrong', dmg: taken, blocked: taken === 0 });
      if (this.hp <= 0) {
        events.push({ type: 'death' });
        return events;
      }
    }

    if (this.consecWrong >= 2) {
      this.stunNext = true;
      this.consecWrong = 0;
      events.push({ type: 'stun' });
    }

    // 怪逼近（仅前锋漏怪）
    if (this.stunNext) return events;
    for (const m of this.field) m.timer -= 1;
    for (const m of this.field) {
      m.progress = Math.max(0, Math.min(1, 1 - m.timer / m.initTimer));
    }
    if (this.field.length > 0 && this.field[0]!.timer <= 0) {
      this.leaked++;
      this.field.shift();
      let taken = 0;
      if (!this.meta.legend.noLeakDmg) {
        taken = this.hurt(this.leakRaw());
      }
      events.push({ type: 'leak', dmg: taken, blocked: taken === 0 });
      if (this.spawnIdx < TOTAL_MONSTERS) {
        const m = this.spawn(this.qIdx - 1);
        this.field.push(m);
        this.spawnIdx++;
        events.push({ type: 'spawn', monster: m });
      }
    }
    while (this.field.length < MAX_FIELD && this.spawnIdx < TOTAL_MONSTERS) {
      const m = this.spawn(this.qIdx - 1);
      this.field.push(m);
      this.spawnIdx++;
      events.push({ type: 'spawn', monster: m });
    }

    // 吸血：每答对 N 题回 1（与服务端波末 floor(correct/N) 同总量）
    const n = leechN(this.meta.buffs.leech);
    if (this.correct > 0 && this.correct % n === 0) {
      const got = this.heal(1);
      if (got > 0) events.push({ type: 'leech', amount: got });
    }

    return events;
  }

  // Boss 波逐问：答对 -1（boss-x2 则 -2），答错吃 Boss 失误伤害（P2 免伤免疫可挡）
  private tickBoss(correct: boolean): SurvivalEvent[] {
    const events: SurvivalEvent[] = [];
    const maxBossHp = this.meta.bossWave
      ? (this.meta.bossHp ?? bossHits(this.meta.day, this.meta.atkLv))
      : 0;

    if (correct) {
      this.correct++;
      const dmg = this.meta.legend.bossX2 ? 2 : 1;
      this.bossHp -= dmg;
      if (this.bossHp <= maxBossHp / 2 && !this.bossP2) {
        this.bossP2 = true;
      }
      const cleared = this.bossHp <= 0;
      if (cleared && !this.bossCleared) {
        this.bossCleared = true;
        this.heal(SURVIVAL.BOSS_HEAL);
      }
      events.push({
        type: 'boss-hit',
        dmg,
        bossHp: Math.max(0, this.bossHp),
        p2: this.bossP2,
        cleared,
      });
      return events;
    }

    this.wrong++;
    const raw = Math.min(
      SURVIVAL.BOSS_DMG_BASE + SURVIVAL.BOSS_DMG_GROW * (this.meta.day - 1),
      SURVIVAL.BOSS_DMG_CAP,
    );
    const immune = this.bossP2 && this.meta.legend.bossImmunity;
    const blocked = immune ? true : this.hurt(raw) === 0;
    events.push({
      type: 'boss-miss',
      dmg: blocked ? 0 : raw,
      immune,
      bossHp: Math.max(0, this.bossHp),
    });
    if (this.hp <= 0) events.push({ type: 'death' });
    return events;
  }

  get stats(): { correct: number; wrong: number; leaked: number; stuns: number } {
    return { correct: this.correct, wrong: this.wrong, leaked: this.leaked, stuns: this.stuns };
  }
}