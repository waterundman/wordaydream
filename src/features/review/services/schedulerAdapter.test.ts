/**
 * v1.8.0 Stage 1: useSettingsStore v5 + schedulerAdapter 可变单例
 *
 * 覆盖 test_spec (plan.md Stage 1):
 * - T01 [critical]: useSettingsStore v5 含 fsrsWeights + fsrsWeightsBackup 字段, 初始 undefined
 * - T02 [critical]: setFsrsWeights(weights) 更新 fsrs 实例参数, scheduleNextReview 不抛异常
 * - T03 [critical]: resetFsrsWeights() 恢复默认, scheduleNextReview 行为恢复
 * - T04 [critical]: getRetrievability 用当前 weights 计算, 返回 [0,1] 范围
 * - T05 [critical]: scheduleNextReview 用当前 weights 计算, 返回合法 ReviewUpdate
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoryCard } from '../../../types';

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

describe('v1.8.0 Stage 1: useSettingsStore v5 + schedulerAdapter 可变单例', () => {
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
  });

  it('T01: useSettingsStore v5 含 fsrsWeights + fsrsWeightsBackup 字段, 初始 undefined', async () => {
    const { useSettingsStore } = await import('../../settings/store/useSettingsStore');
    const state = useSettingsStore.getState();
    expect(state).toHaveProperty('fsrsWeights');
    expect(state).toHaveProperty('fsrsWeightsBackup');
    expect(state.fsrsWeights).toBeUndefined();
    expect(state.fsrsWeightsBackup).toBeUndefined();
  });

  it('T02: setFsrsWeights(weights) 更新 fsrs 实例参数, scheduleNextReview 不抛异常', async () => {
    const {
      setFsrsWeights,
      scheduleNextReview,
      DEFAULT_FSRS_WEIGHTS,
    } = await import('./schedulerAdapter');

    // 使用 ts-fsrs default_w 作为自定义 weights (与项目 DEFAULT_FSRS_WEIGHTS 不同)
    const { default_w } = await import('ts-fsrs');
    const customWeights = [...default_w];
    expect(customWeights).not.toEqual(DEFAULT_FSRS_WEIGHTS);

    setFsrsWeights(customWeights);

    const card = makeCard({
      lexemeGroupId: 'g1',
      lemma: 'test',
      objectiveDifficulty: 2,
      status: 'review',
      reps: 3,
      stability: 10,
      difficulty: 5,
      lastReviewAt: Date.now() - 24 * 60 * 60 * 1000,
      due: Date.now() - 1000,
    });

    expect(() => scheduleNextReview(card, 'good')).not.toThrow();
    const result = scheduleNextReview(card, 'good');
    expect(result).toBeDefined();
    expect(result.card).toBeDefined();
    expect(result.nextReviewAt).toBeGreaterThan(Date.now());
  });

  it('T03: resetFsrsWeights() 恢复默认, scheduleNextReview 行为恢复', async () => {
    const {
      setFsrsWeights,
      resetFsrsWeights,
      scheduleNextReview,
    } = await import('./schedulerAdapter');

    const { default_w } = await import('ts-fsrs');
    setFsrsWeights([...default_w]);
    resetFsrsWeights();

    const card = makeCard({
      lexemeGroupId: 'g1',
      lemma: 'test',
      objectiveDifficulty: 2,
      status: 'review',
      reps: 3,
      stability: 10,
      difficulty: 5,
      lastReviewAt: Date.now() - 24 * 60 * 60 * 1000,
      due: Date.now() - 1000,
    });

    expect(() => scheduleNextReview(card, 'good')).not.toThrow();
    const result = scheduleNextReview(card, 'good');
    expect(result).toBeDefined();
    expect(result.card.stability).toBeGreaterThan(0);
    expect(result.card.difficulty).toBeGreaterThan(0);
  });

  it('T04: getRetrievability 用当前 weights 计算, 返回 [0,1] 范围', async () => {
    const {
      getRetrievability,
      setFsrsWeights,
      resetFsrsWeights,
      DEFAULT_FSRS_WEIGHTS,
    } = await import('./schedulerAdapter');

    const card = makeCard({
      lexemeGroupId: 'g1',
      lemma: 'test',
      objectiveDifficulty: 2,
      status: 'review',
      reps: 3,
      stability: 10,
      difficulty: 5,
      lastReviewAt: Date.now() - 24 * 60 * 60 * 1000,
      due: Date.now() - 1000,
    });

    // 默认 weights 下的 retrievability
    const r1 = getRetrievability(card);
    expect(r1).toBeGreaterThanOrEqual(0);
    expect(r1).toBeLessThanOrEqual(1);

    // 切换到不同 weights (ts-fsrs default_w)
    const { default_w } = await import('ts-fsrs');
    expect(default_w).not.toEqual(DEFAULT_FSRS_WEIGHTS);
    setFsrsWeights([...default_w]);

    const r2 = getRetrievability(card);
    expect(r2).toBeGreaterThanOrEqual(0);
    expect(r2).toBeLessThanOrEqual(1);

    // 恢复默认, 确保不影响后续测试
    resetFsrsWeights();
  });

  it('T05: scheduleNextReview 用当前 weights 计算, 返回合法 ReviewUpdate', async () => {
    const { scheduleNextReview } = await import('./schedulerAdapter');

    const card = makeCard({
      lexemeGroupId: 'g1',
      lemma: 'test',
      objectiveDifficulty: 2,
      status: 'review',
      reps: 3,
      stability: 10,
      difficulty: 5,
      lastReviewAt: Date.now() - 24 * 60 * 60 * 1000,
      due: Date.now() - 1000,
    });

    const result = scheduleNextReview(card, 'good');
    expect(result).toBeDefined();
    expect(result.card).toBeDefined();
    expect(result.nextReviewAt).toBeGreaterThan(Date.now());
    expect(result.card.stability).toBeGreaterThan(0);
    expect(result.card.difficulty).toBeGreaterThan(0);
    expect(result.card.due).toBeGreaterThan(Date.now());
    expect(result.card.reps).toBe(card.reps + 1);
    expect(result.card.status).not.toBe('new');
  });
});
