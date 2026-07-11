/**
 * useHomeAnalytics hook 单元测试
 *
 * 覆盖 test_spec:
 * - T01: cards 为空时 total=0, mastered=0, masteryRate=0
 * - T02: 3/5 cards 非 'new' 时 totalLearned === 3
 * - T03: byLevel[1..5] 之和 === total
 * - T04: masteryRate = mastered/total, total=0 时 === 0
 *
 * T05 (loadSession 真实参数) 单独放在 useReadingSessionStore.test.ts,
 * 因为它需要 mock useAchievementStore.checkAndUnlock 并触发完整 store 调用链,
 * 与本 hook 的纯派生语义不耦合。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useHomeAnalytics } from './useHomeAnalytics';
import { useMemoryStore } from '../../review/store/useMemoryStore';
import type { MemoryCard, DifficultyLevel } from '../../../types';

function makeCard(partial: Partial<MemoryCard> & Pick<MemoryCard, 'lexemeGroupId' | 'lemma' | 'objectiveDifficulty'>): MemoryCard {
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
  for (const card of cards) {
    map.set(card.lexemeGroupId, card);
  }
  useMemoryStore.setState({ cards: map });
}

beforeEach(() => {
  // 每个测试前重置 cards, 避免持久化状态泄漏
  useMemoryStore.setState({ cards: new Map() });
});

describe('useHomeAnalytics', () => {
  it('T01: cards 为空时返回 total=0, mastered=0, masteryRate=0', () => {
    const { result } = renderHook(() => useHomeAnalytics());

    expect(result.current.total).toBe(0);
    expect(result.current.mastered).toBe(0);
    expect(result.current.masteryRate).toBe(0);
    expect(result.current.totalLearned).toBe(0);
    // byLevel 字段结构应保持齐整, 即便计数为 0
    expect(result.current.byLevel).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
    expect(result.current.byStatus).toEqual({ new: 0, learning: 0, review: 0, relearning: 0 });
  });

  it('T02: 3/5 cards 非 new 时 totalLearned === 3', () => {
    seedCards([
      makeCard({ lexemeGroupId: 'g1', lemma: 'alpha', objectiveDifficulty: 1, status: 'new' }),
      makeCard({ lexemeGroupId: 'g2', lemma: 'beta', objectiveDifficulty: 2, status: 'new' }),
      makeCard({ lexemeGroupId: 'g3', lemma: 'gamma', objectiveDifficulty: 3, status: 'learning', reps: 1 }),
      makeCard({ lexemeGroupId: 'g4', lemma: 'delta', objectiveDifficulty: 4, status: 'review', reps: 1 }),
      makeCard({ lexemeGroupId: 'g5', lemma: 'epsilon', objectiveDifficulty: 5, status: 'review', reps: 2 }),
    ]);

    const { result } = renderHook(() => useHomeAnalytics());

    expect(result.current.total).toBe(5);
    expect(result.current.totalLearned).toBe(3);
  });

  it('T03: byLevel[1..5] 之和 === total', () => {
    seedCards([
      makeCard({ lexemeGroupId: 'g1', lemma: 'a', objectiveDifficulty: 1 }),
      makeCard({ lexemeGroupId: 'g2', lemma: 'b', objectiveDifficulty: 2 }),
      makeCard({ lexemeGroupId: 'g3', lemma: 'c', objectiveDifficulty: 3 }),
      makeCard({ lexemeGroupId: 'g4', lemma: 'd', objectiveDifficulty: 4 }),
      makeCard({ lexemeGroupId: 'g5', lemma: 'e', objectiveDifficulty: 5 }),
      makeCard({ lexemeGroupId: 'g6', lemma: 'f', objectiveDifficulty: 2 }),
    ]);

    const { result } = renderHook(() => useHomeAnalytics());

    const sum: number = ([1, 2, 3, 4, 5] as DifficultyLevel[]).reduce(
      (acc, lv) => acc + result.current.byLevel[lv],
      0,
    );
    expect(sum).toBe(result.current.total);
    expect(result.current.total).toBe(6);
    expect(result.current.byLevel[1]).toBe(1);
    expect(result.current.byLevel[2]).toBe(2);
    expect(result.current.byLevel[3]).toBe(1);
    expect(result.current.byLevel[4]).toBe(1);
    expect(result.current.byLevel[5]).toBe(1);
  });

  it('T04a: masteryRate = mastered/total (total > 0)', () => {
    seedCards([
      makeCard({ lexemeGroupId: 'g1', lemma: 'a', objectiveDifficulty: 1, status: 'review', reps: 2 }),
      makeCard({ lexemeGroupId: 'g2', lemma: 'b', objectiveDifficulty: 2, status: 'review', reps: 3 }),
      makeCard({ lexemeGroupId: 'g3', lemma: 'c', objectiveDifficulty: 3, status: 'review', reps: 2 }),
      makeCard({ lexemeGroupId: 'g4', lemma: 'd', objectiveDifficulty: 4, status: 'new', reps: 0 }),
    ]);

    const { result } = renderHook(() => useHomeAnalytics());

    expect(result.current.total).toBe(4);
    expect(result.current.mastered).toBe(3);
    expect(result.current.masteryRate).toBe(3 / 4);
  });

  it('T04b: masteryRate = 0 when total = 0', () => {
    // 直接用 beforeEach 已经清空的 cards
    const { result } = renderHook(() => useHomeAnalytics());

    expect(result.current.total).toBe(0);
    expect(result.current.masteryRate).toBe(0);
  });

  it('mastered 不计入 reps < 2 的 review 卡片', () => {
    seedCards([
      makeCard({ lexemeGroupId: 'g1', lemma: 'a', objectiveDifficulty: 1, status: 'review', reps: 1 }),
      makeCard({ lexemeGroupId: 'g2', lemma: 'b', objectiveDifficulty: 2, status: 'review', reps: 2 }),
    ]);

    const { result } = renderHook(() => useHomeAnalytics());

    expect(result.current.mastered).toBe(1);
  });

  it('byStatus 统计各 status 计数', () => {
    seedCards([
      makeCard({ lexemeGroupId: 'g1', lemma: 'a', objectiveDifficulty: 1, status: 'new' }),
      makeCard({ lexemeGroupId: 'g2', lemma: 'b', objectiveDifficulty: 2, status: 'learning' }),
      makeCard({ lexemeGroupId: 'g3', lemma: 'c', objectiveDifficulty: 3, status: 'review', reps: 2 }),
      makeCard({ lexemeGroupId: 'g4', lemma: 'd', objectiveDifficulty: 4, status: 'relearning' }),
    ]);

    const { result } = renderHook(() => useHomeAnalytics());

    expect(result.current.byStatus).toEqual({
      new: 1,
      learning: 1,
      review: 1,
      relearning: 1,
    });
  });
});
