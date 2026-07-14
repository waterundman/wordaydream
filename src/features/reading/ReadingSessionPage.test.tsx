/**
 * ReadingSessionPage "读下一篇" CTA 测试 (v2.1.0 Stage 2, Contract 64)
 *
 * 覆盖 test_spec:
 * - T11a [integration, critical]: 全部 token resolved + 非 replay → 渲染 "读下一篇" CTA
 *   + "本篇词汇已全部掌握" 文案
 * - T11b [integration]: 未全部 resolved → 不渲染 CTA
 * - T11c [integration]: isReplay=true + 全部 resolved → 不渲染 CTA (只读模式)
 * - T11d [integration, critical]: 点击 "读下一篇" → 调用 loadSession (handleGenerate)
 * - T11e [integration]: 全部 resolved 时 completeEntry 被调用 (Contract 63 集成验证)
 *
 * 实现策略:
 * - 直接通过 setState 设置 useReadingSessionStore (session + currentHistoryId + mock loadSession)
 * - seed useReadingHistoryStore (history entry, 供 completeEntry 查找)
 * - seed useMemoryStore (empty cards, 避免 addCardFromToken 副作用)
 * - seed useWordlistStore (linearMode=false, mock getLevelTotal 避免文件加载)
 * - render ReadingSessionPage, 断言 CTA 文本和点击行为
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ReadingSessionPage } from './ReadingSessionPage';
import { useReadingSessionStore } from './store/useReadingSessionStore';
import { useReadingHistoryStore } from './store/useReadingHistoryStore';
import { useMemoryStore } from '../review/store/useMemoryStore';
import { useWordlistStore } from '../wordlist/store/useWordlistStore';
import { subscribe, clearAllListeners, type ReadingCompletedPayload } from '../../domain/events';
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
  clearAllListeners();
  // Mock getLevelTotal 避免加载词表文件
  vi.spyOn(useWordlistStore, 'getState').mockReturnValue({
    ...useWordlistStore.getState(),
    getLevelTotal: vi.fn().mockResolvedValue(0),
    isLevelUnlocked: () => true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  clearAllListeners();
  cleanup();
});

describe('ReadingSessionPage "读下一篇" CTA (v2.1.0 Stage 2 Contract 64)', () => {
  it('T11a: 全部 token resolved + 非 replay → 渲染 "读下一篇" CTA + 完成文案', () => {
    const tokens = [
      makeToken('t1', 'g1', true),
      makeToken('t2', 'g2', true),
    ];
    const session = makeSession(tokens);
    useReadingSessionStore.setState({
      session,
      currentHistoryId: 'h-1',
      lastConfig: { language: 'en', difficulty: 2 },
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

    expect(screen.getByText('读下一篇')).toBeInTheDocument();
    expect(screen.getByText('本篇词汇已全部掌握')).toBeInTheDocument();
  });

  it('T11b: 未全部 resolved → 不渲染 CTA', () => {
    const tokens = [
      makeToken('t1', 'g1', true),
      makeToken('t2', 'g2', false),
    ];
    const session = makeSession(tokens);
    useReadingSessionStore.setState({
      session,
      currentHistoryId: 'h-2',
      lastConfig: { language: 'en', difficulty: 2 },
    });

    render(<ReadingSessionPage />);

    expect(screen.queryByText('读下一篇')).not.toBeInTheDocument();
    expect(screen.queryByText('本篇词汇已全部掌握')).not.toBeInTheDocument();
  });

  it('T11c: isReplay=true + 全部 resolved → 不渲染 CTA (只读模式)', () => {
    const tokens = [
      makeToken('t1', 'g1', true),
      makeToken('t2', 'g2', true),
    ];
    const session = makeSession(tokens, true);
    useReadingSessionStore.setState({
      session,
      currentHistoryId: null,
      lastConfig: { language: 'en', difficulty: 2 },
    });

    render(<ReadingSessionPage />);

    expect(screen.queryByText('读下一篇')).not.toBeInTheDocument();
    expect(screen.queryByText('本篇词汇已全部掌握')).not.toBeInTheDocument();
  });

  it('T11d: 点击 "读下一篇" → 调用 loadSession', () => {
    const tokens = [
      makeToken('t1', 'g1', true),
      makeToken('t2', 'g2', true),
    ];
    const session = makeSession(tokens);
    const loadSessionSpy = vi.fn().mockResolvedValue(undefined);
    useReadingSessionStore.setState({
      session,
      currentHistoryId: 'h-3',
      lastConfig: { language: 'en', difficulty: 2 },
      loadSession: loadSessionSpy,
    });
    useReadingHistoryStore.setState({
      history: [{
        id: 'h-3',
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
    fireEvent.click(screen.getByText('读下一篇'));

    expect(loadSessionSpy).toHaveBeenCalledTimes(1);
    expect(loadSessionSpy).toHaveBeenCalledWith('en', 2);
  });

  it('T11e: 全部 resolved 时 completeEntry 被调用 → 发布 reading:completed', () => {
    const tokens = [
      makeToken('t1', 'g1', true),
      makeToken('t2', 'g2', true),
    ];
    const session = makeSession(tokens);
    useReadingSessionStore.setState({
      session,
      currentHistoryId: 'h-4',
      lastConfig: { language: 'en', difficulty: 2 },
    });
    useReadingHistoryStore.setState({
      history: [{
        id: 'h-4',
        passage: session.passage,
        language: 'en',
        difficulty: 2,
        startedAt: Date.now() - 10000,
        resolvedCount: 0,
        totalTokenCount: 2,
      }],
      maxHistory: 50,
    });

    const received: ReadingCompletedPayload[] = [];
    subscribe<ReadingCompletedPayload>('reading:completed', (p) => received.push(p));

    render(<ReadingSessionPage />);

    // effect 在 mount 后同步执行 (useEffect), completeEntry 被调用 → publish
    expect(received).toHaveLength(1);
    expect(received[0].entryId).toBe('h-4');
    expect(received[0].language).toBe('en');
    expect(received[0].difficulty).toBe(2);
  });
});

/**
 * v2.1.0 Stage 4 (Contract 68): ReadingSessionPage "重新练习" 按钮测试
 *
 * 覆盖 test_spec:
 * - T21a: isReplay=true → "重新练习" 按钮存在
 * - T21b: isReplay=true → "本篇词汇已全部掌握" CTA 不存在 (isReadingCompleted=false)
 * - T21c: 点击 "重新练习" → loadFromHistory 被调用, 第 4 参数为 { resetResolved: true }
 * - T21d: isReplay=false → "重新练习" 按钮不存在
 *
 * 设计:
 * - 复用上方 makeToken/makePassage/makeSession 工具函数
 * - isReplay=true 的 session + mock loadFromHistory 为 vi.fn() spy
 * - 不破坏已有 T11a-T11e 测试 (新增 describe block, 共享 beforeEach)
 */
