import type { GenerateOptions } from './provider';
import type { LLMResponse } from '../../../types';
import { getLLMConfig } from '../config/llmConfig';

/**
 * v1.3.0 Edge Function 响应 schema (与 openaiProvider.ts 镜像)
 *
 * - text: LLM 输出文本
 * - model: 实际调用的模型 (e.g. "deepseek-chat")
 * - usage: { inputTokens, outputTokens }
 * - language: 实际语言 (与 expectedLanguage 透传值一致)
 *
 * v1.4.0: 字段保留读取以便未来 router 注入 telemetry, 但当前返回
 * 仍按 LLMResponse 契约 (text + parsed) 避免破坏下游消费者.
 */
interface EdgeLLMResponse {
  text: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
  language: string;
}

/**
 * DeepSeek Provider (v1.4.0 函数式)
 *
 * v1.4.0 兑现 v1.3.0 bridge 占位代码:
 * - v1.2.0: class-based OpenAI 兼容 provider (providerFactory.routeDeepSeek 内部 new)
 * - v1.3.0: 桥接占位 (factory.routeDeepSeek 仍 new class, 准备 v1.4.0 函数化)
 * - v1.4.0: deepseekGenerate 函数式, 复用 openaiGenerate 同构模式
 *
 * 调用 Netlify Edge Function (config.proxyUrl), 由 Edge Function 持有 DEEPSEEK_API_KEY
 * 调 https://api.deepseek.com/v1/chat/completions (OpenAI 兼容协议). 客户端看不到 API key.
 *
 * 模型默认: deepseek-chat (DeepSeek-V3 通用对话模型, 与 v1.2.0 class-based provider
 * 默认 model 保持一致, 减少 v1.3.0 -> v1.4.0 切换的破坏面).
 */
export async function deepseekGenerate(options: GenerateOptions): Promise<LLMResponse> {
  const config = getLLMConfig();

  const response = await fetch(config.proxyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: 'deepseek',
      model: 'deepseek-chat',
      system: options.system,
      prompt: options.prompt,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      expectJson: options.expectJson,
      // v1.2.0 hotfix-3: 透传 expectedLanguage 到 Edge Function
      expectedLanguage: (options as { expectedLanguage?: string }).expectedLanguage,
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const err = new Error(
      `LLM proxy error: ${response.status} ${response.statusText} ${body.slice(0, 200)}`
    ) as Error & { status?: number; body?: string };
    err.status = response.status;
    err.body = body;
    throw err;
  }

  const data = (await response.json()) as EdgeLLMResponse;
  return {
    text: data.text,
    parsed: undefined,
  };
}
