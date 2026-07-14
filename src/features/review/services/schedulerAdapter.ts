import type { MemoryCard, DifficultyLevel, Rating, ReviewUpdate, Language } from '../../../types';
import { createEmptyCard, fsrs, State, Rating as FsrsRating } from 'ts-fsrs';
import type { Card, Grade, FSRS } from 'ts-fsrs';

/**
 * v1.8.0 Stage 1: 默认 FSRS weights (保留 v1.7.0 自定义 19 值 ramp, Contract 40/41).
 * 不使用 ts-fsrs default_w 以保留现有行为 (合同 31-38 不回归).
 */
export const DEFAULT_FSRS_WEIGHTS: readonly number[] = [
  1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10,
];

/**
 * v1.8.0 Stage 1: 创建 FSRS 实例 (可变单例工厂).
 * weights 为空时使用 DEFAULT_FSRS_WEIGHTS.
 */
function createFsrsInstance(weights?: number[]): FSRS {
  return fsrs({
    w: weights ?? DEFAULT_FSRS_WEIGHTS,
    enable_fuzz: true,
    request_retention: 0.85,
    maximum_interval: 36500,
  });
}

// v1.8.0 Stage 1: 可变单例 — 支持运行时更新 weights (let, 非 const)
let f: FSRS = createFsrsInstance();

/**
 * v1.8.0 Stage 1: 更新 FSRS 实例的 weights (优化后参数注入, Contract 40).
 * @param weights 优化后的 FSRS weights 数组
 */
export function setFsrsWeights(weights: number[]): void {
  f = createFsrsInstance(weights);
}

/**
 * v1.8.0 Stage 1: 恢复默认 FSRS weights (回滚优化, Contract 41).
 */
export function resetFsrsWeights(): void {
  f = createFsrsInstance();
}

const difficultyToInitialDifficulty: Record<DifficultyLevel, number> = {
  1: 3.0,
  2: 5.0,
  3: 7.0,
  4: 9.0,
  5: 10.0,
};

function ratingToFsrsRating(rating: Rating): Grade {
  switch (rating) {
    case 'again':
      return FsrsRating.Again;
    case 'hard':
      return FsrsRating.Hard;
    case 'good':
      return FsrsRating.Good;
    case 'easy':
      return FsrsRating.Easy;
  }
}

function fsrsCardToMemoryCard(
  fsrsCard: Card,
  id: string,
  lexemeGroupId: string,
  lemma: string,
  objectiveDifficulty: DifficultyLevel,
  firstLearnedAt: number,
  lastReviewAt: number,
  language?: Language
): MemoryCard {
  const stateToStatus = {
    [State.New]: 'new' as const,
    [State.Learning]: 'learning' as const,
    [State.Review]: 'review' as const,
    [State.Relearning]: 'relearning' as const,
  };

  return {
    id,
    lexemeGroupId,
    lemma,
    objectiveDifficulty,
    language,
    firstLearnedAt,
    lastReviewAt,
    due: fsrsCard.due.getTime(),
    stability: fsrsCard.stability,
    difficulty: fsrsCard.difficulty,
    elapsedDays: fsrsCard.elapsed_days,
    scheduledDays: fsrsCard.scheduled_days,
    reps: fsrsCard.reps,
    lapses: fsrsCard.lapses,
    status: stateToStatus[fsrsCard.state],
    // v1.5.3 fix V3-P2-008: 持久化 learning_steps, 之前硬编码为 1 且丢失.
    learningSteps: fsrsCard.learning_steps,
  };
}

export function createInitialMemoryCard(
  lexemeGroupId: string,
  lemma: string,
  objectiveDifficulty: DifficultyLevel,
  language?: Language
): MemoryCard {
  const emptyCard = createEmptyCard();
  const initialDifficulty = difficultyToInitialDifficulty[objectiveDifficulty];
  const now = Date.now();

  const card: Card = {
    ...emptyCard,
    difficulty: initialDifficulty,
    state: State.New,
  };

  return fsrsCardToMemoryCard(
    card,
    `card-${now}-${lexemeGroupId}`,
    lexemeGroupId,
    lemma,
    objectiveDifficulty,
    now,
    now,
    language
  );
}

export function scheduleNextReview(
  card: MemoryCard,
  rating: Rating,
  now: Date = new Date()
): ReviewUpdate {
  const fsrsCard: Card = {
    due: new Date(card.due),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsedDays,
    scheduled_days: card.scheduledDays,
    reps: card.reps,
    lapses: card.lapses,
    state: card.status === 'new' ? State.New : card.status === 'learning' ? State.Learning : card.status === 'review' ? State.Review : State.Relearning,
    last_review: new Date(card.lastReviewAt ?? card.firstLearnedAt),
    // v1.5.3 fix V3-P2-008: 从持久化字段读取, 之前硬编码为 1 导致多步学习失效.
    learning_steps: card.learningSteps ?? 1,
  };

  // v1.5.3 fix V2-P2-002: 移除 as any, 让 TypeScript 推断 f.repeat() 返回类型.
  // f.repeat() 返回 IPreview (extends RecordLog), result[fsrsRating] 返回 RecordLogItem
  // (含 .card: Card), 无需手动类型断言.
  const result = f.repeat(fsrsCard, now);
  const fsrsRating = ratingToFsrsRating(rating);
  const recordLog = result[fsrsRating];
  const nextCard = recordLog.card;

  const nowMs = now.getTime();
  return {
    card: fsrsCardToMemoryCard(
      nextCard,
      card.id,
      card.lexemeGroupId,
      card.lemma,
      card.objectiveDifficulty,
      card.firstLearnedAt,
      nowMs,
      card.language
    ),
    nextReviewAt: nextCard.due.getTime(),
  };
}

/**
 * v1.6.1 Stage 1: 获取 MemoryCard 的当前 retrievability (回忆概率).
 * 用 ts-fsrs 原生 get_retrievability 计算, 替代 v1.6.0 的 30 天窗口硬编码.
 * @param card MemoryCard (项目内部格式)
 * @param now 当前时间, 默认 new Date()
 * @returns retrievability [0, 1], 值越高表示回忆概率越高
 */
export function getRetrievability(card: MemoryCard, now: Date = new Date()): number {
  const fsrsCard: Card = {
    due: new Date(card.due),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsedDays,
    scheduled_days: card.scheduledDays,
    reps: card.reps,
    lapses: card.lapses,
    state: card.status === 'new' ? State.New : card.status === 'learning' ? State.Learning : card.status === 'review' ? State.Review : State.Relearning,
    last_review: new Date(card.lastReviewAt ?? card.firstLearnedAt),
    // v1.5.3 fix V3-P2-008: 从持久化字段读取, 之前硬编码为 1 导致多步学习失效.
    learning_steps: card.learningSteps ?? 1,
  };
  return f.get_retrievability(fsrsCard, now, false);
}
