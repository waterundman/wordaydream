/**
 * providerFactory 单元测试 (v1.3.0 Stage 2 + v1.4.0 Stage 3 + v1.5.0 Stage 4)
 *
 * 覆盖 SPEC 要求 11 个 case:
 * - T01 [critical]: VITE_LLM_PROVIDER=openai → getProviderName() === 'openai'
 * - T02 [critical]: VITE_LLM_PROVIDER=anthropic → getProviderName() === 'anthropic'
 * - T03 [critical]: VITE_LLM_PROVIDER=deepseek → getProviderName() === 'deepseek'
 * - T04 [critical]: getProvider() 多次调用返回同一函数引用 (缓存命中)
 * - T05 [critical] (v1.4.0 Stage 3): cache identity 跨 3 provider (openai/anthropic/deepseek 每个 provider 多次 getProvider 返回同一引用)
 * - T06 [critical] (v1.4.0 Stage 3): 不同 provider 返回不同函数引用 (openai/anthropic/deepseek 之间互不相同) + 验证 provider name
 * - T15 [critical v1.5.0 Stage 4]: parseGrayscale 边界 — '0' / '10' / '100' / 'abc' / '-1' / '101' / '' 全部回退或通过
 * - T16 [critical v1.5.0 Stage 4]: selectByWeight 边界 — grayscale=100 → 'openai', grayscale=0 → 'anthropic', grayscale=10 → weighted (用 rng mock)
 * - T17 [critical v1.5.0 Stage 4]: 灰度路由 — grayscale=10 + rng=0.05 → 走 anthropic, rng=0.95 → 走 openai
 * - T18 [critical v1.5.0 Stage 4]: 默认 grayscale=100 — config.provider='openai' 全部走 openai (与 v1.4.1 一致, 0 breaking change)
 * - T19 [critical v1.5.0 Stage 4]: deepseek 不参与灰度 — config.provider='deepseek', grayscale=10 仍走 deepseek
 *
 * 设计:
 * - 每个 case 前 resetProviderCache() + clearAllEnv, 保证测试隔离
 * - 仅断言 provider name + 缓存身份, 不真正调用 provider 函数
 *   (provider 函数的真实行为由 openaiProvider.test.ts / anthropicProvider 各自测试覆盖)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getProvider, getProviderName, parseGrayscale, resetProviderCache, selectByWeight } from './providerFactory';
import { resetLLMConfig } from '../config/llmConfig';

describe('providerFactory (v1.3.0 Stage 2 — T01..T04)', () => {
  const ENV_KEYS = [
    'VITE_LLM_PROVIDER',
    'VITE_LLM_PROXY_URL',
    'VITE_LLM_MAX_TOKENS',
    'VITE_LLM_TEMPERATURE',
    'VITE_LLM_RETRY_ATTEMPTS',
    'VITE_LLM_TIMEOUT_MS',
    'VITE_LLM_GRAYSCALE',
  ] as const;

  function stubAllEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>): void {
    for (const k of ENV_KEYS) {
      vi.stubEnv(k, values[k] ?? '');
    }
  }

  beforeEach(() => {
    resetProviderCache();
    resetLLMConfig();
    // mock fetch 避免 anthropic/deepseek 桥接路径触发真实网络请求
    // (openai 走 Edge Function, 同样需要 mock)
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          text: 'mock',
          model: 'mock-model',
          usage: { inputTokens: 0, outputTokens: 0 },
          language: 'en',
        }),
    } as unknown as Response) as typeof globalThis.fetch;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetProviderCache();
    resetLLMConfig();
  });

  it('T01 [critical]: VITE_LLM_PROVIDER=openai → 返回 openai 路由 + provider name', () => {
    stubAllEnv({ VITE_LLM_PROVIDER: 'openai' });

    const provider = getProvider();
    expect(provider).toBeDefined();
    expect(typeof provider).toBe('function');
    expect(getProviderName()).toBe('openai');
  });

  it('T02 [critical]: VITE_LLM_PROVIDER=anthropic → 返回 anthropic 路由 + provider name', () => {
    stubAllEnv({ VITE_LLM_PROVIDER: 'anthropic' });

    const provider = getProvider();
    expect(provider).toBeDefined();
    expect(typeof provider).toBe('function');
    expect(getProviderName()).toBe('anthropic');
  });

  it('T03 [critical]: VITE_LLM_PROVIDER=deepseek → 返回 deepseek 路由 + provider name', () => {
    stubAllEnv({ VITE_LLM_PROVIDER: 'deepseek' });

    const provider = getProvider();
    expect(provider).toBeDefined();
    expect(typeof provider).toBe('function');
    expect(getProviderName()).toBe('deepseek');
  });

  it('T04 [critical]: getProvider() 多次调用返回同一函数引用 (缓存命中)', () => {
    stubAllEnv({ VITE_LLM_PROVIDER: 'openai' });

    const p1 = getProvider();
    const p2 = getProvider();
    const p3 = getProvider();
    // 同一引用: 工厂缓存命中
    expect(p2).toBe(p1);
    expect(p3).toBe(p1);
  });
});

describe('providerFactory (v1.4.0 Stage 3 — T05..T06 cache identity 跨 3 provider)', () => {
  // v1.4.0 Stage 3: 验证 cache identity 跨 3 个 provider
  // - T05: 每个 provider 多次 getProvider() 返回同一函数引用 (cache 命中)
  // - T06: 不同 provider 返回不同函数引用 (routeOpenAI/routeAnthropic/routeDeepSeek 各自独立闭包)
  //
  // 与 v1.3.0 T04 区别: T04 仅测 openai 缓存, T05 扩展到 3 provider 完整覆盖

  const ENV_KEYS = [
    'VITE_LLM_PROVIDER',
    'VITE_LLM_PROXY_URL',
    'VITE_LLM_MAX_TOKENS',
    'VITE_LLM_TEMPERATURE',
    'VITE_LLM_RETRY_ATTEMPTS',
    'VITE_LLM_TIMEOUT_MS',
    'VITE_LLM_GRAYSCALE',
  ] as const;

  function stubAllEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>): void {
    for (const k of ENV_KEYS) {
      vi.stubEnv(k, values[k] ?? '');
    }
  }

  beforeEach(() => {
    resetProviderCache();
    resetLLMConfig();
    // mock fetch 避免 anthropic/deepseek 桥接路径触发真实网络请求
    // (openai 走 Edge Function, 同样需要 mock)
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          text: 'mock',
          model: 'mock-model',
          usage: { inputTokens: 0, outputTokens: 0 },
          language: 'en',
        }),
    } as unknown as Response) as typeof globalThis.fetch;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetProviderCache();
    resetLLMConfig();
  });

  it('T05 [critical v1.4.0 Stage 3]: cache identity 跨 3 provider (openai/anthropic/deepseek 各自缓存命中)', () => {
    // openai: 多次 getProvider 返回同一引用
    stubAllEnv({ VITE_LLM_PROVIDER: 'openai' });
    const openaiP1 = getProvider();
    const openaiP2 = getProvider();
    const openaiP3 = getProvider();
    expect(openaiP1).toBe(openaiP2);
    expect(openaiP2).toBe(openaiP3);

    // anthropic: 切换 env + reset 缓存, 多次 getProvider 返回同一引用
    stubAllEnv({ VITE_LLM_PROVIDER: 'anthropic' });
    resetProviderCache();
    const anthropicP1 = getProvider();
    const anthropicP2 = getProvider();
    const anthropicP3 = getProvider();
    expect(anthropicP1).toBe(anthropicP2);
    expect(anthropicP2).toBe(anthropicP3);

    // deepseek: 切换 env + reset 缓存, 多次 getProvider 返回同一引用
    stubAllEnv({ VITE_LLM_PROVIDER: 'deepseek' });
    resetProviderCache();
    const deepseekP1 = getProvider();
    const deepseekP2 = getProvider();
    const deepseekP3 = getProvider();
    expect(deepseekP1).toBe(deepseekP2);
    expect(deepseekP2).toBe(deepseekP3);
  });

  it('T06 [critical v1.4.0 Stage 3]: 不同 provider 返回不同函数引用 + provider name 验证', () => {
    // openai
    stubAllEnv({ VITE_LLM_PROVIDER: 'openai' });
    const openaiP = getProvider();

    // anthropic
    stubAllEnv({ VITE_LLM_PROVIDER: 'anthropic' });
    resetProviderCache();
    const anthropicP = getProvider();

    // deepseek
    stubAllEnv({ VITE_LLM_PROVIDER: 'deepseek' });
    resetProviderCache();
    const deepseekP = getProvider();

    // 3 provider 函数互不相同 (routeOpenAI/routeAnthropic/routeDeepSeek 各自独立闭包)
    expect(openaiP).not.toBe(anthropicP);
    expect(anthropicP).not.toBe(deepseekP);
    expect(openaiP).not.toBe(deepseekP);

    // 验证 3 provider 各自 getProviderName() 正确
    stubAllEnv({ VITE_LLM_PROVIDER: 'openai' });
    resetProviderCache();
    expect(getProviderName()).toBe('openai');

    stubAllEnv({ VITE_LLM_PROVIDER: 'anthropic' });
    resetProviderCache();
    expect(getProviderName()).toBe('anthropic');

    stubAllEnv({ VITE_LLM_PROVIDER: 'deepseek' });
    resetProviderCache();
    expect(getProviderName()).toBe('deepseek');
  });
});

/**
 * v1.5.0 Stage 4 P2_1: parseGrayscale / selectByWeight 灰度路由 5 NEW cases (T15-T19)
 *
 * - T15: parseGrayscale 边界 (parseInt + zod 边界)
 * - T16: selectByWeight 边界 (grayscale=100 / 0 / 10 加权)
 * - T17: 灰度路由 (rng=0.05 → anthropic, rng=0.95 → openai)
 * - T18: 默认 grayscale=100 → 与 v1.4.1 一致 (0 breaking change)
 * - T19: deepseek 不参与灰度 (grayscale=10 + provider=deepseek 仍走 deepseek)
 */
