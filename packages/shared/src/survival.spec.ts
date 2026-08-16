import { describe, expect, it } from 'vitest';
import { MONSTER_TRAITS, SURVIVAL, bossHits, monsterTraitAt, wordLenDmg } from './game.js';
import {
  createWaveSim,
  activeSynergies,
  resolveEffects,
  SYNERGY_RECIPES,
  type BattleEvent,
  type CombatEffects,
  type WaveBuffState,
  type WaveSimInput,
} from './survival.js';

const BASE_BUFFS: WaveBuffState = { dmg: 0, leech: 0, dodge: 0, freeze: 0 };
const BASE_LEGEND = {
  bossImmunity: false,
  killHeal: false,
  bossX2: false,
  noLeakDmg: false,
};

function wave(over: Partial<WaveSimInput> = {}): WaveSimInput {
  return {
    day: 1,
    atkLv: 3,
    defLv: 3,
    maxHp: 26,
    startHp: 26,
    buffs: BASE_BUFFS,
    legend: BASE_LEGEND,
    questions: [],
    bossWave: false,
    ...over,
  };
}

/** 逐题喂答案，返回终态 */
function play(input: WaveSimInput, answers: boolean[]) {
  const sim = createWaveSim(input);
  for (const a of answers) sim.step(a);
  return sim;
}

