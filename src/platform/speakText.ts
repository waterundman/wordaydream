/**
 * speakText — 双路径 TTS 分发 utility (v1.2.0 Stage 2 词汇点读; v1.3.0 Stage 1 收口)
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
 * v1.3.0 Stage 1 收口 (词汇点读收口 — 取消/去重/清理):
 * 旧版为 fire-and-forget, 存在三处行为缺口: ① 面板卸载后朗读仍在继续
 * ② 连点不同词会叠加/行为未定义 ③ 没有停止手段. 本版新增:
 *
 * - speakText 升级为 cancel-then-speak: 每次调用先取消"仅词级归属"的进行中朗读,
 *   再发起新朗读 → 同词连点自然"重播", 不同词连点自然"替换".
 * - 新增 stopSpeechText(): 取消由词级 (本模块) 发起的进行中朗读.
 * - 归属权隔离 (核心设计): Web 路径归属锚定在 speechSynthesis 模块的
 *   currentInitiator 标记 (speak 时打标 'word', 队列自然播空/stop/新 speak 时清除),
 *   stopSpeechText / cancel-then-speak 经 stopWebSpeechSynthesisIfOwnedBy('word')
 *   仅取消词级发起的朗读 → 面板卸载/切换不会误杀页级朗读, 且无 stale 标志问题
 *   (词级朗读自然结束后标记已清, 后续页级朗读不受面板卸载影响).
 *   鸿蒙原生路径不经过该标记, 用本模块 wordNativeOwnsSpeech + promise settle 释放
 *   (残余边界: 原生侧词级朗读进行中→页级原生朗读插队→面板卸载, 设备侧行为依赖
 *   bridge 实现, 已在 JSDoc 如实标注).
 * - 既有导出签名向后兼容 (speakText / supportsSpeechText 签名不变).
 */
import { detectPlatform } from './detect';
import {
  speakViaWebSpeechSynthesis,
  stopWebSpeechSynthesisIfOwnedBy,
} from './speechSynthesis';
import type { SpeechInitiator } from './speechSynthesis';
import type { SpeakPayload } from './harmonyBridge';
import type { Language } from '../types';

/** 词级朗读默认语速, 沿页级 DEFAULT_RATE (1.0). */
const DEFAULT_RATE: SpeakPayload['rate'] = 1.0;

/** 词级朗读固定发起方标记 (归属权隔离, 见 speechSynthesis.SpeechInitiator). */
const WORD_INITIATOR: SpeechInitiator = 'word';

/**
 * 鸿蒙原生朗读归属: 是否有由词级 (speakText) 发起、且仍可能在进行中的原生朗读.
 * 仅词级发起时才在 stopSpeechText 内调 bridge.stopSpeech(), 不触碰页级原生朗读.
 */
let wordNativeOwnsSpeech = false;

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
 * 取消由词级 (speakText) 发起的进行中朗读 — 词汇点读收口核心 API.
 *
 * 归属权隔离: 仅当最近一次朗读由词级 (本模块) 发起时才真正取消,
 * 避免面板卸载 / token 切换时误杀页级朗读
 * (页级由 ReadingSessionPage 直接调用 speakViaWebSpeechSynthesis, 不经过本模块,
 *  不会设置 webSpeechOwner / wordNativeOwnsSpeech).
 *
 * - 鸿蒙原生路径: 仅当 wordNativeOwnsSpeech 时调 bridge.stopSpeech() (try 静默兜底).
 * - Web 路径: 仅当朗读队列归属为词级 (currentInitiator==='word') 时经
 *   stopWebSpeechSynthesisIfOwnedBy 取消; 页级朗读 (other) 与已自然结束 (null) 均不触碰.
 * - 双能力缺失 / 无词级归属: 静默 no-op.
 *
 * 注意: 本函数只取消"词级归属"的朗读; 显式点按"朗读按钮"触发的新朗读由 speakText
 * 内部的 cancel-then-speak 负责去重, 不依赖本函数.
 */
export function stopSpeechText(): void {
  const cap = detectPlatform();
  const bridge = cap.getNativeBridge();

  if (bridge) {
    // 鸿蒙原生路径: 仅词级发起才停止, 不触碰页级原生朗读.
    if (wordNativeOwnsSpeech) {
      wordNativeOwnsSpeech = false;
      try {
        bridge.stopSpeech();
      } catch {
        // fire-and-forget: stopSpeech 异常静默跳过
      }
    }
    return;
  }

  if (cap.supportsSpeechSynthesis()) {
    // Web 路径: 仅词级归属才停止 (currentInitiator 锚定, 无 stale 标志),
    // 避免误杀页级朗读 / 已自然结束的朗读.
    stopWebSpeechSynthesisIfOwnedBy(WORD_INITIATOR);
  }
  // 双能力缺失 / 无词级归属: 静默 no-op
}

/**
 * 朗读一段文本 (cancel-then-speak, 词级归属去重).
 *
 * - 鸿蒙端: bridge.speak 优先, 异常静默兜底 (不向上传播)
 * - Web 端: speakViaWebSpeechSynthesis fallback
 * - 双能力缺失: 静默 no-op
 * - 空白文本: 静默 no-op (避免空 utterance)
 *
 * 取消语义 (cancel-then-speak): 每次调用先取消"仅词级归属"的进行中朗读,
 * 再发起新朗读 — 同词连点自然重播, 不同词连点自然替换. 取消范围受归属权约束:
 * 仅当上一条朗读由词级发起时才取消, 绝不误杀页级朗读.
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
    // cancel-then-speak: 仅词级归属时先停上一条原生朗读, 避免叠加.
    if (wordNativeOwnsSpeech) {
      try {
        bridge.stopSpeech();
      } catch {
        // 静默跳过
      }
    }
    wordNativeOwnsSpeech = true;
    try {
      void bridge.speak(payload).then(
        () => {
          // 原生朗读自然结束时释放归属 (避免 stale 标志误伤后续页级朗读).
          wordNativeOwnsSpeech = false;
        },
        () => {
          wordNativeOwnsSpeech = false;
        },
      );
    } catch {
      wordNativeOwnsSpeech = false;
    }
    return;
  }

  if (cap.supportsSpeechSynthesis()) {
    // cancel-then-speak: 仅当当前朗读为词级归属时才先取消
    // (页级朗读 other / 已自然结束 null 均不触碰 — 无 stale 标志误杀),
    // 再以 'word' 发起方打标发起新朗读.
    // 注: speakViaWebSpeechSynthesis 内部无条件清队列是既有契约 (沿 v1.2.0),
    // 页级朗读进行中点击词级点读会替换全局队列 — 该交错行为与 v1.2.0 一致, 不在本版收口范围.
    stopWebSpeechSynthesisIfOwnedBy(WORD_INITIATOR);
    speakViaWebSpeechSynthesis(payload, WORD_INITIATOR);
  }
  // 双能力缺失: 静默 no-op
}

/**
 * 重置模块级归属权状态 (test-only). 单测在用例间调用, 隔离 wordNativeOwnsSpeech,
 * 避免用例间污染. Web 路径归属在 speechSynthesis.currentInitiator (由
 * _resetSpeechSynthesisCache 重置). 非测试代码不得调用.
 */
export function _resetSpeechTextState(): void {
  wordNativeOwnsSpeech = false;
}
