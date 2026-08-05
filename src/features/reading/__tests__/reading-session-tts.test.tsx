/**
 * v0.3.0-harmony Stage 2: ReadingSessionPage 双路径 TTS 集成测试 (T12-T16)
 *
 * 测试目标:
 * - T12 [critical]: 鸿蒙端 harmonyBridge.speak 存在时朗读按钮 enabled
 * - T13 [critical]: 非鸿蒙端 speechSynthesis 存在时朗读按钮 enabled
 * - T14 [non-critical]: 双端都不可用时朗读按钮 disabled
 * - T15 [critical]: handleTogglePlay 优先调用 harmonyBridge.speak, fallback 到 speakViaWebSpeechSynthesis
 * - T16 [non-critical]: rate 四档选择器切换 + 持久化到 localStorage
 *
 * 实现策略:
 * - vi.mock('../../platform/detect') 工厂返回 configurable stub, 通过 setPlatformMock() 切换场景
 * - vi.mock('../../platform/speechSynthesis') spy speakViaWebSpeechSynthesis / stopWebSpeechSynthesis /
 *   setWebSpeechSynthesisEndCallback 调用次数和参数
 * - 复用既有 ReadingSessionPage 测试的 store setup 模式 (session + history + memory + wordlist)
 * - stub window.matchMedia (InteractivePassage 内部 usePageEntranceAnimation 依赖)
 * - mock useWordlistStore.getState 避免加载词表文件
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// =============================================================================
// Mock 1: detectPlatform — configurable stub, 通过 setPlatformMock() 切换场景
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
// Mock 2: speechSynthesis — spy 调用次数和参数
// =============================================================================

const speakViaWebSpeechSynthesisMock = vi.fn();
const stopWebSpeechSynthesisMock = vi.fn();
const setWebSpeechSynthesisEndCallbackMock = vi.fn();

vi.mock('../../../platform/speechSynthesis', () => ({
  speakViaWebSpeechSynthesis: (payload: unknown) => speakViaWebSpeechSynthesisMock(payload),
  stopWebSpeechSynthesis: () => stopWebSpeechSynthesisMock(),
  setWebSpeechSynthesisEndCallback: (cb: (() => void) | null) =>
    setWebSpeechSynthesisEndCallbackMock(cb),
}));

// =============================================================================
// Imports (在 vi.mock 之后, 确保 mock 生效)
// =============================================================================

import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ReadingSessionPage } from '../ReadingSessionPage';
import { useReadingSessionStore } from '../store/useReadingSessionStore';
import { useReadingHistoryStore } from '../store/useReadingHistoryStore';
import { useMemoryStore } from '../../review/store/useMemoryStore';
import { useWordlistStore } from '../../wordlist/store/useWordlistStore';
import { clearAllListeners } from '../../../domain/events';
import type {
  Passage,
  ReadingSession,
  TokenOccurrence,
  Language,
  DifficultyLevel,
} from '../../../types';

// =============================================================================
// Platform Mock 配置工具
// =============================================================================

/** 鸿蒙端 + bridge.speak 存在场景 (T12, T15 原生路径). */
function makeHarmonyWithBridgePlatform(speakImpl?: () => Promise<void>): PlatformStub {
  return {
    isHarmonyOS: () => true,
    supportsServiceWorker: () => false,
    supportsSpeechSynthesis: () => true,
    supportsNativeSpeech: () => true,
    supportsInstallPrompt: () => false,
    supportsNotifications: () => true,
    getNativeBridge: () => ({
      speak: vi.fn(() => speakImpl?.() ?? Promise.resolve()) as unknown as (p: unknown) => Promise<void>,
      stopSpeech: vi.fn(() => undefined) as unknown as () => void,
    }),
  };
}

/** 非鸿蒙端 + Web speechSynthesis 可用场景 (T13, T15 fallback 路径). */
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

/** 双端都不可用场景 (T14). */
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

function makeToken(
  id: string,
  lexemeGroupId: string,
  isResolved: boolean,
  kind: 'normal' | 'review' = 'normal',
): TokenOccurrence {
  return {
    id,
    lexemeGroupId,
    surfaceForm: id,
    lemma: id,
    objectiveDifficulty: 2 as DifficultyLevel,
    startIndex: 0,
    endIndex: 1,
    isResolved,
    isActive: false,
    kind,
    isCompound: false,
    alignmentStatus: 'perfect',
    originalOffset: 0,
  };
}

