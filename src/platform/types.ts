/**
 * PlatformCapability (v0.1.0-harmony Stage 2)
 *
 * 抽象宿主环境能力, 让 Web 端能检测鸿蒙 ArkWeb 并对 unsupported API
 * 优雅降级 (隐藏 InstallPromptButton / 禁用朗读按钮 / 跳过 SW 注册).
 *
 * 实现见 detect.ts, 单例缓存.
 */
import type { HarmonyBridge } from './harmonyBridge';

/**
 * 平台能力探测接口.
 *
 * 所有方法返回纯布尔值 / 引用, 0 副作用, 可在渲染期安全调用.
 * 鸿蒙端由 detectPlatform 通过 navigator.userAgent ('ArkWeb') +
 * window.harmonyBridge 存在性判定.
 */
export interface PlatformCapability {
  /** 是否运行在鸿蒙 ArkWeb 容器内. */
  isHarmonyOS(): boolean;
  /** 是否支持 Service Worker 注册 (鸿蒙 ArkWeb rawfile 上下文不支持). */
  supportsServiceWorker(): boolean;
  /**
   * 是否支持 TTS 朗读 (v0.3.0-harmony Stage 2 改造).
   *
   * - 鸿蒙端: 返回 true (由 harmonyBridge.speak 兜底)
   * - 非鸿蒙端: 检测 'speechSynthesis' in window
   */
  supportsSpeechSynthesis(): boolean;
  /**
   * 是否支持原生 TTS (v0.3.0-harmony Stage 2 新增).
   *
   * 仅鸿蒙端有原生 TTS (harmonyBridge.speak 走 @ohos.textToSpeech Kit).
   * 非鸿蒙端返回 false (使用 Web SpeechSynthesis fallback).
   */
  supportsNativeSpeech(): boolean;
  /** 是否支持 PWA beforeinstallprompt / install (ArkWeb 不支持). */
  supportsInstallPrompt(): boolean;
  /** 是否支持原生推送通知 (鸿蒙端支持 notificationManager, Web 端不支持). */
  supportsNotifications(): boolean;
  /** 获取 ArkTS 注入的原生 bridge; Web 端返回 null. */
  getNativeBridge(): HarmonyBridge | null;
}
