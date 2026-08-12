import { useEffect, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { SessionFinish } from '@word-journey/shared';
import { useAuth } from '../store/auth';

const RESULT_KEY = 'wj-last-result';

const ratingColor: Record<string, string> = {
  C: 'text-slate-400',
  B: 'text-emerald-400',
  A: 'text-cyan-400',
  S: 'text-sky-400',
  SS: 'text-violet-400',
  SSS: 'text-amber-400',
};

const tierNames: Record<number, string> = { 1: '普通精华', 2: '稀有精华', 3: '史诗精华', 4: '传说精华' };

function isValidSessionFinish(v: unknown): v is SessionFinish {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return typeof r.rating === 'string' && typeof r.xp === 'number';
}

function parseResult(): SessionFinish | null {
  try {
    if (typeof window === 'undefined') return null;
    const raw = sessionStorage.getItem(RESULT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return isValidSessionFinish(parsed) ? parsed : null;
  } catch { return null; }
}

export function ResultPage() {
  const location = useLocation();
  const routeState = location.state as unknown;
  const result: SessionFinish | null = useMemo(() => {
    if (isValidSessionFinish(routeState)) {
      sessionStorage.setItem(RESULT_KEY, JSON.stringify(routeState));
      return routeState;
    }
    return parseResult();
  }, [routeState]);
  const { refreshUser } = useAuth();

  useEffect(() => {
    if (result) { refreshUser().catch(() => { /* 静默忽略刷新失败 */ }); }
  }, [result, refreshUser]);

  useEffect(() => {
    return () => { sessionStorage.removeItem(RESULT_KEY); };
  }, []);

  if (!result) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-950">
        <p className="text-slate-400">没有结算数据</p>
        <Link to="/lobby" className="text-cyan-400 hover:underline">
          返回大厅
        </Link>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/60 p-8 text-center shadow-xl">
        <div className="mb-2 text-sm text-slate-400">战斗结算</div>
        <div className={`text-6xl font-black ${ratingColor[result.rating] ?? 'text-slate-200'}`}>
          {result.rating}
        </div>

        <div className="mt-8 grid grid-cols-2 gap-4">
          <Stat label="经验" value={`+${result.xp}`} />
          <Stat label="金币" value={`+${result.coins}`} />
          <Stat label="复习词数" value={`${result.reviewedWords}`} />
          <Stat label="新掌握" value={`${result.newMastered}`} />
        </div>

        {result.drops.length > 0 && (
          <div className="mt-6 rounded-xl border border-slate-700 bg-slate-800/50 p-4 text-left">
            <div className="mb-2 text-xs text-slate-400">掉落物</div>
            {result.drops.map((d) => (
              <div key={d.materialCode} className="flex items-center justify-between text-sm">
                <span className="text-slate-200">
                  {tierNames[d.tier] ?? '未知材料'}
                </span>
                <span className="text-amber-400">×{d.count}</span>
              </div>
            ))}
          </div>
        )}

        <div className="mt-8 flex gap-3">
          <Link
            to="/lobby"
            className="flex-1 rounded-lg border border-slate-700 py-2 text-sm text-slate-300 hover:bg-slate-800"
          >
            返回大厅
          </Link>
          <Link
            to="/character"
            className="flex-1 rounded-lg bg-cyan-500 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400"
          >
            养成面板
          </Link>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-800/60 p-3">
      <div className="text-lg font-semibold text-slate-100">{value}</div>
      <div className="text-xs text-slate-400">{label}</div>
    </div>
  );
}