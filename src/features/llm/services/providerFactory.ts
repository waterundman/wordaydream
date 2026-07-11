/**
 * Wordaydream v1.4.0 Provider Factory (Stage 2 — 兑现 anthropic 函数式)
 *                   v1.4.1 Stage 1 — re-export streamingGenerate
 *                   v1.5.0 Stage 4 P2_1 — VITE_LLM_GRAYSCALE 灰度路由
 *
 * 设计目标:
 * - 取代 v1.2.0 router.ts 内部硬编码的 provider switch + 缓存逻辑
 * - 统一入口 getProvider(), 避免每次重新构造 provider instance
 * - 根据 VITE_LLM_PROVIDER 配置路由到对应的 generate 函数
 * - 缓存 provider 函数引用, 调用方 (router / 直接调用方) 复用同一函数
 *
 * v1.4.0 改动轨迹:
 * - Stage 1: routeDeepSeek 从 `new v1.2.0 class-based provider(...)` 改为 `deepseekGenerate` 函数
 * - Stage 2: routeAnthropic 从 `new AnthropicProvider('', '', '')` 占位改为 `anthropicGenerate` 函数
 *   + 删除 v1.2.0 class (Stage 1 已删 OpenAICompatibleProvider; Stage 2 删 AnthropicProvider)
 * - 0 class 残留: providerFactory 不再依赖任何 v1.2.0 class
 *
 * v1.4.1 Stage 1 改动:
 * - 新增 streamingGenerate re-export (从 streamingProvider.ts 透传)
 *   供 useStreamingPassage hook 与未来 v1.5.0 真实 streaming 部署直接调用
 * - 0 改动: routeOpenAI / routeAnthropic / routeDeepSeek / cachedProvider
 *   (v1.4.0 13 合同保持, router 主流程不感知 streaming)
 *
 * v1.5.0 Stage 4 P2_1 改动 (R-11 灰度发布兑现):
 * - 新增 parseGrayscale(raw) 函数: 解析 VITE_LLM_GRAYSCALE 字符串, 失败回退 100
 * - 新增 selectByWeight(grayscale, rng) 函数: 加权随机, default=openai, 灰度分流 anthropic
 * - 修改 getProvider(): 当 config.provider === 'openai' 且 grayscale < 100 时介入灰度
 * - 0 breaking change: 灰度仅在 grayscale<100 时介入, 默认 100 走 config.provider (与 v1.4.1 一致)
 * - 0 改动 deepseek: deepseek 不参与灰度, 仅在 config.provider === 'openai' 时介入
 *
 * 与 v1.3.0 关系:
 * - v1.3.0: getProvider() 返回 ProviderFn, deepseek/anthropic 桥接到 v1.2.0 class-based provider
 * - v1.4.0 Stage 1: getProvider() 返回 ProviderFn, deepseek 走 deepseekGenerate 函数
 * - v1.4.0 Stage 2: getProvider() 返回 ProviderFn, anthropic 走 anthropicGenerate 函数
 * - v1.5.0 Stage 4: getProvider() 增加 grayscale 分流, 仅当 provider=openai 时介入
 *
 * 测试:
 * - providerFactory.test.ts: T01 (openai) + T02 (anthropic) + T03 (deepseek) + T04 (cache)
 * - v1.4.1 Stage 1: streamingProvider.test.ts 独立覆盖 streamingGenerate
 * - v1.5.0 Stage 4: providerFactory.test.ts T15-T19 (灰度路由边界)
 */

import type { GenerateOptions } from './provider';
import type { LLMResponse } from '../../../types';
import { openaiGenerate } from './openaiProvider';
import { deepseekGenerate } from './deepseekProvider';
import { anthropicGenerate } from './anthropicProvider';
import { getLLMConfig, resetLLMConfig } from '../config/llmConfig';

/**
 * v1.3.0 Edge Function 响应 schema (与 openaiProvider.ts / deepseekProvider.ts 镜像)
 * 这里 re-export 是供未来 Stage 2/3 router 改造使用 (GenerateResult 是 Edge Function
 * 响应的高层抽象, 含 model/usage/language).
 */
