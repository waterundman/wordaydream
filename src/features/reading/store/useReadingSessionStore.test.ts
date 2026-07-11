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
import type { MemoryCard, Passage } from '../../../types';

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
