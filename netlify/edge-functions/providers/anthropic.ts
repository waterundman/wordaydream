/**
 * Anthropic provider for llm-proxy edge function.
 *
 * Speaks the Anthropic Messages API. The API key is read from
 * Deno.env at the proxy layer; this module never sees a user-supplied key.
 */

import type { ProviderArgs, ProviderResult } from "./openai.ts";

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