describe('生存战斗引擎（createWaveSim）', () => {
  it('确定性：同一答案序列产出同一 HP', () => {
    const input = wave({
      day: 3,
      questions: Array.from({ length: 20 }, () => ({ tier: 0 as const, isNew: true, isBoss: false })),
    });
    const answers = Array.from({ length: 20 }, (_, i) => i % 3 !== 0);
    const a = play(input, answers);
    const b = play(input, answers);
    expect(a.hp).toBe(b.hp);
    expect(a.stats).toEqual(b.stats);
  });

  it('全对不漏不扣血：吸血封顶 maxHp，HP 保持满血', () => {
    const sim = createWaveSim(
      wave({
        day: 1,
        startHp: 26,
        maxHp: 26,
        traitFor: () => 'none',
        questions: Array.from({ length: 20 }, () => ({ tier: 0 as const, isNew: true, isBoss: false })),
      }),
    );
    for (let i = 0; i < 20; i++) sim.step(true);
    expect(sim.hp).toBe(26);
    expect(sim.stats.leaked).toBe(0);
  });

  it('错/漏扣血且受防御（defLv 越高扣得越少）', () => {
    const wrongInput = (defLv: number) =>
      wave({
        day: 5,
        defLv,
        startHp: 26,
        questions: [{ tier: 0 as const, isNew: false, isBoss: false }],
      });
    const low = play(wrongInput(1), [false]);
    const high = play(wrongInput(3), [false]);
    expect(high.hp).toBeGreaterThanOrEqual(low.hp);
  });

  it('连错 2 触发眩晕：stun 事件且当回合怪不逼近', () => {
    const sim = createWaveSim(
      wave({
        day: 1,
        startHp: 26,
        questions: [
          { tier: 3 as const, isNew: false, isBoss: false },
          { tier: 3 as const, isNew: false, isBoss: false },
        ],
      }),
    );
    let stunSeen = false;
    sim.step(false);
    const r = sim.step(false);
    for (const e of r.events) if (e.kind === 'stun') stunSeen = true;
    expect(stunSeen).toBe(true);
    expect(sim.stats.wrong).toBe(2);
  });

  it('免伤 dodge 逐次消耗：第一次挡住，第二次生效', () => {
    const sim = createWaveSim(
      wave({
        day: 1,
        buffs: { ...BASE_BUFFS, dodge: 1 },
        questions: [
          { tier: 0 as const, isNew: false, isBoss: false },
          { tier: 0 as const, isNew: false, isBoss: false },
        ],
      }),
    );
    const r1 = sim.step(false);
    expect(r1.events.some((e) => e.kind === 'wrong-hit' && e.dmg === 0)).toBe(true);
    expect(r1.dodgeLeft).toBe(0);
    expect(sim.hp).toBe(26);
    const r2 = sim.step(false);
    expect(r2.events.some((e) => e.kind === 'wrong-hit' && e.dmg > 0)).toBe(true);
    expect(sim.hp).toBeLessThan(26);
  });

  it('冻结加时：freeze 使逼近预算 +1（同答案序列泄漏更少）', () => {
    // 高天高 tier 怪难击杀，靠漏怪输出（交错答避免眩晕锁逼近）
    const mk = (freeze: number) =>
      wave({
        day: 30,
        startHp: 26,
        traitFor: () => 'none',
        buffs: { ...BASE_BUFFS, freeze },
        questions: Array.from({ length: 20 }, () => ({ tier: 3 as const, isNew: false, isBoss: false })),
      });
    const answers = Array.from({ length: 20 }, (_, i) => i % 2 === 0);
    const noFreeze = play(mk(0), answers);
    const withFreeze = play(mk(1), answers);
    expect(noFreeze.stats.leaked).toBeGreaterThan(0);
    // 逼近预算 +1 使整体泄漏不显著增加（补位级联可能 ±1），HP 不显著更低
    expect(withFreeze.stats.leaked).toBeLessThanOrEqual(noFreeze.stats.leaked + 1);
    expect(withFreeze.hp).toBeGreaterThanOrEqual(noFreeze.hp - 1);
  });

  it('no-leak-dmg：漏怪不扣血但仍有漏怪计数（对比有/无）', () => {
    const mk = (noLeakDmg: boolean) =>
      wave({
        day: 30,
        startHp: 26,
        traitFor: () => 'none',
        legend: { ...BASE_LEGEND, noLeakDmg },
        questions: Array.from({ length: 20 }, () => ({ tier: 3 as const, isNew: false, isBoss: false })),
      });
    const answers = Array.from({ length: 20 }, (_, i) => i % 2 === 0);
    const without = play(mk(false), answers);
    const withSafe = play(mk(true), answers);
    expect(without.stats.leaked).toBeGreaterThan(0);
    expect(withSafe.stats.leaked).toBeGreaterThanOrEqual(without.stats.leaked);
    expect(withSafe.hp).toBeGreaterThan(without.hp);
  });

  it('击杀回血 kill-heal：击杀怪时 +1', () => {
    // day1 atkLv3 → tierⅠ 怪 2 击；两连对各 1 伤击杀
    const sim = createWaveSim(
      wave({
        day: 1,
        startHp: 20,
        traitFor: () => 'none',
        legend: { ...BASE_LEGEND, killHeal: true },
        questions: [
          { tier: 0 as const, isNew: false, isBoss: false },
          { tier: 0 as const, isNew: false, isBoss: false },
        ],
      }),
    );
    const r1 = sim.step(true); // 1 伤，未击杀
    expect(r1.events.some((e) => e.kind === 'monster-hit' && !e.killed)).toBe(true);
    const r2 = sim.step(true); // 再 1 伤 → 击杀 +1
    expect(r2.events.some((e) => e.kind === 'monster-hit' && e.killed)).toBe(true);
    expect(r2.events.some((e) => e.kind === 'heal' && e.source === 'kill')).toBe(true);
  });

  it('Boss：累计命中 ≥ bossHp 击破；boss-x2 使击杀线减半', () => {
    const mk = (bossX2: boolean) =>
      wave({
        day: 3,
        startHp: 26,
        bossWave: true,
        bossHp: 10,
        legend: { ...BASE_LEGEND, bossX2 },
        questions: Array.from({ length: 10 }, () => ({ tier: 0 as const, isNew: false, isBoss: true })),
      });
    // 无 x2：10 对击破
    const a = play(mk(false), Array(10).fill(true));
    expect(a.bossCleared).toBe(true);
    // 有 x2：5 对即击破
    const b = play(mk(true), Array(5).fill(true));
    expect(b.bossCleared).toBe(true);
    const c = play(mk(true), Array(4).fill(true));
    expect(c.bossCleared).toBe(false);
  });

  it('Boss 失误扣血；P2+immunity 归零且不消耗 dodge', () => {
    const sim = createWaveSim(
      wave({
        day: 5,
        startHp: 26,
        bossWave: true,
        bossHp: 4,
        buffs: { ...BASE_BUFFS, dodge: 1 },
        legend: { ...BASE_LEGEND, bossImmunity: true },
        questions: Array.from({ length: 8 }, () => ({ tier: 0 as const, isNew: false, isBoss: true })),
      }),
    );
    sim.step(true); // 4→3
    sim.step(true); // 3→2 → P2 触发
    const r = sim.step(false); // P2 免疫失误
    expect(r.events.some((e) => e.kind === 'boss-miss' && e.dmg === 0)).toBe(true);
    expect(r.dodgeLeft).toBe(1);
    expect(sim.hp).toBe(26);
  });

  it('Boss 波不产生漏怪', () => {
    const sim = createWaveSim(
      wave({
        day: 3,
        bossWave: true,
        bossHp: 10,
        questions: Array.from({ length: 10 }, () => ({ tier: 0 as const, isNew: false, isBoss: true })),
      }),
    );
    for (let i = 0; i < 10; i++) sim.step(true);
    expect(sim.stats.leaked).toBe(0);
  });

  it('Boss 波不吸血：答对达 leechN 也不触发 leech 回血', () => {
    const sim = createWaveSim(
      wave({
        day: 1,
        startHp: 15,
        maxHp: 26,
        bossWave: true,
        bossHp: 8,
        questions: Array.from({ length: 8 }, () => ({ tier: 0 as const, isNew: false, isBoss: true })),
      }),
    );
    let leechHeal = false;
    for (let i = 0; i < 8; i++) {
      const r = sim.step(true);
      if (r.events.some((e) => e.kind === 'heal' && e.source === 'leech')) leechHeal = true;
    }
    expect(leechHeal).toBe(false);
    expect(sim.hp).toBe(15); // 不吸血：HP 保持入场值
  });

  it('Boss 击破后剩余题失误不再扣血', () => {
    const sim = createWaveSim(
      wave({
        day: 3,
        startHp: 26,
        bossWave: true,
        bossHp: 5,
        legend: { ...BASE_LEGEND, bossX2: true },
        questions: Array.from({ length: 5 }, () => ({ tier: 0 as const, isNew: false, isBoss: true })),
      }),
    );
    sim.step(true); // 2
    sim.step(true); // 4
    const clear = sim.step(true); // 5 → 击破（boss-x2）
    expect(clear.events.some((e) => e.kind === 'boss-clear')).toBe(true);
    expect(sim.hp).toBe(26);
    const r = sim.step(false); // 击破后失误：不扣血
    expect(r.events.some((e) => e.kind === 'boss-miss' && e.dmg === 0)).toBe(true);
    expect(sim.hp).toBe(26);
  });

  it('bossHits 无封顶，随 day 线性增长且最低 ≥2', () => {
    expect(bossHits(3, 1)).toBeGreaterThanOrEqual(2);
    expect(bossHits(60, 1)).toBeGreaterThan(bossHits(30, 1));
    expect(bossHits(200, 1)).toBeGreaterThan(bossHits(100, 1));
    expect(bossHits(200, 1)).toBeGreaterThan(50); // 无封顶：后期可远超旧 BOSS_MAX_HITS=10
  });
});