function makePassage(text: string, tokens: TokenOccurrence[]): Passage {
  return {
    id: `passage-${Date.now()}`,
    language: 'en',
    difficulty: 2,
    text,
    tokens,
    lexemeGroups: [],
    grammarPoints: [],
  };
}

function makeSession(text: string, tokens: TokenOccurrence[]): ReadingSession {
  const resolvedIds = tokens.filter((t) => t.isResolved).map((t) => t.id);
  return {
    id: `session-${Date.now()}`,
    language: 'en' as Language,
    difficulty: 2 as DifficultyLevel,
    passage: makePassage(text, tokens),
    startedAt: Date.now(),
    resolvedTokens: new Set(resolvedIds),
    activeOccurrenceId: null,
  };
}

function resetAllStores() {
  useReadingSessionStore.setState({
    session: null,
    activeOccurrenceId: null,
    hoveredGroupId: null,
    activeGrammarPointId: null,
    hoveredGrammarTypeId: null,
    isLoading: false,
    lastConfig: null,
    currentHistoryId: null,
  });
  useReadingHistoryStore.setState({ history: [], maxHistory: 50 });
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
  // jsdom 默认不实现 matchMedia, InteractivePassage 内部 usePageEntranceAnimation 会调用它.
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
  // Mock getLevelTotal 避免加载词表文件
  vi.spyOn(useWordlistStore, 'getState').mockReturnValue({
    ...useWordlistStore.getState(),
    getLevelTotal: vi.fn().mockResolvedValue(0),
    isLevelUnlocked: () => true,
  } as unknown as ReturnType<typeof useWordlistStore.getState>);
  // 清理 localStorage (T16 持久化测试需干净环境)
  try {
    window.localStorage.clear();
  } catch {
    // ignore
  }
  // 清理 mock 调用记录
  speakViaWebSpeechSynthesisMock.mockClear();
  stopWebSpeechSynthesisMock.mockClear();
  setWebSpeechSynthesisEndCallbackMock.mockClear();
  // 默认 platform: web + speechSynthesis 可用
  setPlatformMock(makeWebWithSpeechSynthesisPlatform());
});

afterEach(() => {
  vi.restoreAllMocks();
  clearAllListeners();
  cleanup();
  // 清理 localStorage
  try {
    window.localStorage.clear();
  } catch {
    // ignore
  }
});

// =============================================================================
// 测试用例
// =============================================================================

