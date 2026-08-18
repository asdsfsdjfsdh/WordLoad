// 阅读原文渲染：逐句 + 分词 span（点词 / 句译 / 生词高亮 / 结构融合标注）
// 结构着色按"相邻同角色 run"连续渲染（背景跨词连成一块），而非逐词
import { Fragment, memo, useMemo } from 'react';
import type {
  ReadingClauseRole,
  ReadingGlossaryEntry,
  ReadingSentenceView,
  ReadingTokenRun,
} from '@word-journey/shared';
import {
  assignTokenClauses,
  clauseRoleInfo,
  groupReadingRoleRuns,
  isReadingBaseWord,
  locateClauseSpans,
  lookupReadingWord,
  tokenizeReadingSentence,
} from '@word-journey/shared';
import { StructureCard, StructureLegend } from './StructureCard';

export interface ReadingTextProps {
  sentences: ReadingSentenceView[];
  glossary: ReadingGlossaryEntry[];
  // 单词库状态：词(小写) → { mastered, learned, tier }（生词判定：未入图鉴即生词）
  wordStatus?: Record<string, { mastered: boolean; learned?: boolean; tier?: string }>;
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

  // 每句相邻同角色 token 归并为 run（连续着色单位）
  const runsCache = useMemo(() => {
    const m = new Map<number, ReadingTokenRun[]>();
    for (const s of sentences) {
      const tokens = tokensCache.get(s.seq) ?? [];
      const roles = roleCache.get(s.seq) ?? [];
      m.set(s.seq, groupReadingRoleRuns(tokens, roles));
    }
    return m;
  }, [sentences, tokensCache, roleCache]);

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
        const runs = runsCache.get(s.seq) ?? [];
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
              {runs.map((run, ri) => {
                const colored = structureOn && run.role !== undefined;
                const children = run.tokens.map((t) =>
                  t.word ? (
                    <WordSpan
                      key={t.index}
                      raw={t.text}
                      word={t.word}
                      entry={lookupReadingWord(glossaryMap, t.word)}
                      wordStatus={wordStatus}
                      roleActive={colored}
                      highlight={highlight}
                      saved={savedWords.has(t.word)}
                      onWordClick={onWordClick}
                    />
                  ) : (
                    <span key={t.index} className="whitespace-pre-wrap">{t.text}</span>
                  ),
                );
                return colored ? (
                  <span key={ri} className={clauseRoleInfo(run.role).spanClass}>
                    {children}
                  </span>
                ) : (
                  <Fragment key={ri}>{children}</Fragment>
                );
              })}
            </p>
            {(showZh || selected) && s.zh && (
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
  wordStatus?: Record<string, { mastered: boolean; learned?: boolean; tier?: string }>;
  // 是否位于着色 run 内：背景/文字色由外层 run 提供，单词自身不再叠加角色背景
  roleActive: boolean;
  highlight: boolean;
  saved: boolean;
  onWordClick: (raw: string, entry: ReadingGlossaryEntry | undefined, e: React.MouseEvent) => void;
}

const WordSpan = memo(function WordSpan({ raw, word, entry, wordStatus, roleActive, highlight, saved, onWordClick }: WordSpanProps) {
  // 生词判定：非基础词、非专有名词（人名/地名/句首大写），且从未入图鉴（无学习进度）即生词
  // 收藏/标记已学/游戏学习都会使其离开生词
  const st = wordStatus?.[word];
  const learned = !!(st?.learned || entry?.learned);
  const isCapitalized = /^[A-Z]/.test(raw);
  const isNew = !isReadingBaseWord(word) && !isCapitalized && !learned;

  let cls = 'cursor-pointer transition-colors hover:text-cyan-300';
  if (!roleActive && highlight && isNew) cls += ' rounded-sm bg-amber-400/20';
  if (saved) {
    cls += ' text-amber-300';
  } else if (!roleActive && highlight && isNew) {
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
});