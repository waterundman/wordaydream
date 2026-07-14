/**
 * Wordaydream v1.4.1 Stage 2 Router
 *
 * v1.4.0 Stage 1 关键架构改动 (沿用):
 * - v1.3.0: router.ts 内部通过 providerFactory 走 v1.2.0 class-based provider
 *           (factory.routeDeepSeek 内部 new 该 class, class 内
 *           含 v1.3.0 deprecation warning 触发代码)
 * - v1.4.0: providerFactory.routeDeepSeek 改走 deepseekGenerate 函数
 *           (Stage 1 兑现 v1.3.0 deprecation warning, 0 class 残留)
 * - 同步: testProviderConnection 改走 Edge Function 探测 (不再 new v1.2.0 class)
 *
 * v1.4.1 Stage 2 新增 (PWA / 离线模式):
 * - generateWithFallback 入口处检查 navigator.onLine === false, 短路到 mock.
 * - 派发持久通知 'llm-offline' (与 'llm-fallback' 区分, 提示用户是离线触发).
 * - Settings (provider / apiKey) 保持不变, 仅 router 层 fallback, 用户回线上时自动恢复.
 * - useOfflineModeStore.recordProviderWhenOffline 记录触发 provider, 供 UI 追溯.
 *
 * 保留的 v1.3.0 行为:
 * - generateWithFallback(settings, options) 公共 API 不变, 仍接受 settings
 *   (settings.provider === 'mock' / !settings.enabled 走 mock, 其它走 factory)
 * - json retry + error context + mock fallback 全部走 v1.3.0 流程
 * - useToastStore 派发 'llm-fallback' 通知保留
 *
 * v1.3.0 Edge Function 接入:
 * - openaiGenerate 走 VITE_LLM_PROXY_URL (Netlify Edge Function), 客户端不持 key
 * - llmConfig 提供 retryAttempts / timeoutMs (替代 settings.jsonMaxAttempts / timeout)
 *
 * v1.4.0 Edge Function 探测:
 * - testProviderConnection 走 `${config.proxyUrl}` POST 一个 maxTokens=1 的最小请求
 *   - 200 ok 表示服务端 API key 已配置
 *   - 500 + code: "MISSING_API_KEY" 表示服务端无 key
 *   - 其它错误: 透传 HTTP status
 *
 * 测试:
 * - router.test.ts T01-T17: 用 baseSettings.provider = 'deepseek' 走 factory.routeDeepSeek
 *   (Stage 1: factory.routeDeepSeek 返回 deepseekGenerate 函数, mock 替换函数即可拦截)
 * - T12-T17: 验证 router 走 factory 路由
 * - offlineMode.test.ts T01-T05: 验证 useOfflineModeStore 状态机
 */

import type { GenerateOptions, ExpectJson } from './provider';
import type { LLMResponse, LLMSettings } from '../../../types';
import { MockLLMProvider } from './mockProvider';
import {
  parseLLMResponse,
  PassagePayloadSchema,
  EvaluationPayloadSchema,
  DifficultyPayloadSchema,
  GlossPayloadSchema,
} from './jsonParser';
import { z } from 'zod';
import { useSettingsStore } from '../../settings/store/useSettingsStore';
import { useToastStore } from '../../../store/useToastStore';
// v1.4.0 Stage 1: factory 内部 routeDeepSeek 已切到 deepseekGenerate 函数
import { getProvider as getFactoryProvider, getProviderName, resetProviderCache as resetFactoryCache } from './providerFactory';
import { getLLMConfig } from '../config/llmConfig';
// v1.4.1 Stage 2: 离线模式 store (auto-fallback on navigator.onLine === false)
import { useOfflineModeStore } from '../store/offlineMode';

/** v1.3.0: JSON 解析尝试次数的合法范围与默认值 */
const MIN_JSON_ATTEMPTS = 1;
const MAX_JSON_ATTEMPTS = 5;
/**
 * v1.3.0: 路由器内部 fallback 默认值 = 2 (保留 v1.2.0 硬编码行为, 不破坏现有 75 个测试).
 * 用户可见默认 (useSettingsStore.defaultLLM.jsonMaxAttempts) = 3 (新用户首次安装的推荐值).
 * 调用方 (options.jsonMaxAttempts) > settings > store > FALLBACK.
 */
const FALLBACK_JSON_ATTEMPTS = 2;
/**
 * v1.3.0: 持久通知 key (LLM fallback banner)
 */
