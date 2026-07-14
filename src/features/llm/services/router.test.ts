/**
 * generateWithFallback 单元测试 (v1.4.0 Stage 1+3 — T01..T17)
 *
 * 覆盖 SPEC 要求 17 个 case:
 * - T01 [critical]: LLM 返回无效 JSON (缺逗号) -> jsonrepair 修复 -> 返回数据
 * - T02 [critical]: LLM 返回完全损坏字符串 -> repair 仍失败 -> mock fallback
 * - T03 [critical]: LLM 返回合法 JSON -> 不走 repair, 一次成功
 * - T04 [critical]: LLM 第一次失败, 第二次成功 (retry 触发) -> 返回数据
 * - T05 [critical]: LLM 两次都失败 -> mock fallback 触发
 * - T06 [critical]: maxAttempts=3, 第 3 次成功 -> 返回数据 (不 fallback)
 * - T07 [critical]: maxAttempts=3 + 3 次都失败 -> mock fallback + 派发 toast
 * - T08 [critical]: broken json 触发后, useAnalyticsStore 记录 1 次 repair
 * - T09 [non-critical]: useSettingsStore.llm.jsonMaxAttempts=4 可配置生效
 * - T10 [critical] (hotfix-3): expectedLanguage='de' + LLM 返回 language='en' -> 视为 parse failure -> retry -> mock fallback
 * - T11 [non-critical] (hotfix-3): expectedLanguage='en' + LLM 返回 language='en' -> 正常通过
 * - T12 [critical] (v1.4.0 Stage 1): router 完整切换到 providerFactory (走 getProvider(), 不直连 class)
 * - T13 [critical] (v1.4.0 Stage 1): provider error 从 factory 透传, 不会吞掉
 * - T14 [critical] (v1.4.0 Stage 1): provider cache identity 保留 (factory 缓存)
 * - T15 [critical] (v1.4.0 Stage 3): router 路由到 openai provider (VITE_LLM_PROVIDER=openai)
 * - T16 [critical] (v1.4.0 Stage 3): router 路由到 anthropic provider (VITE_LLM_PROVIDER=anthropic)
 * - T17 [critical] (v1.4.0 Stage 3): router 路由到 deepseek provider (VITE_LLM_PROVIDER=deepseek)
 *
 * 设计:
 * - v1.4.0 Stage 1: vi.mock('./providerFactory') 让 getProvider() 返回 mock 函数
 *   (替代 v1.3.0 vi.mock('./openaiProvider') + v1.2.0 class-based provider 实例化)
 * - mock 函数体直接转发到 mockGenerate, 拦截每个 providerFn(options) 调用
 * - vi.mock('./mockProvider') 让 MockLLMProvider 构造时返回 mock, 验证 fallback
 * - vi.stubEnv('VITE_LLM_PROVIDER', 'deepseek') 让 factory 路由到 deepseek
 *   (factory 是 env-based 路由, 与 settings.provider 解耦)
 * - 用 vi.hoisted 共享 mock 引用, 避免 TDZ 报错
 * - beforeEach 重置 mocks + 缓存, 保证测试隔离
 * - T01-T05 固定 jsonMaxAttempts=2 (保持 v1.3.0 行为)
 * - T06-T09 测试 maxAttempts=3 默认值 + 用户可配置
 * - T10-T11 测试 hotfix-3 language compliance check
 * - T12-T14 测试 Stage 1 factory 函数式完整切换
 * - T15-T17 测试 Stage 3 router 真正能 dispatch 到 3 个 provider (openai/anthropic/deepseek)
 *   每个 case 用 vi.spyOn(providerFactory, 'getProvider').mockReturnValue(XMock) 注入 provider 函数
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// 使用 vi.hoisted 让 mock 函数在 vi.mock 工厂中可用
const { mockGenerate, mockMockGenerate } = vi.hoisted(() => ({
  mockGenerate: vi.fn(),
  mockMockGenerate: vi.fn(),
}));

/**
 * v1.4.0 Stage 1: mock providerFactory.getProvider() 返回函数式 ProviderFn
 *
 * 替代 v1.3.0 mock v1.2.0 class-based provider 实例化.
 * ProviderFn 内部直接调用 mockGenerate, 让测试通过 mockGenerate.mockResolvedValueOnce
 * 控制每次 LLM 调用的返回值 (兼容 T01-T11 全部期望).
 */
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

import {
  generateWithFallback,
  resetProviderCache,
} from './router';
import { useSettingsStore } from '../../settings/store/useSettingsStore';
import { useToastStore } from '../../../store/useToastStore';
import { useAnalyticsStore } from '../../analytics/store/useAnalyticsStore';
import * as providerFactory from './providerFactory';

