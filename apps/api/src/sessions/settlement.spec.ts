import {
  appendStageHistory,
  applyWrongbookState,
  effectiveIntervalDays,
  initialEaseForTier,
  intervalDays,
  MASTER_STAGE,
  masteryFromStage,
  srsSchedule,
  WRONGBOOK_CLEAR_STREAK,
} from './settlement';

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
    expect(intervalDays(20)).toBe(180); // 封顶放宽到 180
  });
});

describe('掌握门槛 MASTER_STAGE=4 / masteryFromStage', () => {
  it('掌握门槛为 4（14 天间隔才算掌握，记忆学修正 7 天过脆）', () => {
    expect(MASTER_STAGE).toBe(4);
    expect(masteryFromStage(0)).toBe(0);
    expect(masteryFromStage(1)).toBe(25);
    expect(masteryFromStage(2)).toBe(50);
    expect(masteryFromStage(3)).toBe(75); // 原 100 → 现 75（不再过早判掌握）
    expect(masteryFromStage(4)).toBe(100);
    expect(masteryFromStage(5)).toBe(100); // 封顶
  });
});

describe('ease 参与间隔 effectiveIntervalDays', () => {
  it('基线 ease=2.5 时等价于基础间隔', () => {
    expect(effectiveIntervalDays(1, 2.5)).toBe(1);
    expect(effectiveIntervalDays(3, 2.5)).toBe(7);
    expect(effectiveIntervalDays(5, 2.5)).toBe(30);
  });

  it('吃力（ease 低）缩短间隔、稳定（ease 高）拉长间隔', () => {
    expect(effectiveIntervalDays(5, 2.1)).toBeLessThan(effectiveIntervalDays(5, 2.5));
    expect(effectiveIntervalDays(5, 2.5)).toBeLessThan(effectiveIntervalDays(5, 2.8));
    // 至少 1 天，且不超封顶
    expect(effectiveIntervalDays(1, 1.3)).toBeGreaterThanOrEqual(1);
    expect(effectiveIntervalDays(30, 2.8)).toBeLessThanOrEqual(180);
  });
});

describe('srsSchedule：回忆推进档位、再认(choice)不推进', () => {
  it('回忆答对 +1 档 +0.1 ease', () => {
    expect(srsSchedule(null, true)).toEqual({ reviewStage: 1, ease: 2.6 });
    expect(srsSchedule({ reviewStage: 2, ease: 2.5 }, true)).toEqual({ reviewStage: 3, ease: 2.6 });
  });

  it('再认(choice)答对：不升档，仅 +0.05 ease', () => {
    expect(srsSchedule(null, true, true)).toEqual({ reviewStage: 0, ease: 2.55 });
    expect(srsSchedule({ reviewStage: 2, ease: 2.5 }, true, true)).toEqual({ reviewStage: 2, ease: 2.55 });
  });

  it('答错（无论题型）阶梯降 2 档，ease -0.5', () => {
    expect(srsSchedule({ reviewStage: 4, ease: 2.5 }, false)).toEqual({ reviewStage: 2, ease: 2.0 });
    expect(srsSchedule({ reviewStage: 4, ease: 2.5 }, false, true)).toEqual({ reviewStage: 2, ease: 2.0 });
  });
});

describe('新词初始 ease 按难度 tier 联动', () => {
  it('难词 ease 更低、易词 ease 更高', () => {
    expect(initialEaseForTier('I')).toBe(2.6);
    expect(initialEaseForTier('II')).toBe(2.5);
    expect(initialEaseForTier('III')).toBe(2.3);
    expect(initialEaseForTier('IV')).toBe(2.1);
    expect(initialEaseForTier(null)).toBe(2.5);
  });
});
