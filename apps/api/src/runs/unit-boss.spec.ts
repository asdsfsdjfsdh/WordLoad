import { UNIT_BOSS } from '@word-journey/shared';
import { finalBossHp } from './unit-boss';

describe('finalBossHp', () => {
  it('固定基数 × 随机浮动：落在 [BASE×(1−JITTER/2), BASE×(1+JITTER/2)] 区间内', () => {
    const lo = UNIT_BOSS.BASE_HP * (1 - UNIT_BOSS.JITTER / 2);
    const hi = UNIT_BOSS.BASE_HP * (1 + UNIT_BOSS.JITTER / 2);
    for (let i = 0; i < 1000; i++) {
      const hp = finalBossHp();
      expect(hp).toBeGreaterThanOrEqual(Math.max(4, Math.round(lo)));
      expect(hp).toBeLessThanOrEqual(Math.round(hi));
    }
  });

  it('不随 Unit 递增：任意 Unit 使用同一基数（rng 恒 0.5 → 基准值）', () => {
    expect(finalBossHp(() => 0.5)).toBe(UNIT_BOSS.BASE_HP);
    expect(finalBossHp(() => 0.5)).toBe(finalBossHp(() => 0.5));
  });

  it('rng=0 → 取下浮动；rng=1 → 取上浮动', () => {
    const lo = Math.max(4, Math.round(UNIT_BOSS.BASE_HP * (1 - UNIT_BOSS.JITTER / 2)));
    const hi = Math.round(UNIT_BOSS.BASE_HP * (1 + UNIT_BOSS.JITTER / 2));
    expect(finalBossHp(() => 0)).toBe(lo);
    expect(finalBossHp(() => 1)).toBe(hi);
  });

  it('保底 4（防基数过低时四舍五入到 0）', () => {
    expect(finalBossHp(() => 0)).toBeGreaterThanOrEqual(4);
  });
});
