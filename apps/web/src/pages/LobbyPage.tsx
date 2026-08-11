import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { Bank } from '@word-journey/shared';
import { api } from '../lib/api';
import { useAuth } from '../store/auth';

export function LobbyPage() {
  const { user, logout } = useAuth();
  const { data: banks, isLoading } = useQuery({
    queryKey: ['banks'],
    queryFn: () => api.get<Bank[]>('/banks'),
  });

  return (
    <div className="min-h-screen bg-slate-950 px-6 py-8">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-cyan-400">单词之旅</h1>
          <p className="mt-1 text-sm text-slate-400">
            {user?.username} · 等级 {user?.character?.level ?? 1} · 金币 {user?.coins}
          </p>
        </div>
        <button
          onClick={logout}
          className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
        >
          退出登录
        </button>
      </header>

      <h2 className="mb-4 text-lg font-semibold text-slate-200">选择词书</h2>

      {isLoading ? (
        <p className="text-slate-400">加载中…</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {banks?.map((b) => (
            <Link
              key={b.id}
              to={`/bank/${b.code}/stages`}
              className="group rounded-2xl border border-slate-800 bg-slate-900/60 p-5 transition hover:border-cyan-500"
            >
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-slate-100">{b.name}</h3>
                <span className="rounded-md bg-cyan-500/15 px-2 py-1 text-xs text-cyan-400">
                  {b.unlockedStages}/{b.totalStages} 阶段
                </span>
              </div>
              <div className="grid grid-cols-4 gap-2 text-center text-xs text-slate-400">
                <div>
                  <div className="text-base font-semibold text-slate-200">{b.totalWords}</div>
                  总词数
                </div>
                <div>
                  <div className="text-base font-semibold text-slate-200">{b.masteredWords}</div>
                  已掌握
                </div>
                <div>
                  <div className="text-base font-semibold text-amber-400">{b.dueReviews}</div>
                  待复习
                </div>
                <div>
                  <div className="text-base font-semibold text-emerald-400">{b.learnedToday}</div>
                  今日
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      <Link
        to="/character"
        className="mt-8 inline-block rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
      >
        养成面板 →
      </Link>
    </div>
  );
}