import { describe, expect, it } from 'vitest';
import { checkQuality, collectCandidates } from '@pipeline/quality';
import type { RawExample, RawWord } from '../types';

function word(spelling: string, paraphrase: string | null, phonetic: string | null): RawWord {
  return { wordid: 0, spelling, UKphonetic: phonetic, USphonetic: phonetic, paraphrase, frequency: 0.5 };
}

describe('collectCandidates', () => {
  it('关联例句并按词聚合', () => {
    const words: RawWord[] = [word('apple', '苹果', 'æpl')];
    const examples: RawExample[] = [
      { expaid: 1, wordid: 0, en: 'An apple a day.', cn: '一天一苹果', heat: 0, adddate: '' },
      { expaid: 2, wordid: 0, en: 'I ate the apple.', cn: '我吃了苹果', heat: 0, adddate: '' },
    ];
    const [c] = collectCandidates(words, examples);
    expect(c.word).toBe('apple');
    expect(c.examples).toHaveLength(2);
  });
});

describe('checkQuality', () => {
  it('识别缺音标（fatal）', () => {
    const r = checkQuality(collectCandidates([word('apple', '苹果', null)], []));
    expect(r.issues.some((i) => i.type === 'no-phonetic' && i.fatal)).toBe(true);
    expect(r.fatal).toBeGreaterThan(0);
  });

  it('识别缺释义（fatal）', () => {
    const r = checkQuality(collectCandidates([word('apple', null, 'æpl')], []));
    expect(r.issues.some((i) => i.type === 'empty-paraphrase')).toBe(true);
  });

  it('重复词标记但非 fatal', () => {
    const r = checkQuality(
      collectCandidates([word('apple', '苹果', 'æpl'), word('Apple', '苹果', 'æpl')], []),
    );
    const dup = r.issues.filter((i) => i.type === 'duplicate-word');
    expect(dup).toHaveLength(1);
    expect(dup[0]!.fatal).toBe(false);
  });

  it('例句含词形变化视为匹配（非 fatal）', () => {
    const words: RawWord[] = [word('antique', '古董', 'ænˈtiːk')];
    const examples: RawExample[] = [
      { expaid: 1, wordid: 0, en: 'The antiques are valuable.', cn: '古董很值钱', heat: 0, adddate: '' },
    ];
    const r = checkQuality(collectCandidates(words, examples));
    expect(r.issues.some((i) => i.type === 'example-missing-stem')).toBe(false);
  });

  it('例句完全不含词干 → warning 非 fatal', () => {
    const words: RawWord[] = [word('haven', '避风港', 'heɪvn')];
    const examples: RawExample[] = [
      { expaid: 1, wordid: 0, en: 'I have not seen it.', cn: '我没见过', heat: 0, adddate: '' },
    ];
    const r = checkQuality(collectCandidates(words, examples));
    const miss = r.issues.find((i) => i.type === 'example-missing-stem');
    expect(miss).toBeTruthy();
    expect(miss!.fatal).toBe(false);
  });
});
