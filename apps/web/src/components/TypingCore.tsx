// 打字核心：逐字母横线拼写输入 + 按键音效 + 音标 + 发音（双模式）
// 交互：每个字母一格，点击定位光标，逐个输入，填满自动判定
// 膨胀重写模式（v2.2）：答错 → 答题区膨胀 + 冻结小怪（onFreeze）→ 显示正确答案+例句 → 3 遍全对放技能（onSkillReleased）
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { GameMode, Question } from '@word-journey/shared';
import { getTts } from '../lib/tts';
import { useIsTouch } from '../lib/touch';
import { playComboSound, playCorrectSound, playKeySound, playWrongSound } from '../lib/sfx';

export interface AnswerRecord {
  seq: number;
  correct: boolean;
  elapsedMs: number;
  typed: string;
}

interface Props {
  questions: Question[];
  mode: GameMode;
  onComplete: (answers: AnswerRecord[]) => void;
  // 每次判定后通知外层（驱动战斗层攻击/受击）
  onJudged?: (r: { correct: boolean; combo: number; seq: number; typed: string }) => void;
  // 膨胀重写时通知战场冻结/解冻小怪（Boss 不冻结）
  onFreeze?: (frozen: boolean) => void;
  // 3 遍重写全对 → 通知战场释放技能
  onSkillReleased?: () => void;
  // 外部强制提前结束（如我方 HP 归零）→ 立即提交当前已答
  forceFinish?: boolean;
  // 战斗结束/失败后锁定输入（禁止继续作答）
  locked?: boolean;
  // 当前已输入字母串（用于战场右下角的迷你键盘提示）
  onPressedChange?: (keys: string) => void;
}

const REWRITE_TARGET = 3;

