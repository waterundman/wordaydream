/**
 * completeReview → 错词本接线测试 (v0.9.0 Stage 1)
 *
 * 覆盖 test_spec:
 * - T03 [critical]: completeReview 评分路径
 *   - grade=wrong  → 错词本入账 (数量/lemma 断言)
 *   - grade=correct → 不入账
 *   - 复习主流程 results/results.length 不受影响 (恒 +1, 由 completeReview 自身行为决定)
 *
 * 注意 v0.8.0 教训: 不 spy zustand 单例 (会跨测试污染),
 * 改用状态副作用断言 (useWrongWordsStore.getState().entries 内容).
 *
 * 用长度为 2 的 queue, currentIndex=0, 使 currentIndex !== queue.length-1,
 * 规避 notifyReviewCompleted (仅末卡触发) 的异步副作用. completeReview 仍完整执行
 * rateCard / results 更新逻辑.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoryCard, AnswerEvaluation } from '../../../types';
import { useReviewSessionStore } from './useReviewSessionStore';
import { useMemoryStore } from './useMemoryStore';
import { useWrongWordsStore } from './useWrongWordsStore';

function makeCard(id: string, lemma: string, language: 'en' | 'de'): MemoryCard {
  return {
    id,
    lexemeGroupId: id,
    lemma,
    objectiveDifficulty: 2,
    language,
    firstLearnedAt: 0,
    lastReviewAt: 0,
    due: 0,
    stability: 1,
    difficulty: 1,
    elapsedDays: 0,
    scheduledDays: 1,
    reps: 0,
    lapses: 0,
    status: 'review',
    learningSteps: 0,
  };
}

function setupReview(evaluation: AnswerEvaluation | null) {
  const queue = [makeCard('lg-apple', 'apple', 'en'), makeCard('lg-banana', 'banana', 'de')];
  useReviewSessionStore.setState({
    mode: 'reviewing',
    language: 'en',
    queue,
    currentIndex: 0,
    userAnswer: '',
    evaluation,
    isEvaluating: false,
    isPaused: false,
    showRatingBar: false,
    results: [],
    startedAt: 0,
    cardContexts: {},
  });
  return queue;
}

beforeEach(() => {
  // 重置各 store 单例, 避免跨测试泄漏
  useReviewSessionStore.setState({
    mode: 'idle',
    language: 'en',
    queue: [],
    currentIndex: 0,
    userAnswer: '',
    evaluation: null,
    isEvaluating: false,
    isPaused: false,
    showRatingBar: false,
    results: [],
    startedAt: 0,
    cardContexts: {},
  });
  useMemoryStore.setState({
    cards: new Map<string, MemoryCard>(),
    dueCardsIndex: null,
    cardsByLanguageIndex: null,
  });
  useWrongWordsStore.setState({ entries: [] });
  vi.useRealTimers();
});

describe('completeReview → 错词本 接线 (Stage 1, T03)', () => {
  describe('T03 [critical]: grade=wrong 入账 / grade=correct 不入账 / 主流程不受影响', () => {
    it('T03a: evaluation.grade=wrong → 错词本入账 1 条, lemma=apple', () => {
      setupReview({ grade: 'wrong', feedback: 'x', hint: null });

      useReviewSessionStore.getState().completeReview('again');

      const entries = useWrongWordsStore.getState().entries;
      expect(entries).toHaveLength(1);
      expect(entries[0].cardId).toBe('lg-apple');
      expect(entries[0].lemma).toBe('apple');
      expect(entries[0].language).toBe('en');
      // 复习主流程: results 仍正常 +1
      expect(useReviewSessionStore.getState().results).toHaveLength(1);
    });

    it('T03b: evaluation.grade=correct → 错词本不入账', () => {
      setupReview({ grade: 'correct', feedback: 'x', hint: null });

      useReviewSessionStore.getState().completeReview('good');

      expect(useWrongWordsStore.getState().entries).toHaveLength(0);
      // 复习主流程 results 仍 +1 (与 T03a 行为一致)
      expect(useReviewSessionStore.getState().results).toHaveLength(1);
    });

    it('T03c: evaluation.grade=partial → 错词本不入账 (partial 不算错词)', () => {
      setupReview({ grade: 'partial', feedback: 'x', hint: null });

      useReviewSessionStore.getState().completeReview('hard');

      expect(useWrongWordsStore.getState().entries).toHaveLength(0);
      expect(useReviewSessionStore.getState().results).toHaveLength(1);
    });

    it('T03d: 连续 3 张答错 → 错词本 3 条 (无重复/无覆盖), results=3', () => {
      const queue = [
        makeCard('lg-apple', 'apple', 'en'),
        makeCard('lg-banana', 'banana', 'de'),
        makeCard('lg-cherry', 'cherry', 'en'),
      ];
      useReviewSessionStore.setState({
        mode: 'reviewing',
        language: 'en',
        queue,
        currentIndex: 0,
        userAnswer: '',
        evaluation: { grade: 'wrong', feedback: 'x', hint: null },
        isEvaluating: false,
        isPaused: false,
        showRatingBar: false,
        results: [],
        startedAt: 0,
        cardContexts: {},
      });

      // apple (index0)
      useReviewSessionStore.getState().completeReview('again');
      // → banana (index1): nextCard 会清空 evaluation, 需重新设置
      useReviewSessionStore.getState().nextCard();
      useReviewSessionStore.setState({ evaluation: { grade: 'wrong', feedback: 'x', hint: null } });
      useReviewSessionStore.getState().completeReview('again');
      // → cherry (index2, 末卡)
      useReviewSessionStore.getState().nextCard();
      useReviewSessionStore.setState({ evaluation: { grade: 'wrong', feedback: 'x', hint: null } });
      useReviewSessionStore.getState().completeReview('again');

      const entries = useWrongWordsStore.getState().entries;
      expect(entries.map((e) => e.lemma).sort()).toEqual(['apple', 'banana', 'cherry']);
      expect(useWrongWordsStore.getState().entries).toHaveLength(3);
      expect(useReviewSessionStore.getState().results).toHaveLength(3);
    });
  });
});