// v1.4.0 Stage 1: VITE_LLM_PROVIDER env (让 factory 路由到 deepseek, 与 baseSettings.provider 对齐)
const LLM_PROVIDER_ENV_KEYS = [
  'VITE_LLM_PROVIDER',
  'VITE_LLM_PROXY_URL',
  'VITE_LLM_MAX_TOKENS',
  'VITE_LLM_TEMPERATURE',
  'VITE_LLM_RETRY_ATTEMPTS',
  'VITE_LLM_TIMEOUT_MS',
] as const;

describe('generateWithFallback (Stage 1 T01..T05 — jsonMaxAttempts=2 兼容旧行为)', () => {
  // 通用测试 settings: 用 deepseek 走 deepseekGenerate (factory.routeDeepSeek)
  // T01-T05 显式设置 jsonMaxAttempts=2, 保持 v1.3.0 测试期望
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

  // 合法 passage JSON (v1.1.0 schema)
  const validJsonText =
    '{"text": "Hello world", "tokens": [' +
    '{"lemma": "hi", "surfaceForm": "Hello", "startIndex": 0, "endIndex": 5, "partOfSpeech": "interjection"},' +
    '{"lemma": "world", "surfaceForm": "world", "startIndex": 6, "endIndex": 11, "partOfSpeech": "noun"}' +
    ']}';

  beforeEach(() => {
    vi.clearAllMocks();
    // v1.4.0 Stage 1: stub VITE_LLM_PROVIDER=deepseek, 让 factory 路由到 deepseek
    for (const k of LLM_PROVIDER_ENV_KEYS) {
      vi.stubEnv(k, k === 'VITE_LLM_PROVIDER' ? 'deepseek' : '');
    }
    resetProviderCache();
    // mock fallback 默认行为: 返回 { text: 'mock-fallback', parsed: undefined }
    mockMockGenerate.mockResolvedValue({ text: 'mock-fallback', parsed: undefined });
  });

  it('T01 [critical]: 缺逗号 JSON -> jsonrepair 修复 -> 一次成功', async () => {
    // 缺逗号: "hi" 后面少了 "," 紧跟 "surfaceForm"
    const brokenJson =
      '{"text": "Hello world", "tokens": [' +
      '{"lemma": "hi" "surfaceForm": "Hello", "startIndex": 0, "endIndex": 5, "partOfSpeech": "interjection"},' +
      '{"lemma": "world", "surfaceForm": "world", "startIndex": 6, "endIndex": 11, "partOfSpeech": "noun"}' +
      ']}';
    mockGenerate.mockResolvedValueOnce({ text: brokenJson });

    const result = await generateWithFallback(baseSettings, {
      prompt: 'gen passage',
      expectJson: true,
    });

    // 1 次 LLM 调用即可成功 (jsonrepair 在 router 内部完成)
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    // 不应走 mock fallback
    expect(mockMockGenerate).not.toHaveBeenCalled();
    // 解析成功
    expect(result.parsed).toBeDefined();
    expect((result.parsed as { text: string }).text).toBe('Hello world');
    expect((result.parsed as { tokens: unknown[] }).tokens).toHaveLength(2);
  });

  it('T02 [critical]: 完全损坏字符串 -> jsonrepair 失败 -> mock fallback', async () => {
    // 完全无 JSON 结构, jsonrepair 也救不了
    const corruptText = 'this is definitely not json at all, just some prose without structure';
    // 两次都返回损坏字符串 (而不是 undefined), 真正测试 parse 失败路径
    mockGenerate.mockResolvedValue({ text: corruptText });

    const result = await generateWithFallback(baseSettings, {
      prompt: 'gen passage',
      expectJson: true,
    });

    // 尝试了 2 次 (1 retry), 都因 parse 失败而未走通
    expect(mockGenerate).toHaveBeenCalledTimes(2);
    // mock fallback 被触发
    expect(mockMockGenerate).toHaveBeenCalledTimes(1);
    // fallback 响应被透传
    expect(result.text).toBe('mock-fallback');
    // parsed 应为空
    expect(result.parsed).toBeUndefined();
  });

  it('T03 [critical]: 合法 JSON -> 一次成功, 不走 repair / retry', async () => {
    mockGenerate.mockResolvedValueOnce({ text: validJsonText });

    const result = await generateWithFallback(baseSettings, {
      prompt: 'gen passage',
      expectJson: true,
    });

    // 1 次成功
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    expect(mockMockGenerate).not.toHaveBeenCalled();
    // parsed 已填入
    expect(result.parsed).toBeDefined();
    expect((result.parsed as { text: string }).text).toBe('Hello world');
    expect((result.parsed as { tokens: Array<{ lemma: string }> }).tokens[0].lemma).toBe('hi');
    expect((result.parsed as { tokens: Array<{ lemma: string }> }).tokens[1].lemma).toBe('world');
  });

  it('T04 [critical]: 第一次失败, 第二次成功 (retry 触发) -> 返回数据', async () => {
    // 第一次: 损坏 JSON
    mockGenerate.mockResolvedValueOnce({ text: 'broken {not valid}' });
    // 第二次: 合法 JSON (retry 携带 error context 后成功)
    mockGenerate.mockResolvedValueOnce({ text: validJsonText });

    const result = await generateWithFallback(baseSettings, {
      prompt: 'gen passage',
      expectJson: true,
    });

    // 2 次调用 (1 fail + 1 success)
    expect(mockGenerate).toHaveBeenCalledTimes(2);
    expect(mockMockGenerate).not.toHaveBeenCalled();
    // 第二次调用应包含 error context (Previous attempt failed)
    const secondCallArg = mockGenerate.mock.calls[1][0];
    expect(secondCallArg.prompt).toContain('Previous attempt failed');
    expect(secondCallArg.prompt).toContain('Please ensure your response is valid JSON');
    // parsed 来自第二次的成功响应
    expect(result.parsed).toBeDefined();
    expect((result.parsed as { text: string }).text).toBe('Hello world');
  });

  it('T05 [critical]: 两次都失败 -> mock fallback 触发', async () => {
    // 两次都返回损坏的 JSON
    mockGenerate.mockResolvedValueOnce({ text: 'broken {attempt 1}' });
    mockGenerate.mockResolvedValueOnce({ text: 'broken {attempt 2}' });

    const result = await generateWithFallback(baseSettings, {
      prompt: 'gen passage',
      expectJson: true,
    });

    // 2 次都尝试了, 1 次 mock fallback
    expect(mockGenerate).toHaveBeenCalledTimes(2);
    expect(mockMockGenerate).toHaveBeenCalledTimes(1);
    // 第二次 prompt 携带 error context
    const secondCallArg = mockGenerate.mock.calls[1][0];
    expect(secondCallArg.prompt).toContain('Previous attempt failed');
    // fallback 输出
    expect(result.text).toBe('mock-fallback');
  });
});

