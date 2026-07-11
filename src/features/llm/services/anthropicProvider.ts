import type { GenerateOptions } from './provider';
import type { LLMResponse } from '../../../types';
import { getLLMConfig } from '../config/llmConfig';

/**
 * v1.3.0 Edge Function 响应 schema (与 openaiProvider.ts / deepseekProvider.ts 镜像)
 *
 * - text: LLM 输出文本
 * - model: 实际调用的模型 (e.g. "claude-3-5-haiku-20241022")
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
 * Anthropic Claude 3.5 Haiku Provider (v1.4.0 函数式)
 *
 * v1.4.0 兑现 v1.3.0 v1.2.0 class deprecation warning:
 * - v1.2.0: class-based AnthropicProvider (router 直接调 https://api.anthropic.com/v1/messages)
 * - v1.3.0: providerFactory.routeAnthropic 桥接占位 (new AnthropicProvider('') 触发空 apiKey 路径)
 * - v1.4.0 Stage 2: anthropicGenerate 函数式, 删除 v1.2.0 class, 复用 openaiGenerate 同构模式
 *
 * 调用 Netlify Edge Function (config.proxyUrl), 由 Edge Function 持有 ANTHROPIC_API_KEY
 * 调 https://api.anthropic.com/v1/messages (Anthropic Messages API). 客户端看不到 API key.
 *
 * 模型默认: claude-3-5-haiku-20241022 (Claude 3.5 Haiku, 速度/成本平衡, 与 v1.2.0
 * 默认 model 字段保持一致, 减少 v1.3.0 -> v1.4.0 切换的破坏面).
 */
export async function anthropicGenerate(options: GenerateOptions): Promise<LLMResponse> {
  const config = getLLMConfig();

  const response = await fetch(config.proxyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: 'anthropic',
      model: 'claude-3-5-haiku-20241022',
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
