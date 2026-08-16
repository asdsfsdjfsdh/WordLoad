import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Bank, LevelInfo, LevelWord, RegionInfo, StageLeaderboard } from '@word-journey/shared';
import { api } from '../lib/api';

type LevelStyle = { border: string; bar: string; text: string; circle: string; btn: string };
const S: Record<'locked' | 'available' | 'cleared', LevelStyle> = {
  locked:    { border: 'border-slate-700/40',  bar: 'bg-slate-700',                                   text: 'text-slate-500',   circle: 'bg-slate-800 text-slate-600',                                          btn: '' },
  available: { border: 'border-cyan-500/40',    bar: 'bg-cyan-500',                                    text: 'text-cyan-400',    circle: 'bg-cyan-500/15 text-cyan-400 animate-[nodePulse_2s_ease-in-out_infinite]',  btn: 'bg-cyan-500/15 text-cyan-400 hover:bg-cyan-500/25' },
  cleared:   { border: 'border-emerald-500/40', bar: 'bg-gradient-to-r from-cyan-500 to-emerald-500',  text: 'text-emerald-400',  circle: 'bg-emerald-500/15 text-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.35)]', btn: 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25' },
};

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <span className="w-6 text-center text-base">🥇</span>;
  if (rank === 2) return <span className="w-6 text-center text-base">🥈</span>;
  if (rank === 3) return <span className="w-6 text-center text-base">🥉</span>;
  return <span className="w-6 text-center text-sm font-semibold text-slate-500 tabular-nums">{rank}</span>;
}