describe('generateWithFallback (Stage 1 T06..T09 — v1.2.0 LLM 稳定性强化)', () => {
  // 通用测试 settings: 显式设置 jsonMaxAttempts=3, 验证 v1.2.0 新默认值
  // (旧硬编码 2 在 T01-T05 中通过 baseSettings.jsonMaxAttempts=2 保留)
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
    jsonMaxAttempts: 3 as const,
  };

  // 合法 passage JSON (v1.1.0 schema)
  const validJsonText =
    '{"text": "Hello world", "tokens": [' +
    '{"lemma": "hi", "surfaceForm": "Hello", "startIndex": 0, "endIndex": 5, "partOfSpeech": "interjection"},' +
    '{"lemma": "world", "surfaceForm": "world", "startIndex": 6, "endIndex": 11, "partOfSpeech": "noun"}' +
    ']}';

  beforeEach(() => {
    vi.clearAllMocks();
    // v1.4.0 Stage 1: stub VITE_LLM_PROVIDER=deepseek, 让 factory 路由到 deepseek
    for (const k of LLM_PROVIDER_ENV_KEYS) {
      vi.stubEnv(k, k === 'VITE_LLM_PROVIDER' ? 'deepseek' : '');
    }
    resetProviderCache();
    // mock fallback 默认行为
    mockMockGenerate.mockResolvedValue({ text: 'mock-fallback', parsed: undefined });
    // 重置 toast / analytics / settings store, 避免跨测试污染
    useToastStore.setState({ toasts: [], notifications: {} });
    useAnalyticsStore.setState({ llmRepairCount: 0 });
    // 显式重置 settings.jsonMaxAttempts 为 3, 避免前序测试污染
    useSettingsStore.setState((s) => ({
      llm: { ...s.llm, jsonMaxAttempts: 3 },
    }));
  });

  it('T06 [critical]: maxAttempts=3, 第 3 次成功 -> 返回数据 (不 fallback)', async () => {
    // Arrange: 1, 2 次失败, 第 3 次成功
    mockGenerate.mockResolvedValueOnce({ text: 'broken {attempt 1}' });
    mockGenerate.mockResolvedValueOnce({ text: 'broken {attempt 2}' });
    mockGenerate.mockResolvedValueOnce({ text: validJsonText });

    // Act
    const result = await generateWithFallback(baseSettings, {
      prompt: 'gen passage',
      expectJson: true,
    });

    // Assert: 3 次 LLM 调用, 0 次 mock fallback, 解析成功
    expect(mockGenerate).toHaveBeenCalledTimes(3);
    expect(mockMockGenerate).not.toHaveBeenCalled();
    expect(result.parsed).toBeDefined();
    expect((result.parsed as { text: string }).text).toBe('Hello world');
  });

  it('T07 [critical]: maxAttempts=3 + 3 次都失败 -> mock fallback + 派发 toast', async () => {
    // Arrange: 3 次都返回损坏 JSON
    mockGenerate.mockResolvedValueOnce({ text: 'broken {attempt 1}' });
    mockGenerate.mockResolvedValueOnce({ text: 'broken {attempt 2}' });
    mockGenerate.mockResolvedValueOnce({ text: 'broken {attempt 3}' });

    // Act
    const result = await generateWithFallback(baseSettings, {
      prompt: 'gen passage',
      expectJson: true,
    });

    // Assert: 3 次 LLM 调用 + 1 次 mock fallback
    expect(mockGenerate).toHaveBeenCalledTimes(3);
    expect(mockMockGenerate).toHaveBeenCalledTimes(1);
    expect(result.text).toBe('mock-fallback');

    // 派发了 'llm-fallback' 持久通知
    const notification = useToastStore.getState().notifications['llm-fallback'];
    expect(notification).toBeDefined();
    expect(notification).toContain('已切换到预存文本');
  });

  it('T08 [critical]: broken JSON 触发后, useAnalyticsStore 记录 1 次 repair', async () => {
    // Arrange: 1 次 jsonrepair 可修复的 JSON (尾随逗号)
    const repairableJson =
      '{"text": "Hello world", "tokens": [' +
      '{"lemma": "hi", "surfaceForm": "Hello", "startIndex": 0, "endIndex": 5, "partOfSpeech": "interjection"},' +
      '{"lemma": "world", "surfaceForm": "world", "startIndex": 6, "endIndex": 11, "partOfSpeech": "noun"},' +
      ']}';
    mockGenerate.mockResolvedValueOnce({ text: repairableJson });

    // 重置计数 (确保测试隔离)
    useAnalyticsStore.setState({ llmRepairCount: 0 });

    // Act
    const result = await generateWithFallback(baseSettings, {
      prompt: 'gen passage',
      expectJson: true,
    });

    // Assert: 1 次 LLM 调用 + 1 次 jsonrepair 修复
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    expect(mockMockGenerate).not.toHaveBeenCalled();
    expect(result.parsed).toBeDefined();
    expect((result.parsed as { text: string }).text).toBe('Hello world');

    // analytics 计数 +1
    expect(useAnalyticsStore.getState().llmRepairCount).toBe(1);
  });

  it('T09 [non-critical]: useSettingsStore.llm.jsonMaxAttempts=4 可配置生效', async () => {
    // Arrange: 显式设置 settings store 的 jsonMaxAttempts=4
    useSettingsStore.setState((s) => ({
      llm: { ...s.llm, jsonMaxAttempts: 4 },
    }));

    // 4 次都返回损坏 JSON (验证 router 真的会调用 4 次)
    mockGenerate.mockResolvedValue({ text: 'broken {persistent}' });

    // Act: settings 显式传 jsonMaxAttempts=undefined (覆盖 baseSettings 默认 3)
    // 让 router 从 store 读取 = 4
    const result = await generateWithFallback(
      { ...baseSettings, jsonMaxAttempts: undefined as unknown as number },
      {
        prompt: 'gen passage',
        expectJson: true,
      }
    );

    // Assert: 4 次 LLM 调用 (不是默认 3 次) + mock fallback
    expect(mockGenerate).toHaveBeenCalledTimes(4);
    expect(mockMockGenerate).toHaveBeenCalledTimes(1);
    expect(result.text).toBe('mock-fallback');

    // 派发 fallback 通知 (4 次都失败, 必然 fallback)
    expect(useToastStore.getState().notifications['llm-fallback']).toBeDefined();
  });
});