const LLM_FALLBACK_NOTIFICATION_KEY = 'llm-fallback';
const LLM_FALLBACK_NOTIFICATION_MESSAGE = '已切换到预存文本 (LLM 服务暂不可用)';

/**
 * v1.4.1 Stage 2: 离线模式通知 key (与 LLM_FALLBACK 区分, 强调 offline 触发).
 * 仅在 navigator.onLine === false 时派发, 提示用户"已自动 fallback".
 */
const LLM_OFFLINE_NOTIFICATION_KEY = 'llm-offline';
const LLM_OFFLINE_NOTIFICATION_MESSAGE = '当前离线, 已切换到预存文本';

const LOG_PREFIX = '[LLM Router]';

function log(level: 'info' | 'warn' | 'error', message: string) {
  const timestamp = new Date().toISOString();
  console[level](`${LOG_PREFIX} ${timestamp} ${message}`);
}

/**
 * v2.1.1 Stage 2 (D1): 根据 expectJson 类型选择对应的 zod schema.
 *
 * 映射:
 * - true / 'passage' -> PassagePayloadSchema (向后兼容: true 等价 'passage')
 * - 'evaluation' -> EvaluationPayloadSchema
 * - 'difficulty' -> DifficultyPayloadSchema
 * - 'gloss' -> GlossPayloadSchema
 * - 'generic' -> 宽松 schema (z.object({}).passthrough(), 接受任意 JSON object)
 * - false / undefined -> undefined (不走 JSON 解析路径)
 *
 * 返回 undefined 表示调用方不应走 JSON 解析路径 (走 retryWithBackoff).
 */
function getSchemaForExpectJson(
  expectJson: ExpectJson | undefined
): z.ZodType<any> | undefined {
  switch (expectJson) {
    case true:
    case 'passage':
      return PassagePayloadSchema;
    case 'evaluation':
      return EvaluationPayloadSchema;
    case 'difficulty':
      return DifficultyPayloadSchema;
    case 'gloss':
      return GlossPayloadSchema;
    case 'generic':
      // 宽松校验: 接受任意 JSON object, 不强制字段
      return z.object({}).passthrough();
    case false:
    case undefined:
      return undefined;
    default:
      return undefined;
  }
}

/**
 * v1.4.0 Stage 1: 内部使用的 ProviderFn 类型, 与 providerFactory.ProviderFn 镜像.
 * 避免在 router 中直接 import providerFactory.ProviderFn (类型依赖, 不影响运行时).
 */
type RouterProviderFn = (options: GenerateOptions) => Promise<LLMResponse>;

/**
 * v1.4.0 Stage 1: 把 settings.provider 解析成可调用的 ProviderFn.
 *
 * 规则:
 * - settings.provider === 'mock' 或 settings.enabled === false: 返回 mock 路径
 * - settings.provider 其它 (openai / anthropic / deepseek):
 *   委托给 providerFactory.getProvider() (env-based 路由)
 *   Stage 1 已切换到函数式 provider, 0 class 引用.
 */
function resolveProviderFn(settings: LLMSettings): RouterProviderFn {
  if (!settings.enabled || settings.provider === 'mock') {
    return (opts) => new MockLLMProvider().generate(opts);
  }
  // v1.4.0 Stage 1: factory 内部 routeDeepSeek 走 deepseekGenerate 函数
  // factory 缓存: 同一 env 多次调用返回同一函数引用 (T14 验证)
  return getFactoryProvider();
}

function createTimeoutSignal(seconds: number): AbortSignal {
  const controller = new AbortController();
  // v1.5.2 fix M8: 持有 timer 引用, signal abort 时 clearTimeout, 避免 timer 泄漏.
  const timer = setTimeout(() => controller.abort(), seconds * 1000);
  // signal 已 abort (e.g. 外部提前 abort) 时清理 timer
  controller.signal.addEventListener('abort', () => clearTimeout(timer));
  return controller.signal;
}

/**
 * v1.5.3 fix V2-P1-003: AbortSignal.any() 兼容性降级.
 *
 * AbortSignal.any() 在 Safari < 17.4 / Firefox < 124 不支持, 直接调用会抛 TypeError.
 * 本函数优先用原生 API, 不可用时手动组合: 任一 signal abort 即触发 controller.abort().
 */
function combineSignals(signals: AbortSignal[]): AbortSignal {
  if (signals.length === 0) {
    return new AbortController().signal;
  }
  if (signals.length === 1) {
    return signals[0];
  }
  // 优先使用原生 AbortSignal.any (Chrome 116+ / Firefox 124+ / Safari 17.4+)
  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any(signals);
  }
  // 降级: 手动组合, 任一 abort 即触发
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return controller.signal;
}

