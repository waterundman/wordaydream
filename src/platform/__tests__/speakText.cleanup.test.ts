/**
 * v1.3.0 Stage 1 (词汇点读收口): speakText 取消能力 + 归属权隔离测试 (T01 / T02 / T03-逻辑层)
 *
 * 测试目标:
 * - T01 [critical]: 同词连点两次 → speakViaWebSpeechSynthesis 收到两次 payload,
 *   且第二次前发生 cancel 语义 (stopWebSpeechSynthesis 被 speakText 内部调用).
 * - T02 [critical]: stopSpeechText 仅当词级归属才停止 — 词级发起时取消; 页级进行中 (非词级归属) 不取消.
 * - T03 [non-critical]: 词 A 朗读 → token 切换 (stopSpeechText) 取消 A → 词 B 正常发出.
 * - 原生路径: 鸿蒙 bridge 同理, 仅词级发起才调 bridge.stopSpeech(), 且连点不同词先 stop 再 speak.
 *
 * Mock 策略:
 * - vi.mock('../speechSynthesis') → spy speakViaWebSpeechSynthesis / stopWebSpeechSynthesis,
 *   并用 orderLog 记录调用顺序以断言 cancel-then-speak 时序.
 * - vi.mock('../detect') → 可切换桩 (web / 鸿蒙原生), 通过重新赋值 `platform` 切换场景.
 * - 复用 speakText 真实实现 (仅 mock 其底层依赖), 验证真实归属权逻辑.
 * - beforeEach 调 _resetSpeechTextState() 隔离用例间归属权污染.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// =============================================================================
// Mock 1: speechSynthesis — spy + 顺序日志
// =============================================================================

/** 调用顺序日志: 'speak' = speakViaWebSpeechSynthesis, 'stop' = stopWebSpeechSynthesis. */
const orderLog: string[] = [];

/**
 * 模拟 speechSynthesis.currentInitiator 归属语义 (v1.3.0 S1 起真实归属锚定在
 * speechSynthesis 模块; 真实归属逻辑由 speakText.initiator.test.ts 以真实模块验证,
 * 本文件聚焦 speakText 自身分支逻辑, mock 需忠实模拟 initiator 打标/清位).
 */
let simulatedWordOwned = false;

const speakViaWebSpeechSynthesisMock = vi.fn((payload: unknown, initiator?: string) => {
  if (initiator === 'word') simulatedWordOwned = true;
  orderLog.push('speak');
  return payload;
});
const stopWebSpeechSynthesisMock = vi.fn(() => {
  orderLog.push('stop');
});
const stopIfOwnedByMock = vi.fn((initiator: string) => {
  if (initiator !== 'word' || !simulatedWordOwned) return false;
  simulatedWordOwned = false;
  // 真实实现: 命中归属 → 调 stopWebSpeechSynthesis (由其统一记一次 'stop', 勿双记)
  stopWebSpeechSynthesisMock();
  return true;
});

vi.mock('../speechSynthesis', () => ({
  speakViaWebSpeechSynthesis: (payload: unknown, initiator?: string) =>
    speakViaWebSpeechSynthesisMock(payload, initiator),
  stopWebSpeechSynthesis: () => stopWebSpeechSynthesisMock(),
  stopWebSpeechSynthesisIfOwnedBy: (initiator: string) => stopIfOwnedByMock(initiator),
}));

// =============================================================================
// Mock 2: detect — 可切换桩 (web / 鸿蒙原生)
// =============================================================================

type NativeBridge = {
  speak: (payload: unknown) => Promise<void>;
  stopSpeech: () => void;
};

let platform: {
  supportsSpeechSynthesis: () => boolean;
  getNativeBridge: () => NativeBridge | null;
};

vi.mock('../detect', () => ({
  detectPlatform: () => platform,
}));

// =============================================================================
// Imports (vi.mock 之后)
// =============================================================================

import { speakText, stopSpeechText, _resetSpeechTextState } from '../speakText';

// =============================================================================
// beforeEach / afterEach
// =============================================================================

