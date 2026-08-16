// 选中文核心：展示英文词 + 4 个中文选项，纯点选判定，无拼写输入
// 选项由前端从会话下发的 foilPool 生成（pickOptions），服务端仅校验 typed；答错展示正确答案后直接下一题
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FoilOption, GameMode, Question } from '@word-journey/shared';
import { getTts } from '../lib/tts';
import { useIsTouch } from '../lib/touch';
import { pickOptions, type ChoiceOption } from '../lib/choices';
import { playComboSound, playComboTick, playCorrectSound, playWrongSound } from '../lib/sfx';
import type { AnswerRecord } from './TypingCore';

interface Props {
  questions: Question[];
  mode: GameMode;
  foilPool?: FoilOption[];
  onComplete: (answers: AnswerRecord[]) => void;
  // 每次判定后通知外层（驱动战斗层攻击/受击）
  onJudged?: (r: { correct: boolean; combo: number; seq: number; typed: string }) => void;
  // 答错 → 冻结全局怪物（选中文模式答错停留期内全局冰冻）
  onFreeze?: (frozen: boolean) => void;
  // 外部强制提前结束（如我方 HP 归零）→ 立即提交当前已答
  forceFinish?: boolean;
  // 战斗结束/失败后锁定输入
  locked?: boolean;
  onPressedChange?: (keys: string) => void;
  // 局内全局连击初值（生存 Run 跨波累计传入；普通战斗默认 0）
  initialCombo?: number;
}

interface Chosen {
  opt: ChoiceOption;
  correct: boolean;
}

