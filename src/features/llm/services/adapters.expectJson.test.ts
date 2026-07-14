/**
 * v2.1.1 Stage 2: 调用方 expectJson 值验证 (T13-T14)
 *
 * 覆盖 SPEC Stage 2 合约:
 * - T13 [critical]: evaluateAnswerViaLLM 使用 expectJson: 'evaluation'
 * - T14 [critical]: evaluateDifficulty 使用 expectJson: 'difficulty'
 *
 * 设计:
 * - vi.mock('./router') 拦截 generateWithFallback, 验证调用参数
 * - T13: 设置 useSettingsStore LLM enabled, 调 evaluateAnswerViaLLM,
 *         验证 generateWithFallback 被调用时含 expectJson: 'evaluation'
 * - T14: clearDifficultyCache + 设置 useSettingsStore, 调 evaluateDifficulty,
 *         验证 generateWithFallback 被调用时含 expectJson: 'difficulty'
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// 拦截 router 模块, 让 generateWithFallback 成为可控 mock
vi.mock('./router', () => ({
  generateWithFallback: vi.fn(),
  resetProviderCache: vi.fn(),
}));

// v2.2.1 Stage 2 (Bug 3): 拦截 evaluateAnswer (llmAdapter 内 import 为 mockEvaluate),
// 防止 fallback 路径走真实 evaluateAnswer → evaluateAnswerViaLLM 递归.
vi.mock('../../evaluation/services/evaluateAnswer', () => ({
  evaluateAnswer: vi.fn(),
}));

import { generateWithFallback } from './router';
import { evaluateAnswerViaLLM } from './llmAdapter';
import { evaluateDifficulty, clearDifficultyCache } from './difficultyEvaluator';
import { useSettingsStore } from '../../settings/store/useSettingsStore';
import { evaluateAnswer } from '../../evaluation/services/evaluateAnswer';

describe('v2.1.1 Stage 2: 调用方 expectJson 值验证 (T13-T14)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(generateWithFallback).mockReset();
    vi.mocked(evaluateAnswer).mockReset();
    // 设置 LLM enabled + provider 非 mock
    useSettingsStore.setState((s) => ({
      ...s,
      llm: {
        ...s.llm,
        provider: 'deepseek',
        enabled: true,
        apiKey: 'test-key',
        baseUrl: 'https://test.api.deepseek.com/v1',
        model: 'deepseek-chat',
        temperature: 0.5,
        timeout: 5,
        maxRetries: 2,
        streaming: false,
        jsonMaxAttempts: 2,
      },
    }));
    // 清空难度缓存, 避免跨测试污染
    clearDifficultyCache();
  });

  it('T13 [critical]: evaluateAnswerViaLLM 使用 expectJson: "evaluation"', async () => {
    // mock generateWithFallback 返回 evaluation 格式响应
    vi.mocked(generateWithFallback).mockResolvedValue({
      text: JSON.stringify({ grade: 'correct', feedback: 'Good!' }),
      parsed: { grade: 'correct', feedback: 'Good!' },
      fallbackToMock: false,
    });

    const result = await evaluateAnswerViaLLM({
      userAnswer: '革命',
      lemma: 'revolution',
      objectiveDifficulty: 3,
      language: 'en',
    });

    // 验证 generateWithFallback 被调用时传入了 expectJson: 'evaluation'
    expect(generateWithFallback).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ expectJson: 'evaluation' })
    );
    // 验证返回了 LLM 评估结果
    expect(result.source).toBe('llm');
    expect(result.grade).toBe('correct');
    expect(result.feedback).toBe('Good!');
  });

  it('T14 [critical]: evaluateDifficulty 使用 expectJson: "difficulty"', async () => {
    // mock generateWithFallback 返回 difficulty 格式响应
    vi.mocked(generateWithFallback).mockResolvedValue({
      text: JSON.stringify({
        morphological: 3,
        abstractness: 4,
        frequencyPercentile: 60,
        reasoning: 'moderate difficulty',
      }),
      parsed: {
        morphological: 3,
        abstractness: 4,
        frequencyPercentile: 60,
        reasoning: 'moderate difficulty',
      },
      fallbackToMock: false,
    });

    const result = await evaluateDifficulty('revolution', 'en');

    // 验证 generateWithFallback 被调用时传入了 expectJson: 'difficulty'
    expect(generateWithFallback).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ expectJson: 'difficulty' })
    );
    // 验证返回了 LLM 评估结果
    expect(result.isLLMEvaluated).toBe(true);
    expect(result.morphological).toBe(3);
    expect(result.abstractness).toBe(4);
    expect(result.frequencyPercentile).toBe(60);
  });
});

/**
 * v2.2.1 Stage 2 Bug 3 修复测试 (T08)
 *
 * 验证 evaluateAnswerViaLLM 在 result.parsed 为 undefined 时走 mockEvaluate,
 * 而非用 safeJsonParse 解析 passage 文本当评估结果.
 *
 * 设计:
 * - vi.mock('./router') 拦截 generateWithFallback, 返回 parsed: undefined
 * - vi.mock('../../evaluation/services/evaluateAnswer') 拦截 mockEvaluate,
 *   防止递归并验证调用
 * - 验证 evaluateAnswer (mockEvaluate) 被调用, 返回 heuristic 评估结果
 */
