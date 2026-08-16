import { scoreReading, type ReadingQuestionSeed } from './scoring';

const questions: ReadingQuestionSeed[] = [
  {
    seq: 21,
    stem: 'Q21',
    options: { A: 'a', B: 'b', C: 'c', D: 'd' },
    answer: 'C',
    analysis: '解析1',
  },
  {
    seq: 22,
    stem: 'Q22',
    options: { A: 'a', B: 'b', C: 'c', D: 'd' },
    answer: 'B',
    analysis: '解析2',
  },
  {
    seq: 23,
    stem: 'Q23',
    options: { A: 'a', B: 'b', C: 'c', D: 'd' },
    answer: 'A',
    analysis: '解析3',
  },
  {
    seq: 24,
    stem: 'Q24',
    options: { A: 'a', B: 'b', C: 'c', D: 'd' },
    answer: 'D',
    analysis: '解析4',
  },
  {
    seq: 25,
    stem: 'Q25',
    options: { A: 'a', B: 'b', C: 'c', D: 'd' },
    answer: 'A',
    analysis: '解析5',
  },
];

describe('scoreReading', () => {
  it('scores correct answers as 2 points each', () => {
    const res = scoreReading(
      [
        { seq: 21, choice: 'C' },
        { seq: 22, choice: 'B' },
        { seq: 23, choice: 'A' },
        { seq: 24, choice: 'D' },
        { seq: 25, choice: 'A' },
      ],
      questions,
    );
    expect(res.totalQuestions).toBe(5);
    expect(res.correctCount).toBe(5);
    expect(res.score).toBe(10);
    expect(res.results.every((r) => r.correct)).toBe(true);
  });

  it('marks wrong answers and carries user choice', () => {
    const res = scoreReading(
      [
        { seq: 21, choice: 'A' },
        { seq: 22, choice: 'B' },
      ],
      questions,
    );
    expect(res.correctCount).toBe(1);
    expect(res.score).toBe(2);
    expect(res.results[0]).toMatchObject({ seq: 21, choice: 'A', correct: false, answer: 'C' });
    expect(res.results[1]).toMatchObject({ seq: 22, choice: 'B', correct: true });
  });

  it('ignores answers for unknown seqs and keeps others', () => {
    const res = scoreReading([{ seq: 999, choice: 'A' }], questions);
    expect(res.correctCount).toBe(0);
    expect(res.results.length).toBe(5);
  });

  it('handles empty answers', () => {
    const res = scoreReading([], questions);
    expect(res.score).toBe(0);
    expect(res.results.every((r) => r.choice === undefined && !r.correct)).toBe(true);
  });

  it('case-sensitive choice must match answer letter exactly', () => {
    const res = scoreReading([{ seq: 21, choice: 'c' }], questions);
    expect(res.results[0]?.correct).toBe(false);
  });
});
