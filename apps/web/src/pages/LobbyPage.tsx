import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useState } from 'react';
import type { Bank } from '@word-journey/shared';
import { api } from '../lib/api';
import { useAuth } from '../store/auth';
import { SettingsModal } from '../components/SettingsModal';

export function LobbyPage() {
  const { user } = useAuth();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { data: banks, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['banks'],
    queryFn: () => api.get<Bank[]>('/banks'),
  });

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950 px-4 py-6 sm:px-8 sm:py-10" style={{ backgroundImage: 'linear-gradient(rgba(6,182,212,.03) 1px, transparent 1px), linear-gradient(90deg, rgba(6,182,212,.03) 1px, transparent 1px)', backgroundSize: '40px 40px' }}>
      {/* ── 设置入口 ── */}
      <button
        onClick={() => setSettingsOpen(true)}
        aria-label="设置"
        className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full border border-slate-700/60 bg-slate-900/80 text-slate-400 backdrop-blur transition hover:border-cyan-500/40 hover:text-cyan-300"
      >
        <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065Z"/><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/></svg>
      </button>

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
          {banks?.map((b, bi) => {
            const pct = b.totalStages > 0 ? Math.round((b.unlockedStages / b.totalStages) * 100) : 0;
            const radius = 22;
            const circumference = 2 * Math.PI * radius;
            const offset = circumference - (pct / 100) * circumference;
            const theme = ['from-cyan-500/15 to-blue-500/15', 'from-emerald-500/15 to-teal-500/15', 'from-violet-500/15 to-purple-500/15', 'from-amber-500/15 to-orange-500/15'][bi % 4];
            const accent = ['#06b6d4', '#10b981', '#8b5cf6', '#f59e0b'][bi % 4];
            const glow = ['shadow-[0_0_20px_rgba(6,182,212,0.1)]', 'shadow-[0_0_20px_rgba(16,185,129,0.1)]', 'shadow-[0_0_20px_rgba(139,92,246,0.1)]', 'shadow-[0_0_20px_rgba(245,158,11,0.1)]'][bi % 4];
            return (
              <div key={b.id} className="group relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60 transition-all duration-300 hover:-translate-y-0.5 hover:border-slate-600 hover:shadow-xl">
                <div className={`absolute inset-0 bg-gradient-to-br ${theme} opacity-60 transition-opacity group-hover:opacity-80`} />
                <div className={`absolute -right-4 -top-4 h-16 w-16 rounded-full ${glow}`} />
                <div className="relative p-5">
                  <div className="mb-4 flex items-center gap-3">
                    <Link to={`/bank/${b.code}/stages`} className="flex-1">
                      <h3 className="text-lg font-bold text-slate-100">{b.name}</h3>
                    </Link>
                    <svg className="h-14 w-14 shrink-0" viewBox="0 0 52 52">
                      <circle cx="26" cy="26" r={radius} fill="none" stroke="rgb(30,41,59)" strokeWidth="3" />
                      <circle cx="26" cy="26" r={radius} fill="none" stroke={accent} strokeWidth="3" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset} transform="rotate(-90 26 26)" className="transition-all duration-700" />
                      <text x="26" y="30" textAnchor="middle" className="text-[10px] font-bold" fill={accent}>{b.unlockedStages}</text>
                    </svg>
                  </div>
                  <Link to={`/bank/${b.code}/stages`}>
                    <div className="mb-3 text-xs text-slate-400">{b.unlockedStages}/{b.totalStages} 阶段 · {b.totalWords} 词</div>
                  </Link>

                  {b.dueReviews > 0 && (
                    <div className="mb-3">
                      <Link to={`/battle/${b.code}/review`} state={{ mode: 'zh2en', size: b.dueReviews, review: true }}
                        className="block rounded-xl border border-orange-500/30 bg-orange-500/10 px-3 py-2 text-center text-sm hover:bg-orange-500/20 transition-colors">
                        <span className="font-bold text-orange-400">{b.dueReviews}</span>
                        <span className="ml-1 text-orange-300">词待复习 →</span>
                      </Link>
                    </div>
                  )}

                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>掌握 <span className="font-medium text-emerald-400">{b.masteredWords}</span></span>
                    <span>今日 <span className="font-medium text-cyan-400">{b.learnedToday}</span></span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── 真题阅读入口 ── */}
      <div className="mx-auto mt-6 max-w-4xl">
        <Link
          to="/reading"
          className="group flex items-center gap-4 rounded-2xl border border-slate-800 bg-gradient-to-r from-cyan-500/10 via-slate-900/60 to-slate-900/60 p-5 transition hover:border-cyan-500/40 hover:shadow-[0_0_24px_rgba(6,182,212,0.12)]"
        >
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-cyan-500/15 text-2xl">📖</div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-slate-100">考研英语一 · 真题阅读</h3>
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-400">2023</span>
            </div>
            <p className="mt-0.5 truncate text-xs text-slate-500">阅读理解 Part A（Text 1~4）· 点词查义 / 逐句精读 / 答题解析</p>
          </div>
          <svg className="h-5 w-5 shrink-0 text-slate-500 transition group-hover:translate-x-1 group-hover:text-cyan-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" /></svg>
        </Link>
      </div>

      {/* ── Bottom Nav ── */}
      <div className="mx-auto mt-8 flex max-w-sm justify-center gap-3">
        <Link to="/collections" className="flex-1 rounded-full border border-slate-700 bg-slate-900/60 px-4 py-2.5 text-center text-sm font-medium text-slate-300 transition hover:border-cyan-500/40 hover:text-cyan-300">📖 图鉴</Link>
        <Link to="/character" className="flex-1 rounded-full border border-slate-700 bg-slate-900/60 px-4 py-2.5 text-center text-sm font-medium text-slate-300 transition hover:border-cyan-500/40 hover:text-cyan-300">⚔️ 养成</Link>
        <Link to="/stats" className="flex-1 rounded-full border border-slate-700 bg-slate-900/60 px-4 py-2.5 text-center text-sm font-medium text-slate-300 transition hover:border-cyan-500/40 hover:text-cyan-300">📊 统计</Link>
      </div>

      {user?.isAdmin && (
        <div className="mx-auto mt-4 flex max-w-sm justify-center">
          <Link to="/admin" className="flex-1 rounded-full border border-violet-500/30 bg-violet-500/10 px-4 py-2 text-center text-sm font-medium text-violet-300 transition hover:border-violet-500/50 hover:text-violet-200">🛠 后台管理</Link>
        </div>
      )}

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
