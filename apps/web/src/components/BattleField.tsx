// 即时战斗特效层（里程碑6 + v2.2）：Canvas 几何霓虹战场
// 金色矩形角色 + 几何怪逼近补位 + Boss 血条 + 菱形弹丸/三角碎屑/多边形波纹 + 飘字
// 性能：禁热循环 shadowBlur，霓虹用「亮芯+双描边叠层」，辉光层统一 'lighter'，网格离屏预渲染
// v2.2：freezeEnemies（重写冻结，Boss除外）/ skillAttack（3枚大菱形）/ 连击 ×3/×5/×7 几何反馈
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { SurvivalBattle, type SurvivalEvent, type SurvivalWaveMeta, type TierIdx } from '../lib/survivalBattle';
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
} from '../lib/sfx';

export interface BattleFieldHandle {
  // 每次判定结果：correct 触发攻击，wrong 触发受击扣血；isRevenge 双倍伤害；typed 用户实际输入（用于飘字反馈）
  notifyAnswer(correct: boolean, combo: number, isRevenge?: boolean, typed?: string): void;
  freezeEnemies(frozen: boolean): void;
  skillAttack(): void;
  bossAlive(): boolean;
  startBoss(bossHp: number): void;
  // 生存模式：逐波初始化 / 逐问推进 / 波末服务端权威校准
  startSurvivalWave(meta: SurvivalWaveMeta): void;
  survivalTick(correct: boolean, combo?: number): void;
  syncSurvivalHp(hp: number, maxHp: number): void;
  // 生存模式：波末上报（客户端权威血量 / Boss 是否击破）
  getSurvivalHp(): number;
  isSurvivalBossCleared(): boolean;
}

