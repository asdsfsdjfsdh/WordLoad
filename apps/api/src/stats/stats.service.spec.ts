import { aggregateRuns, StatsService } from './stats.service';

const prisma = {
  learningSession: { findMany: jest.fn() },
  learningSessionItem: { count: jest.fn(), aggregate: jest.fn(), groupBy: jest.fn() },
  word: { findMany: jest.fn(), groupBy: jest.fn() },
  userWordProgress: { findMany: jest.fn() },
  run: { findMany: jest.fn(), count: jest.fn() },
};
const service = new StatsService(prisma as never);

beforeEach(() => jest.clearAllMocks());

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

describe('StatsService.trend', () => {
  it('mastered 按 masteredAt 分日累计（含窗口外首遇但窗口内掌握的词）', async () => {
    const now = new Date();
    prisma.learningSession.findMany.mockResolvedValue([
      { id: 1, createdAt: now, xpEarned: 10, coinsEarned: 5 },
    ]);
    prisma.learningSessionItem.groupBy
      .mockResolvedValueOnce([]) // 答题数
      .mockResolvedValueOnce([]); // 对错
    prisma.userWordProgress.findMany.mockResolvedValue([
      // 今日首遇 + 今日掌握
      { firstEncounteredAt: now, masteredAt: now },
      // 窗口外首遇（10 天前）但今日掌握 → 只计 mastered
      { firstEncounteredAt: new Date(now.getTime() - 10 * 86400000), masteredAt: now },
    ]);

    const points = await service.trend(1, 7);
    const today = points[points.length - 1]!;
    expect(today.newWords).toBe(1);
    expect(today.mastered).toBe(2);
    expect(today.sessions).toBe(1);
    // 无活动日 mastered 默认 0
    expect(points.every((p) => p.mastered >= 0)).toBe(true);
  });
});
