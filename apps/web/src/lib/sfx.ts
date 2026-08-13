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

// 连击音效：×3/×5/×7 音阶递增
export function playComboSound(combo: number): void {
  if (combo >= 7) {
    [523, 659, 784, 880, 1047, 1319, 1568].forEach((f, i) =>
      setTimeout(() => blip(f, 0.08, 0.06, 'triangle'), i * 50),
    );
    setTimeout(() => blip(80, 0.2, 0.06, 'sine'), 350);
  } else if (combo >= 5) {
    [523, 659, 784, 880, 1047].forEach((f, i) =>
      setTimeout(() => blip(f, 0.08, 0.06, 'triangle'), i * 50),
    );
  } else if (combo >= 3) {
    [523, 659, 784].forEach((f, i) =>
      setTimeout(() => blip(f, 0.08, 0.07, 'triangle'), i * 60),
    );
  }
}

// 斩落音效：高频到低频快速下滑（"唰"一声，标记已掌握）
export function playSkipSound(): void {
  const c = ensureCtx();
  if (!c) return;
  try {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(1400, c.currentTime);
    osc.frequency.exponentialRampToValueAtTime(220, c.currentTime + 0.16);
    gain.gain.setValueAtTime(0.06, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.18);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start();
    osc.stop(c.currentTime + 0.2);
    // 尾音：低八度短促收束
    setTimeout(() => blip(160, 0.1, 0.05, 'sine'), 40);
  } catch {
    /* 忽略音频异常 */
  }
}

// ---- 战斗环节音效 ----

// 攻击发射：短促上滑（轻微，避免盖过判定音）
export function playAttackSound(): void {
  blip(680 + Math.random() * 60, 0.07, 0.04, 'sawtooth');
}

// 弹丸命中：清脆"嗒"
export function playHitSound(): void {
  blip(340 + Math.random() * 90, 0.05, 0.05, 'square');
}

// 击杀：下行两连音
export function playKillSound(): void {
  blip(520, 0.06, 0.06, 'square');
  setTimeout(() => blip(250, 0.09, 0.06, 'square'), 55);
}

// 我方受击：低频闷击
export function playHurtSound(): void {
  blip(140, 0.16, 0.1, 'sawtooth');
  setTimeout(() => blip(90, 0.14, 0.08, 'sine'), 20);
}

// 技能释放：上滑三连
export function playSkillSound(): void {
  blip(200, 0.18, 0.07, 'sawtooth');
  setTimeout(() => blip(900, 0.16, 0.07, 'square'), 60);
  setTimeout(() => blip(1400, 0.12, 0.05, 'square'), 120);
}

// Boss 登场：低沉咆哮
export function playBossAppearSound(): void {
  blip(110, 0.4, 0.12, 'sawtooth');
  setTimeout(() => blip(80, 0.5, 0.1, 'sawtooth'), 90);
}

// Boss 击破：上行凯旋琶音
export function playBossDefeatSound(): void {
  [392, 523, 659, 784, 1047].forEach((f, i) =>
    setTimeout(() => blip(f, 0.12, 0.08, 'triangle'), i * 90),
  );
  setTimeout(() => blip(1568, 0.3, 0.09, 'triangle'), 460);
}

// Boss P2 暴怒：急促三连低吼
export function playP2RageSound(): void {
  blip(220, 0.1, 0.09, 'sawtooth');
  setTimeout(() => blip(180, 0.1, 0.09, 'sawtooth'), 90);
  setTimeout(() => blip(240, 0.14, 0.09, 'sawtooth'), 180);
}

// 膨胀重写冻结 / 解冻
export function playFreezeSound(): void {
  blip(1500, 0.12, 0.05, 'sine');
  setTimeout(() => blip(900, 0.16, 0.05, 'sine'), 60);
}
export function playUnfreezeSound(): void {
  blip(600, 0.08, 0.05, 'sine');
  setTimeout(() => blip(1000, 0.12, 0.05, 'sine'), 50);
}