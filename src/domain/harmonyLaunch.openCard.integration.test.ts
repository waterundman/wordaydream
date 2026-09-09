/**
 * v0.6.0-harmony Stage 1: openCard 定向卡片落地 —— 真实 store 集成测试 (T01/T02/T04/T06)
 *
 * 通过真实 useReviewSessionStore / useMemoryStore / useStreakStore 等驱动
 * dispatchHarmonyLaunchAction（默认依赖 = 真实 store），验证端到端行为：
 * - T01: openCard 命中 due 队列 → reviewing 且当前卡即目标卡
 * - T02: reviewing 中 openCard 命中 → currentIndex 跳转、results 保留、streak 不重复累计
 * - T04: openCard 目标未到期/不存在 → 降级常规复习流（队首为 due 首卡）
 * - T06: 定位后 completeReview → FSRS 评分落在目标卡 lexemeGroup；nextCard 正常
 *
 * 测试不修改任何版本号，不改动 src/platform/harmonyLaunch.ts 的解析/队列逻辑。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoryCard } from '../types';
import { dispatchHarmonyLaunchAction } from './harmonyLaunch';
import { useMemoryStore } from '../features/review/store/useMemoryStore';
import { useReviewSessionStore } from '../features/review/store/useReviewSessionStore';
import { useAppModeStore } from '../hooks/useAppModeStore';
import { useStreakStore } from '../features/streak/store/useStreakStore';
import { useToastStore } from '../store/useToastStore';
import { useReadingSessionStore } from '../features/reading/store/useReadingSessionStore';

function makeCard(
  partial: Partial<MemoryCard> &
    Pick<MemoryCard, 'lexemeGroupId' | 'lemma' | 'id' | 'objectiveDifficulty'>,
): MemoryCard {
  return {
    lexemeGroupId: partial.lexemeGroupId,
    lemma: partial.lemma,
    id: partial.id,
    objectiveDifficulty: partial.objectiveDifficulty,
    language: partial.language ?? 'en',
    firstLearnedAt: partial.firstLearnedAt ?? 1_700_000_000_000,
    lastReviewAt: partial.lastReviewAt ?? partial.firstLearnedAt ?? 1_700_000_000_000,
    learningSteps: partial.learningSteps ?? 0,
    due: partial.due ?? 0,
    stability: partial.stability ?? 2.5,
    difficulty: partial.difficulty ?? 5,
    elapsedDays: partial.elapsedDays ?? 0,
    scheduledDays: partial.scheduledDays ?? 0,
    reps: partial.reps ?? 0,
    lapses: partial.lapses ?? 0,
    status: partial.status ?? 'review',
  };
}

let cardA: MemoryCard;
let cardB: MemoryCard;
let addToastSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  window.localStorage.clear();

  // 清空记忆库（dueCardsIndex 置 null，让 getDueCards 走全量扫描，与测试写入一致）
  useMemoryStore.setState({
    cards: new Map(),
    dueCardsIndex: null,
    cardsByLanguageIndex: null,
    ratingHistory: [],
  });

  // 清空复习会话瞬时态
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

  useToastStore.setState({ toasts: [], notifications: {} });
  useReadingSessionStore.setState({ lastConfig: null });
  useAppModeStore.getState().reset();

  // 构造两张到期英文复习卡（due=0 <= now）
  cardA = makeCard({
    lexemeGroupId: 'g-apple',
    lemma: 'apple',
    id: 'card-apple',
    objectiveDifficulty: 2,
  });
  cardB = makeCard({
    lexemeGroupId: 'g-book',
    lemma: 'book',
    id: 'card-book',
    objectiveDifficulty: 3,
  });
  const cards = new Map<string, MemoryCard>([
    [cardA.lexemeGroupId, cardA],
    [cardB.lexemeGroupId, cardB],
  ]);
  useMemoryStore.setState({ cards });

  addToastSpy = vi.spyOn(useToastStore.getState(), 'addToast');
  addToastSpy.mockClear();
});

describe('openCard 定向卡片落地 (真实 store 集成)', () => {
  it('T01 [integration]: openCard 且 cardId 在 due 队列 → mode=reviewing 且当前卡即目标卡', () => {
    expect(useMemoryStore.getState().getDueCards('en').map((c) => c.id)).toEqual([
      'card-apple',
      'card-book',
    ]);

    dispatchHarmonyLaunchAction({ type: 'openCard', cardId: 'card-book' });

    const review = useReviewSessionStore.getState();
    expect(review.mode).toBe('reviewing');
    expect(review.queue.map((c) => c.id)).toEqual(['card-apple', 'card-book']);
    expect(review.getCurrentCard()?.id).toBe('card-book');
    expect(review.currentIndex).toBe(1);
    expect(useAppModeStore.getState().currentMode).toBe('review');
    expect(addToastSpy).not.toHaveBeenCalled();
  });

  it('T02 [integration]: reviewing 中 openCard 目标在队列 → currentIndex 跳转、results 保留、streak 不重复累计', () => {
    // 预置一个正在进行的会话，已对 card-apple 答过一题（results 含一条记录）
    useReviewSessionStore.setState({
      mode: 'reviewing',
      language: 'en',
      queue: [cardA, cardB],
      currentIndex: 0,
      results: [
        {
          cardId: 'card-apple',
          rating: null,
          evaluation: { grade: 'correct', feedback: 'ok', hint: null },
          answeredAt: Date.now(),
        },
      ],
      startedAt: Date.now(),
    });

    const recordDaySpy = vi.spyOn(useStreakStore.getState(), 'recordDay');
    recordDaySpy.mockClear();

    dispatchHarmonyLaunchAction({ type: 'openCard', cardId: 'card-book' });

    const review = useReviewSessionStore.getState();
    // 会话未被重启：mode 仍 reviewing，results 保留，currentIndex 跳到目标
    expect(review.mode).toBe('reviewing');
    expect(review.currentIndex).toBe(1);
    expect(review.getCurrentCard()?.id).toBe('card-book');
    expect(review.results).toHaveLength(1);
    expect(review.results[0].cardId).toBe('card-apple');
    // 关键：会话内跳转不触发 streak / 成就（未重新 startReview）
    expect(recordDaySpy).not.toHaveBeenCalled();
    expect(useAppModeStore.getState().currentMode).toBe('review');
    expect(addToastSpy).not.toHaveBeenCalled();
  });

  it('T04 [integration]: openCard 目标未到期/不存在 → 降级常规流（队首为 due 首卡）', () => {
    dispatchHarmonyLaunchAction({ type: 'openCard', cardId: 'card-missing' });

    const review = useReviewSessionStore.getState();
    expect(review.mode).toBe('reviewing');
    // 降级常规复习：从队首开始，而非目标卡
    expect(review.getCurrentCard()?.id).toBe('card-apple');
    expect(review.currentIndex).toBe(0);
    expect(useAppModeStore.getState().currentMode).toBe('review');
    expect(addToastSpy).toHaveBeenCalledWith(
      'warning',
      '该词当前不在复习队列，已开始常规复习',
    );
  });

  it('T06 [integration]: openCard 定位后 completeReview → FSRS 评分落在目标卡 lexemeGroup；nextCard 流程正常', () => {
    dispatchHarmonyLaunchAction({ type: 'openCard', cardId: 'card-book' });
    expect(useReviewSessionStore.getState().getCurrentCard()?.id).toBe('card-book');

    const beforeB = useMemoryStore.getState().cards.get('g-book')!.reps;
    const beforeA = useMemoryStore.getState().cards.get('g-apple')!.reps;
    expect(beforeB).toBe(0);

    // 对定位到的目标卡评分
    useReviewSessionStore.getState().completeReview('good');

    // FSRS 评分落在目标卡的 lexemeGroup，而非队首 card-apple
    expect(useMemoryStore.getState().cards.get('g-book')!.reps).toBe(beforeB + 1);
    expect(useMemoryStore.getState().cards.get('g-apple')!.reps).toBe(beforeA);

    // nextCard 推进到队尾后标记会话完成
    useReviewSessionStore.getState().nextCard();
    expect(useReviewSessionStore.getState().mode).toBe('completed');

    // 重置以便下一个测试（nextCard 已使队列走完）
    useReviewSessionStore.setState({ mode: 'idle', queue: [], currentIndex: 0 });
  });
});
