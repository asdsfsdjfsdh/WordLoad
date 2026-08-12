import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { Bank } from '@word-journey/shared';
import { api } from '../lib/api';
import { useAuth } from '../store/auth';

export function LobbyPage() {
  const { user } = useAuth();
  const { data: banks, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['banks'],
    queryFn: () => api.get<Bank[]>('/banks'),
  });

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950 px-4 py-6 sm:px-8 sm:py-10" style={{ backgroundImage: 'linear-gradient(rgba(6,182,212,.03) 1px, transparent 1px), linear-gradient(90deg, rgba(6,182,212,.03) 1px, transparent 1px)', backgroundSize: '40px 40px' }}>
      {/* ── Hero ── */}
      <div className="mb-6 text-center">
        <h1 className="text-4xl font-black tracking-wider sm:text-5xl" style={{ color: '#67e8f9', textShadow: '0 0 18px rgba(6,182,212,.6), 0 0 40px rgba(6,182,212,.25)' }}>单词之旅</h1>
        <p className="mt-1 text-sm text-slate-500">选择词书，开启你的单词征途</p>
      </div>

      {/* ── User Info Pill ── */}
      <div className="mx-auto mb-8 flex w-fit items-center gap-3 rounded-full border border-slate-700/60 bg-slate-900/80 px-5 py-2 backdrop-blur">
        <span className="text-sm font-medium text-slate-100">{user?.username}</span>
        <span className="rounded-full bg-cyan-500/15 px-2.5 py-0.5 text-xs font-semibold text-cyan-400">Lv.{user?.character?.level ?? 1}</span>
        <span className="flex items-center gap-1 text-sm font-medium text-amber-400">
          <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20"><path d="M10 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16Zm0 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12Zm0 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z"/></svg>
          {user?.coins ?? 0}
        </span>
      </div>

      <h2 className="mb-4 text-center text-sm font-semibold uppercase tracking-[.2em] text-slate-500">词书</h2>

      {/* ── Loading / Error / Empty ── */}
      {isLoading ? (
        <p className="text-center text-slate-400">加载中…</p>
      ) : isError ? (
        <div className="mx-auto max-w-md rounded-2xl border border-red-800 bg-red-950/30 p-4 text-center">
          <p className="text-sm text-red-400">加载失败：{error instanceof Error ? error.message : '未知错误'}</p>
          <button onClick={() => refetch()} className="mt-2 text-sm font-medium text-cyan-400 hover:underline">重试</button>
        </div>
      ) : !banks?.length ? (
        <p className="text-center text-slate-400">暂无可用词书</p>
      ) : (
        <div className="mx-auto grid max-w-4xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {banks?.map((b) => {
            const pct = b.totalStages > 0 ? Math.round((b.unlockedStages / b.totalStages) * 100) : 0;
            const radius = 18;
            const circumference = 2 * Math.PI * radius;
            const offset = circumference - (pct / 100) * circumference;
            return (
              <Link
                key={b.id}
                to={`/bank/${b.code}/stages`}
                className="group relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60 p-5 transition-all duration-300 hover:-translate-y-0.5 hover:border-cyan-500/60 hover:shadow-[0_0_24px_rgba(6,182,212,.12)]"
              >
                <div className="absolute -right-6 -top-6 h-20 w-20 rounded-full bg-cyan-500/5 blur-xl transition group-hover:bg-cyan-500/10" />
                <div className="mb-3 flex items-start justify-between">
                  <h3 className="text-lg font-bold text-slate-100">{b.name}</h3>
                  <svg className="h-12 w-12 shrink-0" viewBox="0 0 44 44">
                    <circle cx="22" cy="22" r={radius} fill="none" stroke="rgb(30,41,59)" strokeWidth="3" />
                    <circle cx="22" cy="22" r={radius} fill="none" stroke="rgb(6,182,212)" strokeWidth="3" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset} transform="rotate(-90 22 22)" className="transition-all duration-700" />
                    <text x="22" y="26" textAnchor="middle" className="fill-cyan-400 text-[9px] font-bold">{b.unlockedStages}</text>
                  </svg>
                </div>
                <div className="mb-2 text-xs text-slate-500">{b.unlockedStages}/{b.totalStages} 阶段</div>
                <div className="grid grid-cols-4 gap-1 text-center">
                  {[
                    { v: b.totalWords, l: '总词', c: 'text-slate-200' },
                    { v: b.masteredWords, l: '掌握', c: 'text-emerald-400' },
                    { v: b.dueReviews, l: '待复习', c: 'text-amber-400' },
                    { v: b.learnedToday, l: '今日', c: 'text-cyan-400' },
                  ].map((s) => (
                    <div key={s.l}>
                      <div className={`text-base font-bold ${s.c}`}>{s.v}</div>
                      <div className="text-[10px] text-slate-500">{s.l}</div>
                    </div>
                  ))}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* ── Bottom Nav ── */}
      <div className="mx-auto mt-8 flex max-w-xs justify-center gap-4">
        <Link to="/character" className="flex-1 rounded-full border border-slate-700 bg-slate-900/60 px-4 py-2.5 text-center text-sm font-medium text-slate-300 transition hover:border-cyan-500/40 hover:text-cyan-300">养成面板 →</Link>
        <Link to="/collections" className="flex-1 rounded-full border border-slate-700 bg-slate-900/60 px-4 py-2.5 text-center text-sm font-medium text-slate-300 transition hover:border-cyan-500/40 hover:text-cyan-300">📖 图鉴 →</Link>
      </div>
    </div>
  );
}
