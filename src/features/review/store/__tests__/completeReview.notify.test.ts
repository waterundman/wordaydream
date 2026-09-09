/**
 * v0.5.0-harmony Stage 2 — T02 [critical]: completeReview 完成路径触发 notifyReviewCompleted 恰 1 次
 *
 * 覆盖范围:
 * - 多卡会话: 仅最后一张卡评分时触发一次, 中间卡不触发
 * - 单卡会话: 唯一一张卡评分即完成, 触发一次
 * - 失败安全: notifyReviewCompleted 抛错不影响 rateCard 主流程 (不向上传播)
 *
 * 0 emoji. 0 改动源文件.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as harmonyBridge from '../../../../platform/harmonyBridge';
import { useReviewSessionStore } from '../useReviewSessionStore';
import { useMemoryStore } from '../useMemoryStore';
import type { MemoryCard } from '../../../../types';

const notifySpy = vi
  .spyOn(harmonyBridge, 'notifyReviewCompleted')
  .mockResolvedValue({ ok: true, noop: true });

function makeCard(lexemeGroupId: string, lemma: string): MemoryCard {
  return {
    id: `card-${lexemeGroupId}`,
    lexemeGroupId,
    lemma,
    objectiveDifficulty: 2,
    firstLearnedAt: 1_700_000_000_000,
    lastReviewAt: 1_700_000_000_000,
    learningSteps: 0,
    due: 0,
    stability: 0,
    difficulty: 0,
    elapsedDays: 0,
    scheduledDays: 0,
    reps: 2,
    lapses: 0,
    status: 'review',
  };
}

function seedCards(): void {
  const a = makeCard('g1', 'apple');
  const b = makeCard('g2', 'banana');
  useMemoryStore.setState({ cards: new Map([['g1', a], ['g2', b]]) });
  useReviewSessionStore.setState({
    mode: 'reviewing',
    queue: [a, b],
    currentIndex: 0,
    results: [],
    showRatingBar: false,
  });
}

beforeEach(() => {
  notifySpy.mockClear();
  window.localStorage.clear();
  useMemoryStore.setState({ cards: new Map() });
  useReviewSessionStore.setState({
    mode: 'idle',
    queue: [],
    currentIndex: 0,
    results: [],
    showRatingBar: false,
  });
});

describe('Stage 2 — T02 [critical]: completeReview 完成路径触发 notifyReviewCompleted 恰 1 次', () => {
  it('多卡会话: 仅最后一张卡评分时触发一次, 中间卡不触发', () => {
    seedCards();

    // 评分第 1 张 (非最后) -> 不应触发
    useReviewSessionStore.getState().completeReview('good');
    expect(notifySpy).toHaveBeenCalledTimes(0);

    // 推进到索引 1 (最后一张)
    useReviewSessionStore.getState().nextCard();
    expect(useReviewSessionStore.getState().currentIndex).toBe(1);

    // 评分最后一张 -> 触发一次
    useReviewSessionStore.getState().completeReview('good');
    expect(notifySpy).toHaveBeenCalledTimes(1);
  });

  it('单卡会话: 唯一一张卡评分即完成, 触发一次', () => {
    const a = makeCard('g1', 'apple');
    useMemoryStore.setState({ cards: new Map([['g1', a]]) });
    useReviewSessionStore.setState({
      mode: 'reviewing',
      queue: [a],
      currentIndex: 0,
      results: [],
      showRatingBar: false,
    });

    useReviewSessionStore.getState().completeReview('easy');
    expect(notifySpy).toHaveBeenCalledTimes(1);
  });

  it('notifyReviewCompleted 抛错不影响 rateCard 主流程 (不向上传播)', async () => {
    notifySpy.mockRejectedValueOnce(new Error('bridge down'));
    seedCards();

    // completeReview 同步调用不抛错
    expect(() =>
      useReviewSessionStore.getState().completeReview('good')
    ).not.toThrow();

    // 推进并触发 notify (rejected), 主流程仍正常
    useReviewSessionStore.getState().nextCard();
    expect(() =>
      useReviewSessionStore.getState().completeReview('good')
    ).not.toThrow();

    await new Promise((r) => setTimeout(r, 10));
    // rateCard 已对两张卡生效 (每张 reps +1)
    const g1 = useMemoryStore.getState().cards.get('g1');
    const g2 = useMemoryStore.getState().cards.get('g2');
    expect(g1?.reps).toBe(3);
    expect(g2?.reps).toBe(3);
  });
});
