/**
 * Anthropic provider for llm-proxy edge function.
 *
 * Speaks the Anthropic Messages API. The API key is read from
 * Deno.env at the proxy layer; this module never sees a user-supplied key.
 */

import type { ProviderArgs, ProviderResult } from "./openai.ts";
import { createUnifiedSSEStream } from "../utils/sse.ts";

export async function anthropicProvider(args: ProviderArgs): Promise<ProviderResult> {
  const model = args.model || "claude-3-5-sonnet-20241022";
  const body = {
    model,
    max_tokens: args.maxTokens ?? 2048,
    temperature: args.temperature ?? 0.7,
    system: args.system ?? "",
    messages: [{ role: "user", content: args.prompt }],
  };

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": args.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
    signal: args.signal,
  });

  if (!response.ok) {
    const err: Error & { status?: number; code?: string } = new Error(
      `Anthropic API error: ${response.status}`
    );
    err.status = response.status;
    err.code = "ANTHROPIC_ERROR";
    throw err;
  }

  const data = await response.json();
  return {
    text: data.content[0].text,
    model: data.model,
    usage: {
      inputTokens: data.usage.input_tokens,
      outputTokens: data.usage.output_tokens,
    },
  };
}

/**
 * v1.6.4: Streaming Anthropic provider (此前 stream=true 会被代理回 501)
 *
 * Anthropic 的增量在 `content_block_delta` 事件的 `delta.text` 上; 同一份流里还有
 * message_start / message_delta / content_block_stop / ping 等非文本事件, 全部跳过.
 * 上游不发 `[DONE]` 哨兵, 靠 HTTP 流自然结束 (message_stop 之后连接关闭) 收尾.
 */
export async function anthropicStreamProvider(
  args: ProviderArgs
): Promise<ReadableStream<Uint8Array>> {
  const model = args.model || "claude-3-5-sonnet-20241022";
  const body = {
    model,
    max_tokens: args.maxTokens ?? 2048,
    temperature: args.temperature ?? 0.7,
    system: args.system ?? "",
    messages: [{ role: "user", content: args.prompt }],
    stream: true,
  };

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": args.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
    signal: args.signal,
  });

  if (!response.ok) {
    const err: Error & { status?: number; code?: string } = new Error(
      `Anthropic API error: ${response.status}`
    );
    err.status = response.status;
    err.code = "ANTHROPIC_ERROR";
    throw err;
  }

  if (!response.body) {
    const err: Error & { status?: number; code?: string } = new Error(
      "Anthropic stream returned no body"
    );
    err.status = 500;
    err.code = "ANTHROPIC_STREAM_EMPTY";
    throw err;
  }

  return createUnifiedSSEStream(response.body, (payload) => {
    const parsed = JSON.parse(payload) as {
      type?: string;
      delta?: { text?: string };
    };
    if (parsed.type !== "content_block_delta") return null;
    return parsed.delta?.text ?? null;
  });
}