/**
 * 构造带 error context 的 prompt (v1.2.0 Stage 4 hotfix P1-A 沿用)
 *
 * 把上一次失败的错误信息追加到 user prompt 末尾, 告诉 LLM 下次输出
 * 必须是合法 JSON (无尾随逗号 / 无 markdown 包装 / 引号闭合).
 *
 * v1.2.0 Stage 4 hotfix P1-A: issues 参数携带 zod issues 数组, 拼到 prompt 里
 * 让 LLM 知道具体哪个字段缺失 / 类型错, 大幅提升 retry 成功率.
 *
 * v1.2.0 hotfix-3 (Stage 4 P1 最后加固): 当 lastError 含 "Language mismatch"
 * 时, 在 prompt 末尾追加显式 language 纠正指令, 提醒 LLM 输出 expectedLanguage
 * 指定的语言, 提升 language compliance retry 成功率.
 */
function buildRetryPrompt(
  originalPrompt: string,
  lastError: string,
  issues?: Array<{ path: string; message: string }>
): string {
  let issuesBlock = '';
  if (issues && issues.length > 0) {
    const issueLines = issues
      .map((i) => `  - field "${i.path || '(root)'}": ${i.message}`)
      .join('\n');
    issuesBlock = `\n\nSpecific issues to fix:\n${issueLines}`;
  }

  // v1.2.0 hotfix-3: language compliance 错误时, 强化语言纠正指令
  let languageBlock = '';
  if (lastError && lastError.includes('Language mismatch')) {
    // 提取 expected 值 (e.g. "got 'en', expected 'de'")
    const match = lastError.match(/expected\s+(['"]?)([a-zA-Z]+)\1/);
    const expected = match ? match[2] : null;
    if (expected) {
      languageBlock =
        `\n\nCRITICAL LANGUAGE REMINDER: Your previous response's "language" field was ` +
        `wrong. You MUST set "language" to exactly "${expected}" and the "text" field ` +
        `must be entirely in ${expected === 'de' ? 'German' : 'English'} (no other language).`;
    }
  }

  return (
    `${originalPrompt}\n\n` +
    `[Previous attempt failed with: ${lastError}. ` +
    `Please ensure your response is valid JSON with no trailing commas, ` +
    `no markdown wrappers, and all quotes properly closed.` +
    `Make sure to include "tokens" as a JSON array (can be [] if none), ` +
    `and "grammarPoints" as a JSON array (can be [] if none).` +
    `${issuesBlock}${languageBlock}]`
  );
}

/**
 * v1.3.0: 解析 LLM JSON 重试尝试次数
 *
 * 来源优先级:
 *   1. options.jsonMaxAttempts (调用方覆盖, 用于测试)
 *   2. settings.jsonMaxAttempts (调用方传入的 settings 对象)
 *   3. useSettingsStore.llm.jsonMaxAttempts (用户在 Settings 面板配置并持久化)
 *   4. FALLBACK_JSON_ATTEMPTS = 2 (v1.2.0 硬编码行为, 向后兼容, 不破坏现有测试)
 *
 * 用户可见默认 (useSettingsStore.defaultLLM.jsonMaxAttempts = 3) 在新安装时填入 store,
 * 旧用户 (store 中无值) 走 fallback = 2, 行为保持不变.
 *
 * 范围 clamp: [1, 5]
 */
function resolveJsonMaxAttempts(
  settings: LLMSettings,
  options: GenerateOptions
): number {
  const storeDefault = (() => {
    try {
      return useSettingsStore.getState().llm.jsonMaxAttempts;
    } catch {
      return undefined;
    }
  })();
  const raw =
    (options as { jsonMaxAttempts?: number }).jsonMaxAttempts ??
    settings.jsonMaxAttempts ??
    storeDefault ??
    FALLBACK_JSON_ATTEMPTS;
  const n = Math.floor(Number(raw) || FALLBACK_JSON_ATTEMPTS);
  return Math.max(MIN_JSON_ATTEMPTS, Math.min(MAX_JSON_ATTEMPTS, n));
}

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 1) {
        const delay = baseDelay * Math.pow(2, attempt - 1) + Math.random() * 500;
        log('info', `Retry attempt ${attempt}/${maxRetries}, waiting ${Math.round(delay)}ms`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      return await fn();
    } catch (error) {
      lastError = error as Error;
      log('warn', `Attempt ${attempt} failed: ${lastError.message}`);
    }
  }

  log('error', `All ${maxRetries} attempts failed`);
  throw lastError || new Error('Unknown error');
}

/**
 * v1.3.0: 期望 JSON 响应的重试流程
 *
 * 区别于 retryWithBackoff:
 * - 不仅 retry 网络错误, 还 retry parse 错误
 * - 触发 parse retry 时, 把 error context 附加到 prompt 末尾
 * - 限定最多 N 次尝试 (默认 2), 避免 token 浪费
 * - 失败后走 mock fallback
 *
 * 流程:
 *   attempt 0: prompt -> providerFn(options) -> parseLLMResponse
 *   ok: 返回 { ...result, parsed: data }
 *   fail: lastError = parse 错误, 走 attempt 1
 *   attempt 1: prompt+errorContext -> providerFn(options) -> parseLLMResponse
 *   ok: 返回 { ...result, parsed: data }
 *   fail: 返回 mock.generate(options) (fallback)
 *
 * v1.2.0 hotfix-3 (Stage 4 P1 最后加固):
 * - 接受 options.expectedLanguage, 透传给 parseLLMResponse.
 * - parseLLMResponse 校验 parsed.data.language === expectedLanguage,
 *   不一致视为 parse failure, 走 retry → mock fallback.
 * - 缺省 expectedLanguage 时, 走原 v1.2.0 hotfix-2 行为 (无语言校验).
 */
async function generateWithJsonRetry(
  providerFn: RouterProviderFn,
  options: GenerateOptions,
  combinedSignal: AbortSignal,
  maxAttempts: number
): Promise<LLMResponse> {
  let lastError = '';
  let lastIssues: Array<{ path: string; message: string }> = [];
  let lastRawText = '';
  const baseOptions: GenerateOptions = {
    ...options,
    signal: combinedSignal,
  };
  // v1.2.0 hotfix-3: 透传 expectedLanguage 到 parseLLMResponse.
  // 注意: provider 本身不读 expectedLanguage, 仅 router 内 parse 阶段使用.
  const expectedLanguage = options.expectedLanguage;

  // v2.1.1 Stage 2 (D1): 根据 expectJson 类型选择 schema.
  // expectJson=true / 'passage' / 'evaluation' / 'difficulty' / 'gloss' / 'generic'
  // 均走 JSON 解析路径, 但使用不同的 zod schema 校验.
  const schema = getSchemaForExpectJson(options.expectJson);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const isRetry = attempt > 0;
    const currentOptions: GenerateOptions = isRetry
      ? { ...baseOptions, prompt: buildRetryPrompt(options.prompt, lastError, lastIssues) }
      : baseOptions;

    try {
      const result = await providerFn(currentOptions);

      if (result.fallbackToMock) {
        log('warn', 'Provider returned fallbackToMock, switching to mock');
        try {
          useToastStore
            .getState()
            .showNotification(LLM_FALLBACK_NOTIFICATION_KEY, LLM_FALLBACK_NOTIFICATION_MESSAGE);
        } catch {
          // 通知失败不应阻塞主流程
        }
        // v2.2.1 Stage 2 (Bug 3 主因 B): fallback 时标记 fallbackToMock: true,
        // 让 evaluateAnswerViaLLM 能检测到并走 mockEvaluate, 而非解析 passage 文本.
        return { ...(await new MockLLMProvider().generate(options)), fallbackToMock: true };
      }

      lastRawText = result.text;
      // v2.1.1 Stage 2: 传 schema 到 parseLLMResponse, 而非硬编码 PassagePayloadSchema.
      // schema 为 undefined 时 (不应发生, 调用前已检查 expectJson), 回退到默认 PassagePayloadSchema.
      const parseResult = parseLLMResponse(result.text, {
        schema: schema ?? PassagePayloadSchema,
        expectedLanguage,
      });
      if (parseResult.ok && parseResult.data) {
        log(
          'info',
          `JSON parse ${parseResult.repaired ? '(after jsonrepair) ' : ''}` +
            `succeeded on attempt ${attempt + 1}`
        );
        return {
          ...result,
          parsed: parseResult.data,
        };
      }

      // parse 失败, 准备 retry (如果还有 attempt)
      lastError = parseResult.error ?? 'unknown parse error';
      lastIssues = parseResult.issues ?? [];
      log('warn', `Parse failed on attempt ${attempt + 1}: ${lastError}`);
    } catch (error) {
      // provider 抛出异常 (网络 / timeout / abort)
      lastError = (error as Error).message;
      lastIssues = [];
      log('warn', `LLM attempt ${attempt + 1} threw: ${lastError}`);
    }
  }

  // 所有 attempt 失败 -> mock fallback
  log(
    'warn',
    `All ${maxAttempts} attempts failed (last error: ${lastError}; last text length: ${lastRawText.length}), falling back to mock`
  );
  // v1.2.0: 派发持久通知 (banner) + 保留 console.warn 双提示
  try {
    useToastStore
      .getState()
      .showNotification(LLM_FALLBACK_NOTIFICATION_KEY, LLM_FALLBACK_NOTIFICATION_MESSAGE);
  } catch {
    // 通知失败不应阻塞主流程
  }
  // v2.2.1 Stage 2 (Bug 3 主因 B): fallback 时标记 fallbackToMock: true,
  // 让 evaluateAnswerViaLLM 能检测到并走 mockEvaluate, 而非解析 passage 文本.
  return { ...(await new MockLLMProvider().generate(options)), fallbackToMock: true };
}

