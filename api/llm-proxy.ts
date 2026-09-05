/**
 * Wordaydream LLM Proxy (IGA Pages Serverless Function)
 *
 * 服务端代理, 隐藏上游 LLM API key, 前端永远看不到 key。
 * 部署后路径: POST /api/llm-proxy
 *
 * 请求体:
 *   { provider, model?, system?, prompt, temperature?, maxTokens?, expectJson?, language? }
 *
 * 响应:
 *   200 { text, model, usage: { inputTokens, outputTokens }, language }
 *   4xx/5xx { error, code, message }
 *
 * API key 从 IGA Pages 环境变量读取 (通过 `iga pages env add` 设置):
 *   DEEPSEEK_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY
 */

import type { IncomingMessage, ServerResponse } from "node:http";

// ======================== 类型 ========================

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
  stream?: boolean;
}

interface LLMResponse {
  text: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
  language: string;
}

interface ProviderArgs {
  apiKey: string;
  model?: string;
  system?: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  expectJson?: boolean;
  signal: AbortSignal;
}

interface ProviderResult {
  text: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

// ======================== 常量 ========================

const RATE_LIMIT = 60; // 每分钟每 IP 最多 60 次请求

// ======================== 工具函数 ========================

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.end(JSON.stringify(data));
}

/** 从 Node.js IncomingMessage 读取请求体为字符串 */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer | string) => {
      data += chunk;
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

// ======================== 速率限制 ========================

const requestCounts = new Map<string, { count: number; resetTime: number }>();

function checkRateLimit(ip: string, limit: number): boolean {
  const now = Date.now();
  const record = requestCounts.get(ip);

  if (!record || record.resetTime < now) {
    requestCounts.set(ip, { count: 1, resetTime: now + 60000 });
    return true;
  }

  if (record.count >= limit) {
    return false;
  }

  record.count += 1;
  return true;
}

// ======================== 重试 + 超时 ========================

async function withRetry<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  retries: number,
  timeoutMs: number
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const result = await fn(controller.signal);
      clearTimeout(timeoutId);
      return result;
    } catch (e: unknown) {
      clearTimeout(timeoutId);
      lastError = e;
      if (attempt === retries) break;
      const status = (e as { status?: number })?.status;
      if (typeof status === "number" && status >= 400 && status < 500) break;
      // 指数退避: 1s, 2s, 3s ...
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw lastError;
}

// ======================== Providers ========================

async function deepseekProvider(args: ProviderArgs): Promise<ProviderResult> {
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

  const data = (await response.json()) as {
    model: string;
    choices: Array<{ message: { content: string } }>;
    usage: { prompt_tokens: number; completion_tokens: number };
  };
  return {
    text: data.choices[0].message.content,
    model: data.model,
    usage: {
      inputTokens: data.usage.prompt_tokens,
      outputTokens: data.usage.completion_tokens,
    },
  };
}

async function openaiProvider(args: ProviderArgs): Promise<ProviderResult> {
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

  const data = (await response.json()) as {
    model: string;
    choices: Array<{ message: { content: string } }>;
    usage: { prompt_tokens: number; completion_tokens: number };
  };
  return {
    text: data.choices[0].message.content,
    model: data.model,
    usage: {
      inputTokens: data.usage.prompt_tokens,
      outputTokens: data.usage.completion_tokens,
    },
  };
}

async function anthropicProvider(args: ProviderArgs): Promise<ProviderResult> {
  const model = args.model || "claude-3-5-sonnet-20241022";
  const body = {
    model,
    max_tokens: args.maxTokens ?? 2048,
    system: args.system || undefined,
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

  const data = (await response.json()) as {
    model: string;
    content: Array<{ text: string }>;
    usage: { input_tokens: number; output_tokens: number };
  };
  return {
    text: data.content[0].text,
    model: data.model,
    usage: {
      inputTokens: data.usage.input_tokens,
      outputTokens: data.usage.output_tokens,
    },
  };
}

const providerMap: Record<
  LLMRequest["provider"],
  (args: ProviderArgs) => Promise<ProviderResult>
> = {
  openai: openaiProvider,
  anthropic: anthropicProvider,
  deepseek: deepseekProvider,
};

// ======================== 主处理函数 ========================

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Max-Age", "86400");
    res.end();
    return;
  }

  // 方法检查
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  // 从请求头获取 IP (IGA Pages 会注入 x-forwarded-for)
  const headers = req.headers as Record<string, string | string[] | undefined>;
  const forwardedFor = headers["x-forwarded-for"];
  const ip =
    (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor)?.split(",")[0]?.trim() ||
    (headers["x-real-ip"] as string) ||
    "unknown";

  // 速率限制
  if (!checkRateLimit(ip, RATE_LIMIT)) {
    res.setHeader("Retry-After", "60");
    sendJson(res, 429, { error: "Rate limit exceeded", code: "RATE_LIMIT" });
    return;
  }

  // 读取并解析请求体
  let body: LLMRequest;
  try {
    const rawBody = await readBody(req);
    body = JSON.parse(rawBody) as LLMRequest;
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body" });
    return;
  }

  // 验证必填字段
  if (!body.provider || !body.prompt) {
    sendJson(res, 400, {
      error: "Missing required fields: provider, prompt",
    });
    return;
  }

  // 从环境变量取 API key (不在请求体里传)
  const apiKey = process.env[`${body.provider.toUpperCase()}_API_KEY`];
  if (!apiKey) {
    sendJson(res, 500, {
      error: "API key not configured",
      code: "MISSING_API_KEY",
    });
    return;
  }

  // 流式分支: stream === true 时走 SSE 转发
  if (body.stream === true) {
    return handleStreamRequest(req, res, body, apiKey);
  }

  const provider = providerMap[body.provider];
  if (!provider) {
    sendJson(res, 400, {
      error: "Unsupported provider",
      code: "UNSUPPORTED_PROVIDER",
      message: `Provider "${body.provider}" is not supported. Supported: openai, anthropic, deepseek`,
    });
    return;
  }

  try {
    const result = await withRetry(
      (signal) => provider({ ...body, apiKey, signal }),
      1, // 重试 1 次 (5xx)
      30000 // 30s 超时
    );

    const response: LLMResponse = {
      text: result.text,
      model: result.model,
      usage: result.usage,
      language: body.language || "en",
    };

    sendJson(res, 200, response);
  } catch (e: unknown) {
    const err = e as { status?: number; code?: string; message?: string };
    sendJson(res, err.status || 500, {
      error: "Provider error",
      code: err.code || "PROVIDER_ERROR",
      message: err.message || "Unknown error",
    });
  }
}

