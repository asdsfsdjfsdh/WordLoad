import { useQuery, useMutation } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import type { CollectedWord, CollectionStats, SrsTrajectory } from '@word-journey/shared';
import { nextReviewLabel, srsStageMeta } from '@word-journey/shared';
import { api } from '../lib/api';
import { getTts } from '../lib/tts';
import { playSkipSound } from '../lib/sfx';
import { MiniBars } from '../components/charts';

const TIERS = [
  { v: '', label: '全部' }, { v: 'I', label: 'Ⅰ基础' }, { v: 'II', label: 'Ⅱ核心' },
  { v: 'III', label: 'Ⅲ拔高' }, { v: 'IV', label: 'Ⅳ超纲' },
];
const STATUSES = [
  { v: '', label: '全部' }, { v: 'new', label: '新遇' },
  { v: 'learning', label: '学习中' }, { v: 'due', label: '待复习' },
  { v: 'mastered', label: '已掌握' }, { v: 'wrongbook', label: '错题本' },
  // 易错 = 累计答错≥3 且未掌握（累计弱点口径，与"错题本"当前状态解耦；摘标词仍在易错里）
  { v: 'weak', label: '易错(累计)' }, { v: 'vocabbook', label: '生词本' },
  { v: 'skipped', label: '已斩' },
];
const SORTS = [
  { v: 'firstEncounteredAt', label: '初见时间' },
  { v: 'stage', label: '记忆深度' },
  { v: 'weakest', label: '最易错' },
];
// 记忆深度分布（与 stats.stageHistogram 对齐；5 为 5+ 汇总档）
const STAGE_LABELS = ['新词', 'L1', 'L2', 'L3', 'L4', '5+'];
const STAGE_COLOR = '#22d3ee';
const PAGE_SIZE = 50;

// SRS 档位 → 卡片边框/徽章色（字面量类名，确保 Tailwind 命中）
const TONE = {
  sky: { cls: 'border-l-sky-500 bg-sky-500/10', badge: 'bg-sky-500/20 text-sky-300' },
  amber: { cls: 'border-l-amber-500 bg-amber-500/10', badge: 'bg-amber-500/20 text-amber-300' },
  cyan: { cls: 'border-l-cyan-500 bg-cyan-500/10', badge: 'bg-cyan-500/20 text-cyan-300' },
  emerald: { cls: 'border-l-emerald-500 bg-emerald-500/10', badge: 'bg-emerald-500/20 text-emerald-300' },
  violet: { cls: 'border-l-violet-500 bg-violet-500/10', badge: 'bg-violet-500/20 text-violet-300' },
} as const;

function statusMeta(w: CollectedWord) {
  if (w.skipped) return { label: '已斩', icon: '⚔️', cls: 'border-l-zinc-500 bg-zinc-500/10', badge: 'bg-zinc-500/20 text-zinc-300' };
  if (w.inWrongBook) return { label: '错题', icon: '📕', cls: 'border-l-red-500 bg-red-500/10', badge: 'bg-red-500/20 text-red-300' };
  const meta = srsStageMeta(w.reviewStage);
  return { label: meta.label, icon: meta.icon, ...TONE[meta.tone] };
}

function tierCls(t: string) {
  if (t === 'I') return 'bg-cyan-500/15 text-cyan-400';
  if (t === 'II') return 'bg-emerald-500/15 text-emerald-400';
  if (t === 'III') return 'bg-amber-500/15 text-amber-400';
  if (t === 'IV') return 'bg-rose-500/15 text-rose-400';
  return 'bg-slate-600/30 text-slate-400';
}

// 记忆强度（ease）→ 人话
function easeLabel(ease: number): string {
  if (ease >= 2.5) return '稳定';
  if (ease >= 1.8) return '正常';
  return '吃力';
}

// 下次复习倒计时：24h 内显示精确时分，否则回退到日期标签
function reviewCountdown(nextReviewAt: string | null, now: number = Date.now()): string | null {
  if (!nextReviewAt) return null;
  const t = new Date(nextReviewAt).getTime();
  const ms = t - now;
  if (ms <= 0) return '已到期';
  if (ms < 86400000) {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return `${h}小时${m}分`;
  }
  return null;
}

