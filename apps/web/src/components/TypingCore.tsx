// 打字核心：逐字母横线拼写输入 + 按键音效 + 音标 + 发音（双模式）
// 交互：每个字母一格，点击定位光标，逐个输入，填满自动判定
// 膨胀重写模式（v2.2）：答错 → 答题区膨胀 + 冻结小怪（onFreeze）→ 显示正确答案+例句 → 3 遍全对放技能（onSkillReleased）
import { useEffect, useRef, useState } from 'react';
import type { GameMode, Question } from '@word-journey/shared';
import { getTts } from '../lib/tts';
import { playCorrectSound, playKeySound, playWrongSound } from '../lib/sfx';

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
  onJudged?: (r: { correct: boolean; combo: number; seq: number }) => void;
  // 膨胀重写时通知战场冻结/解冻小怪（Boss 不冻结）
  onFreeze?: (frozen: boolean) => void;
  // 3 遍重写全对 → 通知战场释放技能
  onSkillReleased?: () => void;
  // 外部强制提前结束（如我方 HP 归零）→ 立即提交当前已答
  forceFinish?: boolean;
}

const REWRITE_TARGET = 3;

export function TypingCore({ questions, mode, onComplete, onJudged, onFreeze, onSkillReleased, forceFinish }: Props) {
  const [index, setIndex] = useState(0);
  const [letters, setLetters] = useState<string[]>([]);
  const [cursor, setCursor] = useState(0);
  const [feedback, setFeedback] = useState<'correct' | 'wrong' | null>(null);
  // 膨胀重写状态：答错进入，3 遍全对才放技能过题
  const [expanded, setExpanded] = useState(false);
  const [rewriteCount, setRewriteCount] = useState(0);
  const startedAt = useRef(Date.now());
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const handlerRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  const answeredRef = useRef<AnswerRecord[]>([]);
  const comboRef = useRef(0);
  const finishedRef = useRef(false);

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
    if (q) {
      const tts = getTts();
      tts.speak(q.answer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, mode]);

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
      onJudged?.({ correct, combo: comboRef.current, seq: q.seq });
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

  const handleKey = (e: KeyboardEvent) => {
    if (!q) return;
    if (feedback === 'correct') return; // 判定后的跳题/换遍等待期间屏蔽输入
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (e.key === 'Backspace') {
      e.preventDefault();
      if (cursor > 0) {
        const idx = cursor - 1;
        const next = [...letters];
        next[idx] = '';
        setLetters(next);
        setCursor(idx);
      }
      return;
    }

    if (!/^[a-zA-Z]$/.test(e.key)) return;
    e.preventDefault();
    if (cursor >= len) return; // 已填满
    const ch = e.key.toLowerCase();
    const next = [...letters];
    next[cursor] = ch;
    setLetters(next);
    playKeySound();
    const nc = cursor + 1;
    setCursor(nc);
    if (nc >= len) {
      const word = next.join('');
      commit(word, word === q.answer.toLowerCase());
    }
  };

  handlerRef.current = handleKey;

  useEffect(() => {
    const h = (e: KeyboardEvent) => handlerRef.current(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  if (!q) return null;

  const playVoice = () => {
    getTts().speak(q.answer);
  };

  const renderSlots = (size: 'lg' | 'md') => (
    <div className="flex flex-wrap items-end justify-center gap-2">
      {Array.from({ length: len }, (_, i) => {
        const filled = (letters[i] ?? '').trim();
        const active = i === cursor && feedback !== 'correct';
        const cls =
          size === 'lg'
            ? 'h-16 w-12 text-4xl'
            : 'h-14 w-10 text-2xl';
        return (
          <button
            key={i}
            onClick={() => {
              if (feedback !== 'correct') setCursor(i);
            }}
            className={`flex ${cls} items-center justify-center border-b-2 font-bold outline-none transition ${
              active
                ? 'animate-pulse border-cyan-300 ring-1 ring-cyan-400/50 shadow-[0_0_10px_rgba(34,211,238,0.45)]'
                : 'border-slate-600'
            } ${filled ? 'text-cyan-200' : 'text-slate-600'}`}
          >
            {filled || '_'}
          </button>
        );
      })}
    </div>
  );

  if (expanded) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-6 transition-all duration-300">
        {/* 头部：错误 + 发音 */}
        <div className="flex items-center justify-between">
          <div className="text-lg font-bold text-red-400">✗ 错误 · 巩固重写</div>
          <button
            onClick={playVoice}
            className="rounded-lg border border-slate-600 px-3 py-1 text-sm text-slate-300 hover:bg-slate-800"
            title={mode === 'dictation' ? '重播语音' : '播放发音'}
          >
            🔊 {mode === 'dictation' ? '重播' : '发音'}
          </button>
        </div>

        {/* 正确答案（大字） */}
        <div className="mt-4 text-center">
          <div className="text-2xl font-light text-slate-500">正确答案</div>
          <div
            className="text-4xl font-black tracking-widest text-amber-300"
            style={{ textShadow: '0 0 18px rgba(252,211,77,0.55)' }}
          >
            {q.answer}
          </div>
        </div>

        {/* 语境例句 */}
        {q.example && (
          <div className="mt-4 rounded-xl border border-slate-700/70 bg-slate-900/60 px-4 py-3 text-center">
            <div className="text-sm text-emerald-300">📖 {q.example}</div>
          </div>
        )}

        {/* 重写进度 */}
        <div className="mt-4 flex items-center justify-center gap-3">
          <div className="flex h-2.5 w-48 overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-cyan-400 transition-all duration-300"
              style={{ width: `${(rewriteCount / REWRITE_TARGET) * 100}%` }}
            />
          </div>
          <div className="text-sm font-medium text-cyan-300">
            重写进度 {rewriteCount} / {REWRITE_TARGET}
          </div>
        </div>

        {/* 字母槽 */}
        <div className="mt-4">{renderSlots('lg')}</div>

        {/* 反馈 */}
        <div className="mt-3 h-6 text-center">
          {feedback === 'correct' && (
            <span className="text-lg font-semibold text-emerald-400">✓ 重写正确</span>
          )}
          {feedback === 'wrong' && (
            <span className="text-lg font-semibold text-red-400">✗ 错误，从第 1 遍重新开始</span>
          )}
        </div>

        {/* 冻结提示 */}
        <div className="mt-2 text-center text-xs text-slate-500">
          ⏸ 小怪冻结中 · {rewriteCount < REWRITE_TARGET && 'Boss 继续逼近'}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl flex flex-col items-center justify-center gap-4 px-4 py-5">
      {/* 进度 */}
      <div className="text-xs text-slate-500">
        {index + 1} / {questions.length}
      </div>

      {/* 题面：释义（或音标）+ 音标行 + 发音按钮（正常答题不展示例句） */}
      <div className="text-center">
        <div className="text-2xl font-semibold text-slate-100">{q.prompt}</div>
        <div className="mt-2 flex items-center justify-center gap-3">
          {q.phonetic && (
            <span className="text-lg font-medium text-slate-400">{q.phonetic}</span>
          )}
          <button
            onClick={playVoice}
            className="rounded-lg border border-slate-600 px-3 py-1 text-sm text-slate-300 hover:bg-slate-800"
            title={mode === 'dictation' ? '重播语音' : '播放发音'}
          >
            {mode === 'dictation' ? '🔊 重播' : '🔊 发音'}
          </button>
        </div>
      </div>

      {/* 字母槽：横线逐字母输入 */}
      {renderSlots('md')}

      {/* 反馈 */}
      <div className="h-6 text-center text-sm">
        {feedback === 'correct' && (
          <span className="text-lg font-semibold text-emerald-400">✓ 正确</span>
        )}
        {feedback === 'wrong' && <span className="text-lg font-semibold text-red-400">✗ 错误，进入巩固重写</span>}
      </div>

      <div className="text-xs text-slate-600">
        直接用键盘输入字母，退格键删除，填满自动判定
      </div>
    </div>
  );
}