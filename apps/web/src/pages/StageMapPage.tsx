import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { StageInfo } from '@word-journey/shared';
import { api } from '../lib/api';

const TIER: Record<string, string> = { I: 'Ⅰ', II: 'Ⅱ', III: 'Ⅲ', IV: 'Ⅳ' };
const PRESETS = [10, 20, 30, 40, 50, 60];

const S: Record<string, { border: string; bar: string; text: string; circle: string; btn: string }> = {
  locked:    { border: 'border-slate-700/40',  bar: 'bg-slate-700',                                   text: 'text-slate-500',   circle: 'bg-slate-800 text-slate-600',                                         btn: '' },
  available: { border: 'border-cyan-500/40',    bar: 'bg-cyan-500',                                    text: 'text-cyan-400',    circle: 'bg-cyan-500/15 text-cyan-400 shadow-[0_0_20px_rgba(6,182,212,0.35)]',  btn: 'bg-cyan-500/15 text-cyan-400 hover:bg-cyan-500/25' },
  cleared:   { border: 'border-emerald-500/40', bar: 'bg-gradient-to-r from-cyan-500 to-emerald-500',  text: 'text-emerald-400',  circle: 'bg-emerald-500/15 text-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.35)]', btn: 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25' },
};

export function StageMapPage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const [sessionSize, setSessionSize] = useState(20);

  const { data: stages, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['stages', code],
    queryFn: () => api.get<StageInfo[]>(`/banks/${code}/stages`),
    enabled: !!code,
  });

  return (
    <div className="min-h-screen bg-slate-950 px-6 py-8">
      <div className="mb-8">
        <Link to="/lobby" className="text-sm text-slate-400 transition hover:text-cyan-400">← 返回大厅</Link>
        <h1 className="mt-3 text-3xl font-bold tracking-wide text-cyan-400" style={{ textShadow: '0 0 24px rgba(6,182,212,0.45)' }}>阶段地图</h1>
        <p className="mt-1 text-sm text-slate-500">每阶段连续学习，掌握足够单词即可通关</p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
        </div>
      ) : isError ? (
        <div className="mx-auto max-w-md rounded-xl border border-red-500/30 bg-red-950/20 p-6 text-center">
          <p className="text-sm text-red-400">加载失败：{error instanceof Error ? error.message : '未知错误'}</p>
          <button onClick={() => refetch()} className="mt-3 text-sm text-cyan-400 hover:underline">重试</button>
        </div>
      ) : !stages?.length ? (
        <p className="text-center text-sm text-slate-500">无可用的阶段数据</p>
      ) : (
        <>
          <div className="mx-auto mb-8 max-w-md rounded-2xl border border-slate-800 bg-slate-900/80 p-5 backdrop-blur">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-300">出战题目数</span>
              <span className="text-lg font-bold text-cyan-400 tabular-nums">{sessionSize}</span>
            </div>
            <input type="range" min={10} max={60} step={5} value={sessionSize} onChange={e => setSessionSize(Number(e.target.value))} className="mt-3 w-full accent-cyan-500" />
            <div className="mt-3 flex justify-between gap-1.5">
              {PRESETS.map(n => (
                <button key={n} onClick={() => setSessionSize(n)}
                  className={`flex-1 rounded-full py-1 text-xs font-medium transition ${sessionSize === n ? 'bg-cyan-500/20 text-cyan-400 ring-1 ring-cyan-500/50' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col items-center gap-0">
            {stages.map((s, i) => (
              <div key={s.id} className="flex w-full max-w-md flex-col items-center">
                {i > 0 && <div className="h-8 w-0.5 animate-pulse bg-gradient-to-b from-slate-700 to-slate-800" />}
                <StageCard stage={s} onBattle={() =>
                  navigate(`/battle/${code}/${s.id}`, { state: { mode: s.status === 'cleared' ? 'review' : 'learn', size: sessionSize } })
                } />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function StageCard({ stage, onBattle }: { stage: StageInfo; onBattle: () => void }) {
  const locked = stage.status === 'locked';
  const s =
    S[stage.status] ??
    ({ border: 'border-slate-700/40', bar: 'bg-slate-700', text: 'text-slate-500', circle: 'bg-slate-800 text-slate-600', btn: '' } as const);
  const pct = Math.min(100, Math.max(0, stage.progress));
  const label = locked ? '未解锁' : stage.status === 'cleared' ? '已通关' : '可出战';

  return (
    <div className={`w-full rounded-2xl border ${s.border} bg-slate-900/70 p-5 transition ${locked ? 'opacity-60' : ''}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-2xl font-bold ${s.circle}`}>
            {locked ? '🔒' : TIER[stage.tier] ?? stage.tier}
          </span>
          <div>
            <div className={`font-semibold ${s.text}`}>{TIER[stage.tier] ?? stage.tier} 级 · {label}</div>
            <div className="mt-0.5 text-xs text-slate-500">{stage.wordCount} 词</div>
            {!locked && <div className="mt-1 text-xs text-slate-400">已遇 {stage.encountered} · 已掌握 {stage.mastered}</div>}
          </div>
        </div>
        {!locked && (
          <button onClick={onBattle} className={`rounded-lg px-5 py-2.5 text-sm font-bold transition active:scale-95 ${s.btn}`}>
            出战
          </button>
        )}
      </div>

      {locked ? (
        <p className="mt-4 text-center text-xs text-slate-600">需前一阶段进度 ≥ 80%</p>
      ) : (
        <div className="mt-4">
          <div className="mb-1.5 flex justify-between text-xs text-slate-500">
            <span>进度</span><span className="tabular-nums">{pct}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
            <div className={`h-full rounded-full transition-all duration-700 ${s.bar}`} style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}
