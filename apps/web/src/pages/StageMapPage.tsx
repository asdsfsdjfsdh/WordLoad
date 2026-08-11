import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import type { StageInfo } from '@word-journey/shared';
import { api } from '../lib/api';

const tierLabel: Record<string, string> = { I: 'Ⅰ', II: 'Ⅱ', III: 'Ⅲ', IV: 'Ⅳ' };

export function StageMapPage() {
  const { code } = useParams<{ code: string }>();
  const { data: stages, isLoading } = useQuery({
    queryKey: ['stages', code],
    queryFn: () => api.get<StageInfo[]>(`/banks/${code}/stages`),
    enabled: !!code,
  });

  return (
    <div className="min-h-screen bg-slate-950 px-6 py-8">
      <div className="mb-8">
        <Link to="/lobby" className="text-sm text-slate-400 hover:text-cyan-400">
          ← 返回大厅
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-cyan-400">阶段地图</h1>
        <p className="mt-1 text-sm text-slate-400">通关上一阶段解锁下一阶段</p>
      </div>

      {isLoading ? (
        <p className="text-slate-400">加载中…</p>
      ) : (
        <div className="flex flex-col items-center gap-4">
          {stages?.map((s, i) => (
            <div key={s.id} className="flex w-full max-w-md flex-col items-center">
              {i > 0 && <div className="h-6 w-0.5 bg-slate-700" />}
              <StageCard stage={s} bankCode={code ?? ''} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StageCard({ stage, bankCode }: { stage: StageInfo; bankCode: string }) {
  const locked = stage.status === 'locked';
  return (
    <Link
      to={locked ? '#' : `/battle/${bankCode}/${stage.id}`}
      className={`w-full rounded-2xl border p-5 transition ${
        locked
          ? 'border-slate-800 bg-slate-900/40 opacity-60'
          : 'border-slate-700 bg-slate-900/70 hover:border-cyan-500'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-cyan-500/15 text-xl font-bold text-cyan-400">
            {tierLabel[stage.tier] ?? stage.tier}
          </span>
          <div>
            <div className="font-semibold text-slate-100">阶段 {stage.id}</div>
            <div className="text-xs text-slate-400">{stage.wordCount} 词</div>
          </div>
        </div>
        <div className="text-right">
          {locked ? (
            <span className="text-xs text-slate-500">🔒 未解锁</span>
          ) : (
            <>
              <div className="text-sm font-semibold text-cyan-400">
                {stage.status === 'cleared' ? '已通关' : '可挑战'}
              </div>
              {stage.bestRating && (
                <div className="text-xs text-amber-400">最佳 {stage.bestRating}</div>
              )}
            </>
          )}
        </div>
      </div>
    </Link>
  );
}