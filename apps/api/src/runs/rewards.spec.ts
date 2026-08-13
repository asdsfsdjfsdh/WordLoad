import { computeRewards, isRecordBroken } from './rewards';

describe('rewards 奖励与纪录', () => {
  it('xp：评级 + 天数加成封顶 20', () => {
    const r = computeRewards({ rating: 'S', correctCount: 15, daysSurvived: 30, bossClearedCount: 2, surrender: false, perfect: false });
    // ratingExp('S')=30 + 3·20=60 → 90
    expect(r.xp).toBe(90);
  });

  it('coins：答对×2 + 首领×5 + day', () => {
    const r = computeRewards({ rating: 'A', correctCount: 10, daysSurvived: 5, bossClearedCount: 1, surrender: false, perfect: false });
    expect(r.coins).toBe(10 * 2 + 5 + 5);
  });

  it('收枪 coins ×0.5（四舍五入）', () => {
    const base = computeRewards({ rating: 'A', correctCount: 10, daysSurvived: 5, bossClearedCount: 1, surrender: false, perfect: false }).coins;
    const surrendered = computeRewards({ rating: 'A', correctCount: 10, daysSurvived: 5, bossClearedCount: 1, surrender: true, perfect: false }).coins;
    expect(surrendered).toBe(Math.round(base * 0.5));
  });

  it('材料稀有度按天数解锁：day<3 →1，≥3→2，≥5→3，≥8→4', () => {
    expect(computeRewards({ rating: 'A', correctCount: 0, daysSurvived: 2, bossClearedCount: 0, surrender: false, perfect: false }).materialTier).toBe(1);
    expect(computeRewards({ rating: 'A', correctCount: 0, daysSurvived: 3, bossClearedCount: 0, surrender: false, perfect: false }).materialTier).toBe(2);
    expect(computeRewards({ rating: 'A', correctCount: 0, daysSurvived: 6, bossClearedCount: 0, surrender: false, perfect: false }).materialTier).toBe(3);
    expect(computeRewards({ rating: 'A', correctCount: 0, daysSurvived: 8, bossClearedCount: 0, surrender: false, perfect: false }).materialTier).toBe(4);
  });

  it('破纪录：仅死亡结算且 day > 历史最大', () => {
    expect(isRecordBroken(6, 5, false)).toBe(true);
    expect(isRecordBroken(6, 6, false)).toBe(false); // 平纪录不破
    expect(isRecordBroken(6, 5, true)).toBe(false);   // 收枪不计
    expect(isRecordBroken(4, 5, false)).toBe(false);
  });
});