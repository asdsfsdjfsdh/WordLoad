// 生存模式波内实时模拟（时间驱动，与正常模式一致）：
// 怪持续逼近玩家，答对攻击最近怪，怪抵达玩家即漏怪；吸血/眩晕/Boss 全按计划数值。
// 前端本地权威，波末上报 finalHp；服务端只接收结果。
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

export interface SurvivalMonster {
  id: number;
  tier: TierIdx;
  hp: number; // 剩余击数
  maxHp: number;
  speed: number; // 实时逼近速度 px/sec
  progress: number; // 0..1 逼近进度（0=左缘，1=玩家侧）
}

export type SurvivalEvent =
  | { type: 'spawn'; monster: SurvivalMonster }
  | { type: 'attack'; targetId: number; dmg: number; crit: boolean }
  | { type: 'kill'; targetId: number; heal: number } // heal>0 = 击杀回血
  | { type: 'wrong'; dmg: number; blocked: boolean } // blocked = 免伤消耗
  | { type: 'leak'; targetId: number; dmg: number; blocked: boolean }
  | { type: 'stun' }
  | { type: 'leech'; amount: number } // "+♥ 回血"
  | { type: 'boss-hit'; dmg: number; bossHp: number; p2: boolean; cleared: boolean }
  | { type: 'boss-miss'; dmg: number; immune: boolean; bossHp: number }
  | { type: 'death' };

// 名义战场跨度（px）：progress 0→1 的行程，用于把 px/sec 速度折算为进度增量
const FIELD_SPAN = 760;
// 每天总怪数 ≈ ceil(20/3)≈7，场上 ≤MAX_FIELD 错峰入场
const TOTAL_MONSTERS = Math.max(
  1,
  Math.ceil(SURVIVAL.QUESTIONS_PER_DAY / SURVIVAL.MONSTERS_DIV),
);
const MAX_FIELD = SURVIVAL.MAX_FIELD;
// 错峰入场间隔（秒）：实时时间驱动补位（M7 可调）
const SPAWN_INTERVAL = 6;
// 实时逼近速度 px/sec 基准（正常模式怪速量级，M7 可调）
const VISUAL_SPEED_BASE = 26;
// 眩晕时长（秒）：连错 2 后怪暂停逼近
const STUN_SECONDS = 2.5;

let nextId = 1;

