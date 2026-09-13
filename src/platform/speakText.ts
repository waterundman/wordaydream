/**
 * speakText — 双路径 TTS 分发 utility (v1.2.0 Stage 2 词汇点读)
 *
 * 抽取自 ReadingSessionPage.handleTogglePlay 的双路径分发逻辑 (v0.3.0-harmony Stage 2),
 * 供阅读流内联面板 (InlineAnswerPanel) 等词级朗读场景复用:
 *
 * - 鸿蒙端优先: detectPlatform().getNativeBridge() 存在 → bridge.speak(payload)
 *   (鸿蒙 @ohos.textToSpeech 原生路径, fire-and-forget, 异常静默兜底)
 * - Web fallback: supportsSpeechSynthesis() === true → speakViaWebSpeechSynthesis(payload)
 *   (Web SpeechSynthesis API, 长文本切分/voice 选择由 speechSynthesis.ts 内部处理)
 * - 双能力缺失 → 静默 no-op (调用方应先用 supportsSpeechText() 做按钮渲染降级)
 *
 * 注意: 与页级 handleTogglePlay 不同, 词级点读无播放状态机 (isPlaying/rate selector/
 * stopSpeech 切换), 故页级逻辑保持不动, 本 utility 仅覆盖"单次触发朗读"路径.
 */
import { detectPlatform } from './detect';
import { speakViaWebSpeechSynthesis } from './speechSynthesis';
import type { SpeakPayload } from './harmonyBridge';
import type { Language } from '../types';

/** 词级朗读默认语速, 沿页级 DEFAULT_RATE (1.0). */
const DEFAULT_RATE: SpeakPayload['rate'] = 1.0;

/**
 * 将 Language ('en' | 'de') 映射为 BCP 47 标签, 沿页级 handleTogglePlay 口径.
 */
function toBcp47(language: Language): SpeakPayload['language'] {
  return language === 'de' ? 'de-DE' : 'en-US';
}

/**
 * 判断当前环境是否具备任一朗读能力 (按钮渲染降级判定).
 *
 * 与页级 ttsSupported 同一口径:
 * supportsSpeechSynthesis() || !!nativeBridge?.speak
 */
export function supportsSpeechText(): boolean {
  const cap = detectPlatform();
  return cap.supportsSpeechSynthesis() || !!cap.getNativeBridge()?.speak;
}

/**
 * 朗读一段文本 (fire-and-forget).
 *
 * - 鸿蒙端: bridge.speak 优先, 异常静默兜底 (不向上传播)
 * - Web 端: speakViaWebSpeechSynthesis fallback
 * - 双能力缺失: 静默 no-op
 * - 空白文本: 静默 no-op (避免空 utterance)
 *
 * @param text 待朗读文本 (词级朗读传 token 原文 surfaceForm)
 * @param language 语种 ('en' | 'de')
 */
export function speakText(text: string, language: Language): void {
  if (!text.trim()) return;

  const payload: SpeakPayload = {
    text,
    language: toBcp47(language),
    rate: DEFAULT_RATE,
  };

  const cap = detectPlatform();
  const bridge = cap.getNativeBridge();

  if (bridge) {
    // 鸿蒙原生路径: fire-and-forget, 异常静默兜底 (沿页级契约)
    try {
      void bridge.speak(payload);
    } catch {
      // speak 同步抛异常时静默跳过
    }
    return;
  }

  if (cap.supportsSpeechSynthesis()) {
    // Web SpeechSynthesis fallback
    speakViaWebSpeechSynthesis(payload);
  }
  // 双能力缺失: 静默 no-op
}
