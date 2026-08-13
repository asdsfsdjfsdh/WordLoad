// 生存 Run 流程（M5）：预习页 → 波战 → 天转换/普通buff三选一 → 首领战 → 传说选择 → 继续/收枪
// 服务端权威：波末 advance 重放定生死；本组件仅驱动 BattleField 生存层做波内视觉
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ActiveRunResponse,
  CreateRunResponse,
  DifficultyTier,
  FoilOption,
  GameMode,
  LevelWord,
  RunAdvanceResponse,
  RunFinish,
  RunQuestion,
} from '@word-journey/shared';
import { api } from '../lib/api';
import { useAuth } from '../store/auth';
import { useIsTouch } from '../lib/touch';
import { BattleField, type BattleFieldHandle } from './BattleField';
import { TypingCore, type AnswerRecord } from './TypingCore';
import { ChoiceCore } from './ChoiceCore';
import { FlashCard } from './FlashCard';
import type { SurvivalWaveMeta, TierIdx } from '../lib/survivalBattle';

type Phase =
  | 'boot'
  | 'preview'
  | 'wave'
  | 'pick'
  | 'result';

interface BuffMeta {
  name: string;
  desc: string;
  color: string;
}

const BUFF_INFO: Record<string, BuffMeta> = {
  maxhp: { name: '生命上限', desc: '+2 本局 maxHp（≤3 次）', color: 'cyan' },
  dmg: { name: '伤害', desc: '伤害 +1（≥2 击保底）', color: 'rose' },
  leech: { name: '吸血', desc: '吸血 +1（N−2，最低 3）', color: 'emerald' },
  dodge: { name: '免伤', desc: '免伤 1 次（≤2 次）', color: 'amber' },
  freeze: { name: '冻结', desc: '冻结加时', color: 'indigo' },
};

const LEGEND_INFO: Record<string, BuffMeta> = {
  'boss-immunity': { name: '免伤免疫', desc: 'P2 免伤免疫', color: 'violet' },
  'kill-heal': { name: '击杀回血', desc: '击杀回血', color: 'emerald' },
  'boss-x2': { name: 'Boss×2', desc: 'Boss 段伤害 ×2', color: 'rose' },
  'no-leak-dmg': { name: '漏怪无伤', desc: '漏怪不扣血', color: 'sky' },
};

const colorClass = (c: string): { border: string; text: string; bg: string } => {
  const map: Record<string, { border: string; text: string; bg: string }> = {
    cyan: { border: 'border-cyan-400/60', text: 'text-cyan-300', bg: 'bg-cyan-950/50' },
    rose: { border: 'border-rose-400/60', text: 'text-rose-300', bg: 'bg-rose-950/50' },
    emerald: { border: 'border-emerald-400/60', text: 'text-emerald-300', bg: 'bg-emerald-950/50' },
    amber: { border: 'border-amber-400/60', text: 'text-amber-300', bg: 'bg-amber-950/50' },
    indigo: { border: 'border-indigo-400/60', text: 'text-indigo-300', bg: 'bg-indigo-950/50' },
    violet: { border: 'border-violet-400/60', text: 'text-violet-300', bg: 'bg-violet-950/50' },
    sky: { border: 'border-sky-400/60', text: 'text-sky-300', bg: 'bg-sky-950/50' },
  };
  return map[c] ?? map.cyan!;
};

function tierToIdx(t: DifficultyTier): TierIdx {
  return t === 'I' ? 0 : t === 'II' ? 1 : t === 'III' ? 2 : 3;
}

interface RunFlowProps {
  bankCode: string;
  stageId: number;
  mode: GameMode;
  onExit: () => void;
}

