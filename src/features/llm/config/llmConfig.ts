/**
 * Wordaydream v1.3.0 LLM Config (Stage 2 — 集中 .env 字段 + zod 验证)
 *                  v1.5.0 Stage 4 P2_1 — VITE_LLM_GRAYSCALE 灰度权重
 *
 * 设计目标:
 * - 取代 v1.2.0 散落在 import.meta.env.* 读各 provider key/baseUrl/model 的方式
 * - 集中管理前端 LLM 调用相关 .env 字段 (proxy URL / provider / 调参)
 * - zod schema 验证 + 合理默认值, 避免 env 缺失导致运行时崩溃
 * - 单例缓存: 整个 app lifecycle 内只 parse 一次 env
 *
 * 与 v1.2.0 关系:
 * - v1.2.0 的 readEnvLLMConfig() (src/config/env.ts) 仍保留, 由 router.ts 用
 *   来读取 per-provider API key (SettingsPanel 之外的 fallback).
 * - v1.3.0 LLMConfig 专注于 v1.3.0 引入的 6 个新字段:
 *   - VITE_LLM_PROVIDER: 当前激活的 provider (openai / anthropic / deepseek)
 *   - VITE_LLM_PROXY_URL: Netlify Edge Function URL
 *   - VITE_LLM_MAX_TOKENS / TEMPERATURE / RETRY_ATTEMPTS / TIMEOUT_MS
 *
 * v1.5.0 Stage 4 P2_1 兑现 (灰度发布, R-11):
 * - 新增 VITE_LLM_GRAYSCALE 字段 (0-100, 默认 100)
 * - 灰度仅在 config.provider === 'openai' 时介入, 其它 provider 走 config.provider 原值
 * - grayscale=10 → 10% 走 anthropic / 90% 走 openai (加权重随机)
 * - grayscale=100 → 100% 走 openai (与 v1.4.1 一致, 0 breaking change)
 * - grayscale=0   → 100% 走 anthropic (灰度打开但 100% 偏向 anthropic)
 * - 解析失败回退 100, 走 config.provider (R-11 兑现)
 *
 * 测试:
 * - llmConfig.test.ts: T01 (default) + T02 (env override)
 * - v1.5.0 Stage 4: providerFactory.test.ts T15-T19 (灰度路由边界)
 *
 * 设计原则:
 * - 不 import 任何 provider-specific 模块 (避免循环依赖)
 * - 纯函数 + 缓存, 可在测试中通过 resetLLMConfig() 重置
 * - env 字段读取用 `as any` cast 绕过 ImportMetaEnv readonly 限制
 *   (因为 vite-env.d.ts 显式标注 readonly, 而 zod schema 接受 string 即可)
 */

import { z } from "zod";

/**
 * v1.3.0 LLM config zod schema
 *
 * 字段:
 * - provider: 当前激活的 provider (openai / anthropic / deepseek)
 *   v1.2.0 还有 kimi/qwen/minimax, 但 v1.3.0 Edge Function 只暴露 3 个,
 *   所以这里枚举只取 3 个 (kimi/qwen/minimax 暂不在 v1.3.0 scope 内).
 * - proxyUrl: Netlify Edge Function URL (生产: /.netlify/edge-functions/llm-proxy)
 * - maxTokens: 单次 LLM 调用最大 token 数 (clamp [1, 8192])
 * - temperature: 采样温度 (clamp [0, 2])
 * - retryAttempts: 网络重试次数 (clamp [1, 5])
 * - timeoutMs: 单次请求超时 (clamp [1000, 120000] ms)
 *
 * v1.5.0 Stage 4 P2_1 兑现:
 * - grayscale: 灰度权重 (0-100, 默认 100)
 *   - grayscale=100 → 100% 走 config.provider (默认行为, 0 breaking change)
 *   - grayscale=10  → 10% 走 anthropic / 90% 走 config.provider (仅当 provider='openai')
 *   - grayscale=0   → 100% 走 anthropic (仅当 provider='openai')
 *   - 其它 provider (anthropic / deepseek) 灰度字段不介入, 走 config.provider
 *   - 解析失败回退 100 (R-11 兑现: 不破坏 v1.4.1 行为)
 */
const LLMConfigSchema = z.object({
  provider: z.enum(["openai", "anthropic", "deepseek"]).default("openai"),
  proxyUrl: z
    .string()
    .default("http://localhost:8888/.netlify/edge-functions/llm-proxy"),
  maxTokens: z.number().int().min(1).max(8192).default(2048),
  temperature: z.number().min(0).max(2).default(0.7),
  retryAttempts: z.number().int().min(1).max(5).default(3),
  timeoutMs: z.number().int().min(1000).max(120000).default(30000),
  // v1.5.0 Stage 4 P2_1: 灰度权重 (0-100, 0=100% 走 anthropic, 100=100% 走 config.provider, 10=10% anthropic + 90% openai)
  grayscale: z.number().int().min(0).max(100).default(100),
});

export type LLMConfig = z.infer<typeof LLMConfigSchema>;

/**
 * process-wide 缓存: 整个 app lifecycle 只 parse 一次 env
 */
let cachedConfig: LLMConfig | null = null;

/**
 * 安全地读取 import.meta.env 中的字符串字段
 *
 * 因为 vite-env.d.ts 把 ImportMetaEnv 字段标为 readonly, 这里用 as any cast
 * 绕过 TypeScript readonly 检查. 实际值仍可读 (只是 TS 抱怨类型).
 */
function readEnvString(key: string): string | undefined {
  const env = import.meta.env as unknown as Record<string, string | undefined>;
  const value = env[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * 把字符串字段转 int (失败返回 undefined, 让 zod default 接管)
 */
function readEnvInt(key: string): number | undefined {
  const raw = readEnvString(key);
  if (raw === undefined) return undefined;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * 把字符串字段转 float (失败返回 undefined, 让 zod default 接管)
 */
function readEnvFloat(key: string): number | undefined {
  const raw = readEnvString(key);
  if (raw === undefined) return undefined;
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * 读取并验证当前 LLM config
 *
 * 第一次调用: parse import.meta.env + zod validate + 缓存
 * 后续调用: 直接返回缓存
 *
 * 测试: 使用 resetLLMConfig() 清空缓存, 重新读取
 */
export function getLLMConfig(): LLMConfig {
  if (cachedConfig) return cachedConfig;
  cachedConfig = LLMConfigSchema.parse({
    provider: readEnvString("VITE_LLM_PROVIDER"),
    proxyUrl: readEnvString("VITE_LLM_PROXY_URL"),
    maxTokens: readEnvInt("VITE_LLM_MAX_TOKENS"),
    temperature: readEnvFloat("VITE_LLM_TEMPERATURE"),
    retryAttempts: readEnvInt("VITE_LLM_RETRY_ATTEMPTS"),
    timeoutMs: readEnvInt("VITE_LLM_TIMEOUT_MS"),
    // v1.5.0 Stage 4 P2_1: 灰度权重, 解析失败回退 undefined 走 zod default 100
    grayscale: readEnvInt("VITE_LLM_GRAYSCALE"),
  });
  return cachedConfig;
}

/**
 * 清空 config 缓存 (供测试 + 动态切换 provider 用)
 */
export function resetLLMConfig(): void {
  cachedConfig = null;
}