export interface GenerateResult {
  text: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
  language: string;
}

/**
 * Provider 函数签名
 *
 * 接受 GenerateOptions, 返回 Promise<LLMResponse> (含 text / parsed / error / fallbackToMock).
 * 注意: v1.3.0+ 实际 Edge Function 响应是 GenerateResult (含 model/usage/language),
 * 但为了与 router 兼容, 这里统一返回 LLMResponse 形态 (仅 text + parsed).
 */
export type ProviderFn = (options: GenerateOptions) => Promise<LLMResponse>;

let cachedProvider: ProviderFn | null = null;
let cachedProviderName: string | null = null;

/**
 * v1.3.0+: 路由到 openai provider (Edge Function)
 *
 * openaiGenerate 已经实现完整 Edge Function 调用, 直接返回.
 */
function routeOpenAI(): ProviderFn {
  return async (options) => openaiGenerate(options);
}

/**
 * v1.4.0 Stage 2: 路由到 anthropic provider (函数式)
 *
 * v1.3.0 暂用 v1.2.0 AnthropicProvider 类 (直接调 https://api.anthropic.com).
 * v1.4.0 Stage 2 替换为 anthropicGenerate 函数 (走 Edge Function).
 */
function routeAnthropic(): ProviderFn {
  return async (options) => anthropicGenerate(options);
}

/**
 * v1.4.0 Stage 1: 路由到 deepseek provider (函数式)
 *
 * v1.3.0 把 deepseek 走 v1.2.0 class-based provider (兼容 OpenAI API 协议).
 * v1.4.0 Stage 1 兑现 v1.3.0 deprecation warning, 改走 deepseekGenerate 函数.
 */
function routeDeepSeek(): ProviderFn {
  return async (options) => deepseekGenerate(options);
}

/**
 * v1.5.0 Stage 4 P2_1: 解析灰度权重
 *
 * 输入: VITE_LLM_GRAYSCALE 字符串 ('0' / '10' / '100' / '50')
 * 输出: 0-100 整数
 * 失败回退: 100 (即 100% 走 config.provider, R-11 兑现)
 *
 * 边界:
 * - 'abc'   → 100 (NaN, parseInt 返回 NaN)
 * - '-1'    → 100 (zod schema 拒绝, 但这里 readEnvInt 已经返回 undefined, 走 zod default 100)
 * - '101'   → 100 (zod schema 拒绝, 同样走 zod default)
 * - ''      → 100 (readEnvInt 返回 undefined, zod default 100)
 * - '0'     → 0   (合法边界)
 * - '10'    → 10  (合法)
 * - '100'   → 100 (合法边界)
 *
 * 注: 此函数仅作 export 供未来 v1.5.1 Stage 2 端到端测试使用.
 * 生产路径上, llmConfig.ts 的 zod schema 已经做了边界检查, grayscale 字段保证是 0-100 整数.
 * 此处 parseGrayscale 仅供单测边界验证, 不参与 getProvider() 主流程.
 */
export function parseGrayscale(raw: string | undefined): number {
  if (typeof raw !== 'string' || raw.length === 0) return 100;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return 100;
  if (parsed < 0 || parsed > 100) return 100;
  return parsed;
}

/**
 * v1.5.0 Stage 4 P2_1: 灰度选择 provider
 *
 * 设计: grayscale=10 → 10% 走 anthropic / 90% 走 default (openai)
 * 实现: Math.random() * 100 < grayscale → 走 default, 否则走 anthropic
 * 测试: vi.spyOn(Math, 'random') 验证权重分布
 *
 * 注意: v1.5.0 灰度仅在 'openai' vs 'anthropic' 间分流;
 * 'deepseek' 保留为 config.provider 显式选择, 不参与灰度.
 */
export function selectByWeight(grayscale: number, rng: () => number = Math.random): 'openai' | 'anthropic' {
  if (grayscale >= 100) return 'openai';
  if (grayscale <= 0) return 'anthropic';
  return rng() * 100 < grayscale ? 'openai' : 'anthropic';
}

