import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import type { GameMode, LevelWord, SessionFinish } from '@word-journey/shared';
import { api } from '../lib/api';
import { TypingCore, type AnswerRecord } from '../components/TypingCore';
import { BattleField, type BattleFieldHandle } from '../components/BattleField';
import { checkVoiceAvailability, ensureVoiceAvailable, getTts } from '../lib/tts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../store/auth';

interface CreateSessionResult {
  sessionId: string;
  plan: { session: { questions: import('@word-journey/shared').Question[] } };
}

type Phase = 'mode' | 'learn' | 'battle' | 'boss';

export function BattlePage() {
  const { bankCode, stageId } = useParams<{
    bankCode: string;
    stageId: string;
  }>();
  const location = useLocation();
  const routeState = location.state as { mode?: GameMode; size?: number } | null;
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>('mode');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<import('@word-journey/shared').Question[] | null>(null);
  const [mode, setMode] = useState<GameMode>(routeState?.mode ?? 'zh2en');
  const [size] = useState<number>(routeState?.size ?? 20);
  const [error, setError] = useState('');
  const [forceFinish, setForceFinish] = useState(false);
  const [skippedWords, setSkippedWords] = useState<Set<string>>(new Set());
  const [previewWords, setPreviewWords] = useState<LevelWord[]>([]);
  const battleRef = useRef<BattleFieldHandle>(null);
  const { user } = useAuth();
  const [voice, setVoice] = useState<{ usable: boolean | null; reason?: string }>(() =>
    checkVoiceAvailability(),
  );

  useEffect(() => {
    if (voice.usable === null) {
      ensureVoiceAvailable().then((ok) =>
        setVoice(ok ? { usable: true } : { usable: false, reason: '未检测到可用的英文语音，听写模式不可用' }),
      );
    }
  }, [voice.usable]);

  const isStudying = phase === 'battle';
  const revengeBySeq = useMemo(
    () => new Map((questions ?? []).map((q) => [q.seq, q.isRevenge ?? false])),
    [questions],
  );

  const dictationDisabled = voice.usable !== true;
  const cannotFight = mode === 'dictation' && dictationDisabled;

  const wordsQuery = useQuery({
    queryKey: ['stage-words', bankCode, stageId],
    queryFn: () =>
      api.get<LevelWord[]>(`/questions/${bankCode}/${stageId}/words?size=${size}`),
    enabled: phase === 'learn' && !!bankCode && !!stageId,
  });

  useEffect(() => {
    if (wordsQuery.data) setPreviewWords(wordsQuery.data);
  }, [wordsQuery.data]);

  const skipWord = async (wordId: string) => {
    const newSkipped = new Set(skippedWords).add(wordId);
    setSkippedWords(newSkipped);
    try {
      await api.post<{ ok: boolean }>(`/questions/words/${wordId}/skip`, {});
    } catch { /* 静默忽略 */ }
    // 斩后自动补词
    const exclude = [...newSkipped, ...previewWords.map((w) => w.wordId)].join(',');
    try {
      const replacement = await api.get<LevelWord | null>(
        `/questions/${bankCode}/${stageId}/words/next?exclude=${exclude}`,
      );
      if (replacement) {
        setPreviewWords((prev) => [...prev, replacement]);
      }
    } catch { /* 无更多词可补 */ }
  };

  const create = useMutation({
    mutationFn: async () => {
      const ids = previewWords
        .filter((w) => !skippedWords.has(w.wordId))
        .map((w) => w.wordId);
      const r = await api.post<CreateSessionResult>('/sessions', {
        bankCode,
        stageId: Number(stageId),
        mode,
        size,
        wordIds: ids,
      });
      setSessionId(r.sessionId);
      setQuestions(r.plan.session.questions);
      setPhase('battle');
    },
    onError: (e) => setError(e instanceof Error ? e.message : '创建会话失败'),
  });

  const finishedRef = useRef(false);
  // 两阶段：累积全部答案
  const accumRef = useRef<AnswerRecord[]>([]);
  const [extendKey, setExtendKey] = useState(0);
  const [bossDead, setBossDead] = useState(false);
  const [tauntWords, setTauntWords] = useState<string[]>([]);

  const submit = useMutation({
    mutationFn: async (opts: { answers: AnswerRecord[]; bossCleared: boolean }) => {
      const r = await api.post<SessionFinish>(`/sessions/${sessionId}/submit`, { answers: opts.answers, bossCleared: opts.bossCleared });
      navigate('/result', { state: r });
    },
    onError: (e) => {
      finishedRef.current = false;
      setForceFinish(false);
      setError(e instanceof Error ? e.message : '结算失败');
    },
  });

  const enterBoss = useMutation({
    mutationFn: async (answers: AnswerRecord[]) => {
      const r = await api.post<{ questions: import('@word-journey/shared').Question[]; exhausted: boolean; bossHp: number }>(
        `/sessions/${sessionId}/enter-boss`, { answers },
      );
      return r;
    },
    onSuccess: (data) => {
      if (data.exhausted) {
        // Boss 词池空 → 直接结算（Boss 逃脱）
        submit.mutate({ answers: accumRef.current, bossCleared: false });
        return;
      }
      setQuestions(data.questions);
      setExtendKey((k) => k + 1);
      battleRef.current?.startBoss(data.bossHp);
      setPhase('boss');
    },
    onError: (e) => setError(e instanceof Error ? e.message : '进入 Boss 段失败'),
  });

  const bossExtend = useMutation({
    mutationFn: async (missedIds: string[]) => {
      const r = await api.post<{ questions: import('@word-journey/shared').Question[]; exhausted: boolean }>(
        `/sessions/${sessionId}/boss-extend`, { missedWordIds: missedIds },
      );
      return r;
    },
    onSuccess: (data) => {
      if (data.exhausted) {
        submit.mutate({ answers: accumRef.current, bossCleared: bossDead });
        return;
      }
      setQuestions(data.questions);
      setExtendKey((k) => k + 1);
    },
    onError: (e) => setError(e instanceof Error ? e.message : '续战失败'),
  });

  // 处理每轮答完
  const handleComplete = (answers: AnswerRecord[]) => {
    accumRef.current = [...accumRef.current, ...answers];
    if (forceFinish) {
      submit.mutate({ answers: accumRef.current, bossCleared: bossDead });
      return;
    }
    if (phase === 'battle') {
      // 学习段结束 → 进入 Boss
      const wrongIds = answers
        .filter((a) => !a.correct)
        .map((a) => questions?.[a.seq]?.wordId)
        .filter(Boolean) as string[];
      setTauntWords([...new Set(wrongIds)]);
      enterBoss.mutate(answers);
    } else {
      // Boss 段一轮答完
      if (bossDead || battleRef.current && !battleRef.current.bossAlive()) {
        submit.mutate({ answers: accumRef.current, bossCleared: true });
      } else {
        const wrongIds = answers
          .filter((a) => !a.correct)
          .map((a) => questions?.[a.seq]?.wordId)
          .filter(Boolean) as string[];
        bossExtend.mutate(wrongIds);
      }
    }
  };

  if (phase === 'mode') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
        <div className="w-full max-w-md rounded-2xl border border-cyan-500/30 bg-slate-900/80 p-8 shadow-[0_0_30px_rgba(6,182,212,0.15)] backdrop-blur-sm">
          <div className="mb-8 text-center">
            <h1
              className="text-5xl font-black tracking-wider text-cyan-300"
              style={{ textShadow: '0 0 20px rgba(6,182,212,0.6)' }}
            >
              阶段 {stageId}
            </h1>
            <p className="mt-2 text-sm text-slate-400">
              本局 {size} 词 · 预计 {size * 0.2}分钟
            </p>
          </div>

          <div className="mb-6 grid grid-cols-2 gap-3">
            <button
              onClick={() => setMode('zh2en')}
              className={`flex flex-col items-center gap-1 rounded-xl border p-4 transition-all ${
                mode === 'zh2en'
                  ? 'border-cyan-400 bg-cyan-950/60 shadow-[0_0_15px_rgba(6,182,212,0.3)]'
                  : 'border-slate-700 bg-slate-800/50 hover:border-slate-600'
              }`}
            >
              <span className="text-2xl">📝</span>
              <span className="text-sm font-semibold text-slate-100">中译英</span>
              <span className="text-[10px] leading-tight text-slate-400">中文释义 → 拼写单词</span>
            </button>
            <button
              onClick={() => setMode('dictation')}
              disabled={dictationDisabled}
              className={`flex flex-col items-center gap-1 rounded-xl border p-4 transition-all ${
                dictationDisabled
                  ? 'cursor-not-allowed border-slate-800 opacity-40'
                  : mode === 'dictation'
                    ? 'border-amber-500 bg-amber-950/60 shadow-[0_0_15px_rgba(245,158,11,0.3)]'
                    : 'border-slate-700 bg-slate-800/50 hover:border-slate-600'
              }`}
            >
              <span className="text-2xl">🎧</span>
              <span className="text-sm font-semibold text-slate-100">听写</span>
              <span className="text-[10px] leading-tight text-slate-400">仅朗读发音 · 噩梦</span>
            </button>
          </div>

          {voice.usable !== true && (
            <p className="mb-6 flex items-start gap-1.5 text-xs text-amber-400">
              <span className="mt-0.5 shrink-0">ℹ</span>
              <span>{voice.reason ?? '正在检测语音支持…'}，听写模式暂不可用</span>
            </p>
          )}

          <button
            onClick={() => setPhase('learn')}
            disabled={cannotFight}
            className="w-full rounded-xl bg-cyan-500 py-3.5 text-base font-bold text-slate-950 transition-all hover:bg-cyan-400 hover:shadow-[0_0_20px_rgba(6,182,212,0.5)] disabled:opacity-40 disabled:hover:shadow-none"
          >
            出战
          </button>
          {error && <p className="mt-3 text-center text-sm text-red-400">{error}</p>}
        </div>
      </div>
    );
  }

  if (phase === 'learn') {
    const displayWords = previewWords.filter((w) => !skippedWords.has(w.wordId));
    const remaining = displayWords.length;
    const tierColor = (t?: string) => {
      if (t === 'I') return 'bg-cyan-500/20 text-cyan-300';
      if (t === 'II') return 'bg-emerald-500/20 text-emerald-300';
      if (t === 'III') return 'bg-amber-500/20 text-amber-300';
      if (t === 'IV') return 'bg-rose-500/20 text-rose-300';
      return 'bg-slate-700/40 text-slate-400';
    };
    const statusStyle = (s: string) => {
      if (s === 'new') return { border: 'border-l-sky-500', badge: 'bg-sky-500/20 text-sky-300', label: '新词' };
      if (s === 'review') return { border: 'border-l-amber-500', badge: 'bg-amber-500/20 text-amber-300', label: '复习' };
      if (s === 'wrongbook') return { border: 'border-l-red-500', badge: 'bg-red-500/20 text-red-300', label: '错题' };
      if (s === 'mastered') return { border: 'border-l-emerald-500', badge: 'bg-emerald-500/20 text-emerald-300', label: '已掌握' };
      return { border: 'border-l-slate-700', badge: 'bg-slate-500/20 text-slate-400', label: '' };
    };
    const counts = { new: 0, review: 0, wrongbook: 0 };
    for (const w of displayWords) {
      if (w.status === 'new') counts.new++;
      else if (w.status === 'review') counts.review++;
      else if (w.status === 'wrongbook') counts.wrongbook++;
    }

    return (
      <div className="flex min-h-screen flex-col bg-slate-950">
        <div className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/95 px-6 py-4 backdrop-blur-sm">
          <div className="mx-auto flex max-w-2xl items-center justify-between">
            <div>
              <h1 className="text-lg font-bold text-cyan-400">战前预习</h1>
              <p className="flex flex-wrap gap-x-3 text-xs text-slate-400">
                <span>剩余 {remaining} 词</span>
                <span className="text-sky-400">新词 {counts.new}</span>
                <span className="text-amber-400">复习 {counts.review}</span>
                <span className="text-red-400">错题 {counts.wrongbook}</span>
                {skippedWords.size > 0 && <span className="text-emerald-400">已斩 {skippedWords.size}</span>}
              </p>
            </div>
            <button
              onClick={() => setPhase('mode')}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition-colors hover:border-slate-600 hover:bg-slate-800"
            >
              ← 返回
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto px-6 pb-24 pt-4">
          {wordsQuery.isLoading ? (
            <p className="text-center text-sm text-slate-500">加载中…</p>
          ) : (
            <div className="mx-auto max-w-2xl space-y-2">
              {displayWords.map((w) => {
                const s = statusStyle(w.status);
                return (
                <div
                  key={w.wordId}
                  className={`group rounded-xl border border-slate-800 border-l-4 ${s.border} bg-slate-900/50 p-4 transition-all hover:border-slate-600 hover:bg-slate-900/70`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${tierColor(w.tier)}`}
                      >
                        {w.tier ?? '?'}
                      </span>
                      <span className={`${s.badge} shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium`}>
                        {s.label}
                      </span>
                      <div className="min-w-0">
                        <span className="text-base font-bold text-slate-100">{w.text}</span>
                        {w.phonetic && (
                          <span className="ml-2 text-xs text-slate-500">{w.phonetic}</span>
                        )}
                        <div className="mt-1.5 space-y-0.5">
                          {w.meanings.map((m, j) => (
                            <div key={j}>
                              <span className="text-sm text-slate-300">{m.meaning}</span>
                              {m.example && (
                                <span className="ml-2 text-xs text-slate-600">{m.example}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="ml-3 flex shrink-0 items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        onClick={() => skipWord(w.wordId)}
                        className="rounded-lg border border-emerald-800 bg-emerald-950/40 px-2.5 py-1 text-xs text-emerald-400 transition-colors hover:bg-emerald-500/20"
                        title="已掌握"
                      >
                        斩
                      </button>
                      <button
                        onClick={() => getTts().speak(w.text)}
                        className="rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-300 transition-colors hover:border-slate-600 hover:bg-slate-800"
                      >
                        🔊
                      </button>
                    </div>
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="fixed bottom-0 left-0 right-0 border-t border-slate-800 bg-slate-950/95 px-6 py-4 backdrop-blur-sm">
          <div className="mx-auto max-w-2xl">
            <button
              onClick={() => { setError(''); create.mutate(); }}
              disabled={create.isPending}
              className="w-full rounded-xl bg-cyan-500 py-3.5 text-base font-bold text-slate-950 transition-all hover:bg-cyan-400 hover:shadow-[0_0_20px_rgba(6,182,212,0.5)] disabled:opacity-40"
            >
              {create.isPending ? '准备题目…' : '开始战斗 ⚔️'}
            </button>
            {error && <p className="mt-2 text-center text-sm text-red-400">{error}</p>}
          </div>
        </div>
      </div>
    );
  }

  if ((isStudying || phase === 'boss') && questions && sessionId) {
    const maxHp = 8 + (user?.character?.hpLv ?? 1) * 2;
    const isBoss = phase === 'boss';
    return (
      <div className="flex h-screen flex-col bg-slate-950">
        <div className="relative min-h-0 flex-1">
          <BattleField
            ref={battleRef}
            initHp={maxHp}
            totalQuestions={questions.length}
            phase={isBoss ? 'boss' : 'study'}
            onPlayerDown={() => setForceFinish(true)}
            onBossDefeated={() => setBossDead(true)}
            tauntWords={tauntWords}
          />
        </div>
        <div className="w-full shrink-0 overflow-y-auto border-t border-slate-700/50 bg-slate-950/95 backdrop-blur-md shadow-[0_-8px_32px_rgba(0,0,0,0.6)]" style={{ maxHeight: '62vh' }}>
          <TypingCore
            key={`${isBoss ? 'boss' : 'study'}-${extendKey}`}
            questions={questions}
            mode={mode}
            onJudged={(r) => battleRef.current?.notifyAnswer(r.correct, r.combo, revengeBySeq.get(r.seq))}
            onFreeze={(frozen) => battleRef.current?.freezeEnemies(frozen)}
            onSkillReleased={() => battleRef.current?.skillAttack()}
            forceFinish={forceFinish}
            onComplete={(a) => handleComplete(a)}
          />
        </div>
        {error && (
          <div className="absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded-lg bg-red-950/90 px-4 py-2 text-sm text-red-400">
            {error}
            <button onClick={() => setError('')} className="ml-2 text-red-300 underline">✕</button>
          </div>
        )}
      </div>
    );
  }
  return null;
}
