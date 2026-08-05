/**
 * T04: ReadingSessionPage speechSynthesis 鸿蒙降级测试 (v0.1.0-harmony Stage 2)
 *
 * 验证: supportsSpeechSynthesis=false 时朗读按钮渲染 disabled.
 *
 * Mock 策略:
 * - vi.mock('../detect') → detectPlatform 返回 supportsSpeechSynthesis=false
 * - 复用既有 ReadingSessionPage 测试的 store setup 模式:
 *   useReadingSessionStore / useReadingHistoryStore / useMemoryStore / useWordlistStore
 * - stub window.matchMedia (InteractivePassage 内部 usePageEntranceAnimation 依赖)
 * - mock useWordlistStore.getState 避免加载词表文件
 *
 * 向后兼容: useEffect cleanup 中的 window.speechSynthesis.cancel() 保留,
 * 此测试不验证 cleanup (jsdom 无 speechSynthesis, cleanup 内 'speechSynthesis' in window 守卫跳过).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock detectPlatform: 鸿蒙环境但无原生 bridge (supportsSpeechSynthesis=false + bridge=null).
// v0.3.0-harmony Stage 2: 双端都不可用 → ttsSupported=false → 朗读按钮 disabled.
vi.mock('../detect', () => ({
  detectPlatform: () => ({
    isHarmonyOS: () => true,
    supportsServiceWorker: () => false,
    supportsSpeechSynthesis: () => false,
    supportsNativeSpeech: () => false,
    supportsInstallPrompt: () => false,
    supportsNotifications: () => true,
    getNativeBridge: () => null,
  }),
}));

import { render, screen, cleanup } from '@testing-library/react';
import { ReadingSessionPage } from '../../features/reading/ReadingSessionPage';
import { useReadingSessionStore } from '../../features/reading/store/useReadingSessionStore';
import { useReadingHistoryStore } from '../../features/reading/store/useReadingHistoryStore';
import { useMemoryStore } from '../../features/review/store/useMemoryStore';
import { useWordlistStore } from '../../features/wordlist/store/useWordlistStore';
import { clearAllListeners } from '../../domain/events';
import type { Passage, ReadingSession, TokenOccurrence, Language, DifficultyLevel } from '../../types';

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

function makePassage(tokens: TokenOccurrence[]): Passage {
  return {
    id: `passage-${Date.now()}`,
    language: 'en',
    difficulty: 2,
    text: tokens.map((t) => t.surfaceForm).join(' '),
    tokens,
    lexemeGroups: [],
    grammarPoints: [],
  };
}

function makeSession(tokens: TokenOccurrence[]): ReadingSession {
  const resolvedIds = tokens.filter((t) => t.isResolved).map((t) => t.id);
  return {
    id: `session-${Date.now()}`,
    language: 'en' as Language,
    difficulty: 2 as DifficultyLevel,
    passage: makePassage(tokens),
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
  vi.spyOn(useWordlistStore, 'getState').mockReturnValue({
    ...useWordlistStore.getState(),
    getLevelTotal: vi.fn().mockResolvedValue(0),
    isLevelUnlocked: () => true,
  } as unknown as ReturnType<typeof useWordlistStore.getState>);
});

afterEach(() => {
  vi.restoreAllMocks();
  clearAllListeners();
  cleanup();
});

describe('T04 [critical]: ReadingSessionPage 朗读按钮鸿蒙降级', () => {
  it('supportsSpeechSynthesis=false → 朗读按钮渲染 disabled', () => {
    const tokens = [
      makeToken('t1', 'g1', false),
      makeToken('t2', 'g2', false),
    ];
    const session = makeSession(tokens);
    useReadingSessionStore.setState({
      session,
      currentHistoryId: null,
      lastConfig: { language: 'en', difficulty: 2 },
    });

    render(<ReadingSessionPage />);

    const playBtn = screen.getByRole('button', { name: '朗读' });
    expect(playBtn).toBeDisabled();
  });

  it('supportsSpeechSynthesis=false → 朗读按钮仍在 DOM (disabled 非 null, 提供视觉反馈)', () => {
    const tokens = [makeToken('t1', 'g1', false)];
    const session = makeSession(tokens);
    useReadingSessionStore.setState({
      session,
      currentHistoryId: null,
      lastConfig: { language: 'en', difficulty: 2 },
    });

    render(<ReadingSessionPage />);

    // 按钮存在但 disabled (符合 spec: 渲染 disabled 或 null)
    expect(screen.getByRole('button', { name: '朗读' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '朗读' })).toBeDisabled();
  });
});
