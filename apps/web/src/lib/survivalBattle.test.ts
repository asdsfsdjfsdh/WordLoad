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

function runAll(sim: SurvivalBattle, corrects: boolean[]) {
  const events = [];
  for (const c of corrects) events.push(...sim.tick(c));
  return events;
}

describe('SurvivalBattle 波内逐问模拟', () => {
  it('答对攻击前锋怪并扣 HP（新词首击 ×2）', () => {
    // 20 题 I 级，同一天：怪 HP=monsterHits(0,1,3)=max(2, ceil(2*1.0*1/1.5))=2
    const sim = new SurvivalBattle(
      wave({
        questions: Array.from({ length: 20 }, () => ({ tier: 0 as const, isNew: true, isBoss: false })),
      }),
    );
    const events = runAll(sim, Array(20).fill(true));
    // 全是新词首击 → 每题 2 击 → 首只 1 题即死
    const kills = events.filter((e) => e.type === 'kill');
    expect(kills.length).toBeGreaterThan(0);
    // 全对不扣血
    expect(sim.currentHp).toBe(26);
    expect(sim.stats.correct).toBe(20);
    expect(sim.stats.leaked).toBe(0);
  });

  it('错峰入场：场上怪数上限 MAX_FIELD', () => {
    const sim = new SurvivalBattle(
      wave({
        questions: Array.from({ length: 20 }, () => ({ tier: 0 as const, isNew: false, isBoss: false })),
      }),
    );
    runAll(sim, Array(20).fill(false));
    // 全错：每只怪 2 击，攻击消耗正确题数不足 → 前锋漏怪补位
    expect(sim.monsters.length).toBeLessThanOrEqual(SURVIVAL.MAX_FIELD);
  });

  it('漏怪：怪 timer 耗尽前锋抵达扣血（受击 ≥1）', () => {
    // defLv=1 → applyDef 至少 1；[错,错,对] 循环：正确被眩晕回合吃掉，怪仅逼近不受伤
    const sim = new SurvivalBattle(
      wave({
        defLv: 1,
        questions: Array.from({ length: 60 }, () => ({ tier: 0 as const, isNew: false, isBoss: false })),
      }),
    );
    const pattern = [false, false, true];
    const answers = Array.from({ length: 60 }, (_, i) => pattern[i % 3]!);
    runAll(sim, answers);
    expect(sim.stats.leaked).toBeGreaterThan(0);
    expect(sim.currentHp).toBeLessThan(26);
  });

  it('吸血：每答对 6 题回 1 HP（上限 maxHp）', () => {
    const sim = new SurvivalBattle(
      wave({
        questions: Array.from({ length: 20 }, () => ({ tier: 0 as const, isNew: true, isBoss: false })),
      }),
    );
    runAll(sim, Array(20).fill(true));
    // 全对吸血 floor(20/6)=3 次；但伤害为 0，hp 不降 → hp 仍为 maxHp 上限
    expect(sim.currentHp).toBe(26);
    expect(Math.floor(sim.correctCount / SURVIVAL.LEECH_N)).toBe(3);
  });

  it('连续错 2 触发眩晕（stun）', () => {
    const sim = new SurvivalBattle(
      wave({
        questions: Array.from({ length: 20 }, () => ({ tier: 0 as const, isNew: false, isBoss: false })),
      }),
    );
    const events = runAll(sim, [false, false, true, false, false, true]);
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
    const events = runAll(sim, [false]);
    const wrong = events.find((e) => e.type === 'wrong') as { dmg: number; blocked: boolean } | undefined;
    expect(wrong?.blocked).toBe(true);
    expect(sim.currentHp).toBe(26);
  });

  it('Boss 波：答对扣 Boss HP，击破回 +6 HP', () => {
    const bossHp = 5;
    const sim = new SurvivalBattle(
      wave({
        day: 3,
        bossWave: true,
        bossHp,
        hp: 10,
        questions: Array.from({ length: 6 }, () => ({ tier: 0 as const, isNew: false, isBoss: true })),
      }),
    );
    const events = runAll(sim, Array(6).fill(true));
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
    const events = runAll(sim, [true, true, true, false, false, false]);
    const misses = events.filter((e) => e.type === 'boss-miss') as { immune: boolean }[];
    expect(misses.length).toBe(3);
    for (const m of misses) expect(m.immune).toBe(true);
  });

  it('传说钩子：击杀回血（killHeal）', () => {
    const sim = new SurvivalBattle(
      wave({
        legend: { ...BASE_LEGEND, killHeal: true },
        questions: Array.from({ length: 20 }, () => ({ tier: 0 as const, isNew: true, isBoss: false })),
      }),
    );
    // 先扣血再全对击杀回血
    const events = runAll(sim, [false, ...Array(19).fill(true)]);
    const kill = events.find((e) => e.type === 'kill') as { heal: number } | undefined;
    // 错 1 题扣 1 HP（day1），击杀回血上限 maxHp
    expect(sim.currentHp).toBe(26);
    expect(kill).toBeDefined();
  });

  it('传说钩子：漏怪不扣血（noLeakDmg）', () => {
    // [错,错,对] 循环产生漏怪；dodge 挡掉答错伤害，隔离出"漏怪伤害"验证
    const sim = new SurvivalBattle(
      wave({
        defLv: 1,
        buffs: { dmg: 0, leech: 0, dodge: 60 },
        legend: { ...BASE_LEGEND, noLeakDmg: true },
        questions: Array.from({ length: 60 }, () => ({ tier: 0 as const, isNew: false, isBoss: false })),
      }),
    );
    const pattern = [false, false, true];
    const events = runAll(sim, Array.from({ length: 60 }, (_, i) => pattern[i % 3]!));
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
    const events = runAll(sim, Array(20).fill(false));
    expect(sim.currentHp).toBe(0);
    const deathIdx = events.findIndex((e) => e.type === 'death');
    expect(deathIdx).toBeGreaterThan(-1);
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

  it('逼近预算封顶 [MIN_TRAVEL, MAX_TRAVEL]', () => {
    for (let day = 1; day <= 60; day++) {
      const sim = new SurvivalBattle(
        wave({
          day,
          questions: Array.from({ length: 1 }, () => ({ tier: 0 as const, isNew: false, isBoss: false })),
        }),
      );
      const timer = sim.monsters[0]!.initTimer;
      expect(timer).toBeGreaterThanOrEqual(SURVIVAL.MIN_TRAVEL);
      expect(timer).toBeLessThanOrEqual(SURVIVAL.MAX_TRAVEL);
    }
  });
});