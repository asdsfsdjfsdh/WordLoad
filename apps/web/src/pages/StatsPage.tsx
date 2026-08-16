import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useState, type ReactNode } from 'react';
import type { StatsHeatmapResult, StatsOverview, StatsTrendPoint } from '@word-journey/shared';
import { api } from '../lib/api';
import { Heatmap, MiniBars, MiniLine, ProgressRow } from '../components/charts';

const RANGES = [
  { v: 7, label: '7天' }, { v: 14, label: '14天' }, { v: 30, label: '30天' },
];
const WEEKS = [
  { v: 13, label: '13周' }, { v: 26, label: '26周' }, { v: 52, label: '52周' },
];
const RATING_ORDER = ['C', 'B', 'A', 'S', 'SS', 'SSS'] as const;
const TIERS = [
  { v: 'I', label: 'Ⅰ' }, { v: 'II', label: 'Ⅱ' }, { v: 'III', label: 'Ⅲ' }, { v: 'IV', label: 'Ⅳ' },
];

const HERO_THEMES = {
  cyan:    { grad: 'from-cyan-500/15 to-blue-500/10',    glow: 'shadow-[0_0_24px_rgba(6,182,212,0.12)]',    text: 'text-cyan-300',  ring: '#06b6d4' },
  emerald: { grad: 'from-emerald-500/15 to-teal-500/10',  glow: 'shadow-[0_0_24px_rgba(16,185,129,0.12)]', text: 'text-emerald-300', ring: '#10b981' },
  amber:   { grad: 'from-amber-500/15 to-orange-500/10',  glow: 'shadow-[0_0_24px_rgba(245,158,11,0.12)]', text: 'text-amber-300',  ring: '#f59e0b' },
  violet:  { grad: 'from-violet-500/15 to-purple-500/10', glow: 'shadow-[0_0_24px_rgba(139,92,246,0.12)]', text: 'text-violet-300', ring: '#8b5cf6' },
};

