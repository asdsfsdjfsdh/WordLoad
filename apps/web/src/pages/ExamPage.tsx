import { useCallback, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { ExamPaper, ExamSubmitResult } from '@word-journey/shared';
import { api } from '../lib/api';

// 红宝书 Unit 试卷模式：看中填英（标注词性，不标注音标），交卷自动批改，计入统计
export function ExamPage() {
  const { bankCode, stageId } = useParams<{ bankCode: string; stageId: string }>();
  const navigate = useNavigate();

  const { data: paper, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['exam', bankCode, stageId],
    queryFn: () => api.get<ExamPaper>(('/exam/' + bankCode + '/' + stageId)),
    enabled: !!bankCode && !!stageId,
  });

  const [answers, setAnswers] = useState<Record<number, string>>({});
  const startRef = useRef<Record<number, number>>({});
  const [result, setResult] = useState<ExamSubmitResult | null>(null);

  const submit = useMutation({
    mutationFn: async () => {
      if (!paper || !bankCode || !stageId) throw new Error('未就绪');
      const now = Date.now();
      const ans = paper.questions.map((q) => {
        const started = startRef.current[q.seq] ?? now;
        return { seq: q.seq, typed: (answers[q.seq] ?? '').trim(), elapsedMs: Math.max(0, now - started) };
      });
      return api.post<ExamSubmitResult>(('/exam/' + bankCode + '/' + stageId + '/submit'), {
        paperId: paper.paperId,
        answers: ans,
      });
    },
    onSuccess: (res) => {
      setResult(res);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
  });

  const setAnswer = useCallback((seq: number, v: string) => {
    if (startRef.current[seq] === undefined) startRef.current[seq] = Date.now();
    setAnswers((prev) => ({ ...prev, [seq]: v }));
  }, []);

  const done = useMemo(() => {
    if (!paper) return 0;
    return paper.questions.filter((q) => (answers[q.seq] ?? '').trim() !== '').length;
  }, [paper, answers]);
  const total = paper?.questions.length ?? 0;

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-6 md:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link to={'/bank/' + bankCode + '/regions/' + Math.floor(Number(stageId) / 100) + '/levels'} className="text-sm text-slate-400 transition hover:text-cyan-400">← 返回 Unit 列表</Link>
            <h1 className="mt-2 text-2xl font-bold tracking-wide text-cyan-400" style={{ textShadow: '0 0 24px rgba(6,182,212,0.4)' }}>
              {paper?.title ?? '试卷'}
            </h1>
            <p className="mt-1 text-xs text-slate-500">看中文释义填英文 · 标注词性不标注音标 · 交卷自动批改 · 计入统计</p>
          </div>
          {result ? (
            <div className="text-right">
              <div className="text-3xl font-bold text-amber-400 tabular-nums">{result.accuracy}%</div>
              <div className="text-xs text-slate-500">评级 {result.rating} · +{result.xp} 经验 · +{result.coins} 金币</div>
            </div>
          ) : total > 0 ? (
            <div className="text-sm text-slate-400">已作答 <span className="font-bold text-cyan-300 tabular-nums">{done}/{total}</span></div>
          ) : null}
        </div>

        {isLoading ? (
          <div className="flex justify-center py-24">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
          </div>
        ) : isError ? (
          <div className="mx-auto max-w-md rounded-xl border border-red-500/30 bg-red-950/20 p-6 text-center">
            <p className="text-sm text-red-400">加载失败：{error instanceof Error ? error.message : '未知错误'}</p>
            <button onClick={() => refetch()} className="mt-3 text-sm text-cyan-400 hover:underline">重试</button>
          </div>
        ) : !paper || paper.questions.length === 0 ? (
          <p className="text-center text-sm text-slate-500">本单元暂无单词可考</p>
        ) : result ? (
          <ResultView result={result} onRetry={() => { setResult(null); setAnswers({}); startRef.current = {}; navigate(0); }} />
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {paper.questions.map((q) => (
                <QuestionCard
                  key={q.seq}
                  seq={q.seq}
                  pos={q.pos}
                  meaning={q.meaning}
                  value={answers[q.seq] ?? ''}
                  onChange={(v) => setAnswer(q.seq, v)}
                />
              ))}
            </div>
            <div className="sticky bottom-4 z-10 mt-6 flex justify-center">
              <button
                onClick={() => submit.mutate()}
                disabled={done < total || submit.isPending}
                className="rounded-xl px-8 py-3 text-base font-bold text-slate-950 transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 bg-gradient-to-r from-cyan-400 to-emerald-400 shadow-[0_0_24px_rgba(6,182,212,0.35)]"
              >
                {submit.isPending ? '批改中…' : ('交卷批改（' + done + '/' + total + '）')}
              </button>
            </div>
            {done < total && (
              <p className="mt-3 pb-10 text-center text-xs text-slate-500">还有 {total - done} 题未作答，请填写完整后再交卷</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function QuestionCard({ seq, pos, meaning, value, onChange }: {
  seq: number;
  pos?: string;
  meaning: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-900/70 p-3 transition hover:border-slate-700">
      <div className="flex items-start gap-2">
        <span className="w-6 shrink-0 pt-0.5 text-right text-xs font-semibold tabular-nums text-slate-500">{seq + 1}.</span>
        <div className="min-w-0 flex-1">
          <div className="leading-snug text-slate-100">
            {pos && <span className="mr-1.5 inline-block rounded bg-amber-500/15 px-1.5 py-0.5 align-middle text-[10px] font-bold text-amber-300 ring-1 ring-amber-500/30">{pos}</span>}
            {meaning}
          </div>
        </div>
      </div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder="英文…"
        className="w-full rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/20"
      />
    </div>
  );
}

function ResultView({ result, onRetry }: { result: ExamSubmitResult; onRetry: () => void }) {
  const [onlyWrong, setOnlyWrong] = useState(false);
  const rows = onlyWrong ? result.questions.filter((q) => !q.correct) : result.questions;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/70 px-4 py-3">
        <span className="text-sm text-emerald-400">✓ 答对 <b className="tabular-nums">{result.correct}</b></span>
        <span className="text-sm text-red-400">✗ 答错 <b className="tabular-nums">{result.wrong}</b></span>
        <span className="text-sm text-slate-400">共 {result.total} 题</span>
        {result.wrongbookAdded > 0 && (
          <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-xs text-rose-300 ring-1 ring-rose-500/30">新进错题本 {result.wrongbookAdded}</span>
        )}
        <button
          onClick={() => setOnlyWrong((v) => !v)}
          className={onlyWrong ? 'ml-auto rounded-lg bg-rose-500/20 px-3 py-1.5 text-xs font-semibold text-rose-300 ring-1 ring-rose-500/40' : 'ml-auto rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-700'}
        >
          {onlyWrong ? '只看全部' : '只看错题'}
        </button>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {rows.map((q) => (<GradedCard key={q.seq} q={q} />))}
      </div>
      <div className="flex justify-center gap-3 pb-10 pt-2">
        <Link to={'/bank/' + result.bankCode + '/regions/' + Math.floor(result.stageId / 100) + '/levels'} className="rounded-xl bg-slate-800 px-6 py-2.5 text-sm font-bold text-slate-200 transition hover:bg-slate-700">← 返回</Link>
        <button onClick={onRetry} className="rounded-xl bg-cyan-500/15 px-6 py-2.5 text-sm font-bold text-cyan-300 ring-1 ring-cyan-500/30 transition hover:bg-cyan-500/25">再做一份</button>
      </div>
    </div>
  );
}

function GradedCard({ q }: { q: ExamSubmitResult['questions'][number] }) {
  const correct = q.correct;
  return (
    <div className={correct ? 'rounded-xl border border-emerald-500/40 bg-emerald-950/20 p-3' : 'rounded-xl border border-red-500/40 bg-red-950/15 p-3'}>
      <div className="flex items-start gap-2">
        <span className={correct ? 'w-6 shrink-0 pt-0.5 text-right text-xs font-semibold tabular-nums text-emerald-500' : 'w-6 shrink-0 pt-0.5 text-right text-xs font-semibold tabular-nums text-red-500'}>{q.seq + 1}.</span>
        <div className="min-w-0 flex-1">
          <div className="leading-snug text-slate-100">
            {q.pos && <span className="mr-1.5 inline-block rounded bg-amber-500/15 px-1.5 py-0.5 align-middle text-[10px] font-bold text-amber-300 ring-1 ring-amber-500/30">{q.pos}</span>}
            {q.meaning}
          </div>
          {correct ? (
            <div className="mt-2 text-emerald-400">
              <span className="mr-1.5">✓</span>
              <span className="font-bold text-emerald-300">{q.text}</span>
            </div>
          ) : (
            <div className="mt-2 space-y-1.5">
              <div className="flex flex-wrap items-center gap-x-2 text-sm">
                <span className="text-slate-500">你的答案：</span>
                <span className="text-red-400 line-through decoration-2">{q.typed || '（未作答）'}</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-2 text-sm">
                <span className="text-slate-500">正确答案：</span>
                <span className="font-bold text-emerald-300">{q.text}</span>
                {q.phonetic && <span className="text-xs text-slate-400">/ {q.phonetic} /</span>}
              </div>
              <div className={q.misspelled ? 'mt-1 inline-flex items-center gap-1 rounded bg-cyan-500/15 px-2 py-0.5 text-[11px] font-semibold text-cyan-300 ring-1 ring-cyan-500/30' : 'mt-1 inline-flex items-center gap-1 rounded bg-rose-500/15 px-2 py-0.5 text-[11px] font-semibold text-rose-300 ring-1 ring-rose-500/30'}>
                {q.misspelled ? '✏️ 拼写接近（typo）' : '❌ 不认识 / 拼写错误'}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