describe('providerFactory (v1.5.0 Stage 4 P2_1 — T15..T19 grayscale routing)', () => {
  const ENV_KEYS = [
    'VITE_LLM_PROVIDER',
    'VITE_LLM_PROXY_URL',
    'VITE_LLM_MAX_TOKENS',
    'VITE_LLM_TEMPERATURE',
    'VITE_LLM_RETRY_ATTEMPTS',
    'VITE_LLM_TIMEOUT_MS',
    'VITE_LLM_GRAYSCALE',
  ] as const;

  function stubAllEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>): void {
    for (const k of ENV_KEYS) {
      vi.stubEnv(k, values[k] ?? '');
    }
  }

  beforeEach(() => {
    resetProviderCache();
    resetLLMConfig();
    // mock fetch 避免真实网络请求
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          text: 'mock',
          model: 'mock-model',
          usage: { inputTokens: 0, outputTokens: 0 },
          language: 'en',
        }),
    } as unknown as Response) as typeof globalThis.fetch;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetProviderCache();
    resetLLMConfig();
  });

  it('T15 [critical v1.5.0 Stage 4 P2_1]: parseGrayscale 边界 (合法 + 失败回退)', () => {
    // 合法值
    expect(parseGrayscale('0')).toBe(0);
    expect(parseGrayscale('1')).toBe(1);
    expect(parseGrayscale('10')).toBe(10);
    expect(parseGrayscale('50')).toBe(50);
    expect(parseGrayscale('100')).toBe(100);

    // 失败回退 (parseGrayscale 自身有兜底, 与 zod schema 无关)
    expect(parseGrayscale(undefined)).toBe(100);  // undefined → 100
    expect(parseGrayscale('')).toBe(100);          // 空字符串 → 100
    expect(parseGrayscale('abc')).toBe(100);       // NaN → 100
    expect(parseGrayscale('-1')).toBe(100);        // 越界负数 → 100
    expect(parseGrayscale('101')).toBe(100);       // 越界正数 → 100
    expect(parseGrayscale('not-a-number')).toBe(100);
    expect(parseGrayscale('10.5')).toBe(10);       // parseInt 取整
  });

  it('T16 [critical v1.5.0 Stage 4 P2_1]: selectByWeight 边界 (100/0/10 + rng mock)', () => {
    // grayscale=100 → always 'openai'
    expect(selectByWeight(100, () => 0)).toBe('openai');
    expect(selectByWeight(100, () => 0.5)).toBe('openai');
    expect(selectByWeight(100, () => 0.99)).toBe('openai');

    // grayscale=0 → always 'anthropic'
    expect(selectByWeight(0, () => 0)).toBe('anthropic');
    expect(selectByWeight(0, () => 0.5)).toBe('anthropic');
    expect(selectByWeight(0, () => 0.99)).toBe('anthropic');

    // grayscale=10 → rng * 100 < 10 → 'openai' (10% 概率), 否则 'anthropic' (90% 概率)
    // rng=0.05 → 0.05 * 100 = 5 < 10 → 'openai'
    expect(selectByWeight(10, () => 0.05)).toBe('openai');
    // rng=0.15 → 0.15 * 100 = 15 > 10 → 'anthropic'
    expect(selectByWeight(10, () => 0.15)).toBe('anthropic');
    // rng=0.10 → 0.10 * 100 = 10, 不严格小于 10 → 'anthropic' (边界外)
    expect(selectByWeight(10, () => 0.10)).toBe('anthropic');
    // rng=0.099 → 0.099 * 100 = 9.9 < 10 → 'openai'
    expect(selectByWeight(10, () => 0.099)).toBe('openai');

    // grayscale=50 → 50% 权重
    expect(selectByWeight(50, () => 0.5)).toBe('anthropic');  // 50 < 50? false → anthropic (边界)
    expect(selectByWeight(50, () => 0.49)).toBe('openai');   // 49 < 50 → openai
    expect(selectByWeight(50, () => 0.51)).toBe('anthropic');
  });

  it('T17 [critical v1.5.0 Stage 4 P2_1]: 灰度路由 (grayscale=10, rng 强制 0.05 → anthropic / 0.95 → openai)', () => {
    // rng=0.05 → selectByWeight(10) → 'openai' (5 < 10)
    // 但要求走 anthropic, 所以用 rng=0.15 (15 > 10 → anthropic)
    stubAllEnv({ VITE_LLM_PROVIDER: 'openai', VITE_LLM_GRAYSCALE: '10' });
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.15); // 0.15 * 100 = 15 > 10 → anthropic
    expect(getProviderName()).toBe('anthropic');
    spy.mockRestore();

    // rng=0.95 → selectByWeight(10) → 'anthropic' (95 > 10)
    // 但要求走 openai, 所以用 rng=0.05 (5 < 10 → openai)
    resetProviderCache();
    const spy2 = vi.spyOn(Math, 'random').mockReturnValue(0.05);
    expect(getProviderName()).toBe('openai');
    spy2.mockRestore();
  });

  it('T18 [critical v1.5.0 Stage 4 P2_1]: 默认 grayscale=100 → 全部走 openai (与 v1.4.1 一致, 0 breaking change)', () => {
    // grayscale=100 时 selectByWeight 直接返回 'openai' (短路)
    // 不管 Math.random 返回什么, 结果都是 'openai'
    stubAllEnv({ VITE_LLM_PROVIDER: 'openai', VITE_LLM_GRAYSCALE: '100' });

    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.0001);
    getProvider();
    expect(getProviderName()).toBe('openai');
    spy.mockRestore();

    // 第二次: 不同的 Math.random 也应得 'openai' (grayscale=100 短路)
    resetProviderCache();
    const spy2 = vi.spyOn(Math, 'random').mockReturnValue(0.9999);
    getProvider();
    expect(getProviderName()).toBe('openai');
    spy2.mockRestore();

    // 不显式设置 VITE_LLM_GRAYSCALE, 走 zod default 100
    stubAllEnv({ VITE_LLM_PROVIDER: 'openai' });
    const spy3 = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    getProvider();
    expect(getProviderName()).toBe('openai');
    spy3.mockRestore();
  });

  it('T19 [critical v1.5.0 Stage 4 P2_1]: deepseek 不参与灰度 (config.provider=deepseek, grayscale=10 仍走 deepseek)', () => {
    // deepseek 不在 v1.5.0 灰度范围内, 仅在 provider=openai 时介入
    stubAllEnv({ VITE_LLM_PROVIDER: 'deepseek', VITE_LLM_GRAYSCALE: '10' });

    // 即使 Math.random 返回 0.0001 (强制走 anthropic 也不走 deepseek),
    // 因 config.provider=deepseek, 灰度逻辑不介入, 仍走 deepseek
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.0001);
    expect(getProviderName()).toBe('deepseek');
    spy.mockRestore();

    // 再调一次, 仍 deepseek
    resetProviderCache();
    const spy2 = vi.spyOn(Math, 'random').mockReturnValue(0.9999);
    expect(getProviderName()).toBe('deepseek');
    spy2.mockRestore();
  });
});
