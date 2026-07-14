/**
 * v2.2.0 Stage 1 (D4): ReadingSessionPage source badge 渲染测试.
 *
 * 覆盖 test_spec:
 * - T07 [critical]: ReadingSessionPage 渲染 source badge
 *   - source='llm' → "AI 生成"
 *   - source='mock' → "演示数据"
 *   - source=undefined → "演示数据" (保守显示)
 *   - source='mixed' → "AI 生成 (部分)"
 *
 * 实现策略:
 * - 直接通过 setState 设置 useReadingSessionStore (session with passage.source)
 * - mock useWordlistStore.getState 避免加载词表文件
 * - render ReadingSessionPage, 断言 badge 文本和 data-testid
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ReadingSessionPage } from './ReadingSessionPage';
import { useReadingSessionStore } from './store/useReadingSessionStore';
import { useReadingHistoryStore } from './store/useReadingHistoryStore';
import { useMemoryStore } from '../review/store/useMemoryStore';
import { useWordlistStore } from '../wordlist/store/useWordlistStore';
import type { Passage, ReadingSession, TokenOccurrence } from '../../types';

function makeToken(id: string, lexemeGroupId: string): TokenOccurrence {
  return {
    id,
    lexemeGroupId,
    surfaceForm: id,
    lemma: id,
    objectiveDifficulty: 2,
    startIndex: 0,
    endIndex: 1,
    isResolved: false,
    isActive: false,
    kind: 'normal',
    isCompound: false,
    alignmentStatus: 'perfect',
    originalOffset: 0,
  };
}

function makePassage(source: Passage['source']): Passage {
  return {
    id: `passage-${Date.now()}`,
    language: 'en',
    difficulty: 2,
    text: 'The cat sat on the mat.',
    tokens: [makeToken('t1', 'g1')],
    lexemeGroups: [],
    grammarPoints: [],
    source,
  };
}

function makeSession(passage: Passage): ReadingSession {
  return {
    id: `session-${Date.now()}`,
    language: 'en',
    difficulty: 2,
    passage,
    startedAt: Date.now(),
    resolvedTokens: new Set(),
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
  // jsdom 默认不实现 matchMedia, usePageEntranceAnimation (InteractivePassage 内部使用)
  // 在 useEffect 启动时调用它. 提前 stub 避免渲染阶段抛 TypeError.
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

describe('v2.2.0 Stage 1 (D4): ReadingSessionPage source badge', () => {
  it('T07 [critical]: source="llm" → badge 显示 "AI 生成"', () => {
    const passage = makePassage('llm');
    const session = makeSession(passage);
    useReadingSessionStore.setState({
      session,
      lastConfig: { language: 'en', difficulty: 2 },
    });

    render(<ReadingSessionPage />);

    const badge = screen.getByTestId('passage-source-badge');
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toContain('AI 生成');
    expect(badge.textContent).not.toContain('演示数据');
  });

  it('T07b: source="mock" → badge 显示 "演示数据"', () => {
    const passage = makePassage('mock');
    const session = makeSession(passage);
    useReadingSessionStore.setState({
      session,
      lastConfig: { language: 'en', difficulty: 2 },
    });

    render(<ReadingSessionPage />);

    const badge = screen.getByTestId('passage-source-badge');
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toContain('演示数据');
  });

  it('T07c: source=undefined → badge 显示 "演示数据" (保守显示)', () => {
    const passage = makePassage(undefined);
    const session = makeSession(passage);
    useReadingSessionStore.setState({
      session,
      lastConfig: { language: 'en', difficulty: 2 },
    });

    render(<ReadingSessionPage />);

    const badge = screen.getByTestId('passage-source-badge');
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toContain('演示数据');
  });

  it('T07d: source="mixed" → badge 显示 "AI 生成 (部分)"', () => {
    const passage = makePassage('mixed');
    const session = makeSession(passage);
    useReadingSessionStore.setState({
      session,
      lastConfig: { language: 'en', difficulty: 2 },
    });

    render(<ReadingSessionPage />);

    const badge = screen.getByTestId('passage-source-badge');
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toContain('AI 生成 (部分)');
  });

  it('T07e: 无 session 时不渲染 badge', () => {
    useReadingSessionStore.setState({
      session: null,
      isLoading: false,
    });

    render(<ReadingSessionPage />);

    expect(screen.queryByTestId('passage-source-badge')).not.toBeInTheDocument();
  });
});
