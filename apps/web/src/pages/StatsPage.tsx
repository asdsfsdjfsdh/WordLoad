import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useState, type ReactNode } from 'react';
import type { StatsHeatmapResult, StatsOverview, StatsTrendPoint } from '@word-journey/shared';
import { api } from '../lib/api';
import { Heatmap, MiniBars, MiniLine } from '../components/charts';

const RANGES = [
  { v: 7, label: '7天' }, { v: 14, label: '14天' }, { v: 30, label: '30天' },
];
const RATING_ORDER = ['C', 'B', 'A', 'S', 'SS', 'SSS'] as const;
const TIERS = [
  { v: 'I', label: 'Ⅰ' }, { v: 'II', label: 'Ⅱ' }, { v: 'III', label: 'Ⅲ' }, { v: 'IV', label: 'Ⅳ' },
];

export function StatsPage() {
  const [range, setRange] = useState(30);

  const overviewQ = useQuery({
    queryKey: ['stats', 'overview'],
    queryFn: () => api.get<StatsOverview>('/stats/overview'),
  });
  const trendQ = useQuery({
    queryKey: ['stats', 'trend', range],
    queryFn: () => api.get<StatsTrendPoint[]>(`/stats/trend?range=${range}`),
  });
  const heatmapQ = useQuery({
    queryKey: ['stats', 'heatmap'],
    queryFn: () => api.get<StatsHeatmapResult>('/stats/heatmap'),
  });

  const isLoading = overviewQ.isLoading || trendQ.isLoading || heatmapQ.isLoading;
  const isError = overviewQ.isError || trendQ.isError || heatmapQ.isError;
  const s = overviewQ.data;

  return (
    <div className="min-h-screen bg-slate-950">
      {/* Top bar */}
      <div className="sticky top-0 z-20 border-b border-slate-800 bg-slate-950/95 px-4 py-3 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to="/lobby" className="text-sm text-slate-400 hover:text-cyan-400">← 大厅</Link>
            <h1 className="text-lg font-bold text-cyan-400" style={{ textShadow: '0 0 12px rgba(6,182,212,0.4)' }}>
              学习统计
            </h1>
            {s && <span className="text-xs text-slate-500">累计战斗 {s.totalSessions} 场 · 正确率 {s.accuracy}%</span>}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
          </div>
        ) : isError || !s ? (
          <div className="rounded-xl border border-red-800 bg-red-950/30 p-4 text-center">
            <p className="text-sm text-red-400">加载失败</p>
            <button onClick={() => { overviewQ.refetch(); trendQ.refetch(); heatmapQ.refetch(); }} className="mt-2 text-sm text-cyan-400 hover:underline">重试</button>
          </div>
        ) : (
          <div className="space-y-3">
            {/* 总览数字格 */}
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
              <StatCell label="累计战斗" value={s.totalSessions} />
              <StatCell label="胜率" value={`${s.winRate}%`} accent="text-emerald-400" />
              <StatCell label="学习时长" value={fmtDur(s.totalStudyMs)} />
              <StatCell label="累计 XP" value={s.totalXpEarned} accent="text-amber-400" />
              <StatCell label="累计金币" value={s.totalCoinsEarned} accent="text-amber-400" />
              <StatCell label="正确率" value={`${s.accuracy}%`} accent="text-cyan-400" />
              <StatCell label="最高连击" value={s.bestMaxCombo} />
              <StatCell label="连续学习" value={`${s.currentStreak} 天`} sub={s.longestStreak ? `最长 ${s.longestStreak} 天` : undefined} accent="text-cyan-400" />
              <StatCell label="已掌握" value={s.masteredWords} accent="text-emerald-400" />
              <StatCell label="错题本" value={s.wrongbookWords} accent="text-red-400" />
              <StatCell label="Boss 战" value={s.bossFights} sub={s.bossWins ? `击破 ${s.bossWins}` : undefined} />
              <StatCell label="总答题" value={s.totalAnswered} sub={s.totalAnswered ? `对 ${s.totalCorrect} / 错 ${s.totalWrong}` : undefined} />
            </div>

            {/* 趋势图表 */}
            <Panel>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">近 {range} 天趋势</span>
                <div className="flex gap-1">
                  {RANGES.map((r) => (
                    <button key={r.v} onClick={() => setRange(r.v)}
                      className={`rounded-full px-2.5 py-0.5 text-[11px] transition ${
                        range === r.v ? 'bg-cyan-500/20 text-cyan-400 ring-1 ring-cyan-500/30' : 'bg-slate-800/60 text-slate-400 hover:text-slate-300'
                      }`}>
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-slate-800/70 bg-slate-900/30 p-2.5">
                  <div className="mb-1.5 text-[10px] text-slate-500">每日答题</div>
                  <MiniBars data={trendPoints(trendQ.data).map((p) => ({
                    label: md(p.date), value: p.answered, title: `${p.date} 答题 ${p.answered} / 新学 ${p.newWords}`,
                  }))} color="#22d3ee" height={64} labelEvery={Math.max(1, Math.ceil((trendQ.data?.length ?? range) / 6))} />
                </div>
                <div className="rounded-lg border border-slate-800/70 bg-slate-900/30 p-2.5">
                  <div className="mb-1.5 text-[10px] text-slate-500">每日正确率</div>
                  <MiniLine data={trendPoints(trendQ.data).map((p) => ({ label: md(p.date), value: p.accuracy }))} color="#34d399" max={100} height={64} />
                </div>
              </div>
            </Panel>

            {/* 评级 / Tier / Boss */}
            <div className="grid gap-3 lg:grid-cols-3">
              <Panel>
                <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-slate-400">评级分布</div>
                <MiniBars
                  data={RATING_ORDER.map((r) => ({ label: r, value: s.ratingCounts[r], title: `${r} 级：${s.ratingCounts[r]} 场` }))}
                  color="#f59e0b" height={56} labelEvery={1}
                />
              </Panel>
              <Panel>
                <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-slate-400">各等级掌握</div>
                <MiniBars
                  data={TIERS.map((t) => {
                    const ts = s.tierStats.find((x) => x.tier === t.v);
                    return { label: t.label, value: ts?.mastered ?? 0, title: `${t.v} 级：掌握 ${ts?.mastered ?? 0} / 已遇 ${ts?.encountered ?? 0} / 共 ${ts?.total ?? 0}` };
                  })}
                  color="#10b981" height={56} labelEvery={1}
                />
              </Panel>
              <Panel>
                <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-slate-400">Boss 战况</div>
                <div className="grid grid-cols-3 gap-1.5 text-center">
                  {[
                    { label: '出战', value: s.bossFights, cls: 'text-cyan-400' },
                    { label: '击破', value: s.bossWins, cls: 'text-emerald-400' },
                    { label: '击破率', value: s.bossFights ? `${Math.round((s.bossWins / s.bossFights) * 100)}%` : '—', cls: 'text-amber-400' },
                  ].map((c) => (
                    <div key={c.label} className="rounded-lg border border-slate-800/70 bg-slate-900/30 py-2">
                      <div className="text-base font-bold tabular-nums text-slate-100">{c.value}</div>
                      <div className={`mt-0.5 text-[10px] ${c.cls}`}>{c.label}</div>
                    </div>
                  ))}
                </div>
              </Panel>
            </div>

            {/* 热力图 */}
            <Panel>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">活跃热力图 · 近 {heatmapQ.data?.weeks ?? 26} 周</span>
                <span className="text-[10px] text-slate-600">按当日答题数着色</span>
              </div>
              {heatmapQ.data ? <Heatmap cells={heatmapQ.data.cells} /> : <p className="text-xs text-slate-500">暂无数据</p>}
            </Panel>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCell({ label, value, sub, accent }: { label: string; value: ReactNode; sub?: ReactNode; accent?: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/50 px-2.5 py-2">
      <div className="truncate text-[10px] text-slate-500">{label}</div>
      <div className={`mt-0.5 truncate text-base font-bold tabular-nums ${accent ?? 'text-slate-100'}`}>{value}</div>
      {sub != null && <div className="mt-0.5 truncate text-[9px] text-slate-600">{sub}</div>}
    </div>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">{children}</div>;
}

function trendPoints(data?: StatsTrendPoint[]): StatsTrendPoint[] {
  return data ?? [];
}

function md(date: string): string {
  const [, m, d] = date.split('-');
  return `${Number(m)}/${Number(d)}`;
}

function fmtDur(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h > 0 && m % 60 > 0 ? `${h}h${m % 60}m` : `${h}h`;
}