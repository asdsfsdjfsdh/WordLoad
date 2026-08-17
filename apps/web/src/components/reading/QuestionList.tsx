// 题目作答面板：A-D 选择 → 提交 → 判分 + 逐题解析
import type { ReadingQuestionResult, ReadingQuestionView, ReadingSubmitResponse } from '@word-journey/shared';

const LETTERS = ['A', 'B', 'C', 'D'] as const;

export interface QuestionListProps {
  questions: ReadingQuestionView[];
  answers: Record<number, string>;
  onSelect: (seq: number, choice: string) => void;
  result: ReadingSubmitResponse | null;
  submitting: boolean;
  submitError?: string | null;
  onSubmit: () => void;
}

export function QuestionList({ questions, answers, onSelect, result, submitting, submitError, onSubmit }: QuestionListProps) {
  const allAnswered = questions.length > 0 && questions.every((q) => answers[q.seq]);
  const resultBySeq = new Map<number, ReadingQuestionResult>();
  for (const r of result?.results ?? []) resultBySeq.set(r.seq, r);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-[.15em] text-slate-400">题目（每题 2 分）</h3>
        {result && (
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${result.score === result.totalQuestions * 2 ? 'bg-emerald-500/15 text-emerald-400' : 'bg-cyan-500/15 text-cyan-400'}`}>
            {result.score}/{result.totalQuestions * 2} 分 · 历史最高 {result.bestScore}
          </span>
        )}
      </div>

      {questions.map((q) => (
        <QuestionCard
          key={q.seq}
          q={q}
          chosen={answers[q.seq]}
          onSelect={onSelect}
          detail={result ? resultBySeq.get(q.seq) : undefined}
        />
      ))}

      {result?.recordBroken && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
          恭喜，刷新本篇历史最高分！
        </div>
      )}

      {submitError && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          提交失败：{submitError}
        </div>
      )}

      <button
        onClick={onSubmit}
        disabled={!allAnswered || submitting}
        className="w-full rounded-xl bg-cyan-500 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
      >
        {submitting ? '提交中…' : result ? '重新提交' : '提交答案'}
      </button>
    </div>
  );
}

function QuestionCard({
  q,
  chosen,
  onSelect,
  detail,
}: {
  q: ReadingQuestionView;
  chosen: string | undefined;
  onSelect: (seq: number, choice: string) => void;
  detail: ReadingQuestionResult | undefined;
}) {
  const answered = detail !== undefined;
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <div className="mb-3 flex gap-2">
        <span className="shrink-0 rounded-md bg-cyan-500/15 px-2 py-0.5 text-xs font-semibold text-cyan-400">{q.seq}</span>
        {q.remark && (
          <span className="shrink-0 rounded-md bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-400">{q.remark}</span>
        )}
        <p className="text-sm font-medium leading-6 text-slate-100">{q.stem}</p>
      </div>
      <div className="space-y-2">
        {LETTERS.map((l) => {
          const text = q.options[l];
          const isChosen = chosen === l;
          const isCorrect = answered && detail.answer === l;
          const isWrongChoice = answered && isChosen && detail.choice === l && detail.answer !== l;
          let cls = 'border-slate-700 bg-slate-800/40 hover:border-cyan-500/40';
          if (answered) {
            if (isCorrect) cls = 'border-emerald-500/60 bg-emerald-500/10';
            else if (isWrongChoice) cls = 'border-red-500/60 bg-red-500/10';
            else cls = 'border-slate-700/60 bg-slate-800/20 opacity-60';
          } else if (isChosen) {
            cls = 'border-cyan-500/60 bg-cyan-500/10';
          }
          return (
            <button
              key={l}
              disabled={answered}
              onClick={() => onSelect(q.seq, l)}
              className={`flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm transition ${cls} disabled:cursor-default`}
            >
              <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${
                answered && isCorrect ? 'border-emerald-400 text-emerald-300'
                : answered && isWrongChoice ? 'border-red-400 text-red-300'
                : isChosen ? 'border-cyan-400 text-cyan-300'
                : 'border-slate-500 text-slate-400'
              }`}>
                {answered && isCorrect ? '✓' : answered && isWrongChoice ? '✗' : l}
              </span>
              <span className="leading-6">{text}</span>
            </button>
          );
        })}
      </div>
      {answered && (
        <div className={`mt-3 rounded-lg border-l-2 px-3 py-2 text-xs leading-5 ${
          detail.correct ? 'border-emerald-500/50 bg-emerald-500/5 text-emerald-200/80' : 'border-red-500/50 bg-red-500/5 text-red-200/80'
        }`}>
          <span className="font-semibold">{detail.correct ? '答对' : `答错 · 正确答案 ${detail.answer}`}</span>
          <p className="mt-1 text-slate-400">{detail.analysis}</p>
        </div>
      )}
    </div>
  );
}
