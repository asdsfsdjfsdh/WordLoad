// 生存 Run 流程（M5）：预习页 → 波战 → 天转换/普通buff三选一 → 首领战 → 传说选择 → 继续/收枪
// 服务端权威：波末 advance 重放定生死；本组件仅驱动 BattleField 生存层做波内视觉
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ActiveRunResponse,
  BackupWordsResult,
  CreateRunResponse,
  DifficultyTier,
  FoilOption,
  GameMode,
  LevelWord,
  PoolExpandInfo,
  ReplenishResult,
  RunAdvanceResponse,
  RunFinish,
  RunQuestion,
} from '@word-journey/shared';
import { BUFF_DEFS, REROLL_COIN_COST, SURVIVAL, activeSynergies, resolveEffects, type Rarity, type RerollRunResponse } from '@word-journey/shared';
import { api } from '../lib/api';
import { useIsTouch } from '../lib/touch';
import { BattleField, type BattleFieldHandle, WAVE_CLEAR_DURATION } from './BattleField';
import { TypingCore, MiniKeyboard, type AnswerRecord } from './TypingCore';
import { ChoiceCore } from './ChoiceCore';
import { FlashCard } from './FlashCard';
import type { SurvivalWaveMeta, TierIdx } from '../lib/survivalBattle';
import { emptyMemory, isWrongQueue, nextMemory, type WordMemory } from '../lib/runQueues';
import { battleBgm } from '../lib/bgm';

type Phase =
  | 'boot'
  | 'preview'
  | 'wave'
  | 'pick'
  | 'result';

interface BuffMeta {
  name: string;
  desc: string;
  rarity: Rarity;
  icon: string;
  tags: string[];
}

const RARITY_NAME = ['普通', '稀有', '史诗', '传说'] as const;

const rarityClass = (r: Rarity): { border: string; text: string; bg: string; badge: string } => {
  const map: Record<number, { border: string; text: string; bg: string; badge: string }> = {
    0: { border: 'border-slate-400/50', text: 'text-slate-300', bg: 'bg-slate-950/50', badge: 'bg-slate-500/20 text-slate-300' },
    1: { border: 'border-sky-400/60', text: 'text-sky-300', bg: 'bg-sky-950/50', badge: 'bg-sky-500/20 text-sky-300' },
    2: { border: 'border-violet-400/60', text: 'text-violet-300', bg: 'bg-violet-950/50', badge: 'bg-violet-500/20 text-violet-300' },
    3: { border: 'border-amber-400/60', text: 'text-amber-300', bg: 'bg-amber-950/50', badge: 'bg-amber-500/20 text-amber-300' },
  };
  return map[r] ?? map[0]!;
};

const buffMeta = (code: string): BuffMeta => {
  const d = BUFF_DEFS[code];
  if (!d) return { name: code, desc: '', rarity: 0, icon: '✨', tags: [] };
  return { name: d.name, desc: d.desc, rarity: d.rarity, icon: d.icon, tags: d.tags ?? [] };
};

