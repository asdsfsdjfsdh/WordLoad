// 自适应战斗 BGM：随连击 / 答题节奏 / 危险度 / 首领波连续调制的程序化背景音乐
// 零音频资源（Web Audio 合成），复用 sfx.ts 的 AudioContext 与排队调度器。
// 设计：单一「能量/紧张度」标量驱动四层（低音 drone / 打击 / 琶音 / 事件 accent），
// 连击里程碑触发 accent、答错触发滤波骤降"断拍"、Boss 击破短暂凯旋 boost。
import { ensureCtx, schedule } from './sfx';

export type BgmMode = 'calm' | 'tense' | 'triumph';

export interface BgmParamsInput {
  combo: number;
  danger: number; // 0..1（HP 越低越高）
  pace: number;   // 0.5..2：1 = 平均 3s 一题，越大答得越快
  boss: boolean;
}

export interface BgmParams {
  tempo: number; // BPM
  intensity: number; // 0..1
  mode: BgmMode;
}

// 状态 → 参数的纯映射（可单测）：
// 连击每 10 连封顶（comboFactor=1），节奏因子与"平均 3s 一题"比，
// tempo 基线 90，随连击/节奏升档至 160；intensity 基线 0.35 随危险度/连击/节奏叠升。
export function bgmParams({ combo, danger, pace, boss }: BgmParamsInput): BgmParams {
  const comboFactor = Math.min(1, Math.max(0, combo) / 10);
  const paceFactor = Math.min(2, Math.max(0.5, pace));
  const tempo = Math.min(160, Math.max(80, 90 + 35 * comboFactor + 25 * paceFactor));
  const intensity = Math.min(1, Math.max(0, 0.35 + 0.35 * danger + 0.3 * comboFactor + 0.2 * (paceFactor - 1)));
  let mode: BgmMode = 'calm';
  if (combo >= 10) mode = 'triumph';
  else if (boss || intensity >= 0.55) mode = 'tense';
  return { tempo, intensity, mode };
}

// 各模式 pad 三和弦（A3 起）：平静 A 小调 / 紧张 G 小调 / 凯旋 A 大调
const CHORDS: Record<BgmMode, number[]> = {
  calm: [220, 261.63, 329.63],
  tense: [196, 233.08, 293.66],
  triumph: [220, 277.18, 329.63],
};

// A 小调五声音阶（琶音序列）
const PENT = [220, 261.63, 293.66, 329.63, 392];

// 连击里程碑（accent 触发点）
const COMBO_MILESTONES = new Set([3, 5, 7, 10]);

const MASTER_VOL = 0.14;
const SCHEDULE_AHEAD = 0.15; // s，提前排程窗口
const LOOKAHEAD_MS = 50; // 调度器轮询间隔

