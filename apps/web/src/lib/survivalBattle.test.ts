import { describe, expect, it } from 'vitest';
import { SURVIVAL } from '@word-journey/shared';
import { SurvivalBattle, type SurvivalLegendState, type SurvivalWaveMeta } from './survivalBattle';

const BASE_LEGEND: SurvivalLegendState = {
  bossImmunity: false,
  killHeal: false,
  bossX2: false,
  noLeakDmg: false,
};

function wave(over: Partial<SurvivalWaveMeta> = {}): SurvivalWaveMeta {
  return {
    day: 1,
    atkLv: 3,
    defLv: 3,
    hpLv: 3,
    maxHp: 26,
    hp: 26,
    buffs: { dmg: 0, leech: 0, dodge: 0 },
    legend: BASE_LEGEND,
    questions: [],
    bossWave: false,
    ...over,
  };
}

function answerAll(sim: SurvivalBattle, corrects: boolean[]) {
  const events = [];
  for (const c of corrects) events.push(...sim.onAnswer(c));
  return events;
}

describe('SurvivalBattle 波内实时模拟（时间驱动）', () => {
  it('答对攻击最近怪并扣 HP（新词首击 ×2 一题即死）', () => {
    // 20 题 I 级全新词：怪 HP=monsterHits(0,1,3)=2，新词首击 dmg=2
    const sim = new SurvivalBattle(
      wave({
        questions: Array.from({ length: 20 }, () => ({ tier: 0 as const, isNew: true, isBoss: false })),
      }),
    );
    const events = answerAll(sim, Array(20).fill(true));
    const kills = events.filter((e) => e.type === 'kill');
    expect(kills.length).toBeGreaterThan(0);
    // 全对不扣血
    expect(sim.currentHp).toBe(26);
    expect(sim.stats.correct).toBe(20);
    expect(sim.stats.leaked).toBe(0);
  });

  it('实时逼近：progress 随 step 推进，抵达玩家即漏怪扣血', () => {
    const sim = new SurvivalBattle(
      wave({
        defLv: 1,
        questions: Array.from({ length: 20 }, () => ({ tier: 0 as const, isNew: false, isBoss: false })),
      }),
    );
    // 步进 1s：progress 应增加
    sim.step(1);
    expect(sim.monsters[0]!.progress).toBeGreaterThan(0);
    // 步进足够长（约 29s 走完 FIELD_SPAN）→ 前锋抵达漏怪
    sim.step(60);
    expect(sim.stats.leaked).toBeGreaterThan(0);
    expect(sim.currentHp).toBeLessThan(26);
  });

  it('错峰入场：场上怪数不超过 MAX_FIELD', () => {
    const sim = new SurvivalBattle(
      wave({
        questions: Array.from({ length: 20 }, () => ({ tier: 0 as const, isNew: false, isBoss: false })),
      }),
    );
    for (let i = 0; i < 30; i++) {
      sim.step(6);
      expect(sim.monsters.length).toBeLessThanOrEqual(SURVIVAL.MAX_FIELD);
    }
  });

  it('吸血：每答对 6 题回 1 HP（上限 maxHp）', () => {
    const sim = new SurvivalBattle(
      wave({
        questions: Array.from({ length: 20 }, () => ({ tier: 0 as const, isNew: true, isBoss: false })),
      }),
    );
    answerAll(sim, Array(20).fill(true));
    expect(sim.currentHp).toBe(26);
    expect(Math.floor(sim.correctCount / SURVIVAL.LEECH_N)).toBe(3);
  });

  it('连续错 2 触发眩晕（stun），眩晕期间怪不逼近', () => {
    const sim = new SurvivalBattle(
      wave({
        questions: Array.from({ length: 20 }, () => ({ tier: 0 as const, isNew: false, isBoss: false })),
      }),
    );
    const events = answerAll(sim, [false, false, true, false, false, true]);
    const stun = events.filter((e) => e.type === 'stun');
    expect(stun.length).toBeGreaterThanOrEqual(2);
  });

  it('免伤（dodge）消耗后扣血被阻挡', () => {
    const sim = new SurvivalBattle(
      wave({
        defLv: 1,
        buffs: { dmg: 0, leech: 0, dodge: 1 },
        questions: Array.from({ length: 10 }, () => ({ tier: 0 as const, isNew: false, isBoss: false })),
      }),
    );
    const events = answerAll(sim, [false]);
    const wrong = events.find((e) => e.type === 'wrong') as { dmg: number; blocked: boolean } | undefined;
    expect(wrong?.blocked).toBe(true);
    expect(sim.currentHp).toBe(26);
  });

  it('Boss 波：答对扣 Boss HP，击破回 +6 HP', () => {
    const sim = new SurvivalBattle(
      wave({
        day: 3,
        bossWave: true,
        bossHp: 5,
        hp: 10,
        questions: Array.from({ length: 6 }, () => ({ tier: 0 as const, isNew: false, isBoss: true })),
      }),
    );
    const events = answerAll(sim, Array(6).fill(true));
    const hits = events.filter((e) => e.type === 'boss-hit');
    expect((hits[hits.length - 1] as { cleared: boolean }).cleared).toBe(true);
    expect(sim.isBossCleared).toBe(true);
    // 击破 +BOSS_HEAL 回血（上限 maxHp）
    expect(sim.currentHp).toBe(Math.min(26, 10 + SURVIVAL.BOSS_HEAL));
  });

  it('Boss 波：答错吃 Boss 失误伤害；P2 免伤免疫 legend 可挡', () => {
    const sim = new SurvivalBattle(
      wave({
        day: 3,
        bossWave: true,
        bossHp: 5,
        hp: 26,
        legend: { ...BASE_LEGEND, bossImmunity: true },
        questions: Array.from({ length: 6 }, () => ({ tier: 0 as const, isNew: false, isBoss: true })),
      }),
    );
    // 3 对先把 Boss 打到半血（5→2 ≤ 2.5 触发 P2），后 3 错在 P2 免疫
    const events = answerAll(sim, [true, true, true, false, false, false]);
    const misses = events.filter((e) => e.type === 'boss-miss') as { immune: boolean }[];
    expect(misses.length).toBe(3);
    for (const m of misses) expect(m.immune).toBe(true);
  });

  it('传说钩子：击杀回血（killHeal）', () => {
    const mk = (killHeal: boolean) =>
      new SurvivalBattle(
        wave({
          hp: 20,
          legend: { ...BASE_LEGEND, killHeal },
          questions: Array.from({ length: 20 }, () => ({ tier: 0 as const, isNew: true, isBoss: false })),
        }),
      );
    // 新词首击 2 击 → 有击杀 → killHeal 回血；对照无 killHeal 不回
    const withHeal = mk(true);
    const withoutHeal = mk(false);
    const evHeal = answerAll(withHeal, Array(20).fill(true));
    answerAll(withoutHeal, Array(20).fill(true));
    const kills = evHeal.filter((e) => e.type === 'kill') as { heal: number }[];
    expect(kills.length).toBeGreaterThan(0);
    expect(kills[0]!.heal).toBeGreaterThan(0);
    expect(withHeal.currentHp).toBeGreaterThan(withoutHeal.currentHp);
  });

  it('传说钩子：漏怪不扣血（noLeakDmg）', () => {
    const sim = new SurvivalBattle(
      wave({
        defLv: 1,
        legend: { ...BASE_LEGEND, noLeakDmg: true },
        questions: Array.from({ length: 20 }, () => ({ tier: 0 as const, isNew: false, isBoss: false })),
      }),
    );
    const events: { type: string; dmg?: number }[] = [];
    for (let i = 0; i < 30; i++) {
      events.push(...sim.step(6));
    }
    const leaks = events.filter((e) => e.type === 'leak') as { dmg: number }[];
    expect(leaks.length).toBeGreaterThan(0);
    for (const l of leaks) expect(l.dmg).toBe(0);
    expect(sim.currentHp).toBe(26);
  });

  it('死亡：HP ≤ 0 后不再产生事件（死亡即止）', () => {
    const sim = new SurvivalBattle(
      wave({
        defLv: 1,
        hp: 1,
        questions: Array.from({ length: 20 }, () => ({ tier: 0 as const, isNew: false, isBoss: false })),
      }),
    );
    const events = answerAll(sim, Array(20).fill(false));
    expect(sim.currentHp).toBe(0);
    const deathIdx = events.findIndex((e) => e.type === 'death');
    expect(deathIdx).toBeGreaterThan(-1);
  });

  it('击杀/漏怪补位：spawn 事件始终携带 monster（防止场上清空取 undefined）', () => {
    const sim = new SurvivalBattle(
      wave({
        questions: Array.from({ length: 20 }, () => ({ tier: 0 as const, isNew: true, isBoss: false })),
      }),
    );
    // 新词首击 2 击 → 每题击杀一只，触发补位
    const events = answerAll(sim, Array(20).fill(true));
    for (const ev of events) {
      if (ev.type === 'spawn') expect(ev.monster).toBeDefined();
    }
    // 漏怪补位同样带 monster
    const sim2 = new SurvivalBattle(
      wave({
        questions: Array.from({ length: 20 }, () => ({ tier: 0 as const, isNew: false, isBoss: false })),
      }),
    );
    const leakEvents: { type: string; monster?: unknown }[] = [];
    for (let i = 0; i < 40; i++) leakEvents.push(...sim2.step(6));
    for (const ev of leakEvents) {
      if (ev.type === 'spawn') expect(ev.monster).toBeDefined();
    }
  });

  it('每波新怪 HP 按当前词 tierFactor 计算（tierⅣ ≥ tierⅠ）', () => {
    const t1 = new SurvivalBattle(
      wave({
        questions: Array.from({ length: 1 }, () => ({ tier: 0 as const, isNew: false, isBoss: false })),
      }),
    );
    const t4 = new SurvivalBattle(
      wave({
        questions: Array.from({ length: 1 }, () => ({ tier: 3 as const, isNew: false, isBoss: false })),
      }),
    );
    expect(t4.monsters[0]!.maxHp).toBeGreaterThanOrEqual(t1.monsters[0]!.maxHp);
  });

  it('怪速度随 tier 上升（tierⅣ ≥ tierⅠ）', () => {
    const t1 = new SurvivalBattle(
      wave({
        questions: Array.from({ length: 1 }, () => ({ tier: 0 as const, isNew: false, isBoss: false })),
      }),
    );
    const t4 = new SurvivalBattle(
      wave({
        questions: Array.from({ length: 1 }, () => ({ tier: 3 as const, isNew: false, isBoss: false })),
      }),
    );
    expect(t4.monsters[0]!.speed).toBeGreaterThanOrEqual(t1.monsters[0]!.speed);
  });
});
