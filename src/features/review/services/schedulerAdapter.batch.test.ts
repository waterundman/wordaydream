/**
 * v0.4.0-harmony Stage 1 D1: scheduleNextReviewBatch 批处理单元测试
 *
 * 覆盖 test_spec:
 * - T01 [critical]: scheduleNextReviewBatch 内部只调用 f.repeat() 1 次,
 *   而非 scheduleNextReview 的 4 次 (优化前冗余 FSRS 计算).
 *   验证: mock f.repeat 计数器, 断言调用次数 === 1.
 * - T02 [critical]: scheduleNextReviewBatch 返回 4 个 rating 的 ReviewUpdate,
 *   每个 rating 的 card.reps = 原 reps + 1 (FSRS 评分后 reps 递增).
 * - T03: scheduleNextReviewBatch 与逐个调用 scheduleNextReview 的结果一致
 *   (rating-wise 等价, 仅调用次数优化).
 * - T04: getRatingPreviews 调用 scheduleNextReviewBatch (而非 scheduleNextReview 4 次),
 *   间接验证 useMemoryStore 已接入批处理优化.
 *
 * Mock 策略:
 * - vi.mock('ts-fsrs', ...) 替换 fsrs() 返回可控的 FSRS 实例,
 *   间谍 f.repeat() 计数调用次数.
 * - 不依赖真实 FSRS 计算 (避免 enable_fuzz 导致随机性, 难以断言 reps/due).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoryCard } from '../../../types';

// 构造合法 MemoryCard
function makeCard(
  partial: Partial<MemoryCard> &
    Pick<MemoryCard, 'lexemeGroupId' | 'lemma' | 'objectiveDifficulty'>,
): MemoryCard {
  return {
    id: partial.id ?? `card-${partial.lexemeGroupId}`,
    lexemeGroupId: partial.lexemeGroupId,
    lemma: partial.lemma,
    objectiveDifficulty: partial.objectiveDifficulty,
    firstLearnedAt: partial.firstLearnedAt ?? 1_700_000_000_000,
    lastReviewAt: partial.lastReviewAt ?? partial.firstLearnedAt ?? 1_700_000_000_000,
    learningSteps: partial.learningSteps ?? 0,
    due: partial.due ?? 0,
    stability: partial.stability ?? 0,
    difficulty: partial.difficulty ?? 0,
    elapsedDays: partial.elapsedDays ?? 0,
    scheduledDays: partial.scheduledDays ?? 0,
    reps: partial.reps ?? 0,
    lapses: partial.lapses ?? 0,
    status: partial.status ?? 'new',
    language: partial.language,
  };
}

// 构造一个 review 状态的卡 (用于批处理测试)
function makeReviewCard(overrides: Partial<MemoryCard> = {}): MemoryCard {
  return makeCard({
    lexemeGroupId: 'g1',
    lemma: 'apple',
    objectiveDifficulty: 2,
    status: 'review',
    reps: 3,
    lapses: 1,
    stability: 5.5,
    difficulty: 6.0,
    lastReviewAt: Date.now() - 24 * 60 * 60 * 1000,
    due: Date.now() - 1000, // 过期
    ...overrides,
  });
}

describe('v0.4.0-harmony Stage 1 D1: scheduleNextReviewBatch 批处理优化', () => {
  beforeEach(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.clear();
    }
    vi.resetModules();
  });

  afterEach(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.clear();
    }
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('T01 [critical]: scheduleNextReviewBatch 内部只调用 f.repeat() 1 次 (而非 4 次)', async () => {
    // 动态 import 让 vi.mock 生效
    const tsFsrs = await import('ts-fsrs');
    const { fsrs } = tsFsrs;
    const { default_w } = tsFsrs;

    // 用真实 fsrs 实例, 但 wrap f.repeat 为 spy
    // 这样不改变行为, 只统计调用次数
    const realFsrs = fsrs({
      w: [...default_w],
      enable_fuzz: false, // 关闭 fuzz 避免随机性
      request_retention: 0.85,
      maximum_interval: 36500,
    });
    const repeatSpy = vi.spyOn(realFsrs, 'repeat');

    // vi.mock ts-fsrs: fsrs() 返回我们的 spy 实例
    vi.doMock('ts-fsrs', () => ({
      ...tsFsrs,
      fsrs: vi.fn(() => realFsrs), // 返回带 spy 的实例
    }));

    // 重新 import schedulerAdapter (会使用 mock 后的 ts-fsrs)
    const { scheduleNextReviewBatch, setFsrsWeights } = await import('./schedulerAdapter');

    // 显式重新初始化 (确保用 default_w, 不带 enable_fuzz)
    setFsrsWeights([...default_w]);

    const card = makeReviewCard();
    const now = new Date();

    // 调用 batch 函数
    const result = scheduleNextReviewBatch(card, now);

    // 断言: f.repeat() 只被调用 1 次 (而非 4 次)
    expect(repeatSpy).toHaveBeenCalledTimes(1);

    // 返回 4 个 rating 的预览
    expect(result).toHaveProperty('again');
    expect(result).toHaveProperty('hard');
    expect(result).toHaveProperty('good');
    expect(result).toHaveProperty('easy');
    expect(Object.keys(result)).toHaveLength(4);
  });

  it('T02 [critical]: scheduleNextReviewBatch 返回 4 个 rating 的 ReviewUpdate, reps 递增', async () => {
    const { scheduleNextReviewBatch } = await import('./schedulerAdapter');

    const card = makeReviewCard({ reps: 3 });
    const now = new Date();

    const result = scheduleNextReviewBatch(card, now);

    // 每个 rating 都有合法的 ReviewUpdate
    const ratings = ['again', 'hard', 'good', 'easy'] as const;
    for (const rating of ratings) {
      const preview = result[rating];
      expect(preview).toBeDefined();
      expect(preview.card).toBeDefined();
      expect(preview.nextReviewAt).toBeGreaterThan(0);
      // reps 递增 (FSRS 评分后 reps+1)
      expect(preview.card.reps).toBe(card.reps + 1);
      // id 保持不变
      expect(preview.card.id).toBe(card.id);
      expect(preview.card.lexemeGroupId).toBe(card.lexemeGroupId);
      expect(preview.card.lemma).toBe(card.lemma);
      expect(preview.card.objectiveDifficulty).toBe(card.objectiveDifficulty);
    }

    // 不同 rating 的结果不同 (good 的 nextReviewAt 应该 >= again 的)
    // good 评分 比 again 更轻松, 下次复习时间更远
    expect(result.good.nextReviewAt).toBeGreaterThanOrEqual(result.again.nextReviewAt);
    expect(result.easy.nextReviewAt).toBeGreaterThanOrEqual(result.good.nextReviewAt);
  });

  it('T03: scheduleNextReviewBatch 与逐个调用 scheduleNextReview 的 rating-wise 结果等价', async () => {
    const { scheduleNextReview, scheduleNextReviewBatch } = await import('./schedulerAdapter');

    const card = makeReviewCard({ reps: 3 });
    const now = new Date();

    // 逐个调用 (优化前路径)
    const ratings = ['again', 'hard', 'good', 'easy'] as const;
    const individualResults = ratings.map((rating) => ({
      rating,
      result: scheduleNextReview(card, rating, now),
    }));

    // 批处理调用 (优化后路径)
    const batchResult = scheduleNextReviewBatch(card, now);

    // 断言: 每个 rating 的结果一致 (card 字段 + nextReviewAt)
    for (const { rating, result } of individualResults) {
      const batchPreview = batchResult[rating];
      expect(batchPreview.card.reps).toBe(result.card.reps);
      expect(batchPreview.card.lapses).toBe(result.card.lapses);
      expect(batchPreview.card.stability).toBeCloseTo(result.card.stability, 5);
      expect(batchPreview.card.difficulty).toBeCloseTo(result.card.difficulty, 5);
      expect(batchPreview.card.elapsedDays).toBe(result.card.elapsedDays);
      expect(batchPreview.card.scheduledDays).toBe(result.card.scheduledDays);
      expect(batchPreview.card.status).toBe(result.card.status);
      expect(batchPreview.card.due).toBe(result.card.due);
      expect(batchPreview.card.id).toBe(result.card.id);
      expect(batchPreview.card.lexemeGroupId).toBe(result.card.lexemeGroupId);
      expect(batchPreview.card.lemma).toBe(result.card.lemma);
      expect(batchPreview.card.objectiveDifficulty).toBe(result.card.objectiveDifficulty);
      expect(batchPreview.card.firstLearnedAt).toBe(result.card.firstLearnedAt);
      expect(batchPreview.card.lastReviewAt).toBe(result.card.lastReviewAt);
      expect(batchPreview.card.learningSteps).toBe(result.card.learningSteps);
      expect(batchPreview.nextReviewAt).toBe(result.nextReviewAt);
    }
  });

  it('T04: getRatingPreviews 调用 scheduleNextReviewBatch (而非 scheduleNextReview 4 次)', async () => {
    // vi.mock ts-fsrs 让 f.repeat 成为 spy
    const tsFsrs = await import('ts-fsrs');
    const { fsrs, default_w } = tsFsrs;

    const realFsrs = fsrs({
      w: [...default_w],
      enable_fuzz: false,
      request_retention: 0.85,
      maximum_interval: 36500,
    });
    const repeatSpy = vi.spyOn(realFsrs, 'repeat');

    vi.doMock('ts-fsrs', () => ({
      ...tsFsrs,
      fsrs: vi.fn(() => realFsrs),
    }));

    const { setFsrsWeights } = await import('./schedulerAdapter');
    setFsrsWeights([...default_w]);

    // 重新 import useMemoryStore (会使用 mock 后的 schedulerAdapter)
    const { useMemoryStore } = await import('../store/useMemoryStore');

    // 写入一张 review 状态的卡 (due=now+1, 已复习)
    const card = makeReviewCard({
      id: 'card-g1',
      lexemeGroupId: 'g1',
      reps: 3,
    });
    useMemoryStore.setState({
      cards: new Map([['g1', card]]),
      dueCardsIndex: new Set<string>(),
    });

    // 调用 getRatingPreviews (内部应该调用 scheduleNextReviewBatch 1 次,
    // 而非 scheduleNextReview 4 次 = f.repeat 4 次)
    const previews = useMemoryStore.getState().getRatingPreviews('g1');

    // 断言: 返回 4 个 rating 的预览
    expect(previews).not.toBeNull();
    expect(previews).toHaveProperty('again');
    expect(previews).toHaveProperty('hard');
    expect(previews).toHaveProperty('good');
    expect(previews).toHaveProperty('easy');

    // 关键: f.repeat() 只被调用 1 次 (批处理优化)
    // 优化前: scheduleNextReview 4 次 = f.repeat 4 次
    // 优化后: scheduleNextReviewBatch 1 次 = f.repeat 1 次
    expect(repeatSpy).toHaveBeenCalledTimes(1);
  });

  it('T05: getRatingPreviews 卡片不存在时返回 null (向后兼容 v1.5.3 fix V4-P3-008)', async () => {
    const { useMemoryStore } = await import('../store/useMemoryStore');

    // 不存在的 cardId
    const previews = useMemoryStore.getState().getRatingPreviews('non-existent-card-id');
    expect(previews).toBeNull();
  });

  it('T06: scheduleNextReviewBatch 对不同 status 的卡片都能正常工作', async () => {
    const { scheduleNextReviewBatch } = await import('./schedulerAdapter');

    const now = new Date();
    const statuses: Array<MemoryCard['status']> = ['new', 'learning', 'review', 'relearning'];

    for (const status of statuses) {
      const card = makeReviewCard({ status, reps: status === 'new' ? 0 : 3 });
      const result = scheduleNextReviewBatch(card, now);

      // 4 个 rating 都有结果
      expect(Object.keys(result)).toHaveLength(4);
      for (const rating of ['again', 'hard', 'good', 'easy'] as const) {
        expect(result[rating]).toBeDefined();
        expect(result[rating].card).toBeDefined();
      }
    }
  });
});
