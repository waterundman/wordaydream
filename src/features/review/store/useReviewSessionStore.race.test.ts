import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnswerEvaluation, MemoryCard } from '../../../types';

const { evaluateAnswerMock } = vi.hoisted(() => ({
  evaluateAnswerMock: vi.fn(),
}));

vi.mock('../../evaluation/services/evaluateAnswer', () => ({
  evaluateAnswer: evaluateAnswerMock,
}));

import { useReviewSessionStore } from './useReviewSessionStore';

const CARD = {
  id: 'card-1',
  lexemeGroupId: 'group-1',
  lemma: 'apple',
  objectiveDifficulty: 2,
} as MemoryCard;

beforeEach(() => {
  evaluateAnswerMock.mockReset();
  useReviewSessionStore.setState({
    mode: 'reviewing',
    language: 'en',
    queue: [CARD],
    currentIndex: 0,
    userAnswer: 'An apple a day.',
    evaluation: null,
    isEvaluating: false,
    isPaused: false,
    showRatingBar: false,
    results: [],
    startedAt: Date.now(),
    cardContexts: {},
  });
});

describe('review evaluation request lifecycle', () => {
  it('ignores an in-flight evaluation after the review is exited', async () => {
    let resolveEvaluation!: (value: AnswerEvaluation) => void;
    evaluateAnswerMock.mockReturnValueOnce(
      new Promise<AnswerEvaluation>((resolve) => {
        resolveEvaluation = resolve;
      }),
    );

    const submission = useReviewSessionStore.getState().submitAnswer();
    await vi.waitFor(() => expect(evaluateAnswerMock).toHaveBeenCalledOnce());

    useReviewSessionStore.getState().exitReview();
    resolveEvaluation({ grade: 'correct', feedback: 'ok', hint: null });

    await expect(submission).resolves.toBeNull();
    expect(useReviewSessionStore.getState()).toMatchObject({
      mode: 'idle',
      queue: [],
      evaluation: null,
      isEvaluating: false,
      showRatingBar: false,
      results: [],
    });
  });
});