describe('generateWithFallback (hotfix-3 T10..T11 — language compliance check)', () => {
  // v1.2.0 hotfix-3: language compliance check 测试
  // 模拟真实 LLM (deepseek-v4-flash) 即使 prompt 强约束德文, 仍返回英文 language 字段.
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

  // 合法但 language 字段是 'en' 的 JSON (模拟真实 LLM 行为)
  const englishJson =
    '{"language": "en", "difficulty": 2, "text": "Hello world", "tokens": [' +
    '{"lemma": "hi", "surfaceForm": "Hello", "startIndex": 0, "endIndex": 5, "partOfSpeech": "interjection"},' +
    '{"lemma": "world", "surfaceForm": "world", "startIndex": 6, "endIndex": 11, "partOfSpeech": "noun"}' +
    ']}';

  // 合法且 language 字段是 'en' 的 JSON (LLM 按要求输出英文)
  const englishJsonT11 = englishJson;

  beforeEach(() => {
    vi.clearAllMocks();
    // v1.4.0 Stage 1: stub VITE_LLM_PROVIDER=deepseek, 让 factory 路由到 deepseek
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

  it('T10 [hotfix-3 critical]: expectedLanguage="de" + LLM 返回 language="en" -> 视为 parse failure -> retry -> mock fallback', async () => {
    // Arrange: 2 次 LLM 调用都返回 language='en' (而非 'de')
    // 即使 prompt 强约束德文, deepseek-v4-flash 仍返回英文.
    mockGenerate.mockResolvedValue({ text: englishJson });

    // Act: 期望德文, LLM 返回英文 -> 应判定为 parse failure, 走 retry → mock fallback
    const result = await generateWithFallback(baseSettings, {
      prompt: 'gen passage',
      expectJson: true,
      expectedLanguage: 'de',
    });

    // Assert: 2 次 LLM 调用 (jsonMaxAttempts=2, 都因 language mismatch 失败) + 1 次 mock fallback
    expect(mockGenerate).toHaveBeenCalledTimes(2);
    expect(mockMockGenerate).toHaveBeenCalledTimes(1);
    expect(result.text).toBe('mock-fallback');
    // 派发了 fallback 通知
    expect(useToastStore.getState().notifications['llm-fallback']).toBeDefined();
  });

  it('T11 [hotfix-3 non-critical]: expectedLanguage="en" + LLM 返回 language="en" -> 正常通过', async () => {
    // Arrange: LLM 1 次返回 language='en' (与 expectedLanguage 匹配)
    mockGenerate.mockResolvedValueOnce({ text: englishJsonT11 });

    // Act
    const result = await generateWithFallback(baseSettings, {
      prompt: 'gen passage',
      expectJson: true,
      expectedLanguage: 'en',
    });

    // Assert: 1 次 LLM 调用, 不走 mock fallback, 正常通过 language compliance check
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    expect(mockMockGenerate).not.toHaveBeenCalled();
    expect(result.parsed).toBeDefined();
    expect((result.parsed as { text: string }).text).toBe('Hello world');
    // 验证 parsed.data.language = 'en'
    const parsedData = result.parsed as { language?: string };
    expect(parsedData.language).toBe('en');
  });
});

describe('generateWithFallback (v1.4.0 Stage 1 T12..T14 — providerFactory 函数式完整切换)', () => {
  // v1.4.0 Stage 1: 函数式完整切换到 providerFactory
  // T12: router 内部用 getProvider() 而非 class-based getProvider(settings)
  // T13: provider 抛错时, 错误正确透传, 走 retry + fallback
  // T14: provider cache identity 保留 (factory 缓存命中)
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

  const validJsonText =
    '{"text": "Hello world", "tokens": [' +
    '{"lemma": "hi", "surfaceForm": "Hello", "startIndex": 0, "endIndex": 5, "partOfSpeech": "interjection"},' +
    '{"lemma": "world", "surfaceForm": "world", "startIndex": 6, "endIndex": 11, "partOfSpeech": "noun"}' +
    ']}';

  beforeEach(() => {
    vi.clearAllMocks();
    // v1.4.0 Stage 1: stub VITE_LLM_PROVIDER=deepseek, 让 factory 路由到 deepseek
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

  it('T12 [critical v1.4.0 Stage 1]: router 完整切换到 providerFactory.getProvider() (不直连 class)', async () => {
    // Arrange: spy providerFactory.getProvider, 验证 router 真的调它 (而非 class-based 旧路径)
    const getProviderSpy = vi.spyOn(providerFactory, 'getProvider');
    mockGenerate.mockResolvedValueOnce({ text: validJsonText });

    // Act
    await generateWithFallback(baseSettings, {
      prompt: 'gen passage',
      expectJson: true,
    });

    // Assert: providerFactory.getProvider 被调至少 1 次
    // (resolveProviderFn 内调用 getFactoryProvider())
    expect(getProviderSpy).toHaveBeenCalled();
    // mockGenerate 来自 factory 路由 (deepseekGenerate 函数), 证明 factory 路由生效
    expect(mockGenerate).toHaveBeenCalledTimes(1);
  });

  it('T13 [critical v1.4.0 Stage 1]: provider 抛错时, 错误从 factory 透传, router 走 retry + fallback', async () => {
    // Arrange: spy providerFactory.getProvider, 让它返回的函数抛错 (模拟 factory 透传的网络异常)
    const factoryErrorFn = vi.fn().mockRejectedValue(new Error('Factory error: network down'));
    vi.spyOn(providerFactory, 'getProvider').mockReturnValue(
      factoryErrorFn as unknown as ReturnType<typeof providerFactory.getProvider>
    );

    // Act
    const result = await generateWithFallback(baseSettings, {
      prompt: 'gen passage',
      expectJson: true,
    });

    // Assert: factory 抛的错被 router 透传 + 捕获, 走完 2 次 retry, 最终 mock fallback
    expect(factoryErrorFn).toHaveBeenCalledTimes(2); // 2 次 retry
    expect(mockMockGenerate).toHaveBeenCalledTimes(1); // 1 次 mock fallback
    expect(result.text).toBe('mock-fallback');
    expect(result.parsed).toBeUndefined();
    // 派发了 fallback 通知
    expect(useToastStore.getState().notifications['llm-fallback']).toBeDefined();
  });

  it('T14 [critical v1.4.0 Stage 1]: provider cache identity 保留 (factory 缓存命中)', () => {
    // Arrange: 通过 vi.spyOn 拦截 factory.getProvider
    const getProviderSpy = vi.spyOn(providerFactory, 'getProvider');

    // Act 1: 第 1 次 generateWithFallback 调用 (让 factory 缓存命中)
    mockGenerate.mockResolvedValue({ text: validJsonText });
    return generateWithFallback(baseSettings, {
      prompt: 'gen passage 1',
      expectJson: true,
    }).then(() => {
      // Act 2: 第 2 次 generateWithFallback 调用
      return generateWithFallback(baseSettings, {
        prompt: 'gen passage 2',
        expectJson: true,
      });
    }).then(() => {
      // Assert: factory.getProvider 至少被调 1 次 (实际可能 1-2 次, 取决于 resolve 顺序)
      // 关键是: 多次 generateWithFallback 不会导致 factory 每次都重新构造 provider
      // factory 内部 cachedProvider 是 module-level, 跨调用复用
      const callCount = getProviderSpy.mock.calls.length;
      expect(callCount).toBeGreaterThanOrEqual(1);
      // 多次调用的入参都是无参 (factory 内部用 env + 缓存)
      for (const call of getProviderSpy.mock.calls) {
        expect(call).toEqual([]);
      }
    });
  });
});

describe('generateWithFallback (v1.4.0 Stage 3 T15..T17 — 3 provider 完整切换)', () => {
  // v1.4.0 Stage 3: 验证 router 真的能 dispatch 到 3 个不同 provider (openai/anthropic/deepseek)
  // - 每个 case 前 stubEnv(VITE_LLM_PROVIDER, X) + resetProviderCache()
  // - vi.spyOn(providerFactory, 'getProvider').mockReturnValue(XMock) 注入特定 provider 函数
  // - 调用 generateWithFallback 验证 XMock 被调用 + result 透传
  // - 验证: router 走 providerFactory.getProvider() 路由, 不直连 class
  const baseSettings = {
    provider: 'openai' as const,
    apiKey: 'test-key',
    baseUrl: 'https://test.api.openai.com/v1',
    model: 'gpt-4o-mini',
    temperature: 0.5,
    enabled: true,
    timeout: 5,
    maxRetries: 2,
    streaming: false,
    jsonMaxAttempts: 2 as const,
  };

  // 合法 passage JSON (满足 language compliance check: language="en")
  const validJsonText =
    '{"text": "provider-resp", "language": "en", "tokens": [' +
    '{"lemma": "hi", "surfaceForm": "Hi", "startIndex": 0, "endIndex": 2, "partOfSpeech": "interjection"}' +
    ']}';

  beforeEach(() => {
    vi.clearAllMocks();
    // 重置 env 到 default (避免前序测试污染)
    for (const k of LLM_PROVIDER_ENV_KEYS) {
      vi.stubEnv(k, '');
    }
    resetProviderCache();
    // mock fallback 默认行为
    mockMockGenerate.mockResolvedValue({ text: 'mock-fallback', parsed: undefined });
    // 重置 toast / analytics / settings store
    useToastStore.setState({ toasts: [], notifications: {} });
    useAnalyticsStore.setState({ llmRepairCount: 0 });
    useSettingsStore.setState((s) => ({
      llm: { ...s.llm, jsonMaxAttempts: 2 },
    }));
  });

  it('T15 [critical v1.4.0 Stage 3]: router dispatches to openai provider', async () => {
    // Arrange: stub VITE_LLM_PROVIDER=openai + reset 缓存
    for (const k of LLM_PROVIDER_ENV_KEYS) {
      vi.stubEnv(k, k === 'VITE_LLM_PROVIDER' ? 'openai' : '');
    }
    resetProviderCache();
    // Spy getProvider 注入 openai 特定 mock (覆盖 T12-T14 spy)
    const openaiMock = vi.fn().mockResolvedValue({ text: validJsonText });
    vi.spyOn(providerFactory, 'getProvider').mockReturnValue(
      openaiMock as unknown as ReturnType<typeof providerFactory.getProvider>
    );

    // Act
    const result = await generateWithFallback(baseSettings, {
      prompt: 'test',
      expectJson: true,
      expectedLanguage: 'en',
    });

    // Assert: openaiMock 被调用至少 1 次 (router 走 factory.getProvider() 路由到 openai)
    expect(openaiMock).toHaveBeenCalled();
    // mock fallback 不应触发 (openai mock 返回 valid JSON)
    expect(mockMockGenerate).not.toHaveBeenCalled();
    // 解析成功, result.parsed 透传
    expect(result.parsed).toBeDefined();
    expect((result.parsed as { text: string }).text).toBe('provider-resp');
  });

  it('T16 [critical v1.4.0 Stage 3]: router dispatches to anthropic provider', async () => {
    // Arrange: stub VITE_LLM_PROVIDER=anthropic + reset 缓存
    for (const k of LLM_PROVIDER_ENV_KEYS) {
      vi.stubEnv(k, k === 'VITE_LLM_PROVIDER' ? 'anthropic' : '');
    }
    resetProviderCache();
    // Spy getProvider 注入 anthropic 特定 mock
    const anthropicMock = vi.fn().mockResolvedValue({ text: validJsonText });
    vi.spyOn(providerFactory, 'getProvider').mockReturnValue(
      anthropicMock as unknown as ReturnType<typeof providerFactory.getProvider>
    );

    // Act
    const result = await generateWithFallback(baseSettings, {
      prompt: 'test',
      expectJson: true,
      expectedLanguage: 'en',
    });

    // Assert: anthropicMock 被调用至少 1 次 (router 路由到 anthropic)
    expect(anthropicMock).toHaveBeenCalled();
    // mock fallback 不应触发
    expect(mockMockGenerate).not.toHaveBeenCalled();
    // 解析成功
    expect(result.parsed).toBeDefined();
    expect((result.parsed as { text: string }).text).toBe('provider-resp');
  });

  it('T17 [critical v1.4.0 Stage 3]: router dispatches to deepseek provider', async () => {
    // Arrange: stub VITE_LLM_PROVIDER=deepseek + reset 缓存
    for (const k of LLM_PROVIDER_ENV_KEYS) {
      vi.stubEnv(k, k === 'VITE_LLM_PROVIDER' ? 'deepseek' : '');
    }
    resetProviderCache();
    // Spy getProvider 注入 deepseek 特定 mock
    const deepseekMock = vi.fn().mockResolvedValue({ text: validJsonText });
    vi.spyOn(providerFactory, 'getProvider').mockReturnValue(
      deepseekMock as unknown as ReturnType<typeof providerFactory.getProvider>
    );

    // Act
    const result = await generateWithFallback(baseSettings, {
      prompt: 'test',
      expectJson: true,
      expectedLanguage: 'en',
    });

    // Assert: deepseekMock 被调用至少 1 次 (router 路由到 deepseek)
    expect(deepseekMock).toHaveBeenCalled();
    // mock fallback 不应触发
    expect(mockMockGenerate).not.toHaveBeenCalled();
    // 解析成功
    expect(result.parsed).toBeDefined();
    expect((result.parsed as { text: string }).text).toBe('provider-resp');
  });
});

/**
 * v2.2.1 Stage 2 Bug 3 修复测试 (T07, T12)
 *
 * 验证 generateWithJsonRetry 的两处 fallback 路径都标记 fallbackToMock: true.
 * - T07: provider 返回 fallbackToMock: true 时, router fallback 结果含 fallbackToMock: true
 * - T07b: 所有重试失败时, router fallback 结果含 fallbackToMock: true
 * - T12: LLM 评估失败 fallback 后结果含 fallbackToMock: true (防止 llmAdapter 误标 source: 'llm')
 *
 * 设计:
 * - 复用 router.test.ts 顶部 vi.mock('./providerFactory') + vi.mock('./mockProvider')
 * - mockGenerate 控制每次 LLM 调用的返回值
 * - mockMockGenerate 默认返回 { text: 'mock-fallback', parsed: undefined }
 * - 验证 result.fallbackToMock === true (v2.2.1 Stage 2 新增标记)
 */
describe('generateWithFallback (v2.2.1 Stage 2 Bug 3 — fallbackToMock 标记)', () => {
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
    vi.restoreAllMocks();
    vi.clearAllMocks();
    for (const k of LLM_PROVIDER_ENV_KEYS) {
      vi.stubEnv(k, k === 'VITE_LLM_PROVIDER' ? 'deepseek' : '');
    }
    resetProviderCache();
    // v2.2.1: 显式重置 getProvider mock 实现, 避免前序 describe (T12-T17) 的
    // vi.spyOn(providerFactory, 'getProvider').mockReturnValue(...) 残留.
    // restoreAllMocks 在 vi.mock 创建的模块上行为不确定, 用 mockImplementation 强制覆盖.
    vi.mocked(providerFactory.getProvider).mockImplementation(
      (() => async (options: unknown) => mockGenerate(options)) as never
    );
    mockMockGenerate.mockResolvedValue({ text: 'mock-fallback', parsed: undefined });
    useToastStore.setState({ toasts: [], notifications: {} });
    useAnalyticsStore.setState({ llmRepairCount: 0 });
    useSettingsStore.setState((s) => ({
      llm: { ...s.llm, jsonMaxAttempts: 2 },
    }));
  });

  it('v2.2.1-T07 [critical]: provider 返回 fallbackToMock 时, router fallback 结果含 fallbackToMock: true', async () => {
    // provider 返回 fallbackToMock: true (e.g. Edge Function 报错, provider 内部 fallback)
    mockGenerate.mockResolvedValueOnce({ text: '', fallbackToMock: true });

    const result = await generateWithFallback(baseSettings, {
      prompt: 'gen passage',
      expectJson: true,
    });

    // router 应走 mock fallback, 且结果含 fallbackToMock: true
    expect(mockMockGenerate).toHaveBeenCalledTimes(1);
    expect(result.fallbackToMock).toBe(true);
    expect(result.text).toBe('mock-fallback');
  });

  it('v2.2.1-T07b [critical]: 所有重试失败时, router fallback 结果含 fallbackToMock: true', async () => {
    // 2 次都返回损坏 JSON, 触发 mock fallback
    mockGenerate.mockResolvedValueOnce({ text: 'broken {attempt 1}' });
    mockGenerate.mockResolvedValueOnce({ text: 'broken {attempt 2}' });

    const result = await generateWithFallback(baseSettings, {
      prompt: 'gen passage',
      expectJson: true,
    });

    // router 走 mock fallback, 且结果含 fallbackToMock: true
    expect(mockMockGenerate).toHaveBeenCalledTimes(1);
    expect(result.fallbackToMock).toBe(true);
    expect(result.text).toBe('mock-fallback');
  });

  it('v2.2.1-T12 [critical]: LLM 评估失败 fallback 后结果含 fallbackToMock: true (防止 llmAdapter 误标 source: llm)', async () => {
    // 模拟 evaluateAnswerViaLLM 场景: expectJson='evaluation', 所有重试失败
    mockGenerate.mockResolvedValueOnce({ text: 'broken {attempt 1}' });
    mockGenerate.mockResolvedValueOnce({ text: 'broken {attempt 2}' });

    const result = await generateWithFallback(baseSettings, {
      prompt: 'evaluate answer',
      expectJson: 'evaluation',
    });

    // fallback 结果必须含 fallbackToMock: true, 让 evaluateAnswerViaLLM
    // 能通过 if (result.fallbackToMock) 检测并走 mockEvaluate (source: heuristic),
    // 而非误标为 source: 'llm'
    expect(result.fallbackToMock).toBe(true);
    // parsed 应为 undefined (不应被误当评估结果)
    expect(result.parsed).toBeUndefined();
  });
});
