/**
 * Web SpeechSynthesis 封装 (v0.3.0-harmony Stage 2)
 *
 * 作为 ArkWeb 内 fallback 路径: 当鸿蒙端 harmonyBridge.speak 不可用时,
 * Web 端使用 window.speechSynthesis 朗读.
 *
 * 设计要点:
 * - loadSpeechSynthesisVoices: 监听 onvoiceschanged + 500ms 兜底定时器 (R-TTS-4 缓解,
 *   ArkWeb 可能不触发 voiceschanged) + 模块级 voices 缓存
 * - selectVoiceByLang: lang 完全匹配 + localService=true 优先, fallback lang 前缀匹配
 * - speakViaWebSpeechSynthesis: 长文本 (>200 字符) 按句切分为多个 utterance,
 *   维护 utterance 队列, onend 后播放下一个 chunk (R-TTS-5 缓解)
 * - stopWebSpeechSynthesis: 清空队列 + window.speechSynthesis.cancel()
 *
 * 沿用 v0.2.0-harmony fire-and-forget + try/catch 兜底契约.
 */
import type { SpeakPayload } from './harmonyBridge';

/** 模块级 voices 缓存 (loadSpeechSynthesisVoices 填充). */
let voicesCache: SpeechSynthesisVoice[] | null = null;

/** 进行中的 loadSpeechSynthesisVoices Promise (避免重复绑定监听器). */
let voicesLoadPromise: Promise<SpeechSynthesisVoice[]> | null = null;

/** utterance 队列 (speakViaWebSpeechSynthesis 按句切分后入队). */
let utteranceQueue: SpeechSynthesisUtterance[] = [];

/** 当前正在播放的 utterance (playNextUtterance 取出后赋值). */
let currentUtterance: SpeechSynthesisUtterance | null = null;

/** 播放结束回调 (由调用方 setWebSpeechSynthesisEndCallback 设置). */
let onPlaybackEndCallback: (() => void) | null = null;

/** 长文本切分阈值 (R-TTS-5: chunk size 200 字符). */
const CHUNK_MAX_LENGTH = 200;

/** voiceschanged 兜底定时器延迟 (R-TTS-4: ArkWeb 可能不触发). */
const VOICES_FALLBACK_DELAY_MS = 500;

/**
 * 监听 onvoiceschanged + 缓存 voices 列表.
 *
 * 策略:
 * 1. 若缓存已存在 → 直接返回
 * 2. 立即调用 getVoices(), 非空则缓存 + 返回
 * 3. 监听 onvoiceschanged 事件
 * 4. 500ms 兜底定时器 (ArkWeb 可能不触发 voiceschanged)
 * 5. 定时器到期仍为空 → resolve 空数组 (不 reject, 沿用兜底契约)
 *
 * @returns Promise<SpeechSynthesisVoice[]> 缓存的 voices 列表 (可能为空)
 */
export function loadSpeechSynthesisVoices(): Promise<SpeechSynthesisVoice[]> {
  if (
    typeof window === 'undefined' ||
    !('speechSynthesis' in window) ||
    !window.speechSynthesis
  ) {
    return Promise.resolve([]);
  }
  if (voicesCache && voicesCache.length > 0) {
    return Promise.resolve(voicesCache);
  }
  if (voicesLoadPromise) {
    return voicesLoadPromise;
  }

  voicesLoadPromise = new Promise<SpeechSynthesisVoice[]>((resolve) => {
    const synth = window.speechSynthesis;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if ('speechSynthesis' in window && window.speechSynthesis) {
        window.speechSynthesis.onvoiceschanged = null;
      }
    };

    const settle = (voices: SpeechSynthesisVoice[]) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (voices.length > 0) {
        voicesCache = voices;
      }
      resolve(voices);
    };

    const tryGetVoices = (): boolean => {
      const voices = synth.getVoices();
      if (voices && voices.length > 0) {
        settle(voices);
        return true;
      }
      return false;
    };

    // 1. 立即尝试
    if (tryGetVoices()) return;

    // 2. 监听 voiceschanged
    synth.onvoiceschanged = () => {
      tryGetVoices();
    };

    // 3. 兜底定时器 (R-TTS-4: ArkWeb 可能不触发 voiceschanged)
    timer = setTimeout(() => {
      if (!tryGetVoices()) {
        settle([]);
      }
    }, VOICES_FALLBACK_DELAY_MS);
  });

  return voicesLoadPromise;
}

/**
 * 按 lang 选择 voice, 优先 localService=true 且 lang 完全匹配.
 *
 * 优先级:
 * 1. lang 完全匹配 + localService=true (离线 voice 优先)
 * 2. lang 完全匹配 (任意 localService)
 * 3. lang 前缀匹配 (de-DE 前缀 'de' 匹配 de-AT / de-CH 等)
 * 4. 无匹配 → null
 *
 * @param lang BCP 47 语言标签 ('de-DE' | 'en-US')
 * @returns 匹配的 voice, 无匹配返回 null
 */