export function ChoiceCore({ questions, mode, foilPool, onComplete, onJudged, onFreeze, forceFinish, locked, onPressedChange, initialCombo = 0 }: Props) {
  const [index, setIndex] = useState(0);
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [combo, setCombo] = useState(initialCombo);
  const startedAt = useRef(Date.now());
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const handlerRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  const answeredRef = useRef<AnswerRecord[]>([]);
  const comboRef = useRef(initialCombo);
  const finishedRef = useRef(false);
  const isTouch = useIsTouch();

  const q = questions[index];
  const options = useMemo<ChoiceOption[]>(
    () => (q ? pickOptions(q, foilPool) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [index, questions, foilPool],
  );

  // 切题：重置状态 + 首次展示自动发音 + 解冻（防冻结状态泄漏）
  useEffect(() => {
    clearTimeout(timerRef.current);
    setChosen(null);
    onFreeze?.(false);
    startedAt.current = Date.now();
    onPressedChange?.('');
    if (q) getTts().speak(q.answer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, mode]);

  useEffect(() => {
    return () => {
      clearTimeout(timerRef.current);
      onFreeze?.(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 外部强制结束（HP 归零）→ 提交当前已答
  useEffect(() => {
    if (forceFinish && !finishedRef.current) {
      finishedRef.current = true;
      clearTimeout(timerRef.current);
      onFreeze?.(false);
      onComplete(answeredRef.current);
    }
  }, [forceFinish, onComplete]);

  const advance = () => {
    if (index + 1 < questions.length) {
      onFreeze?.(false);
      setIndex(index + 1);
    } else if (!finishedRef.current) {
      finishedRef.current = true;
      onFreeze?.(false);
      onComplete(answeredRef.current);
    }
  };

  const choose = (opt: ChoiceOption) => {
    if (!q || !options.length) return;
    if (locked || finishedRef.current || chosen) return;
    // 同 seq 防重复判定：chosen 是异步 state，同一事件循环内连点/点选+快捷键会双判
    if (answeredRef.current.some((r) => r.seq === q.seq)) return;
    const correct = opt.text === q.answer;
    getTts().stop();
    const elapsedMs = Date.now() - startedAt.current;
    answeredRef.current = [...answeredRef.current, { seq: q.seq, correct, elapsedMs, typed: opt.text }];
    comboRef.current = correct ? comboRef.current + 1 : 0;
    setCombo(comboRef.current);
    if (correct) playCorrectSound();
    else playWrongSound();
    if (correct && comboRef.current >= 3) playComboSound(comboRef.current);
    else if (correct && comboRef.current >= 1) playComboTick(comboRef.current);
    onJudged?.({ correct, combo: comboRef.current, seq: q.seq, typed: opt.text });
    setChosen({ opt, correct });
    clearTimeout(timerRef.current);
    // 答对：短暂反馈 850ms 后自动进下一题；答错：冻结怪物并展示正确答案，由用户点击"下一题"按钮进入
    if (!correct) {
      onFreeze?.(true);
    } else {
      timerRef.current = setTimeout(() => {
        setChosen(null);
        advance();
      }, 850);
    }
  };

  const handleKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const idx = Number(e.key) - 1;
    if (Number.isInteger(idx) && idx >= 0 && idx < options.length) {
      e.preventDefault();
      choose(options[idx] as ChoiceOption);
    }
  };

  handlerRef.current = handleKey;

  useEffect(() => {
    if (isTouch) return; // 触屏直接点选，不走全局键盘
    const h = (e: KeyboardEvent) => handlerRef.current(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [isTouch]);

  if (!q) return null;

  const correctOpt: ChoiceOption = { text: q.answer, meaning: q.answerMeaning ?? '' };
  const finished = locked || chosen !== null;

  const optionCls = (opt: ChoiceOption) => {
    if (chosen) {
      if (opt.text === q.answer) {
        return 'border-emerald-400 bg-emerald-950/60 text-emerald-200 shadow-[0_0_14px_rgba(52,211,153,0.35)]';
      }
      if (chosen.opt.text === opt.text) {
        return 'border-red-400 bg-red-950/60 text-red-200 shadow-[0_0_14px_rgba(248,113,113,0.35)] animate-[shake_0.3s_ease-in-out]';
      }
      return 'border-slate-700 bg-slate-900/50 text-slate-400 opacity-60';
    }
    return 'border-slate-700 bg-slate-900/60 text-slate-100 hover:border-cyan-500/70 hover:bg-cyan-950/40 hover:shadow-[0_0_12px_rgba(6,182,212,0.25)]';
  };

  return (
    <div className={`mx-auto w-full max-w-3xl relative flex flex-col items-center justify-center gap-3 px-4 py-3 ${
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

      {/* 题面：英文词 + 连击 */}
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
        <div className="text-4xl font-extrabold tracking-wide text-slate-50" style={{ textShadow: '0 0 16px rgba(34,211,238,0.45)' }}>
          {q.prompt}
        </div>
        <div className="mt-1.5 flex items-center justify-center gap-3">
          {q.phonetic && <span className="text-lg font-medium text-slate-400">{q.phonetic}</span>}
          <button
            onClick={() => getTts().speak(q.answer)}
            className="rounded-lg border border-slate-600 px-3 py-1 text-sm text-slate-300 hover:bg-slate-800"
            title="播放发音"
          >
            🔊 发音
          </button>
        </div>
        <div className="mt-1 text-xs text-slate-500">选择正确的中文释义{!isTouch && <span className="ml-1 text-slate-600">（快捷键 1-4）</span>}</div>
      </div>

      {/* 4 个选项 */}
      <div className="grid w-full max-w-md grid-cols-1 gap-2.5 sm:grid-cols-2">
        {options.map((opt, i) => {
          const shown = i + 1;
          // 答错揭示态：在每个选项下显示对应英文词，非正确答案标红
          const revealWrong = chosen !== null && !chosen.correct;
          return (
            <button
              key={`${opt.text}-${opt.meaning}`}
              onClick={() => choose(opt)}
              disabled={finished}
              className={`rounded-xl border-2 px-4 py-3.5 text-left text-[15px] font-medium transition-all disabled:cursor-not-allowed ${optionCls(opt)}`}
            >
              <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full border border-current text-xs opacity-60">
                {shown}
              </span>
              {opt.meaning}
              {revealWrong && (
                <span
                  className={`mt-0.5 block pl-7 text-xs font-semibold ${
                    opt.text === q.answer ? 'text-emerald-300' : 'text-red-400'
                  }`}
                >
                  {opt.text === q.answer ? '✓ ' : '✗ '}{opt.text}
                </span>
              )}
              {revealWrong && opt.text === chosen.opt.text && opt.meanings && opt.meanings.length > 0 && (
                <span className="mt-1 block pl-7 text-[11px] leading-snug text-slate-300">
                  释义：{opt.meanings.join('；')}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 反馈 */}
      <div className="flex min-h-6 flex-col items-center justify-center text-center text-sm">
        {chosen?.correct && <span className="text-lg font-semibold text-emerald-400">✓ 正确</span>}
        {chosen && !chosen.correct && (
          <div className="flex flex-col items-center gap-2">
            <span className="text-lg font-semibold text-red-400">
              ✗ 答案：{correctOpt.text} {correctOpt.meaning}
            </span>
            <button
              onClick={() => advance()}
              disabled={locked || finishedRef.current}
              className="rounded-lg border border-cyan-500/60 bg-cyan-950/40 px-4 py-1.5 text-sm font-semibold text-cyan-300 transition hover:bg-cyan-900/50 hover:text-cyan-200 disabled:opacity-40"
            >
              下一题 →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}