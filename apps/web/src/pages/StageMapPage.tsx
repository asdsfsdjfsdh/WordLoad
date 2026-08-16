import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Bank, RegionInfo, StageInfo, StageLeaderboard } from '@word-journey/shared';
import { api } from '../lib/api';

const TIER: Record<string, string> = { I: 'Ⅰ', II: 'Ⅱ', III: 'Ⅲ', IV: 'Ⅳ' };

const S: Record<string, { border: string; bar: string; text: string; circle: string; btn: string }> = {
  locked:    { border: 'border-slate-700/40',  bar: 'bg-slate-700',                                   text: 'text-slate-500',   circle: 'bg-slate-800 text-slate-600',                                          btn: '' },
  available: { border: 'border-cyan-500/40',    bar: 'bg-cyan-500',                                    text: 'text-cyan-400',    circle: 'bg-cyan-500/15 text-cyan-400 animate-[nodePulse_2s_ease-in-out_infinite]',  btn: 'bg-cyan-500/15 text-cyan-400 hover:bg-cyan-500/25' },
  cleared:   { border: 'border-emerald-500/40', bar: 'bg-gradient-to-r from-cyan-500 to-emerald-500',  text: 'text-emerald-400',  circle: 'bg-emerald-500/15 text-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.35)]', btn: 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25' },
};

const RATING_STYLE: Record<string, string> = {
  C: 'text-slate-300 bg-slate-500/15 ring-slate-400/30',
  B: 'text-cyan-300 bg-cyan-500/15 ring-cyan-400/30',
  A: 'text-blue-300 bg-blue-500/15 ring-blue-400/30',
  S: 'text-violet-300 bg-violet-500/15 ring-violet-400/30',
  SS: 'text-amber-300 bg-amber-500/15 ring-amber-400/40',
  SSS: 'text-amber-300 bg-amber-500/20 ring-amber-400/60 shadow-[0_0_12px_rgba(245,158,11,0.4)]',
};

// 名次样式：前三奖牌，其余数字
function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <span className="w-6 text-center text-base">🥇</span>;
  if (rank === 2) return <span className="w-6 text-center text-base">🥈</span>;
  if (rank === 3) return <span className="w-6 text-center text-base">🥉</span>;
  return <span className="w-6 text-center text-sm font-semibold text-slate-500 tabular-nums">{rank}</span>;
}

// 排行榜主体：悬浮预览面板与居中 Modal 共用
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

// 桌面端悬浮预览：右侧抽屉
function LeaderboardPreview({
  data,
  loading,
  stageId,
  onClose,
}: {
  data: StageLeaderboard | undefined;
  loading: boolean;
  stageId: number;
  onClose: () => void;
}) {
  return (
    <aside className="fixed right-4 top-24 z-40 hidden max-h-[70vh] w-80 flex-col overflow-hidden rounded-2xl border border-slate-700/60 bg-slate-900/95 shadow-[0_0_40px_rgba(6,182,212,0.15)] backdrop-blur-md md:flex md:top-20">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <h2 className="text-sm font-bold text-cyan-400">阶段 {stageId} 排行榜</h2>
        <button onClick={onClose} className="rounded p-1 text-slate-500 transition hover:bg-slate-800 hover:text-slate-300" aria-label="关闭排行榜">✕</button>
      </div>
      <BoardContent data={data} loading={loading} />
    </aside>
  );
}

// 点击榜单：居中 Modal（移动端友好）
function LeaderboardModal({
  data,
  loading,
  stageId,
  onClose,
}: {
  data: StageLeaderboard | undefined;
  loading: boolean;
  stageId: number;
  onClose: () => void;
}) {
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
        aria-label={`阶段 ${stageId} 排行榜`}
        className="relative z-10 flex max-h-[75vh] w-full max-w-sm flex-col overflow-hidden rounded-2xl border border-slate-700/60 bg-slate-900/95 shadow-[0_0_40px_rgba(6,182,212,0.2)] animate-[scaleIn_.2s_ease-out]"
      >
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <h2 className="text-sm font-bold text-cyan-400">阶段 {stageId} 排行榜</h2>
          <button onClick={onClose} className="rounded p-1 text-slate-500 transition hover:bg-slate-800 hover:text-slate-300" aria-label="关闭排行榜">✕</button>
        </div>
        <BoardContent data={data} loading={loading} />
      </div>
    </div>
  );
}

