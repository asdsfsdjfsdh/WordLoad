// 即时战斗特效层（里程碑6 + v2.2）：Canvas 几何霓虹战场
// 金色矩形角色 + 几何怪逼近补位 + Boss 血条 + 菱形弹丸/三角碎屑/多边形波纹 + 飘字
// 性能：禁热循环 shadowBlur，霓虹用「亮芯+双描边叠层」，辉光层统一 'lighter'，网格离屏预渲染
// v2.2：freezeEnemies（重写冻结，Boss除外）/ skillAttack（3枚大菱形）/ 连击 ×3/×5/×7 几何反馈
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

export interface BattleFieldHandle {
  // 每次判定结果：correct 触发攻击，wrong 触发受击扣血
  notifyAnswer(correct: boolean, combo: number): void;
  // 膨胀重写：冻结/解冻所有非 Boss 小怪（青色八角笼）
  freezeEnemies(frozen: boolean): void;
  // 3 遍重写全对：同时发射 3 枚大弹丸攻击最近 3 只非 Boss 怪
  skillAttack(): void;
}

interface Props {
  initHp: number;
  totalQuestions: number;
  onPlayerDown?: () => void;
}

interface Enemy {
  id: number;
  shape: 'circle' | 'triangle' | 'square';
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
}

const PLAYER_X = 56;
const PLAYER_SIZE = 30;
const NORMAL_HP = 2;
const SHAPES: Enemy['shape'][] = ['circle', 'triangle', 'square'];
const COLORS = ['#ef4444', '#f97316', '#a855f7'];
const PARTICLE_CAP = 220;

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

