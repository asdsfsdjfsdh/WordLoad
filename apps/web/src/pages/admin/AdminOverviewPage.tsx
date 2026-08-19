// 后台 · 运营数据总览
import { useEffect, useState } from 'react';
import type { AdminStatsOverview } from '@word-journey/shared';
import { fetchAdminStats } from '../../lib/admin';
import { AdminTrendCharts } from './AdminTrendCharts';

const fmt = (n: number): string => n.toLocaleString();
const fmtTime = (s?: string): string => (s ? new Date(s).toLocaleString('zh-CN') : '-');

interface Card { label: string; value: string; sub: string; accent: string; }

export function AdminOverviewPage() {
  const [data, setData] = useState<AdminStatsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetchAdminStats().then(setData).catch(() => setErr('加载失败')).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="py-16 text-center text-slate-500">加载中…</div>;
  if (err || !data) return <div className="py-16 text-center text-red-400">{err || '无数据'}</div>;

  const cards: Card[] = [
    { label: '用户', value: fmt(data.users.total), sub: '今日新增 ' + fmt(data.users.todayNew) + ' · 管理员 ' + data.users.admins, accent: 'text-cyan-300' },
    { label: '词库', value: fmt(data.words.total), sub: '义项 ' + fmt(data.words.senses) + ' · 词书 ' + data.words.banks + ' · 易混对 ' + data.words.wordPairs, accent: 'text-emerald-300' },
    { label: 'Run 局', value: fmt(data.runs.total), sub: '进行中 ' + data.runs.active + ' · 今日 ' + data.runs.todayNew + ' · 通关 ' + data.runs.completed, accent: 'text-violet-300' },
    { label: '关卡会话', value: fmt(data.sessions.total), sub: '今日 ' + data.sessions.todayNew, accent: 'text-amber-300' },
    { label: '阅读', value: data.reading.papers + ' 卷', sub: data.reading.passages + ' 篇 · ' + data.reading.sentences + ' 句 · ' + data.reading.questions + ' 题', accent: 'text-rose-300' },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <div className="text-sm text-slate-400">{c.label}</div>
            <div className={'mt-1 text-3xl font-black ' + c.accent}>{c.value}</div>
            <div className="mt-2 text-xs text-slate-500">{c.sub}</div>
          </div>
        ))}
      </div>
      <AdminTrendCharts />
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <h2 className="mb-3 text-sm font-bold text-slate-300">最近注册</h2>
        {data.recentSignups.length === 0 ? (
          <div className="text-sm text-slate-500">暂无注册用户</div>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {data.recentSignups.map((u) => (
                <tr key={u.id} className="border-t border-slate-800 first:border-t-0">
                  <td className="py-2 text-slate-400">#{u.id}</td>
                  <td className="py-2 text-cyan-300">{u.username}</td>
                  <td className="py-2 text-right text-slate-500">{fmtTime(u.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
