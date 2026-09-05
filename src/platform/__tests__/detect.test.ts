/**
 * T01 / T02: detectPlatform 单元测试 (v0.3.0-harmony Stage 2)
 *
 * v0.3.0-harmony Stage 2 改造:
 * - supportsSpeechSynthesis: 鸿蒙端返回 true (harmonyBridge.speak 兜底),
 *   非鸿蒙端检测 'speechSynthesis' in window (jsdom 默认为 false)
 * - supportsNativeSpeech (新增): 仅鸿蒙端返回 true
 * - supportsNotifications: 鸿蒙端返回 true (notificationManager 原生推送)
 *
 * T01 [critical]: web 环境 (jsdom 默认) →
 *   isHarmonyOS=false / supportsServiceWorker=true /
 *   supportsSpeechSynthesis=false (jsdom 无 speechSynthesis) /
 *   supportsNativeSpeech=false / supportsInstallPrompt=true
 * T02 [critical]: 模拟 ArkWeb userAgent + window.harmonyBridge 存在 →
 *   isHarmonyOS=true / supportsSpeechSynthesis=true (bridge.speak 兜底) /
 *   supportsNativeSpeech=true / supportsServiceWorker=false
 *
 * Mock 策略:
 * - T01: 不 mock, 使用 jsdom 默认 navigator.userAgent (不含 'ArkWeb') +
 *   window.harmonyBridge === undefined
 * - T02: Object.defineProperty(navigator, 'userAgent', ...) 模拟 ArkWeb UA +
 *   直接赋值 window.harmonyBridge = stub (含 Stage 1 v0.3.0 新增 speak/stopSpeech 等)
 * - 每个用例前 _resetPlatformCache() 重置单例, 避免缓存污染
 */
import { afterEach, describe, expect, it } from 'vitest';
import { detectPlatform, _resetPlatformCache } from '../detect';
import type { HarmonyBridge } from '../harmonyBridge';

describe('detectPlatform (v0.3.0-harmony Stage 2)', () => {
  const originalUA: string =
    typeof navigator !== 'undefined' ? navigator.userAgent : '';

  afterEach(() => {
    _resetPlatformCache();
    // 恢复 navigator.userAgent
    Object.defineProperty(navigator, 'userAgent', {
      value: originalUA,
      configurable: true,
    });
    // 清理 window.harmonyBridge
    const w = window as Window & { harmonyBridge?: HarmonyBridge };
    if (typeof w.harmonyBridge !== 'undefined') {
      delete w.harmonyBridge;
    }
  });

  it('T01 [critical]: web 环境 → isHarmonyOS=false, supportsNativeSpeech=false, getNativeBridge=null', () => {
    _resetPlatformCache();
    const cap = detectPlatform();
    expect(cap.isHarmonyOS()).toBe(false);
    expect(cap.supportsServiceWorker()).toBe(true);
    // v0.3.0-harmony Stage 2: 非鸿蒙端检测 'speechSynthesis' in window.
    // jsdom 默认不实现 SpeechSynthesis API → 返回 false.
    expect(cap.supportsSpeechSynthesis()).toBe('speechSynthesis' in window);
    expect(cap.supportsNativeSpeech()).toBe(false);
    expect(cap.supportsInstallPrompt()).toBe(true);
    expect(cap.getNativeBridge()).toBeNull();
  });

  it('T02 [critical]: ArkWeb userAgent + window.harmonyBridge 存在 → isHarmonyOS=true, supportsSpeechSynthesis=true', () => {
    // 模拟鸿蒙 ArkWeb userAgent
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Linux; Android 12; HarmonyOS) ArkWeb/5.0.0',
      configurable: true,
    });
    // 模拟 ArkTS 注入的 harmonyBridge (含 Stage 1 v0.3.0 新增 speak/stopSpeech 等)
    const bridgeStub: HarmonyBridge = {
      getDueCardsCount: () => Promise.resolve(0),
      registerReminder: () => Promise.resolve(undefined),
      readPreferences: () => Promise.resolve(null),
      writePreferences: () => Promise.resolve(undefined),
      triggerHapticFeedback: () => {},
      notifyWebReady: () => {},
      notifyWebContentReady: () => {},
      upsertCard: () => Promise.resolve(undefined),
      deleteCard: () => Promise.resolve(undefined),
      getAllCards: () => Promise.resolve([]),
      getRecentlyReviewedCards: () => Promise.resolve([]),
      getTodayReviewStats: () => Promise.resolve({ dueCount: 0, reviewedCount: 0, totalCount: 0 }),
      speak: () => Promise.resolve(undefined),
      stopSpeech: () => {},
      isSpeechSupported: () => Promise.resolve(true),
      getSpeechEngines: () => Promise.resolve([]),
    };
    (window as Window & { harmonyBridge?: HarmonyBridge }).harmonyBridge = bridgeStub;

    _resetPlatformCache();
    const cap = detectPlatform();
    expect(cap.isHarmonyOS()).toBe(true);
    expect(cap.supportsServiceWorker()).toBe(false);
    // v0.3.0-harmony Stage 2: 鸿蒙端由 harmonyBridge.speak 兜底 → 返回 true
    expect(cap.supportsSpeechSynthesis()).toBe(true);
    expect(cap.supportsNativeSpeech()).toBe(true);
    expect(cap.supportsInstallPrompt()).toBe(false);
    expect(cap.getNativeBridge()).toBe(bridgeStub);
  });

  it('T02b: 仅 window.harmonyBridge 存在 (无 ArkWeb UA) → isHarmonyOS=true', () => {
    // bridge 注入即可判定为鸿蒙 (覆盖 bridge 晚于 UA 注入的场景)
    const bridgeStub: HarmonyBridge = {
      getDueCardsCount: () => Promise.resolve(0),
      registerReminder: () => Promise.resolve(undefined),
      readPreferences: () => Promise.resolve(null),
      writePreferences: () => Promise.resolve(undefined),
      triggerHapticFeedback: () => {},
      notifyWebReady: () => {},
      notifyWebContentReady: () => {},
      upsertCard: () => Promise.resolve(undefined),
      deleteCard: () => Promise.resolve(undefined),
      getAllCards: () => Promise.resolve([]),
      getRecentlyReviewedCards: () => Promise.resolve([]),
      getTodayReviewStats: () => Promise.resolve({ dueCount: 0, reviewedCount: 0, totalCount: 0 }),
      speak: () => Promise.resolve(undefined),
      stopSpeech: () => {},
      isSpeechSupported: () => Promise.resolve(true),
      getSpeechEngines: () => Promise.resolve([]),
    };
    (window as Window & { harmonyBridge?: HarmonyBridge }).harmonyBridge = bridgeStub;

    _resetPlatformCache();
    const cap = detectPlatform();
    expect(cap.isHarmonyOS()).toBe(true);
    expect(cap.getNativeBridge()).toBe(bridgeStub);
  });

  it('detectPlatform 单例缓存: 多次调用返回同一实例', () => {
    _resetPlatformCache();
    const a = detectPlatform();
    const b = detectPlatform();
    expect(a).toBe(b);
  });
});
