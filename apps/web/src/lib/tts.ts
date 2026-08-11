// 语音服务抽象：听写模式的可靠性底座
// 接口 listVoices/speak/stop；默认实现 Web Speech API，可替换为 Edge-TTS 等
export interface TtsProvider {
  readonly name: string;
  isAvailable(): boolean;
  listVoices(): SpeechSynthesisVoice[];
  speak(text: string, opts?: { rate?: number; onEnd?: () => void }): void;
  stop(): void;
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
    const preferred = [
      voices.find((v) => v.lang.startsWith('en-GB')),
      voices.find((v) => v.lang.startsWith('en-US')),
    ];
    return preferred.find(Boolean) ?? null;
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
    const done = (ok: boolean): void => {
      synth.onvoiceschanged = null;
      resolve(ok);
    };
    synth.onvoiceschanged = () => done(hasEnglish());
    setTimeout(() => done(hasEnglish()), timeoutMs);
  });
}