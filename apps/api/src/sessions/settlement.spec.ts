import { appendStageHistory, applyWrongbookState, intervalDays, WRONGBOOK_CLEAR_STREAK } from './settlement';

describe('错题本状态转移 applyWrongbookState', () => {
  it('不在本答错 → 进错题本，streak 归零', () => {
    expect(applyWrongbookState(null, [{ correct: false }])).toEqual({ inWrongBook: true, wrongStreak: 0 });
  });

  it('不在本答对 → 保持不在本', () => {
    expect(applyWrongbookState(null, [{ correct: true }])).toEqual({ inWrongBook: false, wrongStreak: 0 });
  });

  it('在本答对 1 次 → 仍在本，streak=1', () => {
    expect(applyWrongbookState(
      { inWrongBook: true, wrongStreak: 0 },
      [{ correct: true }],
    )).toEqual({ inWrongBook: true, wrongStreak: 1 });
  });

  it(`连续答对 ${WRONGBOOK_CLEAR_STREAK} 次 → 摘标`, () => {
    const state = applyWrongbookState(
      { inWrongBook: true, wrongStreak: 0 },
      [{ correct: true }, { correct: true }],
    );
    expect(state).toEqual({ inWrongBook: false, wrongStreak: 0 });
  });

  it('在本答错 → streak 归零，需重新累计', () => {
    const state = applyWrongbookState(
      { inWrongBook: true, wrongStreak: 1 },
      [{ correct: true }, { correct: false }],
    );
    expect(state).toEqual({ inWrongBook: true, wrongStreak: 0 });
  });

  it('连续答对后仍有答对 → 摘标后保持不在本', () => {
    const state = applyWrongbookState(
      { inWrongBook: true, wrongStreak: 1 },
      [{ correct: true }, { correct: true }, { correct: true }],
    );
    expect(state).toEqual({ inWrongBook: false, wrongStreak: 0 });
  });
});

describe('SRS 档位变更史 appendStageHistory', () => {
  const at = new Date('2026-08-16T00:00:00.000Z');

  it('空历史 + 档位未变 → 返回空', () => {
    expect(appendStageHistory(null, 0, 0, at)).toEqual([]);
    expect(appendStageHistory([], 2, 2, at)).toEqual([]);
  });

  it('空历史 + 档位变化 → 追加一条', () => {
    expect(appendStageHistory(null, 0, 1, at)).toEqual([{ stage: 1, at: at.toISOString() }]);
  });

  it('已有历史 + 档位变化 → 追加在尾部', () => {
    const prev = [{ stage: 1, at: '2026-08-15T00:00:00.000Z' }];
    const next = appendStageHistory(prev, 1, 2, at);
    expect(next).toEqual([
      { stage: 1, at: '2026-08-15T00:00:00.000Z' },
      { stage: 2, at: at.toISOString() },
    ]);
  });

  it('降档（答错回退）也记录', () => {
    const prev = [{ stage: 3, at: '2026-08-15T00:00:00.000Z' }];
    expect(appendStageHistory(prev, 3, 1, at)).toEqual([
      { stage: 3, at: '2026-08-15T00:00:00.000Z' },
      { stage: 1, at: at.toISOString() },
    ]);
  });

  it('容忍脏输入：过滤非法条目', () => {
    const prev = [null, { stage: 'bad' }, { stage: 2, at: 'x' }];
    expect(appendStageHistory(prev, 2, 3, at)).toEqual([
      { stage: 2, at: 'x' },
      { stage: 3, at: at.toISOString() },
    ]);
  });
});

describe('intervalDays（shared 迁移后同源）', () => {
  it('档位 → 间隔天数指数增长', () => {
    expect(intervalDays(0)).toBe(0);
    expect(intervalDays(1)).toBe(1);
    expect(intervalDays(2)).toBe(3);
    expect(intervalDays(3)).toBe(7);
    expect(intervalDays(4)).toBe(14);
    expect(intervalDays(5)).toBe(30);
    expect(intervalDays(6)).toBe(40);
    expect(intervalDays(10)).toBe(80);
    expect(intervalDays(20)).toBe(90); // 封顶 90
  });
});
