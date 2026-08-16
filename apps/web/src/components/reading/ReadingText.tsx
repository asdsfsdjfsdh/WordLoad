// 阅读原文渲染：逐句 + 分词 span（点词弹窗 / 句译 / 生词高亮）
import { useMemo, type CSSProperties } from 'react';
import type { ReadingGlossaryEntry, ReadingSentenceView } from '@word-journey/shared';
import { lookupReadingWord, tokenizeReadingSentence } from '@word-journey/shared';

export interface ReadingTextProps {
  sentences: ReadingSentenceView[];
  glossary: ReadingGlossaryEntry[];
  showZh: boolean;
  highlight: boolean;
  savedWords: Set<string>;
  selectedSentence: number | null;
  onWordClick: (raw: string, entry: ReadingGlossaryEntry | undefined, e: React.MouseEvent) => void;
  onSentenceClick: (seq: number) => void;
}

export function ReadingText({
  sentences,
  glossary,
  showZh,
  highlight,
  savedWords,
  selectedSentence,
  onWordClick,
  onSentenceClick,
}: ReadingTextProps) {
  const glossaryMap = useMemo(() => {
    const m: Record<string, ReadingGlossaryEntry> = {};
    for (const g of glossary) m[g.word] = g;
    return m;
  }, [glossary]);

  const tokensCache = useMemo(
    () => new Map(sentences.map((s) => [s.seq, tokenizeReadingSentence(s.en)])),
    [sentences],
  );

  return (
    <article className="space-y-5 text-[15px] leading-7 text-slate-200 sm:text-base sm:leading-8">
      {sentences.map((s) => {
        const tokens = tokensCache.get(s.seq) ?? [];
        const selected = selectedSentence === s.seq;
        return (
          <div key={s.seq} data-sentence={s.seq} className="group">
            <p
              className={`cursor-pointer rounded-lg px-2 py-1 -mx-2 transition-colors ${
                selected ? 'bg-cyan-500/10 ring-1 ring-cyan-500/30' : 'hover:bg-slate-800/40'
              }`}
              onClick={() => onSentenceClick(s.seq)}
              title="点击查看整句翻译"
            >
              {tokens.map((t, i) =>
                t.word ? (
                  <WordSpan
                    key={i}
                    raw={t.text}
                    entry={lookupReadingWord(glossaryMap, t.word)}
                    highlight={highlight}
                    saved={savedWords.has(t.word)}
                    onWordClick={onWordClick}
                  />
                ) : (
                  <span key={i} className="whitespace-pre-wrap">{t.text}</span>
                ),
              )}
            </p>
            {(showZh || selected) && (
              <p className="mt-1 border-l-2 border-cyan-500/40 pl-3 text-sm leading-6 text-slate-400">
                {s.zh}
              </p>
            )}
          </div>
        );
      })}
    </article>
  );
}

interface WordSpanProps {
  raw: string;
  entry: ReadingGlossaryEntry | undefined;
  highlight: boolean;
  saved: boolean;
  onWordClick: (raw: string, entry: ReadingGlossaryEntry | undefined, e: React.MouseEvent) => void;
}

function WordSpan({ raw, entry, highlight, saved, onWordClick }: WordSpanProps) {
  const clickable = !!entry;
  const style: CSSProperties = {};
  let cls = '';
  if (clickable) {
    cls = 'cursor-pointer border-b border-dotted border-slate-500/70 transition-colors hover:text-cyan-300 hover:border-cyan-400';
  }
  if (saved) {
    cls += ' text-amber-300 border-amber-500/60';
  } else if (highlight && clickable && entry && !entry.mastered) {
    // 生词高亮：未掌握词标底纹
    cls += ' rounded-sm bg-amber-400/15';
  }
  if (!entry) {
    // 词表未收录的常见词：点词无数据，普通样式
    cls += ' text-slate-300';
  }
  if (clickable) {
    return (
      <span
        className={cls}
        style={style}
        onClick={(e) => {
          e.stopPropagation();
          onWordClick(raw, entry, e);
        }}
      >
        {raw}
      </span>
    );
  }
  return <span className={cls}>{raw}</span>;
}
