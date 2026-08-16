// 判分纯函数：真题每题 2 分，输入答案 + 标准题 → 分数与逐题结果
import type { ReadingQuestionResult, ReadingSubmitAnswerInput } from '@word-journey/shared';

export interface ReadingQuestionSeed {
  seq: number;
  stem: string;
  options: { A: string; B: string; C: string; D: string };
  answer: string;
  analysis: string;
}

export interface ReadingScoredResult {
  totalQuestions: number;
  correctCount: number;
  score: number; // 每题 2 分（真题口径）
  results: ReadingQuestionResult[];
}

export function scoreReading(
  answers: ReadingSubmitAnswerInput[],
  questions: ReadingQuestionSeed[],
): ReadingScoredResult {
  const bySeq = new Map(answers.map((a) => [a.seq, a.choice]));
  const results: ReadingQuestionResult[] = questions.map((q) => {
    const choice = bySeq.get(q.seq);
    const correct = !!choice && choice === q.answer;
    return {
      seq: q.seq,
      stem: q.stem,
      options: q.options,
      choice,
      correct,
      answer: q.answer,
      analysis: q.analysis,
    };
  });
  const correctCount = results.filter((r) => r.correct).length;
  return { totalQuestions: results.length, correctCount, score: correctCount * 2, results };
}