describe('ReadingSessionPage "重新练习" 按钮 (v2.1.0 Stage 4 Contract 68)', () => {
  it('T21a: isReplay=true → "重新练习" 按钮存在', () => {
    const tokens = [
      makeToken('t1', 'g1', false),
      makeToken('t2', 'g2', false),
    ];
    const session = makeSession(tokens, true);
    useReadingSessionStore.setState({
      session,
      currentHistoryId: null,
      lastConfig: { language: 'en', difficulty: 2 },
    });

    render(<ReadingSessionPage />);

    expect(screen.getByText('重新练习')).toBeInTheDocument();
    expect(screen.getByText('这是历史重读模式，词汇作答已禁用。')).toBeInTheDocument();
  });

  it('T21b: isReplay=true → "本篇词汇已全部掌握" CTA 不存在', () => {
    const tokens = [
      makeToken('t1', 'g1', true),
      makeToken('t2', 'g2', true),
    ];
    const session = makeSession(tokens, true);
    useReadingSessionStore.setState({
      session,
      currentHistoryId: null,
      lastConfig: { language: 'en', difficulty: 2 },
    });

    render(<ReadingSessionPage />);

    expect(screen.queryByText('本篇词汇已全部掌握')).not.toBeInTheDocument();
    expect(screen.queryByText('读下一篇')).not.toBeInTheDocument();
  });

  it('T21c: 点击 "重新练习" → loadFromHistory 被调用, 第 4 参数为 { resetResolved: true }', () => {
    const tokens = [
      makeToken('t1', 'g1', true),
      makeToken('t2', 'g2', false),
    ];
    const session = makeSession(tokens, true);
    const loadFromHistorySpy = vi.fn();
    useReadingSessionStore.setState({
      session,
      currentHistoryId: null,
      lastConfig: { language: 'en', difficulty: 2 },
      loadFromHistory: loadFromHistorySpy,
    });

    render(<ReadingSessionPage />);

    fireEvent.click(screen.getByText('重新练习'));

    expect(loadFromHistorySpy).toHaveBeenCalledTimes(1);
    // 验证第 1-3 参数 (passage, language, difficulty)
    expect(loadFromHistorySpy.mock.calls[0][0]).toBe(session.passage);
    expect(loadFromHistorySpy.mock.calls[0][1]).toBe('en');
    expect(loadFromHistorySpy.mock.calls[0][2]).toBe(2);
    // 验证第 4 参数 (options) 为 { resetResolved: true }
    expect(loadFromHistorySpy.mock.calls[0][3]).toEqual({ resetResolved: true });
  });

  it('T21d: isReplay=false → "重新练习" 按钮不存在', () => {
    const tokens = [
      makeToken('t1', 'g1', false),
      makeToken('t2', 'g2', false),
    ];
    const session = makeSession(tokens, false);
    useReadingSessionStore.setState({
      session,
      currentHistoryId: 'h-replay-2',
      lastConfig: { language: 'en', difficulty: 2 },
    });
    useReadingHistoryStore.setState({
      history: [{
        id: 'h-replay-2',
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

    expect(screen.queryByText('重新练习')).not.toBeInTheDocument();
    expect(screen.queryByText('这是历史重读模式，词汇作答已禁用。')).not.toBeInTheDocument();
  });
});
