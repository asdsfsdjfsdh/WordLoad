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
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/60 p-6 text-center shadow-xl">
        <div className={`text-5xl font-black ${ratingColor[result.rating] ?? 'text-slate-200'}`}>
          {result.rating}
        </div>

        {/* Boss 结局 + 转化率 合并一行 */}
        {(result.bossFought || (result.totalWrong != null && result.totalWrong > 0)) && (
          <div className="mt-1 text-xs text-slate-400">
            {result.bossFought && (
              <span className={result.bossCleared ? 'text-amber-400' : 'text-red-400'}>
                {result.bossCleared ? 'Boss 击破' : 'Boss 逃脱'}
              </span>
            )}
            {result.bossFought && result.totalWrong != null && result.totalWrong > 0 && ' · '}
            {result.totalWrong != null && result.totalWrong > 0 && (
              <span className="text-cyan-400">
                转化 {((result.wrongConverted ?? 0) / result.totalWrong * 100).toFixed(0)}%
              </span>
            )}
          </div>
        )}

        {/* 统计 + 掉落 单行 */}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm">
          <span className="text-sky-400 font-semibold">+{result.xp} XP</span>
          <span className="text-amber-400 font-semibold">+{result.coins} 💰</span>
          <span className="text-emerald-400">{result.newMastered} 新掌握</span>
          <span className="text-slate-400">{result.reviewedWords} 词</span>
        </div>
        {result.leveledUp && (
          <div className="mt-2 inline-block rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-bold text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.25)]">
            ⬆ Lv.UP 升级！
          </div>
        )}
        {result.drops.length > 0 && (
          <div className="mt-1 flex flex-wrap justify-center gap-x-3 gap-y-0.5 text-xs text-slate-400">
            {result.drops.map((d) => (
              <span key={d.materialCode}>
                {tierNames[d.tier] ?? '材料'} ×{d.count}
              </span>
            ))}
          </div>
        )}

        {/* 单词小结 */}
        {result.wordResults && result.wordResults.length > 0 && (
          <div className="mt-5 rounded-xl border border-slate-700/60 bg-slate-800/30 p-3">
            <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
              {result.wordResults.map((w, i) => (
                <span
                  key={i}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium border ${
                    w.correct
                      ? 'border-emerald-600/40 bg-emerald-500/10 text-emerald-300'
                      : 'border-red-600/40 bg-red-500/10 text-red-300'
                  } ${w.type === 'boss' ? 'ring-1 ring-amber-500/20' : ''}`}
                >
                  {w.text}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* 明天预告 */}
        {result.tomorrowPreview && result.tomorrowPreview.length > 0 && (
          <div className="mt-4 text-xs text-slate-500">
            明天复习：
            {result.tomorrowPreview.map((w, i) => (
              <span key={i} className="ml-1.5 text-slate-400">
                {w.text}
              </span>
            ))}
          </div>
        )}

        <div className="mt-6 flex gap-3">
          <Link
            to="/lobby"
            className="flex-1 rounded-lg border border-slate-700 py-2.5 text-sm text-slate-300 hover:bg-slate-800"
          >
            返回大厅
          </Link>
          <button
            onClick={() => window.history.back()}
            className="flex-1 rounded-lg bg-cyan-500 py-2.5 text-sm font-semibold text-slate-950 hover:bg-cyan-400"
          >
            再来一局
          </button>
        </div>
      </div>
    </div>
  );
}
