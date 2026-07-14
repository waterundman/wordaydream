/**
 * v1.5.2 Stage 4 (P2_1): Gloss adapter 函数化 provider 模式 (llm 路径打通)
 *
 * 沿用 v1.5.0 Stage 3 函数式 provider 模式 — 3 个独立函数 + selector 函数.
 * 本次 Stage 4 升级点:
 * - selectGlossProvider: 真实 LLM provider (openai/anthropic/deepseek/kimi/qwen/minimax)
 *   + enabled=true → 'llm' 路径 (旧版 v1.5.0 全部走 heuristic, 路径不通)
 * - llmGloss: 加 try/catch 包装, 失败时返回 source='mock' 的最小占位
 * - heuristic 路径保持 (作为未知 provider 的安全 fallback, 0 break)
 *
 * 0 breaking change:
 * - 旧 glossAdapter.ts `getGloss` / `clearGlossCache` 沿用, 不修改签名
 * - selectGlossProvider 默认行为: mock provider 或 disabled → 'mock' (与 v1.5.0 一致)
 * - heuristic 路径仍可访问 (测试友好, 兼容旧调用)
 * - 新增的 'llm' 路径仅在 openai/anthropic/deepseek/kimi/qwen/minimax + enabled 时启用
 *
 * v1.5.2 selector 三分支:
 * - settings.llm.provider === 'mock' || !settings.llm.enabled → 'mock'
 * - openai/anthropic/deepseek/kimi/qwen/minimax + enabled → 'llm' (新增, 旧版 v1.5.0 走 heuristic)
 * - 其它 (未知 provider) → 'heuristic' (安全 fallback, 0 break)
 *
 * Fallback 策略 (v1.5.2 加强):
 * - heuristic / mock / llm 任一抛错 → 回退 mockGloss
 * - mock 抛错 → 返回最小占位 (source='mock', gloss='[unavailable]')
 * - llm provider 内部抛错 → 内部 catch 返回 source='mock' 的 fallback
 */

import { useSettingsStore } from '../../settings/store/useSettingsStore';
import type { Language, TokenOccurrence } from '../../../types';

/**
 * v1.5.0 Stage 3: Gloss provider 输出 (轻量结果, 与 GlossPayload 区分)
 */
export interface GlossResult {
  token: TokenOccurrence;
  gloss: string;
  source: 'heuristic' | 'mock' | 'llm';
}

/**
 * v1.5.0 Stage 3: Gloss provider 类型 (3 选 1)
 */
export type GlossProvider = 'heuristic' | 'mock' | 'llm';

/**
 * v1.5.0 Stage 3: Provider 注入容器 (可选参数, 用于测试)
 */
export type GlossProviders = {
  heuristic: (token: TokenOccurrence, language: Language) => Promise<GlossResult>;
  mock: (token: TokenOccurrence, language: Language) => Promise<GlossResult>;
  llm: (token: TokenOccurrence, language: Language) => Promise<GlossResult>;
};

/**
 * v1.5.0 Stage 3: 启发式 provider — 基于 token lemma 长度判断 complexity
 *
 * 规则:
 * - lemma.length > 6 → 标记 '复杂'
 * - lemma.length <= 6 → 标记 '基础'
 *
 * 输出: `${surfaceForm} (${kind}, ${complexity})`
 * 注: TokenOccurrence 在 types/index.ts 中仅有 kind ('normal' | 'review') 字段,
 *     没有 partOfSpeech 字段, 故用 kind 代替 (0 breaking change, 不扩展 TokenOccurrence).
 */
export async function heuristicGloss(
  token: TokenOccurrence,
  _language: Language,
): Promise<GlossResult> {
  const complexity = token.lemma.length > 6 ? '复杂' : '基础';
  return {
    token,
    gloss: `${token.surfaceForm} (${token.kind}, ${complexity})`,
    source: 'heuristic',
  };
}

