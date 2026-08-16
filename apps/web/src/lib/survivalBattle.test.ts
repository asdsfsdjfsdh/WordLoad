import { describe, expect, it } from 'vitest';
import { SURVIVAL } from '@word-journey/shared';
import { SurvivalBattle, type SurvivalBuffState, type SurvivalLegendState, type SurvivalWaveMeta } from './survivalBattle';

const BASE_BUFFS: SurvivalBuffState = { dmg: 0, leech: 0, dodge: 0, freeze: 0 };
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
    buffs: BASE_BUFFS,
    legend: BASE_LEGEND,
    questions: [],
    bossWave: false,
    ...over,
  };
}

describe('SurvivalBattle（shared 引擎薄封装）', () => {
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

  it('答错伤害随 day 增长且受防御', () => {
    const lowDef = new SurvivalBattle(wave({ defLv: 1 }));
    const highDef = new SurvivalBattle(wave({ defLv: 3 }));
    expect(lowDef.wrongDmg()).toBeGreaterThanOrEqual(1);
    expect(highDef.wrongDmg()).toBeLessThanOrEqual(lowDef.wrongDmg());
  });

  it('漏怪伤害：noLeakDmg legend 时 0', () => {
    const safe = new SurvivalBattle(wave({ legend: { ...BASE_LEGEND, noLeakDmg: true } }));
    expect(safe.leakDmg()).toBe(0);
  });

  it('Boss 失误伤害：P2 + 免伤免疫 legend 时 0（引擎步进触发 P2）', () => {
    const s = new SurvivalBattle(
      wave({
        bossWave: true,
        bossHp: 5,
        legend: { ...BASE_LEGEND, bossImmunity: true },
        questions: Array.from({ length: 5 }, () => ({ tier: 0 as const, isNew: false, isBoss: true })),
      }),
    );
    expect(s.bossMissDmg()).toBeGreaterThanOrEqual(1);
    s.step(true);
    s.step(true);
    s.step(true); // 5-3=2 ≤ 2.5 → P2
    expect(s.bossP2Active).toBe(true);
    expect(s.bossMissDmg()).toBe(0);
  });

  it('Boss HP / 剩余：初始化= bossHp，对伤递减', () => {
    const s = new SurvivalBattle(wave({ bossWave: true, bossHp: 5, questions: [{ tier: 0 as const, isNew: false, isBoss: true }] }));
    expect(s.bossMax).toBe(5);
    expect(s.bossRemaining).toBe(5);
    s.step(true);
    expect(s.bossRemaining).toBe(4);
  });

  it('吸血间隔：吸血 buff 使 N 降低', () => {
    const s0 = new SurvivalBattle(wave());
    const s2 = new SurvivalBattle(wave({ buffs: { ...BASE_BUFFS, leech: 2 } }));
    expect(s0.leechEvery()).toBe(SURVIVAL.LEECH_N);
    expect(s2.leechEvery()).toBeLessThan(s0.leechEvery());
  });

  it('免伤 dodge：第一步 wrong-hit dmg 0 且耗尽，第二步生效', () => {
    const s = new SurvivalBattle(
      wave({
        buffs: { ...BASE_BUFFS, dodge: 1 },
        questions: [
          { tier: 0 as const, isNew: false, isBoss: false },
          { tier: 0 as const, isNew: false, isBoss: false },
        ],
      }),
    );
    const ev1 = s.step(false);
    const w1 = ev1.find((e) => e.kind === 'wrong-hit');
    expect(w1?.kind === 'wrong-hit' ? (w1 as { dmg: number }).dmg : -1).toBe(0);
    expect(s.currentHp).toBe(26);
    const ev2 = s.step(false);
    const w2 = ev2.find((e) => e.kind === 'wrong-hit');
    expect(w2?.kind === 'wrong-hit' ? (w2 as { dmg: number }).dmg : 0).toBeGreaterThan(0);
    expect(s.currentHp).toBeLessThan(26);
  });

  it('Boss 击破：累计对伤 ≥ bossHp → boss-clear 事件，无 +6 回血', () => {
    const s = new SurvivalBattle(
      wave({
        bossWave: true,
        bossHp: 5,
        hp: 10,
        questions: Array.from({ length: 5 }, () => ({ tier: 0 as const, isNew: false, isBoss: true })),
      }),
    );
    let cleared = false;
    for (let i = 0; i < 5; i++) {
      if (s.step(true).some((e) => e.kind === 'boss-clear')) cleared = true;
    }
    expect(cleared).toBe(true);
    expect(s.isBossCleared).toBe(true);
    expect(s.currentHp).toBe(10); // 击破不再 +BOSS_HEAL（服务端定论）
  });

  it('spawnTier / currentQuestionIsNew 取「刚答完」的词（引擎按当前题 idx 判定新词×2 与补怪 tier）', () => {
    const s = new SurvivalBattle(
      wave({
        questions: [
          { tier: 0 as const, isNew: true, isBoss: false },
          { tier: 3 as const, isNew: false, isBoss: false },
        ],
      }),
    );
    expect(s.spawnTier()).toBe(0);
    expect(s.currentQuestionIsNew()).toBe(true);
    s.step(true); // 答完题 0（isNew）
    expect(s.spawnTier()).toBe(0);
    expect(s.currentQuestionIsNew()).toBe(true);
    s.step(true); // 答完题 1（tier 3，非新）
    expect(s.spawnTier()).toBe(3);
    expect(s.currentQuestionIsNew()).toBe(false);
  });

  it('initialCombo 透传：连击跨波累计、combo getter 同步引擎', () => {
    const s = new SurvivalBattle(
      wave({
        initialCombo: 4,
        questions: [
          { tier: 0 as const, isNew: false, isBoss: false },
          { tier: 0 as const, isNew: false, isBoss: false },
        ],
      }),
    );
    expect(s.combo).toBe(4);
    const ev = s.step(true);
    expect(s.combo).toBe(5);
    // ×5 里程碑在全局累计 5 时触发（溅射事件）
    expect(ev.some((e) => e.kind === 'combo' && e.tier === 5)).toBe(true);
    s.step(false);
    expect(s.combo).toBe(0);
  });

  it('Boss 波 initialCombo：答对累计、答错清零', () => {
    const s = new SurvivalBattle(
      wave({
        bossWave: true,
        bossHp: 3,
        initialCombo: 2,
        questions: Array.from({ length: 3 }, () => ({ tier: 0 as const, isNew: false, isBoss: true })),
      }),
    );
    s.step(true);
    expect(s.combo).toBe(3);
    s.step(false);
    expect(s.combo).toBe(0);
  });
});
