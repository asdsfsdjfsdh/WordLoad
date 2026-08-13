// 轻量自绘图表：深色霓虹风格，紧凑布局，零依赖

export interface BarDatum {
  label: string;
  value: number;
  title?: string;
}

/** 紧凑迷你柱状图 */
export function MiniBars({
  data,
  height = 56,
  color = '#22d3ee',
  suffix = '',
  labelEvery = 0,
}: {
  data: BarDatum[];
  height?: number;
  color?: string;
  suffix?: string;
  /** 每隔多少个 label 显示一次；0 表示不显示下标 */
  labelEvery?: number;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const step = labelEvery > 0 ? labelEvery : Infinity;
  return (
    <div className="w-full">
      <div className="flex gap-[2px]" style={{ height }}>
        {data.map((d, i) => {
          const pct = Math.round((Math.max(0, d.value) / max) * 100);
          return (
            <div key={i} className="flex flex-1 flex-col justify-end" title={d.title ?? `${d.label}：${d.value}${suffix}`}>
              {d.value > 0 ? (
                <div
                  className="w-full rounded-t-[2px]"
                  style={{ height: `${pct}%`, background: `linear-gradient(180deg, ${color}dd, ${color}44)` }}
                />
              ) : (
                <div className="h-[2px] w-full rounded bg-slate-800/70" />
              )}
            </div>
          );
        })}
      </div>
      {labelEvery > 0 && (
        <div className="mt-1 flex gap-[2px]">
          {data.map((d, i) => (
            <div key={i} className="flex-1 text-center text-[8px] leading-none text-slate-600">
              {i % step === 0 ? d.label : ''}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 紧凑迷你折线图 */
export function MiniLine({
  data,
  height = 56,
  color = '#34d399',
  max,
}: {
  data: { label: string; value: number }[];
  height?: number;
  color?: string;
  max?: number;
}) {
  const count = data.length;
  const maxV = Math.max(1, max ?? Math.max(...data.map((d) => d.value)));
  const PAD_TOP = 6;
  const PAD_BOTTOM = 94;
  const vw = Math.max(24, Math.max(1, count - 1) * 12);
  const pts = data.map((d, i) => ({
    x: count === 1 ? vw / 2 : (i / (count - 1)) * vw,
    y: PAD_BOTTOM - (d.value / maxV) * (PAD_BOTTOM - PAD_TOP),
  }));
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
  const area = pts.length ? `${path} L${pts[pts.length - 1]!.x.toFixed(2)},${PAD_BOTTOM} L${pts[0]!.x.toFixed(2)},${PAD_BOTTOM} Z` : '';
  const gridY = [0.25, 0.5, 0.75].map((f) => PAD_BOTTOM - f * (PAD_BOTTOM - PAD_TOP));
  const firstP = data[0];
  const lastP = data[data.length - 1];
  return (
    <div className="w-full">
      <svg className="block w-full" height={height} viewBox={`0 0 ${Math.max(vw, 60)} 100`} preserveAspectRatio="none">
        {gridY.map((y, i) => (
          <line key={i} x1={0} x2={vw} y1={y} y2={y} stroke="rgb(30,41,59)" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
        ))}
        {area && <path d={area} fill={color} opacity="0.12" />}
        {path && <path d={path} fill="none" stroke={color} strokeWidth="1.8" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />}
        {pts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="2.2" fill={color} vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      {firstP && lastP && (
        <div className="mt-1 flex justify-between text-[8px] text-slate-600">
          <span>{firstP.label}</span>
          <span>{lastP.label}</span>
        </div>
      )}
    </div>
  );
}

const CELL_NONE = 'bg-slate-800/50';
const CELL_1 = 'bg-cyan-900/70';
const CELL_2 = 'bg-cyan-800';
const CELL_3 = 'bg-cyan-600';
const CELL_4 = 'bg-cyan-400';

function heatmapCell(v: number): string {
  if (v <= 0) return 'bg-slate-800/50';
  if (v <= 2) return 'bg-cyan-950';
  if (v <= 5) return 'bg-cyan-800';
  if (v <= 9) return 'bg-cyan-600';
  return 'bg-cyan-400';
}

/** GitHub 式活跃热力图（周一为首列） */
export function Heatmap({ cells }: { cells: { date: string; value: number }[] }) {
  const firstCell = cells[0];
  const lastCell = cells[cells.length - 1];
  if (!firstCell || !lastCell) return <div className="text-center text-xs text-slate-500">暂无数据</div>;

  const byDate = new Map(cells.map((c) => [c.date, c.value]));
  const first = parseDate(firstCell.date);
  // 对齐到最近周一
  const start = new Date(first);
  const dow = (start.getDay() + 6) % 7; // 0=周一
  start.setDate(start.getDate() - dow);
  const last = parseDate(lastCell.date);
  const totalDays = Math.round((last.getTime() - start.getTime()) / 86400000) + 1;
  const weeks = Math.ceil(totalDays / 7);

  const colDate = (w: number) => {
    const d = new Date(start);
    d.setDate(d.getDate() + w * 7);
    return d;
  };

  const monthLabel = (w: number) => {
    const d = colDate(w);
    const prev = w > 0 ? colDate(w - 1) : null;
    if (prev && prev.getMonth() === d.getMonth()) return '';
    return `${d.getMonth() + 1}月`;
  };

  const dayLabel = (di: number) => (di === 0 ? '一' : di === 2 ? '三' : di === 4 ? '五' : '');

  return (
    <div className="w-full overflow-x-auto">
      <div className="flex gap-[3px]">
        <div className="flex flex-col items-end gap-[2px] pt-4 pr-0.5">
          {[0, 2, 4].map((di) => (
            <div key={di} className="flex h-[9px] items-center text-[8px] leading-none text-slate-500">
              {dayLabel(di)}
            </div>
          ))}
        </div>
        <div className="flex gap-[2px]">
          {Array.from({ length: weeks }, (_, w) => (
            <div key={w} className="flex flex-col gap-[2px]">
              <div className="mb-[2px] h-[10px] text-center text-[8px] leading-none text-slate-600">{monthLabel(w)}</div>
              {Array.from({ length: 7 }, (_, di) => {
                const d = new Date(colDate(w));
                d.setDate(d.getDate() + di);
                const ds = toDateStr(d);
                const v = byDate.get(ds) ?? 0;
                return (
                  <div
                    key={di}
                    title={`${ds}：${v} 词`}
                    className={`h-[9px] w-[9px] rounded-[2px] ${v > 0 ? heatmapCell(v) : 'bg-slate-800/50'}`}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      {/* 图例 */}
      <div className="mt-3 flex items-center gap-1.5 text-[10px] text-slate-500">
        <span>少</span>
        {[CELL_NONE, CELL_1, CELL_2, CELL_3, CELL_4].map((c) => (
          <span key={c} className={`h-[9px] w-[9px] rounded-[2px] ${c}`} />
        ))}
        <span>多</span>
      </div>
    </div>
  );
}

function parseDate(s: string): Date {
  const parts = s.split('-').map(Number);
  return new Date(parts[0] ?? 1970, (parts[1] ?? 1) - 1, parts[2] ?? 1);
}

function toDateStr(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}