// ======================== 流式处理 ========================

/**
 * 流式分支: 转发上游 SSE 给前端
 *
 * - DeepSeek / OpenAI: 用 OpenAI 兼容协议, 上游返回 SSE choices[].delta.content,
 *   转成统一格式 `data: {"delta":"..."}` 转发给前端, 结束发 `data: [DONE]`
 * - Anthropic: 返回 501 (前端 fallback 到非流式或 mock)
 *
 * Node.js IncomingMessage/ServerResponse 格式, 用 res.write 推送 SSE.
 */
async function handleStreamRequest(
  req: IncomingMessage,
  res: ServerResponse,
  body: LLMRequest,
  apiKey: string
): Promise<void> {
  // Anthropic 不支持流式 (协议不同, 暂未实现)
  if (body.provider === "anthropic") {
    sendJson(res, 501, {
      error: "Stream not implemented for this provider",
      code: "STREAM_NOT_IMPLEMENTED",
    });
    return;
  }

  // DeepSeek / OpenAI 都用 OpenAI 兼容协议
  const endpoint =
    body.provider === "deepseek"
      ? "https://api.deepseek.com/v1/chat/completions"
      : "https://api.openai.com/v1/chat/completions";

  const model = body.model || (body.provider === "deepseek" ? "deepseek-chat" : "gpt-4o-mini");
  const upstreamBody = {
    model,
    messages: [
      ...(body.system ? [{ role: "system", content: body.system }] : []),
      { role: "user", content: body.prompt },
    ],
    temperature: body.temperature ?? 0.7,
    max_tokens: body.maxTokens ?? 2048,
    stream: true,
    ...(body.expectJson ? { response_format: { type: "json_object" } } : {}),
  };

  // 设置 SSE 响应头
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");

  // 客户端断开时取消上游请求
  const upstreamController = new AbortController();
  req.on("close", () => {
    if (!res.writableEnded) upstreamController.abort();
  });

  try {
    const upstream = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(upstreamBody),
      signal: upstreamController.signal,
    });

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => "");
      // SSE 错误以 error 事件形式发给前端
      res.write(`data: ${JSON.stringify({ error: `Upstream ${upstream.status}: ${errText.slice(0, 200)}` })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    if (!upstream.body) {
      res.write(`data: ${JSON.stringify({ error: "Upstream returned no body" })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    // 逐块读取上游 SSE, 解析 choices[].delta.content, 转发统一格式
    const reader = (upstream.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        // 流结束, 发 [DONE] 哨兵
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }

      buffer += decoder.decode(value, { stream: true });
      // SSE 事件以 \n\n 分隔
      const events = buffer.split(/\n\n/);
      buffer = events.pop() ?? "";

      for (const eventBlock of events) {
        for (const line of eventBlock.split(/\n/)) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6);
          if (payload === "[DONE]") {
            res.write("data: [DONE]\n\n");
            res.end();
            return;
          }
          try {
            const parsed = JSON.parse(payload) as {
              choices?: Array<{ delta?: { content?: string } }>;
            };
            const content = parsed.choices?.[0]?.delta?.content ?? "";
            if (content) {
              // 转发统一 delta 格式给前端
              res.write(`data: ${JSON.stringify({ delta: content })}\n\n`);
            }
          } catch {
            // 忽略单行 JSON 解析错误 (上游偶发心跳包)
          }
        }
      }
    }
  } catch (e: unknown) {
    if (upstreamController.signal.aborted) {
      // 客户端主动断开, 静默关闭
      if (!res.writableEnded) res.end();
      return;
    }
    const err = e as { message?: string };
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ error: err.message ?? "stream error" })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
    }
  }
}
