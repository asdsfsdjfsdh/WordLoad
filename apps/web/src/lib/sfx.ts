// 按键/判定音效：Web Audio 程序化合成（无需音频资源）
// AudioContext 需用户手势激活；键盘输入本身即手势，满足要求
let ctx: AudioContext | null = null;

function ensureCtx(): AudioContext | null {
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

// 单个短音
function blip(freq: number, dur: number, volume = 0.08, type: OscillatorType = 'square'): void {
  const c = ensureCtx();
  if (!c) return;
  try {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start();
    osc.stop(c.currentTime + dur);
  } catch {
    /* 忽略音频异常 */
  }
}

// 每次输入字母的"咔哒"音
export function playKeySound(): void {
  blip(620 + Math.random() * 60, 0.05, 0.05);
}

// 判定正确：上行短音
export function playCorrectSound(): void {
  blip(880, 0.1, 0.09);
  setTimeout(() => blip(1320, 0.14, 0.09), 70);
}

// 判定错误：低闷音
export function playWrongSound(): void {
  blip(180, 0.18, 0.1, 'sawtooth');
}

// 语音播放前的滴声（提示即将朗读）
export function playTickSound(): void {
  blip(1000, 0.04, 0.04);
}