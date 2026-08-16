import {
  isFirstClear,
  isInRunWrong,
  isUnitDone,
  needsRetest,
  pickNewWords,
  requiredStreak,
  unitProgressOf,
  type UnitWordState,
} from './unit-clear';

const st = (p: Partial<UnitWordState> = {}): UnitWordState => ({
  wordId: 'w',
  preKnown: false,
  preMastery: 0,
  inWrongBook: false,
  rc: 0,
  wrongCount: 0,
  streak: 0,
  hasSlowWrong: false,
  served: false,
  skipped: false,
  ...p,
});

describe('requiredStreak / isInRunWrong（typo vs 不会）', () => {
  it('快错恢复门槛 2', () => {
    const s = st({ hasSlowWrong: false });
    expect(requiredStreak(s)).toBe(2);
  });

  it('慢错（真不会）恢复门槛 3', () => {
    const s = st({ hasSlowWrong: true });
    expect(requiredStreak(s)).toBe(3);
  });

  it('答错未恢复 → 本局错词', () => {
    expect(isInRunWrong(st({ wrongCount: 1, streak: 0 }))).toBe(true);
  });

  it('快错连续答对 2 次恢复', () => {
    expect(isInRunWrong(st({ wrongCount: 1, streak: 2, hasSlowWrong: false }))).toBe(false);
  });

  it('慢错需连续答对 3 次才恢复', () => {
    expect(isInRunWrong(st({ wrongCount: 1, streak: 2, hasSlowWrong: true }))).toBe(true);
    expect(isInRunWrong(st({ wrongCount: 1, streak: 3, hasSlowWrong: true }))).toBe(false);
  });
});

describe('needsRetest（本局错 OR 全局错题本）', () => {
  it('全局错题本 → 需重测', () => {
    expect(needsRetest(st({ inWrongBook: true }))).toBe(true);
  });

  it('本局错未恢复 → 需重测', () => {
    expect(needsRetest(st({ wrongCount: 1, streak: 0 }))).toBe(true);
  });

  it('无错 → 不需重测', () => {
    expect(needsRetest(st({}))).toBe(false);
  });
});

describe('isUnitDone（已会）', () => {
  it('预会（历史答对过）→ 直接算会', () => {
    expect(isUnitDone(st({ preKnown: true, served: false }))).toBe(true);
  });

  it('预会但在全局错题本 → 需重测', () => {
    expect(isUnitDone(st({ preKnown: true, inWrongBook: true }))).toBe(false);
  });

  it('本局出场且答对、无未恢复错词 → 会', () => {
    expect(isUnitDone(st({ rc: 1, served: true }))).toBe(true);
  });

  it('本局答错未恢复 → 不会', () => {
    expect(isUnitDone(st({ rc: 1, wrongCount: 1, streak: 0, served: true }))).toBe(false);
  });

  it('从未出场 → 不会（仍属新词）', () => {
    expect(isUnitDone(st({ served: false }))).toBe(false);
  });

  it('已斩 → 恒算会', () => {
    expect(isUnitDone(st({ skipped: true, served: false }))).toBe(true);
  });
});

describe('unitProgressOf（通关判定）', () => {
  it('全部非斩词已会 → doneAll=true', () => {
    const p = unitProgressOf([st({ preKnown: true }), st({ rc: 1, served: true })]);
    expect(p.total).toBe(2);
    expect(p.doneCount).toBe(2);
    expect(p.doneAll).toBe(true);
  });

  it('仍有错词未恢复 → doneAll=false', () => {
    const p = unitProgressOf([
      st({ rc: 1, served: true }),
      st({ rc: 1, wrongCount: 1, streak: 0, served: true }),
    ]);
    expect(p.doneCount).toBe(1);
    expect(p.doneAll).toBe(false);
  });

  it('已斩词排除在判定外', () => {
    const p = unitProgressOf([st({ skipped: true }), st({ rc: 1, served: true })]);
    expect(p.total).toBe(1);
    expect(p.doneAll).toBe(true);
  });
});

describe('pickNewWords（难度混合 + 弱项 tier 提前）', () => {
  it('弱项 tier 优先出词', () => {
    const cands = [
      { wordId: 'a', tier: 'I' as const },
      { wordId: 'b', tier: 'II' as const },
      { wordId: 'c', tier: 'IV' as const },
    ];
    const picked = pickNewWords(cands, 2, 'IV');
    expect(picked.map((c) => c.wordId)).toEqual(['c', 'a']); // IV 弱项优先，然后 I
  });

  it('无弱项时按 I→IV 轮转（难度混合）', () => {
    const cands = [
      { wordId: 'a', tier: 'I' as const },
      { wordId: 'b', tier: 'I' as const },
      { wordId: 'c', tier: 'III' as const },
      { wordId: 'd', tier: 'IV' as const },
    ];
    const picked = pickNewWords(cands, 4, null);
    expect(picked.map((c) => c.wordId)).toEqual(['a', 'c', 'd', 'b']); // 轮转：I,III,IV,I
  });

  it('候选不足时返回全部', () => {
    const picked = pickNewWords([{ wordId: 'a', tier: 'I' as const }], 5, null);
    expect(picked).toHaveLength(1);
  });
});

describe('isFirstClear', () => {
  it('此前无通关记录 → 首通', () => {
    expect(isFirstClear(false)).toBe(true);
  });

  it('此前已通关 → 非首通', () => {
    expect(isFirstClear(true)).toBe(false);
  });
});
