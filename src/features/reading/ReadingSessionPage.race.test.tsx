/**
 * v2.2.1 Stage 1 (Bug 2): ReadingSessionPage 竞态 + useEffect 依赖测试.
 *
 * 覆盖 test_spec:
 * - T04 [critical]: isLoading=true 时 handleReRead 不调用 loadFromHistory
 * - T06 [non-critical]: useEffect 依赖数组不含 session.passage.tokens
 *   (markOccurrenceResolved 产生新 tokens 引用时不重触发 addCardFromToken)
 *
 * Mock 策略:
 * - T04: 设置 isLoading=true + 替换 loadFromHistory 为 spy, 点击历史记录 "重新阅读" 按钮,
 *        断言 spy 未被调用.
 * - T06: 设置含 1 个已 resolved token 的 session, spy addCardFromToken,
 *        调用 markOccurrenceResolved (同一 token) 产生新 tokens 引用但 resolvedTokens.size 不变,
 *        断言 addCardFromToken 未被再次调用 (effect 未重触发).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { ReadingSessionPage } from './ReadingSessionPage';
import { useReadingSessionStore } from './store/useReadingSessionStore';
import { useReadingHistoryStore } from './store/useReadingHistoryStore';
import { useMemoryStore } from '../review/store/useMemoryStore';
import { useWordlistStore } from '../wordlist/store/useWordlistStore';
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

function makeSession(tokens: TokenOccurrence[], isReplay = false): ReadingSession {
  const resolvedIds = tokens.filter((t) => t.isResolved).map((t) => t.id);
  return {
    id: `session-${Date.now()}`,
    language: 'en' as Language,
    difficulty: 2 as DifficultyLevel,
    passage: makePassage(tokens),
    startedAt: Date.now(),
    resolvedTokens: new Set(resolvedIds),
    activeOccurrenceId: null,
    ...(isReplay ? { isReplay: true } : {}),
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
  // Mock getLevelTotal 避免加载词表文件
  vi.spyOn(useWordlistStore, 'getState').mockReturnValue({
    ...useWordlistStore.getState(),
    getLevelTotal: vi.fn().mockResolvedValue(0),
    isLevelUnlocked: () => true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe('v2.2.1 Stage 1 (Bug 2 P0): handleReRead isLoading 守卫', () => {
  it('T04 [critical]: isLoading=true 时点击历史 "重新阅读" 不调用 loadFromHistory', () => {
    const tokens = [
      makeToken('t1', 'g1', false),
      makeToken('t2', 'g2', false),
    ];
    const session = makeSession(tokens);
    const loadFromHistorySpy = vi.fn();
    const loadSessionSpy = vi.fn().mockResolvedValue(undefined);
    // 设置 isLoading=true + session (防止 mount effect 自动触发 loadSession)
    useReadingSessionStore.setState({
      session,
      currentHistoryId: 'h-1',
      isLoading: true,
      lastConfig: { language: 'en', difficulty: 2 },
      loadFromHistory: loadFromHistorySpy,
      loadSession: loadSessionSpy,
    });
    useReadingHistoryStore.setState({
      history: [{
        id: 'h-1',
        passage: session.passage,
        language: 'en',
        difficulty: 2,
        startedAt: Date.now() - 10000,
        resolvedCount: 0,
        totalTokenCount: 2,
      }],
      maxHistory: 50,
    });

    render(<ReadingSessionPage />);

    // 历史面板的 "重新阅读" 按钮始终在 DOM 中 (CSS 控制可见性, jsdom 不应用 CSS)
    const rereadButton = screen.getByRole('button', { name: '重新阅读' });
    fireEvent.click(rereadButton);

    // isLoading=true 时 handleReRead 应提前 return, 不调用 loadFromHistory
    expect(loadFromHistorySpy).not.toHaveBeenCalled();
  });
});

describe('v2.2.1 Stage 1 (Bug 2 P2): useEffect 依赖数组修正', () => {
  it('T06 [non-critical]: markOccurrenceResolved 产生新 tokens 引用时不重触发 addCardFromToken', () => {
    // 构造含 1 个已 resolved token 的 session (resolvedTokens.size = 1)
    const tokens = [
      makeToken('t1', 'g1', true),
      makeToken('t2', 'g2', false),
    ];
    const session = makeSession(tokens);
    const loadSessionSpy = vi.fn().mockResolvedValue(undefined);
    useReadingSessionStore.setState({
      session,
      currentHistoryId: 'h-dep',
      isLoading: false,
      lastConfig: { language: 'en', difficulty: 2 },
      loadSession: loadSessionSpy,
    });
    useReadingHistoryStore.setState({
      history: [{
        id: 'h-dep',
        passage: session.passage,
        language: 'en',
        difficulty: 2,
        startedAt: Date.now() - 10000,
        resolvedCount: 1,
        totalTokenCount: 2,
      }],
      maxHistory: 50,
    });

    // Spy addCardFromToken: 阻止真实副作用, 仅追踪调用次数
    const addCardSpy = vi
      .spyOn(useMemoryStore.getState(), 'addCardFromToken')
      .mockReturnValue({} as never);

    render(<ReadingSessionPage />);

    // Mount 后 effect 触发一次: 为已 resolved 的 t1 调用 addCardFromToken
    expect(addCardSpy).toHaveBeenCalledTimes(1);

    // 调用 markOccurrenceResolved 同一已 resolved token:
    // - 产生新 tokens 数组引用 (.map)
    // - 产生新 resolvedTokens Set (new Set(...)), 但 .size 不变 (t1 已在集合中)
    act(() => {
      useReadingSessionStore.getState().markOccurrenceResolved('t1');
    });

    // 依赖数组 [resolvedTokens.size, addCardFromToken, isReplay] 均未变 → effect 不重触发
    // 若旧依赖数组含 session.passage.tokens, 新引用会触发 effect → addCardFromToken 再次调用 (bug)
    expect(addCardSpy).toHaveBeenCalledTimes(1);
  });
});