export function selectVoiceByLang(lang: 'de-DE' | 'en-US'): SpeechSynthesisVoice | null {
  const voices =
    voicesCache ??
    (typeof window !== 'undefined' && 'speechSynthesis' in window
      ? window.speechSynthesis.getVoices()
      : []);
  if (!voices || voices.length === 0) return null;

  // 优先级 1: lang 完全匹配 + localService=true
  const exactLocal = voices.find((v) => v.lang === lang && v.localService);
  if (exactLocal) return exactLocal;

  // 优先级 2: lang 完全匹配 (任意 localService)
  const exact = voices.find((v) => v.lang === lang);
  if (exact) return exact;

  // 优先级 3: lang 前缀匹配 (de-DE → 'de' 前缀匹配 de-AT / de-CH)
  const langPrefix = lang.split('-')[0];
  const prefixMatch = voices.find(
    (v) => v.lang === langPrefix || v.lang.startsWith(langPrefix + '-'),
  );
  if (prefixMatch) return prefixMatch;

  return null;
}

/**
 * 通过 Web SpeechSynthesis 朗读.
 *
 * - 长文本 (>200 字符) 按句号/问号/感叹号切分为多个 utterance
 * - 维护 utterance 队列, 逐个 speak
 * - rate 映射: 0.5/1.0/1.5/2.0 直接赋值 utterance.rate
 * - lang 映射: de-DE / en-US 通过 selectVoiceByLang 选择 voice
 * - onend 后播放下一个 chunk
 * - 所有 chunk 播放完毕后调用 onPlaybackEndCallback
 *
 * @param payload TTS 载荷 (text / language / rate / voiceId?)
 */
export function speakViaWebSpeechSynthesis(payload: SpeakPayload): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

  // 清空已有队列
  stopWebSpeechSynthesis();

  const { text, language, rate } = payload;
  const chunks = splitTextIntoChunks(text);

  utteranceQueue = chunks.map((chunk) => {
    const utterance = new SpeechSynthesisUtterance(chunk);
    utterance.rate = rate;
    utterance.lang = language;
    const voice = selectVoiceByLang(language);
    if (voice) {
      utterance.voice = voice;
    }
    return utterance;
  });

  playNextUtterance();
}

/**
 * 清空队列 + window.speechSynthesis.cancel().
 *
 * 取消当前 utterance 的 onend/onerror 回调, 防止 stop 后仍触发链式播放.
 */
export function stopWebSpeechSynthesis(): void {
  utteranceQueue = [];
  if (currentUtterance) {
    currentUtterance.onend = null;
    currentUtterance.onerror = null;
    currentUtterance = null;
  }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // 兜底: cancel 在某些实现可能抛异常, 静默跳过
    }
  }
}

/**
 * 设置播放结束回调 (供 ReadingSessionPage 切换 isPlaying 状态).
 *
 * 所有 chunk 播放完毕 (含 onerror 跳过的 chunk) 后调用 onEnd.
 * 传入 null 清除回调.
 *
 * @param onEnd 所有 chunk 播放完毕回调 (null 清除)
 */
export function setWebSpeechSynthesisEndCallback(onEnd: (() => void) | null): void {
  onPlaybackEndCallback = onEnd;
}

/**
 * 播放下一个 utterance (队列驱动).
 *
 * 队列为空时调用 onPlaybackEndCallback; onerror 时跳过当前 chunk 继续下一个.
 */
function playNextUtterance(): void {
  if (utteranceQueue.length === 0) {
    currentUtterance = null;
    if (onPlaybackEndCallback) {
      onPlaybackEndCallback();
    }
    return;
  }

  currentUtterance = utteranceQueue.shift() ?? null;
  if (!currentUtterance) return;

  currentUtterance.onend = () => {
    playNextUtterance();
  };
  currentUtterance.onerror = () => {
    // 出错时跳过当前 chunk, 继续播放下一个 (不中断整体流程)
    playNextUtterance();
  };

  try {
    window.speechSynthesis.speak(currentUtterance);
  } catch {
    // speak 在某些实现可能抛异常, 触发下一个 chunk
    playNextUtterance();
  }
}

/**
 * 长文本按句切分.
 *
 * 策略:
 * - text.length <= 200 → 直接返回 [text]
 * - 按句号/问号/感叹号 + 空白切分句子
 * - 累积句子到 chunk, 不超过 200 字符
 * - 单句超过 200 字符 → 硬切分 (按 200 字符)
 *
 * @param text 待切分文本
 * @returns chunk 数组 (至少 1 个元素)
 */
function splitTextIntoChunks(text: string): string[] {
  if (text.length <= CHUNK_MAX_LENGTH) return [text];

  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let currentChunk = '';

  for (const sentence of sentences) {
    const candidate = currentChunk ? `${currentChunk} ${sentence}` : sentence;
    if (candidate.length > CHUNK_MAX_LENGTH) {
      // 当前 chunk 已有内容 → 先入队
      if (currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }
      // 单句超过 200 字符 → 硬切分
      if (sentence.length > CHUNK_MAX_LENGTH) {
        for (let i = 0; i < sentence.length; i += CHUNK_MAX_LENGTH) {
          chunks.push(sentence.slice(i, i + CHUNK_MAX_LENGTH));
        }
      } else {
        currentChunk = sentence;
      }
    } else {
      currentChunk = candidate;
    }
  }
  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }

  return chunks.length > 0 ? chunks : [text];
}

/**
 * 重置模块级缓存 (test-only). 单元测试在 mock window.speechSynthesis 后
 * 调用此函数, 使下次 loadSpeechSynthesisVoices 重新探测.
 */
export function _resetSpeechSynthesisCache(): void {
  voicesCache = null;
  voicesLoadPromise = null;
  utteranceQueue = [];
  currentUtterance = null;
  onPlaybackEndCallback = null;
}