interface Props {
  initHp: number;
  totalQuestions: number;
  onPlayerDown?: () => void;
  onBossDefeated?: () => void;
  phase: 'study' | 'boss';
  tauntWords?: string[]; // Boss 段嘲讽词列表（本局错词）
  onLockInput?: () => void; // 战斗结束/失败瞬间锁定答题
  survival?: boolean; // 生存模式：启用逐问模拟战斗层
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
  rotation?: number;
  rotSpeed?: number;
  archetype?: string; // 所属模板名
  splitOnDeath?: boolean; // 死亡时是否分裂
  snakePhase?: number; // diamond 蛇形相位
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

// ---- 生存模式：tier → 怪外观（θ 公式只影响 HP，外观按词难度分级）----
const SURVIVAL_TIER_STYLE: { shape: Enemy['shape']; color: string; size: number; name: string }[] = [
  { shape: 'circle',   color: '#22d3ee', size: 24, name: 'Blob' },   // Ⅰ
  { shape: 'triangle', color: '#34d399', size: 18, name: 'Spike' },  // Ⅱ
  { shape: 'square',   color: '#a78bfa', size: 26, name: 'Cube' },   // Ⅲ
  { shape: 'pentagon', color: '#f472b6', size: 28, name: 'Crystal' },// Ⅳ
];

function survivalEnemyFromMonster(m: { id: number; tier: TierIdx; hp: number; maxHp: number; progress: number; speed: number }, x: number, y: number): Enemy {
  const style = SURVIVAL_TIER_STYLE[m.tier] ?? SURVIVAL_TIER_STYLE[0]!;
  return {
    id: m.id,
    shape: style.shape,
    x,
    y,
    hp: m.hp,
    maxHp: m.maxHp,
    speed: m.speed,
    size: style.size,
    color: style.color,
    archetype: style.name,
    rotation: 0,
    rotSpeed: 0,
  };
}

// 生存怪 x 插值：progress 0=左缘，1=玩家侧
function survivalX(progress: number, playerXVal: number): number {
  return -30 + progress * (playerXVal - (-30) - PLAYER_SIZE / 2);
}

// 生存模式：场内存活状态（每次 startSurvivalWave 重建）
interface SurvivalStateShape {
  sim: SurvivalBattle;
  hp: number;
  maxHp: number;
  day: number;
  enemies: Enemy[];
  bossActive: boolean;
  bossHp: number;
  bossMaxHp: number;
  bossP2: boolean;
  leechN: number;
}

// 事件处理所需的状态子集（避免把整个 mutable state 传出去）
interface SurvivalFx {
  enemies: Enemy[];
  projectiles: Projectile[];
  shards: Shard[];
  rings: Ring[];
  floaters: Floater[];
  flash: number;
  shake: number;
  glow: number;
  hitStop: number;
  goldFlash: number;
  bossIntro: number;
  taunt: { text: string; x: number; y: number; life: number; maxLife: number } | null;
}

// 事件处理所需的真实 state（直接改写，使 flash/shake/hitStop 等标量特效生效）
interface SurvivalFxState extends SurvivalFx {
  attackRecoil: number;
  comboFx3: number;
  comboFx5: number;
  comboFx7: number;
  playerGlint: number;
  slowTimer: number;
  bossP2: boolean;
  survival: SurvivalStateShape | null;
}

// 实时模拟事件 → 视觉（直接搬普通模式特效：弹丸/发射闪光/爆炸/顿帧/连击/飘字/音效）
function applySurvivalEvents(s: SurvivalFxState, px: number, py: number, events: SurvivalEvent[]): void {
  const enemies = s.survival!.enemies;
  for (const ev of events) {
    switch (ev.type) {
      case 'spawn': {
        const m = ev.monster;
        const x = survivalX(m.progress, px);
        const e = survivalEnemyFromMonster(m, x, py - 40 + Math.random() * 80);
        enemies.push(e);
        break;
      }
      case 'attack': {
        const target = enemies.find((e) => e.id === ev.targetId);
        if (!target) break;
        // 普通模式攻击特效：发射口闪光 + 圆环 + 弹丸 + 发光 + 后坐 + 音效
        for (let i = 0; i < 2; i++) {
          const ma = Math.PI + (Math.random() - 0.5) * 0.7;
          pushShardFx(s, px + PLAYER_SIZE / 2, py, Math.cos(ma) * 130, Math.sin(ma) * 130, '#fde047', 1.6);
        }
        if (s.rings.length < 8) {
          s.rings.push({ x: px + PLAYER_SIZE / 2, y: py, r: 3, vr: 110, life: 0.16, maxLife: 0.16, color: '#fde047' });
        }
        const ang = Math.atan2(target.y - py, target.x - px - PLAYER_SIZE / 2);
        s.projectiles.push({
          x: px + PLAYER_SIZE / 2, y: py,
          tx: target.x, ty: target.y, t: 0, targetId: target.id,
          ang, damage: ev.dmg,
        });
        if (ev.crit) {
          s.floaters.push({ x: target.x, y: target.y - 20, text: '新词暴击 ×2', color: '#fbbf24', life: 1.2, size: 20, weight: 900 });
        }
        s.glow = 1;
        s.attackRecoil = 1;
        playAttackSound();
        break;
      }
      case 'kill': {
        const idx = enemies.findIndex((e) => e.id === ev.targetId);
        if (idx >= 0) {
          const target = enemies[idx]!;
          explodeFX(s, target.x, target.y, target.color, 18);
          s.hitStop = Math.max(s.hitStop, 0.12); // 击杀顿帧
          playKillSound();
          if (ev.heal > 0) {
            s.floaters.push({ x: target.x, y: target.y - 28, text: '+♥ 击杀回血', color: '#4ade80', life: 1.4 });
          }
          s.floaters.push({ x: target.x, y: target.y - 14, text: '击杀', color: '#fde047', life: 1.2 });
          enemies.splice(idx, 1);
        }
        break;
      }
      case 'wrong': {
        if (ev.blocked) {
          s.floaters.push({ x: px, y: py - 30, text: '免伤', color: '#94a3b8', life: 1 });
        } else {
          hurtFX(s, ev.dmg, px, py);
        }
        break;
      }
      case 'leak': {
        const lidx = enemies.findIndex((e) => e.id === ev.targetId);
        if (lidx >= 0) enemies.splice(lidx, 1);
        explodeFX(s, px - 40, py, '#f87171', 14);
        if (ev.blocked) {
          s.floaters.push({ x: px, y: py - 30, text: '漏怪·免伤', color: '#94a3b8', life: 1.2 });
        } else {
          s.floaters.push({ x: px, y: py - 30, text: `漏怪 -${ev.dmg}`, color: '#f87171', life: 1.2 });
          hurtFX(s, ev.dmg, px, py);
        }
        break;
      }
      case 'stun': {
        for (const e of enemies) {
          e.frozen = true;
          e.frozenAngle = Math.random() * Math.PI * 2;
        }
        playFreezeSound();
        s.floaters.push({ x: px, y: py - 60, text: '⚡ 连错眩晕 · 怪暂停逼近', color: '#a5f3fc', life: 1.4 });
        break;
      }
      case 'leech': {
        s.floaters.push({ x: px - 20, y: py - 24, text: `+♥ ${ev.amount}`, color: '#4ade80', life: 1.2, size: 20, weight: 900 });
        break;
      }
      case 'boss-hit': {
        if (s.survival) s.survival.bossHp = ev.bossHp;
        if (ev.p2 && s.survival && !s.survival.bossP2) {
          s.survival.bossP2 = true;
          playP2RageSound();
          s.floaters.push({ x: px, y: py - 80, text: '⚠ BOSS 暴怒！P2', color: '#c084fc', life: 3 });
        }
        if (ev.cleared) {
          s.goldFlash = 1;
          s.flash = 1.5;
          s.hitStop = Math.max(s.hitStop, 0.3);
          playBossDefeatSound();
          for (let i = 0; i < 8; i++) {
            s.rings.push({ x: px, y: py, r: 16 + i * 10, vr: 320 + i * 40, life: 1.4, maxLife: 1.4, color: i % 2 === 0 ? '#fbbf24' : '#ef4444' });
          }
          s.floaters.push({ x: px, y: py - 70, text: 'BOSS 击破！', color: '#fbbf24', life: 1.6, size: 24, weight: 900 });
        } else {
          s.floaters.push({ x: px - 30, y: py - 70, text: `-${ev.dmg}`, color: '#fca5a5', life: 1 });
        }
        break;
      }
      case 'boss-miss': {
        if (ev.immune) {
          s.floaters.push({ x: px - 30, y: py - 70, text: 'P2 免疫', color: '#94a3b8', life: 1.2 });
        } else {
          s.floaters.push({ x: px - 30, y: py - 70, text: `BOSS -${ev.dmg}`, color: '#f87171', life: 1.2 });
          hurtFX(s, ev.dmg, px, py);
        }
        break;
      }
      case 'death': {
        s.floaters.push({ x: px, y: py - 60, text: '💀 阵亡…', color: '#ef4444', life: 2.5, size: 26, weight: 900 });
        break;
      }
    }
  }
}

function pushShardFx(s: SurvivalFxState, x: number, y: number, vx: number, vy: number, color: string, size: number): void {
  s.shards.push({
    x, y, vx, vy,
    life: 0.4 + Math.random() * 0.35, maxLife: 0.75, color,
    size, rot: Math.random() * Math.PI, spin: (Math.random() - 0.5) * 16,
    kind: Math.random() < 0.55 ? 'diamond' : 'tri',
  });
}

function explodeFX(s: SurvivalFxState, x: number, y: number, color: string, count: number): void {
  for (let i = 0; i < count; i++) {
    const ang = Math.random() * Math.PI * 2;
    const spd = 60 + Math.random() * 160;
    s.shards.push({
      x, y, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
      life: 0.4 + Math.random() * 0.35, maxLife: 0.75, color,
      size: 2 + Math.random() * 3, rot: Math.random() * Math.PI, spin: (Math.random() - 0.5) * 16,
      kind: Math.random() < 0.55 ? 'diamond' : 'tri',
    });
  }
  if (s.rings.length < 8) {
    s.rings.push({ x, y, r: 6, vr: 180, life: 0.22, maxLife: 0.22, color });
  }
}

function hurtFX(s: SurvivalFxState, dmg: number, px: number, py: number): void {
  s.flash = 1;
  s.shake = 1;
  playHurtSound();
  s.floaters.push({ x: px, y: py - 24, text: `-${dmg}`, color: '#f87171', life: 1 });
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

function BattleFieldInner({ initHp, totalQuestions, onPlayerDown, onBossDefeated, phase: _phase, tauntWords: tauntWordsProp, onLockInput: onLockInputProp, survival: survivalProp }: Props, ref: React.Ref<BattleFieldHandle>) {
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
    shards: [] as Shard[],
    rings: [] as Ring[],
    floaters: [] as Floater[],
    spawnTimer: 0,
    enemyId: 0,
    comboFx3: 0,
    comboFx5: 0,
    comboFx7: 0,
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
      // 生存模式状态（实时时间驱动模拟，客户端权威血量）
    survival: null as SurvivalStateShape | null,
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
    // ── 生存模式（逐问模拟，服务端权威在波末校准）──
    startSurvivalWave(meta: SurvivalWaveMeta) {
      const s = state.current;
      const sim = new SurvivalBattle(meta);
      const px = playerX();
      const py = sY();
      const enemies: Enemy[] = [];
      for (const m of sim.monsters) {
        enemies.push(survivalEnemyFromMonster(m, survivalX(m.progress, px), py - 40 + Math.random() * 80));
      }
      s.survival = {
        sim,
        hp: meta.hp,
        maxHp: meta.maxHp,
        day: meta.day,
        enemies,
        bossActive: meta.bossWave,
        bossHp: meta.bossHp ?? 0,
        bossMaxHp: meta.bossHp ?? 0,
        bossP2: false,
        leechN: 6,
      };
      s.hp = meta.hp;
      s.maxHp = meta.maxHp;
      if (meta.bossWave) {
        s.bossPhase = true;
        s.bossSpawned = true;
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
      } else {
        s.bossPhase = false;
        s.bossSpawned = false;
        s.floaters.push({ x: cssRef.current.w / 2, y: py - 60, text: `第 ${meta.day} 天`, color: '#67e8f9', life: 1.6 });
      }
    },
    survivalTick(correct: boolean, combo = 0) {
      const s = state.current;
      if (!s.survival) return;
      // 每问先解冻（stun 事件再重新冻结），避免眩晕视觉残留
      for (const e of s.survival.enemies) e.frozen = false;
      // 普通模式连击特效（×3/×5/×7）
      if (correct) comboFx(combo);
      const events = s.survival.sim.onAnswer(correct);
      const px = playerX();
      const py = sY();
      applySurvivalEvents(s as SurvivalFxState, px, py, events);
      // 血量以 sim 为准（客户端实时模拟权威）
      s.survival.hp = s.survival.sim.currentHp;
      s.hp = s.survival.hp;
      // 死亡：预测 HP 归零 → 触发失败回调（波末 advance 定论，此处仅视觉）
      if (s.survival.hp <= 0 && !s.playerDown) {
        s.survival.hp = 0;
        s.running = false;
        if (!s.playerDown) {
          s.playerDown = true;
          s.failFade = 0.001;
          s.shake = 1.6;
          onLockInputRef.current?.();
          setTimeout(() => onPlayerDownRef.current?.(), 650);
        }
      }
    },
    syncSurvivalHp(hp: number, maxHp: number) {
      const s = state.current;
      if (!s.survival) return;
      s.survival.hp = hp;
      s.survival.maxHp = maxHp;
      s.hp = hp;
      s.maxHp = maxHp;
    },
    getSurvivalHp() {
      const s = state.current;
      return s.survival ? s.survival.sim.currentHp : 0;
    },
    isSurvivalBossCleared() {
      const s = state.current;
      return s.survival ? s.survival.sim.isBossCleared : false;
    },
  }));

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

      if (s.running && !survivalProp) {
        const anyFrozen = s.enemies.some((e) => e.frozen);
        if (!anyFrozen) {
          // 学习段：每答对 3 词上限 +1，封顶 4；Boss 段：每答对 2 词上限 +1，封顶 2
          const maxEnemies = s.bossPhase
            ? Math.min(1, Math.floor(s.bossCorrectCount / 2) + 1)
            : Math.min(4, Math.floor(s.correctCount / 3) + 1);
          s.spawnTimer -= dt;
          const normalCount = s.enemies.filter((e) => !e.boss && e.hp > 0 && !e.reachedPlayer).length;
          if (normalCount < maxEnemies && s.spawnTimer <= 0) {
            spawnEnemy();
            s.spawnTimer = 0.5 + Math.random() * 0.6;
          }
          // 场上清空且仍有词或 Boss 段未死 → 立即补怪
          if (
            (s.bossPhase ? s.enemies.some((e) => e.boss && e.hp > 0) : totalQuestionsRef.current > s.correctCount) &&
            s.enemies.filter((e) => e.hp > 0 && !e.reachedPlayer).length === 0
          ) {
            spawnEnemy();
            s.spawnTimer = 0.3;
          }
        }

        // Boss 段嘲讽：每 6~10 秒从 Boss 上方弹一句错词（单条，不堆叠）
        if (s.bossPhase && !s.bossDefeated) {
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

        // Boss P2 阶段：半血后定期召唤小怪
        if (s.bossPhase && s.bossP2 && !s.bossDefeated) {
          s.bossSpawnTimer -= dt;
          if (s.bossSpawnTimer <= 0) {
            s.bossSpawnTimer = 5 + Math.random() * 3;
            spawnEnemy(false);
          }
        }
      }

      // 生存模式：实时时间驱动（怪逼近/抵达漏怪），每帧推进
      if (s.running && s.survival) {
        const evs = s.survival.sim.step(dt);
        if (evs.length > 0) {
          applySurvivalEvents(s as SurvivalFxState, playerX(), sY(), evs);
        }
        // 同步场上怪位置与 HP（progress 每帧连续推进 → 实时逼近，无瞬移）
        const pxv = playerX();
        for (const m of s.survival.sim.monsters) {
          const e = s.survival.enemies.find((en) => en.id === m.id);
          if (e) {
            e.x = survivalX(m.progress, pxv);
            e.hp = m.hp;
            e.maxHp = m.maxHp;
          }
        }
        // 清理 sim 已移除但事件未覆盖的残影（漏怪/击杀兜底）
        if (s.survival.enemies.length !== s.survival.sim.monsters.length) {
          const alive = new Set(s.survival.sim.monsters.map((m) => m.id));
          s.survival.enemies = s.survival.enemies.filter((e) => alive.has(e.id));
        }
        // 血量以 sim 为准（客户端实时模拟权威）
        s.survival.hp = s.survival.sim.currentHp;
        s.hp = s.survival.hp;
        if (s.survival.hp <= 0 && !s.playerDown) {
          s.survival.hp = 0;
          s.running = false;
          s.playerDown = true;
          s.failFade = 0.001;
          s.shake = 1.6;
          onLockInputRef.current?.();
          setTimeout(() => onPlayerDownRef.current?.(), 650);
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
        if (e.hp <= 0 || e.frozen) continue;
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
          if (e.boss) {
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
        const pool = s.survival ? s.survival.enemies : s.enemies;
        const target = pool.find((e) => e.id === p.targetId);
        if (target && target.hp > 0 && p.t < 1) {
          p.x += (target.x - p.x) * dt * 10;
          p.y += (target.y - p.y) * dt * 10;
        } else {
          // 命中结算
          const hit = pool.find((e) => e.id === p.targetId);
          if (hit && hit.hp > 0) {
            const dmg = p.damage ?? 1;
            const isCrit = dmg >= 2; // 复仇/技能双倍伤害
            explode(p.tx, p.ty, hit.color, 6, p.big);
            // 生存模式：伤害/击杀由 sim 事件驱动（此处仅视觉），避免二次扣血
            if (s.survival) {
              p.t = 99;
              continue;
            }
            hit.hp -= dmg;
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
            explode(p.tx, p.ty, hit.color, p.big ? 26 : 6, p.big);
            if (hit.hp <= 0) {
              s.hitStop = Math.max(s.hitStop, hit.boss ? 0.3 : 0.12);
              if (hit.boss) {
                s.bossDefeated = true;
                onBossDefeatedRef.current?.();
                s.flash = 1.5;
                s.goldFlash = 1; // 击破金闪
                playBossDefeatSound();
                for (let i = 0; i < 8; i++) {
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
      s.slowTimer = Math.max(0, s.slowTimer - dt);
      s.playerGlint = Math.max(0, s.playerGlint - dt * 1.4);
      s.breathTimer += dt;
      s.attackRecoil = Math.max(0, s.attackRecoil - dt * 3);
      s.goldFlash = Math.max(0, s.goldFlash - dt * 4.5);
      if (s.bossIntro > 0) s.bossIntro -= dt;
      if (s.failFade > 0) s.failFade += dt;

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

      // Boss 血条（顶部居中，霓虹描边 + P2 变色）
      const boss = s.survival && s.survival.bossActive
        ? { hp: s.survival.bossHp, maxHp: s.survival.bossMaxHp, p2: s.survival.bossP2 }
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

      // 敌人本体 + 头顶小血条（正常合成，带旋转）
      const renderEnemies = s.survival ? s.survival.enemies : s.enemies;
      for (const e of renderEnemies) {
        if (e.hp <= 0) continue;
        ctx.save();
        ctx.translate(e.x, e.y);
        if (e.rotation != null) ctx.rotate(e.rotation);
        const frozen = e.frozen;
        ctx.fillStyle = e.color;
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 1.5;
        if (frozen) {
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
          ctx.strokeStyle = e.color;
          ctx.globalAlpha = 0.25;
          ctx.lineWidth = 3;
          polyPath(ctx, 0, 0, 5, e.size / 2 + 4, 0);
          ctx.stroke();
          ctx.globalAlpha = 1;
        } else if (e.shape === 'mini-cross') {
          const s = e.size * 0.4;
          ctx.fillRect(-s, -e.size / 2, s * 2, e.size);
          ctx.fillRect(-e.size / 2, -s, e.size, s * 2);
          ctx.strokeRect(-s, -e.size / 2, s * 2, e.size);
          ctx.strokeRect(-e.size / 2, -s, e.size, s * 2);
        }
        ctx.restore();
        // 小血条（非旋转坐标，在敌人原位上；颜色随 archetype，Boss 保持红）
        const bw = e.size + 8;
        ctx.fillStyle = 'rgba(15,23,42,0.8)';
        ctx.fillRect(e.x - bw / 2, e.y - e.size / 2 - 8, bw, 4);
        ctx.fillStyle = e.boss ? '#ef4444' : e.color;
        ctx.fillRect(e.x - bw / 2, e.y - e.size / 2 - 8, bw * (e.hp / e.maxHp), 4);
        // 生存模式：恢复经典 HP 数值（击数）血条观感
        if (s.survival) {
          ctx.fillStyle = 'rgba(255,255,255,0.9)';
          ctx.font = 'bold 11px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(`${Math.max(0, e.hp)}`, e.x, e.y - e.size / 2 - 12);
        }
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={boxRef} className="absolute inset-0 overflow-hidden">
      <canvas ref={canvasRef} className="absolute inset-0 block" />
    </div>
  );
}

export const BattleField = forwardRef<BattleFieldHandle, Props>(BattleFieldInner);