/**
 * grammarDetector.functional 单元测试
 *
 * v1.5.0 Stage 3 — T01..T03 (existing):
 * - T01 [critical]: heuristic provider — 输入含 was/were 句型, 输出 heuristic-detected 知识点
 * - T02 [critical]: mock provider — settings.llm.provider='mock' + !enabled, 输出 mock 知识点
 * - T03 [critical]: fallback — heuristic provider 抛错, 回退到 mock 知识点
 *
 * v1.5.2 Stage 4 — T-LLM-1..3 (NEW, Contract 30 NEW P2_1):
 * - T-LLM-1: selectProvider 在 settings.llm.provider='openai' + enabled=true 时返回 'llm'
 * - T-LLM-2: detectGrammarPointsFunctional 走 'llm' 路径, 调用 injected llm provider
 * - T-LLM-3: detectGrammarPointsFunctional 走 'llm' 路径时 llm 抛错, 回退到 mock
 *
 * 设计:
 * - T01 直接调 heuristicDetectGrammarPoints (绕开 selector, 独立验证规则)
 * - T02 调 detectGrammarPointsFunctional, 验证 selector='mock' 路径
 * - T03 用 inject providers 模式注入失败 heuristic + 真实 mock,
 *   验证主入口 catch 块回退到 mock provider (R-8 兑现测试友好设计)
 * - 0 breaking change: 不修改原 detectGrammarPoints 行为, 仅覆盖新 functional API
 * - T-LLM-1..3 沿用 vi.mock-free 模式, 用 inject providers 模拟 'llm' 路径行为
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useSettingsStore } from '../../settings/store/useSettingsStore';

describe('grammarDetector.functional (v1.5.0 Stage 3 — T01..T03)', () => {
  beforeEach(() => {
    useSettingsStore.setState((s) => ({
      ...s,
      llm: { ...s.llm, provider: 'mock', enabled: false, apiKey: '', baseUrl: '' },
    }));
  });

  it('T01 [critical]: heuristic provider detects was/were patterns', async () => {
    useSettingsStore.setState((s) => ({
      ...s,
      llm: { ...s.llm, provider: 'openai', enabled: true },
    }));
    const { heuristicDetectGrammarPoints } = await import('./grammarDetector.functional');
    const result = await heuristicDetectGrammarPoints(
      'She was reading when I arrived.',
      'en',
    );
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].type).toBe('时态');
  });

  it('T02 [critical]: mock provider for mock settings', async () => {
    // settings: provider='mock' + !enabled (已 by beforeEach)
    const { detectGrammarPointsFunctional } = await import('./grammarDetector.functional');
    const result = await detectGrammarPointsFunctional(
      'She was reading when I arrived.',
      'en',
    );
    expect(result.length).toBeGreaterThan(0);
    // mock 输出的 type 来自 mockGrammarPoints
    expect(result[0].type).toBe('时态');
  });

  it('T03 [critical]: fallback to mock on active provider error (via providers injection)', async () => {
    useSettingsStore.setState((s) => ({
      ...s,
      llm: { ...s.llm, provider: 'openai', enabled: true },
    }));
    // v1.5.2 Stage 4: openai+enabled 现在 routes to 'llm' (v1.5.0 是 heuristic).
    // 为了测试 catch 块回退, 注入失败 llm (active provider) + 真实 mock.
    // 注: heuristic 仍存在但不在 selector 路径上, 保留注入仅为向后兼容.
    const {
      detectGrammarPointsFunctional,
      mockDetectGrammarPoints,
    } = await import('./grammarDetector.functional');
    const failingProviders = {
      heuristic: async () => {
        throw new Error('mocked heuristic failure');
      },
      mock: mockDetectGrammarPoints,
      llm: async () => {
        throw new Error('injected llm failure');
      },
    };
    const result = await detectGrammarPointsFunctional(
      'She was reading when I arrived.',
      'en',
      failingProviders,
    );
    // catch 块回退到 mock, 应返回非空 (mock 3 个 candidates)
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].type).toBe('时态');
  });
});

describe('grammarDetector.functional (v1.5.2 Stage 4 — T-LLM-1..3, Contract 30 NEW)', () => {
  beforeEach(() => {
    useSettingsStore.setState((s) => ({
      ...s,
      llm: { ...s.llm, provider: 'mock', enabled: false, apiKey: '', baseUrl: '' },
    }));
  });

  it('T-LLM-1: selectProvider returns "llm" for openai+enabled', async () => {
    useSettingsStore.setState((s) => ({
      ...s,
      llm: { ...s.llm, provider: 'openai', enabled: true },
    }));
    const { selectProvider } = await import('./grammarDetector.functional');
    const provider = await selectProvider();
    expect(provider).toBe('llm');
  });

  it('T-LLM-2: detectGrammarPointsFunctional uses injected llm provider on "llm" path', async () => {
    useSettingsStore.setState((s) => ({
      ...s,
      llm: { ...s.llm, provider: 'openai', enabled: true },
    }));
    const {
      detectGrammarPointsFunctional,
      mockDetectGrammarPoints,
    } = await import('./grammarDetector.functional');

    let llmCalled = false;
    let heuristicCalled = false;
    const llmResult = [{
      id: 'injected-llm-001',
      text: 'injected-llm-pattern',
      type: 'injected-llm-type',
      difficulty: 4 as const,
      explanation: 'injected via test',
      examples: [],
      startIndex: 0,
      endIndex: 10,
      isActive: false,
    }];
    const providers = {
      heuristic: async () => {
        heuristicCalled = true;
        return [];
      },
      mock: mockDetectGrammarPoints,
      llm: async () => {
        llmCalled = true;
        return llmResult;
      },
    };
    const result = await detectGrammarPointsFunctional(
      'She was reading when I arrived.',
      'en',
      providers,
    );
    // 'llm' 路径被命中
    expect(llmCalled).toBe(true);
    expect(heuristicCalled).toBe(false);
    // 输出来自 injected llm
    expect(result.length).toBe(1);
    expect(result[0].type).toBe('injected-llm-type');
  });

  it('T-LLM-3: detectGrammarPointsFunctional falls back to mock when llm throws', async () => {
    useSettingsStore.setState((s) => ({
      ...s,
      llm: { ...s.llm, provider: 'openai', enabled: true },
    }));
    const {
      detectGrammarPointsFunctional,
      mockDetectGrammarPoints,
    } = await import('./grammarDetector.functional');

    let llmCalled = false;
    let mockCalled = false;
    const providers = {
      heuristic: async () => [],
      mock: async (text: string, language: 'en' | 'de') => {
        mockCalled = true;
        return mockDetectGrammarPoints(text, language);
      },
      llm: async () => {
        llmCalled = true;
        throw new Error('injected llm failure');
      },
    };
    const result = await detectGrammarPointsFunctional(
      'She was reading when I arrived.',
      'en',
      providers,
    );
    // llm 被调用且抛错 → 主入口 catch 回退到 mock
    expect(llmCalled).toBe(true);
    expect(mockCalled).toBe(true);
    // 输出应来自 mock
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].type).toBe('时态');
  });
});
