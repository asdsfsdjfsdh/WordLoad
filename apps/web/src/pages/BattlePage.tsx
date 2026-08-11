import { useMutation } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import type { GameMode, SessionFinish } from '@word-journey/shared';
import { api } from '../lib/api';
import { TypingCore, type AnswerRecord } from '../components/TypingCore';
import { checkVoiceAvailability } from '../lib/tts';
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
  const [mode, setMode] = useState<GameMode>('zh2en');
  const [error, setError] = useState('');
  const [voice] = useState(() => checkVoiceAvailability());

  const dictationDisabled = !voice.usable;

  const create = useMutation({
    mutationFn: async () => {
      const r = await api.post<CreateSessionResult>('/sessions', {
        bankCode,
        stageId: Number(stageId),
        mode,
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
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-slate-950">
        <div className="text-2xl font-semibold text-slate-100">选择战斗模式</div>

        <div className="grid gap-4 sm:grid-cols-2">
          <button
            onClick={() => setMode('zh2en')}
            className={`flex flex-col gap-1 rounded-xl border px-6 py-5 text-left ${
              mode === 'zh2en' ? 'border-cyan-500 bg-cyan-950/40' : 'border-slate-700 hover:bg-slate-900'
            }`}
          >
            <span className="text-lg font-semibold text-slate-100">中译英 🔊</span>
            <span className="text-sm text-slate-400">标准模式 · 看中文释义拼写</span>
          </button>

          <button
            onClick={() => setMode('dictation')}
            disabled={dictationDisabled}
            className={`flex flex-col gap-1 rounded-xl border px-6 py-5 text-left ${
              dictationDisabled
                ? 'cursor-not-allowed border-slate-800 opacity-60'
                : mode === 'dictation'
                  ? 'border-amber-500 bg-amber-950/40'
                  : 'border-slate-700 hover:bg-slate-900'
            }`}
          >
            <span className="text-lg font-semibold text-slate-100">听写 😈</span>
            <span className="text-sm text-slate-400">噩梦模式 · 仅朗读发音与音标</span>
          </button>
        </div>

        {!voice.usable && (
          <p className="max-w-sm text-center text-sm text-amber-400">
            {voice.reason ?? '当前浏览器不支持语音合成'}，听写模式不可用，你仍可正常使用中译英模式。
          </p>
        )}

        <button
          onClick={() => create.mutate()}
          disabled={create.isPending || dictationDisabled}
          className="rounded-xl bg-cyan-500 px-8 py-3 font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-50"
        >
          {create.isPending ? '准备题目…' : '出战'}
        </button>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>
    );
  }

  if (questions && sessionId) {
    return (
      <div className="min-h-screen bg-slate-950">
        <TypingCore questions={questions} mode={mode} onComplete={(a) => submit.mutate(a)} />
      </div>
    );
  }
  return null;
}