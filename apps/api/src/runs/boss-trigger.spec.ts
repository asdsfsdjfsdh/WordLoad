import { SURVIVAL } from '@word-journey/shared';
import { shouldTriggerBoss } from './boss-trigger';

describe('boss-trigger 双驱动', () => {
  it('day < firstBossDay 不触发', () => {
    expect(
      shouldTriggerBoss({ day: 2, lastBossDay: 0, everBoss: false, cumulativeConsumed: 999, lastBossConsumed: 0 }),
    ).toBe(false);
  });

  it('day3 首见即触发（新手缓冲）', () => {
    expect(
      shouldTriggerBoss({ day: 3, lastBossDay: 0, everBoss: false, cumulativeConsumed: 0, lastBossConsumed: 0 }),
    ).toBe(true);
  });

  it('距上次首领 < minGap 不触发', () => {
    expect(
      shouldTriggerBoss({ day: 4, lastBossDay: 3, everBoss: true, cumulativeConsumed: 999, lastBossConsumed: 0 }),
    ).toBe(false);
  });

  it('学习量驱动：累计新词间隔 ≥ BOSS_WORD_INTERVAL 触发', () => {
    expect(
      shouldTriggerBoss({
        day: 10,
        lastBossDay: 4,
        everBoss: true,
        cumulativeConsumed: 20,
        lastBossConsumed: 0,
      }),
    ).toBe(true);
  });

  it('学习量不足且距上次 < maxGap 不触发', () => {
    expect(
      shouldTriggerBoss({
        day: 7,
        lastBossDay: 4,
        everBoss: true,
        cumulativeConsumed: 15,
        lastBossConsumed: 0,
      }),
    ).toBe(false);
  });

  it('时间驱动：距上次首领 ≥ maxGap 强制触发（防拖）', () => {
    expect(
      shouldTriggerBoss({
        day: 9,
        lastBossDay: 4,
        everBoss: true,
        cumulativeConsumed: 0,
        lastBossConsumed: 0,
      }),
    ).toBe(true);
  });

  it('常量自洽：minGap ≤ maxGap 且 firstDay ≥ 1', () => {
    expect(SURVIVAL.BOSS_MIN_GAP_DAYS).toBeLessThanOrEqual(SURVIVAL.BOSS_MAX_GAP_DAYS);
    expect(SURVIVAL.BOSS_FIRST_DAY).toBeGreaterThanOrEqual(1);
  });
});