// 战斗内常驻 buff HUD：图标+叠加层数 + 隐藏协同命中提示（关键词组合，见 activeSynergies）
function BuffHud({ codes }: { codes: string[] }) {  if (codes.length === 0) return null;
  const counts = new Map<string, number>();
  for (const c of codes) counts.set(c, (counts.get(c) ?? 0) + 1);
  const synergies = activeSynergies(codes);
  return (
    <div className="pointer-events-none absolute left-3 top-14 z-10 flex max-w-[60%] flex-wrap items-center gap-1.5">
      {[...counts.entries()].map(([code, n]) => {
        const info = buffMeta(code);
        const c = rarityClass(info.rarity);
        return (
          <div
            key={code}
            title={`${info.name}${n > 1 ? ` ×${n}` : ''} — ${info.desc}`}
            className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs backdrop-blur-sm ${c.border} ${c.bg}`}
          >
            <span>{info.icon}</span>
            {n > 1 && <span className={`font-bold ${c.text}`}>×{n}</span>}
          </div>
        );
      })}
      {synergies.map((s) => (
        <div
          key={s.code}
          title={s.desc}
          className="flex animate-pulse items-center gap-1 rounded-full border border-amber-400/70 bg-amber-500/20 px-2 py-0.5 text-xs font-bold text-amber-200 shadow-[0_0_10px_rgba(251,191,36,0.5)]"
        >
          <span>{s.icon}</span>
          <span>{s.label}</span>
        </div>
      ))}
    </div>
  );
}

// 节奏 HUD：近期正确率（undefined=无数据 → 平稳）。与 buff-picker accTier 阈值对齐
function RhythmHud({ acc }: { acc: number | undefined }) {
  const tier = acc === undefined ? 'mid' : acc < 0.75 ? 'low' : acc >= 0.85 ? 'high' : 'mid';
  const meta = {
    low: { icon: '📉', label: '手感需要复习', cls: 'border-red-500/50 bg-red-500/15 text-red-300' },
    mid: { icon: '➖', label: '节奏平稳', cls: 'border-slate-500/50 bg-slate-500/15 text-slate-300' },
    high: { icon: '🔥', label: '手感火热', cls: 'border-amber-500/60 bg-amber-500/15 text-amber-300' },
  }[tier]!;
  return (
    <div
      className={`pointer-events-none absolute right-3 top-28 z-10 flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs backdrop-blur-sm ${meta.cls}`}
      title="近期答题正确率（约 20 题）：驱动 buff 候选、新词注入与强制停注入"
    >
      <span>{meta.icon}</span>
      <span>{meta.label}</span>
    </div>
  );
}

// unit Run 通关进度 HUD：已掌握 x/y（全词掌握后触发 Final Boss）
function UnitProgressHud({ mastered, total, boss }: { mastered: number | undefined; total: number | undefined; boss: boolean }) {
  if (mastered === undefined || total === undefined) return null;
  if (boss) {
    return (
      <div className="pointer-events-none absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-amber-500/60 bg-amber-500/15 px-3 py-1 text-xs font-bold text-amber-300 backdrop-blur-sm">
        <span>👑</span>
        <span>Final Boss · 击败即通关</span>
      </div>
    );
  }
  const pct = total > 0 ? Math.round((mastered / total) * 100) : 0;
  const all = mastered >= total;
  return (
    <div
      className={`pointer-events-none absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border px-3 py-1 text-xs backdrop-blur-sm ${
        all ? 'border-amber-500/60 bg-amber-500/15 text-amber-300' : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
      }`}
      title="Unit 全部词已掌握 → 触发 Final Boss"
    >
      <span>📚</span>
      <span>
        已掌握 {mastered}/{total}
      </span>
      <span className="opacity-70">({pct}%)</span>
      {all && <span className="font-bold">⚔️ 决战将至</span>}
    </div>
  );
}

// 红宝书肉鸽词池跨关卡扩展 HUD：展示已并池 Unit 范围、干净队列占比、每日题量
function PoolExpandBadge({ info }: { info: PoolExpandInfo | undefined }) {
  if (!info || info.pooledStages.length === 0) return null;
  const first = info.pooledStages[0] ?? 101;
  const last = info.pooledStages[info.pooledStages.length - 1] ?? first;
  const regionOf = (s: number): string => s >= 300 ? '超纲' : s >= 200 ? '基础' : '必考';
  const label =
    info.pooledUnits > 1
      ? `${regionOf(first)}${first % 100}~${regionOf(last)}${last % 100}`
      : `${regionOf(first)}${first % 100}`;
  const pct = Math.round(info.cleanRate * 100);
  const ready = info.canExpand;
  return (
    <div
      className={`pointer-events-none absolute right-3 top-20 z-10 flex max-w-[55%] flex-wrap items-center gap-1.5 rounded-2xl border px-2.5 py-1.5 text-[11px] backdrop-blur-sm ${
        ready
          ? 'border-emerald-500/60 bg-emerald-950/60 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.3)]'
          : 'border-slate-600/50 bg-slate-900/80 text-slate-300'
      }`}
      title={`已并池 ${info.pooledUnits} 个 Unit（${label}）· 干净队列 ${pct}%${ready ? '，下一波将并池下一关' : ''} · 每日 ${info.questionsPerDay} 题`}
    >
      <span>🗺️</span>
      <span className="font-semibold">词池 {label}</span>
      <span className="opacity-80">{info.pooledUnits} 关</span>
      <span className="opacity-80">· 干净 {pct}%</span>
      {ready && <span className="font-bold text-emerald-300">· 即将扩展</span>}
    </div>
  );
}

function tierToIdx(t: DifficultyTier): TierIdx {
  return t === 'I' ? 0 : t === 'II' ? 1 : t === 'III' ? 2 : 3;
}

// 游玩时长格式化：<1h → mm:ss，≥1h → h:mm:ss
export const formatPlayTime = (seconds: number): string => {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${two(m)}:${two(sec)}`;
};

// 局内秒表 chip：肉鸽 Run 全程计时（预览/选增益/波战均累计，结算展示）
function PlayTimeChip({ seconds }: { seconds: number }) {
  return (
    <div
      className="pointer-events-none absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded-full border border-slate-600/50 bg-slate-900/80 px-2.5 py-0.5 font-mono text-xs font-semibold tabular-nums text-cyan-300 backdrop-blur-sm"
      title="本局游玩时长"
    >
      <span>⏱</span>
      <span>{formatPlayTime(seconds)}</span>
    </div>
  );
}

interface RunFlowProps {
  bankCode: string;
  stageId: number;
  mode: GameMode;
  onExit: () => void;
}

export function RunFlow({ bankCode, stageId, mode, onExit }: RunFlowProps) {
const isTouch = useIsTouch();
  const battleRef = useRef<BattleFieldHandle>(null);

  const [phase, setPhase] = useState<Phase>('boot');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Run 状态（服务端权威的镜像）
  const [runId, setRunId] = useState(0);
  const [day, setDay] = useState(1);
  const [hp, setHp] = useState(0);
  const [maxHp, setMaxHp] = useState(0);
  const [buffs, setBuffs] = useState<string[]>([]);
  const [questions, setQuestions] = useState<RunQuestion[]>([]);
  const [previewWords, setPreviewWords] = useState<LevelWord[]>([]);
  const [bossWave, setBossWave] = useState(false);
  const [bossHp, setBossHp] = useState(0);
  // 局内全局连击（跨波累计，错答归零；服务端持久化，随响应刷新）
  const [combo, setCombo] = useState(0);
  // 本局游玩时长（秒）：客户端秒表累计，随 advance/finish 上报，服务端权威回传
  const [playSeconds, setPlaySeconds] = useState(0);
  const playSecondsRef = useRef(0);
  // 本局词池大小（累计去重词数，day1=20，注入逐日增加）
  const [poolUsed, setPoolUsed] = useState(0);
  // 红宝书肉鸽词池跨关卡扩展信息（非红宝书词书 pooledStages=[]）
  const [poolExpand, setPoolExpand] = useState<PoolExpandInfo | undefined>(undefined);
  // 选中文模式干扰项候选池（服务端从同阶段词池抽样下发）
  const [serverFoilPool, setServerFoilPool] = useState<FoilOption[] | undefined>(undefined);

  // 待选/已选
  const [pendingBuff, setPendingBuff] = useState<string | null>(null);
  const [pendingLegend, setPendingLegend] = useState<string | null>(null);
  const [buffChoices, setBuffChoices] = useState<string[]>([]);
  const [legendChoices, setLegendChoices] = useState<string[]>([]);
  const [result, setResult] = useState<RunFinish | null>(null);
  // unit Run 通关进度 HUD（非 unit 恒 undefined）
  const [masteredCount, setMasteredCount] = useState<number | undefined>(undefined);
  const [totalCount, setTotalCount] = useState<number | undefined>(undefined);
  // 角色权威三围（随响应下发，避免 auth store 陈旧导致预测分歧）
  const [atkLv, setAtkLv] = useState(1);
  const [defLv, setDefLv] = useState(1);
  // 角色特化（随响应下发，客户端预测口径与服务端引擎一致）
  const [executeSpec, setExecuteSpec] = useState(false);
  const [vampireSpec, setVampireSpec] = useState(false);

  // 波战输入控制
  const [forceFinish, setForceFinish] = useState(false);
  const [locked, setLocked] = useState(false);
  const [waveKey, setWaveKey] = useState(0);
  const [skippedWords, setSkippedWords] = useState<Set<string>>(new Set());
  // 预习候补词池：先预取一批，斩词时「先上替补再减总量」，池低于阈值再向后端要一批
  const backupPoolRef = useRef<LevelWord[]>([]);
  const backupFetchingRef = useRef(false);
  // 最新 previewWords / skippedWords 镜像（async 预取/补词中读取，避免闭包陈旧）
  const previewWordsRef = useRef<LevelWord[]>([]);
  const skippedWordsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    previewWordsRef.current = previewWords;
  }, [previewWords]);
  useEffect(() => {
    skippedWordsRef.current = skippedWords;
  }, [skippedWords]);
  // 已输入字母串（战场迷你键盘高亮）
  const [pressedKeys, setPressedKeys] = useState('');
  // 近期正确率（服务端下发，用于"节奏"HUD；无数据时显示平稳）
  const [recentAcc, setRecentAcc] = useState<number | undefined>(undefined);
  // 金币与"本波已重抽"标记（重抽按钮用）
  const [coins, setCoins] = useState(0);
  const [rerolledToday, setRerolledToday] = useState(false);
  const [rerolling, setRerolling] = useState(false);
  // 波末提交失败：保留答案供「重试提交」（服务端 expectedDay 幂等守卫保证安全重试）
  const [submitFailed, setSubmitFailed] = useState(false);
  const pendingAnswersRef = useRef<AnswerRecord[]>([]);

  // 局内双队列词记忆（干净/错词，镜像 forgetting.ts 语义；跨波持续）
  const queueMemRef = useRef<Map<string, WordMemory>>(new Map());
  // 同步双队列词数到战场左下角图表：错词=未恢复错词数，干净=全池-错词
  const syncQueueStats = (pool?: number): void => {
    const total = pool ?? poolUsed;
    let wrong = 0;
    for (const m of queueMemRef.current.values()) {
      if (isWrongQueue(m)) wrong++;
    }
    battleRef.current?.setQueueStats({ clean: Math.max(0, total - wrong), wrong });
  };

  // 非 Boss 波末清场动画：先播放灰化再推进下一阶段
  const [waveEnding, setWaveEnding] = useState(false);
  const waveTimerRef = useRef<number | null>(null);
  // 同步防重入：busy 为异步 state，双击/连点会绕过；ref 保证同一时刻仅一次 advance 提交
  const submittingRef = useRef(false);
  const clearWaveTimer = (): void => {
    if (waveTimerRef.current !== null) {
      window.clearTimeout(waveTimerRef.current);
      waveTimerRef.current = null;
    }
  };
  useEffect(() => () => clearWaveTimer(), []);

  // 秒表 ref 与 state 同步（响应回传/本地自增共用同一基准）
  useEffect(() => {
    playSecondsRef.current = playSeconds;
  }, [playSeconds]);
  // 局内计时：预览/选增益/波战阶段每秒自增（结束/出错停表）
  useEffect(() => {
    if (phase !== 'preview' && phase !== 'wave' && phase !== 'pick') return;
    const t = window.setInterval(() => setPlaySeconds((s) => s + 1), 1000);
    return () => window.clearInterval(t);
  }, [phase]);

  // 选中文模式的候选池：服务端下发的同阶段词池抽样 + 本波预习词/题目词兜底，
  // 保证 Boss 波/无注入日每题也有 ≥3 干扰项
  const foilPool = useMemo<FoilOption[] | undefined>(() => {
    if (mode !== 'choice') return undefined;
    const seen = new Set<string>();
    const pool: FoilOption[] = [];
    const push = (text: string, meaning: string): void => {
      if (!text || !meaning) return;
      const key = `${text}::${meaning}`;
      if (seen.has(key)) return;
      seen.add(key);
      pool.push({ text, meaning });
    };
    for (const w of previewWords) push(w.text, w.meanings[0]?.meaning ?? '');
    for (const q of questions) push(q.answer, q.answerMeaning ?? '');
    for (const f of serverFoilPool ?? []) push(f.text, f.meaning);
    return pool.length > 0 ? pool : undefined;
  }, [mode, previewWords, questions, serverFoilPool]);

  // ── 初始化：续 Run 优先，否则创建 ──
  const applyCreateResponse = (r: CreateRunResponse | ActiveRunResponse) => {
    // CreateRunResponse 无阶段恢复字段；ActiveRunResponse 可能带（续 Run）
    const active = r as ActiveRunResponse;
    setRunId(r.run.id);
    setDay(r.run.day);
    setHp(r.run.hp);
    setMaxHp(r.run.maxHp);
    setBuffs(r.run.buffs);
    setQuestions(r.questions);
    setPreviewWords(r.previewWords ?? []);
    setBossWave(active.bossWave ?? false);
    setBossHp(active.bossHp ?? 0);
    setAtkLv(r.atkLv ?? 1);
    setDefLv(r.defLv ?? 1);
    setExecuteSpec(r.executeSpec ?? false);
    setVampireSpec(r.vampireSpec ?? false);
    setPoolUsed(r.poolUsed ?? 0);
    setPoolExpand(r.poolExpand ?? undefined);
    setServerFoilPool(r.foilPool ?? undefined);
    setCombo(r.combo ?? 0);
    setPlaySeconds(r.run.playSeconds ?? 0);
    setRecentAcc(active.recentAcc ?? undefined);
    setCoins(active.coins ?? r.coins ?? 0);
    setRerolledToday(active.rerolledToday ?? false);
    setMasteredCount(active.masteredCount ?? undefined);
    setTotalCount(active.totalCount ?? undefined);
    // 双队列图表：全池口径随 poolUsed 刷新
    syncQueueStats(r.poolUsed ?? 0);
    // 有 previewWords（含新注入词）→ 先闪卡学习，再选 buff，后波战
    if ((r.previewWords?.length ?? 0) > 0) {
      setBuffChoices(active.buffChoices ?? []);
      setLegendChoices(active.legendChoices ?? []);
      setPhase('preview');
    } else if (active.buffChoices?.length || active.legendChoices?.length) {
      setBuffChoices(active.buffChoices ?? []);
      setLegendChoices(active.legendChoices ?? []);
      setPhase('pick');
    } else {
      setPhase('wave');
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const active = await api.get<ActiveRunResponse | null>('/runs/active');
        if (cancelled) return;
        // 续 Run 仅限同一 Unit（stageId 匹配）；进入其他 Unit 则开新局（服务端自动收枪旧局）
        if (active && active.run.stageId === Number(stageId)) {
          applyCreateResponse(active);
          return;
        }
        const created = await api.post<CreateRunResponse>('/runs', {
          bankCode,
          stageId,
          mode,
        });
        if (cancelled) return;
        applyCreateResponse(created);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : '创建 Run 失败');
        setPhase('preview');
        setPreviewWords([]);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankCode, stageId, mode]);

  // ── 预习页 ──
  // 在途斩词/补词请求（开始战斗前等待，避免补词晚到导致波内题目数漂移）
  const skipOpsRef = useRef<Promise<unknown>[]>([]);
  const BACKUP_BATCH = 6;   // 每次向后端预取的候补词数
  const SKIP_BACKUP_AT = 2;  // 斩到剩余这么多时触发预取下一批

  // 向后端预取一批候补新词（未落库，仅供闪卡展示）：排除已用/已斩/池内词，避免补重
  const fetchBackupWords = async () => {
    if (backupFetchingRef.current) return;
    backupFetchingRef.current = true;
    try {
      const exclude = [
        ...previewWordsRef.current.map((w) => w.wordId),
        ...skippedWordsRef.current,
        ...backupPoolRef.current.map((w) => w.wordId),
      ];
      const res = await api.get<BackupWordsResult>(
        `/runs/${runId}/backup-words?count=${BACKUP_BATCH}&exclude=${exclude.join(',')}`,
      );
      if (res?.words?.length) {
        const fresh = res.words.filter((w) => !backupPoolRef.current.some((b) => b.wordId === w.wordId));
        backupPoolRef.current = [...backupPoolRef.current, ...fresh];
      }
    } catch { /* 预取失败静默：斩词仍可正常执行，只是本轮无候补 */ }
    finally { backupFetchingRef.current = false; }
  };

  const skipPreviewWord = async (wordId: string) => {
    const op = (async () => {
      // 先上替补：从本地候补池同步取一个词加入预习（总量不变），再标记斩词
      const substitute = backupPoolRef.current.shift();
      if (substitute) {
        setPreviewWords((prev) => [...prev, substitute]);
      }
      setSkippedWords((prev) => new Set(prev).add(wordId));
      try {
        await api.post<{ ok: boolean }>(`/questions/words/${wordId}/skip`, {});
      } catch {
        // 斩词失败：回滚斩词标记与替补（保持列表与总量一致）
        setSkippedWords((prev) => {
          const n = new Set(prev);
          n.delete(wordId);
          return n;
        });
        if (substitute) {
          setPreviewWords((prev) => prev.filter((w) => w.wordId !== substitute.wordId));
          backupPoolRef.current.unshift(substitute);
        }
        return;
      }
      // 候补池不足 → 预取下一批（不阻塞当前斩词）
      if (backupPoolRef.current.length < SKIP_BACKUP_AT) {
        void fetchBackupWords();
      }
      if (!substitute) return; // 无候补可上（该阶段无新词了），仅斩词
      try {
        // 把替补词落库为本波题目（服务端创建 RunItem 并返回题目）
        const rep = await api.post<ReplenishResult | null>(`/runs/${runId}/replenish`, {
          wordId: substitute.wordId,
        });
        if (rep) {
          setQuestions((prev) => [...prev, rep.question]);
          setPoolUsed(rep.poolUsed ?? 0);
        }
      } catch { /* 补词失败静默（斩词本身有效） */ }
    })();
    skipOpsRef.current.push(op);
    op.finally(() => {
      skipOpsRef.current = skipOpsRef.current.filter((x) => x !== op);
    });
  };

  // 进入预习页：预取一批候补词，确保斩第一个词就有替补可上。
  // 仅在进入 preview 时取一次；后续池低由 skipPreviewWord 内 SKIP_BACKUP_AT 触发续取，
  // 避免每次斩词/补词导致 previewWords.length 变化而无限拉大候补池。
  useEffect(() => {
    if (phase === 'preview') {
      void fetchBackupWords();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // 斩掉的词从本波题里移除（服务端 skip 已同步标记 active Run 待答题为已答）
  const applySkippedToQuestions = () => {
    if (skippedWords.size > 0) {
      setQuestions((prev) => prev.filter((q) => !skippedWords.has(q.wordId)));
    }
    setSkippedWords(new Set());
    // 预习结束：清空候补池（未用完的候补词下次预习重新预取）
    backupPoolRef.current = [];
  };

  // ── 波战 meta ──
  const survivalMeta = useMemo<SurvivalWaveMeta | null>(() => {
    const all = [...buffs];
    if (pendingBuff) all.push(pendingBuff);
    if (pendingLegend) all.push(pendingLegend);
    // maxhp 候选在波前生效：上限 +2
    const effectiveMaxHp = pendingBuff === 'maxhp' ? maxHp + SURVIVAL.BUFF_MAXHP : maxHp;
    return {
      day,
      // 权威三围：随 create/advance/getActive 响应下发，避免 auth store 陈旧导致预测分歧
      atkLv,
      defLv,
      hpLv: 1,
      maxHp: effectiveMaxHp,
      hp,
      buffs: {
        dmg: all.filter((b) => b === 'dmg').length,
        leech: all.filter((b) => b === 'leech').length,
        dodge: all.filter((b) => b === 'dodge').length,
        freeze: all.filter((b) => b === 'freeze').length,
      },
      legend: {
        bossImmunity: all.includes('boss-immunity'),
        killHeal: all.includes('kill-heal'),
        bossX2: all.includes('boss-x2'),
        noLeakDmg: all.includes('no-leak-dmg'),
      },
      effects: resolveEffects(all),
      poolUsed,
      buffCodes: all,
      questions: questions.map((q) => ({
        tier: tierToIdx(q.tier),
        isNew: q.isNew,
        isBoss: q.source === 'boss',
        len: q.answer?.length ?? 4,
      })),
      bossWave,
      bossHp: bossWave ? bossHp : undefined,
      initialCombo: combo,
      executeSpec,
      vampireSpec,
    };
  }, [day, hp, maxHp, buffs, pendingBuff, pendingLegend, questions, bossWave, bossHp, combo, atkLv, defLv, poolUsed, executeSpec, vampireSpec]);

  // 进入波战：启动生存波
  useEffect(() => {
    if (phase === 'wave' && survivalMeta) {
      const t = setTimeout(() => {
        battleRef.current?.startSurvivalWave(survivalMeta!);
        // 波首同步一次双队列图表（含池更新后的初始点）
        syncQueueStats(survivalMeta?.poolUsed);
      }, 60);
      return () => clearTimeout(t);
    }
  }, [phase, waveKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // 自适应 BGM 生命周期：进波启动，出波/卸载停止
  useEffect(() => {
    if (phase !== 'wave') return;
    battleBgm.start();
    return () => battleBgm.stop();
  }, [phase]);

  // BGM 调制：危险度（HP 比例）/ 首领波 → 能量与和声模式渐变
  useEffect(() => {
    if (phase !== 'wave') return;
    const danger = bossWave ? 1 : hp <= 0 || maxHp <= 0 ? 0 : 1 - hp / maxHp;
    battleBgm.setDanger(danger);
    battleBgm.setBoss(bossWave);
  }, [phase, hp, maxHp, bossWave]);

  // 逐题判定：驱动 BGM 连击/节奏反馈 + 战场生存层 + 双队列词记忆
  const lastJudgedAtRef = useRef(0);
  const handleJudged = (r: { correct: boolean; combo: number; seq: number; typed: string }): void => {
    const now = Date.now();
    const intervalMs = lastJudgedAtRef.current ? now - lastJudgedAtRef.current : 0;
    lastJudgedAtRef.current = now;
    // 全局连击：以本局累计为基准推算（组件初始连击与服务端一致），错答归零
    const next = r.correct ? combo + 1 : 0;
    setCombo(next);
    battleBgm.note({ correct: r.correct, combo: next, intervalMs });
    battleRef.current?.survivalTick(r.correct, next, r.typed);
    // 词记忆：按 seq 反查 wordId 更新（Boss 题 source='boss' 同属本局词）
    const q = questions.find((x) => x.seq === r.seq);
    if (q) {
      const prev = queueMemRef.current.get(q.wordId) ?? emptyMemory();
      queueMemRef.current.set(q.wordId, nextMemory(prev, r.correct, r.seq));
      syncQueueStats();
    }
  };

  // ── advance：波末提交 → 服务端重放 → 注入 → 下一波 ──
  const handleAdvanceResult = (res: RunAdvanceResponse) => {
    if (res.bossCleared) battleBgm.celebrate();
    setWaveEnding(false);
    setHp(res.hp);
    setMaxHp(res.maxHp);
    setBuffs(res.buffs);
    setCombo(res.combo ?? 0);
    setPlaySeconds(res.playSeconds ?? 0);
    setAtkLv(res.atkLv ?? 1);
    setDefLv(res.defLv ?? 1);
    setExecuteSpec(res.executeSpec ?? false);
    setVampireSpec(res.vampireSpec ?? false);
    setPoolUsed(res.poolUsed ?? 0);
    setPoolExpand(res.poolExpand ?? undefined);
    setServerFoilPool(res.foilPool ?? undefined);
    setRecentAcc(res.recentAcc ?? undefined);
    setMasteredCount(res.masteredCount ?? undefined);
    setTotalCount(res.totalCount ?? undefined);
    // 双队列图表：全池口径随 poolUsed 刷新
    syncQueueStats(res.poolUsed ?? 0);
    if (res.ended) {
      setResult(res.result ?? null);
      setPhase('result');
      return;
    }
    if (res.bossWave) {
      // 首领波：先打 Boss，本轮不结算 buff 候选
      setDay(res.day);
      setQuestions(res.questions);
      setPreviewWords([]);
      setBossWave(true);
      setBossHp(res.bossHp ?? 0);
      setWaveKey((k) => k + 1);
      setPhase('wave');
      return;
    }
    // 次日
    setDay(res.day);
    setQuestions(res.questions);
    setPreviewWords(res.previewWords ?? []);
    setBossWave(false);
    setBossHp(0);
    setCoins(res.coins ?? 0);
    setRerolledToday(res.rerolledToday ?? false);
    setPendingBuff(null);
    setPendingLegend(null);
    // 有 previewWords（新注入词）→ 先闪卡学习，再选 buff，后波战
    if ((res.previewWords?.length ?? 0) > 0) {
      setLegendChoices(res.legendChoices ?? []);
      setBuffChoices(res.buffChoices ?? []);
      setPhase('preview');
    } else if (res.legendChoices?.length) {
      setLegendChoices(res.legendChoices);
      setBuffChoices(res.buffChoices ?? []);
      setPhase('pick');
    } else if (res.buffChoices?.length) {
      setBuffChoices(res.buffChoices);
      setLegendChoices([]);
      setPhase('pick');
    } else {
      setWaveKey((k) => k + 1);
      setPhase('wave');
    }
  };

  const doAdvance = async (answers: AnswerRecord[]) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    setLocked(true);
    let res: RunAdvanceResponse | null = null;
    try {
      res = await api.post<RunAdvanceResponse>(`/runs/${runId}/advance`, {
        answers: answers.map((a) => ({
          seq: a.seq,
          correct: a.correct,
          elapsedMs: a.elapsedMs,
          typed: a.typed,
        })),
        buffChoice: pendingBuff ?? undefined,
        legendChoice: pendingLegend ?? undefined,
        expectedDay: day,
        playSeconds: playSecondsRef.current,
      });
      setPendingBuff(null);
      setPendingLegend(null);
      setForceFinish(false);
      setLocked(false);
      setSubmitFailed(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : '推进失败');
      setSubmitFailed(true);
      setForceFinish(false);
      setLocked(false);
      setWaveEnding(false);
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
    // 服务端已成功：结果处理抛错不得被误判为“推进失败”（否则会错误地给出重试入口）
    if (res) {
      try {
        handleAdvanceResult(res);
      } catch {
        setError('推进已保存，但本地状态更新异常');
        setForceFinish(false);
      }
    }
  };

  const handleWaveComplete = (answers: AnswerRecord[]) => {
    if (busy || submittingRef.current) return;
    // 留存波末答案：提交失败时可原样重试（服务端 expectedDay 幂等守卫）
    pendingAnswersRef.current = answers;
    setSubmitFailed(false);
    // 阵亡：直接结算切波；普通波/首领波：先播清场动画（首领击破庆祝）再推进
    if (forceFinish) {
      doAdvance(answers);
      return;
    }
    setWaveEnding(true);
    clearWaveTimer();
    waveTimerRef.current = window.setTimeout(() => {
      waveTimerRef.current = null;
      doAdvance(answers);
    }, WAVE_CLEAR_DURATION);
  };

  // ── 收枪 ──
  const surrender = async () => {
    if (busy || submittingRef.current) return; // 推进/结算中：忽略重复收枪
    clearWaveTimer();
    setWaveEnding(false);
    setBusy(true);
    try {
      const res = await api.post<RunFinish>(`/runs/${runId}/finish`, { surrender: true, playSeconds: playSecondsRef.current });
      setResult(res);
      setPhase('result');
    } catch (e) {
      setError(e instanceof Error ? e.message : '收枪失败');
    } finally {
      setBusy(false);
    }
  };

  // ── 金币重抽增益（每波 1 次）：重新生成三选一 ──
  const doReroll = async () => {
    if (busy || rerolling || rerolledToday) return;
    setRerolling(true);
    setError('');
    try {
      const res = await api.post<RerollRunResponse>(`/runs/${runId}/reroll`, {});
      setBuffChoices(res.buffChoices ?? []);
      setLegendChoices(res.legendChoices ?? []);
      setCoins(res.coins ?? 0);
      setRerolledToday(true);
      setPendingBuff(null);
      setPendingLegend(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '重抽失败');
    } finally {
      setRerolling(false);
    }
  };

  // ── 渲染 ──
  if (phase === 'boot') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-950">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
        <p className="text-sm text-slate-400">准备生存 Run…</p>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>
    );
  }

  // 预习页（新词首战日 / 注入次日）
  if (phase === 'preview') {
    const displayWords = previewWords.filter((w) => !skippedWords.has(w.wordId));
    return (
      <div className="flex h-dvh flex-col overflow-hidden bg-slate-950">
        <div className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/95 px-6 py-4 backdrop-blur-sm">
          <div className="mx-auto flex max-w-2xl items-center justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <h1 className="shrink-0 text-lg font-bold text-cyan-400">战前预习 · 第 {day} 天</h1>
              {poolExpand && poolExpand.pooledStages.length > 0 && (
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    poolExpand.canExpand
                      ? 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/40'
                      : 'bg-slate-800 text-slate-400 ring-1 ring-slate-700'
                  }`}
                  title={`已并池 ${poolExpand.pooledUnits} 个 Unit · 干净队列 ${Math.round(poolExpand.cleanRate * 100)}% · 每日 ${poolExpand.questionsPerDay} 题`}
                >
                  🗺️ {poolExpand.pooledUnits} 关{poolExpand.canExpand ? ' · 即将扩展' : ''}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs tabular-nums text-cyan-300">⏱ {formatPlayTime(playSeconds)}</span>
              <button
                onClick={onExit}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition-colors hover:border-slate-600 hover:bg-slate-800"
              >
                ← 返回
              </button>
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-hidden px-6 pb-24 pt-4">
          <FlashCard
            words={previewWords}
            skippedWords={skippedWords}
            onSkip={skipPreviewWord}
            runStats={{ day, poolUsed, wavePreview: displayWords.length }}
            mode={mode}
          />
        </div>
        <div className="fixed bottom-0 left-0 right-0 border-t border-slate-800 bg-slate-950/95 px-6 py-4 backdrop-blur-sm">
          <div className="mx-auto max-w-2xl">
            <button
              onClick={async () => {
                await Promise.allSettled(skipOpsRef.current);
                applySkippedToQuestions();
                if (buffChoices.length || legendChoices.length) {
                  setPhase('pick');
                } else {
                  setWaveKey((k) => k + 1);
                  setPhase('wave');
                }
              }}
              className="w-full rounded-xl bg-cyan-500 py-3.5 text-base font-bold text-slate-950 transition-all hover:bg-cyan-400 hover:shadow-[0_0_20px_rgba(6,182,212,0.5)]"
            >
              {buffChoices.length || legendChoices.length ? '继续 · 选择增益 ⚡' : '开始战斗 ⚔️'}
            </button>
            {error && <p className="mt-2 text-center text-sm text-red-400">{error}</p>}
          </div>
        </div>
      </div>
    );
  }

  // 肉鸽增益选择（独立页面：卡牌并行滑落，点选后继续/跳过/收枪）
  if (phase === 'pick') {
    const hasLegend = legendChoices.length > 0;
    const title = hasLegend ? '首领击败！选择传说技能' : `第 ${day} 天 · 选择增益`;
    const subtitle = hasLegend ? '传说技能本局仅一次，可改变机制' : '增益作用于下一波';
    const groups: { label: string; kind: 'legend' | 'buff'; items: string[] }[] = [];
    if (hasLegend) groups.push({ label: '传说技能', kind: 'legend', items: legendChoices });
    if (buffChoices.length > 0) groups.push({ label: '普通增益', kind: 'buff', items: buffChoices });
    let cardIdx = 0;
    return (
      <div
        className="flex min-h-screen flex-col bg-slate-950 px-4 pb-28 pt-10"
        style={{
          backgroundImage:
            'linear-gradient(rgba(139,92,246,.05) 1px, transparent 1px), linear-gradient(90deg, rgba(139,92,246,.05) 1px, transparent 1px)',
          backgroundSize: '42px 42px',
        }}
      >
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-black tracking-wider text-cyan-300" style={{ textShadow: '0 0 24px rgba(6,182,212,.5)' }}>
            {title}
          </h1>
          <p className="mt-2 text-sm text-slate-400">{subtitle}</p>
        </div>
        <span className="pointer-events-none fixed left-3 top-3 z-20 rounded-full border border-slate-600/50 bg-slate-900/80 px-2.5 py-0.5 font-mono text-xs font-semibold tabular-nums text-cyan-300 backdrop-blur-sm">
          ⏱ {formatPlayTime(playSeconds)}
        </span>

        <div className="mx-auto w-full max-w-3xl flex-1">
          {groups.map((g) => (
            <div key={g.label} className={groups.length > 1 ? 'mb-8' : ''}>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">{g.label}</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {g.items.map((b) => {
                  const info = buffMeta(b);
                  const c = rarityClass(info.rarity);
                  const selected = g.kind === 'legend' ? pendingLegend === b : pendingBuff === b;
                  const idx = cardIdx++;
                  return (
                    <button
                      key={b}
                      onClick={() =>
                        g.kind === 'legend'
                          ? setPendingLegend((prev) => (prev === b ? null : b))
                          : setPendingBuff((prev) => (prev === b ? null : b))
                      }
                      className={`group relative overflow-hidden rounded-2xl border p-5 text-left transition-all duration-200 ${c.border} ${c.bg} ${
                        selected
                          ? '-translate-y-1 ring-2 ring-cyan-400 shadow-[0_0_28px_rgba(34,211,238,0.35)]'
                          : 'hover:-translate-y-0.5 hover:shadow-[0_0_18px_rgba(34,211,238,0.16)]'
                      }`}
                      style={{ animation: `pickSlideDown 0.5s cubic-bezier(0.22,1,0.36,1) ${idx * 0.12}s both` }}
                    >
                      <div className={`mb-2 flex items-center justify-center gap-1.5`}>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${c.badge}`}>
                          {RARITY_NAME[info.rarity]}
                        </span>
                      </div>
                      <div className={`text-3xl drop-shadow-[0_0_10px_rgba(255,255,255,0.2)] ${c.text}`}>{info.icon}</div>
                      <div className={`mt-2 text-lg font-bold ${c.text}`}>{info.name}</div>
                      <div className="mt-1 text-xs leading-relaxed text-slate-400">{info.desc}</div>
                      {info.tags.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {info.tags.map((t) => (
                            <span key={t} className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-slate-400">
                              {t}
                            </span>
                          ))}
                        </div>
                      )}
                      {selected && (
                        <div className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-cyan-400 text-xs font-black text-slate-950">
                          ✓
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="fixed bottom-0 left-0 right-0 border-t border-slate-800 bg-slate-950/95 px-4 py-4 backdrop-blur-sm">
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            <button
              onClick={doReroll}
              disabled={busy || rerolling || rerolledToday || coins < REROLL_COIN_COST}
              title={rerolledToday ? '本波已重抽' : coins < REROLL_COIN_COST ? '金币不足' : '重新生成三选一（每波 1 次）'}
              className={`rounded-xl border px-4 py-3 text-sm font-semibold transition-colors disabled:opacity-40 ${
                rerolledToday
                  ? 'cursor-not-allowed border-slate-700 text-slate-600'
                  : 'border-violet-700/60 text-violet-300 hover:bg-violet-950/30'
              }`}
            >
              {rerolling ? '⟳ 重抽中…' : rerolledToday ? '✓ 已重抽' : `⟳ 重抽 · ${REROLL_COIN_COST} 金币`}
            </button>
            <button
              onClick={() => {
                setPendingBuff(null);
                setPendingLegend(null);
                setBuffChoices([]);
                setLegendChoices([]);
                setWaveKey((k) => k + 1);
                setPhase('wave');
              }}
              className="flex-1 rounded-xl border border-slate-700 py-3 text-sm font-semibold text-slate-300 transition-colors hover:bg-slate-800"
            >
              跳过
            </button>
            <button
              onClick={() => {
                setBuffChoices([]);
                setLegendChoices([]);
                setWaveKey((k) => k + 1);
                setPhase('wave');
              }}
              disabled={busy}
              className="flex-1 rounded-xl bg-cyan-500 py-3 text-sm font-bold text-slate-950 transition-all hover:bg-cyan-400 disabled:opacity-40"
            >
              继续 →
            </button>
          </div>
          <div className="mx-auto mt-2 max-w-3xl">
            <button
              onClick={surrender}
              disabled={busy}
              className="w-full rounded-xl border border-amber-700/50 py-2.5 text-sm text-amber-400 transition-colors hover:bg-amber-950/30 disabled:opacity-40"
            >
              🏳 收枪（金币×0.5）
            </button>
            {error && <p className="mt-3 text-center text-sm text-red-400">{error}</p>}
          </div>
        </div>
      </div>
    );
  }

  // 波战（普通 / 首领）
  if (phase === 'wave') {
    const isBoss = bossWave;
    return (
      <div className="animate-[fadeIn_0.3s_ease-out] fixed inset-0 overflow-hidden bg-slate-950">
        {/* 战场：全屏（答题区悬浮其上，战场透出） */}
        <div className="absolute inset-0">
          <BattleField
            ref={battleRef}
            initHp={maxHp}
            totalQuestions={questions.length}
            phase={isBoss ? 'boss' : 'study'}
            onPlayerDown={() => { setForceFinish(true); setLocked(true); }}
            onLockInput={() => setLocked(true)}
            waveEnding={waveEnding}
          />
          {/* 迷你键盘：战场右下角悬浮提示（拼写/听写模式；触屏用系统键盘，选中文无需） */}
          {!isTouch && mode !== 'choice' && (
            <div className="pointer-events-none absolute bottom-3 right-3 z-10 opacity-60 transition-opacity">
              <MiniKeyboard pressedKeys={pressedKeys} />
            </div>
          )}
          <UnitProgressHud mastered={masteredCount} total={totalCount} boss={bossWave} />
          <BuffHud codes={buffs} />
          {/* 局内秒表：本局游玩时长（随波提交/回传同步） */}
          <PlayTimeChip seconds={playSeconds} />
          {/* 红宝书肉鸽词池扩展 HUD：已并池 Unit 范围 + 干净占比 + 每日题量 */}
          <PoolExpandBadge info={poolExpand} />
          {/* 节奏 HUD：近期正确率（与 buff-picker/inject 的 acc 阈值对齐，低调展示不暴露数字） */}
          <RhythmHud acc={recentAcc} />
          <button
            onClick={surrender}
            className="absolute right-3 top-14 z-10 rounded-lg border border-amber-700/60 bg-slate-900/80 px-3 py-1 text-xs text-amber-400 backdrop-blur-sm hover:border-amber-600 hover:text-amber-300"
          >
            🏳 收枪
          </button>
        </div>

        {/* 答题区：底部悬浮半透明面板，战场可见 */}
        <div
          className={
            isTouch
              ? 'absolute inset-x-0 bottom-0 z-20 mx-auto w-fit max-w-[92vw] rounded-2xl border border-slate-700/40 bg-slate-950/30 px-3 pb-2 shadow-[0_-12px_40px_rgba(0,0,0,0.5)]'
              : 'absolute inset-x-0 bottom-0 z-20 px-4 pb-3'
          }
        >
          {isTouch && <div className="mx-auto mt-1.5 h-1 w-10 rounded-full bg-slate-600/60" />}
          {/* 选中文：答题区随内容自然展开不滚动；拼写/听写保持滚动上限 */}
          <div
            className={
              isTouch
                ? mode === 'choice'
                  ? ''
                  : 'max-h-[50vh] overflow-y-auto'
                : 'mx-auto w-full max-w-3xl'
            }
          >
            <div
              className={
                isTouch
                  ? ''
                  : `${mode === 'choice' ? '' : 'max-h-[46vh] overflow-y-auto '}rounded-2xl border border-slate-600/25 bg-slate-950/40 px-4 py-3 shadow-[0_-12px_40px_rgba(0,0,0,0.35)] backdrop-blur-sm`
              }
            >
              {mode === 'choice' ? (
                <ChoiceCore
                  key={`run-${day}-${isBoss ? 'boss' : 'study'}-${waveKey}`}
                  questions={questions}
                  mode={mode}
                  foilPool={foilPool}
                  initialCombo={combo}
                  onJudged={handleJudged}
                  onFreeze={(frozen) => battleRef.current?.freezeEnemies(frozen)}
                  forceFinish={forceFinish}
                  locked={locked}
                  onComplete={handleWaveComplete}
                  onPressedChange={setPressedKeys}
                />
              ) : (
                <TypingCore
                  key={`run-${day}-${isBoss ? 'boss' : 'study'}-${waveKey}`}
                  questions={questions}
                  mode={mode}
                  initialCombo={combo}
                  onJudged={handleJudged}
                  forceFinish={forceFinish}
                  locked={locked}
                  onComplete={handleWaveComplete}
                  onPressedChange={setPressedKeys}
                />
              )}
            </div>
          </div>
        </div>
        {error && (
          <div className="absolute left-1/2 top-4 z-20 flex -translate-x-1/2 items-center gap-2 rounded-lg bg-red-950/90 px-4 py-2 text-sm text-red-400">
            <span>{error}</span>
            {submitFailed && (
              <button
                onClick={() => doAdvance(pendingAnswersRef.current)}
                disabled={busy}
                className="rounded-md border border-red-400/60 px-2 py-0.5 font-semibold text-red-200 hover:bg-red-900/60 disabled:opacity-40"
              >
                重试提交
              </button>
            )}
            <button onClick={() => { setError(''); setSubmitFailed(false); }} className="text-red-300 underline">✕</button>
          </div>
        )}
      </div>
    );
  }

  // 结算
  if (phase === 'result' && result) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-4">
        <div className="w-full max-w-md rounded-2xl border border-cyan-500/30 bg-slate-900/80 p-8 text-center shadow-[0_0_30px_rgba(6,182,212,0.15)] backdrop-blur-sm">
          <div className="text-5xl">{result.cleared ? '🏆' : result.recordBroken ? '🏆' : result.surrendered ? '🏳' : '💀'}</div>
          <h1 className="mt-3 text-3xl font-black text-cyan-300">
            {result.cleared ? 'Unit 通关！' : result.surrendered ? '主动收枪' : '阵亡'}
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            {result.cleared ? `通关用时 ${result.daysSurvived} 天 · ` : `存活 ${result.daysSurvived} 天 · `}
            击破首领 {result.bossClearedCount} 次 · 最高连击 ×{result.maxCombo} · 时长 {formatPlayTime(result.playSeconds)}
          </p>
          {result.cleared && (
            <p className="mt-2 inline-block rounded-full bg-emerald-500/20 px-3 py-1 text-sm text-emerald-300">
              🎉 全部单词掌握并击破 Final Boss，本关通关！
            </p>
          )}
          {result.unitFirstClear && (
            <p className="mt-2 inline-block rounded-full bg-amber-500/20 px-3 py-1 text-sm text-amber-300">
              🎁 首次通关 Unit，获得首通金币奖励！
            </p>
          )}
          {result.recordBroken && (
            <p className="mt-2 inline-block rounded-full bg-amber-500/20 px-3 py-1 text-sm text-amber-300">
              🏆 新纪录！最佳 {result.bestDays} 天
            </p>
          )}

          <div className="mt-6 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-3">
              <div className="text-lg font-black text-emerald-300">+{result.xp}</div>
              <div className="text-[10px] text-slate-500">经验</div>
            </div>
            <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-3">
              <div className="text-lg font-black text-amber-300">{result.coins}</div>
              <div className="text-[10px] text-slate-500">金币</div>
            </div>
            <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-3">
              <div className="text-lg font-black text-cyan-300">{result.rating}</div>
              <div className="text-[10px] text-slate-500">评级</div>
            </div>
          </div>

          {result.wordStats && (
            <div className="mt-4 rounded-xl border border-slate-800 bg-slate-800/30 p-3">
              <div className="mb-1.5 flex items-baseline justify-between">
                <span className="text-xs text-slate-400">本次词数</span>
                <span className="text-xs text-slate-500">共 {result.wordStats.totalWords} 词</span>
              </div>
              <div className="grid grid-cols-4 gap-2 text-center">
                <div>
                  <div className="text-lg font-black text-sky-300">{result.wordStats.newLearned}</div>
                  <div className="text-[10px] text-slate-500">新认识</div>
                </div>
                <div>
                  <div className="text-lg font-black text-amber-300">{result.wordStats.reviewed}</div>
                  <div className="text-[10px] text-slate-500">复习</div>
                </div>
                <div>
                  <div className="text-lg font-black text-emerald-300">{result.wordStats.mastered}</div>
                  <div className="text-[10px] text-slate-500">掌握</div>
                </div>
                <div>
                  <div className="text-lg font-black text-red-300">{result.wordStats.wrong}</div>
                  <div className="text-[10px] text-slate-500">易错</div>
                </div>
              </div>
            </div>
          )}

          {activeSynergies(buffs).length > 0 && (
            <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
              <div className="mb-1.5 text-xs text-amber-300">本局触发的协同配方</div>
              <div className="flex flex-wrap justify-center gap-1.5">
                {activeSynergies(buffs).map((s) => (
                  <span key={s.code} title={s.desc} className="rounded-full bg-amber-500/20 px-2.5 py-0.5 text-xs font-bold text-amber-200">
                    {s.icon} {s.label}
                  </span>
                ))}
              </div>
            </div>
          )}

          {result.materials.length > 0 && (
            <div className="mt-4 rounded-xl border border-slate-800 bg-slate-800/30 p-3">
              <div className="mb-1.5 text-xs text-slate-400">掉落材料</div>
              <div className="flex flex-wrap justify-center gap-1.5">
                {result.materials.map((m, i) => (
                  <span key={i} className="rounded-full bg-slate-700/60 px-2.5 py-0.5 text-xs text-slate-200">
                    {m.materialCode} ×{m.count}
                  </span>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={onExit}
            className="mt-6 w-full rounded-xl bg-cyan-500 py-3 text-sm font-bold text-slate-950 transition-all hover:bg-cyan-400"
          >
            返回模式选择
          </button>
          {error && <p className="mt-3 text-center text-sm text-red-400">{error}</p>}
        </div>
      </div>
    );
  }

  return null;
}
