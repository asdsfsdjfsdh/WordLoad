import { describe, expect, it } from 'vitest';
import {
  assignTokenClauses,
  clauseRoleInfo,
  deriveSentenceKnowledge,
  isReadingBaseWord,
  locateClauseSpans,
  lookupReadingWord,
  normalizeReadingWord,
  readingWordCandidates,
  tokenizeReadingSentence,
} from './reading.js';
import type { ReadingGlossaryEntry } from './reading.js';

describe('normalizeReadingWord', () => {
  it('lowercases and keeps simple words intact', () => {
    expect(normalizeReadingWord('Texas')).toBe('texas');
    expect(normalizeReadingWord('weather')).toBe('weather');
  });
  it('keeps acronyms unchanged (lowercased)', () => {
    expect(normalizeReadingWord('PRH')).toBe('prh');
    expect(normalizeReadingWord('CEO')).toBe('ceo');
    expect(normalizeReadingWord("CEO's")).toBe('ceo');
  });
  it('strips possessives but keeps inflections', () => {
    expect(normalizeReadingWord("centre's")).toBe('centre');
    expect(normalizeReadingWord("scientists'")).toBe('scientist');
    expect(normalizeReadingWord("won't")).toBe("won't");
    expect(normalizeReadingWord('papers')).toBe('papers'); // 复数不在此剥离
  });
});

describe('readingWordCandidates', () => {
  it('returns light form plus stem variants', () => {
    expect(readingWordCandidates('papers')).toContain('papers');
    expect(readingWordCandidates('papers')).toContain('paper');
    expect(readingWordCandidates('learning')).toContain('learn');
    expect(readingWordCandidates('cities')).toContain('city');
    expect(readingWordCandidates('raised')).toContain('raise'); // stem + e 回退
    expect(readingWordCandidates('making')).toContain('make');
    expect(readingWordCandidates('is')).toEqual(['is']); // 短词不做 -s 剥离
  });
});

describe('lookupReadingWord', () => {
  const glossary: Record<string, ReadingGlossaryEntry> = {
    paper: { word: 'paper', meaning: 'n. 论文；纸' },
    raise: { word: 'raise', meaning: 'v. 提高；提出' },
    city: { word: 'city', meaning: 'n. 城市' },
    learn: { word: 'learn', meaning: 'v. 学习' },
    make: { word: 'make', meaning: 'v. 制作；使得' },
  };

  it('matches base form exactly', () => {
    expect(lookupReadingWord(glossary, 'paper')?.word).toBe('paper');
  });
  it('matches inflected forms via stem fallback', () => {
    expect(lookupReadingWord(glossary, 'papers')?.word).toBe('paper');
    expect(lookupReadingWord(glossary, 'learning')?.word).toBe('learn');
    expect(lookupReadingWord(glossary, 'cities')?.word).toBe('city');
    expect(lookupReadingWord(glossary, 'raised')?.word).toBe('raise');
    expect(lookupReadingWord(glossary, 'Making')?.word).toBe('make'); // 大小写 + 屈折
  });
  it('returns undefined when absent', () => {
    expect(lookupReadingWord(glossary, 'quux')).toBeUndefined();
  });
});

describe('tokenizeReadingSentence', () => {
  it('splits words, spaces and punctuation', () => {
    const tokens = tokenizeReadingSentence('The weather, in Texas, is hot!');
    const words = tokens.filter((t) => t.word);
    expect(words.map((t) => t.word)).toEqual(['the', 'weather', 'in', 'texas', 'is', 'hot']);
    expect(tokens[0]!.text).toBe('The');
    const joined = tokens.map((t) => t.text).join('');
    expect(joined).toBe('The weather, in Texas, is hot!');
  });

  it('handles hyphenated and apostrophe words', () => {
    const tokens = tokenizeReadingSentence("It's a mid-list writer's book.");
    const words = tokens.filter((t) => t.word).map((t) => t.word!);
    expect(words).toContain('it');
    expect(words).toContain('mid-list');
    expect(words).toContain('writer');
  });

  it('indexes point to the original offsets', () => {
    const sentence = 'A study last year gave grades.';
    const tokens = tokenizeReadingSentence(sentence);
    for (let i = 0; i < tokens.length; i++) {
      const start = i === 0 ? 0 : tokens[i - 1]!.index + tokens[i - 1]!.text.length;
      expect(sentence.indexOf(tokens[i]!.text, start)).toBe(tokens[i]!.index);
    }
  });
});

describe('clauseRoleInfo', () => {
  it('provides label and literal classes for every role', () => {
    const roles = ['main', 'noun', 'adj', 'adv', 'participle', 'prep', 'infinitive', 'appositive', 'coordinate', 'other'] as const;
    for (const r of roles) {
      const info = clauseRoleInfo(r);
      expect(info.label.length).toBeGreaterThan(0);
      expect(info.spanClass).toContain('border-b');
      expect(info.dotClass).toMatch(/^bg-/);
    }
  });
  it('falls back to other for unknown roles', () => {
    expect(clauseRoleInfo('whatever' as never).label).toBe('其他成分');
  });
});

