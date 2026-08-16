// 按键/判定音效：Web Audio 程序化合成（无需音频资源）
// AudioContext 需用户手势激活；键盘输入本身即手势，满足要求
let ctx: AudioContext | null = null;

// 排队音效定时器：统一登记，允许战斗结束/卸载时 flush，避免残留短音在切页后继续播放
const timers = new Set<ReturnType<typeof setTimeout>>();

export function schedule(fn: () => void, ms: number): void {
  const id = setTimeout(() => {
    timers.delete(id);
    fn();
  }, ms);
  timers.add(id);
}

// 清空所有排队音效（战斗卸载时调用）
export function flushSfx(): void {
  for (const id of timers) clearTimeout(id);
  timers.clear();
}

export function ensureCtx(): AudioContext | null {
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
  schedule(() => blip(1320, 0.14, 0.09), 70);
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
      schedule(() => blip(f, 0.08, 0.06, 'triangle'), i * 50),
    );
    schedule(() => blip(80, 0.2, 0.06, 'sine'), 350);
  } else if (combo >= 5) {
    [523, 659, 784, 880, 1047].forEach((f, i) =>
      schedule(() => blip(f, 0.08, 0.06, 'triangle'), i * 50),
    );
  } else if (combo >= 3) {
    [523, 659, 784].forEach((f, i) =>
      schedule(() => blip(f, 0.08, 0.07, 'triangle'), i * 60),
    );
  }
}

// 基础连击轻反馈：combo 1/2 的短促变调（比判定音略亮、随连击微升），给"持续有感"的地基
export function playComboTick(combo: number): void {
  const f = combo === 2 ? 760 : 660;
  blip(f, 0.045, 0.035, 'triangle');
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
    schedule(() => blip(160, 0.1, 0.05, 'sine'), 40);
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
  schedule(() => blip(250, 0.09, 0.06, 'square'), 55);
}

// 我方受击：低频闷击
export function playHurtSound(): void {
  blip(140, 0.16, 0.1, 'sawtooth');
  schedule(() => blip(90, 0.14, 0.08, 'sine'), 20);
}

// 技能释放：上滑三连
export function playSkillSound(): void {
  blip(200, 0.18, 0.07, 'sawtooth');
  schedule(() => blip(900, 0.16, 0.07, 'square'), 60);
  schedule(() => blip(1400, 0.12, 0.05, 'square'), 120);
}

// Boss 登场：低沉咆哮
export function playBossAppearSound(): void {
  blip(110, 0.4, 0.12, 'sawtooth');
  schedule(() => blip(80, 0.5, 0.1, 'sawtooth'), 90);
}

// Boss 击破：上行凯旋琶音
export function playBossDefeatSound(): void {
  [392, 523, 659, 784, 1047].forEach((f, i) =>
    schedule(() => blip(f, 0.12, 0.08, 'triangle'), i * 90),
  );
  schedule(() => blip(1568, 0.3, 0.09, 'triangle'), 460);
}

// Boss P2 暴怒：急促三连低吼
export function playP2RageSound(): void {
  blip(220, 0.1, 0.09, 'sawtooth');
  schedule(() => blip(180, 0.1, 0.09, 'sawtooth'), 90);
  schedule(() => blip(240, 0.14, 0.09, 'sawtooth'), 180);
}

// 膨胀重写冻结 / 解冻
export function playFreezeSound(): void {
  blip(1500, 0.12, 0.05, 'sine');
  schedule(() => blip(900, 0.16, 0.05, 'sine'), 60);
}
export function playUnfreezeSound(): void {
  blip(600, 0.08, 0.05, 'sine');
  schedule(() => blip(1000, 0.12, 0.05, 'sine'), 50);
}