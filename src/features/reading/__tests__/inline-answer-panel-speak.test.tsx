/**
 * v1.2.0 Stage 2 (词汇点读): InlineAnswerPanel 发音按钮集成测试 (T01-T03)
 *
 * 测试目标:
 * - T01 [critical]: Web 端 (bridge=null, speechSynthesis 可用) 点击发音按钮
 *   → speakViaWebSpeechSynthesis 被调用且 payload.text 为 token 原文 (surfaceForm)
 * - T02 [critical]: 鸿蒙端 (harmonyBridge.speak 存在) 点击发音按钮
 *   → harmonyBridge.speak 被调用且 payload 包含 text (原生路径优先)
 * - T03 [critical]: 双能力缺失 (supportsSpeechSynthesis=false + bridge=null)
 *   → 发音按钮不渲染 (queryByRole null)
 *
 * T04 (页级零回归): reading-session-tts.test.tsx (T12-T16) 全量既有断言原样通过,
 * 由 CI 全量跑验证 — 本文件不改页级任何逻辑.
 *
 * Mock 策略 (沿 reading-session-tts.test.tsx 手法):
 * - vi.mock('../../../platform/detect') 工厂返回 configurable stub, setPlatformMock() 切换场景
 * - vi.mock('../../../platform/speechSynthesis') spy speakViaWebSpeechSynthesis
 * - speakText (src/platform/speakText.ts) 不 mock — 走真实双路径分发逻辑
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// =============================================================================
// Mock 1: detectPlatform — configurable stub
// =============================================================================

type PlatformStub = {
  isHarmonyOS: () => boolean;
  supportsServiceWorker: () => boolean;
  supportsSpeechSynthesis: () => boolean;
  supportsNativeSpeech: () => boolean;
  supportsInstallPrompt: () => boolean;
  supportsNotifications: () => boolean;
  getNativeBridge: () => {
    speak: (payload: unknown) => Promise<void>;
    stopSpeech: () => void;
  } | null;
};

let currentPlatform: PlatformStub;

vi.mock('../../../platform/detect', () => ({
  detectPlatform: () => currentPlatform,
}));

// =============================================================================
// Mock 2: speechSynthesis — spy 调用参数
// =============================================================================

const speakViaWebSpeechSynthesisMock = vi.fn();

vi.mock('../../../platform/speechSynthesis', () => ({
  speakViaWebSpeechSynthesis: (payload: unknown) =>
    speakViaWebSpeechSynthesisMock(payload),
}));

// =============================================================================
// Imports (在 vi.mock 之后)
// =============================================================================

import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { InlineAnswerPanel } from '../components/InlineAnswerPanel';
import { useReadingSessionStore } from '../store/useReadingSessionStore';
import { useMemoryStore } from '../../review/store/useMemoryStore';
import { useWordlistStore } from '../../wordlist/store/useWordlistStore';
import { clearAllListeners } from '../../../domain/events';
import type { TokenOccurrence, DifficultyLevel } from '../../../types';

// =============================================================================
// Platform Mock 配置
// =============================================================================

let harmonySpeakMock: ReturnType<typeof vi.fn>;

/** 非鸿蒙端 + Web speechSynthesis 可用 (T01). */
function makeWebWithSpeechSynthesisPlatform(): PlatformStub {
  return {
    isHarmonyOS: () => false,
    supportsServiceWorker: () => true,
    supportsSpeechSynthesis: () => true,
    supportsNativeSpeech: () => false,
    supportsInstallPrompt: () => true,
    supportsNotifications: () => false,
    getNativeBridge: () => null,
  };
}

/** 鸿蒙端 + bridge.speak 存在 (T02). */
function makeHarmonyWithBridgePlatform(): PlatformStub {
  return {
    isHarmonyOS: () => true,
    supportsServiceWorker: () => false,
    supportsSpeechSynthesis: () => true,
    supportsNativeSpeech: () => true,
    supportsInstallPrompt: () => false,
    supportsNotifications: () => true,
    getNativeBridge: () => ({
      speak: harmonySpeakMock as unknown as (p: unknown) => Promise<void>,
      stopSpeech: vi.fn(() => undefined) as unknown as () => void,
    }),
  };
}

/** 双端都不可用 (T03). */
function makeNoTtsPlatform(): PlatformStub {
  return {
    isHarmonyOS: () => false,
    supportsServiceWorker: () => true,
    supportsSpeechSynthesis: () => false,
    supportsNativeSpeech: () => false,
    supportsInstallPrompt: () => true,
    supportsNotifications: () => false,
    getNativeBridge: () => null,
  };
}

function setPlatformMock(stub: PlatformStub) {
  currentPlatform = stub;
}

