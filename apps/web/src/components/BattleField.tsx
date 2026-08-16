// 即时战斗特效层（里程碑6 + v2.2）：Canvas 几何霓虹战场
// 金色矩形角色 + 几何怪逼近补位 + Boss 血条 + 菱形弹丸/三角碎屑/多边形波纹 + 飘字
// 性能：禁热循环 shadowBlur，霓虹用「亮芯+双描边叠层」，辉光层统一 'lighter'，网格离屏预渲染
// v2.2：freezeEnemies（重写冻结，Boss除外）/ skillAttack（3枚大菱形）/ 连击 ×3/×5/×7 几何反馈
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { BUFF_DEFS, SURVIVAL, type Rarity } from '@word-journey/shared';
import { SurvivalBattle, type SurvivalWaveMeta } from '../lib/survivalBattle';
import {
  playAttackSound,
  playBossAppearSound,
  playBossDefeatSound,
  playFreezeSound,
  playHitSound,
  playHurtSound,
  playKillSound,
  playP2RageSound,
  playSkillSound,
  playUnfreezeSound,
  flushSfx,
} from '../lib/sfx';

// 非 Boss 波收尾清场动画时长（缓慢变灰 + 淡出，然后切波）
export const WAVE_CLEAR_DURATION = 1000;

export interface BattleFieldHandle {
  // 每次判定结果：correct 触发攻击，wrong 触发受击扣血；isRevenge 双倍伤害；typed 用户实际输入（用于飘字反馈）
  notifyAnswer(correct: boolean, combo: number, isRevenge?: boolean, typed?: string): void;
  freezeEnemies(frozen: boolean): void;
  skillAttack(): void;
  bossAlive(): boolean;
  startBoss(bossHp: number): void;
  // 生存模式：逐波初始化 / 逐问推进
  startSurvivalWave(meta: SurvivalWaveMeta): void;
  survivalTick(correct: boolean, combo?: number, typed?: string): void;
  // 双队列图表：刷新干净/错词实时词数（滚动历史采样）
  setQueueStats(stats: { clean: number; wrong: number }): void;
}

interface Props {
  initHp: number;
  totalQuestions: number;
  onPlayerDown?: () => void;
  onBossDefeated?: () => void;
  phase: 'study' | 'boss';
  tauntWords?: string[]; // Boss 段嘲讽词列表（本局错词）
  onLockInput?: () => void; // 战斗结束/失败瞬间锁定答题
  waveEnding?: boolean; // 非 Boss 波已答完：触发剩余小怪灰化清场动画
}

interface Enemy {
  id: number;
  shape: 'circle' | 'triangle' | 'square' | 'hexagon' | 'cross' | 'diamond' | 'pentagon' | 'mini-cross';
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  speed: number;
  size: number;
  color: string;
  boss?: boolean;
  reachedPlayer?: boolean;
  frozen?: boolean;
  frozenAngle?: number;
  gray?: number; // 波末清场灰化进度 0→1（>0 时停止移动并缓慢变灰淡出）
  rotation?: number;
  rotSpeed?: number;
  archetype?: string; // 所属模板名
  splitOnDeath?: boolean; // 死亡时是否分裂
  snakePhase?: number; // diamond 蛇形相位
  trait?: string; // 生存特性（armor/swift/tank/regen/split/elite）→ 视觉强化
}

interface Shard {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
  rot: number;
  spin: number;
  kind: 'tri' | 'diamond' | 'streak';
}

interface Projectile {
  x: number;
  y: number;
  tx: number;
  ty: number;
  t: number;
  targetId: number;
  ang: number;
  big?: boolean;
  damage?: number; // 1=normal, 2=revenge
}

interface Laser {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  life: number;
  maxLife: number;
  color: string;
  width: number;
}

interface Ring {
  x: number;
  y: number;
  r: number;
  vr: number;
  life: number;
  maxLife: number;
  color: string;
}

interface Floater {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  size?: number;
  weight?: number;
}

const PLAYER_SIZE = 30;
const PARTICLE_CAP = 220;

// ---- 双队列陨星飞行（干净/错词两枚陨星向前飞行，值变化时上下摆动，身后拖尾轨迹）----
interface CometTrailPoint { x: number; y: number; age: number }
interface CometState {
  target: number; // 目标词数（原始值）
  y: number;      // 当前绘图 y（plot 内像素）
  vy: number;     // 弹簧速度（像素/秒）
  trail: CometTrailPoint[];
}
const QUEUE_LAP = 14;          // 陨星一圈飞行秒数（到右端回绕，清空拖尾）
const QUEUE_TRAIL_MAX = 24;    // 拖尾最多采样点
const QUEUE_TRAIL_FADE = 6;    // 拖尾淡出秒数
const QUEUE_SPRING_K = 130;    // 垂直弹簧刚度
const QUEUE_SPRING_C = 14;     // 垂直弹簧阻尼
const QUEUE_SWING_V = 90;      // 值变化时垂直冲击初速（与数据无关，保证肉眼可见摆动）

// 增益徽章稀有度配色（白/蓝/紫/金）
const BUFF_RARITY_FILL: Record<Rarity, string> = {
  0: 'rgba(148,163,184,0.18)',
  1: 'rgba(56,189,248,0.18)',
  2: 'rgba(167,139,250,0.18)',
  3: 'rgba(251,191,36,0.2)',
};
const BUFF_RARITY_STROKE: Record<Rarity, string> = {
  0: 'rgba(148,163,184,0.6)',
  1: 'rgba(56,189,248,0.7)',
  2: 'rgba(167,139,250,0.7)',
  3: 'rgba(251,191,36,0.9)',
};

// ---- 小怪模板：7 种几何怪 ----
interface Archetype {
  shape: Enemy['shape'];
  size: number;
  hp: number;
  speed: number;
  color: string;
  rotSpeed?: number;
  splitOnDeath?: boolean;
  name: string;
}

const ARCHETYPES: Archetype[] = [
  { name: 'Blob',    shape: 'circle',   size: 22, hp: 2, speed: 35, color: '#ef4444', rotSpeed: 0 },
  { name: 'Spike',   shape: 'triangle', size: 16, hp: 1, speed: 48, color: '#f97316', rotSpeed: 6, },
  { name: 'Cube',    shape: 'square',   size: 24, hp: 2, speed: 32, color: '#a855f7',},
  { name: 'Shield',  shape: 'hexagon',  size: 30, hp: 3, speed: 22, color: '#10b981', rotSpeed: 2 },
  { name: 'Star',    shape: 'cross',    size: 22, hp: 2, speed: 30, color: '#0ea5e9', splitOnDeath: true },
  { name: 'Shard',   shape: 'diamond',  size: 14, hp: 1, speed: 44, color: '#fbbf24', rotSpeed: 9, },
  { name: 'Crystal', shape: 'pentagon', size: 20, hp: 2, speed: 34, color: '#ec4899', rotSpeed: 3 },
];

// Boss 段禁用 Star（避免分裂物堆积）
const BOSS_ARCHETYPES: Archetype[] = ARCHETYPES.filter((a) => !a.splitOnDeath);

function pickArche(phase: 'study' | 'boss'): Archetype {
  const pool = phase === 'boss' ? BOSS_ARCHETYPES : ARCHETYPES;
  return pool[Math.floor(Math.random() * pool.length)]!;
}

// 生存模式：波内数值账本（每次 startSurvivalWave 重建；表现走普通引擎）
interface SurvivalStateShape {
  sim: SurvivalBattle;
  hp: number;
  maxHp: number;
  day: number;
  bossActive: boolean;
  answered: number; // 本波已答题数（补怪/空场判定）
  bossP2: boolean;
  poolUsed: number; // 本局词池大小（累计去重词数）
  buffCodes: string[]; // 本局已生效 buff 代号（HUD 徽章）
}

// ---- 几何路径（纯函数，模块级避免重复创建）----
function polyPath(ctx: CanvasRenderingContext2D, x: number, y: number, sides: number, r: number, rot = 0): void {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = rot + (i / sides) * Math.PI * 2 - Math.PI / 2;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function diamondPath(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y - ry);
  ctx.lineTo(x + rx, y);
  ctx.lineTo(x, y + ry);
  ctx.lineTo(x - rx, y);
  ctx.closePath();
}

// 颜色插值（#rrggbb → #rrggbb，t: 0..1）用于波末灰化
function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ra = (pa >> 16) & 255, ga = (pa >> 8) & 255, ba = pa & 255;
  const rb = (pb >> 16) & 255, gb = (pb >> 8) & 255, bb = pb & 255;
  const r = Math.round(ra + (rb - ra) * t);
  const g = Math.round(ga + (gb - ga) * t);
  const bl = Math.round(ba + (bb - ba) * t);
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
}

