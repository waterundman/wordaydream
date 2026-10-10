/**
 * OpenAI provider for llm-proxy edge function.
 *
 * Speaks the OpenAI Chat Completions API. The API key is read from
 * Deno.env at the proxy layer; this module never sees a user-supplied key.
 *
 * v1.4.1 Stage 1: SSE stream support
 * - When args.stream === true, fetch upstream with stream=true and return
 *   a ReadableStream that the caller can pipe as text/event-stream.
 * - When args.stream is false/undefined, retain the v1.3.0 behavior
 *   (single JSON response, parsed into ProviderResult).
 */

import { createUnifiedSSEStream } from "../utils/sse.ts";

export interface ProviderArgs {
  apiKey: string;
  system?: string;
  prompt: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  expectJson?: boolean;
  language?: string;
  expectedLanguage?: string;
  /**
   * v1.4.1 Stage 1: SSE stream flag
   * - true:  fetch upstream with stream=true, return ReadableStream
   *          (caller will pipe as text/event-stream to client)
   * - false/undefined: original v1.3.0 JSON response
   */
  stream?: boolean;
  /** v1.5.2: AbortSignal for timeout/cancellation support */
  signal?: AbortSignal;
}

export interface ProviderResult {
  text: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

/**
 * v1.3.0: Non-streaming OpenAI provider — returns ProviderResult.
 * v1.4.1 Stage 1: still used as the default when args.stream !== true.
 *
 * 注: 当 args.stream === true 时, 调用方应直接调 openaiStreamProvider,
 *     这里不再内部分发 (避免 return type conflict:
 *     ProviderResult vs ReadableStream<Uint8Array>)
 */
export async function openaiProvider(args: ProviderArgs): Promise<ProviderResult> {
  const model = args.model || "gpt-4o-mini";
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

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
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
      `OpenAI API error: ${response.status}`
    );
    err.status = response.status;
    err.code = "OPENAI_ERROR";
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
 * v1.4.1 Stage 1: Streaming OpenAI provider
 *
 * 与 openaiProvider 区别:
 * - 请求体多一个 `stream: true`
 * - 不解析响应, 直接转发 ReadableStream 给调用方
 * - 调用方 (llm-proxy.ts) 包成 text/event-stream Response
 *
 * 返回类型: 仍是 ProviderResult, 但 text 字段是空字符串 (调用方不应读 text),
 *           通过"显式 stream 模式"识别即可 (即 call site 知道 args.stream=true).
 *
 * 实际上, 当 stream=true 时, 我们想返回 ReadableStream 而非 ProviderResult.
 * 但为了不破坏 v1.3.0 type contract, 这里采用: 单独导出 openaiStreamProvider,
 * llm-proxy.ts 在 stream=true 时显式调它.
 */
export async function openaiStreamProvider(
  args: ProviderArgs
): Promise<ReadableStream<Uint8Array>> {
  const model = args.model || "gpt-4o-mini";
  const body = {
    model,
    messages: [
      ...(args.system ? [{ role: "system", content: args.system }] : []),
      { role: "user", content: args.prompt },
    ],
    temperature: args.temperature ?? 0.7,
    max_tokens: args.maxTokens ?? 2048,
    stream: true,
    ...(args.expectJson ? { response_format: { type: "json_object" } } : {}),
  };

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
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
      `OpenAI API error: ${response.status}`
    );
    err.status = response.status;
    err.code = "OPENAI_ERROR";
    throw err;
  }

  if (!response.body) {
    const err: Error & { status?: number; code?: string } = new Error(
      "OpenAI stream returned no body"
    );
    err.status = 500;
    err.code = "OPENAI_STREAM_EMPTY";
    throw err;
  }

  // 转换 OpenAI SSE 格式 (choices[].delta.content) 为客户端约定的统一 delta 格式
  // 客户端 (parseSSEStream) 期望 data: {"delta":"..."} 格式
  return createUnifiedSSEStream(response.body, (payload) => {
    const parsed = JSON.parse(payload) as {
      choices?: Array<{ delta?: { content?: string } }>;
    };
    return parsed.choices?.[0]?.delta?.content ?? null;
  });
}