export function StageMapPage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  // 旁行榜：桌面悬浮预览 + 点击打开居中 Modal
  const [hoverStageId, setHoverStageId] = useState<number | null>(null);
  const [boardStageId, setBoardStageId] = useState<number | null>(null);

  const { data: stages, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['stages', code],
    queryFn: () => api.get<StageInfo[]>(`/banks/${code}/stages`),
    enabled: !!code,
  });

  const { data: banks } = useQuery({
    queryKey: ['banks'],
    queryFn: () => api.get<Bank[]>('/banks'),
  });
  const bankName = banks?.find((b) => b.code === code)?.name;
  const hierarchical = banks?.find((b) => b.code === code)?.structure === 'hierarchical';

  // hierarchical 词书：外层阶段地图
  const { data: regions, isLoading: regionsLoading } = useQuery({
    queryKey: ['regions', code],
    queryFn: () => api.get<RegionInfo[]>(`/banks/${code}/regions`),
    enabled: !!code && hierarchical,
  });

  const previewLb = useQuery({
    queryKey: ['leaderboard', code, hoverStageId],
    queryFn: () => api.get<StageLeaderboard>(`/banks/${code}/stages/${hoverStageId}/leaderboard`),
    enabled: hoverStageId != null,
  });

  const modalLb = useQuery({
    queryKey: ['leaderboard', code, boardStageId],
    queryFn: () => api.get<StageLeaderboard>(`/banks/${code}/stages/${boardStageId}/leaderboard`),
    enabled: boardStageId != null,
  });

  const closePreview = () => setHoverStageId(null);

  const stagesData = stages ?? [];
  const unlockedCount = stagesData.filter((s) => s.status !== 'locked').length;
  const masteredTotal = stagesData.reduce((a, s) => a + s.mastered, 0);
  const wordTotal = stagesData.reduce((a, s) => a + s.wordCount, 0);

  return (
    <div className="min-h-screen bg-slate-950 px-6 py-8">
      <div className="mb-8">
        <Link to="/lobby" className="text-sm text-slate-400 transition hover:text-cyan-400">← 返回大厅</Link>
        <h1 className="mt-3 text-3xl font-bold tracking-wide text-cyan-400" style={{ textShadow: '0 0 24px rgba(6,182,212,0.45)' }}>阶段地图</h1>
        <p className="mt-1 text-sm text-slate-500">每阶段连续学习，掌握足够单词即可通关 · 悬浮阶段查看旁行榜</p>
        {stagesData.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-cyan-500/10 px-3 py-1 font-semibold text-cyan-400 ring-1 ring-cyan-500/30">
              {bankName ?? `词书 ${code}`}
            </span>
            <span className="text-slate-500">
              已解锁 <span className="font-semibold text-slate-200">{unlockedCount}/{stagesData.length}</span> 阶段 · 已掌握 <span className="font-semibold text-emerald-400">{masteredTotal}</span>/{wordTotal} 词
            </span>
          </div>
        )}
      </div>

      {hierarchical ? (
        regionsLoading ? (
          <div className="flex justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
          </div>
        ) : !regions?.length ? (
          <p className="text-center text-sm text-slate-500">无可用的阶段数据</p>
        ) : (
          <>
            <div className="mb-6 text-center text-xs text-slate-500">选择区块，进入关卡闯关</div>
            <div className="mx-auto flex max-w-md flex-col gap-3">
              {regions.map((r, i) => (
                <RegionCard key={r.id} region={r} index={i} onEnter={() => navigate(`/bank/${code}/regions/${r.id}/levels`)} />
              ))}
            </div>
          </>
        )
      ) : isLoading ? (
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
          <div className="flex flex-col items-center gap-0">
            {stages.map((s, i) => (
              <div
                key={s.id}
                className="flex w-full max-w-md flex-col items-center"
                style={{ animation: 'fadeUp .4s ease-out both', animationDelay: `${i * 70}ms` }}
              >
                {i > 0 && <div className="h-8 w-0.5 animate-pulse bg-gradient-to-b from-slate-700 to-slate-800" />}
                <StageCard
                  stage={s}
                  onBattle={() =>
                    navigate(`/battle/${code}/${s.id}`, { state: { mode: s.status === 'cleared' ? 'review' : 'learn' } })
                  }
                  onHover={() => setHoverStageId(s.id)}
                  onUnhover={() => setHoverStageId((cur) => (cur === s.id ? null : cur))}
                  onOpenBoard={() => setBoardStageId(s.id)}
                />
              </div>
            ))}
          </div>
        </>
      )}

      {hoverStageId != null && (
        <LeaderboardPreview
          stageId={hoverStageId}
          data={previewLb.data}
          loading={previewLb.isLoading}
          onClose={closePreview}
        />
      )}
      {boardStageId != null && (
        <LeaderboardModal
          stageId={boardStageId}
          data={modalLb.data}
          loading={modalLb.isLoading}
          onClose={() => setBoardStageId(null)}
        />
      )}
    </div>
  );
}

