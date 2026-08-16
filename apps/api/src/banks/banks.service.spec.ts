import { buildLeaderboard } from './banks.service';

// 构造单局纪录
function run(userId: number, day: number, bossClearedCount: number, at: number, cleared = false, masteredCount = 0) {
  return { userId, day, bossClearedCount, cleared, masteredCount, createdAt: new Date(at) };
}

function names(entries: Record<number, string>) {
  return new Map(Object.entries(entries).map(([k, v]) => [Number(k), v]));
}

describe('banks 阶段排行榜 buildLeaderboard', () => {
  it('每用户取最高天数上榜，降序定名次', () => {
    const runs = [
      run(1, 5, 0, 1),
      run(1, 3, 0, 2), // 同用户低局忽略
      run(2, 8, 1, 3),
      run(3, 6, 2, 4),
    ];
    const { entries, totalPlayers } = buildLeaderboard(runs, names({ 1: 'A', 2: 'B', 3: 'C' }), 999);
    expect(totalPlayers).toBe(3);
    expect(entries.map((e) => [e.username, e.days, e.rank])).toEqual([
      ['B', 8, 1],
      ['C', 6, 2],
      ['A', 5, 3],
    ]);
  });

  it('同天数：击破首领数更多者靠前；仍同则更早达成靠前', () => {
    const runs = [
      run(1, 7, 0, 5),
      run(2, 7, 2, 3),
      run(3, 7, 2, 1),
      run(4, 7, 1, 2),
    ];
    const { entries } = buildLeaderboard(runs, names({ 1: 'A', 2: 'B', 3: 'C', 4: 'D' }), 999);
    expect(entries.map((e) => e.username)).toEqual(['C', 'B', 'D', 'A']);
    expect(entries.map((e) => e.rank)).toEqual([1, 2, 3, 4]);
  });

  it('topN 裁剪：默认前 10，当前用户始终有 me 名次', () => {
    const runs = Array.from({ length: 15 }, (_, i) => run(i + 1, i + 1, 0, i + 1));
    const { entries, me, totalPlayers } = buildLeaderboard(runs, names({ 15: 'self' }), 15);
    expect(totalPlayers).toBe(15);
    expect(entries).toHaveLength(10);
    expect(entries[0]!.rank).toBe(1);
    expect(entries[0]!.days).toBe(15);
    expect(me).toEqual({ rank: 1, days: 15, bossClearedCount: 0, cleared: false }); // 15 天在 top10
  });

  it('当前用户不在 top10 时：me 返回真实名次', () => {
    const runs = Array.from({ length: 12 }, (_, i) => run(i + 1, i + 1, 0, i + 1));
    const { entries, me } = buildLeaderboard(runs, names({ 1: 'weak' }), 1); // 1 天最后
    expect(entries.some((e) => e.isMe)).toBe(false);
    expect(me).toEqual({ rank: 12, days: 1, bossClearedCount: 0, cleared: false });
  });

  it('无完赛记录：entries 空、me 为 null', () => {
    const { entries, me, totalPlayers } = buildLeaderboard([], names({}), 42);
    expect(entries).toHaveLength(0);
    expect(me).toBeNull();
    expect(totalPlayers).toBe(0);
  });

  it('未知用户名回退占位', () => {
    const { entries } = buildLeaderboard([run(7, 4, 0, 1)], new Map(), 1);
    expect(entries[0]!.username).toBe('玩家7');
  });

  it('unit 模式：通关者优先（通关天数升序），未通关按已掌握词数降序', () => {
    const runs = [
      run(1, 6, 1, 1, false, 12), // 未通关 12 词
      run(2, 4, 1, 2, true, 20),  // 通关 4 天
      run(3, 3, 1, 3, true, 20),  // 通关 3 天（最优）
      run(4, 10, 1, 4, false, 18), // 未通关 18 词
    ];
    const { entries } = buildLeaderboard(runs, names({ 1: 'A', 2: 'B', 3: 'C', 4: 'D' }), 999, 10, true);
    expect(entries.map((e) => [e.username, e.cleared, e.days, e.masteredCount])).toEqual([
      ['C', true, 3, 20],
      ['B', true, 4, 20],
      ['D', false, 10, 18],
      ['A', false, 6, 12],
    ]);
  });
});
