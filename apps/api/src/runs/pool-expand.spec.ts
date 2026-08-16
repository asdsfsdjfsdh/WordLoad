import {
  cleanRateOf,
  computePoolStages,
  questionsPerDayFor,
  shouldExpand,
} from './pool-expand';

describe('computePoolStages', () => {
  // 红宝书全 stage：必考 101~126、基础 201~231、超纲 301~325（部分字母无词）
  const all = [
    ...Array.from({ length: 26 }, (_, i) => 101 + i),
    ...Array.from({ length: 31 }, (_, i) => 201 + i),
    ...Array.from({ length: 24 }, (_, i) => 301 + i),
  ];

  it('从起始 stage 扩展 N 个 Unit（按升序跨区域）', () => {
    expect(computePoolStages(all, 101, 1)).toEqual([101]);
    expect(computePoolStages(all, 101, 3)).toEqual([101, 102, 103]);
    expect(computePoolStages(all, 126, 2)).toEqual([126, 201]); // 必考末 → 跨入基础
    expect(computePoolStages(all, 231, 2)).toEqual([231, 301]); // 基础末 → 跨入超纲
  });

  it('startStage 不在列表中时回退为单 stage', () => {
    expect(computePoolStages(all, 999, 3)).toEqual([999]);
  });

  it('扩展到词书末尾截断', () => {
    const last = all[all.length - 1]!;
    expect(computePoolStages(all, last, 5)).toEqual([last]);
  });
});

describe('cleanRateOf', () => {
  it('空列表视为 1', () => {
    expect(cleanRateOf([])).toBe(1);
  });

  it('从未错的词计干净', () => {
    const m = [{ wrongCount: 0, streak: 0 }];
    expect(cleanRateOf(m)).toBe(1);
  });

  it('答错未恢复的词计错词队列', () => {
    const m = [{ wrongCount: 1, streak: 0 }, { wrongCount: 2, streak: 1 }];
    expect(cleanRateOf(m)).toBe(0);
  });

  it('连续答对 RECOVER_STREAK 次恢复干净', () => {
    const m = [{ wrongCount: 1, streak: 3 }, { wrongCount: 1, streak: 0 }];
    // 1 干净 + 1 错词 = 0.5
    expect(cleanRateOf(m, 3)).toBe(0.5);
  });

  it('自定义恢复阈值', () => {
    const m = [{ wrongCount: 1, streak: 2 }];
    expect(cleanRateOf(m, 2)).toBe(1);
    expect(cleanRateOf(m, 3)).toBe(0);
  });
});

describe('shouldExpand', () => {
  it('干净占比达阈值才扩展', () => {
    expect(shouldExpand(0.8, 0.8)).toBe(true);
    expect(shouldExpand(0.79, 0.8)).toBe(false);
    expect(shouldExpand(0.9, 0.8)).toBe(true);
  });
});

describe('questionsPerDayFor', () => {
  it('基准为 20，每并一 Unit +5，封顶 60', () => {
    expect(questionsPerDayFor(1)).toBe(20);
    expect(questionsPerDayFor(2)).toBe(25);
    expect(questionsPerDayFor(3)).toBe(30);
    expect(questionsPerDayFor(9)).toBe(60);
    expect(questionsPerDayFor(99)).toBe(60); // 封顶
  });

  it('支持自定义 base/step/cap', () => {
    expect(questionsPerDayFor(2, 10, 2, 50)).toBe(12);
    expect(questionsPerDayFor(30, 10, 2, 50)).toBe(50);
  });
});