function StageCard({ stage, onBattle, onHover, onUnhover, onOpenBoard }: {
  stage: StageInfo;
  onBattle: () => void;
  onHover: () => void;
  onUnhover: () => void;
  onOpenBoard: () => void;
}) {
  const locked = stage.status === 'locked';
  const cleared = stage.status === 'cleared';
  const s =
    S[stage.status] ??
    ({ border: 'border-slate-700/40', bar: 'bg-slate-700', text: 'text-slate-500', circle: 'bg-slate-800 text-slate-600', btn: '' } as const);
  const pct = Math.min(100, Math.max(0, stage.progress));
  const label = locked ? '未解锁' : cleared ? '已通关' : '可出战';

  return (
    <div
      className={`group w-full rounded-2xl border ${s.border} bg-slate-900/70 p-5 transition-all duration-300 hover:-translate-y-0.5 hover:border-slate-500 ${locked ? 'opacity-60' : ''}`}
      onMouseEnter={onHover}
      onMouseLeave={onUnhover}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className={`relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-2xl font-bold ${s.circle}`}>
            {locked ? '🔒' : TIER[stage.tier] ?? stage.tier}
            {cleared && (
              <span className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-[11px] font-bold text-slate-950 ring-2 ring-slate-900">✓</span>
            )}
          </span>
          <div>
            <div className={`font-semibold ${s.text}`}>{TIER[stage.tier] ?? stage.tier} 级 · {label}</div>
            <div className="mt-0.5 text-xs text-slate-500">{stage.wordCount} 词</div>
            {!locked && (
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-slate-400">已遇 {stage.encountered} · 已掌握 {stage.mastered}</span>
                {cleared && stage.bestRating && (
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 tabular-nums ${RATING_STYLE[stage.bestRating] ?? RATING_STYLE.C}`}>
                    评级 {stage.bestRating}
                  </span>
                )}
                {stage.bestDays > 0 && (
                  <span className="inline-flex items-center rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-400 ring-1 ring-amber-500/30">
                    ⚔️ 最高 {stage.bestDays} 天
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
            <button onClick={onBattle} className={`rounded-lg px-5 py-2.5 text-sm font-bold transition active:scale-95 ${s.btn}`}>
              出战
            </button>
          </div>
        )}
      </div>

      {locked ? (
        <p className="mt-4 text-center text-xs text-slate-600">需前一阶段进度 ≥ 80%</p>
      ) : (
        <div className="mt-4">
          <div className="mb-1.5 flex justify-between text-xs text-slate-500">
            <span>进度</span><span className="tabular-nums">{pct}%</span>
          </div>
          <div className="relative h-3 w-full overflow-visible rounded-full bg-slate-800">
            <div className={`h-full rounded-full transition-all duration-700 ${s.bar}`} style={{ width: `${pct}%` }} />
            <div className="absolute inset-y-0 left-[80%] w-px bg-white/25" />
            <span className="absolute -bottom-1.5 left-[80%] -translate-x-1/2 text-[9px] font-medium text-slate-600">80%</span>
          </div>
        </div>
      )}
    </div>
  );
}

// 外层阶段卡（hierarchical 词书）：点击进入内层关卡地图
const REGION_THEME: Record<number, { icon: string; accent: string; glow: string; desc: string }> = {
  1: { icon: '⚔️', accent: 'text-rose-400', glow: 'shadow-[0_0_20px_rgba(244,63,94,0.15)]', desc: '高频核心词汇' },
  2: { icon: '🛡️', accent: 'text-cyan-400', glow: 'shadow-[0_0_20px_rgba(6,182,212,0.15)]', desc: '基础夯实词汇' },
  3: { icon: '💀', accent: 'text-violet-400', glow: 'shadow-[0_0_20px_rgba(139,92,246,0.15)]', desc: '超纲拓展词汇' },
};

function RegionCard({ region, index, onEnter }: {
  region: RegionInfo;
  index: number;
  onEnter: () => void;
}) {
  const theme = REGION_THEME[region.id] ?? { icon: '📚', accent: 'text-slate-300', glow: '', desc: '' };
  const locked = region.status === 'locked';
  const cleared = region.status === 'cleared';
  const pct = Math.min(100, Math.max(0, region.progress));

  return (
    <div
      className={`group relative w-full overflow-hidden rounded-2xl border transition-all duration-300 hover:-translate-y-0.5 ${
        locked
          ? 'border-slate-800 bg-slate-900/40 opacity-60'
          : cleared
            ? 'border-emerald-500/40 bg-slate-900/70 hover:border-emerald-400/60 hover:shadow-xl'
            : 'border-cyan-500/30 bg-slate-900/70 hover:border-cyan-400/60 hover:shadow-xl'
      }`}
      style={{ animation: `fadeUp .4s ease-out both`, animationDelay: `${index * 90}ms` }}
    >
      <div className="relative p-5">
        <div className="flex items-center gap-4">
          <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-slate-800 text-3xl ${theme.glow}`}>
            {locked ? '🔒' : theme.icon}
          </span>
          <div className="min-w-0 flex-1">
            <div className={`flex items-center gap-2 text-lg font-bold ${locked ? 'text-slate-500' : theme.accent}`}>
              <span>{region.name}</span>
              {cleared && <span className="text-sm">✓</span>}
            </div>
            <div className="mt-0.5 text-xs text-slate-500">{theme.desc} · {region.wordCount} 词 · {region.levelCount} 关</div>
            {!locked && (
              <div className="mt-1 text-xs text-slate-400">
                已通关 <span className="font-semibold text-emerald-400">{region.clearedLevels}</span>/{region.levelCount} 关
              </div>
            )}
          </div>
          {!locked && (
            <button
              onClick={onEnter}
              className={`rounded-xl px-4 py-2.5 text-sm font-bold transition active:scale-95 ${
                cleared
                  ? 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25'
                  : 'bg-cyan-500/15 text-cyan-400 hover:bg-cyan-500/25'
              }`}
            >
              进入 →
            </button>
          )}
        </div>
        {!locked && (
          <div className="mt-4">
            <div className="mb-1.5 flex justify-between text-xs text-slate-500">
              <span>通关进度</span><span className="tabular-nums">{pct}%</span>
            </div>
            <div className="relative h-3 w-full overflow-visible rounded-full bg-slate-800">
              <div
                className={`h-full rounded-full transition-all duration-700 ${cleared ? 'bg-gradient-to-r from-cyan-500 to-emerald-500' : 'bg-cyan-500'}`}
                style={{ width: `${pct}%` }}
              />
              <div className="absolute inset-y-0 left-[80%] w-px bg-white/25" />
              <span className="absolute -bottom-1.5 left-[80%] -translate-x-1/2 text-[9px] font-medium text-slate-600">80%</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