function noiseBuffer(c: AudioContext): AudioBuffer {
  const len = Math.floor(c.sampleRate * 0.2);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

class BattleBgm {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;

  private droneOscs: OscillatorNode[] = [];
  private droneFilter: BiquadFilterNode | null = null;
  private droneGain: GainNode | null = null;
  private padOscs: OscillatorNode[] = [];
  private padFilter: BiquadFilterNode | null = null;
  private padGain: GainNode | null = null;

  private schedulerId: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private enabled = true;

  private params: BgmParams = { tempo: 90, intensity: 0.45, mode: 'calm' };
  private currentMode: BgmMode = 'calm';
  private danger = 0;
  private boss = false;
  private combo = 0;
  private pace = 1;

  private nextBeatTime = 0;
  private beatIndex = 0;

  private intervals: number[] = [];
  private triumphBoost = 0;
  private dipUntil = 0;
  private dipFactor = 1;

  // ── 生命周期 ──

  start(): void {
    const c = ensureCtx();
    if (!c || this.running) return;
    this.ctx = c;
    this.enabled = this.readEnabled();
    this.createLayers();
    this.running = true;
    this.recompute();
    this.nextBeatTime = c.currentTime + 0.1;
    this.beatIndex = 0;
    this.dipFactor = 1;
    this.dipUntil = 0;
    this.triumphBoost = 0;
    this.intervals = [];
    this.loop();
    this.schedulerId = setInterval(this.loop, LOOKAHEAD_MS);
  }

  stop(): void {
    if (this.schedulerId !== null) {
      clearInterval(this.schedulerId);
      this.schedulerId = null;
    }
    const c = this.ctx;
    if (!c) {
      this.running = false;
      return;
    }
    const t = c.currentTime;
    try {
      this.master?.gain.setTargetAtTime(0, t, 0.2);
    } catch {
      /* 忽略音频异常 */
    }
    for (const o of [...this.droneOscs, ...this.padOscs]) {
      try {
        o.stop(t + 0.6);
      } catch {
        /* 忽略音频异常 */
      }
    }
    schedule(() => {
      try {
        this.master?.disconnect();
      } catch {
        /* 忽略音频异常 */
      }
      this.master = null;
      this.droneGain = null;
      this.droneFilter = null;
      this.padGain = null;
      this.padFilter = null;
      this.noiseBuf = null;
      this.droneOscs = [];
      this.padOscs = [];
    }, 700);
    this.ctx = null;
    this.running = false;
  }

  // ── 信号输入 ──

  setDanger(level: number): void {
    this.danger = Math.max(0, Math.min(1, level));
    this.recompute();
    this.applyParams(this.ctx?.currentTime ?? 0);
  }

  setBoss(boss: boolean): void {
    this.boss = boss;
    this.recompute();
    this.applyParams(this.ctx?.currentTime ?? 0);
  }

  note(n: { correct: boolean; combo: number; intervalMs: number }): void {
    if (!this.running) return;
    this.combo = n.combo;
    if (n.intervalMs > 0 && n.intervalMs < 60000) {
      this.intervals.push(n.intervalMs);
      if (this.intervals.length > 3) this.intervals.shift();
    }
    const avg = this.intervals.length
      ? this.intervals.reduce((a, b) => a + b, 0) / this.intervals.length
      : 3000;
    this.pace = Math.min(2, Math.max(0.5, 3000 / avg));
    if (n.correct && COMBO_MILESTONES.has(n.combo)) this.accentRise();
    if (!n.correct) {
      // 答错：滤波骤降"断拍"，随后由调度器渐回
      this.dipUntil = (this.ctx?.currentTime ?? 0) + 0.7;
      this.dipFactor = 0.5;
    }
    this.recompute();
  }

  // Boss 击破 / 结算欢呼：短暂凯旋 boost（一次性的和声亮度提升）
  celebrate(): void {
    if (!this.running) return;
    this.triumphBoost = 0.25;
    const c = this.ctx;
    if (c) {
      const t = c.currentTime;
      [523, 659, 784, 1047].forEach((f, i) => this.arpNote(t + i * 0.09, f, 0.07, 0.25));
    }
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    try {
      localStorage.setItem('bgm-enabled', on ? '1' : '0');
    } catch {
      /* 忽略存储异常 */
    }
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(on ? MASTER_VOL : 0, this.ctx.currentTime, 0.1);
    }
  }

  // ── 内部 ──

  private readEnabled(): boolean {
    try {
      return localStorage.getItem('bgm-enabled') !== '0';
    } catch {
      return true;
    }
  }

  private createLayers(): void {
    const c = this.ctx!;
    const master = c.createGain();
    master.gain.value = 0;
    master.connect(c.destination);
    this.master = master;
    this.noiseBuf = noiseBuffer(c);

    // 低音 drone（A1/E2，失谐锯齿 → 低通）—— 延续原危险 drone 的手感
    const dFilter = c.createBiquadFilter();
    dFilter.type = 'lowpass';
    dFilter.frequency.value = 200;
    dFilter.Q.value = 0.6;
    const dGain = c.createGain();
    dGain.gain.value = 0;
    dFilter.connect(dGain);
    dGain.connect(master);
    this.droneFilter = dFilter;
    this.droneGain = dGain;
    this.droneOscs = [55, 82.4].map((f) => {
      const osc = c.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = f;
      osc.detune.value = (Math.random() - 0.5) * 8;
      osc.connect(dFilter);
      osc.start();
      return osc;
    });

    // pad（模式三和弦，锯齿 → 低通，LFO 呼吸感由滤波缓变承担）
    const pFilter = c.createBiquadFilter();
    pFilter.type = 'lowpass';
    pFilter.frequency.value = 600;
    pFilter.Q.value = 0.5;
    const pGain = c.createGain();
    pGain.gain.value = 0;
    pFilter.connect(pGain);
    pGain.connect(master);
    this.padFilter = pFilter;
    this.padGain = pGain;
    this.padOscs = CHORDS.calm.map((f) => {
      const osc = c.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = f;
      osc.connect(pFilter);
      osc.start();
      return osc;
    });
  }

  private recompute(): void {
    this.params = bgmParams({ combo: this.combo, danger: this.danger, pace: this.pace, boss: this.boss });
  }

  private applyParams(now: number): void {
    if (!this.ctx || !this.master) return;
    const p = this.params;
    const intensity = Math.min(1, p.intensity + this.triumphBoost);
    const dip = now < this.dipUntil ? this.dipFactor : 1;
    try {
      this.master.gain.setTargetAtTime(this.enabled ? MASTER_VOL : 0, now, 0.15);
      this.droneGain?.gain.setTargetAtTime(0.03 + intensity * 0.05, now, 0.5);
      this.droneFilter?.frequency.setTargetAtTime((160 + intensity * 900) * dip, now, 0.5);
      this.padGain?.gain.setTargetAtTime(0.02 + intensity * 0.05, now, 0.6);
      this.padFilter?.frequency.setTargetAtTime((400 + intensity * 1600) * dip, now, 0.7);
    } catch {
      /* 忽略音频异常 */
    }
    if (this.currentMode !== p.mode) {
      this.currentMode = p.mode;
      const chord = CHORDS[p.mode];
      this.padOscs.forEach((osc, i) => {
        if (chord[i]) {
          try {
            osc.frequency.setTargetAtTime(chord[i], now, 0.4);
          } catch {
            /* 忽略音频异常 */
          }
        }
      });
    }
  }

  private loop = (): void => {
    const c = this.ctx;
    if (!c) return;
    const now = c.currentTime;
    this.triumphBoost = Math.max(0, this.triumphBoost - 0.03);
    if (now >= this.dipUntil) this.dipFactor = Math.min(1, this.dipFactor + 0.05);
    this.applyParams(now);
    while (this.nextBeatTime < now + SCHEDULE_AHEAD) {
      this.scheduleBeat(this.beatIndex++, this.nextBeatTime);
      this.nextBeatTime += 60 / this.params.tempo;
    }
  };

  private scheduleBeat(beat: number, time: number): void {
    const p = this.params;
    const intensity = Math.min(1, p.intensity + this.triumphBoost);
    const kickEvery = intensity < 0.5 ? 2 : 1;
    if (beat % kickEvery === 0) this.kick(time, 0.3 + intensity * 0.12);
    if (intensity >= 0.5 && beat % 2 === 1) this.hat(time, 0.04 + intensity * 0.03);
    if (intensity >= 0.8) this.hat(time + 60 / p.tempo / 2, 0.035);
    // 琶音：低强度每 2 拍、中高强度每拍、高强度 8 分
    const arpEvery = intensity >= 0.55 ? 1 : 2;
    if (beat % arpEvery === 0) {
      const step = Math.floor(beat / arpEvery);
      const idx = ((step % PENT.length) + PENT.length) % PENT.length;
      const oct = intensity >= 0.85 ? 2 : intensity >= 0.55 ? 1 : 0;
      this.arpNote(time, (PENT[idx] ?? 220) * Math.pow(2, oct), 0.028 + intensity * 0.02, 0.22);
    }
  }

  // ── 单音合成 ──

  private kick(at: number, vol: number): void {
    const c = this.ctx;
    if (!c || !this.master) return;
    try {
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(150, at);
      osc.frequency.exponentialRampToValueAtTime(42, at + 0.14);
      g.gain.setValueAtTime(vol, at);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.18);
      osc.connect(g);
      g.connect(this.master);
      osc.start(at);
      osc.stop(at + 0.2);
    } catch {
      /* 忽略音频异常 */
    }
  }

  private hat(at: number, vol: number): void {
    const c = this.ctx;
    if (!c || !this.master || !this.noiseBuf) return;
    try {
      const src = c.createBufferSource();
      src.buffer = this.noiseBuf;
      const hp = c.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 6500;
      const g = c.createGain();
      g.gain.setValueAtTime(vol, at);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.04);
      src.connect(hp);
      hp.connect(g);
      g.connect(this.master);
      src.start(at);
      src.stop(at + 0.06);
    } catch {
      /* 忽略音频异常 */
    }
  }

  private arpNote(at: number, freq: number, vol: number, dur: number): void {
    const c = this.ctx;
    if (!c || !this.master) return;
    try {
      const osc = c.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const g = c.createGain();
      g.gain.setValueAtTime(vol, at);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      osc.connect(g);
      g.connect(this.master);
      osc.start(at);
      osc.stop(at + dur + 0.05);
    } catch {
      /* 忽略音频异常 */
    }
  }

  // 连击里程碑：打击 accent + 上行琶音
  private accentRise(): void {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime;
    this.kick(t, 0.4);
    [392, 494, 587, 784].forEach((f, i) => this.arpNote(t + i * 0.05, f, 0.055, 0.18));
  }
}

export const battleBgm = new BattleBgm();