function BattleFieldInner({ initHp, totalQuestions, onPlayerDown, onBossDefeated, phase: _phase, tauntWords: tauntWordsProp, onLockInput: onLockInputProp, waveEnding }: Props, ref: React.Ref<BattleFieldHandle>) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const cssRef = useRef({ w: 800, h: 300 });
  const onPlayerDownRef = useRef(onPlayerDown);
  const onBossDefeatedRef = useRef(onBossDefeated);
  const onLockInputRef = useRef(onLockInputProp);
  const totalQuestionsRef = useRef(totalQuestions);
  const tauntWordsRef = useRef(tauntWordsProp ?? []);
  onPlayerDownRef.current = onPlayerDown;
  onBossDefeatedRef.current = onBossDefeated;
  onLockInputRef.current = onLockInputProp;
  totalQuestionsRef.current = totalQuestions;
  tauntWordsRef.current = tauntWordsProp ?? [];

  // 可变战场状态（rAF 驱动，不触发 React 重渲染）
  const state = useRef({
    running: true,
    hp: initHp,
    maxHp: initHp,
    correctCount: 0,
    bossCorrectCount: 0,
    combo: 0,
    flash: 0,
    shake: 0,
    glow: 0,
    bossSpawned: false,
    bossPhase: false,
    bossHp: 0,
    bossDefeated: false,
    lastStand: 0, // 0=inactive, >0 = remaining protected answers; once per session
    tauntTimer: 0,
    taunt: null as { text: string; x: number; y: number; life: number; maxLife: number } | null,
    enemies: [] as Enemy[],
    projectiles: [] as Projectile[],
    lasers: [] as Laser[],
    shards: [] as Shard[],
    rings: [] as Ring[],
    floaters: [] as Floater[],
    spawnTimer: 0,
    enemyId: 0,
    comboFx3: 0,
    comboFx5: 0,
    comboFx7: 0,
    comboGlow: 0,
    slowTimer: 0,
    playerGlint: 0,
    breathTimer: 0,
    attackRecoil: 0,
    bossP2: false,
    bossSpawnTimer: 0,
    bestCombo: 0,
    hitStop: 0, // 命中顿帧剩余秒（整体模拟减速）
    goldFlash: 0, // Boss 击破金闪强度
    bossIntro: 0, // Boss 登场横幅剩余秒（0 = 无）
    failFade: 0, // 失败红淡出计时（>0 时按秒递增）
    playerDown: false, // 失败回调只触发一次
    bgParticles: [] as { x: number; y: number; vx: number; vy: number; life: number; size: number; color: string }[],
      // 生存模式状态（共享引擎预测，血量/漏怪/Boss 以服务端 advance 重放为权威）
    survival: null as SurvivalStateShape | null,
    waveClear: null as { t: number; dur: number } | null, // 波末清场动画计时
    // 双队列陨星飞行（干净/错词两枚陨星向前飞行，值变化时上下摆动，身后拖尾轨迹）
    queueFlight: null as null | {
      t: number;          // 飞行相位（秒），驱动 x
      totalTarget: number; // 全池目标（poolUsed）
      total: number;       // 显示纵轴（每帧 lerp 逼近 target，全池跳变平滑缩放）
      lastLap: number;     // 上一圈编号（回绕时清空拖尾）
      clean: CometState;
      wrong: CometState;
    },
  });

  const sY = (): number => {
    const c = canvasRef.current;
    if (!c) return 150;
    return c.height / (window.devicePixelRatio || 1) / 2;
  };

  const playerX = (): number => {
    const w = boxRef.current?.clientWidth ?? 800;
    return w * 0.88;
  };

  // 双队列图几何：左下角面板布局 + 值→y 映射（用当前显示 total，平滑缩放）
  const queueGeom = (): { plotX: number; plotW: number; plotY: number; plotH: number; py: (v: number) => number } => {
    const H = cssRef.current.h;
    const cw = 200, ch = 110, cx0 = 14, cy0 = H - ch - 14;
    const plotX = cx0 + 8, plotW = cw - 16;
    const plotY = cy0 + 30, plotH = ch - 62;
    const total = Math.max(1, state.current.queueFlight?.total ?? 1);
    const py = (v: number): number => plotY + plotH - (Math.min(v, total) / total) * plotH;
    return { plotX, plotW, plotY, plotH, py };
  };

  // 波末清场：波答完后，剩余怪启动灰化动画（rAF 逐帧推进，结束时灰屑消散）；
  // 首领波击破后播庆祝横幅（击破已结算，仅视觉），再随清场过渡进次日
  useEffect(() => {
    if (!waveEnding) return;
    const s = state.current;
    if (s.waveClear || !s.survival) return;
    s.waveClear = { t: 0, dur: WAVE_CLEAR_DURATION / 1000 };
    for (const e of s.enemies) {
      if (e.hp > 0 && !e.reachedPlayer) e.gray = 0;
    }
    if (s.survival.bossActive) {
      // 首领波：击破庆祝（击破音效已在 boss-clear 事件播过，此处仅视觉；残余 Boss 一并灰化随清场移除）
      if (s.bossDefeated) {
        s.goldFlash = Math.max(s.goldFlash, 1);
        s.flash = Math.max(s.flash, 0.8);
        s.floaters.push({ x: cssRef.current.w / 2, y: sY() - 70, text: 'BOSS 击破！', color: '#fbbf24', life: 1.5, size: 28, weight: 900 });
        s.rings.push({ x: cssRef.current.w / 2, y: sY(), r: 16, vr: 260, life: 0.7, maxLife: 0.7, color: '#fbbf24' });
      }
      s.floaters.push({ x: cssRef.current.w / 2, y: sY() - 40, text: '波次清场！', color: '#fde047', life: 1.2, size: 20, weight: 900 });
    } else {
      s.floaters.push({ x: cssRef.current.w / 2, y: sY() - 60, text: '波次清场！', color: '#fbbf24', life: 1.2, size: 22, weight: 900 });
      s.rings.push({ x: cssRef.current.w / 2, y: sY(), r: 20, vr: 200, life: 0.55, maxLife: 0.55, color: '#fbbf24' });
    }
  }, [waveEnding]);

  const pushShard = (x: number, y: number, vx: number, vy: number, color: string, size: number): void => {
    const s = state.current;
    s.shards.push({
      x,
      y,
      vx,
      vy,
      life: 0.4 + Math.random() * 0.35,
      maxLife: 0.75,
      color,
      size,
      rot: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 16,
      kind: Math.random() < 0.55 ? 'diamond' : 'tri',
    });
    if (s.shards.length > PARTICLE_CAP) s.shards.splice(0, s.shards.length - PARTICLE_CAP);
  };

  const explode = (x: number, y: number, color: string, count = 14, big = false): void => {
    const s = state.current;
    const n = Math.min(PARTICLE_CAP - s.shards.length, count);
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 60 + Math.random() * (big ? 240 : 150);
      pushShard(x, y, Math.cos(ang) * spd, Math.sin(ang) * spd, color, 2 + Math.random() * (big ? 4 : 3));
    }
    // 菱形闪光骨架：双交叉菱形外框一闪
    if (s.rings.length < 8) {
      s.rings.push({ x, y, r: 6, vr: big ? 280 : 160, life: 0.22, maxLife: 0.22, color });
    }
  };

  // 连击 ×3/×5/×7 触发几何反馈
  const comboFx = (combo: number): void => {
    const s = state.current;
    // combo 1/2：轻量描边高光（基础连击也要"持续有感"）
    if (combo === 1 || combo === 2) s.comboGlow = 0.5;
    if (combo === 3) s.comboFx3 = 1.0;
    if (combo === 5) {
      s.comboFx5 = 1.1;
      // 屏幕四角三角楔形震波粒子
      const { w: W, h: H } = cssRef.current;
      for (let c = 0; c < 4; c++) {
        const cx = c % 2 === 0 ? 0 : W;
        const cy = c < 2 ? 0 : H;
        const dx = W / 2 - cx;
        const dy = H / 2 - cy;
        for (let i = 0; i < 3; i++) {
          const ang = Math.atan2(dy, dx) + (Math.random() - 0.5) * 0.5;
          const spd = 320 + Math.random() * 200;
          pushShard(cx, cy, Math.cos(ang) * spd, Math.sin(ang) * spd, '#fde047', 3.5 + Math.random() * 3.5);
        }
      }
    }
    if (combo === 7) {
      s.comboFx7 = 1.2;
      s.playerGlint = 1.0;
      s.slowTimer = 0.5;
      // 从角色发射的三层菱形波纹
      const py = sY();
      for (let i = 0; i < 3; i++) {
        s.rings.push({
          x: playerX() + PLAYER_SIZE / 2,
          y: py,
          r: 8 + i * 6,
          vr: 200 + i * 40,
          life: 0.85 - i * 0.12,
          maxLife: 0.85 - i * 0.12,
          color: i === 0 ? '#a5f3fc' : i === 1 ? '#22d3ee' : '#67e8f9',
        });
      }
    }
  };

  useImperativeHandle(ref, () => ({
    notifyAnswer(correct: boolean, combo: number, isRevenge = false, typed = '') {
      const s = state.current;
      s.combo = combo;
      s.bestCombo = Math.max(s.bestCombo, combo);
      if (correct) {
        s.correctCount++;
        if (s.bossPhase) s.bossCorrectCount++;
        if (s.lastStand > 0) s.lastStand--;
        comboFx(combo);
        const burst = typed.length <= 5 ? 1 : Math.min(4, 2 + Math.floor((typed.length - 6) / 3));
        attack(isRevenge ? 2 : undefined, burst);
      } else {
        if (s.lastStand > 0) return; // 最后一搏免伤
        const dmg = s.bossSpawned && s.enemies.some((e) => e.boss && !e.reachedPlayer) ? 2 : 1;
        hurt(dmg);
      }
    },
    freezeEnemies(frozen: boolean) {
      for (const e of state.current.enemies) {
        if (e.boss) continue;
        e.frozen = frozen;
        e.frozenAngle = Math.random() * Math.PI * 2;
      }
      if (frozen) playFreezeSound();
      else playUnfreezeSound();
    },
    skillAttack() {
      const s = state.current;
      const py = sY();
      // 始终攻击 3 个最近敌人（含 Boss，按欧几里得距离）
      const alive = s.enemies.filter((e) => e.hp > 0 && !e.reachedPlayer);
      const nearest = [...alive]
        .sort((a, b) => ((a.x - playerX()) ** 2 + (a.y - py) ** 2) - ((b.x - playerX()) ** 2 + (b.y - py) ** 2))
        .slice(0, 3);
      if (nearest.length === 0) return;
      playSkillSound();
      // 技能发射口闪光（更亮）
      for (let i = 0; i < 6; i++) {
        const ma = Math.PI + (Math.random() - 0.5) * 1.2;
        pushShard(playerX() + PLAYER_SIZE / 2, py, Math.cos(ma) * 220, Math.sin(ma) * 220, '#a5f3fc', 2.2);
      }
      if (s.rings.length < 8) {
        s.rings.push({ x: playerX() + PLAYER_SIZE / 2, y: py, r: 4, vr: 160, life: 0.22, maxLife: 0.22, color: '#a5f3fc' });
      }
      for (const t of nearest) {
        const ang = Math.atan2(t.y - py, t.x - playerX() - PLAYER_SIZE / 2);
        s.projectiles.push({ x: playerX() + PLAYER_SIZE / 2, y: py, tx: t.x, ty: t.y, t: 0, targetId: t.id, ang, big: true });
      }
      s.glow = 1.2;
      const W = cssRef.current.w;
      s.floaters.push({ x: W / 2, y: py - 60, text: '💥 技能释放', color: '#a5f3fc', life: 1.4 });
    },
    bossAlive(): boolean {
      const s = state.current;
      return s.bossSpawned && s.enemies.some((e) => e.boss && e.hp > 0 && !e.reachedPlayer);
    },
    startBoss(bossHp: number) {
      const s = state.current;
      s.bossPhase = true;
      s.bossHp = bossHp;
      spawnEnemy(true);
      s.bossSpawned = true;
      s.flash = 1.5;
      s.shake = 1.8;
      s.bossIntro = 1.4; // 登场横幅
      playBossAppearSound();
      const W = cssRef.current.w;
      const py = sY();
      for (let i = 0; i < 3; i++) {
        s.rings.push({
          x: W / 2, y: py, r: 6 + i * 30,
          vr: 360 + i * 50, life: 1.2 + i * 0.15, maxLife: 1.35,
          color: i === 0 ? '#f87171' : i === 1 ? '#fca5a5' : '#fda4af',
        });
      }
      s.floaters.push({ x: W / 2, y: py - 50, text: '☠ Boss 段·迎战！', color: '#f87171', life: 3 });
    },
    // ── 生存模式（数值账本 + 普通引擎表现）──
    startSurvivalWave(meta: SurvivalWaveMeta) {
      const s = state.current;
      // 重置整波战斗状态：上一日 Boss 击破 / 战败残留不得泄漏到新一天（否则红调/败局浮层常驻）
      s.running = true;
      s.playerDown = false;
      s.failFade = 0;
      s.bossP2 = false;
      s.bossDefeated = false;
      s.bossHp = 0;
      s.taunt = null;
      s.goldFlash = 0;
      s.shake = 0;
      s.flash = 0;
      s.combo = 0;
      s.bestCombo = 0;
      s.lasers = [];
      s.shards = [];
      s.rings = [];
      const sim = new SurvivalBattle(meta);
      s.survival = {
        sim,
        hp: meta.hp,
        maxHp: meta.maxHp,
        day: meta.day,
        bossActive: meta.bossWave,
        answered: 0,
        bossP2: false,
        poolUsed: meta.poolUsed ?? 0,
        buffCodes: meta.buffCodes ?? [],
      };
      s.hp = meta.hp;
      s.maxHp = meta.maxHp;
      s.correctCount = 0;
      s.bossPhase = meta.bossWave;
      s.bossSpawned = meta.bossWave;
      s.spawnTimer = 0;
      s.enemies = [];
      s.projectiles = [];
      const py = sY();
      if (meta.bossWave) {
        s.flash = 1.5;
        s.shake = 1.8;
        s.bossIntro = 1.4;
        playBossAppearSound();
        const W2 = cssRef.current.w;
        for (let i = 0; i < 3; i++) {
          s.rings.push({
            x: W2 / 2, y: py, r: 6 + i * 30,
            vr: 360 + i * 50, life: 1.2 + i * 0.15, maxLife: 1.35,
            color: i === 0 ? '#f87171' : i === 1 ? '#fca5a5' : '#fda4af',
          });
        }
        s.floaters.push({ x: W2 / 2, y: py - 50, text: '☠ 首领波·迎战！', color: '#f87171', life: 3 });
        spawnEnemy(true); // 走路 Boss（普通引擎行为）
      } else {
        s.bossSpawned = false;
        s.floaters.push({ x: cssRef.current.w / 2, y: py - 60, text: `第 ${meta.day} 天`, color: '#67e8f9', life: 1.6 });
        spawnEnemy(); // 立即首怪
      }
    },
    // 双队列陨星：刷新实时词数，值变化时给陨星垂直冲击（摆动），并追加拖尾采样点
    setQueueStats(stats: { clean: number; wrong: number }) {
      const s = state.current;
      const total = stats.clean + stats.wrong;
      if (!s.queueFlight) {
        const mk = (v: number): CometState => ({ target: v, y: 0, vy: 0, trail: [] });
        s.queueFlight = { t: 0, totalTarget: total, total, lastLap: 0, clean: mk(stats.clean), wrong: mk(stats.wrong) };
      }
      const f = s.queueFlight;
      const geom = queueGeom();
      const cometX = f.t / QUEUE_LAP;
      const updateComet = (c: CometState, value: number): void => {
        const first = c.trail.length === 0;
        if (value !== c.target) {
          // 值变化 → 垂直摆动：值升→上摆（负 y），值降→下摆；幅度固定，肉眼清晰可见
          const prevPix = geom.py(c.target);
          const newPix = geom.py(value);
          const dir = prevPix - newPix >= 0 ? -1 : 1;
          c.vy = c.vy * 0.5 + dir * QUEUE_SWING_V;
        }
        c.target = value;
        if (first) {
          c.y = geom.py(value); // 首点直接就位，不弹跳
          c.vy = 0;
        }
        c.trail.push({ x: cometX, y: value, age: 0 });
        if (c.trail.length > QUEUE_TRAIL_MAX) c.trail.shift();
      };
      updateComet(f.clean, stats.clean);
      updateComet(f.wrong, stats.wrong);
      f.totalTarget = total;
    },
    survivalTick(correct: boolean, combo = 0, typed = '') {
      const s = state.current;
      if (!s.survival) return;
      const sim = s.survival.sim;
      // 解冻（眩晕视觉清理）
      for (const e of s.enemies) e.frozen = false;
      s.combo = combo;
      s.bestCombo = Math.max(s.bestCombo, combo);
      // 引擎按题推进（血量 / 漏怪 / Boss 击破由引擎结算）
      const events = sim.step(correct);
      s.survival.answered = sim.answered;
      if (correct) {
        s.correctCount++;
        comboFx(combo); // 普通模式连击特效
        const burst = typed.length <= 5 ? 1 : Math.min(4, 2 + Math.floor((typed.length - 6) / 3));
        const dmg = sim.currentQuestionIsNew() ? SURVIVAL.NEW_WORD_DMG_X : 1;
        if (sim.currentQuestionIsNew()) {
          fireLaser(dmg); // 新词答对：激光攻击（区别于普通弹丸）
        } else {
          attack(dmg, burst); // 普通攻击：按词长多发弹丸/闪光/×N
        }
      }
      // 事件驱动视觉（不写账本；引擎已结算）
      for (const ev of events) {
        switch (ev.kind) {
          case 'stun':
            // 连错2眩晕：怪冻结暂停逼近（TypingCore 已展示答案并禁答）
            for (const e of s.enemies) {
              e.frozen = true;
              e.frozenAngle = Math.random() * Math.PI * 2;
            }
            playFreezeSound();
            s.floaters.push({ x: playerX(), y: sY() - 60, text: '⚡ 连错眩晕 · 怪暂停逼近', color: '#a5f3fc', life: 1.4 });
            break;
          case 'wrong-hit':
            survivalHurt(ev.dmg);
            break;
          case 'leak':
            survivalHurt(ev.dmg);
            break;
          case 'heal':
            s.floaters.push({ x: playerX() - 20, y: sY() - 24, text: `+♥ ${ev.amount}`, color: '#4ade80', life: 1.2, size: 20, weight: 900 });
            break;
          case 'boss-hit':
            // 视觉 Boss 血条与引擎对齐
            {
              const boss = s.enemies.find((e) => e.boss && e.hp > 0);
              if (boss) boss.hp = sim.bossRemaining;
            }
            if (ev.p2 && !s.survival.bossP2) {
              s.survival.bossP2 = true;
              s.bossP2 = true;
              const boss = s.enemies.find((e) => e.boss && e.hp > 0);
              if (boss) {
                boss.color = '#a855f7';
                boss.speed *= 1.3;
              }
              playP2RageSound();
              s.floaters.push({ x: cssRef.current.w / 2, y: 120, text: '⚠ BOSS 暴怒！P2 阶段', color: '#c084fc', life: 3 });
            }
            break;
          case 'boss-miss':
            if (ev.dmg > 0) {
              survivalHurt(ev.dmg);
            } else if (!s.survival.sim.isBossCleared) {
              // dodge/免伤免疫 → 免伤反馈；Boss 已击破后的残余题不显示
              s.floaters.push({ x: playerX(), y: sY() - 30, text: '免伤', color: '#94a3b8', life: 1 });
            }
            break;
          case 'boss-clear':
            // 击破庆祝（无 +6 回血；服务端 advance 已定论）
            s.bossDefeated = true;
            s.flash = 1.5;
            s.goldFlash = 1;
            playBossDefeatSound();
            {
              const boss = s.enemies.find((e) => e.boss && e.hp > 0);
              if (boss) boss.hp = 0; // 让普通引擎走击破清除
            }
            break;
          case 'combo':
            s.floaters.push({ x: playerX(), y: sY() - 40, text: `连击×${ev.tier}!`, color: '#fbbf24', life: 1.2, size: 18, weight: 900 });
            if (ev.tier === 7) {
              // ×7 大里程碑：顿帧 + 全屏脉冲
              s.hitStop = Math.max(s.hitStop, 0.08);
              s.slowTimer = Math.max(s.slowTimer, 0.5);
              s.flash = Math.max(s.flash, 1);
            }
            break;
          case 'splash-hit':
            s.floaters.push({ x: playerX() - 24, y: sY() - 20, text: '溅射', color: '#67e8f9', life: 1 });
            break;
          case 'wave-hit':
            s.floaters.push({ x: cssRef.current.w / 2, y: 90, text: '🌊 全场波', color: '#67e8f9', life: 1.2, size: 18, weight: 900 });
            s.flash = Math.max(s.flash, 0.8);
            break;
          case 'thorns-hit':
            s.floaters.push({ x: playerX() - 24, y: sY() + 24, text: '反伤', color: '#fb923c', life: 1 });
            break;
          case 'elite-killed':
            s.floaters.push({ x: cssRef.current.w / 2, y: 110, text: '💎 精英击杀', color: '#fbbf24', life: 1.4, size: 20, weight: 900 });
            break;
          case 'freeze-all':
            for (const e of s.enemies) {
              e.frozen = true;
              e.frozenAngle = Math.random() * Math.PI * 2;
            }
            playFreezeSound();
            s.floaters.push({ x: cssRef.current.w / 2, y: 90, text: '❄️ 冻结全场', color: '#a5f3fc', life: 1.3, size: 18, weight: 900 });
            break;
          case 'monster-hit':
            break;
        }
      }
      survivalSyncHp();
      survivalDeathCheck();
    },
  }));

  // 新词激光攻击：一道青色光束直击最近敌人，命中结算复用弹丸 impact（立即生效）
  const fireLaser = (damage: number) => {
    const s = state.current;
    const py = sY();
    const px = playerX();
    const alive = s.enemies.filter((e) => e.hp > 0 && !e.reachedPlayer);
    if (alive.length === 0) return;

    const sorted = [...alive].sort((a, b) =>
      ((a.x - px) ** 2 + (a.y - py) ** 2) - ((b.x - px) ** 2 + (b.y - py) ** 2),
    );
    const t = sorted[0]!;
    const originX = px + PLAYER_SIZE / 2;
    playSkillSound(); // 激光音效（区别于普通攻击）
    // 发射口闪光
    for (let i = 0; i < 4; i++) {
      const ma = Math.PI + (Math.random() - 0.5) * 1.2;
      pushShard(originX, py, Math.cos(ma) * 220, Math.sin(ma) * 220, '#67e8f9', 2.2);
    }
    // 激光光束（亮芯绘制）
    s.lasers.push({
      x1: originX, y1: py,
      x2: t.x, y2: t.y,
      life: 0.18, maxLife: 0.18,
      color: '#67e8f9',
      width: 5,
    });
    s.glow = Math.max(s.glow, 1.4);
    s.attackRecoil = 1;
    // 命中立即结算（复用弹丸 impact：伤害/击杀/分裂/Boss 击破逻辑）
    s.projectiles.push({
      x: originX, y: py, tx: t.x, ty: t.y, t: 1, targetId: t.id, ang: 0, damage, big: true,
    });
  };

  // 攻击：按词长多发弹丸，首发最近敌人，余弹依次分配
  const attack = (damage = 1, burst = 1) => {
    const s = state.current;
    const py = sY();
    const px = playerX();
    const alive = s.enemies.filter((e) => e.hp > 0 && !e.reachedPlayer);
    if (alive.length === 0) return;

    const sorted = [...alive].sort((a, b) =>
      ((a.x - px) ** 2 + (a.y - py) ** 2) - ((b.x - px) ** 2 + (b.y - py) ** 2),
    );
    const targets = sorted.slice(0, burst);
    playAttackSound();
    // 发射口闪光（muzzle flash）
    for (let i = 0; i < 2; i++) {
      const ma = Math.PI + (Math.random() - 0.5) * 0.7;
      pushShard(px + PLAYER_SIZE / 2, py, Math.cos(ma) * 130, Math.sin(ma) * 130, '#fde047', 1.6);
    }
    if (s.rings.length < 8) {
      s.rings.push({ x: px + PLAYER_SIZE / 2, y: py, r: 3, vr: 110, life: 0.16, maxLife: 0.16, color: '#fde047' });
    }

    for (let i = 0; i < targets.length; i++) {
      const t = targets[i]!;
      const ang = Math.atan2(t.y - py, t.x - px - PLAYER_SIZE / 2);
      s.projectiles.push({
        x: px + PLAYER_SIZE / 2, y: py,
        tx: t.x, ty: t.y, t: i > 0 ? -(i * 0.06) : 0, targetId: t.id,
        ang, damage, big: burst >= 3,
      });
    }
    if (burst >= 3) {
      s.floaters.push({ x: px, y: py - 20, text: `×${burst}`, color: '#a5f3fc', life: 1 });
    }
    s.glow = 1;
    s.attackRecoil = 1;
  };

  const hurt = (dmg: number) => {
    const s = state.current;
    if (!s.running) return;
    if (s.lastStand > 0) return; // 最后一搏免伤
    s.hp = Math.max(0, s.hp - dmg);
    s.flash = 1;
    s.shake = 1;
    playHurtSound();
    // HP 降到 1 时触发最后一搏（整局仅一次）
    if (s.hp <= 1 && s.lastStand === 0 && s.hp > 0) {
      s.hp = 1; // 保底为 1
      s.lastStand = 3;
      const W = cssRef.current.w;
      const py = sY();
      s.floaters.push({ x: W / 2, y: py - 80, text: '⚡ 背水一战！3 题无敌 + 1.5 倍伤害', color: '#fbbf24', life: 3 });
    }
    if (s.hp <= 0) {
      s.running = false;
      if (!s.playerDown) {
        s.playerDown = true;
        s.failFade = 0.001; // 触发失败红淡出（step 里递增）
        s.shake = 1.6;
        onLockInputRef.current?.(); // 立即锁定答题
        // 0.65s 红色淡出后再跳结算
        setTimeout(() => onPlayerDownRef.current?.(), 650);
      }
    }
  };

  const spawnEnemy = (boss = false): void => {
    const s = state.current;
    const { w: W, h: H } = cssRef.current;
    s.enemyId++;
    if (s.survival) {
      // 生存怪：普通模板外观 + 生存 HP/速度（复用普通引擎，数值来自 sim）
      const sim = s.survival.sim;
      if (boss) {
        const hp = sim.bossMax;
        s.enemies.push({
          id: s.enemyId, shape: 'square', x: W * 0.2, y: H * 0.5,
          hp, maxHp: hp, speed: 16, size: 56,
          color: '#dc2626', boss: true,
        });
        s.floaters.push({ x: W / 2, y: 46, text: '⚠ BOSS 出现！', color: '#f87171', life: 2 });
        s.floaters.push({ x: W / 2, y: 70, text: `HP ${hp}`, color: '#fbbf24', life: 2 });
        return;
      }
      const tier = sim.spawnTier();
      const trait = sim.currentTrait();
      const hp = sim.monsterHpForTrait(tier);
      const arch = pickArche('study');
      const traitScale = trait === 'tank' ? 1.3 : 1;
      const speedMult = trait === 'swift' ? 1.25 : 1;
      s.enemies.push({
        id: s.enemyId,
        shape: arch.shape,
        x: -30,
        y: 20 + Math.random() * Math.max(30, H - 60),
        hp, maxHp: hp,
        speed: sim.monsterSpeedFor(tier) * speedMult,
        size: arch.size * traitScale,
        color: trait === 'elite' ? '#f59e0b' : arch.color,
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: arch.rotSpeed ? arch.rotSpeed * (0.7 + Math.random() * 0.6) : 0,
        archetype: arch.name,
        splitOnDeath: arch.splitOnDeath,
        snakePhase: arch.shape === 'diamond' ? Math.random() * Math.PI * 2 : undefined,
        trait,
      });
      return;
    }
    if (boss) {
      const hp = s.bossHp || Math.min(18, 6 + Math.floor(totalQuestionsRef.current / 10) * 2);
      s.enemies.push({
        id: s.enemyId, shape: 'square', x: W * 0.2, y: H * 0.5,
        hp, maxHp: hp, speed: 16, size: 56,
        color: '#dc2626', boss: true,
      });
      s.floaters.push({ x: W / 2, y: 46, text: '⚠ BOSS 出现！', color: '#f87171', life: 2 });
      s.floaters.push({ x: W / 2, y: 70, text: `HP ${hp}`, color: '#fbbf24', life: 2 });
    } else {
      const arch = pickArche(s.bossPhase ? 'boss' : 'study');
      const baseSpeed = s.bossPhase ? 30 : 40;
      const speedScale = arch.speed / 35; // 相对标准速度缩放
      s.enemies.push({
        id: s.enemyId,
        shape: arch.shape,
        x: -30,
        y: 20 + Math.random() * Math.max(30, H - 60),
        hp: arch.hp,
        maxHp: arch.hp,
        speed: baseSpeed * speedScale + Math.random() * 4,
        size: arch.size,
        color: arch.color,
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: arch.rotSpeed ? arch.rotSpeed * (0.7 + Math.random() * 0.6) : 0,
        archetype: arch.name,
        splitOnDeath: arch.splitOnDeath,
        snakePhase: arch.shape === 'diamond' ? Math.random() * Math.PI * 2 : undefined,
      });
    }
  };

  // 生存模式：血量同步（引擎为唯一账本，仅读不写）
  const survivalSyncHp = (): void => {
    const s = state.current;
    if (!s.survival) return;
    s.survival.hp = s.survival.sim.currentHp;
    s.hp = s.survival.hp;
  };
  // 生存模式：死亡（预测 HP 归零 → 触发失败回调；波末 advance 定论）
  const survivalDeathCheck = (): void => {
    const s = state.current;
    if (s.survival && s.survival.sim.currentHp <= 0 && !s.playerDown) {
      s.survival.hp = 0;
      s.running = false;
      s.playerDown = true;
      s.failFade = 0.001;
      s.shake = 1.6;
      onLockInputRef.current?.();
      setTimeout(() => onPlayerDownRef.current?.(), 650);
    }
  };
  // 生存模式：受击视觉（taken 为引擎已结算伤害，仅播放特效，不写账本）
  const survivalHurt = (taken: number): void => {
    const s = state.current;
    if (!s.survival) return;
    s.survival.hp = s.survival.sim.currentHp;
    s.hp = s.survival.hp;
    if (taken <= 0) {
      s.floaters.push({ x: playerX(), y: sY() - 30, text: '免伤', color: '#94a3b8', life: 1 });
      return;
    }
    s.flash = 1;
    s.shake = 1;
    playHurtSound();
    s.floaters.push({ x: playerX(), y: sY() - 24, text: `-${taken}`, color: '#f87171', life: 1 });
    survivalDeathCheck();
  };

  // ---- 主循环 ----
  useEffect(() => {
    const canvas = canvasRef.current;
    const box = boxRef.current;
    if (!canvas || !box) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    let W = 0;
    let H = 0;
    // 网格背景离屏预渲染（避免每帧画几十条线）
    const grid = document.createElement('canvas');

    const renderGrid = (): void => {
      grid.width = Math.max(1, Math.floor(W));
      grid.height = Math.max(1, Math.floor(H));
      const g = grid.getContext('2d');
      if (!g) return;
      g.clearRect(0, 0, W, H);
      g.strokeStyle = 'rgba(148,163,184,0.07)';
      g.lineWidth = 1;
      for (let gx = 0; gx < W; gx += 32) {
        g.beginPath();
        g.moveTo(gx, 0);
        g.lineTo(gx, H);
        g.stroke();
      }
      for (let gy = 0; gy < H; gy += 32) {
        g.beginPath();
        g.moveTo(0, gy);
        g.lineTo(W, gy);
        g.stroke();
      }
    };

    const resize = (): void => {
      W = box.clientWidth;
      H = box.clientHeight;
      cssRef.current = { w: W, h: H };
      canvas.width = Math.floor(W * dpr);
      canvas.height = Math.floor(H * dpr);
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      renderGrid();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(box);

    let last = performance.now();
    let raf = 0;

    const step = (now: number): void => {
      let dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const s = state.current;
      // 命中顿帧：整段模拟减速（渲染脉冲动画不受影响）
      if (s.hitStop > 0) {
        s.hitStop -= dt;
        dt *= 0.15;
      }

      if (s.running) {
        const anyFrozen = s.enemies.some((e) => e.frozen);
        if (!anyFrozen) {
          // 普通模式：随答题数增长上限；生存模式：场上随答题渐进至 ≤MAX_FIELD（清空立即补）
          const maxEnemies = s.survival
            ? (s.survival.bossActive ? 1 : Math.min(SURVIVAL.MAX_FIELD, Math.floor(s.survival.answered / 3) + 1))
            : s.bossPhase
              ? Math.min(1, Math.floor(s.bossCorrectCount / 2) + 1)
              : Math.min(4, Math.floor(s.correctCount / 3) + 1);
          s.spawnTimer -= dt;
          const normalCount = s.enemies.filter((e) => !e.boss && e.hp > 0 && !e.reachedPlayer).length;
          if (!s.waveClear && normalCount < maxEnemies && s.spawnTimer <= 0) {
            if (!(s.survival && s.survival.bossActive)) spawnEnemy(); // 生存Boss波不自动补小怪
            s.spawnTimer = 0.5 + Math.random() * 0.6;
          }
          // 场上清空且仍有词/未死 Boss → 立即补怪（生存普通波据此修复空场）
          const answered = s.survival ? s.survival.answered : s.correctCount;
          const respawnNeed = s.survival
            ? (!s.survival.bossActive && totalQuestionsRef.current > answered)
            : s.bossPhase
              ? s.enemies.some((e) => e.boss && e.hp > 0)
              : totalQuestionsRef.current > s.correctCount;
          if (!s.waveClear && respawnNeed && s.enemies.filter((e) => e.hp > 0 && !e.reachedPlayer).length === 0) {
            spawnEnemy();
            s.spawnTimer = 0.3;
          }
        }

        // 波末清场动画：剩余怪（含残余 Boss）缓慢变灰 + 淡出，计时结束灰屑消散移除
        if (s.waveClear) {
          s.waveClear.t += dt;
          const g = Math.min(1, s.waveClear.t / s.waveClear.dur);
          for (const e of s.enemies) {
            if (e.hp > 0 && !e.reachedPlayer) e.gray = g;
          }
          if (s.waveClear.t >= s.waveClear.dur) {
            for (const e of s.enemies) {
              if (e.hp > 0 && !e.reachedPlayer) explode(e.x, e.y, '#9ca3af', 10);
            }
            s.enemies = s.enemies.filter((e) => e.hp <= 0 || e.reachedPlayer);
            s.waveClear = null;
          }
        }

        // Boss 段嘲讽：每 6~10 秒从 Boss 上方弹一句错词（单条，不堆叠）
        if (s.bossPhase && !s.bossDefeated && !s.survival) {
          s.tauntTimer -= dt;
          if (s.tauntTimer <= 0) {
            s.tauntTimer = 6 + Math.random() * 4;
            const words = tauntWordsRef.current;
            if (words.length > 0) {
              const w = words[Math.floor(Math.random() * words.length)] as string;
              const W = cssRef.current.w;
              const boss = s.enemies.find((e) => e.boss && e.hp > 0);
              const x = boss ? Math.min(Math.max(boss.x, 120), W - 120) : W / 2;
              const y = boss ? Math.max(boss.y - boss.size - 30, 72) : 96;
              s.taunt = { text: `「你连 ${w} 都打不过吗？」`, x, y, life: 3, maxLife: 3 };
            }
          }
        }
        // 嘲讽寿命衰减（单条淡出后下一条再出现）
        if (s.taunt) {
          s.taunt.life -= dt;
          if (s.taunt.life <= 0) s.taunt = null;
        }

        // Boss P2 阶段：半血后定期召唤小怪（生存模式由 sim 数值驱动，不自动召）
        if (s.bossPhase && s.bossP2 && !s.bossDefeated && !s.survival) {
          s.bossSpawnTimer -= dt;
          if (s.bossSpawnTimer <= 0) {
            s.bossSpawnTimer = 5 + Math.random() * 3;
            spawnEnemy(false);
          }
        }
      }

      // 背景粒子（学习段星云蓝点，Boss 段灰烬红点）
      if (s.bgParticles.length < 50) {
        const pColor = s.bossPhase
          ? (Math.random() < 0.5 ? '#991b1b' : '#b45309')
          : (Math.random() < 0.5 ? '#0e7490' : '#0369a1');
        s.bgParticles.push({
          x: Math.random() * W, y: Math.random() * H,
          vx: (Math.random() - 0.5) * 6,
          vy: s.bossPhase ? -(8 + Math.random() * 12) : (Math.random() - 0.5) * 4,
          life: 3 + Math.random() * 5, size: 0.8 + Math.random() * 1.5, color: pColor,
        });
      }
      for (const p of s.bgParticles) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= dt;
        if (p.x < -30) p.x = W + 30;
        if (p.x > W + 30) p.x = -30;
        if (p.y < -30) p.y = H + 30;
        if (p.y > H + 30) p.y = -30;
      }
      s.bgParticles = s.bgParticles.filter((p) => p.life > 0);

      // 怪移动（冻结的原地不动；连击×7 全怪减速 20%；diamond 蛇形走位）
      const slowMult = s.slowTimer > 0 ? 0.8 : 1;
      for (const e of s.enemies) {
        if (e.hp <= 0 || e.frozen || (e.gray ?? 0) > 0) continue;
        e.x += e.speed * slowMult * dt;
        // 蛇形走位
        if (e.snakePhase != null) {
          (e.snakePhase as number) += dt * 5;
          e.y += Math.sin(e.snakePhase) * 24 * dt;
          e.y = Math.max(20, Math.min(H - 20, e.y));
        }
        // 自转
        if (e.rotation != null && e.rotSpeed) {
          e.rotation += e.rotSpeed * dt;
        }
        if (e.x >= playerX()) {
          if (s.survival) {
            // 生存模式：抵达玩家 = 漏怪 / Boss 反击（引擎事件已结算血量，此处仅视觉）
            const W = boxRef.current?.clientWidth ?? 800;
            if (e.boss) {
              e.x = W * 0.2;
              explode(e.x, e.y, e.color, 16);
              s.floaters.push({ x: W / 2, y: e.y + 20, text: 'BOSS 反击！· 退回再战', color: '#f87171', life: 1.8 });
            } else {
              e.reachedPlayer = true;
              explode(e.x, e.y, e.color, 12);
            }
          } else if (e.boss) {
            hurt(3);
            e.x = (boxRef.current?.clientWidth ?? 800) * 0.2;
            explode(e.x, e.y, e.color, 16);
            const W = boxRef.current?.clientWidth ?? 800;
            s.floaters.push({ x: W / 2, y: e.y + 20, text: 'BOSS 反击！-3 HP · 退回再战', color: '#f87171', life: 1.8 });
          } else {
            e.reachedPlayer = true;
            hurt(1);
            explode(e.x, e.y, e.color, 12);
            s.floaters.push({ x: e.x, y: e.y, text: '-1', color: '#f87171', life: 1 });
          }
        }
      }
      s.enemies = s.enemies.filter((e) => !(e.reachedPlayer || e.hp <= 0));

      // 弹丸
      for (const p of s.projectiles) {
        p.t += dt * (p.big ? 8.5 : 6);
        const target = s.enemies.find((e) => e.id === p.targetId);
        if (target && target.hp > 0 && p.t < 1) {
          p.x += (target.x - p.x) * dt * 10;
          p.y += (target.y - p.y) * dt * 10;
        } else {
          // 命中结算
          const hit = s.enemies.find((e) => e.id === p.targetId);
          if (hit && hit.hp > 0) {
            const dmg = p.damage ?? 1;
            const isCrit = dmg >= 2; // 复仇/技能/新词双倍伤害
            explode(p.tx, p.ty, hit.color, 6, p.big);
            hit.hp -= dmg;
            // 生存模式：命中仅同步视觉（血量/Boss 由引擎事件结算）
            if (s.survival && hit.boss) {
              // Boss 视觉血以引擎为准：重同步回去，杜绝弹丸累减导致"提前视觉击破"
              // （引擎每题仅扣 1，弹丸 burst 会累减更快；避免与 boss-clear 事件重复庆祝）
              hit.hp = s.survival.sim.bossRemaining;
              survivalSyncHp();
              survivalDeathCheck();
            }
            // 命中顿帧：Boss 命中 / 击杀 时"沉"一下（普通小怪命中不顿，避免连发卡顿）
            if (hit.boss) s.hitStop = Math.max(s.hitStop, 0.05);
            // Boss P2：半血暴怒
            if (hit.boss && !s.bossP2 && hit.hp <= hit.maxHp / 2 && hit.hp > 0) {
              s.bossP2 = true;
              hit.color = '#a855f7';
              hit.speed *= 1.3;
              s.bossSpawnTimer = 0;
              spawnEnemy(false);
              spawnEnemy(false);
              playP2RageSound();
              const W = cssRef.current.w;
              s.floaters.push({ x: W / 2, y: 120, text: '⚠ BOSS 暴怒！P2 阶段', color: '#c084fc', life: 3 });
            }
            if (hit.hp <= 0 && !(s.survival && hit.boss)) {
              s.hitStop = Math.max(s.hitStop, hit.boss ? 0.3 : 0.12);
              if (hit.boss) {
                s.bossDefeated = true;
                if (!s.survival) onBossDefeatedRef.current?.(); // 生存模式波继续，不跳结算
                s.flash = 1.5;
                s.goldFlash = 1; // 击破金闪
                playBossDefeatSound();
                // 击破金环：尊重全局 rings 上限（与其他环源一致），防止瞬时爆量
                const slots = 8 - s.rings.length;
                for (let i = 0; i < Math.min(slots, 8); i++) {
                  s.rings.push({
                    x: p.tx, y: p.ty, r: 16 + i * 10,
                    vr: 320 + i * 40, life: 1.4, maxLife: 1.4,
                    color: i % 2 === 0 ? '#fbbf24' : '#ef4444',
                  });
                }
              } else {
                playKillSound();
              }
              explode(p.tx, p.ty, hit.color, p.big ? 34 : 22, p.big);
              // Star 分裂：死亡时生成 2 个 mini-cross
              if (hit.splitOnDeath && !hit.boss) {
                for (let m = 0; m < 2; m++) {
                  s.enemyId++;
                  s.enemies.push({
                    id: s.enemyId, shape: 'mini-cross',
                    x: hit.x + (m === 0 ? -10 : 10),
                    y: hit.y + (Math.random() - 0.5) * 8,
                    hp: 1, maxHp: 1,
                    speed: hit.speed * 1.2,
                    size: hit.size * 0.55,
                    color: hit.color,
                    rotation: Math.random() * Math.PI * 2,
                    rotSpeed: 4 + Math.random() * 4,
                  });
                }
              }
              s.floaters.push({
                x: p.tx,
                y: p.ty - 16,
                text: hit.boss ? 'BOSS 击破！' : '击杀',
                color: hit.boss ? '#fbbf24' : '#fde047',
                life: 1.4,
                size: hit.boss ? 22 : 18,
                weight: 900,
              });
            } else {
              playHitSound();
              s.floaters.push({
                x: p.tx,
                y: p.ty - 14,
                text: hit.boss
                  ? (isCrit ? `会心! -${dmg} (${hit.hp}/${hit.maxHp})` : `-${dmg} (${hit.hp}/${hit.maxHp})`)
                  : (isCrit ? `会心! -${dmg}` : '+1'),
                color: isCrit ? '#fbbf24' : (hit.boss ? '#fca5a5' : '#fef08a'),
                life: isCrit ? 1 : 0.8,
                size: isCrit ? 22 : 18,
                weight: isCrit ? 900 : 700,
              });
            }
          }
          p.t = 99; // 标记消耗
        }
      }
      s.projectiles = s.projectiles.filter((p) => p.t < 1);

      // 碎屑 / 波纹 / 飘字
      for (const sh of s.shards) {
        sh.x += sh.vx * dt;
        sh.y += sh.vy * dt;
        sh.vx *= 0.92;
        sh.vy *= 0.92;
        sh.rot += sh.spin * dt;
        sh.life -= dt;
      }
      s.shards = s.shards.filter((sh) => sh.life > 0);
      for (const r of s.rings) {
        r.r += r.vr * dt;
        r.life -= dt;
      }
      s.rings = s.rings.filter((r) => r.life > 0);
      for (const l of s.lasers) {
        l.life -= dt;
      }
      s.lasers = s.lasers.filter((l) => l.life > 0);
      for (const f of s.floaters) {
        f.y -= 22 * dt;
        f.life -= dt;
      }
      s.floaters = s.floaters.filter((f) => f.life > 0);

      // 特效计时器衰减
      s.flash = Math.max(0, s.flash - dt * 2.2);
      s.shake = Math.max(0, s.shake - dt * 1.6);
      s.glow = Math.max(0, s.glow - dt * 1.4);
      s.comboFx3 = Math.max(0, s.comboFx3 - dt * 1.6);
      s.comboFx5 = Math.max(0, s.comboFx5 - dt * 1.1);
      s.comboFx7 = Math.max(0, s.comboFx7 - dt * 1.3);
      s.comboGlow = Math.max(0, s.comboGlow - dt * 1.1);
      s.slowTimer = Math.max(0, s.slowTimer - dt);
      s.playerGlint = Math.max(0, s.playerGlint - dt * 1.4);
      s.breathTimer += dt;
      s.attackRecoil = Math.max(0, s.attackRecoil - dt * 3);
      s.goldFlash = Math.max(0, s.goldFlash - dt * 4.5);
      if (s.bossIntro > 0) s.bossIntro -= dt;
      if (s.failFade > 0) s.failFade += dt;

      // 双队列陨星飞行推进：相位前进 / 回绕清拖尾 / 纵轴平滑过渡 / 垂直弹簧 / 拖尾衰减
      if (s.queueFlight) {
        const f = s.queueFlight;
        f.t += dt;
        const lap = Math.floor(f.t / QUEUE_LAP);
        if (lap !== f.lastLap) {
          f.lastLap = lap;
          f.clean.trail = [];
          f.wrong.trail = [];
        }
        f.total += (f.totalTarget - f.total) * Math.min(1, dt * 3);
        const geom = queueGeom();
        const stepComet = (c: CometState): void => {
          const targetY = geom.py(c.target);
          c.vy += (-QUEUE_SPRING_K * (c.y - targetY) - QUEUE_SPRING_C * c.vy) * dt;
          c.y += c.vy * dt;
          for (const pt of c.trail) pt.age += dt;
          c.trail = c.trail.filter((pt) => pt.age < QUEUE_TRAIL_FADE);
        };
        stepComet(f.clean);
        stepComet(f.wrong);
      }

      // ---- 渲染 ----
      ctx.save();
      ctx.fillStyle = '#0b1120';
      ctx.fillRect(0, 0, W, H);
      ctx.drawImage(grid, 0, 0, W, H);

      // 背景粒子
      for (const p of s.bgParticles) {
        ctx.globalAlpha = Math.min(1, p.life * 0.25);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // 双队列陨星飞行图（左下角：两枚陨星向前飞行，值变化上下摆动，身后拖尾轨迹）
      if (s.queueFlight) {
        const qf = s.queueFlight;
        const cw = 200, ch = 110, cx0 = 14, cy0 = H - ch - 14;
        const geom = queueGeom();
        const { plotX, plotW, plotY, plotH } = geom;
        ctx.save();
        ctx.globalAlpha = 0.85;
        // 底板
        ctx.fillStyle = 'rgba(15,23,42,0.72)';
        ctx.strokeStyle = 'rgba(148,163,184,0.28)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(cx0, cy0, cw, ch, 8);
        ctx.fill();
        ctx.stroke();
        ctx.globalAlpha = 1;
        // 标题 + 图例
        ctx.fillStyle = 'rgba(226,232,240,0.85)';
        ctx.font = 'bold 10px system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText('记忆队列', cx0 + 8, cy0 + 13);
        ctx.fillStyle = '#22d3ee';
        ctx.fillText('干净', cx0 + 8, cy0 + 25);
        ctx.fillStyle = '#f87171';
        ctx.fillText('错词', cx0 + 54, cy0 + 25);
        // 网格（3 条横线）
        ctx.strokeStyle = 'rgba(148,163,184,0.12)';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 2; i++) {
          const gy = plotY + (plotH / 2) * i;
          ctx.beginPath();
          ctx.moveTo(plotX, gy);
          ctx.lineTo(plotX + plotW, gy);
          ctx.stroke();
        }
        // 飞行相位：x 由 t 驱动（回绕时拖尾已清空，曲线不会跨圈断裂）
        const cometX = plotX + ((qf.t / QUEUE_LAP) % 1) * plotW;
        // 陨星：身后拖尾（按 age 淡出）+ 亮核辉光 + 尾焰 + 当前值标签
        const drawComet = (c: CometState, color: string, labelOff: number): void => {
          // 拖尾：逐段绘制，透明度随新旧衰减
          if (c.trail.length >= 2) {
            ctx.lineCap = 'round';
            for (let i = 1; i < c.trail.length; i++) {
              const p0 = c.trail[i - 1]!;
              const p1 = c.trail[i]!;
              const a = Math.min(
                Math.max(0, 1 - p0.age / QUEUE_TRAIL_FADE),
                Math.max(0, 1 - p1.age / QUEUE_TRAIL_FADE),
              );
              ctx.globalAlpha = 0.55 * a;
              ctx.strokeStyle = color;
              ctx.lineWidth = 2.2;
              ctx.beginPath();
              ctx.moveTo(plotX + p0.x * plotW, geom.py(p0.y));
              ctx.lineTo(plotX + p1.x * plotW, geom.py(p1.y));
              ctx.stroke();
            }
            ctx.lineCap = 'butt';
            ctx.globalAlpha = 1;
          }
          // 亮核辉光
          const hy = Math.max(plotY, Math.min(plotY + plotH, c.y));
          const g = ctx.createRadialGradient(cometX, hy, 0.5, cometX, hy, 9);
          g.addColorStop(0, '#ffffff');
          g.addColorStop(0.35, color);
          g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.globalAlpha = 0.9;
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(cometX, hy, 9, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
          // 亮芯
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(cometX, hy, 3, 0, Math.PI * 2);
          ctx.fill();
          // 尾焰（向左短彗尾）
          ctx.strokeStyle = color;
          ctx.globalAlpha = 0.7;
          ctx.lineWidth = 2;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(cometX - 3, hy);
          ctx.lineTo(cometX - 12, hy);
          ctx.stroke();
          ctx.lineCap = 'butt';
          ctx.globalAlpha = 1;
          // 当前值标签
          ctx.font = 'bold 10px system-ui, sans-serif';
          ctx.textAlign = 'left';
          ctx.fillStyle = color;
          ctx.fillText(String(c.target), Math.min(cometX + 11, plotX + plotW - 16), hy + labelOff);
        };
        drawComet(qf.clean, '#22d3ee', -5);
        drawComet(qf.wrong, '#f87171', 13);
        // 占比角标（右下角，基于当前显示 total）
        const totalNow = Math.max(1, qf.total);
        const cleanPct = Math.max(0, Math.min(100, Math.round((qf.clean.target / totalNow) * 100)));
        ctx.font = '9px system-ui, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillStyle = '#22d3ee';
        ctx.fillText(`干净 ${cleanPct}%`, cx0 + cw - 8, cy0 + ch - 8);
        ctx.fillStyle = '#f87171';
        ctx.fillText(`错词 ${100 - cleanPct}%`, cx0 + cw - 8, cy0 + ch - 18);
        ctx.restore();
      }

      // Boss 登场横幅 + 暗场（easeOut 弹入）
      if (s.bossIntro > 0) {
        const prog = Math.max(0, 1 - s.bossIntro / 1.4);
        const ease = 1 - Math.pow(1 - prog, 3);
        ctx.fillStyle = `rgba(2,6,23,${0.55 * prog})`;
        ctx.fillRect(0, 0, W, H);
        const size = 34 + ease * 30;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `bold ${size}px system-ui, sans-serif`;
        ctx.fillStyle = 'rgba(248,113,113,0.28)';
        ctx.fillText('☠ BOSS', W / 2, H * 0.4);
        ctx.fillStyle = '#f87171';
        ctx.fillText('☠ BOSS', W / 2, H * 0.4);
        ctx.font = 'bold 16px system-ui, sans-serif';
        ctx.fillStyle = 'rgba(254,226,226,0.9)';
        ctx.fillText('迎 战 ！', W / 2, H * 0.4 + 48);
        ctx.textBaseline = 'alphabetic';
      }

      // 抖动
      if (s.shake > 0) {
        ctx.translate((Math.random() - 0.5) * 8 * s.shake, (Math.random() - 0.5) * 8 * s.shake);
      }

      // Boss 血条（顶部居中，霓虹描边 + P2 变色；生存 Boss 也走普通走路怪，
      // 但进度条以引擎账本为权威：bossActive 期间恒显示，不依赖走路怪状态）
      const boss = s.survival?.bossActive
        ? s.survival.sim.bossMax > 0
          ? { hp: s.survival.sim.bossRemaining, maxHp: s.survival.sim.bossMax, p2: s.survival.bossP2 }
          : null
        : (() => { const b = s.enemies.find((e) => e.boss && e.hp > 0); return b ? { hp: b.hp, maxHp: b.maxHp, p2: s.bossP2 } : null; })();
      if (boss && boss.maxHp > 0) {
        const bw = Math.min(360, W * 0.55);
        const bossPct = Math.max(0, boss.hp / boss.maxHp);
        const bossBarColor = boss.p2 ? '#a855f7' : '#dc2626';
        ctx.fillStyle = 'rgba(15,23,42,0.9)';
        ctx.fillRect((W - bw) / 2 - 4, 14, bw + 8, 28);
        ctx.strokeStyle = bossBarColor;
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 2;
        ctx.strokeRect((W - bw) / 2 - 4, 14, bw + 8, 28);
        ctx.globalAlpha = 1;

        ctx.fillStyle = bossBarColor;
        ctx.fillRect((W - bw) / 2, 20, bw * bossPct, 14);
        // HP bar glow top line
        ctx.strokeStyle = bossBarColor;
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.moveTo((W - bw) / 2, 21);
        ctx.lineTo((W - bw) / 2 + bw * bossPct, 21);
        ctx.stroke();
        ctx.globalAlpha = 1;

        ctx.fillStyle = '#fecaca';
        ctx.font = 'bold 12px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(boss.p2 ? `☠ BOSS P2  ${boss.hp}/${boss.maxHp}` : `☠ BOSS  ${boss.hp}/${boss.maxHp}`, W / 2, 32);
      }

      // 我方血条（左上，霓虹镂空风格）
      const hpBrX = 12, hpBrY = 12, hpBrW = 160, hpBrH = 16;
      ctx.fillStyle = 'rgba(15,23,42,0.85)';
      ctx.fillRect(hpBrX - 2, hpBrY - 2, hpBrW + 4, hpBrH + 4);
      ctx.strokeStyle = 'rgba(148,163,184,0.25)';
      ctx.lineWidth = 1;
      ctx.strokeRect(hpBrX - 2, hpBrY - 2, hpBrW + 4, hpBrH + 4);

      const hpNow = s.survival ? s.survival.hp : s.hp;
      const hpMax = s.survival ? s.survival.maxHp : s.maxHp;
      const hpPct = Math.max(0, hpNow / hpMax);
      const hpColor = hpPct > 0.5 ? '#22c55e' : hpPct > 0.25 ? '#f59e0b' : '#ef4444';
      ctx.fillStyle = hpColor;
      ctx.fillRect(hpBrX, hpBrY, hpBrW * hpPct, hpBrH);
      ctx.strokeStyle = hpColor;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.moveTo(hpBrX, hpBrY + 1);
      ctx.lineTo(hpBrX + hpBrW * hpPct, hpBrY + 1);
      ctx.stroke();
      ctx.globalAlpha = 1;

      ctx.fillStyle = '#e2e8f0';
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`HP ${Math.ceil(hpNow)}/${hpMax}`, hpBrX + 4, hpBrY + 12);
      // 阶段标识
      ctx.fillStyle = 'rgba(148,163,184,0.35)';
      ctx.font = '9px system-ui, sans-serif';
      if (s.survival) {
        ctx.fillText(`第 ${s.survival.day} 天${s.survival.bossActive ? ' · 首领战' : ''}`, hpBrX, hpBrY + 32);
        ctx.fillText(`词池 ${s.survival.poolUsed}`, hpBrX, hpBrY + 44);
        // 增益徽章：按代号分组计数，稀有度配色，超宽自动换行
        if (s.survival.buffCodes.length > 0) {
          const groups: { code: string; count: number }[] = [];
          const idxByCode = new Map<string, number>();
          for (const c of s.survival.buffCodes) {
            const i = idxByCode.get(c);
            if (i === undefined) {
              idxByCode.set(c, groups.length);
              groups.push({ code: c, count: 1 });
            } else {
              groups[i]!.count++;
            }
          }
          const size = 20;
          const gap = 4;
          let bx = hpBrX;
          let by = hpBrY + 58;
          for (const g of groups) {
            const def = BUFF_DEFS[g.code];
            if (!def) continue;
            if (bx + size > W - 4 && bx > hpBrX) {
              by += size + gap;
              bx = hpBrX;
            }
            ctx.fillStyle = BUFF_RARITY_FILL[def.rarity];
            ctx.strokeStyle = BUFF_RARITY_STROKE[def.rarity];
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.rect(bx, by, size, size);
            ctx.fill();
            ctx.stroke();
            ctx.font = '12px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(def.icon, bx + size / 2, by + size / 2 + 1);
            ctx.textBaseline = 'alphabetic';
            if (g.count > 1) {
              ctx.fillStyle = BUFF_RARITY_STROKE[def.rarity];
              ctx.font = 'bold 8px system-ui, sans-serif';
              ctx.textAlign = 'right';
              ctx.fillText(`×${g.count}`, bx + size - 1, by + size - 1);
            }
            bx += size + gap;
          }
          ctx.textAlign = 'left';
        }
      } else {
        ctx.fillText(s.bossPhase ? 'BOSS 段' : '学习段', hpBrX, hpBrY + 32);
      }
      // 最后一搏
      if (s.lastStand > 0) {
        ctx.fillStyle = '#fbbf24';
        ctx.font = 'bold 11px system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`⚡ 背水一战 · 剩余 ${s.lastStand} 题`, 18, 42);
      }

      // 连击（右上）三层文字伪发光
      if (s.combo >= 2) {
        ctx.textAlign = 'right';
        const pulse = 0.5 + 0.5 * Math.sin(now / 90);
        const base = s.combo >= 5 ? 20 + 5 * pulse : 16;
        ctx.font = `bold ${base}px system-ui, sans-serif`;
        const txt = `连击 ×${s.combo}`;
        if (s.combo >= 3) {
          ctx.fillStyle = 'rgba(251,191,36,0.25)';
          ctx.fillText(txt, W - 17, 31);
          ctx.fillText(txt, W - 15, 31);
          ctx.fillText(txt, W - 16, 29);
        }
        ctx.fillStyle = s.combo >= 5 ? '#fbbf24' : '#e2e8f0';
        ctx.fillText(txt, W - 16, 30);
      }
      // 最高连击
      if (s.bestCombo >= 3) {
        ctx.textAlign = 'right';
        ctx.fillStyle = 'rgba(148,163,184,0.55)';
        ctx.font = '10px system-ui, sans-serif';
        ctx.fillText(`Best ×${s.bestCombo}`, W - 16, 42);
      }

      // 角色：金色矩形（呼吸 + 攻击回弹）
      const py = sY();
      const breathScale = 1 + Math.sin(s.breathTimer * 3) * 0.04;
      const recoilScale = s.attackRecoil > 0 ? 1 + s.attackRecoil * 0.3 : breathScale;
      const pSize = PLAYER_SIZE * recoilScale;
      ctx.save();
      if (s.glow > 0 || s.combo >= 5) {
        ctx.strokeStyle = 'rgba(253,224,71,0.55)';
        ctx.lineWidth = (6 + s.glow * 10) + (s.combo >= 5 ? 4 : 0);
        diamondPath(ctx, playerX(), py, pSize * 0.72, pSize * 0.72);
        ctx.stroke();
      }
      ctx.fillStyle = s.flash > 0 ? '#f97316' : '#facc15';
      ctx.fillRect(playerX() - pSize / 2, py - pSize / 2, pSize, pSize);
      ctx.strokeStyle = '#fde68a';
      ctx.lineWidth = 2;
      ctx.strokeRect(playerX() - pSize / 2, py - pSize / 2, pSize, pSize);
      if (s.comboGlow > 0) {
        // 基础连击（1/2）轻量描边高光：淡青细线随连击渐隐
        ctx.strokeStyle = `rgba(165,243,252,${0.4 * s.comboGlow})`;
        ctx.lineWidth = 1.5;
        diamondPath(ctx, playerX(), py, pSize * 0.85, pSize * 0.85);
        ctx.stroke();
      }
      if (s.playerGlint > 0) {
        ctx.strokeStyle = 'rgba(253,224,71,0.85)';
        ctx.lineWidth = 2;
        diamondPath(ctx, playerX(), py, pSize * 0.95 + s.playerGlint * 6, pSize * 0.95 + s.playerGlint * 6);
        ctx.stroke();
      }
      ctx.restore();

      // 攻击挥刀弧光（朝左挥向敌人）
      if (s.attackRecoil > 0) {
        ctx.strokeStyle = `rgba(253,224,71,${0.8 * s.attackRecoil})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(playerX(), py, 46, Math.PI - 1.0, Math.PI + 1.0);
        ctx.stroke();
      }

      // 最后一搏：金色护盾光圈（旋转六边形）
      if (s.lastStand > 0) {
        const pulse = 0.5 + 0.5 * Math.sin(now / 120);
        ctx.save();
        ctx.translate(playerX(), py);
        ctx.rotate(now / 800);
        ctx.strokeStyle = `rgba(251,191,36,${0.55 + 0.35 * pulse})`;
        ctx.lineWidth = 2.5;
        polyPath(ctx, 0, 0, 6, PLAYER_SIZE * 1.35 + pulse * 5, 0);
        ctx.stroke();
        ctx.restore();
        // 屏边金色脉冲
        const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
        g.addColorStop(0, 'rgba(251,191,36,0)');
        g.addColorStop(1, `rgba(251,191,36,${0.12 + 0.08 * pulse})`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }

      // 辉光层：lighter 合成（波纹 / 弹丸外壳 / 笼 / 碎屑 / 楔形扇）
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';

      // 菱形波纹
      for (const r of s.rings) {
        const a = Math.max(0, r.life / r.maxLife);
        ctx.strokeStyle = r.color;
        ctx.lineWidth = 2;
        ctx.globalAlpha = a * 0.9;
        diamondPath(ctx, r.x, r.y, r.r, r.r);
        ctx.stroke();
        ctx.globalAlpha = a * 0.35;
        ctx.lineWidth = 4;
        diamondPath(ctx, r.x, r.y, r.r * 0.82, r.r * 0.82);
        ctx.stroke();
      }

      // 激光光束（新词攻击）：亮芯 + 外扩辉光
      for (const l of s.lasers) {
        const a = Math.max(0, l.life / l.maxLife);
        ctx.globalAlpha = a;
        ctx.lineCap = 'round';
        // 外辉光
        ctx.strokeStyle = `rgba(103,232,249,${0.35 * a})`;
        ctx.lineWidth = l.width * 3;
        ctx.beginPath();
        ctx.moveTo(l.x1, l.y1);
        ctx.lineTo(l.x2, l.y2);
        ctx.stroke();
        // 亮芯
        ctx.strokeStyle = `rgba(224,242,254,${0.95 * a})`;
        ctx.lineWidth = l.width;
        ctx.beginPath();
        ctx.moveTo(l.x1, l.y1);
        ctx.lineTo(l.x2, l.y2);
        ctx.stroke();
        // 命中点闪光
        ctx.fillStyle = `rgba(165,243,252,${0.9 * a})`;
        ctx.beginPath();
        ctx.arc(l.x2, l.y2, l.width * (0.6 + (1 - a) * 2), 0, Math.PI * 2);
        ctx.fill();
        ctx.lineCap = 'butt';
      }
      ctx.globalAlpha = 1;

      // 连击 ×5 四角楔形扇
      if (s.comboFx5 > 0) {
        const progress = 1 - s.comboFx5 / 1.1;
        const alpha = Math.max(0, s.comboFx5);
        ctx.fillStyle = `rgba(103,232,249,${0.22 * alpha})`;
        for (let c = 0; c < 4; c++) {
          const cx = c % 2 === 0 ? 0 : W;
          const cy = c < 2 ? 0 : H;
          const dx = W / 2 - cx;
          const dy = H / 2 - cy;
          const len = Math.hypot(dx, dy) || 1;
          const ux = dx / len;
          const uy = dy / len;
          const d = 30 + progress * 220;
          const hw = 22 + progress * 130;
          const px = -uy;
          const pyu = ux;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + ux * d + px * hw, cy + uy * d + pyu * hw);
          ctx.lineTo(cx + ux * d - px * hw, cy + uy * d - pyu * hw);
          ctx.closePath();
          ctx.fill();
        }
      }

      // Boss 菱形 + 脉冲光环（叠层描边，无需 shadowBlur）
      for (const e of s.enemies) {
        if (e.hp <= 0) continue;
        if (e.boss) {
          ctx.strokeStyle = 'rgba(239,68,68,0.35)';
          ctx.lineWidth = 8 + Math.sin(now / 220) * 4;
          polyPath(ctx, e.x, e.y, 4, e.size * 1.3, 0);
          ctx.stroke();
        }
      }

      // 冻结八角笼（非 Boss 冻结态）
      for (const e of s.enemies) {
        if (e.frozen) {
          ctx.strokeStyle = 'rgba(103,232,249,0.9)';
          ctx.lineWidth = 1.5;
          polyPath(ctx, e.x, e.y, 8, e.size * 0.95 + 6, (e.frozenAngle ?? 0) + now / 900);
          ctx.stroke();
        }
      }

      // 敌人特性视觉（lighter 辉光层）
      for (const e of s.enemies) {
        if (e.hp <= 0 || e.boss || !e.trait) continue;
        const t = e.trait;
        if (t === 'armor') {
          // 护甲：青色护盾菱形框
          ctx.strokeStyle = 'rgba(56,189,248,0.75)';
          ctx.lineWidth = 2;
          diamondPath(ctx, e.x, e.y, e.size * 0.72, e.size * 0.72);
          ctx.stroke();
        } else if (t === 'regen') {
          // 再生：绿色脉动环
          const pulse = 0.5 + 0.5 * Math.sin(now / 300 + e.id);
          ctx.strokeStyle = `rgba(52,211,153,${0.3 + 0.4 * pulse})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(e.x, e.y, e.size * 0.8 + pulse * 3, 0, Math.PI * 2);
          ctx.stroke();
        } else if (t === 'elite') {
          // 精英：金色双重脉冲光环
          const pulse = 0.5 + 0.5 * Math.sin(now / 240 + e.id);
          ctx.strokeStyle = `rgba(251,191,36,${0.5 + 0.4 * pulse})`;
          ctx.lineWidth = 2.5;
          polyPath(ctx, e.x, e.y, 6, e.size * 0.95 + pulse * 5, now / 700);
          ctx.stroke();
          ctx.strokeStyle = 'rgba(251,191,36,0.25)';
          ctx.lineWidth = 1.5;
          polyPath(ctx, e.x, e.y, 6, e.size * 0.7 + pulse * 4, -now / 900);
          ctx.stroke();
        } else if (t === 'swift') {
          // 迅捷：身后拖尾（左向渐隐线段）
          for (let i = 0; i < 3; i++) {
            const off = (i + 1) * e.size * 0.5;
            ctx.strokeStyle = `rgba(251,146,60,${0.4 - i * 0.12})`;
            ctx.lineWidth = 2 - i * 0.5;
            ctx.beginPath();
            ctx.moveTo(e.x - off, e.y);
            ctx.lineTo(e.x - off - e.size * 0.5, e.y);
            ctx.stroke();
          }
        } else if (t === 'split') {
          // 分裂：两侧小十字标记
          ctx.fillStyle = 'rgba(244,114,182,0.85)';
          for (const sx of [-1, 1]) {
            ctx.fillRect(e.x + sx * e.size * 0.85 - 2, e.y - 2, 4, 4);
            ctx.fillRect(e.x + sx * e.size * 0.85 - 2, e.y - 7, 4, 4);
          }
        }
      }

      // 碎屑（三角/菱形/线段）
      for (const sh of s.shards) {
        const a = Math.max(0, sh.life / sh.maxLife);
        ctx.globalAlpha = a;
        ctx.fillStyle = sh.color;
        ctx.save();
        ctx.translate(sh.x, sh.y);
        ctx.rotate(sh.rot);
        if (sh.kind === 'tri') {
          polyPath(ctx, 0, 0, 3, sh.size * 1.6, 0);
          ctx.fill();
        } else if (sh.kind === 'diamond') {
          diamondPath(ctx, 0, 0, sh.size * 1.8, sh.size * 1.1);
          ctx.fill();
        } else {
          ctx.strokeStyle = sh.color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(-sh.size * 4, 0);
          ctx.stroke();
        }
        ctx.restore();
      }
      ctx.globalAlpha = 1;

      ctx.restore(); // 结束 lighter 层

      // 敌人本体 + 头顶小血条（正常合成，带旋转；生存怪同走普通引擎）
      for (const e of s.enemies) {
        if (e.hp <= 0) continue;
        ctx.save();
        ctx.translate(e.x, e.y);
        if (e.rotation != null) ctx.rotate(e.rotation);
        const frozen = e.frozen;
        // 波末灰化：颜色渐灰 + 缓慢淡出
        const gray = e.gray ?? 0;
        const alpha = 1 - gray * 0.8;
        const col = gray > 0 ? mixHex(e.color, '#9ca3af', gray) : e.color;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = col;
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 1.5;
        if (frozen && gray === 0) {
          ctx.fillStyle = '#0e7490';
        }
        if (e.shape === 'circle') {
          ctx.beginPath();
          ctx.arc(0, 0, e.size / 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          // 脉动光环
          ctx.strokeStyle = 'rgba(255,255,255,0.12)';
          ctx.lineWidth = 1;
          ctx.arc(0, 0, e.size / 2 + 2 + Math.sin(Date.now() / 300) * 1.5, 0, Math.PI * 2);
          ctx.stroke();
        } else if (e.shape === 'triangle') {
          polyPath(ctx, 0, 0, 3, e.size / 2, 0);
          ctx.fill();
          ctx.stroke();
        } else if (e.shape === 'square') {
          polyPath(ctx, 0, 0, 4, e.size / 2, Math.PI / 4);
          ctx.fill();
          ctx.stroke();
        } else if (e.shape === 'hexagon') {
          ctx.lineWidth = 2.5;
          polyPath(ctx, 0, 0, 6, e.size / 2, 0);
          ctx.fill();
          ctx.stroke();
          // 厚框内圈
          ctx.strokeStyle = 'rgba(255,255,255,0.15)';
          ctx.lineWidth = 1;
          polyPath(ctx, 0, 0, 6, e.size / 2 - 4, 0);
          ctx.stroke();
        } else if (e.shape === 'cross') {
          const cw = e.size * 0.28;
          const ch = e.size * 0.46;
          ctx.beginPath();
          ctx.moveTo(-cw, -ch); ctx.lineTo(cw, -ch); ctx.lineTo(cw, -cw);
          ctx.lineTo(ch, -cw); ctx.lineTo(ch, cw); ctx.lineTo(cw, cw);
          ctx.lineTo(cw, ch); ctx.lineTo(-cw, ch); ctx.lineTo(-cw, cw);
          ctx.lineTo(-ch, cw); ctx.lineTo(-ch, -cw); ctx.lineTo(-cw, -cw);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        } else if (e.shape === 'diamond') {
          diamondPath(ctx, 0, 0, e.size * 0.6, e.size * 0.45);
          ctx.fill();
          ctx.stroke();
        } else if (e.shape === 'pentagon') {
          polyPath(ctx, 0, 0, 5, e.size / 2, 0);
          ctx.fill();
          ctx.stroke();
          // 辉光环
          ctx.strokeStyle = col;
          ctx.globalAlpha = 0.25 * alpha;
          ctx.lineWidth = 3;
          polyPath(ctx, 0, 0, 5, e.size / 2 + 4, 0);
          ctx.stroke();
          ctx.globalAlpha = alpha;
        } else if (e.shape === 'mini-cross') {
          const s = e.size * 0.4;
          ctx.fillRect(-s, -e.size / 2, s * 2, e.size);
          ctx.fillRect(-e.size / 2, -s, e.size, s * 2);
          ctx.strokeRect(-s, -e.size / 2, s * 2, e.size);
          ctx.strokeRect(-e.size / 2, -s, e.size, s * 2);
        }
        ctx.restore();
        // 小血条（非旋转坐标，在敌人原位上；颜色随 archetype，Boss 保持红）
        if (gray > 0) ctx.globalAlpha = alpha;
        const bw = e.size + 8;
        ctx.fillStyle = 'rgba(15,23,42,0.8)';
        ctx.fillRect(e.x - bw / 2, e.y - e.size / 2 - 8, bw, 4);
        ctx.fillStyle = e.boss ? '#ef4444' : col;
        ctx.fillRect(e.x - bw / 2, e.y - e.size / 2 - 8, bw * (e.hp / e.maxHp), 4);
        ctx.globalAlpha = 1;
      }

      // 弹丸（旋转菱形 + 拖尾）
      for (const p of s.projectiles) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.ang);
        const len = p.big ? 22 : 15;
        // 拖尾线段
        ctx.strokeStyle = p.big ? 'rgba(165,243,252,0.4)' : 'rgba(253,224,71,0.35)';
        ctx.lineWidth = p.big ? 3 : 2;
        ctx.beginPath();
        ctx.moveTo(-len * 1.6, 0);
        ctx.lineTo(0, 0);
        ctx.stroke();
        // 梭形头部
        ctx.fillStyle = p.big ? '#a5f3fc' : '#fde047';
        diamondPath(ctx, 0, 0, len / 2, (p.big ? 6 : 4));
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 1;
        diamondPath(ctx, 0, 0, len * 0.36, p.big ? 4.5 : 3);
        ctx.stroke();
        ctx.restore();
      }

      // 飘字
      for (const f of s.floaters) {
        const a = Math.max(0, Math.min(1, f.life));
        ctx.globalAlpha = a;
        ctx.fillStyle = f.color;
        ctx.font = `${f.weight ?? 700} ${f.size ?? 16}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(f.text, f.x, f.y);
      }
      ctx.globalAlpha = 1;

      // Boss 嘲讽（带背景气泡，淡入淡出）
      if (s.taunt && s.taunt.life > 0) {
        const t = s.taunt;
        const alpha = Math.max(0, Math.min(1, t.life / 0.5, (t.maxLife - t.life) / 0.35 + 0.25));
        ctx.globalAlpha = alpha;
        ctx.font = 'bold 17px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const tw = ctx.measureText(t.text).width;
        const bw = tw + 28;
        const bx = t.x - bw / 2;
        const by = t.y - 17;
        ctx.fillStyle = 'rgba(15,23,42,0.88)';
        ctx.strokeStyle = 'rgba(245,158,11,0.55)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(bx, by, bw, 34, 10);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#f59e0b';
        ctx.fillText(t.text, t.x, t.y);
        ctx.textBaseline = 'alphabetic';
        ctx.globalAlpha = 1;
      }

      // 受击红闪
      if (s.flash > 0) {
        ctx.fillStyle = `rgba(239,68,68,${0.22 * s.flash})`;
        ctx.fillRect(0, 0, W, H);
      }

      // 低血量暗角红晕
      if (s.maxHp > 0 && s.hp / s.maxHp < 0.3 && s.hp > 0) {
        const va = (0.3 - s.hp / s.maxHp) * 1.5;
        const corners: [number, number][] = [[0, 0], [W, 0], [0, H], [W, H]];
        for (const [cx, cy] of corners) {
          const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, W * 0.4);
          g.addColorStop(0, `rgba(239,68,68,${va * 0.45})`);
          g.addColorStop(1, 'rgba(239,68,68,0)');
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, W, H);
        }
      }

      // P2 暴怒常驻红调（压力感）
      if (s.bossP2 && !s.bossDefeated) {
        ctx.fillStyle = 'rgba(153,27,27,0.06)';
        ctx.fillRect(0, 0, W, H);
      }

      // Boss 击破金闪
      if (s.goldFlash > 0) {
        ctx.fillStyle = `rgba(250,204,21,${0.35 * s.goldFlash})`;
        ctx.fillRect(0, 0, W, H);
      }

      // 战斗失败：红色渐入淡出（0.6s 后跳结算）
      if (s.failFade > 0 && !s.running) {
        const a = Math.min(0.55, (s.failFade / 0.6) * 0.55);
        ctx.fillStyle = `rgba(127,29,29,${a})`;
        ctx.fillRect(0, 0, W, H);
      }

      ctx.restore();

      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      flushSfx();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={boxRef} className="absolute inset-0 touch-none overflow-hidden overscroll-none">
      <canvas ref={canvasRef} className="absolute inset-0 block" />
    </div>
  );
}

export const BattleField = forwardRef<BattleFieldHandle, Props>(BattleFieldInner);