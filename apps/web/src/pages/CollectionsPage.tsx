import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import type { CollectedWord, CollectionStats, EncounterRecord } from '@word-journey/shared';
import { api } from '../lib/api';
import { getTts } from '../lib/tts';
import { playSkipSound } from '../lib/sfx';

const TIERS = [
  { v: '', label: '全部' }, { v: 'I', label: 'Ⅰ基础' }, { v: 'II', label: 'Ⅱ核心' },
  { v: 'III', label: 'Ⅲ拔高' }, { v: 'IV', label: 'Ⅳ超纲' },
];
const STATUSES = [
  { v: '', label: '全部' }, { v: 'new', label: '新遇' },
  { v: 'learning', label: '学习中' }, { v: 'mastered', label: '已掌握' },
  { v: 'wrongbook', label: '错题本' },
];
const SORTS = [
  { v: 'firstEncounteredAt', label: '初见时间' },
  { v: 'lastEncounteredAt', label: '最近相遇' },
  { v: 'encounterCount', label: '相遇次数' },
  { v: 'accuracy', label: '正确率' },
];
const PAGE_SIZE = 50;

function statusMeta(word: CollectedWord) {
  if (word.inWrongBook) return { label: '错题', cls: 'border-l-red-500 bg-red-500/10', badge: 'bg-red-500/20 text-red-300', icon: '📕' };
  if (word.mastery >= 100) return { label: '已掌握', cls: 'border-l-emerald-500 bg-emerald-500/10', badge: 'bg-emerald-500/20 text-emerald-300', icon: '⭐' };
  if (word.encounterCount >= 3) return { label: '学习中', cls: 'border-l-amber-500 bg-amber-500/10', badge: 'bg-amber-500/20 text-amber-300', icon: '📖' };
  return { label: '新遇', cls: 'border-l-sky-500 bg-sky-500/10', badge: 'bg-sky-500/20 text-sky-300', icon: '✨' };
}

function tierCls(t: string) {
  if (t === 'I') return 'bg-cyan-500/15 text-cyan-400';
  if (t === 'II') return 'bg-emerald-500/15 text-emerald-400';
  if (t === 'III') return 'bg-amber-500/15 text-amber-400';
  if (t === 'IV') return 'bg-rose-500/15 text-rose-400';
  return 'bg-slate-600/30 text-slate-400';
}