/**
 * v1.3.0+: 取得当前激活的 provider 函数
 *
 * 第一次调用: 读 LLMConfig.provider, switch 路由到对应函数, 缓存.
 * 后续调用: 直接返回缓存的函数引用 (避免每次重新构造).
 *
 * v1.5.0 Stage 4 P2_1 灰度路由 (R-11):
 * - 仅当 config.provider === 'openai' 且 config.grayscale < 100 时介入
 * - selectByWeight(grayscale) 加权随机决定走 openai 还是 anthropic
 * - 其它 config.provider (anthropic / deepseek) 不参与灰度
 * - grayscale=100 (默认) 走 config.provider 原值, 0 breaking change
 *
 * v1.5.2 fix M5: 灰度模式下每次调用重新抽样, 不缓存 (避免"一次性骰子"锁定用户体验).
 * - grayscale < 100 时, cachedProvider 不写入, 每次返回新函数引用.
 * - cachedProviderName 仍写入, 供 getProviderName() 日志查询 (反映最近一次抽样结果).
 * - grayscale == 100 时, 走原缓存逻辑 (T04/T05 验证 cache identity 不变).
 *
 * 测试: resetProviderCache() 清空缓存, 下次 getProvider() 重新路由.
 */
export function getProvider(): ProviderFn {
  const config = getLLMConfig();
  let effectiveProvider: 'openai' | 'anthropic' | 'deepseek' = config.provider;

  // v1.5.0 Stage 4 P2_1 + v1.5.2 fix M5: 灰度发布 (仅 openai 启用), 每次抽样不缓存
  if (config.provider === 'openai' && config.grayscale < 100) {
    effectiveProvider = selectByWeight(config.grayscale);
    cachedProviderName = effectiveProvider;
    // 不写入 cachedProvider, 下次调用重新抽样
    return effectiveProvider === 'anthropic' ? routeAnthropic() : routeOpenAI();
  }

  // 非灰度场景: 使用缓存 (向后兼容 v1.4.0 行为)
  if (cachedProvider) return cachedProvider;

  switch (effectiveProvider) {
    case 'openai':
      cachedProviderName = 'openai';
      cachedProvider = routeOpenAI();
      break;
    case 'anthropic':
      cachedProviderName = 'anthropic';
      cachedProvider = routeAnthropic();
      break;
    case 'deepseek':
      cachedProviderName = 'deepseek';
      cachedProvider = routeDeepSeek();
      break;
  }
  return cachedProvider as ProviderFn;
}

/**
 * v1.3.0+: 取得当前激活的 provider 名称 (供日志 / 调试)
 */
export function getProviderName(): string {
  if (!cachedProviderName) {
    getProvider();
  }
  return cachedProviderName as string;
}

/**
 * v1.3.0+: 清空 provider 缓存 (供测试 + 动态切换 provider 用)
 *
 * 同时清空 LLMConfig 缓存, 让下次 getProvider() 重新读 env + 重新路由.
 * v1.5.0 Stage 4 P2_1: 灰度缓存随 cachedProvider 一同清空, 重新 selectByWeight
 */
export function resetProviderCache(): void {
  cachedProvider = null;
  cachedProviderName = null;
  resetLLMConfig();
}

/**
 * v1.4.1 Stage 1: re-export streamingGenerate
 *
 * 设计动机:
 * - 外部 hook (useStreamingPassage) 与未来 v1.5.0 真实 streaming 部署,
 *   只需 `import { streamingGenerate } from '@/features/llm/services/providerFactory'`
 *   即可拿到 streaming provider, 与 generate 流程的 import 风格一致
 * - 不重复 export 一遍, 直接从 streamingProvider 透传
 * - providerFactory 自身不感知 streaming 的具体实现 (职责单一)
 */
export { streamingGenerate } from './streamingProvider';
export type { StreamingOptions, StreamAbortHandle, StreamHandler, StreamingProviderName } from './streamingProvider';
