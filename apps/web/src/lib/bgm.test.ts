import { describe, expect, it } from 'vitest';
import { bgmParams } from './bgm';

describe('bgmParams 状态→参数映射', () => {
  it('平静态：combo 0、低危险、慢节奏 → 慢 tempo、低 intensity、calm', () => {
    const p = bgmParams({ combo: 0, danger: 0, pace: 0.5, boss: false });
    expect(p.tempo).toBeLessThan(115);
    expect(p.tempo).toBeGreaterThanOrEqual(80);
    expect(p.intensity).toBeLessThan(0.55);
    expect(p.mode).toBe('calm');
  });

  it('高强度：combo 满、高危险、快节奏 → 快 tempo、intensity 封顶 1、triumph', () => {
    const p = bgmParams({ combo: 999, danger: 1, pace: 2, boss: false });
    expect(p.tempo).toBe(160);
    expect(p.intensity).toBe(1);
    expect(p.mode).toBe('triumph');
  });

  it('combo 越高 tempo/intensity 单调不减', () => {
    const seq = [0, 3, 5, 7, 10, 20].map((combo) => bgmParams({ combo, danger: 0.5, pace: 1, boss: false }));
    for (let i = 1; i < seq.length; i++) {
      const cur = seq[i]!;
      const prev = seq[i - 1]!;
      expect(cur.tempo).toBeGreaterThanOrEqual(prev.tempo);
      expect(cur.intensity).toBeGreaterThanOrEqual(prev.intensity);
    }
  });

  it('pace 极值被夹取在 [0.5, 2] 且 pace 越大 tempo/intensity 越高', () => {
    const slow = bgmParams({ combo: 5, danger: 0, pace: 0.1, boss: false });
    const fast = bgmParams({ combo: 5, danger: 0, pace: 99, boss: false });
    expect(slow.tempo).toBeLessThan(fast.tempo);
    expect(slow.intensity).toBeLessThan(fast.intensity);
  });

  it('danger 越高 intensity 越高', () => {
    const low = bgmParams({ combo: 3, danger: 0, pace: 1, boss: false });
    const high = bgmParams({ combo: 3, danger: 1, pace: 1, boss: false });
    expect(high.intensity).toBeGreaterThan(low.intensity);
  });

  it('boss 波强制 tense（除非 combo ≥10 已凯旋）', () => {
    const p = bgmParams({ combo: 4, danger: 0, pace: 1, boss: true });
    expect(p.mode).toBe('tense');
    const p2 = bgmParams({ combo: 12, danger: 0, pace: 1, boss: true });
    expect(p2.mode).toBe('triumph');
  });
});