export function StatsPage() {
  const [range, setRange] = useState(30);
  const [weeks, setWeeks] = useState(26);

  const overviewQ = useQuery({
    queryKey: ['stats', 'overview'],
    queryFn: () => api.get<StatsOverview>('/stats/overview'),
  });
  const trendQ = useQuery({
    queryKey: ['stats', 'trend', range],
    queryFn: () => api.get<StatsTrendPoint[]>(`/stats/trend?range=${range}`),
  });
  const heatmapQ = useQuery({
    queryKey: ['stats', 'heatmap', weeks],
    queryFn: () => api.get<StatsHeatmapResult>(`/stats/heatmap?weeks=${weeks}`),
  });

  const isLoading = overviewQ.isLoading || trendQ.isLoading || heatmapQ.isLoading;
  const isError = overviewQ.isError || trendQ.isError || heatmapQ.isError;
  const s = overviewQ.data;
  const fresh = s && s.totalSessions === 0 && s.totalRuns === 0;

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
            {/* 空态引导 */}
            {fresh && (
              <div className="rounded-xl border border-cyan-500/30 bg-gradient-to-r from-cyan-500/10 to-blue-500/10 p-4 text-center">
                <p className="text-sm text-slate-300">还没有学习记录，先去打一场，数据就会出现在这里。</p>
                <Link to="/lobby" className="mt-2 inline-block rounded-full bg-cyan-500/20 px-4 py-1.5 text-sm font-semibold text-cyan-300 ring-1 ring-cyan-500/40 transition hover:bg-cyan-500/30">
                  去大厅开始
                </Link>
              </div>
            )}

            {/* 英雄区：核心指标 */}
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              <HeroCard theme="cyan" label="正确率" tooltip="逐题正确率 = 答对 / 总答题">
                <Ring pct={s.accuracy} accent={HERO_THEMES.cyan.ring}>
                  <span className="text-lg font-bold text-slate-100 tabular-nums">{s.accuracy}%</span>
                </Ring>
              </HeroCard>
              <HeroCard
                theme="amber" label="连续学习" tooltip={`当前连续 ${s.currentStreak} 天 · 历史最长 ${s.longestStreak} 天`}
                onClick={() => document.getElementById('heatmap')?.scrollIntoView({ behavior: 'smooth' })}
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">🔥</span>
                  <div>
                    <div className="text-lg font-bold text-slate-100 tabular-nums">{s.currentStreak} <span className="text-xs font-normal text-slate-400">天</span></div>
                    {s.longestStreak > 0 && <div className="text-[10px] text-slate-500">最长 {s.longestStreak} 天</div>}
                  </div>
                </div>
              </HeroCard>
              <HeroCard theme="emerald" label="已掌握" href="/collections">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">✅</span>
                  <div>
                    <div className="text-lg font-bold text-slate-100 tabular-nums">{s.masteredWords} <span className="text-xs font-normal text-slate-400">词</span></div>
                    <div className="flex gap-2 text-[10px] text-slate-500">
                      {s.wrongbookWords > 0 && <span>错题本 {s.wrongbookWords}</span>}
                      {s.skippedWords > 0 && <span>已斩 {s.skippedWords}</span>}
                    </div>
                  </div>
                </div>
              </HeroCard>
              <HeroCard theme="violet" label="累计战斗" tooltip={`胜率 = 评级 ≥ B 的场次 / 总场次，当前 ${s.winRate}%`}>
                <div className="flex items-center gap-3">
                  <span className="text-2xl">⚔️</span>
                  <div>
                    <div className="text-lg font-bold text-slate-100 tabular-nums">{s.totalSessions} <span className="text-xs font-normal text-slate-400">场</span></div>
                    {s.totalSessions > 0 && <div className="text-[10px] text-slate-500">胜率 {s.winRate}%</div>}
                  </div>
                </div>
              </HeroCard>
            </div>

            {/* 次要指标徽章行 */}
            <div className="flex flex-wrap gap-1.5">
              <BadgeCell label="学习时长" value={fmtDur(s.totalStudyMs)} />
              <BadgeCell label="累计 XP" value={s.totalXpEarned} accent="text-amber-400" />
              <BadgeCell label="累计金币" value={s.totalCoinsEarned} accent="text-amber-400" />
              <BadgeCell label="最高连击" value={s.bestMaxCombo} />
              <Link to="/lobby" className="rounded-lg border border-slate-800 bg-slate-900/50 px-2.5 py-1.5 transition hover:border-red-500/40 hover:bg-slate-800/60">
                <div className="truncate text-[10px] text-slate-500">错题本</div>
                <div className="mt-0.5 truncate text-sm font-bold tabular-nums text-red-400">{s.wrongbookWords}</div>
              </Link>
              <BadgeCell label="总答题" value={s.totalAnswered} accent="text-cyan-400" sub={s.totalAnswered ? `对 ${s.totalCorrect} / 错 ${s.totalWrong}` : undefined} />
            </div>

            {/* 生存 Run 卡 */}
            <Panel>
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-amber-400">
                  ⚔️ 生存 Run
                </span>
                {s.activeRunCount > 0 && (
                  <Link to="/lobby" className="text-[11px] font-medium text-cyan-400 hover:underline">有进行中的 Run → 继续</Link>
                )}
              </div>
              <div className="grid grid-cols-3 gap-1.5 text-center">
                {[
                  { label: '累计 Run', value: s.totalRuns, cls: 'text-slate-100' },
                  { label: '最高生存', value: s.bestRunDays > 0 ? `${s.bestRunDays} 天` : '—', cls: 'text-amber-400' },
                  { label: '击破 Boss', value: s.totalBossCleared, cls: 'text-red-400' },
                ].map((c) => (
                  <div key={c.label} className="rounded-lg border border-amber-500/20 bg-amber-500/5 py-2">
                    <div className="text-base font-bold tabular-nums">{c.value}</div>
                    <div className={`mt-0.5 text-[10px] ${c.cls}`}>{c.label}</div>
                  </div>
                ))}
              </div>
            </Panel>

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
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div className="rounded-lg border border-slate-800/70 bg-slate-900/30 p-2.5">
                  <div className="mb-1.5 text-[10px] text-slate-500">每日答题</div>
                  <MiniBars data={trendPoints(trendQ.data).map((p) => ({
                    label: md(p.date), value: p.answered, title: `${p.date} 答题 ${p.answered} / 新学 ${p.newWords}`,
                  }))} color="#22d3ee" height={64} labelEvery={Math.max(1, Math.ceil((trendQ.data?.length ?? range) / 6))} />
                </div>
                <div className="rounded-lg border border-slate-800/70 bg-slate-900/30 p-2.5">
                  <div className="mb-1.5 text-[10px] text-slate-500">每日正确率</div>
                  <MiniLine data={trendPoints(trendQ.data).map((p) => ({ label: md(p.date), value: p.accuracy }))} color="#34d399" max={100} height={64} suffix="%" />
                </div>
                <div className="rounded-lg border border-slate-800/70 bg-slate-900/30 p-2.5">
                  <div className="mb-1.5 text-[10px] text-slate-500">每日新学</div>
                  <MiniBars data={trendPoints(trendQ.data).map((p) => ({
                    label: md(p.date), value: p.newWords, title: `${p.date} 新学 ${p.newWords} 词`,
                  }))} color="#a78bfa" height={64} labelEvery={Math.max(1, Math.ceil((trendQ.data?.length ?? range) / 6))} />
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
                <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-slate-400">各等级掌握率</div>
                <div className="space-y-2">
                  {TIERS.map((t) => {
                    const ts = s.tierStats.find((x) => x.tier === t.v);
                    return (
                      <ProgressRow
                        key={t.v}
                        label={t.label}
                        value={ts?.mastered ?? 0}
                        max={ts?.total ?? 0}
                        color="#10b981"
                        title={`${t.v} 级：掌握 ${ts?.mastered ?? 0} / 已遇 ${ts?.encountered ?? 0} / 共 ${ts?.total ?? 0}`}
                      />
                    );
                  })}
                </div>
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
              <div id="heatmap" className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">活跃热力图 · 近 {weeks} 周</span>
                <div className="flex gap-1">
                  {WEEKS.map((r) => (
                    <button key={r.v} onClick={() => setWeeks(r.v)}
                      className={`rounded-full px-2.5 py-0.5 text-[11px] transition ${
                        weeks === r.v ? 'bg-cyan-500/20 text-cyan-400 ring-1 ring-cyan-500/30' : 'bg-slate-800/60 text-slate-400 hover:text-slate-300'
                      }`}>
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="text-right text-[10px] text-slate-600">按当日答题数着色</div>
              {heatmapQ.data ? <Heatmap cells={heatmapQ.data.cells} /> : <p className="text-xs text-slate-500">暂无数据</p>}
            </Panel>
          </div>
        )}
      </div>
    </div>
  );
}