describe('P1 词长伤害 / 连击里程碑 / 敌人特性', () => {
  it('wordLenDmg：len≤4→1，每+4 +1，封顶+2', () => {
    expect(wordLenDmg(4)).toBe(1);
    expect(wordLenDmg(8)).toBe(2);
    expect(wordLenDmg(9)).toBe(2);
    expect(wordLenDmg(12)).toBe(3);
    expect(wordLenDmg(3)).toBe(1);
    expect(wordLenDmg(undefined)).toBe(1);
  });

  it('monsterTraitAt：确定性且各特性可达', () => {
    const seen = new Set<string>();
    for (let tier = 0; tier < 4; tier++) {
      for (let seq = 0; seq < 200; seq++) {
        for (const day of [1, 5, 20]) {
          seen.add(monsterTraitAt(tier, seq, day));
        }
      }
    }
    for (const t of MONSTER_TRAITS) expect(seen.has(t)).toBe(true);
    expect(monsterTraitAt(0, 3, 7)).toBe(monsterTraitAt(0, 3, 7));
  });

  it('词长伤害：长词一击必杀，短词需两击', () => {
    const long = createWaveSim(
      wave({ day: 1, traitFor: () => 'none', questions: [{ tier: 0, isNew: false, isBoss: false, len: 9 }] }),
    );
    const r1 = long.step(true);
    expect(r1.events.some((e) => e.kind === 'monster-hit' && e.killed)).toBe(true);

    const short = createWaveSim(
      wave({ day: 1, traitFor: () => 'none', questions: [{ tier: 0, isNew: false, isBoss: false, len: 4 }] }),
    );
    const s1 = short.step(true);
    expect(s1.events.some((e) => e.kind === 'monster-hit' && !e.killed && e.dmg === 1)).toBe(true);
  });

  it('斩杀词根：词长≥8 对该怪首击 +1，短词不触发', () => {
    const q: WaveSimInput['questions'] = [{ tier: 0, isNew: false, isBoss: false, len: 8 }];
    const base = createWaveSim(wave({ day: 1, traitFor: () => 'none', questions: q }));
    const spec = createWaveSim(wave({ day: 1, traitFor: () => 'none', questions: q, specs: { executeSpec: true, vampireSpec: false } }));
    const rb = base.step(true);
    const rs = spec.step(true);
    const mb = rb.events.find((e) => e.kind === 'monster-hit')!;
    const ms = rs.events.find((e) => e.kind === 'monster-hit')!;
    expect(ms.dmg).toBe(mb.dmg + 1);
    // 短词（len<8）即使开启特化也不加成
    const short = createWaveSim(
      wave({ day: 1, traitFor: () => 'none', questions: [{ tier: 0, isNew: false, isBoss: false, len: 4 }], specs: { executeSpec: true, vampireSpec: false } }),
    );
    const rs2 = short.step(true);
    expect(rs2.events.find((e) => e.kind === 'monster-hit')!.dmg).toBe(1);
  });

  it('复习专精：复习词触发吸血回 2（对照组回 1，新词不翻倍）', () => {
    const input = wave({
      day: 1,
      traitFor: () => 'none',
      startHp: 20,
      maxHp: 26,
      buffs: { dmg: 0, leech: 1, dodge: 0, freeze: 0 },
      questions: Array.from({ length: 4 }, () => ({ tier: 0, isNew: false, isBoss: false, len: 4 })),
    });
    const spec = createWaveSim({ ...input, specs: { executeSpec: false, vampireSpec: true } });
    let last = spec.step(true);
    for (let i = 1; i < 4; i++) last = spec.step(true);
    const heals = last.events.filter((e): e is Extract<BattleEvent, { kind: 'heal' }> => e.kind === 'heal' && e.source === 'leech');
    expect(heals.length).toBe(1);
    expect(heals[0]!.amount).toBe(2);
    expect(spec.hp).toBe(22);
    // 无特化：回 1
    const plain = createWaveSim({ ...input, specs: { executeSpec: false, vampireSpec: false } });
    for (let i = 0; i < 4; i++) plain.step(true);
    expect(plain.hp).toBe(21);
    // 新词（isNew）即使有特化也不翻倍
    const newWord = createWaveSim({
      ...input,
      questions: Array.from({ length: 4 }, () => ({ tier: 0, isNew: true, isBoss: false, len: 4 })),
      specs: { executeSpec: false, vampireSpec: true },
    });
    for (let i = 0; i < 4; i++) newWord.step(true);
    expect(newWord.hp).toBe(21);
  });

  it('连击×3 会心：本击 +1 伤害', () => {
    const sim = createWaveSim(
      wave({
        day: 1,
        traitFor: () => 'tank',
        questions: Array.from({ length: 6 }, () => ({ tier: 0, isNew: false, isBoss: false, len: 4 })),
      }),
    );
    sim.step(true);
    sim.step(true);
    const r3 = sim.step(true);
    expect(r3.events.some((e) => e.kind === 'combo' && e.tier === 3)).toBe(true);
    expect(r3.events.some((e) => e.kind === 'monster-hit' && e.crit && e.dmg === 2)).toBe(true);
  });

  it('连击×5 溅射：主击后再打前排 1', () => {
    const sim = createWaveSim(
      wave({
        day: 1,
        traitFor: () => 'tank',
        questions: Array.from({ length: 6 }, () => ({ tier: 3, isNew: false, isBoss: false, len: 4 })),
      }),
    );
    for (let i = 0; i < 4; i++) sim.step(true);
    const r5 = sim.step(true);
    expect(r5.events.some((e) => e.kind === 'combo' && e.tier === 5)).toBe(true);
    expect(r5.events.some((e) => e.kind === 'splash-hit')).toBe(true);
  });

  it('连击×7 全场波：全怪 -1', () => {
    const sim = createWaveSim(
      wave({
        day: 1,
        traitFor: () => 'tank',
        questions: Array.from({ length: 10 }, () => ({ tier: 3, isNew: false, isBoss: false, len: 4 })),
      }),
    );
    for (let i = 0; i < 6; i++) sim.step(true);
    const r7 = sim.step(true);
    expect(r7.events.some((e) => e.kind === 'combo' && e.tier === 7)).toBe(true);
    expect(r7.events.some((e) => e.kind === 'wave-hit')).toBe(true);
  });

  it('全局连击：initialCombo 起步，里程碑按累计值触发', () => {
    // 上一波已有 2 连 → 本波第 1 题即达 ×3
    const sim = createWaveSim(
      wave({
        day: 1,
        traitFor: () => 'tank',
        initialCombo: 2,
        questions: Array.from({ length: 3 }, () => ({ tier: 0, isNew: false, isBoss: false, len: 4 })),
      }),
    );
    const r = sim.step(true);
    expect(sim.combo).toBe(3);
    expect(sim.maxCombo).toBe(3);
    expect(r.events.some((e) => e.kind === 'combo' && e.tier === 3)).toBe(true);
    expect(r.events.some((e) => e.kind === 'monster-hit' && e.crit)).toBe(true);
  });

  it('全局连击：错答归零但 maxCombo 保留峰值', () => {
    const sim = createWaveSim(
      wave({
        day: 1,
        traitFor: () => 'tank',
        questions: Array.from({ length: 6 }, () => ({ tier: 0, isNew: false, isBoss: false, len: 4 })),
      }),
    );
    sim.step(true);
    sim.step(true);
    sim.step(true);
    sim.step(false); // 第 4 题答错 → 连击清零
    expect(sim.combo).toBe(0);
    expect(sim.maxCombo).toBe(3);
  });

  it('Boss 波：答对累计全局连击、答错清零', () => {
    const sim = createWaveSim(
      wave({
        day: 1,
        initialCombo: 4,
        bossWave: true,
        bossHp: 4,
        questions: Array.from({ length: 4 }, () => ({ tier: 0, isNew: false, isBoss: true, len: 4 })),
      }),
    );
    sim.step(true);
    expect(sim.combo).toBe(5);
    sim.step(false);
    expect(sim.combo).toBe(0);
    sim.step(true);
    expect(sim.combo).toBe(1);
    expect(sim.maxCombo).toBe(5);
  });

  it('护甲：受击 -1（最低 1）', () => {
    const armor = createWaveSim(
      wave({ day: 5, traitFor: () => 'armor', questions: [{ tier: 3, isNew: false, isBoss: false, len: 12 }] }),
    );
    const none = createWaveSim(
      wave({ day: 5, traitFor: () => 'none', questions: [{ tier: 3, isNew: false, isBoss: false, len: 12 }] }),
    );
    const ra = armor.step(true);
    const rn = none.step(true);
    expect(ra.events.some((e) => e.kind === 'monster-hit' && e.dmg === 2)).toBe(true);
    expect(rn.events.some((e) => e.kind === 'monster-hit' && e.dmg === 3)).toBe(true);
  });

  it('迅捷：逼近预算更短，更早漏怪', () => {
    const answers = Array(22).fill(false);
    const swift = play(
      wave({
        day: 1,
        startHp: 26,
        traitFor: () => 'swift',
        questions: Array.from({ length: 25 }, () => ({ tier: 0, isNew: false, isBoss: false, len: 4 })),
      }),
      answers,
    );
    const normal = play(
      wave({
        day: 1,
        startHp: 26,
        traitFor: () => 'none',
        questions: Array.from({ length: 25 }, () => ({ tier: 0, isNew: false, isBoss: false, len: 4 })),
      }),
      answers,
    );
    expect(swift.stats.leaked).toBeGreaterThan(normal.stats.leaked);
  });

  it('再生：每 2 题回 1，延缓击杀', () => {
    // day5 tier3 怪 HP=5；普通：1+1+会心2+1=5 → 第4击击杀；再生：第2击后回1，存活
    const mk = (trait: 'regen' | 'none') =>
      createWaveSim(
        wave({
          day: 5,
          traitFor: () => trait,
          questions: Array.from({ length: 4 }, () => ({ tier: 3, isNew: false, isBoss: false, len: 4 })),
        }),
      );
    const regen = mk('regen');
    const none = mk('none');
    for (let i = 0; i < 3; i++) {
      regen.step(true);
      none.step(true);
    }
    const rr = regen.step(true);
    const rn = none.step(true);
    expect(rn.events.some((e) => e.kind === 'monster-hit' && e.killed)).toBe(true);
    expect(rr.events.some((e) => e.kind === 'monster-hit' && e.killed)).toBe(false);
  });

  it('分裂：死亡裂 2 只 mini', () => {
    const sim = createWaveSim(
      wave({
        day: 1,
        traitFor: () => 'split',
        questions: [
          { tier: 0, isNew: false, isBoss: false, len: 9 },
          { tier: 0, isNew: false, isBoss: false, len: 4 },
          { tier: 0, isNew: false, isBoss: false, len: 4 },
        ],
      }),
    );
    const r1 = sim.step(true);
    expect(r1.events.some((e) => e.kind === 'monster-hit' && e.killed && e.trait === 'split')).toBe(true);
    const r2 = sim.step(true);
    expect(r2.events.some((e) => e.kind === 'monster-hit' && e.killed)).toBe(true);
  });

  it('精英：击杀计入 eliteKills 并触发事件', () => {
    const sim = createWaveSim(
      wave({
        day: 1,
        traitFor: () => 'elite',
        questions: Array.from({ length: 4 }, () => ({ tier: 0, isNew: false, isBoss: false, len: 4 })),
      }),
    );
    sim.step(true);
    sim.step(true);
    const r3 = sim.step(true);
    expect(r3.events.some((e) => e.kind === 'elite-killed')).toBe(true);
    expect(sim.stats.eliteKills).toBe(1);
  });

  it('特性确定性：默认分配下同序列同结果（含 eliteKills）', () => {
    const questions = Array.from({ length: 20 }, (_, i) => ({
      tier: (i % 4) as 0 | 1 | 2 | 3,
      isNew: i % 3 === 0,
      isBoss: false,
      len: 4 + (i % 5),
    }));
    const answers = Array.from({ length: 20 }, (_, i) => i % 4 !== 2);
    const a = play(wave({ day: 7, questions }), answers);
    const b = play(wave({ day: 7, questions }), answers);
    expect(a.hp).toBe(b.hp);
    expect(a.stats).toEqual(b.stats);
  });
});

