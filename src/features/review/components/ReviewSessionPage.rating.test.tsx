/**
 * ReviewSessionPage 评分键盘流测试 (v0.8.0-harmony Stage 1, SPEC §3/§5)
 *
 * 覆盖 test_spec:
 * - T01 [critical]: showRatingBar=true 且焦点在 body, 按 '1' → completeReview('again');
 *   按 '4' → completeReview('easy')
 * - T02 [critical]: 答题输入框聚焦时按 '3' → 输入框值更新, completeReview 未被调
 *   (焦点守卫: 数字落入输入内容, 不触发评分)
 * - T03 [critical]: isPaused=true 时按数字键 → completeReview 未被调
 * - T04 [critical]: showRatingBar=false 时按数字键 → completeReview 未被调
 *
 * 实现策略 (跟随现有 ReviewSessionPage.test.tsx 先例):
 * - 通过 useReviewSessionStore.setState 构造 reviewing 会话状态
 * - 评分路径 (completeReview) 的断言改为检查 store 的 results 副作用
 *   (completeReview 会向 results 追加一条 rating 记录), 避免直接 spy 单例 action
 *   在跨测试间的污染; 同时 results 长度 == 1 即证明"恰好调用一次" (无重复触发).
 * - 评分键挂在 window 级 keydown, 用 fireEvent.keyDown(window, { key })
 * - T02 用 userEvent.type 真实模拟"在输入框打字", 数字应落入输入值
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReviewSessionPage } from './ReviewSessionPage';
import { useReviewSessionStore } from '../store/useReviewSessionStore';
import type { MemoryCard, AnswerEvaluation } from '../../../types';

function makeCard(lemma = 'test'): MemoryCard {
  return {
    id: `card-${lemma}`,
    lexemeGroupId: `lg-${lemma}`,
    lemma,
    objectiveDifficulty: 2,
    language: 'en',
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

function makeEvaluation(grade: 'correct' | 'partial' | 'wrong' = 'correct'): AnswerEvaluation {
  return { grade, feedback: 'test feedback', hint: null };
}

beforeEach(() => {
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
});

afterEach(() => {
  cleanup();
});

function setupReviewing(overrides: Partial<ReturnType<typeof useReviewSessionStore.getState>> = {}) {
  useReviewSessionStore.setState({
    mode: 'reviewing',
    language: 'en',
    queue: [makeCard()],
    currentIndex: 0,
    userAnswer: '',
    evaluation: null,
    isEvaluating: false,
    isPaused: false,
    showRatingBar: false,
    results: [],
    startedAt: 0,
    cardContexts: {},
    ...overrides,
  });
}

describe('复习评分键盘流 (Stage 1)', () => {
  describe('T01: showRatingBar=true 且焦点在 body', () => {
    it("T01a: 按 '1' → results 含一条 rating='again' (恰好一次, 无重复触发)", () => {
      setupReviewing({ showRatingBar: true, evaluation: makeEvaluation('correct') });

      render(<ReviewSessionPage />);

      // 焦点在 body (window 为目标), 非可编辑元素 → 评分键生效
      fireEvent.keyDown(window, { key: '1' });

      const results = useReviewSessionStore.getState().results;
      expect(results).toHaveLength(1);
      expect(results[0]?.rating).toBe('again');
    });

    it("T01b: 按 '4' → results 含一条 rating='easy'", () => {
      setupReviewing({ showRatingBar: true, evaluation: makeEvaluation('correct') });

      render(<ReviewSessionPage />);

      fireEvent.keyDown(window, { key: '4' });

      const results = useReviewSessionStore.getState().results;
      expect(results).toHaveLength(1);
      expect(results[0]?.rating).toBe('easy');
    });

    it("T01c: 按 '2'/'3' → results 分别含 rating='hard'/'good'", () => {
      setupReviewing({ showRatingBar: true, evaluation: makeEvaluation('correct') });

      render(<ReviewSessionPage />);

      fireEvent.keyDown(window, { key: '2' });
      expect(useReviewSessionStore.getState().results[0]?.rating).toBe('hard');

      // 重新构造 (上一次评分已把 showRatingBar 置否), 再测 '3'
      setupReviewing({ showRatingBar: true, evaluation: makeEvaluation('correct') });
      cleanup();
      render(<ReviewSessionPage />);
      fireEvent.keyDown(window, { key: '3' });
      expect(useReviewSessionStore.getState().results[0]?.rating).toBe('good');
    });
  });

  describe('T02: 答题输入框聚焦时按数字键', () => {
    it("T02: 输入框聚焦按 '3' → 值更新为 '3', results 无新增 (completeReview 未调)", async () => {
      const user = userEvent.setup();
      // evaluation=null → 输入框可用并自动聚焦; showRatingBar=true 以隔离验证
      // "焦点守卫" (而非 ratingEnabled=false) 阻止评分.
      setupReviewing({ showRatingBar: true, evaluation: null });

      render(<ReviewSessionPage />);

      const input = screen.getByLabelText('中文释义输入') as HTMLInputElement;
      expect(input).toHaveFocus();

      // 真实打字: keydown 冒泡到 window, 但守卫识别 INPUT → 不评分, 数字落入内容
      await user.type(input, '3');

      expect(useReviewSessionStore.getState().results).toHaveLength(0);
      expect(input.value).toBe('3');
    });
  });

  describe('T03: isPaused=true', () => {
    it('T03: 暂停态按数字键 → results 无新增 (completeReview 未调)', () => {
      setupReviewing({
        showRatingBar: true,
        evaluation: makeEvaluation('correct'),
        isPaused: true,
      });

      render(<ReviewSessionPage />);

      fireEvent.keyDown(window, { key: '2' });

      expect(useReviewSessionStore.getState().results).toHaveLength(0);
    });
  });

  describe('T04: showRatingBar=false', () => {
    it('T04: 评分栏未出现时按数字键 → results 无新增 (completeReview 未调)', () => {
      setupReviewing({ showRatingBar: false, evaluation: makeEvaluation('correct') });

      render(<ReviewSessionPage />);

      fireEvent.keyDown(window, { key: '3' });

      expect(useReviewSessionStore.getState().results).toHaveLength(0);
    });
  });
});
