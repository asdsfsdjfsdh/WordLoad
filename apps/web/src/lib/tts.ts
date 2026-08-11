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
  usable: boolean;
  reason?: string; // 不可用原因（浏览器不支持 / 无英文语音）
}

// 语音可用性探测：登录/选模式前检测，缺失时禁用听写入口
export function checkVoiceAvailability(): VoiceAvailability {
  const tts = getTts();
  if (!tts.isAvailable()) return { usable: false, reason: '当前浏览器不支持语音合成' };
  // SpeechSynthesis.getVoices 早期可能为空，触发一次加载回调
  if (tts.listVoices().length === 0) {
    // 兼容：高分 Chrome 首次调用返回空，等 voiceschanged 后再判定
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
    if (synth) {
      synth.onvoiceschanged = () => undefined;
    }
  }
  return { usable: true };
}