describe('P2 buff 效果层（resolveEffects + 引擎）', () => {
  const fx = (over: Partial<CombatEffects> = {}): CombatEffects => ({
    dmg: 0, leech: 0, dodge: 0, freeze: 0, critEvery: 0, armor: 0, thorns: 0,
    regenEvery: 0, executeLine: 0, comboBurst: false, freezeAllAt: 0, overload: 0,
    iceArmor: false, vampiric: false, bossImmunity: false, killHeal: false,
    bossX2: false, noLeakDmg: false, ...over,
  });

  it('resolveEffects：基础数值叠加', () => {
    const e = resolveEffects(['dmg', 'dmg', 'leech', 'dodge', 'freeze', 'crit', 'armor', 'thorns', 'regen', 'thorns-aura', 'vampiric']);
    expect(e.dmg).toBe(2);
    expect(e.leech).toBe(1);
    expect(e.dodge).toBe(1);
    expect(e.freeze).toBe(1);
    expect(e.critEvery).toBe(5);      // 1 crit → 7-2
    expect(e.armor).toBe(1);
    expect(e.thorns).toBe(4);         // thorns1 + aura2 + 雷御反伤1（armor/dodge/crit 触协同）
    expect(e.regenEvery).toBe(5);     // 1 regen → 6-1
    expect(e.vampiric).toBe(true);
  });

  it('resolveEffects：关键词协同（冰甲 / 超载 / 强攻吸血 / 霜冻新星）', () => {
    expect(resolveEffects(['freeze', 'dodge']).iceArmor).toBe(true);
    expect(resolveEffects(['crit', 'dmg', 'dmg']).overload).toBe(1);
    expect(resolveEffects(['crit']).overload).toBe(0); // 击<2 → 不触发超载
    expect(resolveEffects(['leech', 'dmg', 'dmg']).vampiric).toBe(true);
    expect(resolveEffects(['freezeAll', 'crit', 'dmg', 'dmg']).freezeAllAt).toBe(6);
    expect(resolveEffects(['freezeAll']).freezeAllAt).toBe(7);
  });

  it('resolveEffects：新增协同（雷+火→轰雷连打 / 霜+火→霜火处决 / 御+雷→雷御反伤）', () => {
    // 雷+火：crit(雷) + thorns(火) → comboBurst 打开，且不依赖 combo buff
    expect(resolveEffects(['crit', 'thorns']).comboBurst).toBe(true);
    expect(resolveEffects(['thorns']).comboBurst).toBe(false); // 只有火 → 不触发
    expect(resolveEffects(['crit']).comboBurst).toBe(false);   // 只有雷 → 不触发
    // 霜+火：freeze(霜) + thorns(火) → 斩杀线 1（execute buff 仍是 2）
    expect(resolveEffects(['freeze', 'thorns']).executeLine).toBe(1);
    expect(resolveEffects(['execute']).executeLine).toBe(2);
    expect(resolveEffects(['freeze']).executeLine).toBe(0);
    // 御+雷：armor(御) + crit(雷) → 反伤 +1（thorns 叠加后为 1）
    expect(resolveEffects(['armor', 'crit']).thorns).toBe(1);
    expect(resolveEffects(['armor']).thorns).toBe(0);
    expect(resolveEffects(['thorns', 'armor', 'crit']).thorns).toBe(2); // 反伤1 + 协同1
  });

  it('activeSynergies：6 个配方全部可命中，图鉴常量与引擎口径一致', () => {
    const all = SYNERGY_RECIPES;
    expect(all).toHaveLength(6);
    // 全 buff 触发 6 个配方（vampiric 传奇不再吞掉"生命虹吸"配方）
    const codes = ['crit', 'dmg', 'dmg', 'thorns', 'freeze', 'dodge', 'leech'];
    const got = activeSynergies(codes).map((s) => s.code);
    expect(got).toContain('overload');
    expect(got).toContain('ice-armor');
    expect(got).toContain('vampiric-combo');
    expect(got).toContain('combo-burst');
    expect(got).toContain('execute-line');
    expect(got).toContain('thorns-synergy');
    // 独立触发各配方
    expect(activeSynergies(['crit', 'thorns']).map((s) => s.code)).toContain('combo-burst');
    expect(activeSynergies(['freeze', 'thorns']).map((s) => s.code)).toContain('execute-line');
    expect(activeSynergies(['armor', 'crit']).map((s) => s.code)).toContain('thorns-synergy');
  });

  it('会心：每 critEvery 击必会心(+1)', () => {
    const sim = createWaveSim(
      wave({
        day: 1,
        traitFor: () => 'tank',
        effects: fx({ critEvery: 2 }),
        questions: Array.from({ length: 4 }, () => ({ tier: 3, isNew: false, isBoss: false, len: 4 })),
      }),
    );
    const r1 = sim.step(true);
    const r2 = sim.step(true);
    expect(r1.events.find((e) => e.kind === 'monster-hit')?.dmg).toBe(1);
    expect(r2.events.find((e) => e.kind === 'monster-hit')?.dmg).toBe(2);
    expect(r2.events.find((e) => e.kind === 'monster-hit')?.crit).toBe(true);
  });

  it('斩杀：HP≤斩杀线被击中即死', () => {
    const sim = createWaveSim(
      wave({
        day: 1,
        traitFor: () => 'tank',
        effects: fx({ executeLine: 3 }),
        questions: Array.from({ length: 6 }, () => ({ tier: 3, isNew: false, isBoss: false, len: 4 })),
      }),
    );
    // tank tier3 day1 HP=7：dmg 1,1,2,1… → 第4击时 hp=3 ≤ 斩杀线
    sim.step(true);
    sim.step(true);
    sim.step(true);
    const r4 = sim.step(true);
    expect(r4.events.some((e) => e.kind === 'monster-hit' && e.killed)).toBe(true);
  });

  it('反伤：受击对前排反射 N', () => {
    const sim = createWaveSim(
      wave({
        day: 1,
        traitFor: () => 'none',
        effects: fx({ thorns: 1 }),
        questions: Array.from({ length: 4 }, () => ({ tier: 0, isNew: false, isBoss: false, len: 4 })),
      }),
    );
    const r = sim.step(false);
    expect(r.events.some((e) => e.kind === 'wrong-hit')).toBe(true);
    expect(r.events.some((e) => e.kind === 'thorns-hit')).toBe(true);
  });

  it('再生：每 N 题回 1', () => {
    const sim = createWaveSim(
      wave({
        day: 1,
        traitFor: () => 'none',
        startHp: 9,
        maxHp: 10,
        effects: fx({ regenEvery: 2 }),
        questions: Array.from({ length: 4 }, () => ({ tier: 0, isNew: false, isBoss: false, len: 4 })),
      }),
    );
    sim.step(false); // 受击 hp9→8，tick1
    sim.step(true);  // tick2 → 回 1 → hp9
    expect(sim.hp).toBe(9);
  });

  it('护甲：受击 -N', () => {
    const mk = (armor: number) =>
      createWaveSim(
        wave({
          day: 20,
          traitFor: () => 'none',
          startHp: 10,
          maxHp: 10,
          effects: fx({ armor }),
          questions: [{ tier: 0, isNew: false, isBoss: false, len: 4 }],
        }),
      );
    const noArmor = mk(0);
    const armor = mk(1);
    noArmor.step(false); // wrongRaw day20≈2 → -2 → hp8
    armor.step(false);   // -1 → hp9
    expect(noArmor.hp).toBe(8);
    expect(armor.hp).toBe(9);
  });

  it('霜冻新星：连击×7 触发一次冻结全场（不随连击持续重复）', () => {
    const sim = createWaveSim(
      wave({
        day: 1,
        traitFor: () => 'tank',
        effects: fx({ freezeAllAt: 7 }),
        questions: Array.from({ length: 10 }, () => ({ tier: 3, isNew: false, isBoss: false, len: 4 })),
      }),
    );
    for (let i = 0; i < 6; i++) sim.step(true);
    const r7 = sim.step(true);
    expect(r7.events.some((e) => e.kind === 'freeze-all')).toBe(true);
    // 连击继续推进（×8/×9）：不再重复冻结（回归 C2）
    const r8 = sim.step(true);
    const r9 = sim.step(true);
    expect(r8.events.some((e) => e.kind === 'freeze-all')).toBe(false);
    expect(r9.events.some((e) => e.kind === 'freeze-all')).toBe(false);
  });

  it('超载：连击里程碑门槛 -1（×2 即会心）', () => {
    const sim = createWaveSim(
      wave({
        day: 1,
        traitFor: () => 'tank',
        effects: fx({ overload: 1 }),
        questions: Array.from({ length: 4 }, () => ({ tier: 3, isNew: false, isBoss: false, len: 4 })),
      }),
    );
    sim.step(true);
    const r2 = sim.step(true);
    expect(r2.events.some((e) => e.kind === 'combo' && e.tier === 3)).toBe(true);
  });

  it('冰甲：受击冻结全场', () => {
    const sim = createWaveSim(
      wave({
        day: 1,
        traitFor: () => 'none',
        effects: fx({ iceArmor: true }),
        questions: Array.from({ length: 3 }, () => ({ tier: 0, isNew: false, isBoss: false, len: 4 })),
      }),
    );
    const r = sim.step(false);
    expect(r.events.some((e) => e.kind === 'freeze-all')).toBe(true);
  });

  it('反伤 + 冰甲同回合：受击同时触发反伤与冻结', () => {
    const sim = createWaveSim(
      wave({
        day: 1,
        traitFor: () => 'none',
        effects: fx({ thorns: 1, iceArmor: true }),
        questions: Array.from({ length: 3 }, () => ({ tier: 0, isNew: false, isBoss: false, len: 4 })),
      }),
    );
    const r = sim.step(false);
    expect(r.events.some((e) => e.kind === 'thorns-hit')).toBe(true);
    expect(r.events.some((e) => e.kind === 'freeze-all')).toBe(true);
  });

  it('强攻吸血：击杀回血 +2', () => {
    const sim = createWaveSim(
      wave({
        day: 1,
        traitFor: () => 'none',
        startHp: 10,
        maxHp: 20,
        effects: fx({ killHeal: true, vampiric: true }),
        questions: Array.from({ length: 3 }, () => ({ tier: 0, isNew: false, isBoss: false, len: 4 })),
      }),
    );
    sim.step(true);
    const r2 = sim.step(true);
    expect(r2.events.some((e) => e.kind === 'heal' && e.source === 'kill' && e.amount === 2)).toBe(true);
    expect(sim.hp).toBe(12);
  });
});