/**
 * v1.4.0 Stage 1: 重置 provider 缓存 (公共 API)
 *
 * router 自身没有缓存逻辑, 直接委托给 factory.
 * 调用方 (测试 / Settings UI 切 provider) 仍用这个 API, 不需要改 import.
 */
export function resetProviderCache(): void {
  log('info', 'Resetting provider cache (delegated to factory)');
  resetFactoryCache();
}

/**
 * v1.4.0 Stage 1: 主入口
 *
 * 流程:
 * - LLM 关闭 / mock 模式: 直接 mock
 * - 其它 provider: 走 factory.getProvider() 拿 ProviderFn (Stage 1 函数式)
 * - expectJson=true: 走 generateWithJsonRetry (parse-retry + error context)
 * - expectJson=false: 走原 retryWithBackoff (网络重试)
 * - 全失败: mock fallback
 */
export async function generateWithFallback(
  settings: LLMSettings,
  options: GenerateOptions
): Promise<LLMResponse> {
  // v1.4.1 Stage 2: 离线模式 auto-fallback
  // navigator.onLine === false 时, 跳过 provider factory + 网络重试, 直接走 mock.
  // Settings (provider / apiKey) 保持不变, 用户回线上时仍能恢复原 provider.
  if (typeof window !== 'undefined' && window.navigator.onLine === false) {
    log('warn', 'Browser reports offline, short-circuiting to mock provider');
    try {
      useOfflineModeStore.getState().recordProviderWhenOffline(settings.provider);
      useToastStore
        .getState()
        .showNotification(LLM_OFFLINE_NOTIFICATION_KEY, LLM_OFFLINE_NOTIFICATION_MESSAGE);
    } catch {
      // 通知派发失败不应阻塞主流程
    }
    return new MockLLMProvider().generate(options);
  }

  if (!settings.enabled || settings.provider === 'mock') {
    log('info', 'LLM disabled or mock mode, using mock provider');
    return new MockLLMProvider().generate(options);
  }

  // v1.3.0: 取 LLMConfig (retryAttempts / timeoutMs) + factory provider
  const config = getLLMConfig();
  const providerName = getProviderName();
  log(
    'info',
    `Generating with ${settings.provider} (factory=${providerName}), ` +
      `expectedLanguage=${options.expectedLanguage || 'auto'}`
  );

  // effectiveTimeout: options.timeout 优先, 否则 settings.timeout, 否则 config.timeoutMs / 1000
  const effectiveTimeout =
    options.timeout ?? settings.timeout ?? Math.ceil(config.timeoutMs / 1000);
  const effectiveMaxRetries = options.maxRetries ?? settings.maxRetries ?? 2;

  const timeoutSignal = createTimeoutSignal(effectiveTimeout);
  // v1.5.3 fix V2-P1-003: 用 combineSignals 替代 AbortSignal.any, 兼容旧浏览器.
  const combinedSignal = options.signal
    ? combineSignals([options.signal, timeoutSignal])
    : timeoutSignal;

  // v1.4.0 Stage 1: factory 返回函数式 ProviderFn (0 class 引用)
  const providerFn = resolveProviderFn(settings);

  // v2.1.1 Stage 2 (D1): expectJson 类型化, 任何 truthy 值 (true / 'passage' /
  // 'evaluation' / 'difficulty' / 'gloss' / 'generic') 均走 JSON parse-retry 流程.
  // false / undefined 走原 retryWithBackoff (网络重试) 路径.
  // getSchemaForExpectJson 在 generateWithJsonRetry 内部映射 schema.
  if (options.expectJson) {
    // v1.2.0: JSON 重试次数从 settings.jsonMaxAttempts 读取 (默认 3, clamp 1-5)
    const jsonMaxAttempts = resolveJsonMaxAttempts(settings, options);
    return generateWithJsonRetry(providerFn, options, combinedSignal, jsonMaxAttempts);
  }

  // 非 JSON 场景: 保留原 retryWithBackoff 逻辑
  try {
    const result = await retryWithBackoff(
      () =>
        providerFn({
          ...options,
          signal: combinedSignal,
        }),
      effectiveMaxRetries
    );

    if (result.fallbackToMock) {
      log('warn', 'Provider returned fallbackToMock, switching to mock');
      try {
        useToastStore
          .getState()
          .showNotification(LLM_FALLBACK_NOTIFICATION_KEY, LLM_FALLBACK_NOTIFICATION_MESSAGE);
      } catch {
        // 通知失败不应阻塞主流程
      }
      const mock = new MockLLMProvider();
      return mock.generate(options);
    }

    log('info', 'Generation successful');
    return result;
  } catch (error) {
    if (error instanceof Error && (error.name === 'AbortError' || error.message.includes('timeout'))) {
      log('warn', `Request timed out after ${effectiveTimeout}s, falling back to mock`);
      try {
        useToastStore
          .getState()
          .showNotification(LLM_FALLBACK_NOTIFICATION_KEY, LLM_FALLBACK_NOTIFICATION_MESSAGE);
      } catch {
        // 通知失败不应阻塞主流程
      }
      return new MockLLMProvider().generate(options);
    }

    log('error', `Generation failed: ${(error as Error).message}`);
    try {
      useToastStore
      .getState()
      .showNotification(LLM_FALLBACK_NOTIFICATION_KEY, LLM_FALLBACK_NOTIFICATION_MESSAGE);
    } catch {
      // 通知失败不应阻塞主流程
    }
    return new MockLLMProvider().generate(options);
  }
}

