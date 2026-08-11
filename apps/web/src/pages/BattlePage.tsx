import { useMutation } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import type { SessionFinish } from '@word-journey/shared';
import { api } from '../lib/api';
import { TypingCore, type AnswerRecord } from '../components/TypingCore';
import { useState } from 'react';

interface CreateSessionResult {
  sessionId: string;
  plan: { session: { questions: import('@word-journey/shared').Question[] } };
}

export function BattlePage() {
  const { bankCode, stageId } = useParams<{ bankCode: string; stageId: string }>();
  const navigate = useNavigate();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<import('@word-journey/shared').Question[] | null>(null);
  const [error, setError] = useState('');

  const create = useMutation({
    mutationFn: async () => {
      const r = await api.post<CreateSessionResult>('/sessions', {
        bankCode,
        stageId: Number(stageId),
        mode: 'zh2en',
      });
      setSessionId(r.sessionId);
      setQuestions(r.plan.session.questions);
    },
    onError: (e) => setError(e instanceof Error ? e.message : '创建会话失败'),
  });

  const submit = useMutation({
    mutationFn: async (answers: AnswerRecord[]) => {
      const r = await api.post<SessionFinish>(`/sessions/${sessionId}/submit`, { answers });
      navigate('/result', { state: r });
    },
    onError: (e) => setError(e instanceof Error ? e.message : '结算失败'),
  });

  if (!create.isSuccess) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <button
          onClick={() => create.mutate()}
          disabled={create.isPending}
          className="rounded-xl bg-cyan-500 px-8 py-3 font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-50"
        >
          {create.isPending ? '准备题目…' : '开始战斗'}
        </button>
        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
      </div>
    );
  }

  if (questions && sessionId) {
    return (
      <div className="min-h-screen bg-slate-950">
        <TypingCore questions={questions} onComplete={(a) => submit.mutate(a)} />
      </div>
    );
  }
  return null;
}