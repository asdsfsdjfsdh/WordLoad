// 真题阅读主页面：原文 + 点词 + 句译 + 高亮 + 答题 + 计时 + 进度
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import type { ReadingGlossaryEntry, ReadingPassageDetail, ReadingSubmitResponse } from '@word-journey/shared';
import {
  fetchReadingPassageDetail,
  fetchReadingPapers,
  markReadingWord,
  saveReadingProgress,
  submitReadingAnswers,
} from '../lib/reading';
import { ReadingText } from '../components/reading/ReadingText';
import { WordPopover, type WordPopoverState } from '../components/reading/WordPopover';
import { QuestionList } from '../components/reading/QuestionList';
import { ReadingIntensiveModal } from '../components/reading/ReadingIntensiveModal';
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
  const [intensive, setIntensive] = useState(false);
  const [activeWord, setActiveWord] = useState<WordPopoverState | null>(null);
  const [selectedSentence, setSelectedSentence] = useState<number | null>(null);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [result, setResult] = useState<ReadingSubmitResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [savedWords, setSavedWords] = useState<Set<string>>(new Set());
  const [elapsed, setElapsed] = useState(0);
  const [visibleSeq, setVisibleSeq] = useState<number | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const sentenceRefs = useRef<Map<number, HTMLElement>>(new Map());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 初始化：答案回显 + 已收藏生词
  useEffect(() => {
    if (!detail) return;
    setAnswers(detail.progress.answered);
    setSavedWords(new Set(detail.savedWords.map((w) => w.toLowerCase())));
    setResult(null);
    setActiveWord(null);
    setSelectedSentence(null);
  }, [detail?.id]);

  // 计时器
  useEffect(() => {
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // 滚动定位：恢复上次读到位置
  useEffect(() => {
    if (!detail || !containerRef.current) return;
    const target = detail.progress.currentSentence;
    const el = sentenceRefs.current.get(target);
    if (el) {
      requestAnimationFrame(() => el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior }));
    }
  }, [detail?.id]);

  // 可见句检测 + 防抖保存进度
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
      if (best && best.seq !== visibleSeq) {
        setVisibleSeq(best.seq);
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => {
          saveReadingProgress(id, { currentSentence: best.seq }).catch(() => undefined);
        }, 600);
      }
    };
    onScroll();
    containerRef.current?.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      containerRef.current?.removeEventListener('scroll', onScroll);
      window.removeEventListener('scroll', onScroll);
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [detail?.id, visibleSeq, id]);

  const paper = papers?.find((p) => p.id === detail?.paperId);

  const onWordClick = useCallback((raw: string, entry: ReadingGlossaryEntry | undefined, e: React.MouseEvent) => {
    setSelectedSentence(null);
    setActiveWord({ raw, entry, x: e.clientX, y: e.clientY });
  }, []);

  const toggleSave = useCallback(
    (word: string, action: 'save' | 'remove') => {
      setSavedWords((prev) => {
        const next = new Set(prev);
        if (action === 'save') next.add(word.toLowerCase());
        else next.delete(word.toLowerCase());
        return next;
      });
      markReadingWord(id, word, action)
        .then((res) => {
          setSavedWords(new Set(res.savedWords.map((w) => w.toLowerCase())));
        })
        .catch(() => undefined);
    },
    [id],
  );

  const onSubmit = useCallback(async () => {
    if (!detail || submitting) return;
    setSubmitting(true);
    try {
      const payload = detail.questions.map((q) => ({ seq: q.seq, choice: answers[q.seq] ?? '' })).filter((a) => a.choice);
      const res = await submitReadingAnswers(id, payload);
      setResult(res);
      setAnswers(res.results.reduce<Record<number, string>>((acc, r) => {
        if (r.choice) acc[r.seq] = r.choice;
        return acc;
      }, {}));
    } finally {
      setSubmitting(false);
    }
  }, [detail, id, answers, submitting]);

  const mm = useMemo(() => `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`, [elapsed]);

  if (isLoading || !detail) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-400">
        <p>{isError ? `加载失败：${error instanceof Error ? error.message : '未知错误'}` : '加载中…'}</p>
        {isError && (
          <button onClick={() => refetch()} className="ml-2 text-cyan-400 underline">重试</button>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
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
            <span className="hidden rounded-full bg-slate-800/60 px-2.5 py-1 text-xs tabular-nums text-slate-300 sm:inline">
              ⏱ {mm}
            </span>
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
              className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                showZh ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300' : 'border-slate-700 bg-slate-800/60 text-slate-400'
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
              showZh={showZh}
              highlight={highlight}
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
          saved={savedWords.has(activeWord.raw.toLowerCase())}
          onToggleSave={toggleSave}
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
        />
      )}
    </div>
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
