import {
  computeCoins,
  computeRating,
  expForLevel,
  intervalDays,
  levelFromExp,
  ratingExp,
  rollDrops,
  srsSchedule,
  type AnswerInput,
} from './settlement';

describe('srsSchedule SM-2 简化', () => {
  it('正确提升等级与 ease', () => {
    expect(srsSchedule(null, true)).toEqual({ reviewStage: 1, ease: 2.6 });
    expect(srsSchedule({ reviewStage: 2, ease: 2.5 }, true).reviewStage).toBe(3);
  });
  it('错误阶梯降级（从 stage 4 降到 2）且 ease 下降', () => {
    const r = srsSchedule({ reviewStage: 4, ease: 2.5 }, false);
    expect(r.reviewStage).toBe(2);
    expect(r.ease).toBeLessThan(2.5);
  });
  it('ease 有上下限', () => {
    expect(srsSchedule(null, true).ease).toBeLessThanOrEqual(2.8);
    const fail = srsSchedule({ reviewStage: 0, ease: 1.3 }, false);
    expect(fail.ease).toBeGreaterThanOrEqual(1.3);
  });
});

describe('intervalDays', () => {
  it('间隔随等级增长且有上限', () => {
    expect(intervalDays(1)).toBe(1);
    expect(intervalDays(4)).toBe(14);
    expect(intervalDays(20)).toBeLessThanOrEqual(90);
    expect(intervalDays(0)).toBe(0);
  });
});

describe('levelFromExp / expForLevel', () => {
  it('累计经验三角递增', () => {
    expect(expForLevel(1)).toBe(0);
    expect(expForLevel(2)).toBe(100);
    expect(expForLevel(3)).toBe(300);
    expect(expForLevel(4)).toBe(600);
  });
  it('经验推导等级（边界）', () => {
    expect(levelFromExp(0)).toBe(1);
    expect(levelFromExp(99)).toBe(1);
    expect(levelFromExp(100)).toBe(2);
    expect(levelFromExp(299)).toBe(2);
    expect(levelFromExp(300)).toBe(3);
    expect(levelFromExp(600)).toBe(4);
  });
  it('负经验按 0 处理', () => {
    expect(levelFromExp(-10)).toBe(1);
  });
});

describe('computeRating', () => {
  it('全对满分 → SSS', () => {
    expect(computeRating({ total: 10, correct: 10, avgElapsedMs: 500, perfectBonus: true })).toBe(
      'SSS',
    );
  });
  it('全错 → C', () => {
    expect(computeRating({ total: 10, correct: 0, avgElapsedMs: 9000, perfectBonus: false })).toBe(
      'C',
    );
  });
  it('空会话 → C', () => {
    expect(computeRating({ total: 0, correct: 0, avgElapsedMs: 0, perfectBonus: false })).toBe('C');
  });
  it('单调性：高正确率评级不低于低正确率', () => {
    const high = computeRating({ total: 10, correct: 9, avgElapsedMs: 3000, perfectBonus: false });
    const low = computeRating({ total: 10, correct: 5, avgElapsedMs: 3000, perfectBonus: false });
    const order = ['C', 'B', 'A', 'S', 'SS', 'SSS'];
    expect(order.indexOf(high)).toBeGreaterThanOrEqual(order.indexOf(low));
  });
});

describe('ratingExp / computeCoins', () => {
  it('SSS 经验最高', () => {
    expect(ratingExp('SSS')).toBeGreaterThan(ratingExp('C'));
  });
  it('金币随正确数增加，SSS 额外奖励', () => {
    const ans: AnswerInput[] = [
      { seq: 0, correct: true, elapsedMs: 100 },
      { seq: 1, correct: true, elapsedMs: 100 },
    ];
    expect(computeCoins(ans, 'A')).toBe(4);
    expect(computeCoins(ans, 'SSS')).toBe(14);
  });
});

describe('rollDrops', () => {
  it('rating 越高高 tier 掉率越高', () => {
    const countHigher = (r: 'C' | 'SSS', tierIdx: number): number => {
      let n = 0;
      for (let i = 0; i < 2000; i++) {
        const d = rollDrops(r, () => 0.5);
        if (d.some((x) => x.tier === tierIdx)) n++;
      }
      return n;
    };
    // tier3（史诗）：SSS 掉率 0.6 远高于 C 的 0
    expect(countHigher('SSS', 3)).toBeGreaterThan(0);
    expect(countHigher('C', 3)).toBe(0);
  });
  it('掉落材质码符合约定', () => {
    const d = rollDrops('SS', () => 0);
    expect(d[0]?.materialCode).toBe('essence_1');
  });
});