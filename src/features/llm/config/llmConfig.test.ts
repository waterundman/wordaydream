/**
 * llmConfig 单元测试 (v1.3.0 Stage 2 — T01..T02)
 *
 * 覆盖 SPEC 要求 2 个 case:
 * - T01 [critical]: 当 env 为空时, 返回全部 zod default 值
 * - T02 [critical]: env override 生效 (provider / maxTokens)
 *
 * 设计:
 * - 每个 case 前 vi.stubEnv 清空所有 env, vi.unstubAllEnvs 复位
 * - 用 vi.stubEnv(name, value) 注入测试值 (Vitest 4.x 原生支持, 不会污染其他测试)
 * - 用空字符串 '' 表示 "未设置" (llmConfig.readEnvString 内部把空串归一为 undefined,
 *   让 zod default 接管)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLLMConfig, resetLLMConfig } from './llmConfig';

describe('llmConfig (v1.3.0 Stage 2 — T01..T02)', () => {
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

  beforeEach(() => {
    resetLLMConfig();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetLLMConfig();
  });

  it('T01 [critical]: env 全空时, 返回全部 zod default 值', () => {
    // Arrange: 所有 env 字段用空串 (视为未设置)
    stubAllEnv({});

    // Act
    const config = getLLMConfig();

    // Assert: 6 个字段全部命中 zod default
    expect(config.provider).toBe('openai');
    expect(config.proxyUrl).toBe(
      'http://localhost:8888/.netlify/edge-functions/llm-proxy'
    );
    expect(config.maxTokens).toBe(2048);
    expect(config.temperature).toBe(0.7);
    expect(config.retryAttempts).toBe(3);
    expect(config.timeoutMs).toBe(30000);
  });

  it('T02 [critical]: env override 生效 (provider + maxTokens)', () => {
    // Arrange: 注入 2 个 env 字段
    stubAllEnv({
      VITE_LLM_PROVIDER: 'anthropic',
      VITE_LLM_MAX_TOKENS: '4096',
    });

    // Act
    const config = getLLMConfig();

    // Assert: 注入的 2 个字段变了
    expect(config.provider).toBe('anthropic');
    expect(config.maxTokens).toBe(4096);
    // 未注入的字段仍为 default
    expect(config.temperature).toBe(0.7);
    expect(config.retryAttempts).toBe(3);
    expect(config.timeoutMs).toBe(30000);
  });
});
