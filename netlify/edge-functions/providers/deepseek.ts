/**
 * DeepSeek provider for llm-proxy edge function.
 *
 * DeepSeek exposes an OpenAI-compatible /v1/chat/completions endpoint.
 * The API key is read from Deno.env at the proxy layer; this module
 * never sees a user-supplied key.
 */

import type { ProviderArgs, ProviderResult } from "./openai.ts";
import { createUnifiedSSEStream } from "../utils/sse.ts";

export async function deepseekProvider(args: ProviderArgs): Promise<ProviderResult> {
  const model = args.model || "deepseek-chat";
  const body = {
    model,
    messages: [
      ...(args.system ? [{ role: "system", content: args.system }] : []),
      { role: "user", content: args.prompt },
    ],
    temperature: args.temperature ?? 0.7,
    max_tokens: args.maxTokens ?? 2048,
    ...(args.expectJson ? { response_format: { type: "json_object" } } : {}),
  };

  const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: args.signal,
  });

  if (!response.ok) {
    const err: Error & { status?: number; code?: string } = new Error(
      `DeepSeek API error: ${response.status}`
    );
    err.status = response.status;
    err.code = "DEEPSEEK_ERROR";
    throw err;
  }

  const data = await response.json();
  return {
    text: data.choices[0].message.content,
    model: data.model,
    usage: {
      inputTokens: data.usage.prompt_tokens,
      outputTokens: data.usage.completion_tokens,
    },
  };
}

/**
 * v1.6.4: Streaming DeepSeek provider (此前 stream=true 会被代理回 501)
 *
 * DeepSeek 是 OpenAI 兼容端点, 增量同样在 choices[0].delta.content; 首帧只有
 * `role` 而无 content, 末帧 content 为空串并伴随 `data: [DONE]` —— 两者都由统一
 * 转换器按「无增量即跳过」处理.
 */
export async function deepseekStreamProvider(
  args: ProviderArgs
): Promise<ReadableStream<Uint8Array>> {
  const model = args.model || "deepseek-chat";
  const body = {
    model,
    messages: [
      ...(args.system ? [{ role: "system", content: args.system }] : []),
      { role: "user", content: args.prompt },
    ],
    temperature: args.temperature ?? 0.7,
    max_tokens: args.maxTokens ?? 2048,
    stream: true,
  };

  const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: args.signal,
  });

  if (!response.ok) {
    const err: Error & { status?: number; code?: string } = new Error(
      `DeepSeek API error: ${response.status}`
    );
    err.status = response.status;
    err.code = "DEEPSEEK_ERROR";
    throw err;
  }

  if (!response.body) {
    const err: Error & { status?: number; code?: string } = new Error(
      "DeepSeek stream returned no body"
    );
    err.status = 500;
    err.code = "DEEPSEEK_STREAM_EMPTY";
    throw err;
  }

  return createUnifiedSSEStream(response.body, (payload) => {
    const parsed = JSON.parse(payload) as {
      choices?: Array<{ delta?: { content?: string } }>;
    };
    return parsed.choices?.[0]?.delta?.content ?? null;
  });
}