beforeEach(() => {
  orderLog.length = 0;
  simulatedWordOwned = false;
  speakViaWebSpeechSynthesisMock.mockClear();
  stopWebSpeechSynthesisMock.mockClear();
  stopIfOwnedByMock.mockClear();
  _resetSpeechTextState();
  // 默认场景: web + speechSynthesis 可用, 无原生 bridge.
  platform = {
    supportsSpeechSynthesis: () => true,
    getNativeBridge: () => null,
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

// =============================================================================
// 测试用例
// =============================================================================

describe('v1.3.0 Stage 1 — speakText 取消 / 归属权隔离 (platform 层)', () => {
  // -------------------------------------------------------------------------
  // T01: 同词连点两次 → 两次 payload + 第二次前 cancel 语义
  // -------------------------------------------------------------------------
  describe('T01 [critical]: 同词连点两次 — cancel-then-speak', () => {
    it('收到两次 payload, 且第二次 speak 之前发生了 stop (cancel 语义)', () => {
      speakText('revolution', 'en');
      expect(speakViaWebSpeechSynthesisMock).toHaveBeenCalledTimes(1);
      expect(speakViaWebSpeechSynthesisMock.mock.calls[0][0]).toMatchObject({
        text: 'revolution',
        language: 'en-US',
        rate: 1.0,
      });

      // 第二次连点: 先 cancel (stop) 再 speak 新 payload
      speakText('revolution', 'en');

      expect(speakViaWebSpeechSynthesisMock).toHaveBeenCalledTimes(2);
      expect(speakViaWebSpeechSynthesisMock.mock.calls[1][0]).toMatchObject({
        text: 'revolution',
      });

      // 时序: speak → stop → speak (第二次前的 cancel)
      expect(orderLog).toEqual(['speak', 'stop', 'speak']);
    });

    it('不同词连点 → 两次 payload, 第二次前 cancel (替换而非叠加)', () => {
      speakText('apple', 'en');
      speakText('banana', 'de');

      expect(speakViaWebSpeechSynthesisMock).toHaveBeenCalledTimes(2);
      expect(speakViaWebSpeechSynthesisMock.mock.calls[0][0]).toMatchObject({
        text: 'apple',
        language: 'en-US',
      });
      expect(speakViaWebSpeechSynthesisMock.mock.calls[1][0]).toMatchObject({
        text: 'banana',
        language: 'de-DE',
      });
      // 第二次前发生 cancel
      expect(orderLog).toEqual(['speak', 'stop', 'speak']);
    });
  });

  // -------------------------------------------------------------------------
  // T02: stopSpeechText 归属权隔离 — 仅词级发起才停止
  // -------------------------------------------------------------------------
  describe('T02 [critical]: stopSpeechText 归属权隔离', () => {
    it('T02a: 词级朗读进行中调用 stopSpeechText → stopWebSpeechSynthesis 被调用, 且归属复位', () => {
      speakText('apple', 'en');

      stopSpeechText();
      expect(stopWebSpeechSynthesisMock).toHaveBeenCalledTimes(1);
      // 归属已复位: 再次 stop 不应重复取消
      stopSpeechText();
      expect(stopWebSpeechSynthesisMock).toHaveBeenCalledTimes(1);
    });

    it('T02b [核心]: 页级朗读进行中 (非词级归属) → stopSpeechText 不取消页级', () => {
      // 模拟页级先发起: 直接走 Web fallback (ReadingSessionPage 的路径), 不经过 speakText.
      // 此时归属仍为 'none' (页级不经过 speakText), stopSpeechText 应为 no-op.
      speakViaWebSpeechSynthesisMock('page-passage-text');

      stopSpeechText();
      // 核心断言: 不得误杀页级朗读
      expect(stopWebSpeechSynthesisMock).not.toHaveBeenCalled();
      // 再次 stop 仍安全
      stopSpeechText();
      expect(stopWebSpeechSynthesisMock).not.toHaveBeenCalled();
    });

    it('T02c: 双能力缺失环境 → stopSpeechText 静默 no-op (不抛异常)', () => {
      platform = {
        supportsSpeechSynthesis: () => false,
        getNativeBridge: () => null,
      };
      // 不应抛错, 也不调用任何底层 stop
      expect(() => stopSpeechText()).not.toThrow();
      expect(stopWebSpeechSynthesisMock).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // T03: 词 A → 词 B 切换 (panel 触发 stopSpeechText) 取消 A, B 正常发出
  // -------------------------------------------------------------------------
  describe('T03 [non-critical]: token 切换取消上一词, 新词正常发出 (逻辑层)', () => {
    it('词 A 朗读 → stopSpeechText (token 变更) 取消 A → 词 B 正常发出', () => {
      speakText('apple', 'en'); // A
      stopSpeechText(); // 模拟面板 token.id 变更 cleanup
      expect(stopWebSpeechSynthesisMock).toHaveBeenCalledTimes(1);

      speakText('banana', 'en'); // B
      expect(speakViaWebSpeechSynthesisMock).toHaveBeenCalledTimes(2);
      expect(speakViaWebSpeechSynthesisMock.mock.calls[1][0]).toMatchObject({
        text: 'banana',
      });
    });
  });

  // -------------------------------------------------------------------------
  // 原生 (鸿蒙) 路径: 归属权隔离同理
  // -------------------------------------------------------------------------
  describe('native (鸿蒙) 路径: 归属权隔离', () => {
    function setNativePlatform() {
      const speak = vi.fn(() => Promise.resolve());
      const stopSpeech = vi.fn();
      platform = {
        supportsSpeechSynthesis: () => false,
        getNativeBridge: () => ({ speak, stopSpeech }),
      };
      return { speak, stopSpeech };
    }

    it('speakText 调用 bridge.speak, 不调用 Web fallback', () => {
      const { speak } = setNativePlatform();
      speakText('apple', 'en');
      expect(speak).toHaveBeenCalledTimes(1);
      expect(speakViaWebSpeechSynthesisMock).not.toHaveBeenCalled();
    });

    it('stopSpeechText 仅词级发起时调 bridge.stopSpeech, 且归属复位', () => {
      const { speak, stopSpeech } = setNativePlatform();
      speakText('apple', 'en');
      expect(speak).toHaveBeenCalledTimes(1);

      stopSpeechText();
      expect(stopSpeech).toHaveBeenCalledTimes(1);
      // 归属复位: 再次 stop 不重复
      stopSpeechText();
      expect(stopSpeech).toHaveBeenCalledTimes(1);
    });

    it('非词级归属 (页级) 时 stopSpeechText 不调 bridge.stopSpeech', () => {
      const { stopSpeech } = setNativePlatform();
      // 未经过 speakText (模拟页级直接走 bridge) → wordNativeOwnsSpeech=false
      stopSpeechText();
      expect(stopSpeech).not.toHaveBeenCalled();
    });

    it('连点不同词 — 先 stop 上一条再 speak 新词 (cancel-then-speak)', () => {
      const { speak, stopSpeech } = setNativePlatform();
      speakText('apple', 'en');
      speakText('banana', 'en');
      expect(speak).toHaveBeenCalledTimes(2);
      // 第二次前先 stop 上一条
      expect(stopSpeech).toHaveBeenCalledTimes(1);
    });
  });
});
