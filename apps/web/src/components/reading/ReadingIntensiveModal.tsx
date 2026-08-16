// 逐句精读模式：一句一屏；从句着色 + 句子主干 + 从句列表 + 点词底部释义条
import { useMemo, useState } from 'react';
import type { ReadingGlossaryEntry, ReadingSentenceStructure, ReadingSentenceView } from '@word-journey/shared';
import {
  assignTokenClauses,
  clauseRoleInfo,
  locateClauseSpans,
  lookupReadingWord,
  normalizeReadingWord,
  tokenizeReadingSentence,
} from '@word-journey/shared';
import { getTts } from '../../lib/tts';

export interface ReadingIntensiveModalProps {
  sentences: ReadingSentenceView[];
  glossary: ReadingGlossaryEntry[];
  savedWords: Set<string>;
  initialSeq: number;
  onClose: () => void;
  onSentenceChange: (seq: number) => void;
  onToggleSave: (word: string, action: 'save' | 'remove') => void;
}

interface SelectedWord {
  raw: string;
  entry: ReadingGlossaryEntry | undefined;
}

export function ReadingIntensiveModal({
  sentences,
  glossary,
  savedWords,
  initialSeq,
  onClose,
  onSentenceChange,
  onToggleSave,
}: ReadingIntensiveModalProps) {
  const [idx, setIdx] = useState(() => Math.max(0, sentences.findIndex((s) => s.seq === initialSeq)));
  const [structureOn, setStructureOn] = useState(true);
  const [zhOpen, setZhOpen] = useState(true);
  const [selected, setSelected] = useState<SelectedWord | null>(null);

  const glossaryMap = useMemo(() => {
    const m: Record<string, ReadingGlossaryEntry> = {};
    for (const g of glossary) m[g.word] = g;
    return m;
  }, [glossary]);

  const cur = sentences[idx];
  if (!cur) return null;

  const structure: ReadingSentenceStructure | undefined = cur.structure;
  const tokens = useMemo(() => tokenizeReadingSentence(cur.en), [cur.en]);
  const clauseRoles = useMemo(() => {
    if (!structure || !structure.clauses?.length) return [];
    const spans = locateClauseSpans(cur.en, structure.clauses);
    return assignTokenClauses(tokens, spans);
  }, [cur.en, structure, tokens]);

  const presentRoles = useMemo(() => {
    if (!structure || !structure.clauses) return [];
    return [...new Set(structure.clauses.map((c) => c.role))];
  }, [structure]);

  const go = (next: number): void => {
    const clamped = Math.max(0, Math.min(sentences.length - 1, next));
    setIdx(clamped);
    setSelected(null);
    onSentenceChange(sentences[clamped]!.seq);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950/95 backdrop-blur-sm">
      {/* 顶栏 */}
      <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
        <button onClick={onClose} className="shrink-0 text-sm text-slate-400 transition hover:text-cyan-300">← 退出</button>
        <div className="text-sm text-slate-300">逐句精读 · <span className="font-semibold text-cyan-300">{idx + 1}/{sentences.length}</span></div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => setStructureOn((v) => !v)}
            className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
              structureOn ? 'border-violet-500/40 bg-violet-500/10 text-violet-300' : 'border-slate-700 bg-slate-800/60 text-slate-400'
            }`}
          >
            结构
          </button>
          <button
            onClick={() => setZhOpen((v) => !v)}
            className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
              zhOpen ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300' : 'border-slate-700 bg-slate-800/60 text-slate-400'
            }`}
          >
            译文
          </button>
        </div>
      </div>

      {/* 主区 */}
      <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-8">
        <div className="mx-auto max-w-2xl space-y-4">
          {/* 图例 */}
          {structureOn && structure && presentRoles.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {presentRoles.map((role) => {
                const info = clauseRoleInfo(role);
                return (
                  <span key={role} className="flex items-center gap-1.5 rounded-full border border-slate-800 bg-slate-900/60 px-2.5 py-1 text-[11px] text-slate-300">
                    <span className={`h-2 w-2 rounded-full ${info.dotClass}`} />
                    {info.label}
                  </span>
                );
              })}
            </div>
          )}

          {/* 句子卡 */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
            <p className="text-base leading-8 text-slate-100 sm:text-lg sm:leading-9">
              {tokens.map((t, i) => {
                if (!t.word) {
                  return <span key={i} className="whitespace-pre-wrap">{t.text}</span>;
                }
                const entry = lookupReadingWord(glossaryMap, t.word);
                const saved = savedWords.has(t.word);
                const role = clauseRoles[i];
                const isSelected = selected !== null && normalizeReadingWord(selected.raw) === t.word;
                const info = role ? clauseRoleInfo(role) : null;
                let cls = '';
                if (isSelected) cls = 'rounded-sm bg-cyan-500/25 text-cyan-100';
                else if (info) cls = info.spanClass;
                else cls = 'text-slate-300';
                return (
                  <button
                    key={i}
                    className={`inline cursor-pointer rounded-sm px-px transition hover:bg-slate-700/40 ${cls} ${saved ? 'text-amber-300' : ''}`}
                    onClick={() => setSelected({ raw: t.text, entry })}
                  >
                    {t.text}
                  </button>
                );
              })}
            </p>
          </div>

          {/* 结构分析卡 */}
          {structureOn && structure && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-[.15em] text-slate-500">结构分析</div>
              {structure.main && (
                <div className="mb-3 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm leading-6">
                  <span className="mr-1 text-slate-500">主干：</span>
                  <span className="text-slate-200">
                    主 <span className="text-sky-300">{structure.main.subject}</span>
                    {' · '}谓 <span className="text-cyan-300">{structure.main.predicate}</span>
                    {structure.main.object && (
                      <>
                        {' · '}宾 <span className="text-emerald-300">{structure.main.object}</span>
                      </>
                    )}
                  </span>
                </div>
              )}
              <ul className="space-y-1.5">
                {structure.clauses.map((c, i) => {
                  const info = clauseRoleInfo(c.role);
                  return (
                    <li key={i} className="flex items-start gap-2 text-sm leading-6">
                      <span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${info.dotClass}`} />
                      <span className="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-[11px] text-slate-400">
                        {info.label}
                      </span>
                      <span className="text-slate-300">{c.text}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* 译文 */}
          {zhOpen && (
            <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4 text-sm leading-7 text-slate-300">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-[.15em] text-cyan-500/70">译文</div>
              {cur.zh}
            </div>
          )}
        </div>
      </div>

      {/* 底部：词义条 + 导航 */}
      <div className="border-t border-slate-800 bg-slate-950/95 px-4 py-3">
        <div className="mx-auto max-w-2xl">
          {/* 词义条 */}
          <div className="mb-3 flex min-h-[44px] items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2">
            {selected ? (
              <>
                <span className="shrink-0 text-base font-bold text-cyan-300">{selected.raw}</span>
                {selected.entry?.phonetic && <span className="shrink-0 text-xs text-slate-500">{selected.entry.phonetic}</span>}
                <span className="min-w-0 flex-1 text-sm text-slate-300">{selected.entry?.meaning ?? '（暂无收录释义）'}</span>
                <button
                  onClick={() => getTts().speak(selected.raw, { rate: 0.9 })}
                  className="shrink-0 rounded-lg border border-slate-600 bg-slate-800/60 px-2.5 py-1 text-xs text-slate-200 transition hover:border-cyan-500/40 hover:text-cyan-300"
                >
                  朗读
                </button>
                <button
                  onClick={() => onToggleSave(selected.raw, savedWords.has(normalizeReadingWord(selected.raw)) ? 'remove' : 'save')}
                  className={`shrink-0 rounded-lg border px-2.5 py-1 text-xs transition ${
                    savedWords.has(normalizeReadingWord(selected.raw))
                      ? 'border-amber-500/50 bg-amber-500/10 text-amber-300'
                      : 'border-slate-600 bg-slate-800/60 text-slate-200 hover:border-amber-500/40 hover:text-amber-300'
                  }`}
                >
                  {savedWords.has(normalizeReadingWord(selected.raw)) ? '已收藏' : '收藏生词'}
                </button>
              </>
            ) : (
              <span className="text-sm text-slate-500">点击句中单词查看释义</span>
            )}
          </div>

          {/* 导航 */}
          <div className="grid grid-cols-3 gap-3">
            <button
              onClick={() => go(idx - 1)}
              disabled={idx === 0}
              className="rounded-xl border border-slate-700 py-2.5 text-sm text-slate-300 transition hover:border-cyan-500/40 hover:text-cyan-300 disabled:opacity-40"
            >
              ← 上一句
            </button>
            <button
              onClick={() => getTts().speak(cur.en, { rate: 0.9 })}
              className="flex items-center justify-center gap-1.5 rounded-xl bg-cyan-500 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5 6 9H2v6h4l5 4V5Z" />
                <path strokeLinecap="round" d="M15.5 8.5a5 5 0 0 1 0 7" />
              </svg>
              朗读
            </button>
            <button
              onClick={() => go(idx + 1)}
              disabled={idx === sentences.length - 1}
              className="rounded-xl border border-slate-700 py-2.5 text-sm text-slate-300 transition hover:border-cyan-500/40 hover:text-cyan-300 disabled:opacity-40"
            >
              下一句 →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
