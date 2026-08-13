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

describe('SurvivalBattle 数值计算 + 血量账本', () => {
  it('怪 HP 按词 tier/天 增长（tierⅣ ≥ tierⅠ，天更久更高）', () => {
    const s1 = new SurvivalBattle(wave());
    const s2 = new SurvivalBattle(wave({ day: 5 }));
    expect(s2.monsterHpFor(3)).toBeGreaterThanOrEqual(s1.monsterHpFor(0));
    expect(s2.monsterHpFor(0)).toBeGreaterThanOrEqual(s1.monsterHpFor(0));
  });

  it('怪速度 tierⅣ ≥ tierⅠ（实时逼近 px/sec）', () => {
    const s = new SurvivalBattle(wave());
    expect(s.monsterSpeedFor(3)).toBeGreaterThanOrEqual(s.monsterSpeedFor(0));
  });

  it('答错伤害随 day 增长且受防御（受击 ≥1）', () => {
    const lowDef = new SurvivalBattle(wave({ defLv: 1 }));
    const highDef = new SurvivalBattle(wave({ defLv: 3 }));
    expect(lowDef.wrongDmg()).toBeGreaterThanOrEqual(1);
    expect(highDef.wrongDmg()).toBeLessThanOrEqual(lowDef.wrongDmg());
  });

  it('漏怪伤害：noLeakDmg legend 时 0，否则受防御', () => {
    const normal = new SurvivalBattle(wave());
    const safe = new SurvivalBattle(wave({ legend: { ...BASE_LEGEND, noLeakDmg: true } }));
    expect(normal.leakDmg()).toBeGreaterThanOrEqual(1);
    expect(safe.leakDmg()).toBe(0);
  });

  it('Boss 失误伤害：P2 + 免伤免疫 legend 时 0', () => {
    const s = new SurvivalBattle(wave({ bossWave: true, bossHp: 5, legend: { ...BASE_LEGEND, bossImmunity: true } }));
    expect(s.bossMissDmg()).toBeGreaterThanOrEqual(1);
    s.setBossP2(true);
    expect(s.bossMissDmg()).toBe(0);
  });

  it('Boss HP = bossHits', () => {
    const s = new SurvivalBattle(wave({ bossWave: true, bossHp: 7 }));
    expect(s.bossHpNow()).toBe(7);
  });

  it('吸血间隔：吸血 buff 使 N 降低', () => {
    const s0 = new SurvivalBattle(wave());
    const s2 = new SurvivalBattle(wave({ buffs: { dmg: 0, leech: 2, dodge: 0 } }));
    expect(s0.leechEvery()).toBe(SURVIVAL.LEECH_N);
    expect(s2.leechEvery()).toBeLessThan(s0.leechEvery());
  });

  it('受击：免伤（dodge）消耗后阻挡', () => {
    const s = new SurvivalBattle(wave({ buffs: { dmg: 0, leech: 0, dodge: 1 } }));
    expect(s.hurt(5)).toBe(0);
    expect(s.currentHp).toBe(26);
    expect(s.hurt(5)).toBeGreaterThan(0);
  });

  it('回血封顶 maxHp', () => {
    const s = new SurvivalBattle(wave({ hp: 24 }));
    expect(s.heal(5)).toBe(2);
    expect(s.currentHp).toBe(26);
  });

  it('连错 2 触发眩晕标记（onWrong 返回 true）', () => {
    const s = new SurvivalBattle(wave());
    expect(s.onWrong()).toBe(false);
    expect(s.onWrong()).toBe(true);
    // 答对重置
    s.onCorrect();
    expect(s.onWrong()).toBe(false);
  });

  it('击杀回血（killHeal legend）', () => {
    const withHeal = new SurvivalBattle(wave({ hp: 20, legend: { ...BASE_LEGEND, killHeal: true } }));
    const without = new SurvivalBattle(wave({ hp: 20 }));
    withHeal.onKill();
    without.onKill();
    expect(withHeal.currentHp).toBe(21);
    expect(without.currentHp).toBe(20);
  });

  it('Boss 命中：P2 于半血触发，击破回 +6 HP', () => {
    const s = new SurvivalBattle(wave({ bossWave: true, bossHp: 5, hp: 10 }));
    const r1 = s.onBossHit(1);
    expect(r1.p2).toBe(false);
    // 3 击后 5→2 ≤ 2.5 触发 P2
    s.onBossHit(1);
    const r3 = s.onBossHit(1);
    expect(r3.p2).toBe(true);
    // 5 击后击破 + BOSS_HEAL
    s.onBossHit(1);
    const r5 = s.onBossHit(1);
    expect(r5.cleared).toBe(true);
    expect(s.isBossCleared).toBe(true);
    expect(s.currentHp).toBe(Math.min(26, 10 + SURVIVAL.BOSS_HEAL));
  });

  it('spawnTier / currentQuestionIsNew 按答题进度取当前词', () => {
    const s = new SurvivalBattle(
      wave({ questions: [{ tier: 0 as const, isNew: true, isBoss: false }, { tier: 3 as const, isNew: false, isBoss: false }] }),
    );
    expect(s.spawnTier()).toBe(0);
    expect(s.currentQuestionIsNew()).toBe(true);
    s.onCorrect();
    expect(s.spawnTier()).toBe(3);
    expect(s.currentQuestionIsNew()).toBe(false);
  });
});