export function CollectionsPage() {
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

  const timelineQuery = useQuery({
    queryKey: ['collections', 'timeline', selectedWordId],
    queryFn: () => api.get<EncounterRecord[]>(`/collections/words/${selectedWordId}/timeline`),
    enabled: !!selectedWordId,
  });

  // 斩：标记已掌握（mastery 100），带防连点
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

  const stats = statsQuery.data;
  const { words, total } = wordsQuery.data ?? {};
  const totalPages = total ? Math.ceil(total / PAGE_SIZE) : 0;

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
              s.v === 'mastered' ? (stats?.mastered ?? 0) :
              s.v === 'wrongbook' ? (stats?.wrongbook ?? 0) : null;
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
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索…"
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
            <p>暂无单词记录，去战斗吧！</p>
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
                  <th className="px-2 py-3 font-medium">状态</th>
                  <th className="px-2 py-3 font-medium">相遇</th>
                  <th className="px-2 py-3 font-medium">正确率</th>
                  <th className="px-2 py-3 font-medium">初见</th>
                  <th className="pr-4 py-3 font-medium">释义</th>
                  <th className="pr-4 py-3 font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {words.map((w) => {
                  const m = statusMeta(w);
                  const acc = w.encounterCount ? Math.round((w.correctCount / w.encounterCount) * 100) : 0;
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
                      <td className="px-2 py-2.5"><span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${m.badge}`}>{m.label}</span></td>
                      <td className="px-2 py-2.5 text-xs text-slate-400">{w.encounterCount}</td>
                      <td className="px-2 py-2.5">
                        <span className={acc >= 80 ? 'text-emerald-400' : acc >= 50 ? 'text-amber-400' : 'text-red-400'}>
                          {acc}%
                        </span>
                      </td>
                      <td className="px-2 py-2.5 text-xs text-slate-500">
                        {w.firstEncounteredAt ? new Date(w.firstEncounteredAt).toLocaleDateString('zh-CN') : '-'}
                      </td>
                      <td className="py-2.5 pr-4 text-xs text-slate-400 truncate max-w-[120px]">
                        {w.meanings?.[0]?.meaning ?? ''}
                      </td>
                      <td className="py-2.5 pr-4 text-right">
                        {w.mastery < 100 && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSkip(w.wordId);
                            }}
                            disabled={skipping.has(w.wordId)}
                            title="标记已掌握"
                            className={`rounded-lg border px-2 py-0.5 text-xs font-medium transition-colors ${
                              skipping.has(w.wordId)
                                ? 'cursor-wait border-slate-700 text-slate-500'
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
              const acc = w.encounterCount ? Math.round((w.correctCount / w.encounterCount) * 100) : 0;
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
                      {w.mastery < 100 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSkip(w.wordId);
                          }}
                          disabled={skipping.has(w.wordId)}
                          title="标记已掌握"
                          className={`rounded-lg border px-2 py-0.5 text-xs font-medium transition-colors ${
                            skipping.has(w.wordId)
                              ? 'cursor-wait border-slate-700 text-slate-500'
                              : 'border-emerald-800 bg-emerald-950/40 text-emerald-400 hover:bg-emerald-500/20'
                          }`}
                        >
                          {skipping.has(w.wordId) ? '…' : '斩'}
                        </button>
                      )}
                      <span className="text-lg">{m.icon}</span>
                    </div>
                  </div>
                  {/* Accuracy bar */}
                  <div className="mt-3 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
                      <div className={`h-full rounded-full transition-all ${w.mastery >= 100 ? 'bg-emerald-500' : acc >= 80 ? 'bg-sky-500' : acc >= 40 ? 'bg-amber-500' : 'bg-red-500'}`}
                        style={{ width: `${Math.max(5, acc)}%` }} />
                    </div>
                    <span className="text-[10px] font-medium text-slate-500 w-7 text-right tabular-nums">{acc}%</span>
                  </div>
                  {/* Stats row */}
                  <div className="mt-2 flex items-center gap-3 text-[11px]">
                    <span className="text-slate-500">{m.icon} {m.label}</span>
                    <span className="text-slate-600">遇{w.encounterCount}</span>
                    <span className={acc >= 80 ? 'text-emerald-500' : acc >= 50 ? 'text-amber-500' : 'text-red-400'}>
                      {w.correctCount}/{w.encounterCount}
                    </span>
                  </div>
                  {w.firstEncounteredAt && (
                    <p className="mt-1 text-[10px] text-slate-600">
                      初见 {new Date(w.firstEncounteredAt).toLocaleDateString('zh-CN')}
                    </p>
                  )}
                  <p className="mt-2 text-xs text-slate-400 line-clamp-2">
                    {w.meanings?.map((m, i) => (
                      <span key={i}>{m.meaning}{i < w.meanings.length - 1 ? '；' : ''}</span>
                    ))}
                  </p>
                  {/* 易混词区块 */}
                  {w.confusables.length > 0 && (
                    <div className="mt-3 border-t border-slate-800/70 pt-2">
                      <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500">易混词</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {w.confusables.slice(0, 4).map((c, i) => (
                          <span
                            key={i}
                            title={c.note}
                            className="rounded-full border border-amber-700/50 bg-amber-950/30 px-1.5 py-0.5 text-[10px] text-amber-300"
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

      {/* Timeline Modal */}
      {selectedWordId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setSelectedWordId(null)}>
          <div className="max-h-[80vh] w-full max-w-lg overflow-auto rounded-2xl border border-slate-800 bg-slate-950 p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}>
            {timelineQuery.isLoading ? (
              <p className="text-center text-sm text-slate-400">加载中…</p>
            ) : timelineQuery.isError ? (
              <p className="text-sm text-red-400">加载失败</p>
            ) : !timelineQuery.data?.length ? (
              <p className="text-sm text-slate-400">暂无相遇记录</p>
            ) : (
              <div className="space-y-3">
                <h2 className="text-lg font-semibold text-slate-100">相遇记录</h2>
                {timelineQuery.data.map((r, i) => (
                  <div key={i} className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3">
                    <span className={`shrink-0 text-lg ${r.correct ? 'text-emerald-400' : 'text-red-400/60'}`}>
                      {r.correct ? '✓' : '✗'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-slate-200">
                        {( { zh2en: '中译英', dictation: '听写', choice: '选中文' } as Record<string, string> )[r.mode]}
                      </div>
                      <div className="text-xs text-slate-500">
                        {new Date(r.date).toLocaleString('zh-CN')} · {(r.elapsedMs / 1000).toFixed(1)}s
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
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
