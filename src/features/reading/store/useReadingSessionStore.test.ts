/**
 * useReadingSessionStore.loadSession 集成测试 (T05)
 *
 * 覆盖 test_spec:
 * - T05: useReadingSessionStore.loadSession 末尾的 checkAndUnlock
 *   接收到真实的 totalWords / totalSessions (而不是 0 占位)
 *
 * 集成策略:
 * - seed useMemoryStore: 3 张卡片 (2 非 new + 1 new)
 * - seed useReadingHistoryStore: 2 条历史 (en, de)
 * - spy useAchievementStore.checkAndUnlock
 * - 调用 loadSession('en', 3)
 * - 断言 spy 的第一个参数 ctx.totalWords / totalSessions / languages
 *   都是从 store 派生的真实值
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useReadingSessionStore } from './useReadingSessionStore';
import { useMemoryStore } from '../../review/store/useMemoryStore';
import { useReadingHistoryStore } from './useReadingHistoryStore';
import { useAchievementStore } from '../../achievements/store/useAchievementStore';
import { useStreakStore } from '../../streak/store/useStreakStore';
import type { MemoryCard, Passage, TokenOccurrence } from '../../../types';

function makeCard(
  partial: Partial<MemoryCard> & Pick<MemoryCard, 'lexemeGroupId' | 'lemma' | 'objectiveDifficulty'>,
): MemoryCard {
  return {
    id: `card-${partial.lexemeGroupId}`,
    lexemeGroupId: partial.lexemeGroupId,
    lemma: partial.lemma,
    objectiveDifficulty: partial.objectiveDifficulty,
    firstLearnedAt: 0,
    lastReviewAt: 0,
    learningSteps: 0,
    due: 0,
    stability: 0,
    difficulty: 0,
    elapsedDays: 0,
    scheduledDays: 0,
    reps: partial.reps ?? 0,
    lapses: partial.lapses ?? 0,
    status: partial.status ?? 'new',
  };
}

function seedCards(cards: MemoryCard[]): void {
  const map = new Map<string, MemoryCard>();
  for (const c of cards) map.set(c.lexemeGroupId, c);
  useMemoryStore.setState({ cards: map });
}

function makeMockPassage(language: 'en' | 'de', difficulty: number): Passage {
  return {
    id: `passage-${language}-${difficulty}`,
    language,
    difficulty: difficulty as 1 | 2 | 3 | 4 | 5,
    text: 'mock text',
    tokens: [],
    lexemeGroups: [],
    grammarPoints: [],
  };
}

beforeEach(() => {
  useMemoryStore.setState({ cards: new Map() });
  useReadingHistoryStore.setState({ history: [], maxHistory: 50 });
  useStreakStore.setState({ currentStreak: 0, lastStudyDate: null });
  // 恢复可能的 mock 副作用
  vi.restoreAllMocks();
});

describe('useReadingSessionStore.loadSession T05', () => {
  it('checkAndUnlock 接收到真实的 totalWords / totalSessions / languages', async () => {
    // 1. seed memory: 3 cards (2 non-new + 1 new)
    seedCards([
      makeCard({ lexemeGroupId: 'g1', lemma: 'a', objectiveDifficulty: 1, status: 'review', reps: 2 }),
      makeCard({ lexemeGroupId: 'g2', lemma: 'b', objectiveDifficulty: 2, status: 'learning' }),
      makeCard({ lexemeGroupId: 'g3', lemma: 'c', objectiveDifficulty: 3, status: 'new' }),
    ]);

    // 2. seed history: 2 entries (en + de)
    // loadSession 会再 addEntry 一条, 所以最终 totalSessions = 3
    useReadingHistoryStore.setState({
      history: [
        {
          id: 'h1',
          passage: makeMockPassage('en', 2),
          language: 'en',
          difficulty: 2,
          startedAt: Date.now() - 10_000,
          resolvedCount: 5,
          totalTokenCount: 7,
        },
        {
          id: 'h2',
          passage: makeMockPassage('de', 3),
          language: 'de',
          difficulty: 3,
          startedAt: Date.now() - 20_000,
          resolvedCount: 3,
          totalTokenCount: 8,
        },
      ],
      maxHistory: 50,
    });

    // 3. spy checkAndUnlock
    const checkSpy = vi.fn();
    const achievementState = useAchievementStore.getState();
    vi.spyOn(useAchievementStore, 'getState').mockReturnValue({
      ...achievementState,
      checkAndUnlock: checkSpy,
    });

    // 4. call loadSession
    await useReadingSessionStore.getState().loadSession('en', 3);

    // 5. assert
    expect(checkSpy).toHaveBeenCalledTimes(1);
    const ctx = checkSpy.mock.calls[0]?.[0];
    expect(ctx).toBeDefined();
    // totalWords = useMemoryStore.getState().getCardCount() = 3
    expect(ctx.totalWords).toBe(3);
    // totalSessions = history.length (loadSession 已 addEntry 一条, 所以 2 + 1 = 3)
    expect(ctx.totalSessions).toBe(3);
    // languages = distinct languages from history (en, de, 以及本次新加的 en)
    expect(ctx.languages).toEqual(expect.arrayContaining(['en', 'de']));
    expect(ctx.languages.length).toBeGreaterThanOrEqual(2);
  });

  it('history 为空时 totalSessions=1 (本次会话计入), languages 包含本次语言', async () => {
    // 仅 1 张卡片
    seedCards([makeCard({ lexemeGroupId: 'g1', lemma: 'a', objectiveDifficulty: 1 })]);

    const checkSpy = vi.fn();
    const achievementState = useAchievementStore.getState();
    vi.spyOn(useAchievementStore, 'getState').mockReturnValue({
      ...achievementState,
      checkAndUnlock: checkSpy,
    });

    await useReadingSessionStore.getState().loadSession('en', 2);

    expect(checkSpy).toHaveBeenCalledTimes(1);
    const ctx = checkSpy.mock.calls[0]?.[0];
    expect(ctx.totalWords).toBe(1);
    // loadSession 自身会 addEntry, 所以 totalSessions === 1
    expect(ctx.totalSessions).toBe(1);
    expect(ctx.languages).toEqual(['en']);
  });
});

/**
 * v2.1.0 Stage 4 (Contract 68): loadFromHistory resetResolved + setLastConfig 测试
 *
 * 覆盖 test_spec:
 * - T19a: loadFromHistory(passage, 'en', 2, { resetResolved: true })
 *         → resolvedTokens.size === 0, all token.isResolved === false, isReplay === false
 *         (v2.2.1 Stage 1 Bug 2 P1: resetResolved=true 时 isReplay=false, 让用户能真正作答)
 * - T19b: loadFromHistory(passage, 'en', 2) (无 options)
 *         → resolvedTokens 包含原 isResolved=true 的 token id (向后兼容)
 * - T19c: loadFromHistory(passage, 'en', 2, { resetResolved: false })
 *         → 同默认行为 (resolvedTokens 包含原 isResolved tokens)
 * - T19d: setLastConfig setter 正确更新 lastConfig
 * - T19e: resetResolved=true 不修改原 passage 对象 (深拷贝)
 */
