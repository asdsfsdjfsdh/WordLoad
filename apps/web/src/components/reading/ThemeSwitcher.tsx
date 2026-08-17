// 阅读主题切换：暗色 / 亮白 / 米黄（仅作用于阅读页容器）
import { useEffect, useRef, useState } from 'react';

export type ReadingTheme = 'dark' | 'light' | 'sepia';

const READING_THEMES: { id: ReadingTheme; label: string; hint: string; dot: string }[] = [
  { id: 'dark', label: '暗色', hint: '默认深色', dot: 'bg-slate-600' },
  { id: 'light', label: '亮白', hint: '白底', dot: 'bg-white ring-1 ring-slate-300' },
  { id: 'sepia', label: '米黄', hint: '护眼纸色', dot: 'bg-[#f2ecdf] ring-1 ring-amber-300' },
];

export function ThemeSwitcher({ value, onChange }: { value: ReadingTheme; onChange: (t: ReadingTheme) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const cur = READING_THEMES.find((t) => t.id === value) ?? READING_THEMES[0]!;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
          value === 'dark'
            ? 'border-slate-700 bg-slate-800/60 text-slate-200 hover:border-cyan-500/40 hover:text-cyan-300'
            : 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300'
        }`}
      >
        <span className={`h-2.5 w-2.5 rounded-full ${cur.dot}`} />
        主题
        <svg className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 z-50 mt-2 w-40 overflow-hidden rounded-xl border border-slate-700 bg-slate-900 p-1 shadow-2xl animate-[fadeIn_.12s_ease-out]"
        >
          {READING_THEMES.map((t) => (
            <button
              key={t.id}
              role="option"
              aria-selected={t.id === value}
              onClick={() => {
                onChange(t.id);
                setOpen(false);
              }}
              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition ${
                t.id === value ? 'bg-cyan-500/15 text-cyan-300' : 'text-slate-300 hover:bg-slate-800/60'
              }`}
            >
              <span className={`h-3 w-3 shrink-0 rounded-full ${t.dot}`} />
              <span className="flex-1">
                <span className="block font-medium">{t.label}</span>
                <span className="block text-[10px] text-slate-500">{t.hint}</span>
              </span>
              {t.id === value && <span className="shrink-0 text-cyan-300">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
