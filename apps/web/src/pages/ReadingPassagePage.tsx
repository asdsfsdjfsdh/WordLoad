// 真题阅读主页面：原文 + 点词 + 句译 + 高亮 + 答题 + 计时 + 进度
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { normalizeReadingWord } from '@word-journey/shared';
import type { ReadingGlossaryEntry, ReadingPassageDetail, ReadingSubmitResponse } from '@word-journey/shared';
import {
  fetchReadingPassageDetail,
  fetchReadingPapers,
  lookupReadingWordApi,
  markReadingWord,
  saveReadingProgress,
  submitReadingAnswers,
} from '../lib/reading';
import { ReadingText } from '../components/reading/ReadingText';
import { WordPopover, type WordPopoverState } from '../components/reading/WordPopover';
import { QuestionList } from '../components/reading/QuestionList';
import { ReadingIntensiveModal } from '../components/reading/ReadingIntensiveModal';
import { ThemeSwitcher, type ReadingTheme } from '../components/reading/ThemeSwitcher';
import { getTts } from '../lib/tts';

export function ReadingPassagePage() {
  const { passageId } = useParams();
  const id = Number(passageId);
  const { data: papers } = useQuery({ queryKey: ['reading', 'papers'], queryFn: fetchReadingPapers });
  const { data: detail, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['reading', 'passage', id],
    queryFn: () => fetchReadingPassageDetail(id),
    enabled: Number.isFinite(id) && id > 0,
  });

  const [showZh, setShowZh] = useState(false);
  const [highlight, setHighlight] = useState(true);
  const [structureOn, setStructureOn] = useState(true);
  const [intensive, setIntensive] = useState(false);
  const [activeWord, setActiveWord] = useState<WordPopoverState | null>(null);
  const [selectedSentence, setSelectedSentence] = useState<number | null>(null);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [result, setResult] = useState<ReadingSubmitResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [savedWords, setSavedWords] = useState<Set<string>>(new Set());
  // 单词库状态（生词判定）：初始来自 detail，移出生词后乐观更新，避免整页 refetch
  const [wordStatus, setWordStatus] = useState<Record<string, { mastered: boolean; learned?: boolean; tier?: string }>>({});
  // 移出生词失败提示（词库未收录的词无法入图鉴）
  const [learnError, setLearnError] = useState<string | null>(null);
  const [visibleSeq, setVisibleSeq] = useState<number | null>(null);
  const [readingTheme, setReadingTheme] = useState<ReadingTheme>(() => {
    const saved = localStorage.getItem('reading-theme');
    return saved === 'light' || saved === 'sepia' ? saved : 'dark';
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const sentenceRefs = useRef<Map<number, HTMLElement>>(new Map());
  const visibleSeqRef = useRef<number | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 初始化：答案回显 + 已收藏生词
  useEffect(() => {
    if (!detail) return;
    setAnswers(detail.progress.answered);
    setSavedWords(new Set(detail.savedWords.map((w) => normalizeReadingWord(w))));
    setWordStatus(detail.wordStatus ?? {});
    setResult(null);
    setSubmitError(null);
    setActiveWord(null);
    setSelectedSentence(null);
  }, [detail?.id]);

  // 阅读主题持久化（仅作用于阅读页）
  useEffect(() => {
    localStorage.setItem('reading-theme', readingTheme);
  }, [readingTheme]);

  // 滚动定位：恢复上次读到位置
  useEffect(() => {
    if (!detail || !containerRef.current) return;
    const target = detail.progress.currentSentence;
    const el = sentenceRefs.current.get(target);
    if (el) {
      requestAnimationFrame(() => el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior }));
    }
  }, [detail?.id]);

  // 可见句检测 + 防抖保存进度（visibleSeq 用 ref 记录，避免 effect 反复重建监听器）
  useEffect(() => {
    if (!detail) return;
    const onScroll = (): void => {
      const box = containerRef.current?.getBoundingClientRect();
      if (!box) return;
      const mid = box.top + box.height / 2;
      let best: { seq: number; dist: number } | null = null;
      for (const [seq, el] of sentenceRefs.current) {
        const r = el.getBoundingClientRect();
        const dist = Math.abs(r.top + r.height / 2 - mid);
        if (!best || dist < best.dist) best = { seq, dist };
      }
      if (best && best.seq !== visibleSeqRef.current) {
        visibleSeqRef.current = best.seq;
        setVisibleSeq(best.seq);
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => {
          saveReadingProgress(id, { currentSentence: best.seq }).catch(() => undefined);
        }, 600);
      }
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [detail?.id, id]);

  const paper = papers?.find((p) => p.id === detail?.paperId);

  const onWordClick = useCallback(
    (raw: string, entry: ReadingGlossaryEntry | undefined, e: React.MouseEvent) => {
      setSelectedSentence(null);
      setLearnError(null);
      setActiveWord({ raw, entry, x: e.clientX, y: e.clientY });
      // 篇内词表未命中 → 回退单词库查询
      if (!entry) {
        lookupReadingWordApi(id, raw)
          .then((r) => {
            if (r.found && r.meaning) {
              setActiveWord((prev) =>
                prev && prev.raw === raw
                  ? { ...prev, entry: { word: r.word ?? raw, meaning: r.meaning ?? '', phonetic: r.phonetic, source: r.source } }
                  : prev,
              );
            }
          })
          .catch(() => undefined);
      }
    },
    [id],
  );

      // 把某个词标记为"已学"（入图鉴）：生词高亮随之消失
  const applyLearned = useCallback((word: string) => {
    const key = normalizeReadingWord(word);
    setWordStatus((prev) => {
      const cur = prev[key];
      if (cur?.learned) return prev;
      return { ...prev, [key]: { mastered: cur?.mastered ?? false, learned: true, tier: cur?.tier } };
    });
  }, []);

  const toggleSave = useCallback(
    (word: string, action: 'save' | 'remove') => {
      setSavedWords((prev) => {
        const next = new Set(prev);
        if (action === 'save') next.add(normalizeReadingWord(word));
        else next.delete(normalizeReadingWord(word));
        return next;
      });
      markReadingWord(id, word, action)
        .then((res) => {
          setSavedWords(new Set(res.savedWords.map((w) => normalizeReadingWord(w))));
          // 收藏即入图鉴 → 该词不再是生词
          if (res.learned === true) applyLearned(word);
        })
        .catch(() => undefined);
    },
    [id, applyLearned],
  );

  const markLearned = useCallback(
    (word: string) => {
      markReadingWord(id, word, 'learn')
        .then((res) => {
          if (res.learned === true) {
            applyLearned(word);
            setLearnError(null);
          } else {
            setLearnError('该词暂未收录到单词库，无法移出生词');
          }
        })
        .catch(() => setLearnError('操作失败，请重试'));
    },
    [id, applyLearned],
  );

  const onSubmit = useCallback(async () => {
    if (!detail || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const payload = detail.questions.map((q) => ({ seq: q.seq, choice: answers[q.seq] ?? '' })).filter((a) => a.choice);
      const res = await submitReadingAnswers(id, payload);
      setResult(res);
      setAnswers(res.results.reduce<Record<number, string>>((acc, r) => {
        if (r.choice) acc[r.seq] = r.choice;
        return acc;
      }, {}));
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : '提交失败，请重试');
    } finally {
      setSubmitting(false);
    }
  }, [detail, id, answers, submitting]);

  const hasStructure = detail?.sentences.some((s) => s.structure?.clauses?.length) ?? false;
  const hasZh = detail?.sentences.some((s) => s.zh) ?? false;
  const activeLearned = activeWord
    ? (wordStatus[normalizeReadingWord(activeWord.raw)]?.learned ?? activeWord.entry?.learned ?? false)
    : false;

  return (
    <div data-reading-theme={readingTheme} className="min-h-screen bg-slate-950 text-slate-100">
      {isLoading || !detail ? (
        <div className="flex min-h-screen items-center justify-center">
          <p className="text-slate-400">{isError ? `加载失败：${error instanceof Error ? error.message : '未知错误'}` : '加载中…'}</p>
          {isError && (
            <button onClick={() => refetch()} className="ml-2 text-cyan-400 underline">重试</button>
          )}
        </div>
      ) : (
      <>
      {/* 顶栏 */}
      <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/90 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3">
          <Link to="/reading" className="text-sm text-slate-400 transition hover:text-cyan-300">← 真题</Link>
          <div className="min-w-0">
            <h1 className="truncate text-base font-bold text-slate-100">
              {detail.year} {detail.title} {detail.subtitle ? `· ${detail.subtitle}` : ''}
            </h1>
            <p className="text-xs text-slate-500">{detail.examName}</p>
          </div>

          {/* 篇目切换 */}
          {paper && (
            <nav className="flex gap-1.5">
              {paper.passages.map((pa) => (
                <Link
                  key={pa.id}
                  to={`/reading/passage/${pa.id}`}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                    pa.id === detail.id ? 'bg-cyan-500/20 text-cyan-300 ring-1 ring-cyan-500/40' : 'bg-slate-800/60 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {pa.title}
                </Link>
              ))}
            </nav>
          )}

          <div className="ml-auto flex items-center gap-2">
            <ThemeSwitcher value={readingTheme} onChange={setReadingTheme} />
            <ReadingTimer />
            <button
              onClick={() => setStructureOn((v) => !v)}
              disabled={!hasStructure}
              title={hasStructure ? '切换结构标注' : '本年度暂无结构标注'}
              className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                !hasStructure
                  ? 'cursor-not-allowed border-slate-800 bg-slate-900/60 text-slate-600'
                  : structureOn
                    ? 'border-violet-500/40 bg-violet-500/10 text-violet-300'
                    : 'border-slate-700 bg-slate-800/60 text-slate-400'
              }`}
            >
              结构
            </button>
            <button
              onClick={() => setHighlight((v) => !v)}
              className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                highlight ? 'border-amber-500/40 bg-amber-500/10 text-amber-300' : 'border-slate-700 bg-slate-800/60 text-slate-400'
              }`}
            >
              生词高亮
            </button>
            <button
              onClick={() => setShowZh((v) => !v)}
              disabled={!hasZh}
              title={hasZh ? '切换译文' : '本年度暂无译文'}
              className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                !hasZh
                  ? 'cursor-not-allowed border-slate-800 bg-slate-900/60 text-slate-600'
                  : showZh
                    ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300'
                    : 'border-slate-700 bg-slate-800/60 text-slate-400'
              }`}
            >
              译文
            </button>
            <button
              onClick={() => {
                setIntensive(true);
                setActiveWord(null);
              }}
              className="rounded-lg border border-slate-700 bg-slate-800/60 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:border-cyan-500/40 hover:text-cyan-300"
            >
              精读
            </button>
            <button
              onClick={() => getTts().speak(detail.content, { rate: 0.9 })}
              title="朗读全文"
              className="rounded-lg border border-slate-700 bg-slate-800/60 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:border-cyan-500/40 hover:text-cyan-300"
            >
              朗读
            </button>
          </div>
        </div>

        {/* 进度条 */}
        <div className="mx-auto mt-2 flex max-w-6xl items-center gap-3 text-[11px] text-slate-500">
          <span>本篇 {detail.progress.status === 'done' ? '已完成' : detail.progress.status === 'reading' ? '阅读中' : '未开始'}</span>
          {detail.progress.totalQuestions > 0 && (
            <span>答题 {detail.progress.correctCount}/{detail.progress.totalQuestions} · 最高 {detail.progress.bestScore} 分</span>
          )}
          <span>已收藏 {savedWords.size} 词</span>
        </div>
      </header>

      {/* 主体 */}
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[1.6fr_1fr]">
        {/* 原文 */}
        <div ref={containerRef} className="min-w-0">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-[.2em] text-slate-500">{detail.title}</h2>
            <span className="text-xs text-slate-600">点击单词查看释义 · 点击句子查看译文</span>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 sm:p-6">
            <ReadingText
              sentences={detail.sentences}
              glossary={detail.glossary}
              wordStatus={wordStatus}
              showZh={showZh}
              highlight={highlight}
              structureOn={structureOn}
              savedWords={savedWords}
              selectedSentence={selectedSentence}
              onWordClick={onWordClick}
              onSentenceClick={(seq) => {
                setSelectedSentence((cur) => (cur === seq ? null : seq));
                setActiveWord(null);
              }}
            />
          </div>
        </div>

        {/* 题目 */}
        <aside className="min-w-0">
          <div className="sticky top-24 space-y-4 rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
            <QuestionList
              questions={detail.questions}
              answers={answers}
              onSelect={(seq, choice) =>
                setAnswers((prev) => ({ ...prev, [seq]: choice }))
              }
              result={result}
              submitting={submitting}
              submitError={submitError}
              onSubmit={() => onSubmit()}
            />
          </div>
        </aside>
      </div>

      {/* 句内词 span 引用收集 */}
      <SentenceRefsCollector sentences={detail.sentences} sentenceRefs={sentenceRefs} />

      {activeWord && (
        <WordPopover
          state={activeWord}
          saved={savedWords.has(normalizeReadingWord(activeWord.raw))}
          learned={activeLearned}
          markError={learnError}
          onToggleSave={toggleSave}
          onMarkLearned={markLearned}
          onClose={() => setActiveWord(null)}
        />
      )}

      {intensive && (
        <ReadingIntensiveModal
          sentences={detail.sentences}
          glossary={detail.glossary}
          savedWords={savedWords}
          initialSeq={visibleSeq ?? detail.progress.currentSentence}
          onClose={() => setIntensive(false)}
          onSentenceChange={(seq) => {
            setVisibleSeq(seq);
            saveReadingProgress(id, { currentSentence: seq }).catch(() => undefined);
          }}
          onToggleSave={toggleSave}
          onMarkLearned={markLearned}
          lookupWord={async (raw) => {
            const r = await lookupReadingWordApi(id, raw).catch(() => ({ found: false as const }));
            return r.found ? { word: r.word ?? raw, meaning: r.meaning ?? '', phonetic: r.phonetic, source: r.source } : undefined;
          }}
        />
      )}
      </>
      )}
    </div>
  );
}

// 计时器：自持 state，避免整页每秒重渲染
function ReadingTimer() {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <span className="hidden rounded-full bg-slate-800/60 px-2.5 py-1 text-xs tabular-nums text-slate-300 sm:inline">
      ⏱ {`${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`}
    </span>
  );
}

// 将句子 DOM 引用注册到 Map，供可见句检测 / 恢复定位用
function SentenceRefsCollector({
  sentences,
  sentenceRefs,
}: {
  sentences: ReadingPassageDetail['sentences'];
  sentenceRefs: React.MutableRefObject<Map<number, HTMLElement>>;
}) {
  useEffect(() => {
    sentenceRefs.current = new Map(
      sentences
        .map((s) => {
          const el = document.querySelector<HTMLElement>(`[data-sentence="${s.seq}"]`);
          return el ? ([s.seq, el] as const) : null;
        })
        .filter((x): x is readonly [number, HTMLElement] => x !== null),
    );
  }, [sentences, sentenceRefs]);
  return null;
}