function makePassageWithTokens(resolvedFlags: boolean[]): Passage {
  const tokens: TokenOccurrence[] = resolvedFlags.map((isResolved, i) => ({
    id: `tok-${i}`,
    lexemeGroupId: `grp-${i}`,
    surfaceForm: `word${i}`,
    lemma: `word${i}`,
    objectiveDifficulty: 2,
    startIndex: i * 6,
    endIndex: i * 6 + 5,
    isResolved,
    isActive: false,
    kind: 'normal' as const,
    isCompound: false,
    alignmentStatus: 'perfect',
    originalOffset: 0,
  }));
  return {
    id: 'test-passage-reset',
    language: 'en',
    difficulty: 2,
    text: tokens.map((t) => t.surfaceForm).join(' '),
    tokens,
    lexemeGroups: [],
    grammarPoints: [],
  };
}

describe('useReadingSessionStore loadFromHistory resetResolved (v2.1.0 Stage 4 Contract 68)', () => {
  beforeEach(() => {
    useMemoryStore.setState({ cards: new Map() });
    useReadingHistoryStore.setState({ history: [], maxHistory: 50 });
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
    vi.restoreAllMocks();
  });

  it('T19a: resetResolved=true → resolvedTokens 清空, tokens.isResolved 全 false, isReplay=false', () => {
    const passage = makePassageWithTokens([true, false, true, true]);
    useReadingSessionStore.getState().loadFromHistory(passage, 'en', 2, { resetResolved: true });

    const state = useReadingSessionStore.getState();
    expect(state.session).not.toBeNull();
    expect(state.session!.resolvedTokens.size).toBe(0);
    expect(state.session!.passage.tokens.every((t) => !t.isResolved)).toBe(true);
    // v2.2.1 Stage 1 (Bug 2 P1): resetResolved=true (重新练习) → isReplay=false, 允许作答.
    expect(state.session!.isReplay).toBe(false);
  });

  it('T19b: 无 options (默认) → resolvedTokens 包含原 isResolved=true 的 token id', () => {
    const passage = makePassageWithTokens([true, false, true, true]);
    useReadingSessionStore.getState().loadFromHistory(passage, 'en', 2);

    const state = useReadingSessionStore.getState();
    expect(state.session).not.toBeNull();
    // 原 passage 有 3 个 isResolved=true (tok-0, tok-2, tok-3)
    expect(state.session!.resolvedTokens.size).toBe(3);
    expect(state.session!.resolvedTokens.has('tok-0')).toBe(true);
    expect(state.session!.resolvedTokens.has('tok-2')).toBe(true);
    expect(state.session!.resolvedTokens.has('tok-3')).toBe(true);
    expect(state.session!.resolvedTokens.has('tok-1')).toBe(false);
  });

  it('T19c: resetResolved=false → 同默认行为 (resolvedTokens 包含原 isResolved tokens)', () => {
    const passage = makePassageWithTokens([true, false, true]);
    useReadingSessionStore.getState().loadFromHistory(passage, 'en', 2, { resetResolved: false });

    const state = useReadingSessionStore.getState();
    expect(state.session).not.toBeNull();
    expect(state.session!.resolvedTokens.size).toBe(2);
    expect(state.session!.resolvedTokens.has('tok-0')).toBe(true);
    expect(state.session!.resolvedTokens.has('tok-2')).toBe(true);
  });

  it('T19d: setLastConfig setter 正确更新 lastConfig', () => {
    useReadingSessionStore.getState().setLastConfig({ language: 'de', difficulty: 3 });
    expect(useReadingSessionStore.getState().lastConfig).toEqual({ language: 'de', difficulty: 3 });

    useReadingSessionStore.getState().setLastConfig({ language: 'en', difficulty: 1 });
    expect(useReadingSessionStore.getState().lastConfig).toEqual({ language: 'en', difficulty: 1 });
  });

  it('T19e: resetResolved=true 不修改原 passage 对象 (深拷贝)', () => {
    const passage = makePassageWithTokens([true, false, true]);
    const originalResolvedFlags = passage.tokens.map((t) => t.isResolved);

    useReadingSessionStore.getState().loadFromHistory(passage, 'en', 2, { resetResolved: true });

    // 原 passage 对象的 tokens 不受影响
    expect(passage.tokens.map((t) => t.isResolved)).toEqual(originalResolvedFlags);
    expect(passage.tokens[0].isResolved).toBe(true);
  });
});
