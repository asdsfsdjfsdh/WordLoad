// 阅读原文渲染：逐句 + 分词 span（点词 / 句译 / 生词高亮 / 结构融合标注）
import { useMemo } from 'react';
import type {
  ReadingClauseRole,
  ReadingGlossaryEntry,
  ReadingSentenceView,
} from '@word-journey/shared';
import {
  assignTokenClauses,
  clauseRoleInfo,
  isReadingBaseWord,
  locateClauseSpans,
  lookupReadingWord,
  tokenizeReadingSentence,
} from '@word-journey/shared';
import { StructureCard, StructureLegend } from './StructureCard';

export interface ReadingTextProps {
  sentences: ReadingSentenceView[];
  glossary: ReadingGlossaryEntry[];
  // 单词库掌握度：词(小写) → { mastered, tier }（生词判定）
  wordStatus?: Record<string, { mastered: boolean; tier?: string }>;
  showZh: boolean;
  highlight: boolean;
  structureOn: boolean;
  savedWords: Set<string>;
  selectedSentence: number | null;
  onWordClick: (raw: string, entry: ReadingGlossaryEntry | undefined, e: React.MouseEvent) => void;
  onSentenceClick: (seq: number) => void;
}

export function ReadingText({
  sentences,
  glossary,
  wordStatus,
  showZh,
  highlight,
  structureOn,
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

  // 每句 token → 从句角色（结构着色）
  const roleCache = useMemo(() => {
    const m = new Map<number, (ReadingClauseRole | undefined)[]>();
    for (const s of sentences) {
      if (s.structure?.clauses?.length) {
        const tokens = tokensCache.get(s.seq) ?? [];
        const spans = locateClauseSpans(s.en, s.structure.clauses);
        m.set(s.seq, assignTokenClauses(tokens, spans));
      }
    }
    return m;
  }, [sentences, tokensCache]);

  const legendRoles = useMemo(() => {
    const roles = new Set<ReadingClauseRole>();
    for (const s of sentences) {
      for (const c of s.structure?.clauses ?? []) roles.add(c.role);
    }
    return [...roles];
  }, [sentences]);

  return (
    <article className="space-y-5 text-[15px] leading-7 text-slate-200 sm:text-base sm:leading-8">
      {structureOn && <StructureLegend roles={legendRoles} />}
      {sentences.map((s) => {
        const tokens = tokensCache.get(s.seq) ?? [];
        const roles = roleCache.get(s.seq) ?? [];
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
                    word={t.word}
                    entry={lookupReadingWord(glossaryMap, t.word)}
                    wordStatus={wordStatus}
                    role={roles[i]}
                    structureOn={structureOn}
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
              <p className="mt-1 border-l-2 border-cyan-500/40 pl-3 text-sm leading-6 text-slate-400">{s.zh}</p>
            )}
            {/* 结构融合标注：句子下方（小字但可读） */}
            {structureOn && s.structure && (
              <StructureCard structure={s.structure} className="mt-2 border-t border-slate-800/80 pt-2" />
            )}
          </div>
        );
      })}
    </article>
  );
}

interface WordSpanProps {
  raw: string;
  word: string;
  entry: ReadingGlossaryEntry | undefined;
  wordStatus?: Record<string, { mastered: boolean; tier?: string }>;
  role?: ReadingClauseRole;
  structureOn: boolean;
  highlight: boolean;
  saved: boolean;
  onWordClick: (raw: string, entry: ReadingGlossaryEntry | undefined, e: React.MouseEvent) => void;
}

function WordSpan({ raw, word, entry, wordStatus, role, structureOn, highlight, saved, onWordClick }: WordSpanProps) {
  // 生词判定：有学习数据 + 未掌握 + 非基础词 + 非 tier-I 豁免
  const st = wordStatus?.[word];
  const mastered = st?.mastered === true || entry?.mastered === true;
  const hasData = !!entry || st !== undefined;
  const isNew = hasData && !mastered && !isReadingBaseWord(word) && st?.tier !== 'I';

  let cls = 'cursor-pointer transition-colors hover:text-cyan-300';
  if (structureOn && role) {
    cls += ` ${clauseRoleInfo(role).spanClass}`;
  } else if (highlight && isNew) {
    cls += ' rounded-sm bg-amber-400/20';
  }
  if (saved) {
    cls += ' text-amber-300';
  } else if (highlight && isNew) {
    // 生词标记（结构着色时也保持可辨：琥珀色文字）
    cls += ' text-amber-200';
  }
  if (entry) {
    cls += ' border-b border-dotted border-slate-500/70 hover:border-cyan-400';
  }
  return (
    <span
      className={cls}
      onClick={(e) => {
        e.stopPropagation();
        onWordClick(raw, entry, e);
      }}
    >
      {raw}
    </span>
  );
}
