/**
 * detectPlatform (v0.1.0-harmony Stage 2)
 *
 * 通过 navigator.userAgent ('ArkWeb') + window.harmonyBridge 存在性
 * 检测鸿蒙环境, 返回 PlatformCapability 实例 (单例缓存).
 *
 * 检测策略:
 * - isArkWeb: navigator.userAgent 包含 'ArkWeb' (鸿蒙 ArkWeb 内核标识)
 * - hasBridge: window.harmonyBridge !== undefined (ArkTS 注入的 JS proxy)
 * - isHarmony = isArkWeb || hasBridge (OR: bridge 注入可能晚于 UA 检测,
 *   UA 覆盖早期渲染阶段; bridge 覆盖 Stage 3 注入后阶段)
 *
 * v0.3.0-harmony Stage 2 改造:
 * - supportsSpeechSynthesis: isHarmony 时返回 true (由 harmonyBridge.speak 兜底),
 *   非鸿蒙端检测 'speechSynthesis' in window
 * - supportsNativeSpeech: 仅鸿蒙有原生 TTS (harmonyBridge.speak)
 *
 * 降级矩阵 (isHarmony=true 时):
 * - supportsServiceWorker = false  (ArkWeb rawfile 不支持 SW)
 * - supportsSpeechSynthesis = true  (v0.3.0: harmonyBridge.speak 兜底)
 * - supportsNativeSpeech = true     (v0.3.0: 仅鸿蒙有原生 TTS)
 * - supportsInstallPrompt = false   (ArkWeb 不触发 beforeinstallprompt)
 * - supportsNotifications = true    (ArkTS notificationManager 原生推送, Stage 7)
 * - getNativeBridge() 返回 window.harmonyBridge | null
 *
 * Web 端 (isHarmony=false): supportsNotifications = false, supportsNativeSpeech = false
 *   supportsSpeechSynthesis = 'speechSynthesis' in window
 *   (Web Notification API 降级路径不在 v0.1.0-harmony 范围内, SettingsPanel 隐藏 Notifications section).
 */
import type { PlatformCapability } from './types';
import type { HarmonyBridge } from './harmonyBridge';

let cached: PlatformCapability | null = null;

/**
 * 探测宿主平台能力. 首次调用计算并缓存, 后续调用返回单例.
 *
 * 测试可通过 `_resetPlatformCache()` 重置缓存以重新探测.
 */
export function detectPlatform(): PlatformCapability {
  if (cached) return cached;
  cached = createCapability();
  return cached;
}

function createCapability(): PlatformCapability {
  const ua: string =
    typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string'
      ? navigator.userAgent
      : '';
  const isArkWeb: boolean = ua.includes('ArkWeb');
  const hasBridge: boolean =
    typeof window !== 'undefined' && typeof window.harmonyBridge !== 'undefined';
  const isHarmony: boolean = isArkWeb || hasBridge;

  return {
    isHarmonyOS: () => isHarmony,
    supportsServiceWorker: () => !isHarmony,
    // v0.3.0-harmony Stage 2: 鸿蒙端由 harmonyBridge.speak 兜底, 非鸿蒙端检测 speechSynthesis
    supportsSpeechSynthesis: () => {
      if (isHarmony) return true;
      return typeof window !== 'undefined' && 'speechSynthesis' in window;
    },
    // v0.3.0-harmony Stage 2: 仅鸿蒙有原生 TTS (harmonyBridge.speak)
    supportsNativeSpeech: () => isHarmony,
    supportsInstallPrompt: () => !isHarmony,
    supportsNotifications: () => isHarmony,
    getNativeBridge: (): HarmonyBridge | null => {
      if (typeof window === 'undefined') return null;
      return window.harmonyBridge ?? null;
    },
  };
}

/**
 * 重置单例缓存 (test-only). 单元测试在 mock navigator.userAgent /
 * window.harmonyBridge 后调用此函数, 使下次 detectPlatform() 重新探测.
 */
export function _resetPlatformCache(): void {
  cached = null;
}

export default detectPlatform;
