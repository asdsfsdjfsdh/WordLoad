import { describe, expect, it } from 'vitest';
import {
  findHomophonePairs,
  findOrthographicPairs,
  levenshtein,
  mergePairs,
  normalizePhonetic,
} from './confusable.ts';

describe('levenshtein', () => {
  it('相同为0，删一增一为1，替换为1', () => {
    expect(levenshtein('apple', 'apple')).toBe(0);
    expect(levenshtein('apple', 'apple!')).toBe(1);
    expect(levenshtein('cite', 'site')).toBe(1);
    expect(levenshtein('principal', 'principle')).toBe(2); // 经典考纲易混，距离2
  });
  it('支持中英文混合与空串', () => {
    expect(levenshtein('', '')).toBe(0);
    expect(levenshtein('', 'a')).toBe(1);
  });
});

describe('normalizePhonetic', () => {
  it('去除重音与长音标记', () => {
    expect(normalizePhonetic('rɪˈtrækt')).toBe('rɪtrækt');
    expect(normalizePhonetic('ˈæpl')).toBe('æpl');
  });
  it('空值返回空串', () => {
    expect(normalizePhonetic(null)).toBe('');
  });
});

describe('findOrthographicPairs', () => {
  it('检出编辑距离2的词对并排除词族变体', () => {
    const pairs = findOrthographicPairs(
      ['principal', 'principle', 'deliver', 'delivery', 'apple', 'apples', 'cite', 'site'],
      { minLength: 4 },
    );
    const keys = pairs.map((p) => `${p.wordA}↔${p.wordB}`);
    expect(keys).toContain('principal↔principle');
    expect(keys).toContain('cite↔site');
    expect(keys).not.toContain('deliver↔delivery'); // 词族变体排除
    expect(keys).not.toContain('apple↔apples');
  });
  it('短词(minLength)被过滤', () => {
    const pairs = findOrthographicPairs(['a', 'i', 'an', 'on', 'of'], { maxDistance: 1, minLength: 4 });
    expect(pairs).toHaveLength(0);
  });
});

describe('findHomophonePairs', () => {
  it('相同归一化音标且拼写不同检出', () => {
    const pairs = findHomophonePairs([
      { text: 'right', phonetic: 'raɪt' },
      { text: 'write', phonetic: 'raɪt' },
      { text: 'rite', phonetic: 'raɪt' },
      { text: 'site', phonetic: 'saɪt' },
    ]);
    expect(pairs).toHaveLength(3); // right/write, right/rite, write/rite
    expect(pairs.every((p) => p.type === 'homophone')).toBe(true);
  });
  it('缺音标跳过', () => {
    const pairs = findHomophonePairs([{ text: 'a', phonetic: null }]);
    expect(pairs).toHaveLength(0);
  });
});

describe('mergePairs', () => {
  it('同对去重且形近优先', () => {
    const a = [
      { wordA: 'right', wordB: 'write', type: 'homophone', note: '音近' },
    ];
    const b = [
      { wordA: 'write', wordB: 'right', type: 'orthographic', note: '形近' },
    ];
    const merged = mergePairs(a, b);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.type).toBe('orthographic');
  });
});