export function CollectionsPage() {
  const navigate = useNavigate();
  const [tier, setTier] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('firstEncounteredAt');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedWordId, setSelectedWordId] = useState<string | null>(null);
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const statsQuery = useQuery({
    queryKey: ['collections', 'stats'],
    queryFn: () => api.get<CollectionStats>('/collections/stats'),
  });

  const wordsQuery = useQuery({
    queryKey: ['collections', 'words', tier, status, sort, debouncedSearch, page],
    queryFn: () => {
      const params = new URLSearchParams();
      if (tier) params.set('tier', tier);
      if (status) params.set('status', status);
      params.set('sort', sort);
      if (debouncedSearch) params.set('search', debouncedSearch);
      params.set('page', String(page));
      params.set('pageSize', String(PAGE_SIZE));
      return api.get<{ words: CollectedWord[]; total: number; page: number; pageSize: number }>(
        `/collections/words?${params.toString()}`,
      );
    },
  });

  const trajectoryQuery = useQuery({
    queryKey: ['collections', 'srs', selectedWordId],
    queryFn: () => api.get<SrsTrajectory>(`/collections/words/${selectedWordId}/srs`),
    enabled: !!selectedWordId,
  });

  // 斩：标记已掌握（永久不再出题），带防连点
  const [skipping, setSkipping] = useState<Set<string>>(new Set());
  const handleSkip = async (wordId: string) => {
    if (skipping.has(wordId)) return;
    playSkipSound();
    setSkipping((prev) => new Set(prev).add(wordId));
    try {
      await api.post<{ ok: boolean }>(`/questions/words/${wordId}/skip`, {});
      wordsQuery.refetch();
      statsQuery.refetch();
    } catch {
      /* 静默忽略失败，下次可重试 */
    } finally {
      setSkipping((prev) => {
        const next = new Set(prev);
        next.delete(wordId);
        return next;
      });
    }
  };

  // 反斩：重置为未学状态
  const unskip = useMutation({
    mutationFn: async (wordId: string) => {
      await api.post<{ ok: boolean }>(`/questions/words/${wordId}/unskip`, {});
    },
    onSuccess: () => {
      wordsQuery.refetch();
      statsQuery.refetch();
      if (selectedWordId) trajectoryQuery.refetch();
    },
  });

  const stats = statsQuery.data;
  const { words, total } = wordsQuery.data ?? {};
  const totalPages = total ? Math.ceil(total / PAGE_SIZE) : 0;

  // 复习 CTA：仅在行动导向筛选下出现；统一走 /words/ids 按当前筛选拉取（shuffle=1 随机抽取，
  // 不受分页 50 限制、可跨词书；weak=全部易错，其余=随机 50 词）
  const reviewable =
    status === 'due' || status === 'wrongbook' || status === 'weak' || status === 'learning' || status === 'vocabbook';
  const reviewBank = words?.find((w) => w.bankCode)?.bankCode;
  // total 为当前筛选全量匹配数（wordsQuery 未加载时为 0，按钮不显示）
  const reviewCount = status === 'weak' ? (stats?.weak ?? 0) : (total != null ? Math.min(total, 50) : 0);
  const [reviewIdsLoading, setReviewIdsLoading] = useState(false);

  const handleReviewClick = async () => {
    setReviewIdsLoading(true);
    try {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (tier) params.set('tier', tier);
      if (debouncedSearch) params.set('search', debouncedSearch);
      // 易错=全部（上限 60）；其余=随机抽取最多 50 个
      params.set('limit', String(status === 'weak' ? 60 : Math.min(total ?? 50, 50)));
      params.set('shuffle', '1');
      const res = await api.get<{ wordIds: string[]; bankCode?: string }>(
        `/collections/words/ids?${params.toString()}`,
      );
      if (!res.wordIds.length) return;
      const bank = res.bankCode ?? reviewBank;
      // 词可能来自多本词书（复习战后端已放宽为全局复习）；全无词书归属时无法创建复习会话
      if (!bank) {
        alert('复习词均未归属任何词书，无法创建复习战');
        return;
      }
      navigate(`/battle/${bank}/0`, {
        state: { mode: 'review', wordIds: res.wordIds, size: Math.min(60, Math.max(10, res.wordIds.length)) },
      });
    } finally {
      setReviewIdsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950">
      {/* Top bar */}
      <div className="sticky top-0 z-20 border-b border-slate-800 bg-slate-950/95 px-6 py-4 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to="/lobby" className="text-sm text-slate-400 hover:text-cyan-400">
              ← 大厅
            </Link>
            <h1 className="text-xl font-bold text-cyan-400" style={{ textShadow: '0 0 12px rgba(6,182,212,0.4)' }}>
              单词图鉴
            </h1>
            {stats && (
              <span className="text-xs text-slate-500">
                {stats.encountered}/{stats.totalWords} · 掌握{stats.mastered}
                {stats.dueToday > 0 && <span className="ml-1 text-amber-400">· 待复习{stats.dueToday}</span>}
                {stats.weak > 0 && <span className="ml-1 text-orange-400">· 易错{stats.weak}</span>}
                {stats.masteredToday > 0 && <span className="ml-1 text-emerald-400">· 今日掌握{stats.masteredToday}</span>}
                {stats.skipped > 0 && <span className="ml-1 text-slate-500">· 已斩{stats.skipped}</span>}
              </span>
            )}
          </div>
          <button
            onClick={() => setCompact(!compact)}
            className={`rounded-lg border px-3 py-1.5 text-xs transition ${
              compact ? 'border-cyan-500/50 bg-cyan-950/30 text-cyan-400' : 'border-slate-700 text-slate-400 hover:text-slate-300'
            }`}
          >
            {compact ? '📋 列表' : '🃏 卡片'}
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6 py-6">
        {/* Progress bar */}
        {stats && (
          <div className="mb-6 rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-400">
                收集进度{' '}
                <span className="font-bold text-cyan-400">{stats.encountered}</span>
                <span className="text-slate-500"> / {stats.totalWords}</span>
                <span className="ml-2 text-xs text-slate-600">
                  ({stats.totalWords ? Math.round((stats.encountered / stats.totalWords) * 100) : 0}%)
                </span>
              </span>
              <span className="text-slate-400">
                已掌握 <span className="font-bold text-emerald-400">{stats.mastered}</span>
                {stats.dueToday > 0 && (
                  <span className="ml-3">
                    待复习 <span className="font-bold text-amber-400">{stats.dueToday}</span>
                  </span>
                )}
                {stats.weak > 0 && (
                  <span className="ml-3">
                    易错 <span className="font-bold text-orange-400">{stats.weak}</span>
                  </span>
                )}
                {stats.masteredToday > 0 && (
                  <span className="ml-3 text-slate-500">
                    今日新掌握 <span className="font-bold text-emerald-400">{stats.masteredToday}</span>
                  </span>
                )}
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
              <div className="flex h-full">
                <div className="bg-emerald-500 h-full" style={{ width: `${stats.totalWords ? (stats.mastered / stats.totalWords) * 100 : 0}%` }} />
                <div className="bg-cyan-500/60 h-full" style={{ width: `${stats.totalWords ? ((stats.encountered - stats.mastered) / stats.totalWords) * 100 : 0}%` }} />
              </div>
            </div>
            <div className="mt-2 flex gap-4 text-[10px] text-slate-500">
              {stats.byTier.map((t) => (
                <span key={t.tier}>
                  {t.tier}级 {t.encountered}/{t.total}
                </span>
              ))}
            </div>
            {/* 记忆深度分布（SRS 档位直方图） */}
            {stats.stageHistogram.length > 0 && (
              <div className="mt-4 border-t border-slate-800/70 pt-3">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-slate-500">记忆深度分布</span>
                  <span className="text-[10px] text-slate-600">档位越高越牢固</span>
                </div>
                <MiniBars
                  data={stats.stageHistogram.map((h) => ({
                    label: STAGE_LABELS[h.stage] ?? String(h.stage),
                    value: h.count,
                  }))}
                  color={STAGE_COLOR}
                  height={48}
                  labelEvery={2}
                />
              </div>
            )}
          </div>
        )}

        {/* Filters */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {TIERS.map((t) => (
            <button key={t.v} onClick={() => { setTier(t.v); setPage(1); }}
              className={`rounded-full px-3 py-1 text-xs transition ${
                tier === t.v ? 'bg-cyan-500/20 text-cyan-400 ring-1 ring-cyan-500/30' : 'bg-slate-800/60 text-slate-400 hover:bg-slate-800 hover:text-slate-300'
              }`}>
              {t.label}
            </button>
          ))}
          <span className="mx-1 text-slate-700">|</span>
          {STATUSES.map((s) => {
            const count =
              s.v === '' ? (stats?.encountered ?? 0) :
              s.v === 'new' ? (stats?.newToday ?? 0) :
              s.v === 'learning' ? (stats?.learning ?? 0) :
              s.v === 'due' ? (stats?.dueToday ?? 0) :
              s.v === 'mastered' ? (stats?.mastered ?? 0) :
              s.v === 'wrongbook' ? (stats?.wrongbook ?? 0) :
              s.v === 'weak' ? (stats?.weak ?? 0) :
              s.v === 'vocabbook' ? (stats?.vocabbook ?? 0) :
              s.v === 'skipped' ? (stats?.skipped ?? 0) : null;
            return (
              <button key={s.v} onClick={() => { setStatus(s.v); setPage(1); }}
                className={`rounded-full px-3 py-1 text-xs transition ${
                  status === s.v ? 'bg-cyan-500/20 text-cyan-400 ring-1 ring-cyan-500/30' : 'bg-slate-800/60 text-slate-400 hover:bg-slate-800 hover:text-slate-300'
                }`}>
                {s.label}
                {count != null && (
                  <span className="ml-1.5 rounded-full bg-slate-700/60 px-1.5 text-[10px] tabular-nums">{count}</span>
                )}
              </button>
            );
          })}
          <div className="ml-auto flex items-center gap-2">
            {reviewable && reviewCount > 0 && (reviewBank || status === 'weak') && (
              <button
                onClick={handleReviewClick}
                disabled={reviewIdsLoading}
                title={status === 'weak' ? '一次拉取全部易错（累计答错≥3）词开复习战，不受分页限制、可跨词书' : '从当前筛选中随机抽取（每次点击不同）最多 50 词开复习战，不受分页限制、可跨词书'}
                className="rounded-full border border-emerald-700/60 bg-emerald-950/40 px-3 py-1.5 text-xs font-medium text-emerald-300 transition hover:bg-emerald-900/40 hover:text-emerald-200 disabled:opacity-50"
              >
                {status === 'weak'
                  ? (reviewIdsLoading ? '加载中…' : `🎯 复习全部易错 ${stats?.weak ?? 0} 词`)
                  : (reviewIdsLoading ? '加载中…' : `🎯 随机复习 ${reviewCount} 词`)}
              </button>
            )}
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="单词/释义…"
              className="w-24 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 outline-none focus:w-40 focus:border-cyan-500 transition-all"
            />
            <select value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}
              className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-200 outline-none">
              {SORTS.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
            </select>
          </div>
        </div>

        {/* Content */}
        {wordsQuery.isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
          </div>
        ) : wordsQuery.isError ? (
          <div className="rounded-xl border border-red-800 bg-red-950/30 p-4 text-center">
            <p className="text-sm text-red-400">{wordsQuery.error instanceof Error ? wordsQuery.error.message : '加载失败'}</p>
            <button onClick={() => wordsQuery.refetch()} className="mt-2 text-sm text-cyan-400 hover:underline">重试</button>
          </div>
        ) : !words?.length ? (
          <div className="py-20 text-center text-slate-500">
            <div className="mb-2 text-4xl">📭</div>
            {debouncedSearch || tier || status ? (
              <>
                <p>无匹配结果</p>
                <p className="mt-1 text-xs text-slate-600">试试换个关键词，或清除筛选条件</p>
              </>
            ) : (
              <p>暂无单词记录，去战斗吧！</p>
            )}
          </div>
        ) : compact ? (
          /* Compact list view */
          <div className="overflow-hidden rounded-2xl border border-slate-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-900/80 text-left text-xs text-slate-500">
                  <th className="py-3 pl-4 pr-2 font-medium">单词</th>
                  <th className="px-2 py-3 font-medium">音标</th>
                  <th className="px-2 py-3 font-medium">等级</th>
                  <th className="px-2 py-3 font-medium">档位</th>
                  <th className="px-2 py-3 font-medium">下次复习</th>
                  <th className="px-2 py-3 font-medium">初见</th>
                  <th className="pr-4 py-3 font-medium">释义</th>
                  <th className="pr-4 py-3 font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {words.map((w) => {
                  const m = statusMeta(w);
                  return (
                    <tr key={w.wordId} onClick={() => setSelectedWordId(w.wordId)}
                      className="cursor-pointer transition-colors hover:bg-slate-800/50">
                      <td className="py-2.5 pl-4 pr-2 font-semibold text-slate-100">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate">{w.text}</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); getTts().speak(w.text); }}
                            title="发音"
                            className="shrink-0 rounded border border-slate-700 px-1 py-0.5 text-[10px] text-slate-300 transition-colors hover:border-cyan-500/50 hover:text-cyan-300"
                          >
                            🔊
                          </button>
                        </div>
                      </td>
                      <td className="px-2 py-2.5 text-xs text-slate-500">{w.phonetic ?? '-'}</td>
                      <td className="px-2 py-2.5"><span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${tierCls(w.tier)}`}>{w.tier}</span></td>
                      <td className="px-2 py-2.5"><span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${m.badge}`}>{m.icon} {m.label}</span></td>
                      <td className="px-2 py-2.5 text-xs text-slate-400">
                        {w.skipped ? '-' : nextReviewLabel(w.nextReviewAt)}
                      </td>
                      <td className="px-2 py-2.5 text-xs text-slate-500">
                        {w.firstEncounteredAt ? new Date(w.firstEncounteredAt).toLocaleDateString('zh-CN') : '-'}
                      </td>
                      <td className="py-2.5 pr-4 text-xs text-slate-400 truncate max-w-[120px]">
                        {w.meanings?.[0]?.meaning ?? ''}
                        {w.mnemonic && (
                          <span className="block truncate text-[10px] text-emerald-400/80">💡 {w.mnemonic}</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-4 text-right">
                        {!w.skipped && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSkip(w.wordId);
                            }}
                            disabled={skipping.has(w.wordId)}
                            title={w.mastery >= 100 ? '永久不再出题' : '标记已掌握'}
                            className={`rounded-lg border px-2 py-0.5 text-xs font-medium transition-colors ${
                              skipping.has(w.wordId)
                                ? 'cursor-wait border-slate-700 text-slate-500'
                                : w.mastery >= 100
                                  ? 'border-zinc-700 bg-zinc-950/40 text-zinc-400 hover:bg-zinc-500/20 hover:text-zinc-300'
                                  : 'border-emerald-800 bg-emerald-950/40 text-emerald-400 hover:bg-emerald-500/20'
                            }`}
                          >
                            {skipping.has(w.wordId) ? '…' : '斩'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          /* Card view */
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {words.map((w) => {
              const m = statusMeta(w);
              return (
                <div
                  key={w.wordId}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedWordId(w.wordId)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedWordId(w.wordId);
                    }
                  }}
                  className={`cursor-pointer rounded-2xl border border-l-4 border-r-slate-800 border-t-slate-800 border-b-slate-800 ${m.cls} p-4 text-left transition-all hover:-translate-y-0.5 hover:border-r-slate-700 hover:border-t-slate-700 hover:border-b-slate-700 hover:shadow-lg`}>
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-base font-bold text-slate-100 truncate">{w.text}</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); getTts().speak(w.text); }}
                          title="发音"
                          className="shrink-0 rounded-lg border border-slate-700 px-1.5 py-0.5 text-xs text-slate-300 transition-colors hover:border-cyan-500/50 hover:text-cyan-300"
                        >
                          🔊
                        </button>
                        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${tierCls(w.tier)}`}>{w.tier}</span>
                      </div>
                      {w.phonetic && <p className="mt-0.5 text-xs text-slate-500 truncate">{w.phonetic}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {!w.skipped && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSkip(w.wordId);
                          }}
                          disabled={skipping.has(w.wordId)}
                          title={w.mastery >= 100 ? '永久不再出题' : '标记已掌握'}
                          className={`rounded-lg border px-2 py-0.5 text-xs font-medium transition-colors ${
                            skipping.has(w.wordId)
                              ? 'cursor-wait border-slate-700 text-slate-500'
                              : w.mastery >= 100
                                ? 'border-zinc-700 bg-zinc-950/40 text-zinc-400 hover:bg-zinc-500/20 hover:text-zinc-300'
                                : 'border-emerald-800 bg-emerald-950/40 text-emerald-400 hover:bg-emerald-500/20'
                          }`}
                        >
                          {skipping.has(w.wordId) ? '…' : '斩'}
                        </button>
                      )}
                      <span className="text-lg">{m.icon}</span>
                    </div>
                  </div>
                  {/* SRS 档位 + 下次复习 */}
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${m.badge}`}>{m.label}</span>
                    <span className="text-[11px] text-slate-400">
                      {w.skipped
                        ? <span className="text-zinc-500">已斩 · 永不再考</span>
                        : <><span className="text-slate-600">下次</span> <span className={w.nextReviewAt && new Date(w.nextReviewAt).getTime() <= Date.now() ? 'font-bold text-amber-400' : 'text-slate-300'}>{nextReviewLabel(w.nextReviewAt)}</span></>}
                    </span>
                  </div>
                  {/* 掌握度进度条 */}
                  <div className="mt-2 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
                      <div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-500 transition-all"
                        style={{ width: `${Math.max(4, w.mastery)}%` }} />
                    </div>
                    <span className="w-8 text-right text-[10px] font-medium text-slate-500 tabular-nums">{w.mastery}%</span>
                  </div>
                  {/* Stats row */}
                  <div className="mt-2 flex items-center gap-3 text-[11px]">
                    <span className="text-slate-500">记忆{easeLabel(w.ease)}</span>
                    {w.firstEncounteredAt && (
                      <span className="text-slate-600">初见 {new Date(w.firstEncounteredAt).toLocaleDateString('zh-CN')}</span>
                    )}
                  </div>
                  <p className="mt-2 text-xs text-slate-400 line-clamp-2">
                    {w.meanings?.map((m, i) => (
                      <span key={i}>{m.meaning}{i < w.meanings.length - 1 ? '；' : ''}</span>
                    ))}
                  </p>
                  {/* 记忆锚点 */}
                  {w.mnemonic && (
                    <p className="mt-2 rounded-lg border border-emerald-800/50 bg-emerald-950/30 px-2.5 py-1.5 text-xs text-emerald-300/90">
                      💡 {w.mnemonic}
                    </p>
                  )}
                  {/* 易混词区块 */}
                  {w.confusables.length > 0 && (
                    <div className="mt-3 border-t border-slate-800/70 pt-2">
                      <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500">易混词</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {w.confusables.slice(0, 4).map((c, i) => (
                          <span
                            key={i}
                            title={c.note}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (c.wordId) setSelectedWordId(c.wordId);
                            }}
                            className={`rounded-full border border-amber-700/50 bg-amber-950/30 px-1.5 py-0.5 text-[10px] text-amber-300 ${
                              c.wordId ? 'cursor-pointer transition hover:border-amber-500 hover:bg-amber-900/40' : ''
                            }`}
                          >
                            {c.counterpart}{c.note && ` · ${c.note}`}
                          </span>
                        ))}
                        {w.confusables.length > 4 && (
                          <span className="text-[10px] text-slate-500">+{w.confusables.length - 4}</span>
                        )}
                      </div>
                    </div>
                  )}
                  {/* 例句区块 */}
                  {w.examples.length > 0 && (
                    <div className="mt-3 border-t border-slate-800/70 pt-2">
                      <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500">例句</div>
                      <div className="mt-1 space-y-0.5">
                        {w.examples.slice(0, 2).map((ex, i) => (
                          <div key={i} className="text-[11px] italic leading-snug text-slate-400">“{ex}”</div>
                        ))}
                        {w.examples.length > 2 && (
                          <div className="text-[10px] text-slate-600">+{w.examples.length - 2} 条</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-8 flex items-center justify-center gap-3">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-30">上一页</button>
            <span className="text-sm text-slate-500">{page} / {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-30">下一页</button>
          </div>
        )}
      </div>

      {/* 词详情 + SRS 复习轨迹 Modal */}
      {selectedWordId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setSelectedWordId(null)}>
          <div className="max-h-[85vh] w-full max-w-lg overflow-auto rounded-2xl border border-slate-800 bg-slate-950 p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}>
            {trajectoryQuery.isLoading ? (
              <p className="text-center text-sm text-slate-400">加载中…</p>
            ) : trajectoryQuery.isError ? (
              <p className="text-sm text-red-400">加载失败</p>
            ) : trajectoryQuery.data ? (
              <SrsDetail
                data={trajectoryQuery.data}
                onUnskip={async () => unskip.mutate(selectedWordId)}
                unskipPending={unskip.isPending}
                onJump={(wordId) => setSelectedWordId(wordId)}
              />
            ) : null}
            <button onClick={() => setSelectedWordId(null)}
              className="mt-4 w-full rounded-lg border border-slate-700 py-2 text-sm text-slate-300 hover:bg-slate-800 transition-colors">
              关闭
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SrsDetail({
  data,
  onUnskip,
  unskipPending,
  onJump,
}: {
  data: SrsTrajectory;
  onUnskip: () => void;
  unskipPending: boolean;
  onJump: (wordId: string) => void;
}) {
  const t = data;
  const stageMeta = srsStageMeta(t.current.stage);
  return (
    <div className="space-y-4">
      {/* 词头 */}
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-bold text-slate-100">{t.word.text}</h2>
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${tierCls(t.word.tier)}`}>{t.word.tier}</span>
        </div>
        {t.word.phonetic && <p className="text-sm text-slate-500">{t.word.phonetic}</p>}
      </div>

      {/* 当前记忆状态 */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500">当前记忆状态</div>
        <div className="mt-2 flex items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONE[stageMeta.tone].badge}`}>{stageMeta.icon} {stageMeta.label}</span>
          {t.current.inWrongBook && (
            <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-xs font-medium text-red-300">📕 错题本</span>
          )}
          {t.current.skipped && (
            <span className="rounded-full bg-zinc-500/20 px-2 py-0.5 text-xs font-medium text-zinc-300">⚔️ 已斩</span>
          )}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded-lg bg-slate-950/60 py-2">
            <div className="text-slate-500">掌握度</div>
            <div className="font-bold text-emerald-400">{t.current.mastery}%</div>
          </div>
          <div className="rounded-lg bg-slate-950/60 py-2">
            <div className="text-slate-500">记忆强度</div>
            <div className="font-bold text-cyan-400">{easeLabel(t.current.ease)}</div>
          </div>
          <div className="rounded-lg bg-slate-950/60 py-2">
            <div className="text-slate-500">下次复习</div>
            <div className="font-bold text-amber-400">{t.current.skipped ? '-' : nextReviewLabel(t.current.nextReviewAt)}</div>
            {!t.current.skipped && (
              <div className="mt-0.5 text-[10px] text-slate-500">
                {reviewCountdown(t.current.nextReviewAt) ?? ''}
              </div>
            )}
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
          <span>上次复习：{t.lastReviewedAt ? new Date(t.lastReviewedAt).toLocaleString('zh-CN') : '未开始'}</span>
          {t.current.masteredAt && (
            <span className="text-emerald-400/80">
              ✓ 掌握于 {new Date(t.current.masteredAt).toLocaleDateString('zh-CN')}
            </span>
          )}
          {t.current.skipped && (
            <button
              onClick={onUnskip}
              disabled={unskipPending}
              className="rounded-lg border border-zinc-700 px-2 py-1 text-xs text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100 disabled:opacity-40"
            >
              {unskipPending ? '…' : '↩ 反斩（重新学习）'}
            </button>
          )}
        </div>
      </div>

      {/* 复习轨迹 */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500">复习轨迹</div>
        {t.points.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">尚未形成复习轨迹，去战斗积累相遇吧。</p>
        ) : (
          <div className="mt-3 space-y-0">
            {t.points.map((p, i) => {
              const meta = srsStageMeta(p.stage);
              const isLast = i === t.points.length - 1;
              const prev = i > 0 ? t.points[i - 1] : null;
              // 升降档标注：档位提升 ↑ / 下降 ↓（同档不标）
              const dir = prev ? (p.stage > prev.stage ? 'up' : p.stage < prev.stage ? 'down' : null) : null;
              return (
                <div key={i} className="flex items-start gap-3">
                  <div className="flex flex-col items-center">
                    <div className={`mt-1 h-2.5 w-2.5 rounded-full ${isLast ? 'bg-cyan-400' : 'bg-slate-600'}`} />
                    {i < t.points.length - 1 && <div className="w-px flex-1 bg-slate-800" />}
                  </div>
                  <div className={`pb-4 ${isLast ? '' : 'border-b border-slate-800/50'}`}>
                    <div className="text-sm">
                      {dir === 'up' && <span className="mr-1 font-bold text-emerald-400">↑</span>}
                      {dir === 'down' && <span className="mr-1 font-bold text-rose-400">↓</span>}
                      <span className={`font-semibold ${isLast ? 'text-cyan-300' : 'text-slate-300'}`}>{meta.icon} {meta.label}</span>
                      <span className="ml-2 text-xs text-slate-500">间隔 {p.intervalDays} 天</span>
                    </div>
                    <div className="text-xs text-slate-600">
                      {new Date(p.at).toLocaleString('zh-CN')}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 全部义项 */}
      {t.word.meanings.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500">义项</div>
          <ul className="mt-2 space-y-2">
            {t.word.meanings.map((s, i) => (
              <li key={i} className="text-sm">
                <span className="text-slate-200">{s.meaning}</span>
                {s.example && <span className="mt-0.5 block text-xs italic text-slate-400">“{s.example}”</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 易混词 */}
      {t.word.confusables.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500">易混词</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {t.word.confusables.map((c, i) => (
              <span
                key={i}
                title={c.note}
                onClick={() => { if (c.wordId) onJump(c.wordId); }}
                className={`rounded-full border border-amber-700/50 bg-amber-950/30 px-2 py-0.5 text-xs text-amber-300 ${
                  c.wordId ? 'cursor-pointer transition hover:border-amber-500 hover:bg-amber-900/40' : ''
                }`}
              >
                {c.counterpart}{c.note && ` · ${c.note}`}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 记忆锚点 */}
      {t.word.mnemonic && (
        <div className="rounded-xl border border-emerald-800/50 bg-emerald-950/30 p-4">
          <div className="text-[10px] font-medium uppercase tracking-wider text-emerald-500/80">记忆锚点</div>
          <p className="mt-1 text-sm text-emerald-300/90">💡 {t.word.mnemonic}</p>
        </div>
      )}

      {/* 全部例句 */}
      {t.word.examples.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500">例句</div>
          <div className="mt-2 space-y-1">
            {t.word.examples.map((ex, i) => (
              <div key={i} className="text-xs italic leading-snug text-slate-400">“{ex}”</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
