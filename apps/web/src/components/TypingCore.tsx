// 打字核心：题目渲染 + 输入判定 + 结果回调
// 纯 UI 组件，不依赖 Phaser（特效层里程碑 6 接入）
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Question } from '@word-journey/shared';

export interface AnswerRecord {
  seq: number;
  correct: boolean;
  elapsedMs: number;
}

interface Props {
  questions: Question[];
  onComplete: (answers: AnswerRecord[]) => void;
}

export function TypingCore({ questions, onComplete }: Props) {
  const [index, setIndex] = useState(0);
  const [input, setInput] = useState('');
  const [answered, setAnswered] = useState<AnswerRecord[]>([]);
  const [feedback, setFeedback] = useState<'correct' | 'wrong' | null>(null);
  const startedAt = useRef(Date.now());
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const q = questions[index];

  useEffect(() => {
    if (feedback === null) inputRef.current?.focus();
  }, [feedback, index]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  if (!q) return null;

  const commit = (correct: boolean) => {
    const elapsedMs = Date.now() - startedAt.current;
    const record = { seq: q.seq, correct, elapsedMs };
    const next = [...answered, record];
    setAnswered(next);
    setFeedback(correct ? 'correct' : 'wrong');
    startedAt.current = Date.now();
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (index + 1 < questions.length) {
        setIndex(index + 1);
        setInput('');
        setFeedback(null);
      } else {
        onComplete(next);
      }
    }, correct ? 280 : 900);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || !input.trim()) return;
    const entered = input.trim().toLowerCase();
    const answer = q.answer.toLowerCase();
    commit(entered === answer);
  };

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-4">
      {/* 题面 */}
      <div className="text-center">
        <div className="mb-2 text-xs text-slate-500">
          {index + 1} / {questions.length}
        </div>
        <div className="text-2xl font-semibold text-slate-100">{q.prompt}</div>
        {q.note && <div className="mt-3 text-sm text-amber-400">{q.note}</div>}
      </div>

      {/* 挖空模板 */}
      <div className="text-5xl font-bold tracking-widest text-cyan-400">
        {q.template.split('').map((c, i) => (
          <span key={i} className={c === '_' ? 'text-slate-600' : ''}>
            {c}
          </span>
        ))}
      </div>

      {/* 输入 */}
      <div className="w-full max-w-md">
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={feedback !== null}
          className={`w-full rounded-xl border bg-slate-900 px-4 py-3 text-center text-2xl tracking-widest outline-none ${
            feedback === 'correct'
              ? 'border-emerald-500 text-emerald-400'
              : feedback === 'wrong'
                ? 'border-red-500 text-red-400'
                : 'border-slate-600 focus:border-cyan-500'
          }`}
          placeholder="输入单词后回车"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        <div className="mt-2 h-6 text-center text-sm">
          {feedback === 'correct' && <span className="text-emerald-400">✓ 正确</span>}
          {feedback === 'wrong' && <span className="text-red-400">✗ 错误</span>}
        </div>
      </div>
    </div>
  );
}