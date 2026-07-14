/**
 * v2.1.1 Stage 2: generateWithJsonRetry schema 选择测试 (T12)
 *
 * 覆盖 SPEC Stage 2 合约:
 * - T12 [critical]: generateWithJsonRetry 根据 expectJson 类型选择 schema
 *
 * 设计:
 * - 沿用 router.test.ts 的 vi.mock 模式 (mock providerFactory + mockProvider)
 * - mockGenerate 返回 evaluation 格式 JSON ({grade, feedback})
 * - 调 generateWithFallback 传 expectJson: 'evaluation'
 * - 验证 result.parsed 有 evaluation 形状 (grade/feedback), 1 次调用即成功
 * - 如果 schema 选择错误 (用 PassagePayloadSchema), 解析会失败 -> retry -> mock fallback
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGenerate, mockMockGenerate } = vi.hoisted(() => ({
  mockGenerate: vi.fn(),
  mockMockGenerate: vi.fn(),
}));

vi.mock('./providerFactory', () => ({
  getProvider: vi.fn(() => async (options: unknown) => mockGenerate(options)),
  getProviderName: vi.fn(() => 'deepseek'),
  resetProviderCache: vi.fn(),
}));

vi.mock('./mockProvider', () => ({
  MockLLMProvider: vi.fn().mockImplementation(function MockLLMProvider() {
    return {
      id: 'mock' as const,
      generate: mockMockGenerate,
      testConnection: vi.fn().mockResolvedValue({ ok: true }),
    };
  }),
  lookupEvaluation: vi.fn(),
  lookupRemedySnippet: vi.fn(),
  lookupGloss: vi.fn(),
  SIMPLE_REMEDY_TEMPLATES_EN: {},
  SIMPLE_REMEDY_TEMPLATES_DE: {},
}));

import { generateWithFallback, resetProviderCache } from './router';
import { useSettingsStore } from '../../settings/store/useSettingsStore';
import { useToastStore } from '../../../store/useToastStore';
import { useAnalyticsStore } from '../../analytics/store/useAnalyticsStore';

const LLM_PROVIDER_ENV_KEYS = [
  'VITE_LLM_PROVIDER',
  'VITE_LLM_PROXY_URL',
  'VITE_LLM_MAX_TOKENS',
  'VITE_LLM_TEMPERATURE',
  'VITE_LLM_RETRY_ATTEMPTS',
  'VITE_LLM_TIMEOUT_MS',
] as const;

describe('v2.1.1 Stage 2: generateWithJsonRetry schema 选择 (T12)', () => {
  const baseSettings = {
    provider: 'deepseek' as const,
    apiKey: 'test-key',
    baseUrl: 'https://test.api.deepseek.com/v1',
    model: 'deepseek-chat',
    temperature: 0.5,
    enabled: true,
    timeout: 5,
    maxRetries: 2,
    streaming: false,
    jsonMaxAttempts: 2 as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    for (const k of LLM_PROVIDER_ENV_KEYS) {
      vi.stubEnv(k, k === 'VITE_LLM_PROVIDER' ? 'deepseek' : '');
    }
    resetProviderCache();
    mockMockGenerate.mockResolvedValue({ text: 'mock-fallback', parsed: undefined });
    useToastStore.setState({ toasts: [], notifications: {} });
    useAnalyticsStore.setState({ llmRepairCount: 0 });
    useSettingsStore.setState((s) => ({
      llm: { ...s.llm, jsonMaxAttempts: 2 },
    }));
  });

  it('T12 [critical]: expectJson="evaluation" 时用 EvaluationPayloadSchema 验证, 一次成功', async () => {
    // evaluation 格式 JSON (没有 text/tokens 字段)
    const evalJson = JSON.stringify({ grade: 'correct', feedback: 'Good!' });
    mockGenerate.mockResolvedValueOnce({ text: evalJson });

    const result = await generateWithFallback(baseSettings, {
      prompt: 'evaluate answer',
      expectJson: 'evaluation',
    });

    // 1 次 LLM 调用即成功 (EvaluationPayloadSchema 验证通过)
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    // 不应走 mock fallback
    expect(mockMockGenerate).not.toHaveBeenCalled();
    // result.parsed 有 evaluation 形状
    expect(result.parsed).toBeDefined();
    expect((result.parsed as { grade: string }).grade).toBe('correct');
    expect((result.parsed as { feedback: string }).feedback).toBe('Good!');
  });

  it('T12b [critical]: expectJson="difficulty" 时用 DifficultyPayloadSchema 验证', async () => {
    const diffJson = JSON.stringify({
      morphological: 3,
      abstractness: 4,
      frequencyPercentile: 60,
    });
    mockGenerate.mockResolvedValueOnce({ text: diffJson });

    const result = await generateWithFallback(baseSettings, {
      prompt: 'evaluate difficulty',
      expectJson: 'difficulty',
    });

    expect(mockGenerate).toHaveBeenCalledTimes(1);
    expect(mockMockGenerate).not.toHaveBeenCalled();
    expect(result.parsed).toBeDefined();
    expect((result.parsed as { morphological: number }).morphological).toBe(3);
  });

  it('T12c [critical]: expectJson="gloss" 时用 GlossPayloadSchema 验证', async () => {
    const glossJson = JSON.stringify({
      definitions: ['革命', '变革'],
      explanation: '指根本性变化',
    });
    mockGenerate.mockResolvedValueOnce({ text: glossJson });

    const result = await generateWithFallback(baseSettings, {
      prompt: 'rewrite gloss',
      expectJson: 'gloss',
    });

    expect(mockGenerate).toHaveBeenCalledTimes(1);
    expect(mockMockGenerate).not.toHaveBeenCalled();
    expect(result.parsed).toBeDefined();
    expect((result.parsed as { definitions: string[] }).definitions).toEqual(['革命', '变革']);
  });
});
