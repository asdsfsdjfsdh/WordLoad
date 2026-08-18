import { describe, expect, it } from 'vitest';
import { validateReadingKnowledge } from './reading-knowledge';

const valid = {
  grammar: [
    { title: '让步状语从句', text: 'although 引导让步状语从句，主句表示转折，阅读时先理解主句结论。' },
  ],
  words: [
    { word: 'sharply', meaning: '强烈地、激烈地', note: '副词；修饰 dispute（反对）。' },
  ],
  phrases: [
    { text: 'dispute one\'s views', meaning: '反对某人的观点' },
  ],
};

describe('validateReadingKnowledge', () => {
  it('accepts a valid knowledge', () => {
    expect(validateReadingKnowledge(valid)).toEqual([]);
  });

  it('accepts empty / omitted groups', () => {
    expect(validateReadingKnowledge({ grammar: [], words: [], phrases: [] })).toEqual([]);
    expect(validateReadingKnowledge({})).toEqual([]);
  });

  it('rejects non-object', () => {
    expect(validateReadingKnowledge(null)).toContain('knowledge 不是对象');
    expect(validateReadingKnowledge('x')).toContain('knowledge 不是对象');
  });

  it('rejects empty title / text', () => {
    const bad = { grammar: [{ title: '', text: 'x' }] };
    expect(validateReadingKnowledge(bad)).toContain('grammar[0].title 为空');
    const bad2 = { grammar: [{ title: 'x', text: '' }] };
    expect(validateReadingKnowledge(bad2)).toContain('grammar[0].text 为空');
  });

  it('rejects empty word / meaning', () => {
    expect(validateReadingKnowledge({ words: [{ word: '', meaning: 'x' }] })).toContain('words[0].word 为空');
    expect(validateReadingKnowledge({ words: [{ word: 'x', meaning: '' }] })).toContain('words[0].meaning 为空');
  });

  it('rejects empty phrase text / meaning', () => {
    expect(validateReadingKnowledge({ phrases: [{ text: '', meaning: 'x' }] })).toContain('phrases[0].text 为空');
    expect(validateReadingKnowledge({ phrases: [{ text: 'x', meaning: '' }] })).toContain('phrases[0].meaning 为空');
  });

  it('rejects exceeding limits', () => {
    const manyGrammar = { grammar: Array.from({ length: 5 }, (_, i) => ({ title: `g${i}`, text: 'x' })) };
    expect(validateReadingKnowledge(manyGrammar)).toContain('grammar 超过 4 条');
    const manyWords = { words: Array.from({ length: 7 }, (_, i) => ({ word: `w${i}`, meaning: 'x' })) };
    expect(validateReadingKnowledge(manyWords)).toContain('words 超过 6 个');
    const manyPhrases = { phrases: Array.from({ length: 5 }, (_, i) => ({ text: `p${i}`, meaning: 'x' })) };
    expect(validateReadingKnowledge(manyPhrases)).toContain('phrases 超过 4 个');
  });
});