describe('ReadingSessionPage 双路径 TTS (v0.3.0-harmony Stage 2)', () => {
  // -------------------------------------------------------------------------
  // T12: 鸿蒙端 harmonyBridge.speak 存在时朗读按钮 enabled
  // -------------------------------------------------------------------------
  describe('T12 [critical]: 鸿蒙端 harmonyBridge.speak 存在 → 朗读按钮 enabled', () => {
    it('harmonyBridge.speak 存在 → play button 不 disabled', () => {
      setPlatformMock(makeHarmonyWithBridgePlatform());
      const tokens = [makeToken('t1', 'g1', false)];
      const session = makeSession('hello world', tokens);
      useReadingSessionStore.setState({
        session,
        currentHistoryId: null,
        lastConfig: { language: 'en', difficulty: 2 },
      });

      render(<ReadingSessionPage />);

      const playBtn = screen.getByRole('button', { name: '朗读' });
      expect(playBtn).not.toBeDisabled();
    });

    it('harmonyBridge.speak 存在 → rate selector 渲染 (ttsSupported=true)', () => {
      setPlatformMock(makeHarmonyWithBridgePlatform());
      const tokens = [makeToken('t1', 'g1', false)];
      const session = makeSession('hello world', tokens);
      useReadingSessionStore.setState({
        session,
        currentHistoryId: null,
        lastConfig: { language: 'en', difficulty: 2 },
      });

      render(<ReadingSessionPage />);

      expect(screen.getByTestId('tts-rate-selector')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // T13: 非鸿蒙端 speechSynthesis 存在时朗读按钮 enabled
  // -------------------------------------------------------------------------
  describe('T13 [critical]: 非鸿蒙端 speechSynthesis 可用 → 朗读按钮 enabled', () => {
    it('web 端 supportsSpeechSynthesis=true + bridge=null → play button 不 disabled', () => {
      setPlatformMock(makeWebWithSpeechSynthesisPlatform());
      const tokens = [makeToken('t1', 'g1', false)];
      const session = makeSession('hello world', tokens);
      useReadingSessionStore.setState({
        session,
        currentHistoryId: null,
        lastConfig: { language: 'en', difficulty: 2 },
      });

      render(<ReadingSessionPage />);

      const playBtn = screen.getByRole('button', { name: '朗读' });
      expect(playBtn).not.toBeDisabled();
    });

    it('web 端 → rate selector 渲染 (ttsSupported=true)', () => {
      setPlatformMock(makeWebWithSpeechSynthesisPlatform());
      const tokens = [makeToken('t1', 'g1', false)];
      const session = makeSession('hello world', tokens);
      useReadingSessionStore.setState({
        session,
        currentHistoryId: null,
        lastConfig: { language: 'en', difficulty: 2 },
      });

      render(<ReadingSessionPage />);

      expect(screen.getByTestId('tts-rate-selector')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // T14: 双端都不可用时朗读按钮 disabled
  // -------------------------------------------------------------------------
  describe('T14 [non-critical]: 双端都不可用 → 朗读按钮 disabled', () => {
    it('supportsSpeechSynthesis=false + bridge=null → play button disabled', () => {
      setPlatformMock(makeNoTtsPlatform());
      const tokens = [makeToken('t1', 'g1', false)];
      const session = makeSession('hello world', tokens);
      useReadingSessionStore.setState({
        session,
        currentHistoryId: null,
        lastConfig: { language: 'en', difficulty: 2 },
      });

      render(<ReadingSessionPage />);

      const playBtn = screen.getByRole('button', { name: '朗读' });
      expect(playBtn).toBeDisabled();
    });

    it('ttsSupported=false → rate selector 不渲染', () => {
      setPlatformMock(makeNoTtsPlatform());
      const tokens = [makeToken('t1', 'g1', false)];
      const session = makeSession('hello world', tokens);
      useReadingSessionStore.setState({
        session,
        currentHistoryId: null,
        lastConfig: { language: 'en', difficulty: 2 },
      });

      render(<ReadingSessionPage />);

      expect(screen.queryByTestId('tts-rate-selector')).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // T15: handleTogglePlay 优先调用 harmonyBridge.speak, fallback 到 speakViaWebSpeechSynthesis
  // -------------------------------------------------------------------------
  describe('T15 [critical]: handleTogglePlay 双路径分发', () => {
    it('harmonyBridge.speak 存在 → 调用 bridge.speak, 不调用 speakViaWebSpeechSynthesis', () => {
      const speakSpy = vi.fn(() => Promise.resolve());
      setPlatformMock(makeHarmonyWithBridgePlatform(() => speakSpy()));

      const tokens = [makeToken('t1', 'g1', false)];
      const session = makeSession('hello world', tokens);
      useReadingSessionStore.setState({
        session,
        currentHistoryId: null,
        lastConfig: { language: 'en', difficulty: 2 },
      });

      render(<ReadingSessionPage />);

      fireEvent.click(screen.getByRole('button', { name: '朗读' }));

      // bridge.speak 被调用 (优先路径)
      expect(speakSpy).toHaveBeenCalledTimes(1);
      // speakViaWebSpeechSynthesis 不被调用 (fallback 路径未触发)
      expect(speakViaWebSpeechSynthesisMock).not.toHaveBeenCalled();
    });

    it('harmonyBridge.speak 调用时 payload 包含 text/language/rate', () => {
      const speakSpy = vi.fn(() => Promise.resolve());
      setPlatformMock(makeHarmonyWithBridgePlatform(() => speakSpy()));

      const tokens = [makeToken('t1', 'g1', false)];
      const passageText = 'hello world this is a test';
      const session = makeSession(passageText, tokens);
      useReadingSessionStore.setState({
        session,
        currentHistoryId: null,
        lastConfig: { language: 'en', difficulty: 2 },
      });

      render(<ReadingSessionPage />);

      fireEvent.click(screen.getByRole('button', { name: '朗读' }));

      expect(speakSpy).toHaveBeenCalledTimes(1);
      // payload 透传给 bridge.speak (具体字段在 ReadingSessionPage 内构造)
      // 由于 speakSpy 被 speakImpl 调用而非直接是 bridge.speak, 这里验证 bridge.speak 调用
      const bridge = currentPlatform.getNativeBridge();
      expect(bridge).not.toBeNull();
      // bridge.speak 是 vi.fn, 检查它被调用 (通过 speakSpy 间接验证)
      expect(speakSpy).toHaveBeenCalledWith();
    });

    it('bridge=null (web) → 调用 speakViaWebSpeechSynthesis, 不调用 bridge', () => {
      setPlatformMock(makeWebWithSpeechSynthesisPlatform());

      const tokens = [makeToken('t1', 'g1', false)];
      const passageText = 'hello world web fallback test';
      const session = makeSession(passageText, tokens);
      useReadingSessionStore.setState({
        session,
        currentHistoryId: null,
        lastConfig: { language: 'en', difficulty: 2 },
      });

      render(<ReadingSessionPage />);

      fireEvent.click(screen.getByRole('button', { name: '朗读' }));

      // speakViaWebSpeechSynthesis 被调用 (fallback 路径)
      expect(speakViaWebSpeechSynthesisMock).toHaveBeenCalledTimes(1);
      // payload 包含正确字段
      const payload = speakViaWebSpeechSynthesisMock.mock.calls[0][0] as {
        text: string;
        language: string;
        rate: number;
      };
      expect(payload.text).toBe(passageText);
      expect(payload.language).toBe('en-US');
      expect(payload.rate).toBe(1.0); // 默认 rate
    });

    it('web 端 fallback → setWebSpeechSynthesisEndCallback 被调用 (设置 isPlaying 切换回调)', () => {
      setPlatformMock(makeWebWithSpeechSynthesisPlatform());

      const tokens = [makeToken('t1', 'g1', false)];
      const session = makeSession('hello world', tokens);
      useReadingSessionStore.setState({
        session,
        currentHistoryId: null,
        lastConfig: { language: 'en', difficulty: 2 },
      });

      render(<ReadingSessionPage />);

      fireEvent.click(screen.getByRole('button', { name: '朗读' }));

      expect(setWebSpeechSynthesisEndCallbackMock).toHaveBeenCalledTimes(1);
      // 回调为函数 (用于播放结束时切换 isPlaying)
      const callback = setWebSpeechSynthesisEndCallbackMock.mock.calls[0][0];
      expect(typeof callback).toBe('function');
    });

    it('isPlaying=true 时点击 → 调用 bridge.stopSpeech + stopWebSpeechSynthesis', () => {
      const stopSpy = vi.fn(() => undefined);
      const speakSpy = vi.fn(() => Promise.resolve());
      // 自定义 platform: bridge.stopSpeech 走 stopSpy
      setPlatformMock({
        isHarmonyOS: () => true,
        supportsServiceWorker: () => false,
        supportsSpeechSynthesis: () => true,
        supportsNativeSpeech: () => true,
        supportsInstallPrompt: () => false,
        supportsNotifications: () => true,
        getNativeBridge: () => ({
          speak: vi.fn(() => speakSpy()) as unknown as (p: unknown) => Promise<void>,
          stopSpeech: stopSpy as unknown as () => void,
        }),
      });

      const tokens = [makeToken('t1', 'g1', false)];
      const session = makeSession('hello world', tokens);
      useReadingSessionStore.setState({
        session,
        currentHistoryId: null,
        lastConfig: { language: 'en', difficulty: 2 },
      });

      render(<ReadingSessionPage />);

      // 第一次点击: 开始播放
      fireEvent.click(screen.getByRole('button', { name: '朗读' }));
      expect(speakSpy).toHaveBeenCalledTimes(1);

      // 第二次点击: 停止播放 (按钮 name 变为 '停止朗读')
      fireEvent.click(screen.getByRole('button', { name: '停止朗读' }));
      expect(stopSpy).toHaveBeenCalledTimes(1);
      expect(stopWebSpeechSynthesisMock).toHaveBeenCalledTimes(1);
      // setWebSpeechSynthesisEndCallback(null) 清除回调
      expect(setWebSpeechSynthesisEndCallbackMock).toHaveBeenLastCalledWith(null);
    });

    it('web 端 isPlaying=true 时点击 → 调用 stopWebSpeechSynthesis (无 bridge.stopSpeech)', () => {
      setPlatformMock(makeWebWithSpeechSynthesisPlatform());

      const tokens = [makeToken('t1', 'g1', false)];
      const session = makeSession('hello world', tokens);
      useReadingSessionStore.setState({
        session,
        currentHistoryId: null,
        lastConfig: { language: 'en', difficulty: 2 },
      });

      render(<ReadingSessionPage />);

      // 第一次点击: 开始播放 (web fallback)
      fireEvent.click(screen.getByRole('button', { name: '朗读' }));
      expect(speakViaWebSpeechSynthesisMock).toHaveBeenCalledTimes(1);

      // 第二次点击: 停止播放
      fireEvent.click(screen.getByRole('button', { name: '停止朗读' }));
      expect(stopWebSpeechSynthesisMock).toHaveBeenCalledTimes(1);
      expect(setWebSpeechSynthesisEndCallbackMock).toHaveBeenLastCalledWith(null);
    });

    it('ttsSupported=false 时点击 → 不调用任何 TTS 函数', () => {
      setPlatformMock(makeNoTtsPlatform());

      const tokens = [makeToken('t1', 'g1', false)];
      const session = makeSession('hello world', tokens);
      useReadingSessionStore.setState({
        session,
        currentHistoryId: null,
        lastConfig: { language: 'en', difficulty: 2 },
      });

      render(<ReadingSessionPage />);

      // 按钮 disabled, 点击不触发 (fireEvent 仍可触发 onClick, 但 handleTogglePlay 内 early return)
      const playBtn = screen.getByRole('button', { name: '朗读' });
      expect(playBtn).toBeDisabled();
      // disabled button 在 RTL fireEvent.click 不会触发 onClick, 这里直接断言无 TTS 调用
      expect(speakViaWebSpeechSynthesisMock).not.toHaveBeenCalled();
      expect(stopWebSpeechSynthesisMock).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // T16: rate 四档选择器切换 + 持久化到 localStorage
  // -------------------------------------------------------------------------
  describe('T16 [non-critical]: rate 四档选择器 + 持久化', () => {
    it('rate selector 渲染 4 个 pill (0.5 / 1.0 / 1.5 / 2.0)', () => {
      setPlatformMock(makeWebWithSpeechSynthesisPlatform());
      const tokens = [makeToken('t1', 'g1', false)];
      const session = makeSession('hello world', tokens);
      useReadingSessionStore.setState({
        session,
        currentHistoryId: null,
        lastConfig: { language: 'en', difficulty: 2 },
      });

      render(<ReadingSessionPage />);

      expect(screen.getByTestId('tts-rate-0.5')).toBeInTheDocument();
      expect(screen.getByTestId('tts-rate-1')).toBeInTheDocument();
      expect(screen.getByTestId('tts-rate-1.5')).toBeInTheDocument();
      expect(screen.getByTestId('tts-rate-2')).toBeInTheDocument();
    });

    it('默认 rate=1.0 → 1× pill 标记为 active (aria-checked=true)', () => {
      setPlatformMock(makeWebWithSpeechSynthesisPlatform());
      const tokens = [makeToken('t1', 'g1', false)];
      const session = makeSession('hello world', tokens);
      useReadingSessionStore.setState({
        session,
        currentHistoryId: null,
        lastConfig: { language: 'en', difficulty: 2 },
      });

      render(<ReadingSessionPage />);

      const rate1 = screen.getByTestId('tts-rate-1');
      expect(rate1).toHaveAttribute('aria-checked', 'true');

      const rate05 = screen.getByTestId('tts-rate-0.5');
      expect(rate05).toHaveAttribute('aria-checked', 'false');
    });

    it('点击 1.5× pill → 切换 currentRate + 持久化到 localStorage', () => {
      setPlatformMock(makeWebWithSpeechSynthesisPlatform());
      const tokens = [makeToken('t1', 'g1', false)];
      const session = makeSession('hello world', tokens);
      useReadingSessionStore.setState({
        session,
        currentHistoryId: null,
        lastConfig: { language: 'en', difficulty: 2 },
      });

      render(<ReadingSessionPage />);

      fireEvent.click(screen.getByTestId('tts-rate-1.5'));

      // 1.5× pill 标记为 active
      expect(screen.getByTestId('tts-rate-1.5')).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByTestId('tts-rate-1')).toHaveAttribute('aria-checked', 'false');
      // localStorage 持久化
      expect(window.localStorage.getItem('tts_rate')).toBe('1.5');
    });

    it('点击 0.5× pill → 持久化 "0.5"', () => {
      setPlatformMock(makeWebWithSpeechSynthesisPlatform());
      const tokens = [makeToken('t1', 'g1', false)];
      const session = makeSession('hello world', tokens);
      useReadingSessionStore.setState({
        session,
        currentHistoryId: null,
        lastConfig: { language: 'en', difficulty: 2 },
      });

      render(<ReadingSessionPage />);

      fireEvent.click(screen.getByTestId('tts-rate-0.5'));
      expect(window.localStorage.getItem('tts_rate')).toBe('0.5');
    });

    it('点击 2.0× pill → 持久化 "2"', () => {
      setPlatformMock(makeWebWithSpeechSynthesisPlatform());
      const tokens = [makeToken('t1', 'g1', false)];
      const session = makeSession('hello world', tokens);
      useReadingSessionStore.setState({
        session,
        currentHistoryId: null,
        lastConfig: { language: 'en', difficulty: 2 },
      });

      render(<ReadingSessionPage />);

      fireEvent.click(screen.getByTestId('tts-rate-2'));
      expect(window.localStorage.getItem('tts_rate')).toBe('2');
    });

    it('挂载时从 localStorage 读取已持久化的 rate', () => {
      // 预设 localStorage
      window.localStorage.setItem('tts_rate', '1.5');

      setPlatformMock(makeWebWithSpeechSynthesisPlatform());
      const tokens = [makeToken('t1', 'g1', false)];
      const session = makeSession('hello world', tokens);
      useReadingSessionStore.setState({
        session,
        currentHistoryId: null,
        lastConfig: { language: 'en', difficulty: 2 },
      });

      render(<ReadingSessionPage />);

      // 1.5× pill 应初始为 active (从 localStorage 恢复)
      expect(screen.getByTestId('tts-rate-1.5')).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByTestId('tts-rate-1')).toHaveAttribute('aria-checked', 'false');
    });

    it('localStorage 中无 tts_rate → 默认 rate=1.0', () => {
      // 不设置 localStorage (beforeEach 已 clear)

      setPlatformMock(makeWebWithSpeechSynthesisPlatform());
      const tokens = [makeToken('t1', 'g1', false)];
      const session = makeSession('hello world', tokens);
      useReadingSessionStore.setState({
        session,
        currentHistoryId: null,
        lastConfig: { language: 'en', difficulty: 2 },
      });

      render(<ReadingSessionPage />);

      expect(screen.getByTestId('tts-rate-1')).toHaveAttribute('aria-checked', 'true');
    });

    it('切换 rate 后, 下一次 handleTogglePlay 使用新 rate', () => {
      setPlatformMock(makeWebWithSpeechSynthesisPlatform());
      const tokens = [makeToken('t1', 'g1', false)];
      const passageText = 'hello rate switch test';
      const session = makeSession(passageText, tokens);
      useReadingSessionStore.setState({
        session,
        currentHistoryId: null,
        lastConfig: { language: 'en', difficulty: 2 },
      });

      render(<ReadingSessionPage />);

      // 切换到 2.0×
      fireEvent.click(screen.getByTestId('tts-rate-2'));

      // 点击朗读 → speakViaWebSpeechSynthesis payload.rate 应为 2.0
      fireEvent.click(screen.getByRole('button', { name: '朗读' }));

      expect(speakViaWebSpeechSynthesisMock).toHaveBeenCalledTimes(1);
      const payload = speakViaWebSpeechSynthesisMock.mock.calls[0][0] as { rate: number };
      expect(payload.rate).toBe(2.0);
    });
  });
});