function BattleFieldInner({ initHp, totalQuestions, onPlayerDown }: Props, ref: React.Ref<BattleFieldHandle>) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const onPlayerDownRef = useRef(onPlayerDown);
  const totalQuestionsRef = useRef(totalQuestions);
  onPlayerDownRef.current = onPlayerDown;
  totalQuestionsRef.current = totalQuestions;

  // 可变战场状态（rAF 驱动，不触发 React 重渲染）
  const state = useRef({
    running: true,
    hp: initHp,
    maxHp: initHp,
    correctCount: 0,
    combo: 0,
    flash: 0,
    shake: 0,
    glow: 0,
    bossSpawned: false,
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
  });

  const sY = (): number => (canvasRef.current?.height ?? 300) / 2;

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
      const W = canvasRef.current?.width ?? 800;
      const H = canvasRef.current?.height ?? 300;
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
          x: PLAYER_X + PLAYER_SIZE / 2,
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
    notifyAnswer(correct: boolean, combo: number) {
      const s = state.current;
      s.combo = combo;
      if (correct) {
        s.correctCount++;
        comboFx(combo);
        attack();
      } else {
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
    },
    skillAttack() {
      const s = state.current;
      const alive = s.enemies.filter((e) => e.hp > 0 && !e.reachedPlayer && !e.boss);
      const py = sY();
      const nearest = [...alive]
        .sort((a, b) => ((a.x - PLAYER_X) ** 2 + (a.y - py) ** 2) - ((b.x - PLAYER_X) ** 2 + (b.y - py) ** 2))
        .slice(0, 3);
      if (nearest.length === 0) return;
      for (const t of nearest) {
        const ang = Math.atan2(t.y - py, t.x - PLAYER_X - PLAYER_SIZE / 2);
        s.projectiles.push({
          x: PLAYER_X + PLAYER_SIZE / 2,
          y: py,
          tx: t.x,
          ty: t.y,
          t: 0,
          targetId: t.id,
          ang,
          big: true,
        });
      }
      s.glow = 1.2;
      const W = canvasRef.current?.width ?? 800;
      s.floaters.push({ x: W / 2, y: py - 60, text: '💥 技能释放', color: '#a5f3fc', life: 1.4 });
    },
  }));

  // 攻击：始终向最接近角色的敌人发射弹丸
  const attack = () => {
    const s = state.current;
    const alive = s.enemies.filter((e) => e.hp > 0 && !e.reachedPlayer);
    if (alive.length === 0) return;
    const py = sY();
    const target = alive.reduce((a, b) => {
      const da = (a.x - PLAYER_X) ** 2 + (a.y - py) ** 2;
      const db = (b.x - PLAYER_X) ** 2 + (b.y - py) ** 2;
      return da < db ? a : b;
    });
    const ang = Math.atan2(target.y - py, target.x - PLAYER_X - PLAYER_SIZE / 2);
    s.projectiles.push({
      x: PLAYER_X + PLAYER_SIZE / 2,
      y: py,
      tx: target.x,
      ty: target.y,
      t: 0,
      targetId: target.id,
      ang,
    });
    s.glow = 1;
  };

  const hurt = (dmg: number) => {
    const s = state.current;
    if (!s.running) return;
    s.hp = Math.max(0, s.hp - dmg);
    s.flash = 1;
    s.shake = 1;
    if (s.hp <= 0) {
      s.running = false;
      onPlayerDownRef.current?.();
    }
  };

  const spawnEnemy = (boss = false): void => {
    const s = state.current;
    const canvas = canvasRef.current;
    const W = canvas?.width ?? 800;
    const H = canvas?.height ?? 300;
    s.enemyId++;
    if (boss) {
      // Boss 血量随本局词数提升：6 + 每 10 词 +2，封顶 18
      const bossHp = Math.min(18, 6 + Math.floor(totalQuestionsRef.current / 10) * 2);
      s.enemies.push({
        id: s.enemyId,
        shape: 'square',
        x: W * 0.75,
        y: H * 0.5,
        hp: bossHp,
        maxHp: bossHp,
        speed: 16,
        size: 56,
        color: '#dc2626',
        boss: true,
      });
      s.floaters.push({ x: W / 2, y: 46, text: '⚠ BOSS 出现！', color: '#f87171', life: 2 });
      s.floaters.push({ x: W / 2, y: 70, text: `HP ${bossHp}`, color: '#fbbf24', life: 2 });
    } else {
      const shape = SHAPES[Math.floor(Math.random() * SHAPES.length)] as Enemy['shape'];
      const size = 18 + Math.random() * 10;
      // 生成 Y 范围上移，避开底部答题区浮层
      s.enemies.push({
        id: s.enemyId,
        shape,
        x: W + 30,
        y: 24 + Math.random() * Math.max(30, H * 0.58),
        hp: NORMAL_HP,
        maxHp: NORMAL_HP,
        speed: 55 + Math.random() * 20,
        size,
        color: COLORS[Math.floor(Math.random() * COLORS.length)] as string,
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
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const s = state.current;

      if (s.running) {
        const anyFrozen = s.enemies.some((e) => e.frozen);
        if (!anyFrozen) {
          const remaining = Math.max(0, totalQuestionsRef.current - s.correctCount);
          // 怪数随剩余词量动态变化：每 4 个剩余词 1 只怪，至少 1 只，最多 6 只
          const maxEnemies = Math.min(6, Math.max(1, Math.ceil(remaining / 4)));
          s.spawnTimer -= dt;
          const normalCount = s.enemies.filter((e) => !e.boss && e.hp > 0 && !e.reachedPlayer).length;
          if (normalCount < maxEnemies && s.spawnTimer <= 0) {
            spawnEnemy();
            s.spawnTimer = 0.5 + Math.random() * 0.6;
          }
          // 场上清空但有剩余词 → 立即补怪
          if (remaining > 0 && s.enemies.filter((e) => e.hp > 0 && !e.reachedPlayer).length === 0) {
            spawnEnemy();
            s.spawnTimer = 0.3;
          }
          // Boss 触发
          if (
            !s.bossSpawned &&
            totalQuestionsRef.current >= 8 &&
            s.correctCount >= Math.max(4, Math.round(totalQuestionsRef.current * 0.6))
          ) {
            spawnEnemy(true);
            s.bossSpawned = true;
          }
        }
      }

      // 怪移动（冻结的原地不动；连击×7 全怪减速 20%）
      const slowMult = s.slowTimer > 0 ? 0.8 : 1;
      for (const e of s.enemies) {
        if (e.hp <= 0 || e.frozen) continue;
        e.x -= e.speed * slowMult * dt;
        if (e.x <= PLAYER_X + PLAYER_SIZE) {
          e.reachedPlayer = true;
          hurt(e.boss ? 3 : 1);
          explode(e.x, e.y, e.color, 12);
          s.floaters.push({ x: e.x, y: e.y, text: e.boss ? '-3 HP' : '-1', color: '#f87171', life: 1 });
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
            hit.hp -= 1;
            explode(p.tx, p.ty, hit.color, p.big ? 26 : 6, p.big);
            if (hit.hp <= 0) {
              explode(p.tx, p.ty, hit.color, p.big ? 34 : 22, p.big);
              s.floaters.push({
                x: p.tx,
                y: p.ty - 16,
                text: hit.boss ? 'BOSS 击破！' : '击杀',
                color: hit.boss ? '#fbbf24' : '#fde047',
                life: 1.4,
              });
            } else {
              s.floaters.push({
                x: p.tx,
                y: p.ty - 14,
                text: hit.boss ? `-1 (${hit.hp}/${hit.maxHp})` : '+1',
                color: hit.boss ? '#fca5a5' : '#fef08a',
                life: 0.8,
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

      // ---- 渲染 ----
      ctx.save();
      ctx.fillStyle = '#0b1120';
      ctx.fillRect(0, 0, W, H);
      ctx.drawImage(grid, 0, 0, W, H);

      // 抖动
      if (s.shake > 0) {
        ctx.translate((Math.random() - 0.5) * 8 * s.shake, (Math.random() - 0.5) * 8 * s.shake);
      }

      // Boss 血条（顶部居中，霓虹描边）
      const boss = s.enemies.find((e) => e.boss && e.hp > 0);
      if (boss) {
        const bw = Math.min(360, W * 0.55);
        ctx.fillStyle = 'rgba(220,38,38,0.12)';
        ctx.fillRect((W - bw) / 2 - 6, 16, bw + 12, 26);
        ctx.strokeStyle = '#7f1d1d';
        ctx.lineWidth = 2;
        ctx.strokeRect((W - bw) / 2 - 6, 16, bw + 12, 26);
        ctx.fillStyle = '#dc2626';
        ctx.fillRect((W - bw) / 2, 22, bw * (boss.hp / boss.maxHp), 14);
        ctx.fillStyle = '#fecaca';
        ctx.font = 'bold 13px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`☠ BOSS  ${boss.hp}/${boss.maxHp}`, W / 2, 33);
      }

      // 我方血条（左上）
      ctx.fillStyle = 'rgba(148,163,184,0.15)';
      ctx.fillRect(12, 12, 160, 16);
      const hpPct = Math.max(0, s.hp / s.maxHp);
      ctx.fillStyle = hpPct > 0.4 ? '#22c55e' : '#ef4444';
      ctx.fillRect(12, 12, 160 * hpPct, 16);
      ctx.strokeStyle = 'rgba(148,163,184,0.4)';
      ctx.strokeRect(12, 12, 160, 16);
      ctx.fillStyle = '#e2e8f0';
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`HP ${Math.ceil(s.hp)}/${s.maxHp}`, 18, 24);

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

      // 角色：金色矩形（箱体 + 旋转方块 glint）
      const py = sY();
      ctx.save();
      if (s.glow > 0 || s.combo >= 5) {
        ctx.strokeStyle = 'rgba(253,224,71,0.55)';
        ctx.lineWidth = (6 + s.glow * 10) + (s.combo >= 5 ? 4 : 0);
        diamondPath(ctx, PLAYER_X, py, PLAYER_SIZE * 0.72, PLAYER_SIZE * 0.72);
        ctx.stroke();
      }
      ctx.fillStyle = s.flash > 0 ? '#f97316' : '#facc15';
      ctx.fillRect(PLAYER_X - PLAYER_SIZE / 2, py - PLAYER_SIZE / 2, PLAYER_SIZE, PLAYER_SIZE);
      ctx.strokeStyle = '#fde68a';
      ctx.lineWidth = 2;
      ctx.strokeRect(PLAYER_X - PLAYER_SIZE / 2, py - PLAYER_SIZE / 2, PLAYER_SIZE, PLAYER_SIZE);
      if (s.playerGlint > 0) {
        ctx.strokeStyle = 'rgba(253,224,71,0.85)';
        ctx.lineWidth = 2;
        diamondPath(ctx, PLAYER_X, py, PLAYER_SIZE * 0.95 + s.playerGlint * 6, PLAYER_SIZE * 0.95 + s.playerGlint * 6);
        ctx.stroke();
      }
      ctx.restore();

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

      // 敌人本体 + 头顶小血条（正常合成）
      for (const e of s.enemies) {
        if (e.hp <= 0) continue;
        ctx.save();
        const frozen = e.frozen;
        ctx.fillStyle = e.color;
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 1.5;
        if (frozen) {
          ctx.fillStyle = '#0e7490';
        }
        if (e.shape === 'circle') {
          ctx.beginPath();
          ctx.arc(e.x, e.y, e.size / 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        } else if (e.shape === 'triangle') {
          polyPath(ctx, e.x, e.y, 3, e.size / 2, Math.PI);
          ctx.fill();
          ctx.stroke();
        } else {
          polyPath(ctx, e.x, e.y, 4, e.size / 2, Math.PI / 4);
          ctx.fill();
          ctx.stroke();
        }
        // 小血条
        const bw = e.size + 8;
        ctx.fillStyle = 'rgba(15,23,42,0.8)';
        ctx.fillRect(e.x - bw / 2, e.y - e.size / 2 - 8, bw, 4);
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(e.x - bw / 2, e.y - e.size / 2 - 8, bw * (e.hp / e.maxHp), 4);
        ctx.restore();
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
        ctx.font = 'bold 16px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(f.text, f.x, f.y);
      }
      ctx.globalAlpha = 1;

      // 受击红闪
      if (s.flash > 0) {
        ctx.fillStyle = `rgba(239,68,68,${0.22 * s.flash})`;
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
    <div ref={boxRef} className="h-full w-full overflow-hidden">
      <canvas ref={canvasRef} className="block" />
    </div>
  );
}

export const BattleField = forwardRef<BattleFieldHandle, Props>(BattleFieldInner);