function BoardContent({ data, loading }: { data: StageLeaderboard | undefined; loading: boolean }) {
  const meOutOfTop = data && data.me && !data.entries.some((e) => e.isMe);
  return (
    <div className="overflow-y-auto px-2 py-2">
      {loading ? (
        <div className="flex justify-center py-10">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
        </div>
      ) : !data || data.totalPlayers === 0 ? (
        <p className="py-10 text-center text-xs text-slate-500">暂无玩家上榜，快去抢占第一！</p>
      ) : (
        <>
          <ul className="space-y-0.5">
            {data.entries.map((e) => (
              <li
                key={e.username}
                className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${e.isMe ? 'bg-cyan-500/15 ring-1 ring-cyan-500/50' : 'hover:bg-slate-800/70'}`}
              >
                <RankBadge rank={e.rank} />
                <span className={`flex-1 truncate ${e.isMe ? 'font-semibold text-cyan-300' : 'text-slate-300'}`}>
                  {e.username}
                  {e.cleared && <span className="ml-1 text-[10px] text-emerald-400" title="已通关">✓</span>}
                  {e.isMe && <span className="ml-1.5 text-[10px] text-cyan-500">(我)</span>}
                </span>
                {e.bossClearedCount > 0 && (
                  <span className="text-xs text-red-400" title={`击破首领 ${e.bossClearedCount} 次`}>👑{e.bossClearedCount}</span>
                )}
                <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-400 ring-1 ring-amber-500/30 tabular-nums">
                  ⚔️ {e.days} 天
                </span>
              </li>
            ))}
          </ul>
          {meOutOfTop && data.me && (
            <>
              <div className="mx-4 my-2 border-t border-dashed border-slate-700" />
              <div className="mx-2 rounded-lg bg-cyan-500/15 px-2 py-1.5 text-sm ring-1 ring-cyan-500/50">
                <div className="flex items-center gap-2">
                  <span className="w-6 text-center text-sm font-semibold text-cyan-400 tabular-nums">{data.me.rank}</span>
                  <span className="flex-1 font-semibold text-cyan-300">我的名次</span>
                  <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-400 ring-1 ring-amber-500/30 tabular-nums">⚔️ {data.me.days} 天</span>
                </div>
              </div>
            </>
          )}
          <p className="px-2 pb-1 pt-2 text-center text-[10px] text-slate-600">共 {data.totalPlayers} 人上榜</p>
        </>
      )}
    </div>
  );
}

function LeaderboardModal({
  data, loading, stageId, onClose,
}: { data: StageLeaderboard | undefined; loading: boolean; stageId: number; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`关卡 ${stageId} 排行榜`}
        className="relative z-10 flex max-h-[75vh] w-full max-w-sm flex-col overflow-hidden rounded-2xl border border-slate-700/60 bg-slate-900/95 shadow-[0_0_40px_rgba(6,182,212,0.2)] animate-[scaleIn_.2s_ease-out]"
      >
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <h2 className="text-sm font-bold text-cyan-400">关卡 {stageId} 排行榜</h2>
          <button onClick={onClose} className="rounded p-1 text-slate-500 transition hover:bg-slate-800 hover:text-slate-300" aria-label="关闭排行榜">✕</button>
        </div>
        <BoardContent data={data} loading={loading} />
      </div>
    </div>
  );
}

export function LevelMapPage() {
  const { code, regionId } = useParams<{ code: string; regionId: string }>();
  const navigate = useNavigate();
  const [boardStageId, setBoardStageId] = useState<number | null>(null);
  // 查看某关卡的单词列表
  const [wordsLevelId, setWordsLevelId] = useState<number | null>(null);

  const { data: levels, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['levels', code, regionId],
    queryFn: () => api.get<LevelInfo[]>(`/banks/${code}/regions/${regionId}/levels`),
    enabled: !!code && !!regionId,
  });

  const wordsQuery = useQuery({
    queryKey: ['level-words', code, wordsLevelId],
    queryFn: () => api.get<LevelWord[]>(`/questions/${code}/${wordsLevelId}/words?size=100`),
    enabled: wordsLevelId != null,
  });

  const { data: regions } = useQuery({
    queryKey: ['regions', code],
    queryFn: () => api.get<RegionInfo[]>(`/banks/${code}/regions`),
    enabled: !!code,
  });
  const { data: banks } = useQuery({
    queryKey: ['banks'],
    queryFn: () => api.get<Bank[]>('/banks'),
  });
  const bankName = banks?.find((b) => b.code === code)?.name;
  const region = regions?.find((r) => r.id === Number(regionId));

  const modalLb = useQuery({
    queryKey: ['leaderboard', code, boardStageId],
    queryFn: () => api.get<StageLeaderboard>(`/banks/${code}/stages/${boardStageId}/leaderboard`),
    enabled: boardStageId != null,
  });

  const levelsData = levels ?? [];
  const unlockedCount = levelsData.filter((l) => l.status !== 'locked').length;
  const clearedCount = levelsData.filter((l) => l.cleared).length;
  const wordTotal = levelsData.reduce((a, l) => a + l.wordCount, 0);

  return (
    <div className="min-h-screen bg-slate-950 px-6 py-8">
      <div className="mb-8">
        <Link to={`/bank/${code}/stages`} className="text-sm text-slate-400 transition hover:text-cyan-400">← 返回阶段地图</Link>
        <h1 className="mt-3 text-3xl font-bold tracking-wide text-cyan-400" style={{ textShadow: '0 0 24px rgba(6,182,212,0.45)' }}>
          {region?.name ?? `阶段 ${regionId}`}
        </h1>
        <p className="mt-1 text-sm text-slate-500">Unit 肉鸽 Run：学完全词触发 Final Boss，击败即通关 · 悬浮阶段查看旁行榜</p>
        {levelsData.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-cyan-500/10 px-3 py-1 font-semibold text-cyan-400 ring-1 ring-cyan-500/30">
              {bankName ?? `词书 ${code}`}
            </span>
            <span className="text-slate-500">
              已解锁 <span className="font-semibold text-slate-200">{unlockedCount}/{levelsData.length}</span> 关 · 已通关 <span className="font-semibold text-emerald-400">{clearedCount}</span> · 共 {wordTotal} 词
            </span>
          </div>
        )}
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
      ) : !levels?.length ? (
        <p className="text-center text-sm text-slate-500">无可用的关卡数据</p>
      ) : (
        <>
          <div className="flex flex-col items-center gap-0">
            {levels.map((l, i) => (
              <div
                key={l.id}
                className="flex w-full max-w-md flex-col items-center"
                style={{ animation: 'fadeUp .4s ease-out both', animationDelay: `${i * 70}ms` }}
              >
                {i > 0 && <div className="h-8 w-0.5 animate-pulse bg-gradient-to-b from-slate-700 to-slate-800" />}
                <LevelCard
                  level={l}
                  onBattle={() => navigate(`/battle/${code}/${l.id}`)}
                  onOpenBoard={() => setBoardStageId(l.id)}
                  onOpenWords={() => setWordsLevelId(l.id)}
                />
              </div>
            ))}
          </div>
        </>
      )}

      {boardStageId != null && (
        <LeaderboardModal
          stageId={boardStageId}
          data={modalLb.data}
          loading={modalLb.isLoading}
          onClose={() => setBoardStageId(null)}
        />
      )}

      {wordsLevelId != null && (
        <WordsModal
          stageId={wordsLevelId}
          words={wordsQuery.data}
          loading={wordsQuery.isLoading}
          onClose={() => setWordsLevelId(null)}
        />
      )}
    </div>
  );
}

// 查看某关卡全部单词
function WordsModal({ stageId, words, loading, onClose }: {
  stageId: number;
  words: LevelWord[] | undefined;
  loading: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const tierColor = (t?: string) => {
    if (t === 'I') return 'bg-cyan-500/20 text-cyan-300';
    if (t === 'II') return 'bg-emerald-500/20 text-emerald-300';
    if (t === 'III') return 'bg-amber-500/20 text-amber-300';
    if (t === 'IV') return 'bg-rose-500/20 text-rose-300';
    return 'bg-slate-700/40 text-slate-400';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Unit ${stageId % 100} 单词表`}
        className="relative z-10 flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-700/60 bg-slate-900/95 shadow-[0_0_40px_rgba(6,182,212,0.2)] animate-[scaleIn_.2s_ease-out]"
      >
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <h2 className="text-sm font-bold text-cyan-400">Unit {stageId % 100} 单词表</h2>
          <button onClick={onClose} className="rounded p-1 text-slate-500 transition hover:bg-slate-800 hover:text-slate-300" aria-label="关闭">✕</button>
        </div>
        <div className="overflow-y-auto px-3 py-2">
          {loading ? (
            <div className="flex justify-center py-10">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
            </div>
          ) : !words?.length ? (
            <p className="py-10 text-center text-xs text-slate-500">暂无单词数据</p>
          ) : (
            <ul className="divide-y divide-slate-800/60">
              {words.map((w, i) => (
                <li key={w.wordId} className="flex items-start gap-3 px-1 py-2">
                  <span className="w-6 shrink-0 pt-0.5 text-right text-xs tabular-nums text-slate-600">{i + 1}</span>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${tierColor(w.tier)}`}>
                    {w.tier ?? '?'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-sm font-bold text-slate-100">{w.text}</span>
                      {w.phonetic && <span className="text-xs text-slate-500">{w.phonetic}</span>}
                    </div>
                    <div className="mt-0.5 space-y-0.5">
                      {w.meanings.map((m, j) => (
                        <div key={j} className="text-xs text-slate-400">
                          <span>{m.meaning}</span>
                          {m.example && <span className="ml-1.5 text-slate-600">{m.example}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="border-t border-slate-800 px-4 py-2 text-center text-xs text-slate-600">
          共 {words?.length ?? 0} 词
        </div>
      </div>
    </div>
  );
}

function LevelCard({ level, onBattle, onOpenBoard, onOpenWords }: {
  level: LevelInfo;
  onBattle: () => void;
  onOpenBoard: () => void;
  onOpenWords: () => void;
}) {
  const locked = level.status === 'locked';
  const cleared = level.cleared;
  const s = S[level.status] ?? S.locked;
  // 通关进度 = 已掌握词占比（与"全词掌握 → Final Boss"语义一致）
  const pct = Math.round(Math.min(100, Math.max(0, level.progress)));
  const remaining = Math.max(0, level.wordCount - level.mastered);
  const label = locked ? '未解锁' : cleared ? '已通关' : '可出战';

  return (
    <div
      className={`group w-full rounded-2xl border ${s.border} bg-slate-900/70 p-5 transition-all duration-300 hover:-translate-y-0.5 hover:border-slate-500 ${locked ? 'opacity-60' : ''}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className={`relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-2xl font-bold ${s.circle}`}>
            {locked ? '🔒' : level.name.replace('Unit ', '')}
            {cleared && (
              <span className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-[11px] font-bold text-slate-950 ring-2 ring-slate-900">✓</span>
            )}
          </span>
          <div>
            <div className={`font-semibold ${s.text}`}>{level.name} · {label}</div>
            <div className="mt-0.5 text-xs text-slate-500">{level.wordCount} 词</div>
            {!locked && (
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-slate-400">
                  已掌握 <span className="font-semibold text-emerald-400">{level.mastered}</span>/{level.wordCount}
                </span>
                {!cleared && remaining > 0 && (
                  <span className="text-xs text-amber-400/90">还差 {remaining} 词掌握触发 Final Boss</span>
                )}
                {cleared && (
                  <span className="text-xs text-emerald-400/90">👑 已击败 Final Boss</span>
                )}
                {level.bestDays > 0 && (
                  <span className="inline-flex items-center rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-400 ring-1 ring-amber-500/30">
                    ⚔️ 最佳 {level.bestDays} 天
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
        {!locked && (
          <div className="flex items-center gap-2">
            <button
              onClick={onOpenBoard}
              title="查看旁行榜"
              className="rounded-lg px-3 py-2.5 text-sm font-bold transition active:scale-95 bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-cyan-300 md:hidden"
            >
              🏆 榜
            </button>
            <button
              onClick={onOpenWords}
              title="查看本关单词"
              className="rounded-lg px-3 py-2.5 text-sm font-bold transition active:scale-95 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-cyan-300"
            >
              📖 单词
            </button>
            <button onClick={onBattle} className={`rounded-lg px-5 py-2.5 text-sm font-bold transition active:scale-95 ${s.btn}`}>
              出战
            </button>
          </div>
        )}
      </div>

      {locked ? (
        <p className="mt-4 text-center text-xs text-slate-600">需前一关通关解锁</p>
      ) : (
        <div className="mt-4">
          <div className="mb-1.5 flex justify-between text-xs text-slate-500">
            <span>掌握进度</span><span className="tabular-nums">{pct}%</span>
          </div>
          <div className="relative h-3 w-full overflow-visible rounded-full bg-slate-800">
            <div className={`h-full rounded-full transition-all duration-700 ${s.bar}`} style={{ width: `${pct}%` }} />
            {/* 里程碑：100% = 全词掌握 → Final Boss */}
            <div className="absolute inset-y-0 left-[100%] w-px bg-white/30" />
            <span className="absolute -bottom-1.5 right-0 text-[9px] font-medium text-amber-500/80">100 Final Boss</span>
          </div>
        </div>
      )}
    </div>
  );
}