/**
 * v1.5.0 Stage 3: Mock provider — 按 [lang] surfaceForm 格式
 */
export async function mockGloss(
  token: TokenOccurrence,
  language: Language,
): Promise<GlossResult> {
  return {
    token,
    gloss: `[${language}] ${token.surfaceForm}`,
    source: 'mock',
  };
}

/**
 * v1.5.0 Stage 3: LLM provider — v1.6.0 真实 LLM 调用
 *
 * v1.5.0 仅 stub, 输出 `[LLM] surfaceForm` 格式 (v1.6.0 将集成 glossaryAdapter 改写).
 *
 * v1.5.2 Stage 4 升级:
 * - 加 try/catch 包装, 失败时返回 source='mock' 的最小占位
 * - selector 现在可以真正命中 'llm' 路径 (openai/anthropic/deepseek/kimi/qwen/minimax + enabled)
 * - 真实 LLM gloss 改写是 v1.6.0 计划, 当前仍 stub 输出 `[LLM] surfaceForm`
 */
export async function llmGloss(
  token: TokenOccurrence,
  _language: Language,
): Promise<GlossResult> {
  try {
    // v1.5.2: 沿用 v1.5.0 stub 输出, 真实 LLM gloss 改写是 v1.6.0 计划
    return {
      token,
      gloss: `[LLM] ${token.surfaceForm}`,
      source: 'llm',
    };
  } catch {
    return {
      token,
      gloss: `[unavailable] ${token.surfaceForm}`,
      source: 'mock',
    };
  }
}

/**
 * v1.5.0 Stage 3: Provider selector — 根据 settings 选 provider
 *
 * v1.5.2 Stage 4 升级: 真实 LLM provider + enabled → 'llm' 路径打通.
 *
 * 规则 (v1.5.2 三分支):
 * - settings.llm.provider === 'mock' || !settings.llm.enabled → 'mock'
 * - openai/anthropic/deepseek + enabled → 'llm' (新增, 旧版 v1.5.0 走 heuristic)
 *   (v2.1.1 Stage 3 / D3: 已移除 kimi/qwen/minimax, 这些 provider 无后端实现)
 * - 其它 (未知 provider) → 'heuristic' (安全 fallback, 0 break)
 */
export async function selectGlossProvider(): Promise<GlossProvider> {
  const { llm } = useSettingsStore.getState();
  // 1. mock provider 或 disabled → mock (与 v1.5.0 一致, 0 break)
  if (llm.provider === 'mock' || !llm.enabled) {
    return 'mock';
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
 * 1. selectGlossProvider() 选定 provider
 * 2. 调对应 provider 函数
 * 3. 抛错 → 回退 mockGloss
 *
 * 0 breaking change: 与 getGloss 共存, 调用方按需选用.
 */
export async function adaptGlossFunctional(
  token: TokenOccurrence,
  language: Language,
  providers: GlossProviders = defaultGlossProviders,
): Promise<GlossResult> {
  const provider = await selectGlossProvider();
  try {
    switch (provider) {
      case 'heuristic':
        return await providers.heuristic(token, language);
      case 'mock':
        return await providers.mock(token, language);
      case 'llm':
        return await providers.llm(token, language);
      default: {
        // 不应到达 (穷尽性检查)
        const _exhaustive: never = provider;
        return _exhaustive;
      }
    }
  } catch {
    // 任一 provider 抛错 → 回退 mock
    try {
      return await providers.mock(token, language);
    } catch {
      // mock 也失败 → 返回最小占位
      return {
        token,
        gloss: `[unavailable] ${token.surfaceForm}`,
        source: 'mock',
      };
    }
  }
}

/**
 * v1.5.0 Stage 3: 默认 provider 容器 (生产路径)
 */
const defaultGlossProviders: GlossProviders = {
  heuristic: heuristicGloss,
  mock: mockGloss,
  llm: llmGloss,
};