function Ring({ pct, accent, children }: { pct: number; accent: string; children: ReactNode }) {
  const r = 24;
  const c = 2 * Math.PI * r;
  const off = c - (pct / 100) * c;
  return (
    <div className="relative flex h-16 w-16 items-center justify-center">
      <svg viewBox="0 0 60 60" className="h-16 w-16 -rotate-90">
        <circle cx="30" cy="30" r={r} fill="none" stroke="rgb(30,41,59)" strokeWidth="4.5" />
        <circle cx="30" cy="30" r={r} fill="none" stroke={accent} strokeWidth="4.5" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} className="transition-all duration-700" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}

function HeroCard({ theme, label, tooltip, href, onClick, children }: {
  theme: keyof typeof HERO_THEMES;
  label: string;
  tooltip?: string;
  href?: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  const t = HERO_THEMES[theme];
  const inner = (
    <div className={`relative h-full overflow-hidden rounded-xl border border-slate-800 bg-gradient-to-br ${t.grad} p-3 ${t.glow} transition-all duration-300 hover:-translate-y-0.5 hover:border-slate-600 ${href || onClick ? 'cursor-pointer' : ''}`}>
      <div className="flex items-center justify-between">
        {children}
        <span className={`text-[10px] font-medium text-slate-500 ${t.text}`}>{label}</span>
      </div>
    </div>
  );
  if (href) {
    return <Link to={href} title={tooltip}>{inner}</Link>;
  }
  if (onClick) {
    return (
      <button onClick={onClick} title={tooltip} className="text-left">{inner}</button>
    );
  }
  return <div title={tooltip}>{inner}</div>;
}

function BadgeCell({ label, value, sub, accent }: { label: string; value: ReactNode; sub?: ReactNode; accent?: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/50 px-2.5 py-1.5">
      <div className="truncate text-[10px] text-slate-500">{label}</div>
      <div className={`mt-0.5 truncate text-sm font-bold tabular-nums ${accent ?? 'text-slate-100'}`}>{value}</div>
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
