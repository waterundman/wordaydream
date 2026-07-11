/**
 * difficultyEvaluator.functional 单元测试
 *
 * v1.5.0 Stage 3 — T01..T03 (existing):
 * - T01 [critical]: heuristic provider — accuracy < 0.6 (errorRate > 0.4) 触发降级
 * - T02 [critical]: mock provider — 固定返回 null (mock 不调整)
 * - T03 [critical]: fallback — provider 抛错, 返回 null (不抛)
 *
 * v1.5.2 Stage 4 — T-LLM-1..3 (NEW, Contract 30 NEW P2_1):
 * - T-LLM-1: selectDifficultyProvider 在 settings.llm.provider='anthropic' + enabled=true 时返回 'llm'
 * - T-LLM-2: evaluateDifficultyFunctional 走 'llm' 路径, 调用 injected llm provider
 * - T-LLM-3: evaluateDifficultyFunctional 走 'llm' 路径时 llm 抛错, 回退到 heuristic
 *
 * 设计:
 * - T01 直接调 heuristicEvaluate 验证规则 (绕开 selector)
 * - T02 直接调 mockEvaluate 验证恒等 null (绕开 selector)
 * - T03 用 inject providers 模式注入失败 heuristic, 验证主入口 catch 块返回 null
 *   (R-8 兑现测试友好设计)
 * - 0 breaking change: 不修改 `suggests`, 仅覆盖新 evaluateDifficultyFunctional
 * - T-LLM-1..3 沿用 vi.mock-free 模式, 用 inject providers 模拟 'llm' 路径行为
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useSettingsStore } from '../../settings/store/useSettingsStore';
import type { DifficultyStats } from './difficultyAdvisor';

const makeStats = (overrides: Partial<DifficultyStats> = {}): DifficultyStats => ({
  totalAtLevel: 50,
  masteredAtLevel: 25,
  errorRate: 0.2,
  avgDifficulty: 3,
  ...overrides,
});

describe('difficultyEvaluator.functional (v1.5.0 Stage 3 — T01..T03)', () => {
  beforeEach(() => {
    useSettingsStore.setState((s) => ({
      ...s,
      llm: { ...s.llm, provider: 'mock', enabled: false, apiKey: '', baseUrl: '' },
    }));
  });

  it('T01 [critical]: heuristic provider downgrades when errorRate > 0.4', async () => {
    const { heuristicEvaluate } = await import('./difficultyEvaluator.functional');
    // errorRate=0.5 → accuracy=0.5 < 0.6, currentLevel=2 → 1
    const result = await heuristicEvaluate(
      2,
      makeStats({ errorRate: 0.5, totalAtLevel: 50 }),
    );
    expect(result).toBe(1);
  });

  it('T02 [critical]: mock provider returns null (no adjustment)', async () => {
    const { mockEvaluate } = await import('./difficultyEvaluator.functional');
    const result = await mockEvaluate(2, makeStats({ errorRate: 0.5 }));
    expect(result).toBeNull();
  });

  it('T03 [critical]: fallback to null on heuristic error (via providers injection)', async () => {
    useSettingsStore.setState((s) => ({
      ...s,
      llm: { ...s.llm, provider: 'openai', enabled: true },
    }));
    const {
      evaluateDifficultyFunctional,
      mockEvaluate,
    } = await import('./difficultyEvaluator.functional');
    const failingProviders = {
      heuristic: async () => {
        throw new Error('mocked heuristic failure');
      },
      mock: mockEvaluate,
      llm: async () => null,
    };
    const result = await evaluateDifficultyFunctional(
      2,
      makeStats({ errorRate: 0.5 }),
      failingProviders,
    );
    // catch 块返回 null (与 suggests 行为一致)
    expect(result).toBeNull();
  });
});

describe('difficultyEvaluator.functional (v1.5.2 Stage 4 — T-LLM-1..3, Contract 30 NEW)', () => {
  beforeEach(() => {
    useSettingsStore.setState((s) => ({
      ...s,
      llm: { ...s.llm, provider: 'mock', enabled: false, apiKey: '', baseUrl: '' },
    }));
  });

  it('T-LLM-1: selectDifficultyProvider returns "llm" for anthropic+enabled', async () => {
    useSettingsStore.setState((s) => ({
      ...s,
      llm: { ...s.llm, provider: 'anthropic', enabled: true },
    }));
    const { selectDifficultyProvider } = await import('./difficultyEvaluator.functional');
    const provider = await selectDifficultyProvider();
    expect(provider).toBe('llm');
  });

  it('T-LLM-2: evaluateDifficultyFunctional uses injected llm provider on "llm" path', async () => {
    useSettingsStore.setState((s) => ({
      ...s,
      llm: { ...s.llm, provider: 'anthropic', enabled: true },
    }));
    const { evaluateDifficultyFunctional } = await import('./difficultyEvaluator.functional');

    let llmCalled = false;
    let heuristicCalled = false;
    const providers = {
      heuristic: async () => {
        heuristicCalled = true;
        return null;
      },
      mock: async () => null,
      llm: async () => {
        llmCalled = true;
        return 4 as const;
      },
    };
    const result = await evaluateDifficultyFunctional(
      3,
      makeStats({ errorRate: 0.2 }),
      providers,
    );
    // 'llm' 路径被命中
    expect(llmCalled).toBe(true);
    expect(heuristicCalled).toBe(false);
    // 输出来自 injected llm
    expect(result).toBe(4);
  });

  it('T-LLM-3: evaluateDifficultyFunctional falls back to null when llm throws', async () => {
    useSettingsStore.setState((s) => ({
      ...s,
      llm: { ...s.llm, provider: 'anthropic', enabled: true },
    }));
    const { evaluateDifficultyFunctional } = await import('./difficultyEvaluator.functional');

    let llmCalled = false;
    const providers = {
      heuristic: async () => null,
      mock: async () => null,
      llm: async () => {
        llmCalled = true;
        throw new Error('injected llm failure');
      },
    };
    const result = await evaluateDifficultyFunctional(
      3,
      makeStats({ errorRate: 0.2 }),
      providers,
    );
    // llm 被调用且抛错 → 主入口 catch 返回 null (与 suggests 行为一致)
    expect(llmCalled).toBe(true);
    expect(result).toBeNull();
  });
});
