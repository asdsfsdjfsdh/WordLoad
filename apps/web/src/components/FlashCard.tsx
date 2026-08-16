import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { FoilOption, LevelWord } from '@word-journey/shared';
import { pickOptions, type ChoiceOption } from '../lib/choices';
import { getTts } from '../lib/tts';
import { useIsTouch } from '../lib/touch';

interface Props {
  words: LevelWord[];
  skippedWords: Set<string>;
  onSkip: (wordId: string) => void;
  // 肉鸽模式：本局全局统计（顶部统计栏双段展示用）
  runStats?: { day: number; poolUsed: number; wavePreview: number };
  // 巩固方式跟随战斗模式：拼写类 → 拼写巩固；选中文 → 点选释义巩固
  mode?: 'zh2en' | 'dictation' | 'choice';
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

export function FlashCard({ words, skippedWords, onSkip, runStats, mode = 'zh2en' }: Props) {
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [knownIds, setKnownIds] = useState<Set<string>>(new Set());
  const [unknownIds, setUnknownIds] = useState<Set<string>>(new Set());
  const [finished, setFinished] = useState(false);
  // 选中文模式：不认识词用「点选释义」巩固，而非拼写
  const isChoiceMode = mode === 'choice';

  // 拼写巩固：不认识词每词拼写3遍（提示递减：看词→听音→回忆）
  const [rewriting, setRewriting] = useState(false);
  const [rewriteIdx, setRewriteIdx] = useState(0);
  const [rewriteCount, setRewriteCount] = useState(0);
  const [rewriteLetters, setRewriteLetters] = useState<string[]>([]);
  const [rewriteCursor, setRewriteCursor] = useState(0);
  const [rewriteFeedback, setRewriteFeedback] = useState<'correct' | 'wrong' | null>(null);
  const [rewriteDone, setRewriteDone] = useState(false);
  // 闪电拼写：拼写完成后看释义拼写单词（拼错即展示正确答案并记入错误列表）
  const [recalling, setRecalling] = useState(false);
  const [recallIdx, setRecallIdx] = useState(0);
  const [recallQueue, setRecallQueue] = useState<LevelWord[]>([]);
  const [recallLetters, setRecallLetters] = useState<string[]>([]);
  const [recallCursor, setRecallCursor] = useState(0);
  const [recallFeedback, setRecallFeedback] = useState<'correct' | 'wrong' | null>(null);
  // 本轮闪电拼写拼错的词（去重）与当前词标红位置
  const [recallWrong, setRecallWrong] = useState<LevelWord[]>([]);
  const [recallWrongAt, setRecallWrongAt] = useState<number[]>([]);
  // 选中文：闪卡正面直接左右滑 —— 右滑=认识（四选一验证），左滑=不认识（翻面显示+下一个按钮）
  const [verifying, setVerifying] = useState(false);
  const [verifySel, setVerifySel] = useState<ChoiceOption | null>(null);
  const [revealed, setRevealed] = useState(false);
  // 选中文：循环考题（不认识词逐词点选释义，答错移回队尾，直到每个都答对）
  const [drillStarted, setDrillStarted] = useState(false);
  const [drillDone, setDrillDone] = useState(false);
  const [drillQueue, setDrillQueue] = useState<LevelWord[]>([]);
  const [drillIdx, setDrillIdx] = useState(0);
  const [drillSel, setDrillSel] = useState<ChoiceOption | null>(null);
  const drillLockRef = useRef(false);

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

  // 不认识词列表（用于巩固）
  const unknownWords = active.filter((w) => unknownIds.has(w.wordId));

  // 选中文：4 个释义选项的候选池（复用战斗同款 pickOptions 组项）
  const choiceFoilPool = useMemo<FoilOption[]>(
    () => active.map((w) => ({ text: w.text, meaning: w.meanings[0]?.meaning ?? '' })),
    // active 由 words/skippedWords 派生
    [words, skippedWords],
  );
  // 选中文：右滑「认识」验证当前卡片
  const verifyWord = verifying && !revealed ? active[index] : null;
  const verifyOptions = useMemo<ChoiceOption[]>(
    () =>
      verifyWord
        ? pickOptions({ answer: verifyWord.text, answerMeaning: verifyWord.meanings[0]?.meaning ?? '' }, choiceFoilPool)
        : [],
    [verifyWord, choiceFoilPool],
  );
  // 选中文：循环考题当前词
  const drillWord = drillStarted && !drillDone && drillIdx < drillQueue.length ? drillQueue[drillIdx] : null;
  const drillOptions = useMemo<ChoiceOption[]>(
    () =>
      drillWord
        ? pickOptions({ answer: drillWord.text, answerMeaning: drillWord.meanings[0]?.meaning ?? '' }, choiceFoilPool)
        : [],
    [drillWord, choiceFoilPool],
  );

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
      !recalling &&
      !drillStarted
    ) {
      setFinished(false);
    }
  }, [finished, allMarked, active.length, rewriting, rewriteDone, recalling, drillStarted]);

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

  // 闪卡阶段键盘：空格翻转 · ← 不认识 → 认识 · ↓ 斩词 · Backspace 撤回（选中文走左右滑/按钮，不挂键盘）
  useEffect(() => {
    if (isChoiceMode) return;
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
      if (e.key === 'ArrowDown' || e.key === 's') {
        e.preventDefault();
        skipCurrent();
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
  }, [isChoiceMode, flipped, index, active, finished, goTo, markAndAdvance, skipCurrent]);

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

  // 拼写巩固自动发音：进入每题（第 1 遍看词）与第 2 遍（听音默写）自动播；第 3 遍（回忆拼写）不播
  useEffect(() => {
    if (rewriting && rwWord && rewriteCount <= 1) {
      getTts().speak(rwWord.text);
    }
  }, [rewriting, rwWord, rewriteCount]);

  // 闪卡结束 → 自动进入拼写阶段（无需按钮；选中文模式走点选释义巩固）
  useEffect(() => {
    if (isChoiceMode) return;
    if (finished && !rewriting && !rewriteDone && unknownWords.length > 0) {
      setRewriting(true);
      setRewriteIdx(0);
      setRewriteCount(0);
      setRewriteDone(false);
      setRecalling(false);
      setRecallIdx(0);
    }
  }, [isChoiceMode, finished, rewriting, rewriteDone, unknownWords.length]);

  // 选中文：闪卡结束 → 进入循环考题（不认识词逐词点选释义，答错回队尾，直到全部答对）。
  // useLayoutEffect 保证 finished 落帧时直接进考题，避免闪一帧完成页。
  useLayoutEffect(() => {
    if (!isChoiceMode) return;
    if (finished && !drillStarted && unknownWords.length > 0) {
      setDrillQueue(unknownWords);
      setDrillIdx(0);
      setDrillSel(null);
      setDrillDone(false);
      setDrillStarted(true);
    }
  }, [isChoiceMode, finished, drillStarted, unknownWords.length]);

  // 选中文：考题队列清空 → 全部答对
  useEffect(() => {
    if (isChoiceMode && drillStarted && !drillDone && drillQueue.length === 0) {
      setDrillDone(true);
    }
  }, [isChoiceMode, drillStarted, drillDone, drillQueue.length]);

  // 选中文：正面切卡自动发音（无点击翻转，进入/切词即播）
  useEffect(() => {
    if (!isChoiceMode || finished) return;
    if (verifying || revealed) return;
    const cw = active[index];
    if (cw) getTts().speak(cw.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isChoiceMode, finished, index, verifying, revealed, active.length]);

  // 选中文：右滑验证时自动发音
  useEffect(() => {
    if (verifyWord) getTts().speak(verifyWord.text);
  }, [verifyWord]);

  // 选中文：左滑翻面（不认识）时自动发音
  useEffect(() => {
    if (isChoiceMode && revealed) {
      const cw = active[index];
      if (cw) getTts().speak(cw.text);
    }
  }, [isChoiceMode, revealed, index]);

  // 选中文：循环考题每题自动发音
  useEffect(() => {
    if (drillWord) getTts().speak(drillWord.text);
  }, [drillWord]);

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
      if (recallFeedback === 'correct' || recallFeedback === 'wrong') return;
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
          // 拼错：立即展示正确答案并标红错误位置，稍后进入下一词（不再排到队尾）
          setRecallWrong((p) => (p.some((x) => x.wordId === rw.wordId) ? p : [...p, rw]));
          const answer = Array.from(rw.text.toLowerCase());
          const wrongAt: number[] = [];
          next.forEach((c, i) => { if (c !== answer[i]) wrongAt.push(i); });
          setRecallWrongAt(wrongAt);
          setRecallFeedback('wrong');
          setRecallLetters(answer);
          setRecallCursor(len);
          setTimeout(() => {
            setRecallFeedback(null);
            setRecallLetters(Array.from({ length: len }, () => ''));
            setRecallCursor(0);
            setRecallWrongAt([]);
            setRecallIdx((i) => i + 1);
          }, 1500);
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
    if (!rw || recallFeedback === 'correct' || recallFeedback === 'wrong') return;
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
        // 拼错：立即展示正确答案并标红错误位置，稍后进入下一词（不再排到队尾）
        setRecallWrong((p) => (p.some((x) => x.wordId === rw.wordId) ? p : [...p, rw]));
        const answer = Array.from(rw.text.toLowerCase());
        const wrongAt: number[] = [];
        next.forEach((c, i) => { if (c !== answer[i]) wrongAt.push(i); });
        setRecallWrongAt(wrongAt);
        setRecallFeedback('wrong');
        setRecallLetters(answer);
        setRecallCursor(len);
        setTimeout(() => {
          setRecallFeedback(null);
          setRecallLetters(Array.from({ length: len }, () => ''));
          setRecallCursor(0);
          setRecallWrongAt([]);
          setRecallIdx((i) => i + 1);
        }, 1500);
      }
    }
  };

  // 选中文：右滑「认识」验证 —— 选对才算认识，选错记为不认识
  const pickVerify = (opt: ChoiceOption) => {
    const w = verifyWord;
    if (!w || verifySel) return;
    const correct = opt.text === w.text;
    setVerifySel(opt);
    // 判定结果在展示反馈后再落账并推进（避免末词未及看完反馈就跳入循环考题）
    setTimeout(() => {
      setVerifySel(null);
      setVerifying(false);
      if (correct) {
        setKnownIds((prev) => new Set(prev).add(w.wordId));
      } else {
        setUnknownIds((prev) => new Set(prev).add(w.wordId));
      }
      advanceChoiceCard();
    }, correct ? 450 : 900);
  };

  // 选中文：左滑「不认识」→ 翻面显示释义；「下一个」按钮落账并推进
  const markChoiceUnknown = () => {
    setRevealed(true);
  };

  const nextFromReveal = () => {
    const w = active[index];
    if (w) setUnknownIds((prev) => new Set(prev).add(w.wordId));
    setRevealed(false);
    advanceChoiceCard();
  };

  const advanceChoiceCard = () => {
    if (index < active.length - 1) {
      setIndex(index + 1);
      setFlipped(false);
    }
  };

  // 选中文：循环考题判定 —— 答对移出队列，答错移回队尾继续循环，直到全部答对
  const pickDrill = (opt: ChoiceOption) => {
    const cw = drillWord;
    if (!cw || drillSel || drillLockRef.current) return;
    drillLockRef.current = true;
    const correct = opt.text === cw.text;
    setDrillSel(opt);
    const q = drillQueue;
    const i = drillIdx;
    setTimeout(() => {
      drillLockRef.current = false;
      setDrillSel(null);
      if (correct) {
        const next = q.filter((_, x) => x !== i);
        if (next.length === 0) {
          setDrillDone(true);
          return;
        }
        setDrillQueue(next);
        setDrillIdx(i >= next.length ? 0 : i);
      } else if (q.length > 1) {
        // 答错：该词移到队尾；下标保持 i（原位置现在是指向下一个词）
        setDrillQueue([...q.filter((_, x) => x !== i), q[i]!]);
      }
    }, correct ? 400 : 900);
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
    setRecallWrong([]);
    setRecallWrongAt([]);
    setVerifying(false);
    setVerifySel(null);
    setRevealed(false);
    setDrillStarted(false);
    setDrillDone(false);
    setDrillQueue([]);
    setDrillIdx(0);
    setDrillSel(null);
    drillLockRef.current = false;
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
    // 选中文：循环考题（不认识词点选释义，答错回队尾，直到全部答对）
    if (isChoiceMode) {
      if (drillStarted && !drillDone && drillWord) {
        const cw = drillWord;
        return (
          <div className="mx-auto max-h-full max-w-lg py-8 text-center">
            <div className="mb-2 text-sm text-slate-400">
              循环巩固 · 剩余 {drillQueue.length} 词（第 {drillIdx + 1} 词）
            </div>
            <div className="flex items-center justify-center gap-3">
              <div className="text-3xl font-bold text-slate-100">{cw.text}</div>
              {cw.phonetic && <span className="text-lg text-slate-400">{cw.phonetic}</span>}
              <button
                onClick={() => getTts().speak(cw.text)}
                title="播放发音"
                className="rounded-xl border border-slate-600 bg-slate-900/80 px-3 py-1.5 text-base text-slate-300 transition-colors hover:bg-slate-800"
              >
                🔊
              </button>
            </div>
            <div className="mt-1.5 text-sm text-slate-500">选择正确的中文释义（答错会回到队尾，直到全部答对）</div>

            <div className="mx-auto mt-4 grid w-full max-w-md grid-cols-1 gap-2.5 sm:grid-cols-2">
              {drillOptions.map((opt, i) => {
                const selCls = drillSel
                  ? opt.text === cw.text
                    ? 'border-emerald-400 bg-emerald-950/60 text-emerald-200 shadow-[0_0_14px_rgba(52,211,153,0.35)]'
                    : drillSel.text === opt.text
                      ? 'border-red-400 bg-red-950/60 text-red-200 shadow-[0_0_14px_rgba(248,113,113,0.35)] animate-[shake_0.3s_ease-in-out]'
                      : 'border-slate-700 bg-slate-900/50 text-slate-400 opacity-60'
                  : 'border-slate-700 bg-slate-900/60 text-slate-100 hover:border-cyan-500/70 hover:bg-cyan-950/40';
                return (
                  <button
                    key={`${opt.text}-${opt.meaning}`}
                    onClick={() => pickDrill(opt)}
                    disabled={drillSel !== null}
                    className={`rounded-xl border-2 px-4 py-3.5 text-left text-[15px] font-medium transition-all disabled:cursor-not-allowed ${selCls}`}
                  >
                    <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full border border-current text-xs opacity-60">
                      {i + 1}
                    </span>
                    {opt.meaning}
                  </button>
                );
              })}
            </div>

            <div className="mt-2 h-5 text-center text-sm">
              {drillSel &&
                (drillSel.text === cw.text ? (
                  <span className="text-lg font-semibold text-emerald-400">✓ 正确</span>
                ) : (
                  <span className="text-lg font-semibold text-red-400">
                    ✗ 答错，回队尾再考：{cw.text} {cw.meanings[0]?.meaning}
                  </span>
                ))}
            </div>
          </div>
        );
      }
      // 全部答对 / 无不认识词 → 完成
      return (
        <div className="mx-auto max-w-md py-16 text-center">
          <div className="mb-4 text-5xl">🎉</div>
          <h2 className="text-2xl font-bold text-cyan-400">{drillStarted ? '巩固完成！' : '闪卡完成！'}</h2>
          <p className="mt-3 text-sm text-slate-400">
            {drillStarted ? '全部答对，可点击下方「开始战斗」进入实战' : '无巩固词，可开始战斗'}
          </p>
          <button onClick={resetAll} className="mt-6 text-sm text-cyan-400 hover:underline">
            重新浏览
          </button>
        </div>
      );
    }

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
        <div className="mx-auto max-h-full max-w-lg overflow-y-auto py-8 text-center">
          <div className="mb-2 text-sm text-slate-400">
            拼写巩固 {rewriteIdx + 1}/{unknownWords.length}
          </div>
          <div className="flex items-center justify-center gap-3">
            <div className="text-2xl font-semibold text-slate-200">
              {rwWord.meanings[0]?.meaning ?? rwWord.text}
            </div>
            <button
              onClick={() => getTts().speak(rwWord.text)}
              title="播放发音"
              className="rounded-xl border border-slate-600 bg-slate-900/80 px-3 py-1.5 text-base text-slate-300 transition-colors hover:bg-slate-800"
            >
              🔊
            </button>
          </div>
          <div className="mt-2 text-sm text-slate-500">
            {rewriteCount === 0 && '👀 看词跟写'}
            {rewriteCount === 1 && '🎧 听音默写'}
            {rewriteCount === 2 && '🧠 回忆拼写'}
          </div>

          {/* 第 1 遍展示单词供抄写 */}
          {rewriteCount === 0 && (
            <div className="mt-4 text-4xl font-black tracking-wide text-slate-100">{rwWord.text}</div>
          )}

          {/* 巩固资料：记忆锚点/易混提示，全程展示，不参与提示强度衰退 */}
          {(rwWord.mnemonic || rwWord.confusable) && (
            <div className="mx-auto mt-4 max-w-sm space-y-1.5 rounded-xl border border-slate-700/50 bg-slate-900/40 px-4 py-2">
              {rwWord.mnemonic && <div className="text-sm text-emerald-300/90">💡 {rwWord.mnemonic}</div>}
              {rwWord.confusable && (
                <div className="text-sm text-amber-300/90">
                  ⚠ 注意区分（{rwWord.confusable.note}）：{rwWord.confusable.counterpart}
                </div>
              )}
            </div>
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
                className="w-full rounded-2xl border-2 border-cyan-500/40 bg-slate-900/70 px-4 py-5 text-center font-bold tracking-[0.4em] text-cyan-200 outline-none transition-colors placeholder:text-slate-600 placeholder:tracking-[0.4em] focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/30"
                style={{ fontSize: 34 }}
              />
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {Array.from({ length: rwLen }, (_, i) => {
                const filled = (rewriteLetters[i] ?? '').trim();
                const active = i === rewriteCursor && rewriteFeedback !== 'correct';
                const errored = rewriteFeedback === 'wrong' && filled;
                return (
                  <span
                    key={i}
                    onClick={() => { if (rewriteFeedback !== 'correct') setRewriteCursor(i); }}
                    className={`flex h-14 w-11 items-center justify-center rounded-lg border-b-2 text-2xl font-bold transition-all cursor-pointer ${
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
          {/* 三段进度点：与战斗内巩固重写视觉语言统一 */}
          <div className="mt-2 flex items-center justify-center gap-2">
            {['👀', '🎧', '🧠'].map((icon, i) => (
              <span
                key={i}
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] transition-all ${
                  i < rewriteCount
                    ? 'bg-emerald-500/80 text-slate-950'
                    : i === rewriteCount
                      ? 'bg-slate-800 text-slate-200 ring-2 ring-cyan-400/50'
                      : 'bg-slate-800 text-slate-600'
                }`}
              >
                {i < rewriteCount ? '✓' : icon}
              </span>
            ))}
          </div>
          <div className="mt-2 h-5 text-center text-xs">
            {rewriteFeedback === 'correct' && (
              <span className="font-medium text-emerald-400">
                ✓ {['字形记住了', '音形对上了', '牢牢记住了！'][Math.min(rewriteCount, 2)]}
              </span>
            )}
            {rewriteFeedback === 'wrong' && <span className="text-red-400">✗ 再试一次</span>}
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
            {recallWrong.length > 0 ? (
              <>
                <p className="mt-3 text-sm text-amber-400">
                  本轮拼错 {recallWrong.length} 词，建议重点复习：
                </p>
                <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                  {recallWrong.map((w) => (
                    <span
                      key={w.wordId}
                      className="inline-flex items-center gap-1.5 rounded-full border border-red-700/50 bg-red-950/30 px-3 py-1 text-sm text-red-300"
                    >
                      {w.text}
                      <button
                        onClick={() => getTts().speak(w.text)}
                        className="text-xs text-slate-400 hover:text-cyan-300"
                        title="发音"
                      >
                        🔊
                      </button>
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <p className="mt-3 text-sm text-slate-400">全部拼对，可点击下方「开始战斗」进入实战</p>
            )}
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
        <div className="mx-auto max-h-full max-w-lg overflow-y-auto py-12 text-center">
          <div className="mb-2 text-sm text-slate-400">
            闪电拼写 {recallIdx + 1}/{recallQueue.length}
          </div>
          <div className="flex items-center justify-center gap-3">
            <div className="text-3xl font-bold text-slate-100">
              {rw.meanings[0]?.meaning ?? rw.text}
            </div>
            <button
              onClick={() => getTts().speak(rw.text)}
              title="播放发音"
              className="rounded-xl border border-slate-600 bg-slate-900/80 px-3 py-1.5 text-base text-slate-300 transition-colors hover:bg-slate-800"
            >
              🔊
            </button>
          </div>
          <div className="mt-1.5 text-sm text-slate-500">看释义拼写单词</div>

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
                className="w-full rounded-2xl border-2 border-cyan-500/40 bg-slate-900/70 px-4 py-5 text-center font-bold tracking-[0.4em] text-cyan-200 outline-none transition-colors placeholder:text-slate-600 placeholder:tracking-[0.4em] focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/30"
                style={{ fontSize: 34 }}
              />
            </div>
          ) : (
            <div className="mt-4 flex flex-wrap items-end justify-center gap-2">
              {Array.from({ length: rclen }, (_, i) => {
                const filled = (recallLetters[i] ?? '').trim();
                const active = i === recallCursor && recallFeedback !== 'correct';
                const errored = recallFeedback === 'wrong' && recallWrongAt.includes(i);
                return (
                  <span
                    key={i}
                    onClick={() => { if (recallFeedback !== 'correct') setRecallCursor(i); }}
                    className={`flex h-14 w-11 items-center justify-center rounded-lg border-b-2 text-2xl font-bold transition-all cursor-pointer ${
                      active ? 'border-cyan-400 text-cyan-300 shadow-[0_0_8px_rgba(34,211,238,0.5)]' :
                      errored ? 'border-red-400 text-red-300 animate-[shake_0.3s]' :
                      filled && recallFeedback === 'wrong' ? 'border-emerald-400 text-emerald-200' :
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
            {recallFeedback === 'wrong' && (
              <span className="text-red-400">
                ✗ 拼错，正确答案 <span className="font-semibold">{rw.text}</span>
              </span>
            )}
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

  // 移动端滑卡手势：拼写类需先翻面；选中文正面即可左右滑（无需翻转）
  const onPointerDown = (e: ReactPointerEvent) => {
    if (!isTouch) return;
    if (e.pointerType !== 'touch') return;
    if (isChoiceMode) {
      if (verifying || revealed) return; // 验证/翻面展示中不响应
      dragRef.current = { startX: e.clientX, startY: e.clientY, dragging: false };
      setCardXTx(0);
      return;
    }
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
      if (isChoiceMode) {
        // 选中文：右滑=认识（四选一验证）· 左滑=不认识（翻面显示+下一个）
        const right = dx > 0;
        setCardXTx(right ? 360 : -360);
        setSwipeFlash(right ? 'known' : 'unknown');
        setTimeout(() => {
          setCardXTx(0);
          setSwipeFlash(null);
          swipeLockRef.current = false;
          if (right) {
            setVerifying(true);
            setVerifySel(null);
          } else {
            markChoiceUnknown();
          }
        }, 320);
        return;
      }
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

  // 选中文卡片各阶段共用的统计栏 / 进度条
  const statsBar = () =>
    runStats ? (
      <div className="relative z-10 w-full rounded-2xl border border-slate-700/50 bg-slate-900/50 px-5 py-3 backdrop-blur-sm">
        <div className="flex items-center justify-center gap-5 text-sm">
          <span className="text-cyan-300">第 <span className="text-lg font-bold">{runStats.day}</span> 天</span>
          <span className="text-slate-600">|</span>
          <span className="text-slate-300">词池 <span className="text-lg font-bold text-slate-100">{runStats.poolUsed}</span></span>
          <span className="text-slate-600">|</span>
          <span className="text-slate-300">本波预览 <span className="text-lg font-bold text-slate-100">{runStats.wavePreview}</span></span>
        </div>
        <div className="mt-1.5 flex items-center justify-center gap-5 text-xs">
          <span className="text-emerald-400">认识 {known}</span>
          <span className="text-red-400">不认识 {unknown}</span>
          <span className="text-slate-500">剩余 {remaining}</span>
        </div>
      </div>
    ) : (
      <div className="relative z-10 flex w-full items-center justify-center gap-6 text-base">
        <span className="text-emerald-400">认识 {known}</span>
        <span className="text-red-400">不认识 {unknown}</span>
        <span className="text-slate-500">剩余 {remaining}</span>
      </div>
    );
  const progressBar = () => (
    <div className="relative z-10 h-2 w-full max-w-md overflow-hidden rounded-full bg-slate-800">
      <div
        className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-cyan-300 transition-all duration-300"
        style={{ width: `${((index + 1) / total) * 100}%` }}
      />
    </div>
  );

  // 选中文：正面直接左右滑（无点击翻转）
  if (isChoiceMode) {
    // 右滑「认识」验证：4 选 1 确认真的认识
    if (verifying && verifyWord) {
      const vw = verifyWord;
      return (
        <div className="relative mx-auto flex h-full min-h-0 w-full items-center justify-center px-2 py-4">
          <div className="relative z-10 flex min-h-0 w-full max-w-lg flex-col items-center gap-4">
            {statsBar()}
            {progressBar()}
            <div className="mx-auto w-full max-w-md rounded-3xl border-2 border-cyan-500/40 bg-slate-900/80 p-6 text-center shadow-[0_0_28px_rgba(6,182,212,0.2)]">
              <div className="mb-1 text-xs text-slate-400">右滑「认识」· 验证</div>
              <div className="text-3xl font-bold text-slate-100">{vw.text}</div>
              {vw.phonetic && <div className="mt-1 text-base text-slate-400">{vw.phonetic}</div>}
              <div className="mt-3 text-sm text-slate-500">选择正确的中文释义</div>
              <div className="mx-auto mt-3 grid w-full max-w-md grid-cols-1 gap-2.5 sm:grid-cols-2">
                {verifyOptions.map((opt, i) => {
                  const selCls = verifySel
                    ? opt.text === vw.text
                      ? 'border-emerald-400 bg-emerald-950/60 text-emerald-200 shadow-[0_0_14px_rgba(52,211,153,0.35)]'
                      : verifySel.text === opt.text
                        ? 'border-red-400 bg-red-950/60 text-red-200 shadow-[0_0_14px_rgba(248,113,113,0.35)] animate-[shake_0.3s_ease-in-out]'
                        : 'border-slate-700 bg-slate-900/50 text-slate-400 opacity-60'
                    : 'border-slate-700 bg-slate-900/60 text-slate-100 hover:border-cyan-500/70 hover:bg-cyan-950/40';
                  return (
                    <button
                      key={`${opt.text}-${opt.meaning}`}
                      onClick={() => pickVerify(opt)}
                      disabled={verifySel !== null}
                      className={`rounded-xl border-2 px-4 py-3.5 text-left text-[15px] font-medium transition-all disabled:cursor-not-allowed ${selCls}`}
                    >
                      <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full border border-current text-xs opacity-60">
                        {i + 1}
                      </span>
                      {opt.meaning}
                    </button>
                  );
                })}
              </div>
              <div className="mt-2 h-5 text-center text-sm">
                {verifySel &&
                  (verifySel.text === vw.text ? (
                    <span className="text-lg font-semibold text-emerald-400">✓ 确认认识</span>
                  ) : (
                    <span className="text-lg font-semibold text-red-400">
                      ✗ 记入不认识：{vw.text} {vw.meanings[0]?.meaning}
                    </span>
                  ))}
              </div>
            </div>
          </div>
        </div>
      );
    }

    // 左滑「不认识」翻面：显示释义 + 下一个按钮
    if (revealed) {
      return (
        <div className="relative mx-auto flex h-full min-h-0 w-full items-center justify-center px-2 py-4">
          <div className="relative z-10 flex min-h-0 w-full max-w-lg flex-col items-center gap-4">
            {statsBar()}
            {progressBar()}
            <div className="mx-auto w-full max-w-md rounded-3xl border-2 border-cyan-500/40 bg-slate-900/80 p-6 text-center shadow-[0_0_28px_rgba(6,182,212,0.2)]">
              <div className="mb-1 text-xs text-slate-400">左滑「不认识」· 记一记</div>
              <div className="text-3xl font-bold text-slate-100">{w.text}</div>
              {w.phonetic && <div className="mt-1 text-base text-slate-400">{w.phonetic}</div>}
              <div className="mt-4 space-y-2 text-left">
                {w.meanings.map((m, j) => (
                  <div key={j} className="rounded-lg border border-slate-700/50 bg-slate-800/40 p-3">
                    <div className="text-base text-slate-200">{m.meaning}</div>
                    {m.example && <div className="mt-0.5 text-sm text-slate-500 italic">{m.example}</div>}
                  </div>
                ))}
                {w.mnemonic && (
                  <div className="mt-2 rounded-lg border border-emerald-800/50 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-300/90">
                    💡 {w.mnemonic}
                  </div>
                )}
              </div>
              <button
                onClick={nextFromReveal}
                className="mt-5 w-full rounded-xl bg-cyan-500 py-3 text-base font-bold text-slate-950 transition-all hover:bg-cyan-400"
              >
                下一个 →
              </button>
            </div>
          </div>
        </div>
      );
    }

    // 正面：单词 + 音标 + 发音，左右滑判定
    return (
      <div className="relative mx-auto flex h-full min-h-0 w-full items-center justify-center px-2 py-4">
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
        <div className="relative z-10 flex min-h-0 w-full max-w-lg flex-col items-center gap-4">
          {statsBar()}
          {progressBar()}
          <div
            ref={cardRef}
            role="button"
            tabIndex={0}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerLeave={endDrag}
            onPointerCancel={endDrag}
            className={`relative z-10 w-full max-h-full cursor-pointer select-none overflow-hidden rounded-3xl border-2 p-8 text-center transition-all duration-300 sm:p-10 ${
              'border-cyan-500/40 bg-slate-900/80 shadow-[0_0_28px_rgba(6,182,212,0.2)]'
            }`}
            style={{
              touchAction: isTouch ? 'none' : undefined,
              transform: cardXTx ? `translateX(${cardXTx}px)` : undefined,
            }}
          >
            <div className="mb-4 flex items-center justify-center gap-2.5">
              <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase ${tierColor(w.tier)}`}>
                {w.tier ?? '?'}
              </span>
              <span className={`rounded-full px-3 py-1 text-xs font-medium ${s.badge}`}>{s.label}</span>
            </div>
            <div className="text-5xl font-black tracking-wide text-slate-100 sm:text-6xl">{w.text}</div>
            {w.phonetic && <div className="mt-3 text-lg text-slate-400">{w.phonetic}</div>}
            <div className="mt-6 text-sm text-slate-500 animate-pulse">左右滑动判断是否认识</div>
            <button
              onClick={() => getTts().speak(w.text)}
              title="播放发音"
              className="mt-4 rounded-full border border-slate-600 bg-slate-900/80 px-5 py-2.5 text-lg text-slate-300 transition-colors hover:bg-slate-800"
            >
              🔊
            </button>
          </div>
          {!isTouch && (
            <div className="flex w-full gap-4">
              <button
                onClick={markChoiceUnknown}
                className="flex-1 rounded-2xl border border-red-700/50 bg-red-950/20 py-4 text-lg font-semibold text-red-400 transition-colors hover:bg-red-500/10 hover:text-red-300"
              >
                ❌ 不认识
              </button>
              <button
                onClick={() => { setVerifying(true); setVerifySel(null); }}
                className="flex-1 rounded-2xl border border-emerald-700/50 bg-emerald-950/20 py-4 text-lg font-semibold text-emerald-400 transition-colors hover:bg-emerald-500/10 hover:text-emerald-300"
              >
                ✅ 认识
              </button>
            </div>
          )}
          <div className="text-xs text-slate-500">
            {isTouch ? '← 左滑不认识 · 右滑认识 →' : '← 不认识 · 认识 →'}
          </div>
        </div>
      </div>
    );
  }

  const flip = () => {
    if (!flipped) {
      setFlipped(true);
      getTts().speak(w.text);
    }
  };

  return (
    <div
      className={
        isTouch
          ? 'relative mx-auto flex h-full min-h-0 w-full items-center justify-center px-2 py-4'
          : 'mx-auto flex h-full min-h-0 max-w-lg flex-col items-center gap-4 px-4 py-4'
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

      {/* 内容区：卡片居中，max-w-lg 收窄防横屏撑太宽 */}
      <div className={isTouch ? 'relative z-10 flex min-h-0 w-full max-w-lg flex-col items-center gap-4' : 'flex min-h-0 w-full max-w-2xl flex-col items-center gap-4'}>
        {/* 统计栏：肉鸽模式双段（本局全局 + 本批进度），标准模式单段 */}
        {runStats ? (
          <div className="relative z-10 w-full rounded-2xl border border-slate-700/50 bg-slate-900/50 px-5 py-3 backdrop-blur-sm">
            <div className="flex items-center justify-center gap-5 text-sm">
              <span className="text-cyan-300">第 <span className="text-lg font-bold">{runStats.day}</span> 天</span>
              <span className="text-slate-600">|</span>
              <span className="text-slate-300">词池 <span className="text-lg font-bold text-slate-100">{runStats.poolUsed}</span></span>
              <span className="text-slate-600">|</span>
              <span className="text-slate-300">本波预览 <span className="text-lg font-bold text-slate-100">{runStats.wavePreview}</span></span>
            </div>
            <div className="mt-1.5 flex items-center justify-center gap-5 text-xs">
              <span className="text-emerald-400">认识 {known}</span>
              <span className="text-red-400">不认识 {unknown}</span>
              <span className="text-slate-500">剩余 {remaining}</span>
            </div>
          </div>
        ) : (
          <div className="relative z-10 flex w-full items-center justify-center gap-6 text-base">
            <span className="text-emerald-400">认识 {known}</span>
            <span className="text-red-400">不认识 {unknown}</span>
            <span className="text-slate-500">剩余 {remaining}</span>
          </div>
        )}

      {/* 进度条 */}
      <div className="relative z-10 h-2 w-full max-w-md overflow-hidden rounded-full bg-slate-800">
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
        className={`relative z-10 w-full max-h-full cursor-pointer select-none overflow-hidden rounded-3xl border-2 p-8 text-center transition-all duration-300 sm:p-10 ${
          flipped
            ? 'border-cyan-500/40 bg-slate-900/80 shadow-[0_0_28px_rgba(6,182,212,0.2)]'
            : 'border-slate-700/60 bg-slate-900/60 hover:border-cyan-500/30 hover:shadow-[0_0_16px_rgba(6,182,212,0.12)]'
        }`}
        style={{
          touchAction: isTouch ? 'none' : undefined,
          transform: cardXTx ? `translateX(${cardXTx}px)` : undefined,
        }}
      >
        <div className="mb-4 flex items-center justify-center gap-2.5">
          <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase ${tierColor(w.tier)}`}>
            {w.tier ?? '?'}
          </span>
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${s.badge}`}>
            {s.label}
          </span>
        </div>

        <div className="text-5xl font-black tracking-wide text-slate-100 sm:text-6xl">
          {w.text}
        </div>
        {w.phonetic && (
          <div className="mt-3 text-lg text-slate-400">{w.phonetic}</div>
        )}

        {/* 翻转区域 */}
        <div className={`mt-6 overflow-hidden transition-all duration-300 ${
          flipped ? 'max-h-72 opacity-100' : 'max-h-0 opacity-0'
        }`}>
          <div className="rounded-2xl border border-slate-700/50 bg-slate-800/40 p-5 text-left">
            {w.meanings.map((m, j) => (
              <div key={j} className="mb-2 last:mb-0 text-base text-slate-200">
                {m.meaning}
                {m.example && (
                  <div className="mt-0.5 text-sm text-slate-500 italic">{m.example}</div>
                )}
              </div>
            ))}
            {/* 记忆锚点：翻面后随释义一起显示 */}
            {w.mnemonic && (
              <div className="mt-3 rounded-xl border border-emerald-800/50 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-300/90">
                💡 {w.mnemonic}
              </div>
            )}
          </div>
        </div>

        {!flipped && (
          <div className="mt-5 text-sm text-slate-500 animate-pulse">
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
                className="rounded-full border border-slate-600 bg-slate-900/80 px-5 py-2.5 text-lg text-slate-300 transition-colors hover:bg-slate-800"
              >
                🔊
              </button>
              <button
                onClick={skipCurrent}
                title="标记已掌握"
                className="rounded-full border border-emerald-800 bg-emerald-950/40 px-5 py-2.5 text-base text-emerald-400 transition-colors hover:bg-emerald-500/20"
              >
                斩
              </button>
            </div>
          )}
          <div className={`text-center text-xs text-slate-500 ${flipped ? '' : 'animate-pulse'}`}>
            {flipped
              ? '← 左滑不认识 · 右滑认识 →'
              : '点击卡片查看释义'}
          </div>
        </>
      ) : (
        <>
          {/* 桌面：底部按钮行（不认识的词会被跳过（斩）- 让它们保留在题库中） */}
          {flipped && (
            <div className="flex w-full gap-4">
              <button
                onClick={() => markAndAdvance('unknown')}
                className="flex-1 rounded-2xl border border-red-700/50 bg-red-950/20 py-4 text-lg font-semibold text-red-400 transition-colors hover:bg-red-500/10 hover:text-red-300"
              >
                ❌ 不认识
              </button>
              <button
                onClick={() => getTts().speak(w.text)}
                className="rounded-2xl border border-slate-700 px-4 py-4 text-lg text-slate-400 transition-colors hover:bg-slate-800"
              >
                🔊
              </button>
              <button
                onClick={skipCurrent}
                title="标记已掌握"
                className="rounded-2xl border border-emerald-800 bg-emerald-950/20 px-4 py-4 text-lg text-emerald-400 transition-colors hover:bg-emerald-500/20"
              >
                斩
              </button>
              <button
                onClick={() => markAndAdvance('known')}
                className="flex-1 rounded-2xl border border-emerald-700/50 bg-emerald-950/20 py-4 text-lg font-semibold text-emerald-400 transition-colors hover:bg-emerald-500/10 hover:text-emerald-300"
              >
                ✅ 认识
              </button>
            </div>
          )}

          <div className="text-xs text-slate-600">
            {flipped ? '← 不认识 · ↓ 斩 · 认识 → · Backspace 撤回' : '空格 翻转 · 点击 翻卡'}
          </div>
        </>
      )}
      </div>
    </div>
  );
}
