import { describe, expect, it } from 'vitest';
import { buildContent, validateReadingFile } from './import-reading';

const validFile = {
  code: 'A',
  title: 'Text 1',
  subtitle: '气候变化教学之争',
  questionsStart: 21,
  sentences: [
    { para: 1, seq: 0, en: 'The weather in Texas is hot.', zh: '得克萨斯州的天气很热。' },
    { para: 1, seq: 1, en: 'It may cool down.', zh: '它可能会凉快下来。' },
    { para: 2, seq: 2, en: 'Officials debate the issue.', zh: '官员们争论这个问题。' },
  ],
  questions: [
    {
      seq: 21,
      stem: 'Q21?',
      options: { A: 'a', B: 'b', C: 'c', D: 'd' },
      answer: 'C',
      analysis: '解析：选 C。',
    },
    {
      seq: 22,
      stem: 'Q22?',
      options: { A: 'a', B: 'b', C: 'c', D: 'd' },
      answer: 'A',
      analysis: '解析：选 A。',
    },
  ],
  glossary: { weather: { meaning: 'n. 天气' }, debate: { meaning: 'v./n. 争论' } },
};

describe('validateReadingFile', () => {
  it('accepts a valid file', () => {
    expect(validateReadingFile(validFile)).toEqual([]);
  });

  it('rejects bad code / missing title', () => {
    expect(validateReadingFile({ ...validFile, code: 'E' })).toContain('code 非法: E');
    expect(validateReadingFile({ ...validFile, title: '' })).toContain('title 为空');
  });

  it('rejects empty sentences', () => {
    expect(validateReadingFile({ ...validFile, sentences: [] })).toContain('sentences 为空');
  });

  it('rejects duplicate sentence seq', () => {
    const dup = {
      ...validFile,
      sentences: [
        { para: 1, seq: 0, en: 'a', zh: '甲' },
        { para: 1, seq: 0, en: 'b', zh: '乙' },
      ],
    };
    expect(validateReadingFile(dup)).toContain('sentences[1].seq 重复: 0');
  });

  it('rejects bad answer letter and missing option', () => {
    const badQ = {
      ...validFile,
      questions: [
        {
          seq: 21,
          stem: 'q',
          options: { A: 'a', B: 'b', C: 'c' }, // 缺 D
          answer: 'X',
          analysis: 'x',
        },
      ],
    };
    const issues = validateReadingFile(badQ);
    expect(issues).toContain('questions[0].answer 非法: X');
    expect(issues.some((i) => i.includes('options.D'))).toBe(true);
  });

  it('rejects empty glossary meaning', () => {
    const badGloss = {
      ...validFile,
      glossary: { weather: { meaning: '' } },
    };
    expect(validateReadingFile(badGloss)).toContain('glossary.weather.meaning 为空');
  });
});

describe('buildContent', () => {
  it('joins sentences within a paragraph and paragraphs with blank lines', () => {
    const en = buildContent(validFile.sentences, 'en');
    expect(en).toBe('The weather in Texas is hot. It may cool down.\n\nOfficials debate the issue.');
    const zh = buildContent(validFile.sentences, 'zh');
    expect(zh).toContain('得克萨斯州的天气很热。');
  });
});
