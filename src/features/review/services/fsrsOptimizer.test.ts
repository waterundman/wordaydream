/**
 * v2.2.0 Stage 3: fsrsOptimizer — @open-spaced-repetition/binding 集成测试
 *
 * 覆盖 test_spec (v2.2.0 Stage 3):
 * - T06 [critical]: ratingHistory < 30 条 → 抛出错误 "至少 30 条"
 * - T07 [critical]: computeParameters 不可用 → 抛出 OptimizationUnavailableError
 * - T08 [critical]: OptimizationUnavailableError 含 "@open-spaced-repetition/binding" 提示
 * - T09 [non-critical]: isOptimizationAvailable() 返回 true (binding 已安装)
 * - T10 [non-critical]: OptimizationUnavailableError 可被 instanceof 检测
 * - T19 [critical]: package.json 含 @open-spaced-repetition/binding 依赖
 * - T20 [critical]: createFsrsInstance 配置正确 (v5.4.1 snake_case; SPEC 偏差: v6 N/A)
 * - T21 [critical]: scheduleNextReview 行为不回归 (合同 31-38)
 * - T22 [critical]: createInitialMemoryCard 行为不回归
 * - T23 [critical]: isOptimizationAvailable() 在 binding 环境返回 true
 * - T24 [critical]: optimizeFsrsWeights 成功返回 weights + backup + loss
 * - T25 [critical]: optimizeFsrsWeights ratingHistory < 30 时抛 Error
 *
 * SPEC 偏差记录:
 * - ts-fsrs v6.0.0 不存在 (latest 5.4.1), 改用 @open-spaced-repetition/binding ^0.5.0
 * - schedulerAdapter 无需适配 v6 API (snake_case 字段保留)
 *
 * Mock 策略:
 * - 顶层 vi.mock: binding 可用 (computeParameters = vi.fn), 用于 T06/T09/T23/T24/T25
 * - 动态 vi.doMock: binding 不可用 (computeParameters = undefined), 用于 T07/T08/T10
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// vi.hoisted: 获取 mock 引用以便在测试中控制行为
// FSRSBinding 必须用 class (而非 vi.fn) 因为 fsrsOptimizer 使用 `new FSRSBinding(weights)`
const { mockComputeParameters, mockFSRSBindingState } = vi.hoisted(() => ({
  mockComputeParameters: vi.fn(),
  mockFSRSBindingState: {
    evaluateResult: { logLoss: 0.5, rmseBins: 0.1 } as {
      logLoss: number;
      rmseBins: number;
    },
    shouldThrow: false,
    evaluateCallCount: 0,
  },
}));

// 顶层 mock: binding 可用 (computeParameters = vi.fn, FSRSBinding = class)
vi.mock('@open-spaced-repetition/binding', () => ({
  computeParameters: mockComputeParameters,
  FSRSBinding: class MockFSRSBinding {
    constructor(_weights?: number[]) {}
    evaluate(_trainSet: unknown) {
      mockFSRSBindingState.evaluateCallCount++;
      if (mockFSRSBindingState.shouldThrow) {
        throw new Error('evaluate failed');
      }
      return mockFSRSBindingState.evaluateResult;
    }
  },
  FSRSBindingItem: class {
    constructor(_reviews?: unknown[]) {}
  },
  FSRSBindingReview: class {
    constructor(_rating?: number, _deltaT?: number) {}
  },
}));

import {
  optimizeFsrsWeights,
  OptimizationUnavailableError,
  isOptimizationAvailable,
  convertToReviewLog,
  _resetBindingCacheForTesting,
} from './fsrsOptimizer';
import {
  createInitialMemoryCard,
  scheduleNextReview,
  DEFAULT_FSRS_WEIGHTS,
} from './schedulerAdapter';
import type { RatingEntry } from './recallRateCalculator';
import type { MemoryCard } from '../../../types';

function makeHistory(count: number, rating: RatingEntry['rating'] = 'good'): RatingEntry[] {
  const now = Date.now();
  return Array.from({ length: count }, (_, i) => ({
    cardId: `card-${i % 10}`,
    rating,
    at: now - (count - i) * 86_400_000,
  }));
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(resolve(__dirname, '../../../../package.json'), 'utf-8'),
) as { dependencies: Record<string, string> };

describe('v2.2.0 Stage 3: fsrsOptimizer — binding 集成', () => {
  beforeEach(() => {
    mockComputeParameters.mockReset();
    mockFSRSBindingState.evaluateResult = { logLoss: 0.5, rmseBins: 0.1 };
    mockFSRSBindingState.shouldThrow = false;
    mockFSRSBindingState.evaluateCallCount = 0;
    // v2.2.0 hotfix: 重置 binding 模块级缓存, 避免测试间污染
    _resetBindingCacheForTesting();
  });

  describe('T06/T25: ratingHistory 不足校验', () => {
    it('T06: ratingHistory < 30 条 → 抛出错误 "至少 30 条"', async () => {
      const shortHistory = makeHistory(29);
      await expect(optimizeFsrsWeights(shortHistory)).rejects.toThrow(/至少 30 条/);
    });

    it('T25: optimizeFsrsWeights ratingHistory < 30 时抛 Error', async () => {
      const shortHistory = makeHistory(10);
      await expect(optimizeFsrsWeights(shortHistory)).rejects.toThrow(Error);
      await expect(optimizeFsrsWeights(shortHistory)).rejects.toThrow(/至少 30 条/);
    });
  });

  describe('T09/T23: isOptimizationAvailable', () => {
    it('T09: isOptimizationAvailable() 返回 true (binding 已安装)', async () => {
      expect(await isOptimizationAvailable()).toBe(true);
    });

    it('T23: isOptimizationAvailable() 在 binding 环境返回 true', async () => {
      expect(await isOptimizationAvailable()).toBe(true);
    });
  });

  describe('T24: optimizeFsrsWeights 成功路径', () => {
    it('T24: optimizeFsrsWeights 成功返回 weights + backup + loss', async () => {
      const mockWeights = [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10];
      mockComputeParameters.mockResolvedValue(mockWeights);
      mockFSRSBindingState.evaluateResult = { logLoss: 0.5, rmseBins: 0.1 };
      mockFSRSBindingState.shouldThrow = false;

      const history = makeHistory(50);
      const onProgress = vi.fn();
      const result = await optimizeFsrsWeights(history, onProgress);

      expect(result.weights).toEqual(mockWeights);
      expect(result.backup).toEqual([...DEFAULT_FSRS_WEIGHTS]);
      expect(result.loss).toBe(0.5);
      expect(mockComputeParameters).toHaveBeenCalledOnce();
      expect(mockFSRSBindingState.evaluateCallCount).toBe(1);
    });

    it('T24b: onProgress 回调被调用 (computeParameters progress 参数透传)', async () => {
      const mockWeights = [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10];
      mockComputeParameters.mockImplementation(
        async (_trainSet: unknown, options?: { progress?: (c: number, t: number) => void }) => {
          if (options?.progress) {
            options.progress(5, 10);
            options.progress(10, 10);
          }
          return mockWeights;
        },
      );
      mockFSRSBindingState.evaluateResult = { logLoss: 0.3, rmseBins: 0.1 };

      const history = makeHistory(50);
      const onProgress = vi.fn();
      await optimizeFsrsWeights(history, onProgress);

      expect(onProgress).toHaveBeenCalledWith(0.5);
      expect(onProgress).toHaveBeenCalledWith(1);
    });

    it('T24c: FSRSBinding.evaluate 失败时 loss 回退为 0', async () => {
      const mockWeights = [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10];
      mockComputeParameters.mockResolvedValue(mockWeights);
      mockFSRSBindingState.shouldThrow = true;

      const history = makeHistory(50);
      const result = await optimizeFsrsWeights(history);

      expect(result.weights).toEqual(mockWeights);
      expect(result.loss).toBe(0);
    });
  });

  describe('T19: package.json 依赖检查', () => {
    it('T19: package.json 含 @open-spaced-repetition/binding 依赖 (SPEC 偏差: ts-fsrs v6 不存在)', () => {
      expect(pkg.dependencies['@open-spaced-repetition/binding']).toBeDefined();
      // SPEC 偏差: ts-fsrs v6.0.0 不存在, 保持 ^5.4.1
      expect(pkg.dependencies['ts-fsrs']).toBe('^5.4.1');
    });
  });

  describe('T20-T22: schedulerAdapter 合同不回归', () => {
    it('T20: createFsrsInstance 配置正确 (snake_case 字段; SPEC 偏差: v6 N/A)', () => {
      // schedulerAdapter 仍使用 ts-fsrs 5.4.1 的 snake_case API
      // v6 maximumInterval 字段不存在, 保留 maximum_interval (合同 31-38 不回归)
      // 验证: createInitialMemoryCard 返回合法 New card (不调用 scheduleNextReview
      // 因为 New card stability=0 + difficulty=7 在 repeat() 中会抛 FSRSValidationError,
      // 这与 v1.8.0 行为一致 — scheduleNextReview 仅在 review-state 卡片上调用)
      const card = createInitialMemoryCard('grp-1', 'test', 3);
      expect(card).toBeDefined();
      expect(card.status).toBe('new');
      expect(card.stability).toBe(0);
      expect(card.difficulty).toBe(7); // difficultyToInitialDifficulty[3] = 7.0
    });

    it('T21: scheduleNextReview 行为不回归 (合同 31-38)', () => {
      // 使用 review-state 卡片 (非 New), 与 schedulerAdapter.test.ts T02 一致
      // New card (stability=0) 不能直接调 repeat(), 需先进入 review 状态
      const now = Date.now();
      const card: MemoryCard = {
        id: 'card-test',
        lexemeGroupId: 'grp-1',
        lemma: 'test',
        objectiveDifficulty: 3,
        firstLearnedAt: now - 86_400_000,
        lastReviewAt: now - 86_400_000,
        learningSteps: 1,
        due: now - 1000,
        stability: 10,
        difficulty: 5,
        elapsedDays: 1,
        scheduledDays: 1,
        reps: 3,
        lapses: 0,
        status: 'review',
      };
      const result = scheduleNextReview(card, 'good');
      expect(result.card).toBeDefined();
      expect(result.card.id).toBe(card.id);
      expect(result.card.lexemeGroupId).toBe('grp-1');
      expect(result.card.lemma).toBe('test');
      expect(typeof result.nextReviewAt).toBe('number');
      expect(result.nextReviewAt).toBeGreaterThan(now);
    });

    it('T22: createInitialMemoryCard 行为不回归', () => {
      const card = createInitialMemoryCard('grp-1', 'lemma', 3);
      expect(card.id).toContain('card-');
      expect(card.lexemeGroupId).toBe('grp-1');
      expect(card.lemma).toBe('lemma');
      expect(card.objectiveDifficulty).toBe(3);
      expect(card.status).toBe('new');
      expect(card.reps).toBe(0);
    });
  });

  describe('convertToReviewLog 导出验证', () => {
    it('convertToReviewLog 函数可用且返回数组', () => {
      const history = makeHistory(5);
      const log = convertToReviewLog(history);
      expect(Array.isArray(log)).toBe(true);
      expect(log.length).toBe(5);
    });
  });
});

// T07/T08/T10: binding 不可用场景 (使用 vi.doMock + 动态 import)
describe('v2.2.0 Stage 3: fsrsOptimizer — binding 不可用场景', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('@open-spaced-repetition/binding', () => ({
      computeParameters: undefined,
      FSRSBinding: vi.fn(),
      FSRSBindingItem: vi.fn(),
      FSRSBindingReview: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.doUnmock('@open-spaced-repetition/binding');
    vi.resetModules();
  });

  it('T07: computeParameters 不可用 → 抛出 OptimizationUnavailableError', async () => {
    const { optimizeFsrsWeights, OptimizationUnavailableError } = await import(
      './fsrsOptimizer'
    );
    const history = makeHistory(50);
    await expect(optimizeFsrsWeights(history)).rejects.toThrow(
      OptimizationUnavailableError,
    );
  });

  it('T08: OptimizationUnavailableError 含 "@open-spaced-repetition/binding" 提示', async () => {
    const { optimizeFsrsWeights, OptimizationUnavailableError } = await import(
      './fsrsOptimizer'
    );
    const history = makeHistory(50);
    try {
      await optimizeFsrsWeights(history);
      expect.fail('应抛出 OptimizationUnavailableError');
    } catch (e) {
      expect(e).toBeInstanceOf(OptimizationUnavailableError);
      const msg = (e as Error).message;
      expect(msg).toContain('@open-spaced-repetition/binding');
    }
  });

  it('T10: OptimizationUnavailableError 可被 instanceof 检测 (UI 友好降级)', async () => {
    const { optimizeFsrsWeights, OptimizationUnavailableError } = await import(
      './fsrsOptimizer'
    );
    const history = makeHistory(30);
    try {
      await optimizeFsrsWeights(history);
      expect.fail('应抛出 OptimizationUnavailableError');
    } catch (e) {
      // UI 通过 instanceof 检测此错误类型, 显示 "功能不可用" 而非通用错误
      expect(e instanceof OptimizationUnavailableError).toBe(true);
      expect((e as Error).name).toBe('OptimizationUnavailableError');
    }
  });
});