/**
 * v1.4.0 Stage 1: 测试 provider 连接 (改走 Edge Function 探测)
 *
 * v1.3.0: 直接 new v1.2.0 class-based provider, 调 provider.testConnection() 探测 API key
 *   - 缺点: API key 暴露在客户端, 不安全 (v2.1.1 Stage 4 后 settings.apiKey 已移除, key 在后端 .env 中)
 *   - 缺点: class 模式违背 v1.3.0 函数式 provider 趋势
 *
 * v1.4.0 Stage 1: POST Edge Function 一个 maxTokens=1 的最小探测请求
 *   - 200: 服务端 API key 已配置, ok=true
 *   - 500 + code:"MISSING_API_KEY": 服务端无 key, ok=false
 *   - 其它 HTTP status: ok=false + 透传 error
 *
 * 调用方: Settings UI "Test Connection" 按钮 → useSettingsStore.testConnection
 *
 * 注: 真实"零成本"探测需要 Edge Function 支持 `?action=test` 端点 (返回 200
 * 立即确认 key 存在, 不调上游 LLM). Stage 2 会在 netlify/edge-functions/llm-proxy.ts
 * 加该端点, Stage 1 暂用 maxTokens=1 探测.
 */
export async function testProviderConnection(
  settings: LLMSettings
): Promise<{ ok: boolean; error?: string }> {
  if (settings.provider === 'mock' || !settings.enabled) {
    return { ok: true };
  }

  log('info', `Testing connection to ${settings.provider}`);

  try {
    const config = getLLMConfig();
    // v1.4.0 Stage 1: 通过 Edge Function 探测, 不再 new v1.2.0 class-based provider
    const response = await fetch(config.proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: settings.provider,
        // 探测用最小 prompt + maxTokens=1, 减少上游 LLM 成本
        prompt: 'ping',
        maxTokens: 1,
      }),
    });

    if (response.ok) {
      log('info', 'Connection test passed');
      return { ok: true };
    }

    const errBody = await response
      .json()
      .catch(() => ({} as { code?: string; message?: string }));
    if (errBody?.code === 'MISSING_API_KEY') {
      return { ok: false, error: 'API key not configured on server' };
    }
    return {
      ok: false,
      error: `Server returned ${response.status}${errBody?.message ? `: ${errBody.message}` : ''}`,
    };
  } catch (error) {
    log('error', `Connection test threw error: ${(error as Error).message}`);
    return { ok: false, error: (error as Error).message };
  }
}
