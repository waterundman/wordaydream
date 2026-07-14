/**
 * glossAdapter.functional 单元测试
 *
 * v1.5.0 Stage 3 — T01..T03 (existing):
 * - T01 [critical]: heuristic provider — lemma 长 token 标 complex
 * - T02 [critical]: mock provider — 简单 [lang] surfaceForm 格式
 * - T03 [critical]: fallback — provider 抛错, mock fallback
 *
 * v1.5.2 Stage 4 — T-LLM-1..3 (NEW, Contract 30 NEW P2_1):
 * - T-LLM-1: selectGlossProvider 在 settings.llm.provider='deepseek' + enabled=true 时返回 'llm'
 * - T-LLM-2: adaptGlossFunctional 走 'llm' 路径, 调用 injected llm provider (source='llm')
 * - T-LLM-3: adaptGlossFunctional 走 'llm' 路径时 llm 抛错, 回退到 mock (source='mock')
 *
 * 设计:
 * - T01 直接调 heuristicGloss 验证 lemma.length > 6 → '复杂'
 * - T02 直接调 mockGloss 验证 [en] surfaceForm 格式
 * - T03 用 inject providers 模式注入失败 heuristic + 真实 mock,
 *   验证主入口 catch 块回退到 mock provider (R-8 兑现测试友好设计)
 * - 0 breaking change: 不修改 glossAdapter.ts `getGloss`, 仅覆盖新 adaptGlossFunctional
 * - T-LLM-1..3 沿用 vi.mock-free 模式, 用 inject providers 模拟 'llm' 路径行为
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useSettingsStore } from '../../settings/store/useSettingsStore';
import type { TokenOccurrence, Language } from '../../../types';

const makeToken = (overrides: Partial<TokenOccurrence> = {}): TokenOccurrence => ({
  id: 'tok-1',
  lexemeGroupId: 'lex-1',
  surfaceForm: 'revolution',
  lemma: 'revolution',
  objectiveDifficulty: 3,
  startIndex: 0,
  endIndex: 10,
  isResolved: false,
  isActive: false,
  kind: 'normal',
  isCompound: false,
  ...overrides,
});

describe('glossAdapter.functional (v1.5.0 Stage 3 — T01..T03)', () => {
  beforeEach(() => {
    useSettingsStore.setState((s) => ({
      ...s,
      llm: { ...s.llm, provider: 'mock', enabled: false, apiKey: '', baseUrl: '' },
    }));
  });

  it('T01 [critical]: heuristic provider marks long lemma as complex', async () => {
    useSettingsStore.setState((s) => ({
      ...s,
      llm: { ...s.llm, provider: 'openai', enabled: true },
    }));
    const { heuristicGloss } = await import('./glossAdapter.functional');
    const longToken = makeToken({ surfaceForm: 'revolutionary', lemma: 'revolutionary' });
    // lemma.length = 13 > 6 → 复杂
    const result = await heuristicGloss(longToken, 'en');
    expect(result.source).toBe('heuristic');
    expect(result.gloss).toContain('复杂');
  });

  it('T02 [critical]: mock provider returns [lang] surfaceForm format', async () => {
    const { mockGloss } = await import('./glossAdapter.functional');
    const token = makeToken({ surfaceForm: 'revolution' });
    const result = await mockGloss(token, 'en');
    expect(result.source).toBe('mock');
    expect(result.gloss).toBe('[en] revolution');
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
      adaptGlossFunctional,
      mockGloss,
    } = await import('./glossAdapter.functional');
    const failingProviders = {
      heuristic: async () => {
        throw new Error('mocked heuristic failure');
      },
      mock: mockGloss,
      llm: async () => {
        throw new Error('injected llm failure');
      },
    };
    const token = makeToken({ surfaceForm: 'revolutionary' });
    const result = await adaptGlossFunctional(token, 'en', failingProviders);
    // catch 块回退到 mockGloss
    expect(result.source).toBe('mock');
    expect(result.gloss).toBe('[en] revolutionary');
  });
});

describe('glossAdapter.functional (v1.5.2 Stage 4 — T-LLM-1..3, Contract 30 NEW)', () => {
  beforeEach(() => {
    useSettingsStore.setState((s) => ({
      ...s,
      llm: { ...s.llm, provider: 'mock', enabled: false, apiKey: '', baseUrl: '' },
    }));
  });

  it('T-LLM-1: selectGlossProvider returns "llm" for deepseek+enabled', async () => {
    useSettingsStore.setState((s) => ({
      ...s,
      llm: { ...s.llm, provider: 'deepseek', enabled: true },
    }));
    const { selectGlossProvider } = await import('./glossAdapter.functional');
    const provider = await selectGlossProvider();
    expect(provider).toBe('llm');
  });

  it('T-LLM-2: adaptGlossFunctional uses injected llm provider on "llm" path (source="llm")', async () => {
    useSettingsStore.setState((s) => ({
      ...s,
      llm: { ...s.llm, provider: 'deepseek', enabled: true },
    }));
    const { adaptGlossFunctional } = await import('./glossAdapter.functional');

    let llmCalled = false;
    let heuristicCalled = false;
    const token = makeToken({ surfaceForm: 'revolutionary' });
    const providers = {
      heuristic: async (t: TokenOccurrence) => {
        heuristicCalled = true;
        return { token: t, gloss: '[heuristic]', source: 'heuristic' as const };
      },
      mock: async (t: TokenOccurrence) => ({ token: t, gloss: '[mock]', source: 'mock' as const }),
      llm: async (t: TokenOccurrence) => {
        llmCalled = true;
        return { token: t, gloss: `[LLM-INJECTED] ${t.surfaceForm}`, source: 'llm' as const };
      },
    };
    const result = await adaptGlossFunctional(token, 'en', providers);
    // 'llm' 路径被命中
    expect(llmCalled).toBe(true);
    expect(heuristicCalled).toBe(false);
    // 输出来自 injected llm, source='llm'
    expect(result.source).toBe('llm');
    expect(result.gloss).toBe('[LLM-INJECTED] revolutionary');
  });

  it('T-LLM-3: adaptGlossFunctional falls back to mock when llm throws (source="mock")', async () => {
    useSettingsStore.setState((s) => ({
      ...s,
      llm: { ...s.llm, provider: 'deepseek', enabled: true },
    }));
    const {
      adaptGlossFunctional,
      mockGloss,
    } = await import('./glossAdapter.functional');

    let llmCalled = false;
    let mockCalled = false;
    const token = makeToken({ surfaceForm: 'revolutionary' });
    const providers = {
      heuristic: async (t: TokenOccurrence) => ({ token: t, gloss: '[heuristic]', source: 'heuristic' as const }),
      mock: async (t: TokenOccurrence, language: Language) => {
        mockCalled = true;
        return mockGloss(t, language);
      },
      llm: async () => {
        llmCalled = true;
        throw new Error('injected llm failure');
      },
    };
    const result = await adaptGlossFunctional(token, 'en', providers);
    // llm 被调用且抛错 → 主入口 catch 回退到 mock
    expect(llmCalled).toBe(true);
    expect(mockCalled).toBe(true);
    // 输出应来自 mock
    expect(result.source).toBe('mock');
    expect(result.gloss).toBe('[en] revolutionary');
  });
});
