/**
 * v1.5.2 Stage 4 (P2_1): Difficulty evaluator 函数化 provider 模式 (llm 路径打通)
 *
 * 沿用 v1.5.0 Stage 3 函数式 provider 模式 — 3 个独立函数 + selector 函数.
 * 本次 Stage 4 升级点:
 * - selectDifficultyProvider: 真实 LLM provider (openai/anthropic/deepseek/kimi/qwen/minimax)
 *   + enabled=true → 'llm' 路径 (旧版 v1.5.0 全部走 heuristic, 路径不通)
 * - llmEvaluate: 加 try/catch 包装, 失败时返回 null (而不是抛给上游)
 * - heuristic 路径保持 (作为 mock/disabled 时的稳定 fallback, 0 break)
 *
 * 0 breaking change:
 * - 旧 difficultyAdvisor.ts `suggests` 函数沿用, 不修改签名
 * - selectDifficultyProvider 默认行为: mock provider 或 disabled → 'heuristic' (与 v1.5.0 一致)
 * - heuristic 路径仍可访问 (测试友好, 兼容旧调用)
 * - 新增的 'llm' 路径仅在 openai/anthropic/deepseek/kimi/qwen/minimax + enabled 时启用
 *
 * v1.5.2 selector 三分支:
 * - settings.llm.provider === 'mock' || !settings.llm.enabled → 'heuristic'
 *   (LLM evaluation 是 v1.6.0+ 真实实现, heuristic 是最稳的 fallback)
 * - openai/anthropic/deepseek/kimi/qwen/minimax + enabled → 'llm' (v1.5.2 沿用 stub 但路径打通)
 * - 其它 (未知 provider) → 'heuristic' (安全 fallback, 0 break)
 *
 * Fallback 策略 (v1.5.2 加强):
 * - heuristic / mock / llm 任一抛错 → 返回 null (与 suggests 行为一致)
 * - llm provider 内部抛错 → 内部 catch 返回 null (双保险)
 */

import { useSettingsStore } from '../../settings/store/useSettingsStore';
import type { DifficultyLevel } from '../../../types';

// v1.5.0 Stage 3: 复用 difficultyAdvisor.ts DifficultyStats (0 breaking change)
import type { DifficultyStats } from './difficultyAdvisor';

/**
 * v1.5.0 Stage 3: Difficulty provider 类型 (3 选 1)
 */
export type DifficultyProvider = 'heuristic' | 'mock' | 'llm';

/**
 * v1.5.0 Stage 3: Provider 注入容器 (可选参数, 用于测试)
 */
export type DifficultyProviders = {
  heuristic: (currentLevel: DifficultyLevel, stats: DifficultyStats) => Promise<DifficultyLevel | null>;
  mock: (currentLevel: DifficultyLevel, stats: DifficultyStats) => Promise<DifficultyLevel | null>;
  llm: (currentLevel: DifficultyLevel, stats: DifficultyStats) => Promise<DifficultyLevel | null>;
};

/**
 * v1.5.0 Stage 3: 启发式 provider — 基于 errorRate 反推 accuracy
 *
 * 规则:
 * - accuracy < 0.6 (errorRate > 0.4) 且 currentLevel > 1 → 降级
 * - accuracy > 0.85 (errorRate < 0.15) 且 currentLevel < 5 → 升级
 * - 其它 → null (不调整)
 *
 * 注: 此函数是 difficultyAdvisor.ts `suggests` 的新实现,
 *     沿用 type (DifficultyLevel / DifficultyStats) 不破坏.
 */
export async function heuristicEvaluate(
  currentLevel: DifficultyLevel,
  stats: DifficultyStats,
): Promise<DifficultyLevel | null> {
  // accuracy = 1 - errorRate (0-1 范围)
  const accuracy = 1 - stats.errorRate;
  if (accuracy < 0.6 && currentLevel > 1) {
    return (currentLevel - 1) as DifficultyLevel;
  }
  if (accuracy > 0.85 && currentLevel < 5) {
    return (currentLevel + 1) as DifficultyLevel;
  }
  return null;
}

/**
 * v1.5.0 Stage 3: Mock provider — 固定返回 null (mock 不调整)
 */