describe('v2.2.1 Stage 2 Bug 3 — evaluateAnswerViaLLM fallback 检测 (T08)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(generateWithFallback).mockReset();
    vi.mocked(evaluateAnswer).mockReset();
    useSettingsStore.setState((s) => ({
      ...s,
      llm: {
        ...s.llm,
        provider: 'deepseek',
        enabled: true,
        apiKey: 'test-key',
        baseUrl: 'https://test.api.deepseek.com/v1',
        model: 'deepseek-chat',
        temperature: 0.5,
        timeout: 5,
        maxRetries: 2,
        streaming: false,
        jsonMaxAttempts: 2,
      },
    }));
  });

  it('v2.2.1-T08 [critical]: evaluateAnswerViaLLM 在 result.parsed undefined 时走 mockEvaluate', async () => {
    // mock generateWithFallback 返回 parsed: undefined (schema 校验未通过, 走了 mock fallback)
    // 但 fallbackToMock: false (模拟边界情况: parsed 缺失但 fallbackToMock 未标记)
    vi.mocked(generateWithFallback).mockResolvedValue({
      text: '{"text": "passage content", "tokens": []}',
      parsed: undefined,
      fallbackToMock: false,
    });
    // mock evaluateAnswer (mockEvaluate) 返回 heuristic 评估
    vi.mocked(evaluateAnswer).mockResolvedValue({
      grade: 'partial',
      feedback: '离线评估结果',
      source: 'heuristic',
    });

    const result = await evaluateAnswerViaLLM({
      userAnswer: '革命',
      lemma: 'revolution',
      objectiveDifficulty: 3,
      language: 'en',
    });

    // 验证 mockEvaluate (evaluateAnswer) 被调用, 而非解析 passage 文本
    expect(evaluateAnswer).toHaveBeenCalledWith('革命', 'revolution', 3);
    // 返回 heuristic 评估结果, 不误标为 'llm' source
    expect(result.source).toBe('heuristic');
    expect(result.grade).toBe('partial');
  });

  it('v2.2.1-T08b [critical]: evaluateAnswerViaLLM 在 result.fallbackToMock=true 时走 mockEvaluate', async () => {
    // mock generateWithFallback 返回 fallbackToMock: true (v2.2.1 D2-1 修复后的正常 fallback 路径)
    vi.mocked(generateWithFallback).mockResolvedValue({
      text: 'mock-fallback',
      parsed: undefined,
      fallbackToMock: true,
    });
    // mock evaluateAnswer (mockEvaluate) 返回 heuristic 评估
    vi.mocked(evaluateAnswer).mockResolvedValue({
      grade: 'wrong',
      feedback: '离线评估: 答案不匹配',
      source: 'heuristic',
    });

    const result = await evaluateAnswerViaLLM({
      userAnswer: '错误答案',
      lemma: 'revolution',
      objectiveDifficulty: 3,
      language: 'en',
    });

    // 验证 mockEvaluate 被调用 (fallbackToMock 检测优先于 parsed 检测)
    expect(evaluateAnswer).toHaveBeenCalledWith('错误答案', 'revolution', 3);
    // 返回 heuristic 评估结果, 不误标为 'llm' source
    expect(result.source).toBe('heuristic');
  });
});
