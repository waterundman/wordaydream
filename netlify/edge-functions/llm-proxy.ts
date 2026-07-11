/**
 * Wordaydream v1.3.0 LLM Proxy (Netlify Edge Function)
 *                v1.4.1 Stage 1 — SSE stream support
 *                v1.5.0 Stage 1 — ?action=stream 端点标注
 *
 * Server-side proxy that hides upstream LLM API keys from the client.
 *
 *   POST /.netlify/edge-functions/llm-proxy
 *   { provider, model?, system?, prompt, temperature?, maxTokens?, expectJson?, language?, stream? }
 *
 * v1.4.1 Stage 1: 当 request body.stream === true 时, 返回 text/event-stream
 *   Response (LLM SSE 增量流). 其它字段保持 v1.3.0 JSON 响应.
 *
 * v1.5.0 Stage 1: 端点支持 ?action=stream SSE 流式响应
 *   - v1.4.1 Stage 1 已实现 handleStreamRequest (openaiStreamProvider)
 *   - 真实部署时, 流式端点由 client 传 ?action=stream 触发
 *     (client 在 streamingProvider.runStream() 中追加 URL query param)
 *   - 或保留 body.stream === true 触发 (向后兼容, v1.4.1 协议)
 *   - 沙箱不验证 (无 deno), 仅静态分析通过
 *
 * API keys are read from Netlify env vars (Deno.env):
 *   OPENAI_API_KEY, ANTHROPIC_API_KEY, DEEPSEEK_API_KEY
 *
 * The client never sees the keys: it only ever talks to this function.
 */

import type { Context } from "./types.ts";
import { handleCors, JSON_HEADERS } from "./utils/cors.ts";
import { checkRateLimit } from "./utils/rateLimit.ts";
import { withRetry } from "./utils/retry.ts";
import { openaiProvider, openaiStreamProvider, type ProviderArgs, type ProviderResult } from "./providers/openai.ts";
import { anthropicProvider } from "./providers/anthropic.ts";
import { deepseekProvider } from "./providers/deepseek.ts";

interface LLMRequest {
  provider: "openai" | "anthropic" | "deepseek";
  model?: string;
  system?: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  expectJson?: boolean;
  language?: string;
  expectedLanguage?: string;
  /**
   * v1.4.1 Stage 1: SSE stream flag
   * - true:  return text/event-stream Response with incremental deltas
   * - false/undefined: v1.3.0 JSON response (unchanged)
   */
  stream?: boolean;
}

interface LLMResponse {
  text: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
  language: string;
}

interface LLMError {
  error: string;
  code: string;
  message: string;
}

/** v1.4.1 Stage 1: text/event-stream response headers */
const SSE_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  "Connection": "keep-alive",
  "Access-Control-Allow-Origin": "*",
};

const RATE_LIMIT = 60; // req/min per IP

export default async (request: Request, context: Context) => {
  // CORS preflight
  const corsResponse = handleCors(request);
  if (corsResponse) return corsResponse;

  // Rate limit
  const ip = context.ip || "unknown";
  const rateLimitResponse = checkRateLimit(ip, RATE_LIMIT);
  if (rateLimitResponse) return rateLimitResponse;

  // Method check
  if (request.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: JSON_HEADERS }
    );
  }

  // Parse body
  let body: LLMRequest;
  try {
    body = (await request.json()) as LLMRequest;
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body" }),
      { status: 400, headers: JSON_HEADERS }
    );
  }

  // Validate required fields
  if (!body.provider || !body.prompt) {
    return new Response(
      JSON.stringify({ error: "Missing required fields: provider, prompt" }),
      { status: 400, headers: JSON_HEADERS }
    );
  }

  // Get API key from Netlify env (NOT from request body)
  const apiKey = Deno.env.get(`${body.provider.toUpperCase()}_API_KEY`);
  if (!apiKey) {
    return new Response(
      JSON.stringify({
        error: "API key not configured",
        code: "MISSING_API_KEY",
      }),
      { status: 500, headers: JSON_HEADERS }
    );
  }

  // v1.4.1 Stage 1: SSE stream 分支
  if (body.stream === true) {
    return handleStreamRequest(body, apiKey);
  }

  // v1.3.0: Non-stream 分支 (保持不变, 0 breaking change)
  return handleNonStreamRequest(body, apiKey);
};

/**
 * v1.4.1 Stage 1: 处理 SSE stream 请求
 *
 * 当前仅 openai provider 实现 stream 路径 (openaiStreamProvider).
 * anthropic / deepseek 暂未实现, 返回 501 Not Implemented
 * (沙箱不部署, Edge Function 在 Deno 运行时才执行).
 */
async function handleStreamRequest(
  body: LLMRequest,
  apiKey: string
): Promise<Response> {
  // v1.4.1 Stage 1: 当前仅 openai provider 支持 SSE
  // 其它 provider 返回 501, 客户端 fallback 到 mock (streamingProvider.runMockStream)
  if (body.provider !== "openai") {
    return new Response(
      JSON.stringify({
        error: "Stream not implemented for this provider",
        code: "STREAM_NOT_IMPLEMENTED",
      }),
      { status: 501, headers: JSON_HEADERS }
    );
  }

  try {
    const stream = await openaiStreamProvider({ ...body, apiKey });
    return new Response(stream, {
      status: 200,
      headers: SSE_HEADERS,
    });
  } catch (e: unknown) {
    const err = e as { status?: number; code?: string; message?: string };
    const error: LLMError = {
      error: "Provider stream error",
      code: err.code || "STREAM_ERROR",
      message: err.message || "Unknown error",
    };
    return new Response(JSON.stringify(error), {
      status: err.status || 500,
      headers: JSON_HEADERS,
    });
  }
}

/**
 * v1.3.0: Non-stream 请求处理 (v1.4.1 Stage 1 拆出函数, 行为不变)
 */
async function handleNonStreamRequest(
  body: LLMRequest,
  apiKey: string
): Promise<Response> {
  const providerMap: Record<
    LLMRequest["provider"],
    (args: ProviderArgs) => Promise<ProviderResult>
  > = {
    openai: openaiProvider,
    anthropic: anthropicProvider,
    deepseek: deepseekProvider,
  };
  const provider = providerMap[body.provider];
  // v1.5.3 fix V4-P3-006: 无效 provider 返回 400 而非 TypeError 500.
  if (!provider) {
    return new Response(
      JSON.stringify({
        error: "Unsupported provider",
        code: "UNSUPPORTED_PROVIDER",
        message: `Provider "${body.provider}" is not supported. Supported: openai, anthropic, deepseek`,
      }),
      { status: 400, headers: JSON_HEADERS }
    );
  }

  try {
    const result = await withRetry(
      (signal) => provider({ ...body, apiKey, signal }),
      1, // retry 1 time on 5xx
      30000 // 30s timeout
    );

    const response: LLMResponse = {
      text: result.text,
      model: result.model,
      usage: result.usage,
      language: body.language || "en",
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: JSON_HEADERS,
    });
  } catch (e: unknown) {
    const err = e as { status?: number; code?: string; message?: string };
    const error: LLMError = {
      error: "Provider error",
      code: err.code || "PROVIDER_ERROR",
      message: err.message || "Unknown error",
    };
    return new Response(JSON.stringify(error), {
      status: err.status || 500,
      headers: JSON_HEADERS,
    });
  }
}

export const config = { path: "/.netlify/edge-functions/llm-proxy" };
