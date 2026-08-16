import { describe, expect, it } from 'vitest';
import { validateReadingStructure } from './reading-structure';

const sentence = 'A study last year gave barely half of US states a grade B+ or higher, which was a surprise.';

const valid = {
  clauses: [
    { role: 'main', label: '主句', text: 'A study last year gave barely half of US states a grade B+ or higher' },
    { role: 'adj', label: '定语从句', text: 'which was a surprise' },
  ],
  main: { subject: 'A study last year', predicate: 'gave', object: 'barely half of US states a grade B+ or higher' },
};

describe('validateReadingStructure', () => {
  it('accepts a valid structure', () => {
    expect(validateReadingStructure(valid, sentence)).toEqual([]);
  });

  it('rejects bad role / empty label', () => {
    const bad = { clauses: [{ role: 'whatever', label: '', text: sentence }] };
    const issues = validateReadingStructure(bad, sentence);
    expect(issues.some((i) => i.includes('role 非法'))).toBe(true);
    expect(issues.some((i) => i.includes('label 为空'))).toBe(true);
  });

  it('rejects clause text not found in sentence', () => {
    const bad = { clauses: [{ role: 'main', label: '主句', text: 'no such text here' }] };
    expect(validateReadingStructure(bad, sentence).some((i) => i.includes('无法在原句中找到'))).toBe(true);
  });

  it('ignores whitespace differences when locating', () => {
    const spaced = { clauses: [{ role: 'main', label: '主句', text: 'A  study\n last  year' }] };
    expect(validateReadingStructure(spaced, sentence)).toEqual([]);
  });

  it('rejects empty clauses and missing main fields', () => {
    expect(validateReadingStructure({ clauses: [] }, sentence)).toContain('clauses 为空');
    const noSubj = { clauses: [{ role: 'main', label: '主句', text: sentence }], main: { subject: '', predicate: 'gave' } };
    expect(validateReadingStructure(noSubj, sentence)).toContain('main.subject 为空');
  });
});
