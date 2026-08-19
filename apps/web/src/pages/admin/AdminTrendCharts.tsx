// 后台 · 运营趋势图（近 N 天逐日，纯 SVG 无外部依赖）
import { useEffect, useState } from 'react';
import type { AdminStatsTrend, AdminTrendDay } from '@word-journey/shared';
import { fetchAdminStatsTrend } from '../../lib/admin';

const fmt = (n: number): string => n.toLocaleString();

interface Series { label: string; color: string; get: (d: AdminTrendDay) => number; }

const SERIES: Series[] = [
  { label: '新增注册', color: '#22d3ee', get: (d) => d.newUsers },
  { label: '活跃用户 (DAU)', color: '#a78bfa', get: (d) => d.activeUsers },
  { label: 'Run 局', color: '#34d399', get: (d) => d.runs },
  { label: '关卡会话', color: '#fbbf24', get: (d) => d.sessions },
  { label: '阅读答题', color: '#fb7185', get: (d) => d.readingAnswers },
];

const shortDate = (date: string): string => {
  const [, m, d] = date.split('-');
  return Number(m) + '/' + Number(d);
};

// 单个迷你折线图
function MiniChart({ data, series }: { data: AdminTrendDay[]; series: Series }) {
  const W = 320;
  const H = 120;
  const P = { l: 8, r: 8, t: 14, b: 20 };
  const iw = W - P.l - P.r;
  const ih = H - P.t - P.b;
  const values = data.map(series.get);
  const max = Math.max(1, ...values);
  const n = data.length;
  const stepX = n > 1 ? iw / (n - 1) : 0;
  const pts = values.map((v, i) => [P.l + i * stepX, P.t + ih - (v / max) * ih] as const);
  const line = pts.map((p, i) => { const x = p[0]!; const y = p[1]!; return (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1); }).join(' ');
  const lastX = (P.l + (n - 1) * stepX).toFixed(1);
  const baseY = (P.t + ih).toFixed(1);
  const area = line + ' L' + lastX + ',' + baseY + ' L' + P.l + ',' + baseY + ' Z';
  const total = values.reduce((a, b) => a + b, 0);
  const avg = total / n;
  const peak = Math.max(...values);
  const ticks = [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i);

  return (
    <div className="flex flex-col rounded-xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-sm text-slate-400">{series.label}</div>
        <div className="text-xs text-slate-500">日均 {avg.toFixed(1)} · 峰值 {fmt(peak)} · 合计 {fmt(total)}</div>
      </div>
      <svg viewBox={'0 0 ' + W + ' ' + H} className="mt-2 w-full" role="img" aria-label={series.label}>
        <line x1={P.l} y1={P.t} x2={P.l + iw} y2={P.t} stroke="#1e293b" strokeWidth="1" />
        <line x1={P.l} y1={P.t + ih / 2} x2={P.l + iw} y2={P.t + ih / 2} stroke="#1e293b" strokeWidth="1" />
        <line x1={P.l} y1={P.t + ih} x2={P.l + iw} y2={P.t + ih} stroke="#1e293b" strokeWidth="1" />
        {area !== '' && <path d={area} fill={series.color} opacity="0.12" />}
        {line !== '' && <path d={line} fill="none" stroke={series.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
        {pts.map((p, i) => (
          <circle key={i} cx={p[0]!} cy={p[1]!} r={(values[i] ?? 0) > 0 ? 2.5 : 0} fill={series.color} />
        ))}
        {ticks.map((ti) => (
          <text key={ti} x={P.l + ti * stepX} y={H - 4} textAnchor={ti === 0 ? 'start' : ti === n - 1 ? 'end' : 'middle'} fontSize="9" fill="#64748b">
            {shortDate(data[ti]!.date)}
          </text>
        ))}
      </svg>
    </div>
  );
}

export function AdminTrendCharts() {
  const [data, setData] = useState<AdminStatsTrend | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAdminStatsTrend(14).then(setData).catch(() => setData(null)).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-500">趋势加载中…</div>;
  if (!data || data.daysData.length === 0) return <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-500">暂无趋势数据</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-bold text-slate-300">近 {data.days} 天运营趋势</h2>
        <div className="ml-auto flex flex-wrap gap-3 text-xs text-slate-500">
          {SERIES.map((s) => (
            <span key={s.label} className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {SERIES.map((s) => (
          <MiniChart key={s.label} data={data.daysData} series={s} />
        ))}
      </div>
    </div>
  );
}
