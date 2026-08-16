// 语音服务抽象：听写模式的可靠性底座
// 接口 listVoices/speak/stop；默认实现 Web Speech API，可替换为 Edge-TTS 等
export interface TtsProvider {
  readonly name: string;
  isAvailable(): boolean;
  listVoices(): SpeechSynthesisVoice[];
  speak(text: string, opts?: { rate?: number; onEnd?: () => void }): void;
  stop(): void;
}

// 发音人选择持久化（设置页写入，speak 时按此挑选）
const VOICE_STORAGE_KEY = 'wj-tts-voice-id';

export function getSelectedVoiceId(): string | null {
  try {
    return localStorage.getItem(VOICE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setSelectedVoiceId(id: string | null): void {
  try {
    if (id) localStorage.setItem(VOICE_STORAGE_KEY, id);
    else localStorage.removeItem(VOICE_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

// 设置页：可用英文发音人列表
export function listEnglishVoices(): SpeechSynthesisVoice[] {
  const tts = getTts();
  if (!tts.isAvailable()) return [];
  return tts
    .listVoices()
    .filter((v) => v.lang?.toLowerCase().startsWith('en'))
    .sort((a, b) => a.name.localeCompare(b.name));
}

class WebSpeechTts implements TtsProvider {
  readonly name = 'web-speech';

  isAvailable(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  }

  listVoices(): SpeechSynthesisVoice[] {
    if (!this.isAvailable()) return [];
    return window.speechSynthesis.getVoices() ?? [];
  }

  speak(text: string, opts?: { rate?: number; onEnd?: () => void }): void {
    if (!this.isAvailable()) {
      opts?.onEnd?.();
      return;
    }
    const synth = window.speechSynthesis;
    synth.cancel(); // 连点防抖：先停再播
    const u = new SpeechSynthesisUtterance(text);
    const voice = this.pickEnglishVoice();
    if (voice) u.voice = voice;
    u.rate = opts?.rate ?? 0.9;
    u.lang = voice?.lang ?? 'en-US';
    if (opts?.onEnd) {
      u.onend = () => opts.onEnd?.();
      u.onerror = () => opts.onEnd?.();
    }
    synth.speak(u);
  }

  stop(): void {
    if (this.isAvailable()) window.speechSynthesis.cancel();
  }

  private pickEnglishVoice(): SpeechSynthesisVoice | null {
    const voices = this.listVoices();
    if (voices.length === 0) return null;
    // 1) 用户手动指定的发音人
    const selected = getSelectedVoiceId();
    if (selected) {
      const v = voices.find((x) => x.voiceURI === selected || x.name === selected);
      if (v) return v;
    }
    // 2) 默认偏好：优先清晰女声，避免移动端默认命中的低沉男声（如 en-GB Daniel / Google UK English Male）
    const preferredNames = [
      'Samantha', // iOS en-US 女声
      'Aria', // Edge (Natural) 女声
      'Zira', // Windows 女声
      'Google US English',
      'Google UK English Female',
      'Karen', // iOS en-AU 女声
      'Google English',
      'Microsoft Aria Online (Natural)',
      'Microsoft Zira - English (United States)',
      'Microsoft Jenny Online (Natural)',
    ];
    for (const name of preferredNames) {
      const v = voices.find((x) => x.name === name);
      if (v) return v;
    }
    // 3) 兜底：en-US 优先于 en-GB（en-GB 常常是男声）
    const enUS = voices.find((v) => v.lang?.toLowerCase().startsWith('en-US'));
    if (enUS) return enUS;
    return voices.find((v) => v.lang?.toLowerCase().startsWith('en')) ?? null;
  }
}

// 单例：整个应用共享一个 TTS 实例，避免多次实例化互相干扰
let instance: WebSpeechTts | null = null;
export function getTts(): TtsProvider {
  if (!instance) instance = new WebSpeechTts();
  return instance;
}

export interface VoiceAvailability {
  // null = 语音列表仍在异步加载，尚未确定
  usable: boolean | null;
  reason?: string; // 不可用原因（浏览器不支持 / 无英文语音）
}

// 语音可用性探测：登录/选模式前检测，缺失时禁用听写入口
export function checkVoiceAvailability(): VoiceAvailability {
  const tts = getTts();
  if (!tts.isAvailable()) return { usable: false, reason: '当前浏览器不支持语音合成' };
  const hasEnglish = tts.listVoices().some((v) => v.lang.toLowerCase().startsWith('en'));
  if (hasEnglish) return { usable: true };
  // 列表为空 = Chrome 首次调用尚未异步加载 voices，交给 ensureVoiceAvailable 收敛
  return tts.listVoices().length === 0
    ? { usable: null }
    : { usable: false, reason: '未检测到可用的英文语音，听写模式不可用' };
}

// 异步收敛：等待 voices 加载完成（onvoiceschanged / 超时兜底），返回是否可用英文语音
export async function ensureVoiceAvailable(timeoutMs = 2000): Promise<boolean> {
  const tts = getTts();
  if (!tts.isAvailable()) return false;
  const hasEnglish = (): boolean =>
    tts.listVoices().some((v) => v.lang.toLowerCase().startsWith('en'));
  if (hasEnglish()) return true;
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    let resolved = false;
    const done = (ok: boolean): void => {
      if (resolved) return;
      resolved = true;
      synth.onvoiceschanged = null;
      clearTimeout(tid);
      resolve(ok);
    };
    synth.onvoiceschanged = () => done(hasEnglish());
    const tid = setTimeout(() => done(hasEnglish()), timeoutMs);
  });
}