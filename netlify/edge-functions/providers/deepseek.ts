/**
 * DeepSeek provider for llm-proxy edge function.
 *
 * DeepSeek exposes an OpenAI-compatible /v1/chat/completions endpoint.
 * The API key is read from Deno.env at the proxy layer; this module
 * never sees a user-supplied key.
 */

import type { ProviderArgs, ProviderResult } from "./openai.ts";

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
