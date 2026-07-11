import type { GenerateOptions } from './provider';
import type { LLMResponse } from '../../../types';
import { getLLMConfig } from '../config/llmConfig';

/**
 * v1.3.0 Edge Function 响应 schema (Stage 1 netlify/edge-functions/llm-proxy.ts)
 *
 * - text: LLM 输出文本
 * - model: 实际调用的模型 (e.g. "gpt-4o-mini")
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
 * OpenAI GPT-4o-mini Provider (v1.4.0 函数式)
 *
 * v1.4.0 兑现 v1.3.0 deprecation warning:
 * - v1.2.0: class-based OpenAI 兼容 provider (router 直连 OpenAI 兼容 API)
 * - v1.3.0: openaiGenerate 函数 + deprecation warning (class 保留作 Settings UI 兼容)
 * - v1.4.0: 删除 v1.2.0 class 形式, 全部走函数式 provider
 *
 * 调用 Netlify Edge Function (config.proxyUrl) 而非直接调用 OpenAI API.
 * 客户端永远看不到 API key, 避免泄露.
 *
 * 替代关系:
 *   - v1.2.0: 客户端持有 OPENAI_API_KEY, fetch(https://api.openai.com/v1/chat/completions)
 *   - v1.3.0: 客户端 fetch(VITE_LLM_PROXY_URL), Edge Function 用 env 里的 OPENAI_API_KEY 调 OpenAI
 *   - v1.4.0: 同 v1.3.0, 简化上层 (router 改走 getProvider() 函数)
 */
export async function openaiGenerate(options: GenerateOptions): Promise<LLMResponse> {
  const config = getLLMConfig();

  const response = await fetch(config.proxyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: 'openai',
      model: 'gpt-4o-mini',
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
