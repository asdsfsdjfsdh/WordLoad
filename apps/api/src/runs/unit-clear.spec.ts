import { isFirstClear, isUnitDone, isUnitWrong, unitProgressOf } from './unit-clear';

const st = (p: Partial<{ preMastery: number; rc: number; wrongCount: number; streak: number; served: boolean; skipped: boolean }> = {}) => ({
  wordId: 'w',
  preMastery: 0,
  rc: 0,
  wrongCount: 0,
  streak: 0,
  served: false,
  skipped: false,
  ...p,
});

describe('isUnitWrong（错词层：本局答错且未恢复）', () => {
  it('从未错 → 非错词', () => {
    expect(isUnitWrong(st({ wrongCount: 0 }))).toBe(false);
  });

  it('答错未恢复 → 错词', () => {
    expect(isUnitWrong(st({ wrongCount: 1, streak: 0 }))).toBe(true);
    expect(isUnitWrong(st({ wrongCount: 2, streak: 1 }))).toBe(true);
  });

  it('连续答对 RECOVER_STREAK 次恢复 → 非错词', () => {
    expect(isUnitWrong(st({ wrongCount: 1, streak: 2 }))).toBe(false); // UNIT_BOSS.RECOVER_STREAK=2
  });
});

describe('isUnitDone（已会）', () => {
  it('预会（全局已掌握）→ 直接算会', () => {
    expect(isUnitDone(st({ preMastery: 100, served: false }))).toBe(true);
  });

  it('本局出场且答对、无未恢复错词 → 会', () => {
    expect(isUnitDone(st({ rc: 1, served: true }))).toBe(true);
  });

  it('本局答错未恢复 → 不会（需重测）', () => {
    expect(isUnitDone(st({ rc: 1, wrongCount: 1, streak: 0, served: true }))).toBe(false);
  });

  it('从未出场 → 不会（仍属新词）', () => {
    expect(isUnitDone(st({ served: false }))).toBe(false);
  });

  it('已斩 → 恒算会（不参与判定）', () => {
    expect(isUnitDone(st({ skipped: true, served: false }))).toBe(true);
  });
});

describe('unitProgressOf（通关判定）', () => {
  it('空词集不视为全会（total=0 → doneAll=false）', () => {
    const p = unitProgressOf([]);
    expect(p.total).toBe(0);
    expect(p.doneCount).toBe(0);
    expect(p.doneAll).toBe(false);
  });

  it('全部非斩词已会 → doneAll=true', () => {
    const p = unitProgressOf([
      st({ preMastery: 100 }),
      st({ rc: 1, served: true }),
    ]);
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
    const p = unitProgressOf([
      st({ skipped: true, served: false }),
      st({ rc: 1, served: true }),
    ]);
    expect(p.total).toBe(1);
    expect(p.doneCount).toBe(1);
    expect(p.doneAll).toBe(true);
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