// =============================================================================
// Test 数据工厂
// =============================================================================

function makeToken(): TokenOccurrence {
  return {
    id: 'tok-1',
    lexemeGroupId: 'g1',
    // surfaceForm 与 lemma 故意不同: 断言朗读用原文 (surfaceForm) 而非 lemma
    surfaceForm: 'running',
    lemma: 'run',
    objectiveDifficulty: 2 as DifficultyLevel,
    startIndex: 0,
    endIndex: 7,
    isResolved: false,
    isActive: false,
    kind: 'normal',
    isCompound: false,
    alignmentStatus: 'perfect',
    originalOffset: 0,
  };
}

function resetAllStores() {
  useReadingSessionStore.setState({
    session: null,
    activeOccurrenceId: null,
    hoveredGroupId: null,
    activeGrammarPointId: null,
    isLoading: false,
    lastConfig: null,
    currentHistoryId: null,
  });
  useMemoryStore.setState({ cards: new Map() });
  useWordlistStore.setState({
    progress: {},
    linearMode: false,
    schemaVersion: 2,
    dailyGoal: { words: 10, sessions: 1, date: new Date().toDateString() },
  });
}

// =============================================================================
// beforeAll / beforeEach / afterEach
// =============================================================================

beforeAll(() => {
  // jsdom 默认不实现 matchMedia (面板动画 hooks 可能依赖)
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    });
  }
});

beforeEach(() => {
  resetAllStores();
  clearAllListeners();
  // 清理 mock 调用记录
  speakViaWebSpeechSynthesisMock.mockClear();
  // 默认 platform: web + speechSynthesis 可用
  setPlatformMock(makeWebWithSpeechSynthesisPlatform());
});

afterEach(() => {
  vi.restoreAllMocks();
  clearAllListeners();
  cleanup();
});

// =============================================================================
// 测试用例
// =============================================================================

describe('InlineAnswerPanel 发音按钮 (v1.2.0 Stage 2 词汇点读)', () => {
  // -------------------------------------------------------------------------
  // T01: Web 端 → speakViaWebSpeechSynthesis 被调用, payload 含 token 原文
  // -------------------------------------------------------------------------
  it('T01 [critical]: web 端点击发音按钮 → speakViaWebSpeechSynthesis 收到 token 原文', () => {
    setPlatformMock(makeWebWithSpeechSynthesisPlatform());
    const token = makeToken();

    render(
      <InlineAnswerPanel token={token} language="en" anchorRef={undefined} />
    );

    const speakBtn = screen.getByRole('button', { name: '朗读单词' });
    expect(speakBtn).toBeInTheDocument();

    fireEvent.click(speakBtn);

    expect(speakViaWebSpeechSynthesisMock).toHaveBeenCalledTimes(1);
    const payload = speakViaWebSpeechSynthesisMock.mock.calls[0][0] as {
      text: string;
      language: string;
      rate: number;
    };
    // 朗读用原文 (surfaceForm), 不是 lemma
    expect(payload.text).toBe('running');
    expect(payload.text).not.toBe('run');
    expect(payload.language).toBe('en-US');
    expect(payload.rate).toBe(1.0);
  });

  // -------------------------------------------------------------------------
  // T02: 鸿蒙端 → harmonyBridge.speak 被调用 (原生路径优先), payload 含 text
  // -------------------------------------------------------------------------
  it('T02 [critical]: 鸿蒙端点击发音按钮 → harmonyBridge.speak 收到 text, 不走 web fallback', () => {
    harmonySpeakMock = vi.fn(() => Promise.resolve());
    setPlatformMock(makeHarmonyWithBridgePlatform());
    const token = makeToken();

    render(
      <InlineAnswerPanel token={token} language="en" anchorRef={undefined} />
    );

    fireEvent.click(screen.getByRole('button', { name: '朗读单词' }));

    expect(harmonySpeakMock).toHaveBeenCalledTimes(1);
    const payload = harmonySpeakMock.mock.calls[0][0] as {
      text: string;
      language: string;
    };
    expect(payload.text).toBe('running');
    expect(payload.language).toBe('en-US');
    // 原生路径优先 → web fallback 未触发
    expect(speakViaWebSpeechSynthesisMock).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // T03: 双能力缺失 → 按钮不渲染
  // -------------------------------------------------------------------------
  it('T03 [critical]: 双能力缺失 → 发音按钮不渲染 (queryByRole null)', () => {
    setPlatformMock(makeNoTtsPlatform());
    const token = makeToken();

    render(
      <InlineAnswerPanel token={token} language="en" anchorRef={undefined} />
    );

    expect(
      screen.queryByRole('button', { name: '朗读单词' })
    ).not.toBeInTheDocument();
  });
});
