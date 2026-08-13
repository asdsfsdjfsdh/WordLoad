import { useCallback, useEffect, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { LevelWord } from '@word-journey/shared';
import { getTts } from '../lib/tts';
import { useIsTouch } from '../lib/touch';

interface Props {
  words: LevelWord[];
  skippedWords: Set<string>;
  onSkip: (wordId: string) => void;
}

const tierColor = (t?: string) => {
  if (t === 'I') return 'bg-cyan-500/20 text-cyan-300';
  if (t === 'II') return 'bg-emerald-500/20 text-emerald-300';
  if (t === 'III') return 'bg-amber-500/20 text-amber-300';
  if (t === 'IV') return 'bg-rose-500/20 text-rose-300';
  return 'bg-slate-700/40 text-slate-400';
};

const statusStyle = (s: string) => {
  if (s === 'new') return { badge: 'bg-sky-500/15 text-sky-300', label: '新词' };
  if (s === 'review') return { badge: 'bg-amber-500/15 text-amber-300', label: '复习' };
  if (s === 'wrongbook') return { badge: 'bg-red-500/15 text-red-300', label: '错题' };
  if (s === 'mastered') return { badge: 'bg-emerald-500/15 text-emerald-300', label: '已掌握' };
  return { badge: 'bg-slate-500/15 text-slate-400', label: '' };
};

export function FlashCard({ words, skippedWords, onSkip }: Props) {
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [knownIds, setKnownIds] = useState<Set<string>>(new Set());
  const [unknownIds, setUnknownIds] = useState<Set<string>>(new Set());
  const [finished, setFinished] = useState(false);

  // 拼写巩固：不认识词每词拼写3遍（提示递减：看词→听音→回忆）
  const [rewriting, setRewriting] = useState(false);
  const [rewriteIdx, setRewriteIdx] = useState(0);
  const [rewriteCount, setRewriteCount] = useState(0);
  const [rewriteLetters, setRewriteLetters] = useState<string[]>([]);
  const [rewriteCursor, setRewriteCursor] = useState(0);
  const [rewriteFeedback, setRewriteFeedback] = useState<'correct' | 'wrong' | null>(null);
  const [rewriteDone, setRewriteDone] = useState(false);
  // 闪电拼写：拼写完成后看释义拼写单词（拼错排到队尾）
  const [recalling, setRecalling] = useState(false);
  const [recallIdx, setRecallIdx] = useState(0);
  const [recallQueue, setRecallQueue] = useState<LevelWord[]>([]);
  const [recallLetters, setRecallLetters] = useState<string[]>([]);
  const [recallCursor, setRecallCursor] = useState(0);
  const [recallFeedback, setRecallFeedback] = useState<'correct' | 'wrong' | null>(null);

  const isTouch = useIsTouch();
  const rewriteInputRef = useRef<HTMLInputElement | null>(null);
  const recallInputRef = useRef<HTMLInputElement | null>(null);

  // 移动端滑卡：右滑 = 认识，左滑 = 不认识（pointer 事件，水平判定）
  const cardRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; dragging: boolean } | null>(null);
  const swipeLockRef = useRef(false);
  const [cardXTx, setCardXTx] = useState(0);
  const [swipeFlash, setSwipeFlash] = useState<'known' | 'unknown' | null>(null);
  const SWIPE_THRESHOLD = 72;

  const active = words.filter((w) => !skippedWords.has(w.wordId));
  const total = active.length;

  // 不认识词列表（用于拼写巩固）
  const unknownWords = active.filter((w) => unknownIds.has(w.wordId));

  // 当前巩固词
  const rwWord = rewriting && rewriteIdx < unknownWords.length ? unknownWords[rewriteIdx] : null;
  const rwLen = rwWord?.text.length ?? 0;

  const goTo = useCallback((i: number) => {
    const clamped = Math.max(0, Math.min(total - 1, i));
    setIndex(clamped);
    setFlipped(false);
  }, [total]);

  const skipCurrent = () => {
    const w = active[index];
    if (!w) return;
    // 斩词实时生效：从当前列表移除该词后，重算停留位置
    // （补词异步追加到末尾：若斩完没有更多词，由 total===0 分支显示「全部已斩」，补词到达后自然恢复预习）
    const nextActive = active.filter((x) => x.wordId !== w.wordId);
    onSkip(w.wordId);
    if (nextActive.length === 0) {
      // 全部斩完：复位 index，补词到达后从第一个开始
      setIndex(0);
      setFlipped(false);
      return;
    }
    const nextIndex = Math.max(0, Math.min(index, nextActive.length - 1));
    setIndex(nextIndex);
    setFlipped(false);
  };

  // 列表因斩词/补词变化时，保证 index 不越界（不依赖过期 total）
  useEffect(() => {
    if (active.length === 0) return;
    if (index >= active.length) {
      setIndex(active.length - 1);
    }
  }, [active.length, index]);

  // 完成判定：所有未斩词都已被标记（集合比较，天然免疫斩词/补词导致的顺序变化）
  const allMarked =
    active.length > 0 && active.every((w) => knownIds.has(w.wordId) || unknownIds.has(w.wordId));
  useEffect(() => {
    // 双向闩锁：全部标记 → finished；补词异步到达后有新未标记词 → 回到闪卡继续复习
    if (active.length > 0 && allMarked) {
      setFinished(true);
    } else if (
      finished &&
      !allMarked &&
      !rewriting &&
      !rewriteDone &&
      !recalling
    ) {
      setFinished(false);
    }
  }, [finished, allMarked, active.length, rewriting, rewriteDone, recalling]);

  const markAndAdvance = (type: 'known' | 'unknown') => {
    const w = active[index];
    if (!w || finished) return;

    if (type === 'known') {
      setKnownIds((prev) => new Set(prev).add(w.wordId));
    } else {
      setUnknownIds((prev) => new Set(prev).add(w.wordId));
    }

    if (index < active.length - 1) {
      setIndex(index + 1);
      setFlipped(false);
    }
  };

  // 闪卡阶段键盘：空格翻转 · ← 不认识 → 认识 · Backspace 撤回
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (finished) return;
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (!flipped) {
          setFlipped(true);
          getTts().speak(active[index]?.text ?? '');
        }
        return;
      }
      if (!flipped) return;
      if (e.key === 'ArrowLeft' || e.key === 'a') {
        e.preventDefault();
        markAndAdvance('unknown');
      }
      if (e.key === 'ArrowRight' || e.key === 'd') {
        e.preventDefault();
        markAndAdvance('known');
      }
      if (e.key === 'Backspace') {
        e.preventDefault();
        if (index > 0) {
          const prev = active[index - 1];
          if (prev) {
            setKnownIds((p) => { const n = new Set(p); n.delete(prev.wordId); return n; });
            setUnknownIds((p) => { const n = new Set(p); n.delete(prev.wordId); return n; });
          }
          goTo(index - 1);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [flipped, index, active, finished, goTo, markAndAdvance]);

  // 拼写巩固键盘处理（触屏用原生输入框，不挂全局键盘）
  useEffect(() => {
    if (!rewriting || !rwWord) return;
    if (isTouch) return;
    const handler = (e: KeyboardEvent) => {
      if (rewriteFeedback === 'correct') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Backspace') {
        e.preventDefault();
        if (rewriteCursor > 0) {
          const next = [...rewriteLetters];
          next[rewriteCursor - 1] = '';
          setRewriteLetters(next);
          setRewriteCursor(rewriteCursor - 1);
        }
        return;
      }
      if (!/^[a-zA-Z\-']$/.test(e.key)) return;
      e.preventDefault();
      if (rewriteCursor >= rwLen) return;
      const ch = e.key.toLowerCase();
      const next = [...rewriteLetters];
      next[rewriteCursor] = ch;
      setRewriteLetters(next);
      const nc = rewriteCursor + 1;
      setRewriteCursor(nc);
      if (nc >= rwLen) {
        const word = next.join('');
        if (word === rwWord.text.toLowerCase()) {
          setRewriteFeedback('correct');
          const newCount = rewriteCount + 1;
          setTimeout(() => {
            if (newCount >= 3) {
              setRewriteIdx((i) => i + 1);
              setRewriteCount(0);
              setRewriteLetters([]);
              setRewriteCursor(0);
            } else {
              setRewriteCount(newCount);
              setRewriteLetters([]);
              setRewriteCursor(0);
            }
            setRewriteFeedback(null);
          }, 350);
        } else {
          setRewriteFeedback('wrong');
          setTimeout(() => {
            setRewriteLetters([]);
            setRewriteCursor(0);
            setRewriteFeedback(null);
          }, 400);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [rewriting, rwWord, rwLen, rewriteCursor, rewriteLetters, rewriteCount, rewriteFeedback, isTouch]);

  // 触屏：每题/每遍切换自动聚焦拼写输入框
  useEffect(() => {
    if (isTouch && rewriting && rwWord) {
      const t = setTimeout(() => rewriteInputRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [isTouch, rewriting, rwWord, rewriteIdx, rewriteCount]);

  // 触屏拼写输入：输入值 → 字母槽直通，填满复用键盘判定逻辑
  const onRewriteInput = (e: ChangeEvent<HTMLInputElement>) => {
    if (!rwWord || rewriteFeedback === 'correct') return;
    const capped = e.target.value
      .replace(/[^a-zA-Z\-']/g, '')
      .toLowerCase()
      .slice(0, rwLen);
    const next = Array.from({ length: rwLen }, (_, i) => capped[i] ?? '');
    setRewriteLetters(next);
    setRewriteCursor(capped.length);
    if (capped.length >= rwLen) {
      if (capped === rwWord.text.toLowerCase()) {
        setRewriteFeedback('correct');
        const newCount = rewriteCount + 1;
        setTimeout(() => {
          if (newCount >= 3) {
            setRewriteIdx((i) => i + 1);
            setRewriteCount(0);
            setRewriteLetters([]);
            setRewriteCursor(0);
          } else {
            setRewriteCount(newCount);
            setRewriteLetters([]);
            setRewriteCursor(0);
          }
          setRewriteFeedback(null);
        }, 350);
      } else {
        setRewriteFeedback('wrong');
        setTimeout(() => {
          setRewriteLetters([]);
          setRewriteCursor(0);
          setRewriteFeedback(null);
        }, 400);
      }
    }
  };

  // 初始化字母槽
  useEffect(() => {
    if (rewriting && rwWord) {
      setRewriteLetters(Array.from({ length: rwLen }, () => ''));
      setRewriteCursor(0);
      setRewriteCount(0);
      setRewriteFeedback(null);
    }
  }, [rewriteIdx, rewriting, rwWord, rwLen]);

  // 巩固完成检测：全部不认识词写完 3 遍 → 进入闪电复核
  useEffect(() => {
    if (rewriting && rewriteIdx >= unknownWords.length && unknownWords.length > 0) {
      setRewriting(false);
      setRewriteDone(true);
    }
  }, [rewriteIdx, rewriting, unknownWords.length]);

  // 第 2 遍（听音默写）自动播放发音；第 3 遍（回忆拼写）不播
  useEffect(() => {
    if (rewriting && rwWord && rewriteCount === 1) {
      getTts().speak(rwWord.text);
    }
  }, [rewriting, rwWord, rewriteCount]);

  // 闪卡结束 → 自动进入拼写阶段（无需按钮）
  useEffect(() => {
    if (finished && !rewriting && !rewriteDone && unknownWords.length > 0) {
      setRewriting(true);
      setRewriteIdx(0);
      setRewriteCount(0);
      setRewriteDone(false);
      setRecalling(false);
      setRecallIdx(0);
    }
  }, [finished, rewriting, rewriteDone, unknownWords.length]);

  // 拼写完成 → 自动进入闪电拼写
  useEffect(() => {
    if (rewriteDone && !recalling && unknownWords.length > 0) {
      setRecallQueue(unknownWords);
      setRecallIdx(0);
      setRecalling(true);
    }
  }, [rewriteDone, recalling, unknownWords.length]);

  // 闪电拼写：切换单词时初始化字母槽
  useEffect(() => {
    if (recalling) {
      const rw = recallQueue[recallIdx];
      setRecallLetters(Array.from({ length: rw?.text.length ?? 0 }, () => ''));
      setRecallCursor(0);
      setRecallFeedback(null);
    }
  }, [recalling, recallIdx]);

  // 闪电拼写键盘（触屏用原生输入框，不挂全局键盘）
  useEffect(() => {
    if (!recalling || recallIdx >= recallQueue.length) return;
    if (isTouch) return;
    const rw = recallQueue[recallIdx];
    if (!rw) return;
    const len = rw.text.length;
    const handler = (e: KeyboardEvent) => {
      if (recallFeedback === 'correct') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Backspace') {
        e.preventDefault();
        if (recallCursor > 0) {
          const idx = recallCursor - 1;
          const next = [...recallLetters];
          next[idx] = '';
          setRecallLetters(next);
          setRecallCursor(idx);
        }
        return;
      }
      if (!/^[a-zA-Z\-']$/.test(e.key)) return;
      e.preventDefault();
      if (recallCursor >= len) return;
      const ch = e.key.toLowerCase();
      const next = [...recallLetters];
      next[recallCursor] = ch;
      setRecallLetters(next);
      const nc = recallCursor + 1;
      setRecallCursor(nc);
      if (nc >= len) {
        const word = next.join('');
        if (word === rw.text.toLowerCase()) {
          setRecallFeedback('correct');
          setTimeout(() => {
            setRecallFeedback(null);
            setRecallLetters(Array.from({ length: len }, () => ''));
            setRecallCursor(0);
            setRecallIdx((i) => i + 1);
          }, 350);
        } else {
          setRecallFeedback('wrong');
          setTimeout(() => {
            setRecallLetters(Array.from({ length: len }, () => ''));
            setRecallCursor(0);
            setRecallFeedback(null);
            // 拼错 → 排到队尾，稍后再拼
            setRecallQueue((q) => [...q.filter((_, i) => i !== recallIdx), rw]);
          }, 400);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [recalling, recallIdx, recallQueue, recallCursor, recallLetters, recallFeedback, isTouch]);

  // 触屏：每题自动聚焦闪电拼写输入框
  useEffect(() => {
    if (isTouch && recalling && recallIdx < recallQueue.length) {
      const t = setTimeout(() => recallInputRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [isTouch, recalling, recallIdx]);

  // 触屏闪电拼写输入：输入值 → 字母槽直通，填满复用键盘判定逻辑
  const onRecallInput = (e: ChangeEvent<HTMLInputElement>) => {
    const rw = recallQueue[recallIdx];
    if (!rw || recallFeedback === 'correct') return;
    const len = rw.text.length;
    const capped = e.target.value
      .replace(/[^a-zA-Z\-']/g, '')
      .toLowerCase()
      .slice(0, len);
    const next = Array.from({ length: len }, (_, i) => capped[i] ?? '');
    setRecallLetters(next);
    setRecallCursor(capped.length);
    if (capped.length >= len) {
      if (capped === rw.text.toLowerCase()) {
        setRecallFeedback('correct');
        setTimeout(() => {
          setRecallFeedback(null);
          setRecallLetters(Array.from({ length: len }, () => ''));
          setRecallCursor(0);
          setRecallIdx((i) => i + 1);
        }, 350);
      } else {
        setRecallFeedback('wrong');
        setTimeout(() => {
          setRecallLetters(Array.from({ length: len }, () => ''));
          setRecallCursor(0);
          setRecallFeedback(null);
          setRecallQueue((q) => [...q.filter((_, i) => i !== recallIdx), rw]);
        }, 400);
      }
    }
  };

  const resetAll = () => {
    setIndex(0);
    setFlipped(false);
    setKnownIds(new Set());
    setUnknownIds(new Set());
    setFinished(false);
    setRewriting(false);
    setRewriteIdx(0);
    setRewriteCount(0);
    setRewriteDone(false);
    setRecalling(false);
    setRecallIdx(0);
    setRecallLetters([]);
    setRecallCursor(0);
    setRecallFeedback(null);
  };

  if (total === 0) {
    return (
      <div className="py-20 text-center text-slate-500">
        <div className="mb-2 text-4xl">📭</div>
        <p>全部已斩，没有需要预习的词</p>
      </div>
    );
  }

  if (finished) {
    // 无巩固词：轻量提示，直接可开始战斗
    if (unknownWords.length === 0) {
      return (
        <div className="mx-auto max-w-md py-16 text-center">
          <div className="mb-4 text-5xl">🎉</div>
          <h2 className="text-2xl font-bold text-cyan-400">闪卡完成！</h2>
          <p className="mt-3 text-sm text-slate-400">无巩固词，可开始战斗</p>
          <button onClick={resetAll} className="mt-6 text-sm text-cyan-400 hover:underline">
            重新浏览
          </button>
        </div>
      );
    }

    // 拼写巩固（提示递减：看词 → 听音 → 回忆）
    if (rewriting && rwWord) {
      return (
        <div className="mx-auto max-w-md py-8 text-center">
          <div className="mb-1 text-xs text-slate-400">
            拼写巩固 {rewriteIdx + 1}/{unknownWords.length}
          </div>
          <div className="text-lg font-semibold text-slate-200">
            {rwWord.meanings[0]?.meaning ?? rwWord.text}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {rewriteCount === 0 && '👀 看词跟写'}
            {rewriteCount === 1 && '🎧 听音默写'}
            {rewriteCount === 2 && '🧠 回忆拼写'}
          </div>

          {/* 第 1 遍展示单词供抄写 */}
          {rewriteCount === 0 && (
            <div className="mt-3 text-3xl font-black tracking-wide text-slate-100">{rwWord.text}</div>
          )}

          {isTouch ? (
            <div className="mt-3 w-full max-w-md space-y-2">
              <div className="flex flex-wrap items-center justify-center gap-1.5">
                {Array.from({ length: rwLen }, (_, i) => {
                  const filled = (rewriteLetters[i] ?? '').trim();
                  return (
                    <span
                      key={i}
                      className={`h-2 w-2 rounded-full transition-colors ${
                        filled ? 'bg-cyan-400' : 'bg-slate-700'
                      } ${i === rewriteCursor && rewriteFeedback !== 'correct' ? 'ring-2 ring-cyan-300/70' : ''}`}
                    />
                  );
                })}
              </div>
              <input
                ref={rewriteInputRef}
                value={rewriteLetters.join('')}
                onChange={onRewriteInput}
                inputMode="text"
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
                enterKeyHint="done"
                maxLength={rwLen}
                placeholder={Array.from({ length: Math.max(1, rwLen) }, () => '•').join(' ')}
                className="w-full rounded-2xl border-2 border-cyan-500/40 bg-slate-900/70 px-4 py-4 text-center font-bold tracking-[0.35em] text-cyan-200 outline-none transition-colors placeholder:text-slate-600 placeholder:tracking-[0.35em] focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/30"
                style={{ fontSize: 24 }}
              />
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap justify-center gap-1.5">
              {Array.from({ length: rwLen }, (_, i) => {
                const filled = (rewriteLetters[i] ?? '').trim();
                const active = i === rewriteCursor && rewriteFeedback !== 'correct';
                const errored = rewriteFeedback === 'wrong' && filled;
                return (
                  <span
                    key={i}
                    onClick={() => { if (rewriteFeedback !== 'correct') setRewriteCursor(i); }}
                    className={`flex h-10 w-8 items-center justify-center border-b-2 text-lg font-bold transition-all cursor-pointer ${
                      active ? 'border-cyan-400 text-cyan-300 shadow-[0_0_8px_rgba(34,211,238,0.5)]' :
                      errored ? 'border-red-400 text-red-300 animate-[shake_0.3s]' :
                      filled ? 'border-cyan-400/60 text-cyan-200' :
                      'border-slate-600 text-slate-600 hover:border-slate-400'
                    }`}
                  >
                    {filled || '_'}
                  </span>
                );
              })}
            </div>
          )}
          <div className="mt-2 text-xs text-slate-500">第 {Math.min(rewriteCount + 1, 3)} / 3 遍</div>
          <div className="mt-2 h-5 text-center text-xs">
            {rewriteFeedback === 'correct' && <span className="text-emerald-400">✓</span>}
            {rewriteFeedback === 'wrong' && <span className="text-red-400">✗ 再试</span>}
          </div>
        </div>
      );
    }

    // 闪电拼写：看释义拼写单词（移动端输入框 / PC 字母槽）
    if (recalling) {
      if (recallIdx >= recallQueue.length) {
        return (
          <div className="mx-auto max-w-md py-16 text-center">
            <div className="mb-4 text-5xl">🎉</div>
            <h2 className="text-2xl font-bold text-cyan-400">拼写巩固完成！</h2>
            <p className="mt-3 text-sm text-slate-400">可点击下方「开始战斗」进入实战</p>
            <button onClick={resetAll} className="mt-6 text-sm text-cyan-400 hover:underline">
              重新浏览
            </button>
          </div>
        );
      }
      const rw = recallQueue[recallIdx];
      if (!rw) return null;
      const rclen = rw.text.length;
      return (
        <div className="mx-auto max-w-md py-12 text-center">
          <div className="mb-2 text-xs text-slate-400">
            闪电拼写 {recallIdx + 1}/{recallQueue.length}
          </div>
          <div className="text-2xl font-bold text-slate-100">
            {rw.meanings[0]?.meaning ?? rw.text}
          </div>
          <div className="mt-1 text-xs text-slate-500">看释义拼写单词</div>

          {isTouch ? (
            <div className="mt-4 w-full space-y-2">
              <div className="flex flex-wrap items-center justify-center gap-1.5">
                {Array.from({ length: rclen }, (_, i) => {
                  const filled = (recallLetters[i] ?? '').trim();
                  return (
                    <span
                      key={i}
                      className={`h-2 w-2 rounded-full transition-colors ${
                        filled ? 'bg-cyan-400' : 'bg-slate-700'
                      } ${i === recallCursor && recallFeedback !== 'correct' ? 'ring-2 ring-cyan-300/70' : ''}`}
                    />
                  );
                })}
              </div>
              <input
                ref={recallInputRef}
                value={recallLetters.join('')}
                onChange={onRecallInput}
                inputMode="text"
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
                enterKeyHint="done"
                maxLength={rclen}
                placeholder={Array.from({ length: Math.max(1, rclen) }, () => '•').join(' ')}
                className="w-full rounded-2xl border-2 border-cyan-500/40 bg-slate-900/70 px-4 py-4 text-center font-bold tracking-[0.35em] text-cyan-200 outline-none transition-colors placeholder:text-slate-600 placeholder:tracking-[0.35em] focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/30"
                style={{ fontSize: 24 }}
              />
            </div>
          ) : (
            <div className="mt-4 flex flex-wrap items-end justify-center gap-1.5">
              {Array.from({ length: rclen }, (_, i) => {
                const filled = (recallLetters[i] ?? '').trim();
                const active = i === recallCursor && recallFeedback !== 'correct';
                const errored = recallFeedback === 'wrong' && filled;
                return (
                  <span
                    key={i}
                    onClick={() => { if (recallFeedback !== 'correct') setRecallCursor(i); }}
                    className={`flex h-12 w-9 items-center justify-center border-b-2 text-xl font-bold transition-all cursor-pointer ${
                      active ? 'border-cyan-400 text-cyan-300 shadow-[0_0_8px_rgba(34,211,238,0.5)]' :
                      errored ? 'border-red-400 text-red-300 animate-[shake_0.3s]' :
                      filled ? 'border-cyan-400/60 text-cyan-200' :
                      'border-slate-600 text-slate-600 hover:border-slate-400'
                    }`}
                  >
                    {filled || '_'}
                  </span>
                );
              })}
            </div>
          )}

          <div className="mt-2 h-5 text-center text-xs">
            {recallFeedback === 'correct' && <span className="text-emerald-400">✓ 正确</span>}
            {recallFeedback === 'wrong' && <span className="text-red-400">✗ 拼错，稍后再试</span>}
          </div>
        </div>
      );
    }

    return null;
  }

  const w = active[index];
  if (!w) return null;
  const s = statusStyle(w.status);
  const known = knownIds.size;
  const unknown = unknownIds.size;
  const remaining = total - index;

  const flip = () => {
    if (!flipped) {
      setFlipped(true);
      getTts().speak(w.text);
    }
  };

  // 移动端滑卡手势（仅翻面后触发判定）
  const onPointerDown = (e: ReactPointerEvent) => {
    if (!isTouch) return;
    if (e.pointerType !== 'touch') return;
    if (!flipped) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, dragging: false };
    setCardXTx(0);
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (!isTouch || !dragRef.current) return;
    if (e.pointerType !== 'touch') return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    if (!dragRef.current.dragging) {
      // 水平方向位移占优才进入滑卡
      if (Math.abs(dx) > Math.abs(dy) + 10 && Math.abs(dx) > 8) {
        dragRef.current.dragging = true;
      } else {
        return;
      }
    }
    setCardXTx(Math.max(-220, Math.min(220, dx)));
  };

  const endDrag = (e: ReactPointerEvent) => {
    if (!isTouch || !dragRef.current) return;
    if (e.pointerType !== 'touch') return;
    const wasDragging = dragRef.current.dragging;
    const dx = e.clientX - dragRef.current.startX;
    dragRef.current = null;
    if (wasDragging && Math.abs(dx) >= SWIPE_THRESHOLD) {
      if (swipeLockRef.current) return;
      swipeLockRef.current = true;
      // 右滑（dx>0）= 认识，左滑（dx<0）= 不认识
      const type = dx > 0 ? 'known' : 'unknown';
      setCardXTx(dx > 0 ? 360 : -360); // 卡片滑出屏幕方向
      setSwipeFlash(type); // 红/绿判定提示
      setTimeout(() => {
        setCardXTx(0);
        setSwipeFlash(null);
        swipeLockRef.current = false;
        markAndAdvance(type);
      }, 320);
    } else {
      setCardXTx(0);
    }
  };

  return (
    <div
      className={
        isTouch
          ? 'relative mx-auto flex min-h-full w-full items-center justify-center px-2 py-6'
          : 'mx-auto flex max-w-lg flex-col items-center gap-4 px-4 py-6'
      }
    >
      {/* 移动端：点击旁白空白处也可翻转（覆盖全宽，含横屏两侧） */}
      {isTouch && !flipped && (
        <div aria-hidden className="absolute inset-0 z-0 cursor-pointer" onClick={flip} />
      )}

      {/* 移动端：翻面后进入滑卡判定，无需底部工具遮挡 */}

      {/* 移动端：滑卡判定后的红/绿提示 */}
      {isTouch && swipeFlash && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
          <div
            className={`flex items-center gap-2 rounded-2xl border-2 px-8 py-4 text-3xl font-black shadow-2xl backdrop-blur-md animate-[flash-pop_0.32s_ease-out] ${
              swipeFlash === 'known'
                ? 'border-emerald-400/80 bg-emerald-500/25 text-emerald-300 shadow-emerald-500/30'
                : 'border-red-400/80 bg-red-500/25 text-red-300 shadow-red-500/30'
            }`}
          >
            {swipeFlash === 'known' ? '✓ 认识' : '✗ 不认识'}
          </div>
        </div>
      )}

      {/* 内容区：卡片居中，max-w-md 收窄防横屏撑太宽 */}
      <div className={isTouch ? 'relative z-10 flex w-full max-w-md flex-col items-center gap-4' : 'flex w-full flex-col items-center gap-4'}>
        {/* 统计栏 */}
      <div className="relative z-10 flex w-full items-center justify-center gap-4 text-xs">
        <span className="text-emerald-400">认识 {known}</span>
        <span className="text-red-400">不认识 {unknown}</span>
        <span className="text-slate-500">剩余 {remaining}</span>
      </div>

      {/* 进度条 */}
      <div className="relative z-10 h-1 w-full max-w-xs overflow-hidden rounded-full bg-slate-800">
        <div
          className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-cyan-300 transition-all duration-300"
          style={{ width: `${((index + 1) / total) * 100}%` }}
        />
      </div>

      {/* 闪卡 */}
      <div
        ref={cardRef}
        role="button"
        tabIndex={0}
        onClick={() => {
          // 滑卡结束后残留的 click 不再触发展开/折叠
          if (dragRef.current && dragRef.current.dragging) return;
          flip();
        }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onPointerCancel={endDrag}
        className={`relative z-10 w-full cursor-pointer select-none rounded-2xl border-2 p-6 text-center transition-all duration-300 ${
          flipped
            ? 'border-cyan-500/40 bg-slate-900/80 shadow-[0_0_20px_rgba(6,182,212,0.15)]'
            : 'border-slate-700/60 bg-slate-900/60 hover:border-cyan-500/30 hover:shadow-[0_0_10px_rgba(6,182,212,0.1)]'
        }`}
        style={{
          touchAction: isTouch ? 'pan-y' : undefined,
          transform: cardXTx ? `translateX(${cardXTx}px)` : undefined,
        }}
      >
        <div className="mb-3 flex items-center justify-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${tierColor(w.tier)}`}>
            {w.tier ?? '?'}
          </span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${s.badge}`}>
            {s.label}
          </span>
        </div>

        <div className="text-4xl font-black tracking-wide text-slate-100">
          {w.text}
        </div>
        {w.phonetic && (
          <div className="mt-2 text-sm text-slate-500">{w.phonetic}</div>
        )}

        {/* 翻转区域 */}
        <div className={`mt-4 overflow-hidden transition-all duration-300 ${
          flipped ? 'max-h-48 opacity-100' : 'max-h-0 opacity-0'
        }`}>
          <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-4">
            {w.meanings.map((m, j) => (
              <div key={j} className="text-sm text-slate-200">
                {m.meaning}
                {m.example && (
                  <div className="mt-0.5 text-xs text-slate-500 italic">{m.example}</div>
                )}
              </div>
            ))}
          </div>
        </div>

        {!flipped && (
          <div className="mt-4 text-xs text-slate-500 animate-pulse">
            点击卡片或按空格查看释义
          </div>
        )}
      </div>

      {/* 提示 / 桌面操作区 */}
      {isTouch ? (
        <>
          {flipped && (
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={() => getTts().speak(w.text)}
                className="rounded-full border border-slate-600 bg-slate-900/80 px-4 py-2 text-base text-slate-300 transition-colors hover:bg-slate-800"
              >
                🔊
              </button>
              <button
                onClick={skipCurrent}
                title="标记已掌握"
                className="rounded-full border border-emerald-800 bg-emerald-950/40 px-4 py-2 text-sm text-emerald-400 transition-colors hover:bg-emerald-500/20"
              >
                斩
              </button>
            </div>
          )}
          <div className={`text-center text-[10px] text-slate-500 ${flipped ? '' : 'animate-pulse'}`}>
            {flipped
              ? '← 左滑不认识 · 右滑认识 →'
              : '点击卡片查看释义'}
          </div>
        </>
      ) : (
        <>
          {/* 桌面：底部按钮行（不认识的词会被跳过（斩）- 让它们保留在题库中） */}
          {flipped && (
            <div className="flex w-full gap-3">
              <button
                onClick={() => markAndAdvance('unknown')}
                className="flex-1 rounded-xl border border-red-700/50 bg-red-950/20 py-3 text-sm font-semibold text-red-400 transition-colors hover:bg-red-500/10 hover:text-red-300"
              >
                ❌ 不认识
              </button>
              <button
                onClick={() => getTts().speak(w.text)}
                className="rounded-xl border border-slate-700 px-3 py-3 text-sm text-slate-400 transition-colors hover:bg-slate-800"
              >
                🔊
              </button>
              <button
                onClick={skipCurrent}
                title="标记已掌握"
                className="rounded-xl border border-emerald-800 bg-emerald-950/20 px-3 py-3 text-sm text-emerald-400 transition-colors hover:bg-emerald-500/20"
              >
                斩
              </button>
              <button
                onClick={() => markAndAdvance('known')}
                className="flex-1 rounded-xl border border-emerald-700/50 bg-emerald-950/20 py-3 text-sm font-semibold text-emerald-400 transition-colors hover:bg-emerald-500/10 hover:text-emerald-300"
              >
                ✅ 认识
              </button>
            </div>
          )}

          <div className="text-[10px] text-slate-600">
            {flipped ? '← 不认识 · 认识 → · Backspace 撤回' : '空格 翻转 · 点击 翻卡'}
          </div>
        </>
      )}
      </div>
    </div>
  );
}
