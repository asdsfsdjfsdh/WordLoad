import { describe, expect, it } from 'vitest';
import {
  evaluateDifficulties,
  frequencyDifficulty,
  normalizeByQuantile,
  normalizeTo4Tier,
  spellingComplexity,
} from '@pipeline/difficulty';

describe('spellingComplexity', () => {
  it('短简单词低于长词', () => {
    expect(spellingComplexity('a')).toBeLessThan(spellingComplexity('straightforward'));
  });
  it('含不规则组合词尾更高', () => {
    expect(spellingComplexity('through')).toBeGreaterThan(spellingComplexity('apple'));
  });
  it('返回 0~1', () => {
    for (const w of ['apple', 'xylophone', 'squirrel', 'ai']) {
      const s = spellingComplexity(w);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });
});

describe('frequencyDifficulty', () => {
  it('高频词难度低，罕见词难度高', () => {
    expect(frequencyDifficulty(0.9)).toBeLessThan(frequencyDifficulty(0.1));
  });
  it('零频率（超纲）为最高难度', () => {
    expect(frequencyDifficulty(0)).toBe(1);
  });
});

describe('normalizeTo4Tier', () => {
  it('按分界划分', () => {
    expect(normalizeTo4Tier(0.1)).toBe('I');
    expect(normalizeTo4Tier(0.4)).toBe('II');
    expect(normalizeTo4Tier(0.6)).toBe('III');
    expect(normalizeTo4Tier(0.8)).toBe('IV');
  });
});

describe('evaluateDifficulties', () => {
  it('权重可配置且结果为 0~1', () => {
    const r = evaluateDifficulties({
      senses: 3,
      spelling: 'throughout',
      frequency: 0.3,
      confusableCount: 2,
      weights: { polysemy: 0.4, spelling: 0.2, confusability: 0.2, frequency: 0.2 },
    });
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(1);
    expect(r.dimensions).toHaveProperty('polysemy');
    expect(r.dimensions).toHaveProperty('spellingComplexity');
  });
});

describe('normalizeByQuantile', () => {
  it('均匀分布映射为四档', () => {
    // 0~99 等差 → 分位应大致均匀到 4 档
    const scores = Array.from({ length: 100 }, (_, i) => i);
    const { normalized, tiers } = normalizeByQuantile(scores);
    const count = { I: 0, II: 0, III: 0, IV: 0 };
    for (const t of tiers.values()) count[t]++;
    expect(count.I).toBe(25);
    expect(count.II).toBe(25);
    expect(count.III).toBe(25);
    expect(count.IV).toBe(25);
  });

  it('相同的原始分映射到同一分位', () => {
    const scores = [0.1, 0.2, 0.1, 0.5, 0.9];
    const { normalized } = normalizeByQuantile(scores);
    expect(normalized.get(0)).toBe(normalized.get(2));
    expect(normalized.get(0)).toBeLessThan(normalized.get(1));
  });
});