export async function mockEvaluate(
  _currentLevel: DifficultyLevel,
  _stats: DifficultyStats,
): Promise<DifficultyLevel | null> {
  return null;
}

/**
 * v1.5.0 Stage 3: LLM provider — v1.6.0 真实 LLM 评估
 *
 * v1.5.0 仅 stub, 返回 null (与 difficultyAdvisor.ts `suggests` 行为一致).
 * v1.6.0 将实现基于 LLM 的多维度评估 (morphological / abstractness / frequencyPercentile).
 *
 * v1.5.2 Stage 4 升级:
 * - 加 try/catch 包装 (双保险, 即便主入口 catch 失效, 这里也兜底)
 * - selector 现在可以真正命中 'llm' 路径 (openai/anthropic/deepseek/kimi/qwen/minimax + enabled)
 * - 真实 LLM 集成是 v1.6.0 计划, 当前仍 stub 返回 null
 */
export async function llmEvaluate(
  _currentLevel: DifficultyLevel,
  _stats: DifficultyStats,
): Promise<DifficultyLevel | null> {
  try {
    // v1.5.2: 沿用 v1.5.0 stub, 真实 LLM evaluation 是 v1.6.0 计划
    // 当前返回 null, 失败时上层 catch 会再次返回 null, 双保险
    return null;
  } catch {
    return null;
  }
}

/**
 * v1.5.0 Stage 3: Provider selector — 根据 settings 选 provider
 *
 * v1.5.2 Stage 4 升级: 真实 LLM provider + enabled → 'llm' 路径打通.
 *
 * 规则 (v1.5.2 三分支):
 * - settings.llm.provider === 'mock' || !settings.llm.enabled → 'heuristic'
 *   (LLM evaluation 是 v1.6.0+ 真实实现, heuristic 是最稳的 fallback)
 * - openai/anthropic/deepseek + enabled → 'llm' (新增, 旧版 v1.5.0 走 heuristic)
 *   (v2.1.1 Stage 3 / D3: 已移除 kimi/qwen/minimax, 这些 provider 无后端实现)
 * - 其它 (未知 provider) → 'heuristic' (安全 fallback, 0 break)
 */
export async function selectDifficultyProvider(): Promise<DifficultyProvider> {
  const { llm } = useSettingsStore.getState();
  // 1. mock provider 或 disabled → heuristic (与 v1.5.0 一致, 0 break)
  if (llm.provider === 'mock' || !llm.enabled) {
    return 'heuristic';
  }
  // 2. 真实 LLM provider + enabled → llm (v1.5.2 路径打通)
  if (
    llm.provider === 'openai' ||
    llm.provider === 'anthropic' ||
    llm.provider === 'deepseek'
  ) {
    return 'llm';
  }
  // 3. 其它 (未知 provider) → heuristic (安全 fallback, 0 break)
  return 'heuristic';
}

/**
 * v1.5.0 Stage 3: 主入口 — 函数式 provider 模式
 *
 * 流程:
 * 1. selectDifficultyProvider() 选定 provider
 * 2. 调对应 provider 函数
 * 3. 抛错 → 返回 null (与 difficultyAdvisor.ts `suggests` 一致)
 *
 * 0 breaking change: 与 `suggests` 共存, 调用方按需选用.
 */
export async function evaluateDifficultyFunctional(
  currentLevel: DifficultyLevel,
  stats: DifficultyStats,
  providers: DifficultyProviders = defaultDifficultyProviders,
): Promise<DifficultyLevel | null> {
  const provider = await selectDifficultyProvider();
  try {
    switch (provider) {
      case 'heuristic':
        return await providers.heuristic(currentLevel, stats);
      case 'mock':
        return await providers.mock(currentLevel, stats);
      case 'llm':
        return await providers.llm(currentLevel, stats);
      default: {
        // 不应到达 (穷尽性检查)
        const _exhaustive: never = provider;
        return _exhaustive;
      }
    }
  } catch {
    // 任一 provider 抛错 → 返回 null (不抛, 与 suggests 一致)
    return null;
  }
}

/**
 * v1.5.0 Stage 3: 默认 provider 容器 (生产路径)
 */
const defaultDifficultyProviders: DifficultyProviders = {
  heuristic: heuristicEvaluate,
  mock: mockEvaluate,
  llm: llmEvaluate,
};