export function TypingCore({ questions, mode, onComplete, onJudged, onFreeze, onSkillReleased, forceFinish, locked, onPressedChange }: Props) {
  const [index, setIndex] = useState(0);
  const [letters, setLetters] = useState<string[]>([]);
  const [cursor, setCursor] = useState(0);
  const [feedback, setFeedback] = useState<'correct' | 'wrong' | null>(null);
  // 膨胀重写状态：答错进入，3 遍全对才放技能过题
  const [expanded, setExpanded] = useState(false);
  const [rewriteCount, setRewriteCount] = useState(0);
  const [combo, setCombo] = useState(0);
  const startedAt = useRef(Date.now());
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const handlerRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  const answeredRef = useRef<AnswerRecord[]>([]);
  const comboRef = useRef(0);
  const finishedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const isTouch = useIsTouch();

  const q = questions[index];
  const len = q?.answer.length ?? 0;

  // 切题：重置输入 + 首次展示自动发音（双模式都读，便于听音记忆）
  useEffect(() => {
    clearTimeout(timerRef.current);
    setLetters(Array.from({ length: len }, () => ''));
    setCursor(0);
    setExpanded(false);
    setRewriteCount(0);
    setFeedback(null);
    startedAt.current = Date.now();
    onPressedChange?.('');
    if (q) {
      const tts = getTts();
      tts.speak(q.answer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, mode]);

  // 已输入字母同步给外层（迷你键盘高亮）
  useEffect(() => {
    onPressedChange?.(letters.join(''));
  }, [letters, onPressedChange]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  // 外部强制结束（HP 归零）→ 提交当前已答
  useEffect(() => {
    if (forceFinish && !finishedRef.current) {
      finishedRef.current = true;
      clearTimeout(timerRef.current);
      onComplete(answeredRef.current);
    }
  }, [forceFinish, onComplete]);

  const advance = (next: AnswerRecord[]) => {
    if (index + 1 < questions.length) {
      setIndex(index + 1);
    } else if (!finishedRef.current) {
      finishedRef.current = true;
      onComplete(next);
    }
  };

  const commit = (word: string, correct: boolean) => {
    if (!q) return;
    const elapsedMs = Date.now() - startedAt.current;
    getTts().stop();
    const isFirst = !answeredRef.current.some((r) => r.seq === q.seq);
    if (isFirst) {
      if (correct) playCorrectSound();
      else playWrongSound();
      // 该 seq 首次判定才落记录（首判决定 SRS）；重写成功后不再重复记录
      answeredRef.current = [...answeredRef.current, { seq: q.seq, correct, elapsedMs, typed: word }];
      comboRef.current = correct ? comboRef.current + 1 : 0;
      setCombo(comboRef.current);
      if (correct && comboRef.current >= 3) playComboSound(comboRef.current);
      onJudged?.({ correct, combo: comboRef.current, seq: q.seq, typed: word });
    }
    startedAt.current = Date.now();

    if (correct) {
      if (isFirst) {
        // 首判即对 → 直接过题
        setFeedback('correct');
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          setFeedback(null);
          advance(answeredRef.current);
        }, 450);
      } else {
        // 膨胀重写成功
        const next = rewriteCount + 1;
        setRewriteCount(next);
        if (next >= REWRITE_TARGET) {
          // 3 遍全对 → 放技能 + 回缩 + 解冻 + 进下一题
          setFeedback('correct');
          onFreeze?.(false);
          onSkillReleased?.();
          clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => {
            setFeedback(null);
            setExpanded(false);
            setRewriteCount(0);
            setLetters(Array.from({ length: len }, () => ''));
            setCursor(0);
            advance(answeredRef.current);
          }, 420);
        } else {
          // 准备下一遍重写
          setFeedback('correct');
          clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => {
            setFeedback(null);
            setLetters(Array.from({ length: len }, () => ''));
            setCursor(0);
          }, 300);
        }
      }
    } else {
      if (isFirst) {
        // 首判答错：进入膨胀重写 + 冻结小怪
        setFeedback('wrong');
        setExpanded(true);
        setRewriteCount(0);
        onFreeze?.(true);
        setLetters(Array.from({ length: len }, () => ''));
        setCursor(0);
      } else {
        // 重写再错 → 计数器归零，从第 1 遍重新开始
        setFeedback('wrong');
        setRewriteCount(0);
        setLetters(Array.from({ length: len }, () => ''));
        setCursor(0);
      }
    }
  };

  // 共享输入原语：桌面键盘 / 触屏输入框共用（光标 + 满词判定）
  const applyChar = (raw: string) => {
    if (!q) return;
    if (locked || finishedRef.current || feedback === 'correct') return;
    const c = raw.toLowerCase();
    if (!/^[a-zA-Z\-']$/.test(c)) return;
    if (cursor >= len) return; // 已填满
    const next = [...letters];
    next[cursor] = c;
    setLetters(next);
    playKeySound();
    const nc = cursor + 1;
    setCursor(nc);
    if (nc >= len) {
      const word = next.join('');
      commit(word, word === q.answer.toLowerCase());
    }
  };

  const applyBackspace = () => {
    if (!q) return;
    if (locked || finishedRef.current || feedback === 'correct') return;
    if (cursor > 0) {
      const idx = cursor - 1;
      const next = [...letters];
      next[idx] = '';
      setLetters(next);
      setCursor(idx);
    }
  };

  // 触屏：原生输入框（iPadOS 自动带出键盘/随手写），值 → letters 直通
  const onInput = (e: ChangeEvent<HTMLInputElement>) => {
    if (!q) return;
    if (locked || finishedRef.current || feedback === 'correct') return;
    const capped = e.target.value
      .replace(/[^a-zA-Z\-']/g, '')
      .toLowerCase()
      .slice(0, len);
    const next = Array.from({ length: len }, (_, i) => capped[i] ?? '');
    const prevLen = letters.filter(Boolean).length;
    setLetters(next);
    setCursor(capped.length);
    if (capped.length > prevLen) playKeySound();
    if (capped.length >= len) {
      commit(capped, capped === q.answer.toLowerCase());
    }
  };

  const handleKey = (e: KeyboardEvent) => {
    if (!q) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Backspace') {
      e.preventDefault();
      applyBackspace();
      return;
    }
    if (/^[a-zA-Z\-']$/.test(e.key)) {
      e.preventDefault();
      applyChar(e.key);
    }
  };

  handlerRef.current = handleKey;

  useEffect(() => {
    if (isTouch) return; // 触屏用输入框，不走全局键盘
    const h = (e: KeyboardEvent) => handlerRef.current(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [isTouch]);

  // 触屏：每题自动聚焦输入框
  useEffect(() => {
    if (isTouch && !locked && !finishedRef.current) {
      const t = setTimeout(() => inputRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [index, mode, isTouch, locked, expanded]);

  if (!q) return null;

  const playVoice = () => {
    getTts().speak(q.answer);
  };

  const renderSlots = (size: 'lg' | 'md') => (
    <div className="flex flex-wrap items-end justify-center gap-2">
      {Array.from({ length: len }, (_, i) => {
        const filled = (letters[i] ?? '').trim();
        const active = i === cursor && feedback !== 'correct';
        const errored = feedback === 'wrong' && filled;
        const cls =
          size === 'lg'
            ? 'h-16 w-12 text-4xl'
            : 'h-14 w-10 text-2xl';
        if (active) {
          return (
            <button
              key={i}
              onClick={() => setCursor(i)}
              className={`flex ${cls} items-center justify-center border-b-2 font-bold outline-none border-cyan-300 ring-2 ring-cyan-400/60 shadow-[0_0_14px_rgba(34,211,238,0.65)] scale-105 transition-all duration-150 ${filled ? 'text-cyan-200' : 'text-slate-600'}`}
            >
              {filled || '▎'}
            </button>
          );
        }
        if (errored) {
          return (
            <button
              key={i}
              onClick={() => setCursor(i)}
              className={`flex ${cls} items-center justify-center border-b-2 font-bold outline-none border-red-400 shadow-[0_0_8px_rgba(248,113,113,0.4)] transition-all duration-150 animate-[shake_0.3s_ease-in-out] ${filled ? 'text-red-300' : 'text-slate-600'}`}
            >
              {filled || '_'}
            </button>
          );
        }
        return (
          <button
            key={i}
            onClick={() => setCursor(i)}
            className={`flex ${cls} items-center justify-center border-b-2 font-bold outline-none transition-all duration-150 ${
              filled
                ? 'border-cyan-400/70 shadow-[0_0_6px_rgba(34,211,238,0.3)] text-cyan-200 animate-[slot-pop_0.2s_ease-out]'
                : 'border-slate-600 hover:border-slate-400 text-slate-600'
            }`}
          >
            {filled || '_'}
          </button>
        );
      })}
    </div>
  );

  // 触屏：编辑框输入为主 + 一行紧凑进度点（桌面端不使用）
  const renderTouchInput = () => (
    <div className="w-full max-w-md space-y-2">
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        {Array.from({ length: len }, (_, i) => {
          const filled = (letters[i] ?? '').trim();
          return (
            <span
              key={i}
              className={`h-2 w-2 rounded-full transition-colors ${
                filled ? 'bg-cyan-400' : 'bg-slate-700'
              } ${i === cursor && feedback !== 'correct' ? 'ring-2 ring-cyan-300/70' : ''}`}
            />
          );
        })}
      </div>
      <input
        ref={inputRef}
        value={letters.join('')}
        onChange={onInput}
        readOnly={locked}
        inputMode="text"
        autoCapitalize="none"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="done"
        maxLength={len}
        placeholder={Array.from({ length: Math.max(1, len) }, () => '•').join(' ')}
        className="w-full rounded-2xl border-2 border-cyan-500/40 bg-slate-900/70 px-4 py-4 text-center font-bold tracking-[0.35em] text-cyan-200 outline-none transition-colors placeholder:text-slate-600 placeholder:tracking-[0.35em] focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/30"
        style={{ fontSize: 24 }}
      />
    </div>
  );

  if (expanded) {
    return (
      <div className="mx-auto w-full max-w-3xl relative px-4 py-3 transition-all duration-300">
        <div className="flex items-center justify-between">
          <div className="text-base font-bold text-amber-300">
            答案: <span style={{ textShadow: '0 0 10px rgba(252,211,77,0.5)' }}>{q.answer}</span>
          </div>
          <button
            onClick={playVoice}
            className="rounded-lg border border-slate-600 px-3 py-1 text-sm text-slate-300 hover:bg-slate-800"
          >
            🔊
          </button>
        </div>

        {q.example && (
          <div className="mt-2 rounded-lg border border-slate-700/50 bg-slate-900/40 px-3 py-1.5 text-center">
            <div className="text-xs text-slate-400">{q.example}</div>
          </div>
        )}

        <div className="mt-3 flex items-center justify-center gap-2">
          <span className="text-xs text-slate-500">重写</span>
          <div className="flex h-2 w-40 overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-cyan-400 transition-all"
              style={{ width: `${(rewriteCount / REWRITE_TARGET) * 100}%` }}
            />
          </div>
          <span className="text-xs font-medium text-cyan-300">{rewriteCount}/{REWRITE_TARGET}</span>
        </div>

        <div className="mt-3">{isTouch ? renderTouchInput() : renderSlots('lg')}</div>

        <div className="mt-2 h-5 text-center text-sm">
          {feedback === 'correct' && (
            <span className="text-emerald-400">✓</span>
          )}
          {feedback === 'wrong' && (
            <span className="text-red-400">✗ 重新开始</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`mx-auto w-full max-w-3xl relative flex flex-col items-center justify-center gap-2 px-4 py-3 ${
      combo >= 7 ? 'ring-1 ring-amber-500/40 shadow-[0_0_12px_rgba(245,158,11,0.2)]' :
      combo >= 3 ? 'ring-1 ring-cyan-500/25 shadow-[0_0_8px_rgba(6,182,212,0.15)]' : ''
    }`}>
      {/* 赛博进度条 */}
      <div className="w-full max-w-md">
        <div className="mb-1 flex justify-between text-xs text-slate-400">
          <span>第 {index + 1} 题</span>
          <span>共 {questions.length} 题</span>
        </div>
        <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-full rounded-full bg-gradient-to-r from-cyan-500 via-cyan-300 to-cyan-500 transition-all duration-300"
            style={{ width: `${((index + 1) / questions.length) * 100}%` }}
          >
            <div className="absolute right-0 top-1/2 -translate-y-1/2 h-3 w-3 rounded-full bg-cyan-200 animate-pulse" />
          </div>
        </div>
      </div>

      {/* 题面 + 连击 */}
      <div className="text-center">
        <div className="mb-2 flex items-center justify-center gap-2">
          {q.source && (
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
              q.source === 'new' ? 'bg-sky-500/15 text-sky-300' :
              q.source === 'review' ? 'bg-amber-500/15 text-amber-300' :
              q.source === 'wrongbook' ? 'bg-red-500/15 text-red-300' :
              'bg-purple-500/15 text-purple-300'
            }`}>
              {{ new: '新词', review: '复习', wrongbook: '错题', boss: 'Boss' }[q.source]}
            </span>
          )}
          {combo >= 2 && (
            <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-sm font-bold text-amber-400 animate-pulse">
              连击 ×{combo}
            </span>
          )}
        </div>
        <div className="flex items-center justify-center gap-4">
          <div className={`${mode === 'dictation' ? 'text-3xl' : 'text-2xl'} font-semibold text-slate-100`}>{q.prompt}</div>
        </div>
        {mode === 'dictation' && (
          <div className="text-xs text-slate-500">听发音拼写单词</div>
        )}
        <div className="mt-2 flex items-center justify-center gap-3">
          {q.phonetic && (
            <span className="text-lg font-medium text-slate-400">{q.phonetic}</span>
          )}
          <button
            onClick={playVoice}
            className={`rounded-lg border border-slate-600 px-3 py-1 text-sm text-slate-300 hover:bg-slate-800 ${
              mode === 'dictation' ? 'animate-pulse px-4 py-2 text-base border-amber-500/50 bg-amber-500/10 text-amber-300' : ''
            }`}
            title={mode === 'dictation' ? '重播语音' : '播放发音'}
          >
            {mode === 'dictation' ? '🔊 重播' : '🔊 发音'}
          </button>
        </div>
      </div>

      {/* 霓虹字母槽 / 触屏编辑框 */}
      {isTouch ? renderTouchInput() : renderSlots('md')}

      {/* 反馈 */}
      <div className="h-6 text-center text-sm">
        {feedback === 'correct' && (
          <span className="text-lg font-semibold text-emerald-400">✓ 正确</span>
        )}
        {feedback === 'wrong' && <span className="text-lg font-semibold text-red-400">✗ 错误，进入巩固重写</span>}
      </div>
    </div>
  );
}

export function MiniKeyboard({ pressedKeys }: { pressedKeys: string }) {
  const rows = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];
  const pads = [0, 6, 14];
  return (
    <div className="flex flex-col items-start gap-0.5 rounded-lg border border-slate-700/30 bg-slate-900/40 px-3 py-2 backdrop-blur-sm">
      {rows.map((row, ri) => (
        <div key={ri} className="flex gap-0.5" style={{ paddingLeft: `${pads[ri]}px` }}>
          {row.split('').map((k) => (
            <span
              key={k}
              className={`flex h-6 w-6 items-center justify-center rounded text-[12px] font-semibold transition-colors ${
                pressedKeys.toLowerCase().includes(k.toLowerCase())
                  ? 'bg-cyan-500/50 text-cyan-300 shadow-[0_0_8px_rgba(34,211,238,0.35)]'
                  : 'text-slate-500'
              }`}
            >
              {k}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}