export class SurvivalBattle {
  private meta: SurvivalWaveMeta;
  private hp: number;
  private correct = 0;
  private wrong = 0;
  private leaked = 0;
  private consecWrong = 0;
  private stunUntil = 0;
  private simTime = 0;
  private field: SurvivalMonster[] = [];
  private spawned = 0;
  private spawnAcc = 0;
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
    if (!meta.bossWave) {
      this.spawn();
      this.spawned = 1;
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

  get stats(): { correct: number; wrong: number; leaked: number } {
    return { correct: this.correct, wrong: this.wrong, leaked: this.leaked };
  }

  // 新怪：HP 取当前词难度（θ §4.3），速度按 tier/day 实时逼近
  private spawn(): SurvivalMonster {
    const q =
      this.meta.questions[this.spawned % Math.max(1, this.meta.questions.length)] ?? {
        tier: 0 as TierIdx,
        isNew: false,
        isBoss: false,
      };
    const hits = monsterHits(q.tier, this.meta.day, this.meta.atkLv, this.meta.buffs.dmg);
    const m: SurvivalMonster = {
      id: nextId++,
      tier: q.tier,
      hp: hits,
      maxHp: hits,
      speed: monsterSpeed(this.meta.day, q.tier, VISUAL_SPEED_BASE),
      progress: 0,
    };
    this.field.push(m);
    return m;
  }

  // 最近怪（逼近进度最大 = 最靠近玩家）
  private front(): SurvivalMonster | undefined {
    let f: SurvivalMonster | undefined;
    for (const m of this.field) {
      if (!f || m.progress > f.progress) f = m;
    }
    return f;
  }

  private removeMonster(id: number): void {
    this.field = this.field.filter((m) => m.id !== id);
  }

  private heal(amount: number): number {
    const before = this.hp;
    this.hp = Math.min(this.meta.maxHp, this.hp + amount);
    return this.hp - before;
  }

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

  // 时间推进（rAF 每帧）：怪实时逼近 + 错峰入场 + 抵达漏怪
  step(dt: number): SurvivalEvent[] {
    const events: SurvivalEvent[] = [];
    this.simTime += dt;
    if (this.meta.bossWave) return events; // Boss 不逼近

    if (this.simTime < this.stunUntil) return events; // 眩晕暂停逼近

    // 错峰入场：定时补位（≤MAX_FIELD，总量≤TOTAL_MONSTERS）
    this.spawnAcc += dt;
    if (this.spawnAcc >= SPAWN_INTERVAL) {
      this.spawnAcc = 0;
      if (this.spawned < TOTAL_MONSTERS && this.field.length < MAX_FIELD) {
        this.spawned++;
        events.push({ type: 'spawn', monster: this.field[this.field.length - 1]! });
      }
    }

    // 逼近：每只怪向玩家移动
    for (const m of this.field) {
      m.progress = Math.min(1, m.progress + (m.speed / FIELD_SPAN) * dt);
    }

    // 抵达玩家（progress=1）即漏怪；一次帧内可能多只（按接近程度先后）
    while (this.field.length > 0) {
      const front = this.front();
      if (!front || front.progress < 1) break;
      this.leaked++;
      this.removeMonster(front.id);
      let taken = 0;
      if (!this.meta.legend.noLeakDmg) taken = this.hurt(this.leakRaw());
      events.push({ type: 'leak', targetId: front.id, dmg: taken, blocked: taken === 0 });
      if (this.spawned < TOTAL_MONSTERS && this.field.length < MAX_FIELD) {
        this.spawned++;
        events.push({ type: 'spawn', monster: this.field[this.field.length - 1]! });
      }
      if (this.hp <= 0) {
        events.push({ type: 'death' });
        break;
      }
    }

    return events;
  }

  // 答题：答对 → 攻击最近怪；答错 → 扣血；连错2 → 眩晕
  onAnswer(correct: boolean): SurvivalEvent[] {
    const events: SurvivalEvent[] = [];
    const idx = this.correct + this.wrong;
    const q =
      this.meta.questions[Math.min(idx, Math.max(0, this.meta.questions.length - 1))] ?? {
        tier: 0 as TierIdx,
        isNew: false,
        isBoss: false,
      };

    if (this.meta.bossWave) return this.answerBoss(correct);

    if (correct) {
      this.correct++;
      this.consecWrong = 0;
      const front = this.front();
      if (front) {
        const dmg = q.isNew ? SURVIVAL.NEW_WORD_DMG_X : 1;
        front.hp -= dmg;
        events.push({ type: 'attack', targetId: front.id, dmg, crit: q.isNew });
        if (front.hp <= 0) {
          this.removeMonster(front.id);
          let heal = 0;
          if (this.meta.legend.killHeal) heal = this.heal(1);
          events.push({ type: 'kill', targetId: front.id, heal });
          if (this.spawned < TOTAL_MONSTERS && this.field.length < MAX_FIELD) {
            this.spawned++;
            events.push({ type: 'spawn', monster: this.field[this.field.length - 1]! });
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
      if (this.consecWrong >= 2) {
        this.consecWrong = 0;
        this.stunUntil = this.simTime + STUN_SECONDS;
        events.push({ type: 'stun' });
      }
    }

    // 吸血：每答对 N 题 +1
    const n = leechN(this.meta.buffs.leech);
    if (this.correct > 0 && this.correct % n === 0) {
      const got = this.heal(1);
      if (got > 0) events.push({ type: 'leech', amount: got });
    }

    return events;
  }

  // Boss 波：答对 -1（boss-x2 则 -2），答错吃 Boss 失误伤害（P2 免伤免疫可挡）
  private answerBoss(correct: boolean): SurvivalEvent[] {
    const events: SurvivalEvent[] = [];
    if (correct) {
      this.correct++;
      const dmg = this.meta.legend.bossX2 ? 2 : 1;
      this.bossHp -= dmg;
      if (this.bossHp <= this.bossMax / 2 && !this.bossP2) this.bossP2 = true;
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
}
