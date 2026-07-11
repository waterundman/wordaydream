/**
 * openaiGenerate 单元测试 (v1.3.0 Stage 2 — T01..T03)
 *
 * 覆盖 SPEC 要求 3 个 case:
 * - T01 [critical]: POST 到 VITE_LLM_PROXY_URL, request body 包含 provider/system/prompt/expectedLanguage
 * - T02 [critical]: 解析 Edge Function 响应 (text / model / usage / language) 正确
 * - T03 [critical]: 5xx / 4xx 响应时, 抛带 status 的 Error
 *
 * 设计:
 * - mock globalThis.fetch, 模拟 Edge Function 响应
 * - 每个 case 前 resetLLMConfig() + clearAllEnv, 保证测试隔离
 * - 用 vi.hoisted 共享 mock fetch 引用, 避免 TDZ 报错
 * - 直接断言 fetch 的入参 (URL, method, body), 不依赖内部变量
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openaiGenerate } from './openaiProvider';
import { resetLLMConfig } from '../config/llmConfig';

const { mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

describe('openaiGenerate (v1.3.0 Stage 2 — T01..T03)', () => {
  // 测试涉及的 env 字段
  const ENV_KEYS = [
    'VITE_LLM_PROVIDER',
    'VITE_LLM_PROXY_URL',
    'VITE_LLM_MAX_TOKENS',
    'VITE_LLM_TEMPERATURE',
    'VITE_LLM_RETRY_ATTEMPTS',
    'VITE_LLM_TIMEOUT_MS',
  ] as const;

  function stubAllEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>): void {
    for (const k of ENV_KEYS) {
      vi.stubEnv(k, values[k] ?? '');
    }
  }

  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;
    mockFetch.mockReset();
    resetLLMConfig();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
    resetLLMConfig();
  });

  it('T01 [critical]: POST 到 VITE_LLM_PROXY_URL, body 包含正确 schema', async () => {
    // Arrange: mock fetch 返回合法 Edge Function 响应
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          text: 'Hello',
          model: 'gpt-4o-mini',
          usage: { inputTokens: 5, outputTokens: 3 },
          language: 'en',
        }),
    } as unknown as Response);

    // 注入 VITE_LLM_PROXY_URL (覆盖 zod default)
    stubAllEnv({ VITE_LLM_PROXY_URL: 'http://localhost:8888/proxy' });

    // Act
    await openaiGenerate({
      system: 'You are helpful',
      prompt: 'Hi',
      temperature: 0.5,
      maxTokens: 100,
      expectJson: true,
      expectedLanguage: 'en',
    });

    // Assert: 1 次 fetch, URL 是 proxyUrl, method POST
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(calledUrl).toBe('http://localhost:8888/proxy');
    expect(calledInit.method).toBe('POST');
    // body 字符串包含 provider=openai + expectedLanguage=en
    const bodyStr = String(calledInit.body);
    expect(bodyStr).toContain('"provider":"openai"');
    expect(bodyStr).toContain('"expectedLanguage":"en"');
    expect(bodyStr).toContain('"system":"You are helpful"');
    expect(bodyStr).toContain('"prompt":"Hi"');
  });

  it('T02 [critical]: 解析 Edge Function 响应 (text/model/usage/language) 正确', async () => {
    // Arrange: 清空 env, 让 zod default 接管
    stubAllEnv({});
    // 德文响应
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          text: 'Guten Tag',
          model: 'gpt-4o-mini',
          usage: { inputTokens: 10, outputTokens: 5 },
          language: 'de',
        }),
    } as unknown as Response);

    // Act
    const result = await openaiGenerate({
      system: 'test',
      prompt: 'test',
      expectedLanguage: 'de',
    });

    // Assert: text 字段透传
    expect(result.text).toBe('Guten Tag');
    // parsed 暂不解析 (router 阶段做), 保持 undefined
    expect(result.parsed).toBeUndefined();
    // error / fallbackToMock 不应被设置
    expect(result.error).toBeUndefined();
    expect(result.fallbackToMock).toBeUndefined();
  });

  it('T03 [critical]: 5xx 响应时, 抛带 status 的 Error', async () => {
    // Arrange: 清空 env, 让 zod default 接管
    stubAllEnv({});
    // mock fetch 返回 500 + 错误 body
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: () => Promise.resolve('Internal error'),
    } as unknown as Response);

    // Act + Assert: 抛 Error
    let caught: Error | null = null;
    try {
      await openaiGenerate({ prompt: 'test' });
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught!.message).toContain('LLM proxy error');
    expect(caught!.message).toContain('500');
    // 验证 status 属性被附加到 error 上 (router 据此做 retry / fallback 决策)
    const errWithStatus = caught as Error & { status?: number };
    expect(errWithStatus.status).toBe(500);
  });
});