describe('locateClauseSpans / assignTokenClauses', () => {
  const sentence = 'A study last year gave barely half of US states a grade B+ or higher, which was a surprise.';
  const clauses = [
    { role: 'main' as const, label: '主句', text: 'A study last year gave barely half of US states a grade B+ or higher' },
    { role: 'adj' as const, label: '定语从句', text: 'which was a surprise' },
  ];

  it('locates clause text as character spans', () => {
    const spans = locateClauseSpans(sentence, clauses);
    expect(spans).toHaveLength(2);
    const adj = spans.find((s) => s.role === 'adj')!;
    expect(sentence.slice(adj.start, adj.end)).toBe('which was a surprise');
  });

  it('assigns tokens to the most specific clause', () => {
    const tokens = tokenizeReadingSentence(sentence);
    const spans = locateClauseSpans(sentence, clauses);
    const roles = assignTokenClauses(tokens, spans);
    const byWord = new Map<string, string>();
    tokens.forEach((t, i) => {
      if (t.word) byWord.set(t.word, roles[i] ?? '');
    });
    expect(byWord.get('which')).toBe('adj');
    expect(byWord.get('surprise')).toBe('adj');
    expect(byWord.get('study')).toBe('main');
    expect(byWord.get('gave')).toBe('main');
  });

  it('leaves unmatched tokens undefined', () => {
    const tokens = tokenizeReadingSentence(sentence);
    const roles = assignTokenClauses(tokens, []);
    expect(roles.every((r) => r === undefined)).toBe(true);
  });
});

describe('isReadingBaseWord', () => {
  it('marks function words and basic pronouns as base', () => {
    for (const w of ['me', 'you', 'the', 'and', 'of', 'it', 'is', 'to', 'with', 'this', 'there']) {
      expect(isReadingBaseWord(w)).toBe(true);
    }
  });
  it('does not mark content words as base', () => {
    expect(isReadingBaseWord('weather')).toBe(false);
    expect(isReadingBaseWord('rampant')).toBe(false);
    expect(isReadingBaseWord('climate')).toBe(false);
  });
});

describe('deriveSentenceKnowledge', () => {
  const sentence = 'A study last year by the National Center for Science Education, a non-profit group of scientists and teachers, looking at how state public schools address climate change, gave barely half of US states a grade.';
  const structure = {
    clauses: [
      { role: 'main' as const, label: '主句', text: 'A study last year' },
      { role: 'participle' as const, label: '分词短语', text: 'looking at how state public schools address climate change' },
      { role: 'noun' as const, label: '名词性从句', text: 'how state public schools address climate change' },
      { role: 'appositive' as const, label: '同位语', text: 'a non-profit group of scientists and teachers' },
    ],
  };
  const glossary: ReadingGlossaryEntry[] = [
    { word: 'address', meaning: 'v. 处理' },
    { word: 'climate', meaning: 'n. 气候' },
    { word: 'non-profit', meaning: 'adj. 非营利的' },
    { word: 'step up', meaning: 'phr. 加强' },
  ];

  it('derives grammar points from clause roles (dedup)', () => {
    const k = deriveSentenceKnowledge(sentence, structure, glossary);
    expect(k.grammar.map((g) => g.role)).toEqual(['main', 'participle', 'noun', 'appositive']);
    expect(k.grammar.find((g) => g.role === 'noun')?.note).toContain('名词性从句');
  });

  it('derives phrases present in the sentence', () => {
    // "step up" 不在本句 → 不应出现
    const k = deriveSentenceKnowledge(sentence, structure, glossary);
    expect(k.phrases).toEqual([]);
    const withPhrase = deriveSentenceKnowledge('They step up demands.', structure, [
      ...glossary,
      { word: 'climate', meaning: 'n. 气候' },
    ]);
    expect(withPhrase.phrases.map((p) => p.text)).toContain('step up');
  });

  it('derives key words via inflection-tolerant lookup', () => {
    // "addressing" 命中 address 词条
    const k = deriveSentenceKnowledge('They are addressing climate change.', structure, glossary);
    expect(k.keyWords.map((w) => w.word)).toContain('address');
    expect(k.keyWords.map((w) => w.word)).toContain('climate');
  });

  it('handles missing structure / empty glossary', () => {
    const k = deriveSentenceKnowledge(sentence, undefined, []);
    expect(k.grammar).toEqual([]);
    expect(k.phrases).toEqual([]);
    expect(k.keyWords).toEqual([]);
  });
});
