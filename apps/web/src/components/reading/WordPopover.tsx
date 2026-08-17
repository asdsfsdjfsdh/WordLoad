// 点词弹窗：词义 + 音标 + 收藏生词 + 朗读
import { useEffect, useRef } from 'react';
import type { ReadingGlossaryEntry } from '@word-journey/shared';
import { getTts } from '../../lib/tts';

export interface WordPopoverState {
  raw: string;
  entry?: ReadingGlossaryEntry;
  x: number;
  y: number;
}

export interface WordPopoverProps {
  state: WordPopoverState;
  saved: boolean;
  onToggleSave: (word: string, action: 'save' | 'remove') => void;
  onClose: () => void;
}

export function WordPopover({ state, saved, onToggleSave, onClose }: WordPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const entry = state.entry;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 0;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 0;
  const left = Math.min(Math.max(12, state.x), vw - 340);
  const top = Math.max(12, Math.min(state.y, vh - 220));

  return (
    <div
      ref={ref}
      className="fixed z-50 w-[320px] max-w-[calc(100vw-24px)] rounded-xl border border-cyan-500/30 bg-slate-900/95 p-4 shadow-2xl backdrop-blur animate-[fadeIn_.12s_ease-out]"
      style={{ left, top, transform: 'translateY(8px)' }}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-lg font-bold text-cyan-300">{state.raw}</span>
            {entry?.phonetic && <span className="text-xs text-slate-400">{entry.phonetic}</span>}
            {entry?.source && (
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${entry.source === 'wordbank' ? 'bg-violet-500/15 text-violet-300' : 'bg-cyan-500/15 text-cyan-300'}`}>
                {entry.source === 'wordbank' ? '单词库' : '篇内词表'}
              </span>
            )}
          </div>
          {entry?.mastered === true && (
            <span className="mt-0.5 inline-block rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
              已掌握
            </span>
          )}
        </div>
        <button onClick={onClose} aria-label="关闭" className="text-slate-500 transition hover:text-slate-300">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <p className="text-sm leading-6 text-slate-200">{entry?.meaning ?? '（该词暂无收录释义）'}</p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => getTts().speak(state.raw, { rate: 0.9 })}
          className="flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800/60 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:border-cyan-500/40 hover:text-cyan-300"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M11 5 6 9H2v6h4l5 4V5Z" />
            <path strokeLinecap="round" d="M15.5 8.5a5 5 0 0 1 0 7" />
            <path strokeLinecap="round" d="M18.5 5.5a9 9 0 0 1 0 13" />
          </svg>
          朗读
        </button>
        <button
          onClick={() => onToggleSave(state.raw, saved ? 'remove' : 'save')}
          className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
            saved
              ? 'border-amber-500/50 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
              : 'border-slate-600 bg-slate-800/60 text-slate-200 hover:border-amber-500/40 hover:text-amber-300'
          }`}
        >
          {saved ? '已收藏生词 · 取消' : '收藏生词'}
        </button>
      </div>
    </div>
  );
}