export function RunFlow({ bankCode, stageId, mode, onExit }: RunFlowProps) {
  const { user } = useAuth();
  const isTouch = useIsTouch();
  const battleRef = useRef<BattleFieldHandle>(null);

  const [phase, setPhase] = useState<Phase>('boot');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Run 状态（服务端权威的镜像）
  const [runId, setRunId] = useState(0);
  const [day, setDay] = useState(1);
  const [hp, setHp] = useState(0);
  const [maxHp, setMaxHp] = useState(0);
  const [buffs, setBuffs] = useState<string[]>([]);
  const [questions, setQuestions] = useState<RunQuestion[]>([]);
  const [previewWords, setPreviewWords] = useState<LevelWord[]>([]);
  const [bossWave, setBossWave] = useState(false);
  const [bossHp, setBossHp] = useState(0);

  // 待选/已选
  const [pendingBuff, setPendingBuff] = useState<string | null>(null);
  const [pendingLegend, setPendingLegend] = useState<string | null>(null);
  const [buffChoices, setBuffChoices] = useState<string[]>([]);
  const [legendChoices, setLegendChoices] = useState<string[]>([]);
  const [result, setResult] = useState<RunFinish | null>(null);

  // 波战输入控制
  const [forceFinish, setForceFinish] = useState(false);
  const [locked, setLocked] = useState(false);
  const [waveKey, setWaveKey] = useState(0);
  const [skippedWords, setSkippedWords] = useState<Set<string>>(new Set());

  // 选中文模式的候选池（与服务端同阶段词池对齐）
  const foilPool = useMemo<FoilOption[] | undefined>(() => {
    if (mode !== 'choice') return undefined;
    const seen = new Set<string>();
    const pool: FoilOption[] = [];
    for (const w of previewWords) {
      const m = w.meanings[0]?.meaning ?? '';
      if (seen.has(`${w.text}::${m}`)) continue;
      seen.add(`${w.text}::${m}`);
      pool.push({ text: w.text, meaning: m });
    }
    return pool.length > 0 ? pool : undefined;
  }, [mode, previewWords]);

  // ── 初始化：续 Run 优先，否则创建 ──
  const applyCreateResponse = (r: CreateRunResponse | ActiveRunResponse) => {
    // CreateRunResponse 无阶段恢复字段；ActiveRunResponse 可能带（续 Run）
    const active = r as ActiveRunResponse;
    setRunId(r.run.id);
    setDay(r.run.day);
    setHp(r.run.hp);
    setMaxHp(r.run.maxHp);
    setBuffs(r.run.buffs);
    setQuestions(r.questions);
    setPreviewWords(r.previewWords ?? []);
    setBossWave(active.bossWave ?? false);
    setBossHp(active.bossHp ?? 0);
    if (active.buffChoices?.length || active.legendChoices?.length) {
      setBuffChoices(active.buffChoices ?? []);
      setLegendChoices(active.legendChoices ?? []);
      setPhase('pick');
    } else if ((r.previewWords?.length ?? 0) > 0) {
      setPhase('preview');
    } else {
      setPhase('wave');
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const active = await api.get<ActiveRunResponse | null>('/runs/active');
        if (cancelled) return;
        if (active) {
          applyCreateResponse(active);
          return;
        }
        const created = await api.post<CreateRunResponse>('/runs', {
          bankCode,
          stageId,
          mode,
        });
        if (cancelled) return;
        applyCreateResponse(created);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : '创建 Run 失败');
        setPhase('preview');
        setPreviewWords([]);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankCode, stageId, mode]);

  // ── 预习页 ──
  const skipPreviewWord = (wordId: string) => {
    setSkippedWords((prev) => new Set(prev).add(wordId));
    try {
      api.post<{ ok: boolean }>(`/questions/words/${wordId}/skip`, {});
    } catch { /* 静默 */ }
  };

  // ── 波战 meta ──
  const survivalMeta = useMemo<SurvivalWaveMeta | null>(() => {
    const ch = user?.character;
    const all = [...buffs];
    if (pendingBuff) all.push(pendingBuff);
    if (pendingLegend) all.push(pendingLegend);
    return {
      day,
      atkLv: ch?.atkLv ?? 1,
      defLv: ch?.defLv ?? 1,
      hpLv: ch?.hpLv ?? 1,
      maxHp,
      hp,
      buffs: {
        dmg: all.filter((b) => b === 'dmg').length,
        leech: all.filter((b) => b === 'leech').length,
        dodge: all.filter((b) => b === 'dodge').length,
      },
      legend: {
        bossImmunity: all.includes('boss-immunity'),
        killHeal: all.includes('kill-heal'),
        bossX2: all.includes('boss-x2'),
        noLeakDmg: all.includes('no-leak-dmg'),
      },
      questions: questions.map((q) => ({
        tier: tierToIdx(q.tier),
        isNew: q.isNew,
        isBoss: q.source === 'boss',
      })),
      bossWave,
      bossHp: bossWave ? bossHp : undefined,
    };
  }, [day, hp, maxHp, buffs, pendingBuff, pendingLegend, questions, bossWave, bossHp, user]);

  // 进入波战：启动生存波
  useEffect(() => {
    if (phase === 'wave' && survivalMeta) {
      const t = setTimeout(() => battleRef.current?.startSurvivalWave(survivalMeta!), 60);
      return () => clearTimeout(t);
    }
  }, [phase, waveKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── advance：波末提交 → 服务端重放 → 注入 → 下一波 ──
  const handleAdvanceResult = (res: RunAdvanceResponse) => {
    setHp(res.hp);
    setMaxHp(res.maxHp);
    setBuffs(res.buffs);
    if (res.ended) {
      setResult(res.result ?? null);
      setPhase('result');
      return;
    }
    if (res.bossWave) {
      // 首领波：先打 Boss，本轮不结算 buff 候选
      setDay(res.day);
      setQuestions(res.questions);
      setPreviewWords([]);
      setBossWave(true);
      setBossHp(res.bossHp ?? 0);
      setWaveKey((k) => k + 1);
      setPhase('wave');
      return;
    }
    // 次日
    setDay(res.day);
    setQuestions(res.questions);
    setPreviewWords(res.previewWords ?? []);
    setBossWave(false);
    setBossHp(0);
    if (res.legendChoices?.length) {
      setLegendChoices(res.legendChoices);
      setBuffChoices(res.buffChoices ?? []);
      setPhase('pick');
    } else if (res.buffChoices?.length) {
      setBuffChoices(res.buffChoices);
      setLegendChoices([]);
      setPhase('pick');
    } else if ((res.previewWords?.length ?? 0) > 0) {
      setPhase('preview');
    } else {
      setWaveKey((k) => k + 1);
      setPhase('wave');
    }
  };

  const doAdvance = async (answers: AnswerRecord[]) => {
    setBusy(true);
    setLocked(true);
    try {
      const res = await api.post<RunAdvanceResponse>(`/runs/${runId}/advance`, {
        answers: answers.map((a) => ({
          seq: a.seq,
          correct: a.correct,
          elapsedMs: a.elapsedMs,
          typed: a.typed,
        })),
        buffChoice: pendingBuff ?? undefined,
        legendChoice: pendingLegend ?? undefined,
      });
      setPendingBuff(null);
      setPendingLegend(null);
      setForceFinish(false);
      setLocked(false);
      handleAdvanceResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : '推进失败');
      setForceFinish(false);
      setLocked(false);
    } finally {
      setBusy(false);
    }
  };

  const handleWaveComplete = (answers: AnswerRecord[]) => {
    if (busy) return;
    doAdvance(answers);
  };

  // ── 收枪 ──
  const surrender = async () => {
    setBusy(true);
    try {
      const res = await api.post<RunFinish>(`/runs/${runId}/finish`, { surrender: true });
      setResult(res);
      setPhase('result');
    } catch (e) {
      setError(e instanceof Error ? e.message : '收枪失败');
    } finally {
      setBusy(false);
    }
  };

  // ── 渲染 ──
  if (phase === 'boot') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-950">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
        <p className="text-sm text-slate-400">准备生存 Run…</p>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>
    );
  }

  // 预习页（新词首战日 / 注入次日）
  if (phase === 'preview') {
    const displayWords = previewWords.filter((w) => !skippedWords.has(w.wordId));
    const nextWords = displayWords.length;
    return (
      <div className="flex min-h-screen flex-col bg-slate-950">
        <div className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/95 px-6 py-4 backdrop-blur-sm">
          <div className="mx-auto flex max-w-2xl items-center justify-between">
            <div>
              <h1 className="text-lg font-bold text-cyan-400">战前预习 · 第 {day} 天</h1>
              <p className="text-xs text-slate-400">
                <span className="text-sky-400">新词 {nextWords}</span>
                {skippedWords.size > 0 && <span className="ml-2 text-emerald-400">已斩 {skippedWords.size}</span>}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={onExit}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition-colors hover:border-slate-600 hover:bg-slate-800"
              >
                ← 返回
              </button>
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-hidden px-6 pb-24 pt-4">
          <FlashCard words={previewWords} skippedWords={skippedWords} onSkip={skipPreviewWord} />
        </div>
        <div className="fixed bottom-0 left-0 right-0 border-t border-slate-800 bg-slate-950/95 px-6 py-4 backdrop-blur-sm">
          <div className="mx-auto max-w-2xl">
            <button
              onClick={() => { setSkippedWords(new Set()); setWaveKey((k) => k + 1); setPhase('wave'); }}
              className="w-full rounded-xl bg-cyan-500 py-3.5 text-base font-bold text-slate-950 transition-all hover:bg-cyan-400 hover:shadow-[0_0_20px_rgba(6,182,212,0.5)]"
            >
              开始战斗 ⚔️
            </button>
            {error && <p className="mt-2 text-center text-sm text-red-400">{error}</p>}
          </div>
        </div>
      </div>
    );
  }

  // 天转换 / buff / 传说 选择
  if (phase === 'pick') {
    const hasLegend = legendChoices.length > 0;
    const title = hasLegend ? '首领击败！选择传说技能' : `第 ${day} 天 · 选择增益`;
    const subtitle = hasLegend
      ? '传说技能本局仅一次，可改变机制'
      : '增益作用于下一波';
    return (
      <div className="flex min-h-screen flex-col items-center justify-center overflow-hidden bg-slate-950 px-4">
        <div className="max-h-full w-full max-w-md overflow-y-auto rounded-2xl border border-cyan-500/30 bg-slate-900/80 p-8 shadow-[0_0_30px_rgba(6,182,212,0.15)] backdrop-blur-sm">
          <div className="mb-6 text-center">
            <h1 className="text-3xl font-black tracking-wider text-cyan-300">{title}</h1>
            <p className="mt-2 text-sm text-slate-400">{subtitle}</p>
          </div>

          {hasLegend && (
            <div className="mb-6">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-violet-400">传说技能</p>
              <div className="space-y-2">
                {legendChoices.map((b) => {
                  const info = LEGEND_INFO[b] ?? { name: b, desc: '', color: 'violet' };
                  const c = colorClass(info.color);
                  return (
                    <button
                      key={b}
                      onClick={() => setPendingLegend((prev) => (prev === b ? null : b))}
                      className={`w-full rounded-xl border ${c.border} ${c.bg} p-4 text-left transition-all hover:shadow-[0_0_15px_rgba(167,139,250,0.25)] ${pendingLegend === b ? 'ring-2 ring-violet-400' : ''}`}
                    >
                      <div className={`text-base font-bold ${c.text}`}>{info.name}</div>
                      <div className="mt-0.5 text-xs text-slate-400">{info.desc}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {buffChoices.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-cyan-400">普通增益</p>
              <div className="space-y-2">
                {buffChoices.map((b) => {
                  const info = BUFF_INFO[b] ?? { name: b, desc: '', color: 'cyan' };
                  const c = colorClass(info.color);
                  return (
                    <button
                      key={b}
                      onClick={() => setPendingBuff((prev) => (prev === b ? null : b))}
                      className={`w-full rounded-xl border ${c.border} ${c.bg} p-4 text-left transition-all hover:shadow-[0_0_15px_rgba(34,211,238,0.25)] ${pendingBuff === b ? 'ring-2 ring-cyan-400' : ''}`}
                    >
                      <div className={`text-base font-bold ${c.text}`}>{info.name}</div>
                      <div className="mt-0.5 text-xs text-slate-400">{info.desc}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="mt-6 grid grid-cols-2 gap-2">
            <button
              onClick={() => {
                setPendingBuff(null);
                setPendingLegend(null);
                setBuffChoices([]);
                setLegendChoices([]);
                setWaveKey((k) => k + 1);
                setPhase('wave');
              }}
              className="rounded-xl border border-slate-700 py-3 text-sm font-semibold text-slate-300 transition-colors hover:bg-slate-800"
            >
              跳过 →
            </button>
            <button
              onClick={() => {
                setBuffChoices([]);
                setLegendChoices([]);
                setWaveKey((k) => k + 1);
                setPhase('wave');
              }}
              disabled={busy}
              className="rounded-xl bg-cyan-500 py-3 text-sm font-bold text-slate-950 transition-all hover:bg-cyan-400 disabled:opacity-40"
            >
              继续 →
            </button>
          </div>
          <div className="mt-2">
            <button
              onClick={surrender}
              disabled={busy}
              className="w-full rounded-xl border border-amber-700/50 py-2.5 text-sm text-amber-400 transition-colors hover:bg-amber-950/30 disabled:opacity-40"
            >
              🏳 收枪（金币×0.5）
            </button>
          </div>
          {error && <p className="mt-3 text-center text-sm text-red-400">{error}</p>}
        </div>
      </div>
    );
  }

  // 波战（普通 / 首领）
  if (phase === 'wave') {
    const isBoss = bossWave;
    return (
      <div className="animate-[fadeIn_0.3s_ease-out] fixed inset-0 overflow-hidden bg-slate-950 md:flex md:flex-col">
        <div
          className={isTouch ? 'absolute inset-0' : 'relative shrink-0'}
          style={isTouch ? undefined : { height: '60vh' }}
        >
          <BattleField
            ref={battleRef}
            survival
            initHp={maxHp}
            totalQuestions={questions.length}
            phase={isBoss ? 'boss' : 'study'}
            onPlayerDown={() => { setForceFinish(true); setLocked(true); }}
            onLockInput={() => setLocked(true)}
          />
          <button
            onClick={surrender}
            className="absolute right-3 top-14 z-10 rounded-lg border border-amber-700/60 bg-slate-900/80 px-3 py-1 text-xs text-amber-400 backdrop-blur-sm hover:border-amber-600 hover:text-amber-300"
          >
            🏳 收枪
          </button>
        </div>

        {isTouch ? (
          <div
            className="absolute inset-x-0 bottom-0 z-20 mx-auto w-fit max-w-[92vw] max-h-[52vh] overflow-y-auto rounded-2xl border border-slate-700/40 bg-slate-950/15 px-3 pb-2 shadow-[0_-12px_40px_rgba(0,0,0,0.5)]"
          >
            <div className="mx-auto mt-1.5 h-1 w-10 rounded-full bg-slate-600/60" />
            {mode === 'choice' ? (
              <ChoiceCore
                key={`run-${day}-${isBoss ? 'boss' : 'study'}-${waveKey}`}
                questions={questions}
                mode={mode}
                foilPool={foilPool}
                onJudged={(r) => battleRef.current?.survivalTick(r.correct)}
                forceFinish={forceFinish}
                locked={locked}
                onComplete={handleWaveComplete}
              />
            ) : (
              <TypingCore
                key={`run-${day}-${isBoss ? 'boss' : 'study'}-${waveKey}`}
                questions={questions}
                mode={mode}
                onJudged={(r) => battleRef.current?.survivalTick(r.correct)}
                forceFinish={forceFinish}
                locked={locked}
                onComplete={handleWaveComplete}
              />
            )}
          </div>
        ) : (
          <div className="shrink-0 overflow-y-auto border-t border-slate-700/50 bg-slate-950/75 backdrop-blur-md" style={{ height: '40vh' }}>
            {mode === 'choice' ? (
              <ChoiceCore
                key={`run-${day}-${isBoss ? 'boss' : 'study'}-${waveKey}`}
                questions={questions}
                mode={mode}
                foilPool={foilPool}
                onJudged={(r) => battleRef.current?.survivalTick(r.correct)}
                forceFinish={forceFinish}
                locked={locked}
                onComplete={handleWaveComplete}
              />
            ) : (
              <TypingCore
                key={`run-${day}-${isBoss ? 'boss' : 'study'}-${waveKey}`}
                questions={questions}
                mode={mode}
                onJudged={(r) => battleRef.current?.survivalTick(r.correct)}
                forceFinish={forceFinish}
                locked={locked}
                onComplete={handleWaveComplete}
              />
            )}
          </div>
        )}
        {error && (
          <div className="absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded-lg bg-red-950/90 px-4 py-2 text-sm text-red-400">
            {error}
            <button onClick={() => setError('')} className="ml-2 text-red-300 underline">✕</button>
          </div>
        )}
      </div>
    );
  }

  // 结算
  if (phase === 'result' && result) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-4">
        <div className="w-full max-w-md rounded-2xl border border-cyan-500/30 bg-slate-900/80 p-8 text-center shadow-[0_0_30px_rgba(6,182,212,0.15)] backdrop-blur-sm">
          <div className="text-5xl">{result.recordBroken ? '🏆' : result.surrendered ? '🏳' : '💀'}</div>
          <h1 className="mt-3 text-3xl font-black text-cyan-300">
            {result.surrendered ? '主动收枪' : '阵亡'}
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            存活 {result.daysSurvived} 天 · 击破首领 {result.bossClearedCount} 次
          </p>
          {result.recordBroken && (
            <p className="mt-2 inline-block rounded-full bg-amber-500/20 px-3 py-1 text-sm text-amber-300">
              🏆 新纪录！最佳 {result.bestDays} 天
            </p>
          )}

          <div className="mt-6 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-3">
              <div className="text-lg font-black text-emerald-300">+{result.xp}</div>
              <div className="text-[10px] text-slate-500">经验</div>
            </div>
            <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-3">
              <div className="text-lg font-black text-amber-300">{result.coins}</div>
              <div className="text-[10px] text-slate-500">金币</div>
            </div>
            <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-3">
              <div className="text-lg font-black text-cyan-300">{result.rating}</div>
              <div className="text-[10px] text-slate-500">评级</div>
            </div>
          </div>

          {result.materials.length > 0 && (
            <div className="mt-4 rounded-xl border border-slate-800 bg-slate-800/30 p-3">
              <div className="mb-1.5 text-xs text-slate-400">掉落材料</div>
              <div className="flex flex-wrap justify-center gap-1.5">
                {result.materials.map((m, i) => (
                  <span key={i} className="rounded-full bg-slate-700/60 px-2.5 py-0.5 text-xs text-slate-200">
                    {m.materialCode} ×{m.count}
                  </span>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={onExit}
            className="mt-6 w-full rounded-xl bg-cyan-500 py-3 text-sm font-bold text-slate-950 transition-all hover:bg-cyan-400"
          >
            返回模式选择
          </button>
          {error && <p className="mt-3 text-center text-sm text-red-400">{error}</p>}
        </div>
      </div>
    );
  }

  return null;
}
