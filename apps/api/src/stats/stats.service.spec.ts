import { aggregateRuns } from './stats.service';

describe('stats 生存 Run 聚合 aggregateRuns', () => {
  it('统计结束场数、最高天数与累计击破', () => {
    const runs = [
      { day: 5, bossClearedCount: 2 },
      { day: 11, bossClearedCount: 3 },
      { day: 3, bossClearedCount: 0 },
    ];
    expect(aggregateRuns(runs, 1)).toEqual({
      totalRuns: 3,
      bestRunDays: 11,
      totalBossCleared: 5,
      activeRunCount: 1,
    });
  });

  it('空数组返回全 0', () => {
    expect(aggregateRuns([], 0)).toEqual({
      totalRuns: 0,
      bestRunDays: 0,
      totalBossCleared: 0,
      activeRunCount: 0,
    });
  });
});
