// 真题阅读首页：年份卷 → A/B/C/D 四篇卡片（状态 / 分数）
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { ReadingPassageSummary } from '@word-journey/shared';
import { fetchReadingPapers } from '../lib/reading';

export function ReadingIndexPage() {
  const { data: papers, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['reading', 'papers'],
    queryFn: fetchReadingPapers,
  });

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-6 text-slate-100 sm:px-8">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black tracking-wide text-cyan-300" style={{ textShadow: '0 0 16px rgba(6,182,212,.5)' }}>
              真题阅读
            </h1>
            <p className="mt-1 text-sm text-slate-500">考研英语一 · 阅读理解 Part A · 点词查义 / 逐句精读 / 答题解析</p>
          </div>
          <Link to="/lobby" className="text-sm text-slate-400 transition hover:text-cyan-300">← 返回大厅</Link>
        </div>

        {isLoading ? (
          <p className="py-20 text-center text-slate-400">加载中…</p>
        ) : isError ? (
          <div className="mx-auto max-w-md rounded-2xl border border-red-800 bg-red-950/30 p-4 text-center">
            <p className="text-sm text-red-400">加载失败：{error instanceof Error ? error.message : '未知错误'}</p>
            <button onClick={() => refetch()} className="mt-2 text-sm font-medium text-cyan-400 hover:underline">重试</button>
          </div>
        ) : !papers?.length ? (
          <p className="py-20 text-center text-slate-400">暂无真题数据</p>
        ) : (
          <div className="space-y-6">
            {papers.map((paper) => {
              const done = paper.passages.filter((p) => p.status === 'done').length;
              return (
                <section key={paper.id} className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-bold text-slate-100">{paper.year} 年英语（一）</h2>
                      <p className="text-xs text-slate-500">{paper.examName}</p>
                    </div>
                    <span className="rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-semibold text-cyan-400">
                      {done}/{paper.passages.length} 篇已完成
                    </span>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {paper.passages.map((pa) => (
                      <PassageCard key={pa.id} pa={pa} />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function PassageCard({ pa }: { pa: ReadingPassageSummary }) {
  const accent = { A: '#06b6d4', B: '#10b981', C: '#8b5cf6', D: '#f59e0b' }[pa.code] ?? '#06b6d4';
  const statusText =
    pa.status === 'done' ? '已完成' : pa.status === 'reading' ? '阅读中' : '未开始';
  const statusColor =
    pa.status === 'done' ? 'text-emerald-400' : pa.status === 'reading' ? 'text-amber-400' : 'text-slate-500';
  const pct = pa.totalQuestions > 0 ? Math.round((pa.correctCount / pa.totalQuestions) * 100) : 0;

  return (
    <Link
      to={`/reading/passage/${pa.id}`}
      className="group rounded-xl border border-slate-800 bg-slate-900/60 p-4 transition hover:-translate-y-0.5 hover:border-slate-600"
      style={{ boxShadow: `0 0 0 rgba(0,0,0,0)` }}
    >
      <div className="mb-2 flex items-center justify-between">
        <span
          className="flex h-8 w-8 items-center justify-center rounded-lg text-sm font-black text-slate-950"
          style={{ background: accent }}
        >
          {pa.code}
        </span>
        <span className={`text-xs font-medium ${statusColor}`}>{statusText}</span>
      </div>
      <h3 className="text-sm font-bold text-slate-100">{pa.title}</h3>
      {pa.subtitle && <p className="mt-0.5 truncate text-xs text-slate-500">{pa.subtitle}</p>}
      <div className="mt-3 text-xs text-slate-400">
        共 {pa.questionCount} 题
        {pa.bestScore > 0 && <span className="ml-1 text-cyan-400">· 最高 {pa.bestScore} 分</span>}
      </div>
      {pa.totalQuestions > 0 && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{ width: `${pct}%`, background: accent }}
          />
        </div>
      )}
    </Link>
  );
}
