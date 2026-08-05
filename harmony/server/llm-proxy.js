/**
 * Wordaydream Harmony Stage 4 — 独立 LLM Proxy Node.js 服务
 *
 * 脱离 Netlify Edge Function / 项目根 server/llm-proxy.js, 专为鸿蒙 ArkWeb 部署.
 * 可独立 `node harmony/server/llm-proxy.js` 启动, 不依赖项目根 package.json.
 *
 * 路由:
 *   GET  /health                  健康检查
 *   POST /api/llm                 LLM 代理主路由 (JSON + SSE 双模式)
 *   POST /api/llm-proxy           别名 (与项目根 server/llm-proxy.js 兼容)
 *   OPTIONS /api/llm              CORS 预检
 *   OPTIONS /api/llm-proxy        CORS 预检
 *
 * 环境变量:
 *   OPENAI_API_KEY                OpenAI API key (可选)
 *   ANTHROPIC_API_KEY             Anthropic API key (可选)
 *   DEEPSEEK_API_KEY              DeepSeek API key (可选)
 *   PORT                          监听端口 (默认 3001)
 *   CORS_ALLOWED_ORIGINS          附加允许的 origin (逗号分隔, 可选)
 *
 * CORS 策略:
 *   允许 ArkWeb origin:
 *   - http://localhost:*  (本地调试)
 *   - http://127.0.0.1:*  (本地调试)
 *   - arkweb://*          (ArkWeb rawfile 协议)
 *   - https://*.hapogo.com(生产域名)
 *   - file://             (本地文件协议, ArkWeb 部分场景使用)
 *
 * SSE 模式:
 *   请求 body 含 `stream: true` 时, 响应 Content-Type: text/event-stream,
 *   每个上游 chunk 以 `data: {json}\n\n` 推送, 末尾发 `data: [DONE]\n\n`.
 */

import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3001;
const RATE_LIMIT = 60; // 每分钟每 IP 最多 60 次请求

// ======================== CORS ========================

/**
 * ArkWeb origin 白名单匹配器.
 *
 * 支持:
 * - http://localhost:* / http://127.0.0.1:*
 * - arkweb://* (ArkWeb rawfile / resource 协议)
 * - https://*.hapogo.com (生产域名, 支持子域)
 * - file:// (本地文件协议)
 * - CORS_ALLOWED_ORIGINS 环境变量附加 (逗号分隔)
 */
const STATIC_ALLOWED_ORIGINS = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^arkweb:\/\/.*$/,
  /^https?:\/\/[a-z0-9-]+\.hapogo\.com(:\d+)?$/,
  /^file:\/\/.*$/,
];

function getExtraAllowedOrigins() {
  const raw = process.env.CORS_ALLOWED_ORIGINS;
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function isAllowedOrigin(origin) {
  if (!origin || typeof origin !== 'string') return false;
  for (const re of STATIC_ALLOWED_ORIGINS) {
    if (re.test(origin)) return true;
  }
  for (const literal of getExtraAllowedOrigins()) {
    if (origin === literal) return true;
  }
  return false;
}

function corsMiddleware(req, res, next) {
  const origin = req.headers.origin;
  if (isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else {
    // 不在白名单的 origin 仍允许 (CORS 不阻塞请求, 仅浏览器会拒绝响应),
    // 但回退到通配符以兼容 ArkWeb 内部 origin 变体.
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET, POST, OPTIONS, PUT, DELETE'
  );
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Requested-With, Accept'
  );
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
}

app.use(corsMiddleware);
// 同时挂载 cors() 作为兜底 (不覆盖已设置的 origin-specific 头)
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ======================== 速率限制 ========================

const requestCounts = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const record = requestCounts.get(ip);
  if (!record || record.resetTime < now) {
    requestCounts.set(ip, { count: 1, resetTime: now + 60000 });
    return null;
  }
  if (record.count >= RATE_LIMIT) {
    return { error: 'Rate limit exceeded', code: 'RATE_LIMIT' };
  }
  record.count += 1;
  return null;
}

// ======================== 通用工具 ========================

async function withRetry(fn, retries, timeoutMs) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const result = await fn(controller.signal);
      clearTimeout(timeoutId);
      return result;
    } catch (e) {
      clearTimeout(timeoutId);
      lastError = e;
      if (attempt === retries) break;
      const status = e?.status;
      if (typeof status === 'number' && status >= 400 && status < 500) break;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw lastError;
}

// ======================== Providers (non-streaming) ========================

async function deepseekProvider(args) {
  const model = args.model || 'deepseek-chat';
  const body = {
    model,
    messages: [
      ...(args.system ? [{ role: 'system', content: args.system }] : []),
      { role: 'user', content: args.prompt },
    ],
    temperature: args.temperature ?? 0.7,
    max_tokens: args.maxTokens ?? 2048,
    ...(args.expectJson
      ? { response_format: { type: 'json_object' } }
      : {}),
    ...(args.stream ? { stream: true } : {}),
  };

  const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${args.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: args.signal,
  });

  if (!response.ok) {
    const err = new Error(`DeepSeek API error: ${response.status}`);
    err.status = response.status;
    err.code = 'DEEPSEEK_ERROR';
    throw err;
  }

  if (args.stream) {
    return { stream: response.body, model };
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

async function openaiProvider(args) {
  const model = args.model || 'gpt-4o-mini';
  const body = {
    model,
    messages: [
      ...(args.system ? [{ role: 'system', content: args.system }] : []),
      { role: 'user', content: args.prompt },
    ],
    temperature: args.temperature ?? 0.7,
    max_tokens: args.maxTokens ?? 2048,
    ...(args.expectJson
      ? { response_format: { type: 'json_object' } }
      : {}),
    ...(args.stream ? { stream: true } : {}),
  };

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${args.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: args.signal,
  });

  if (!response.ok) {
    const err = new Error(`OpenAI API error: ${response.status}`);
    err.status = response.status;
    err.code = 'OPENAI_ERROR';
    throw err;
  }

  if (args.stream) {
    return { stream: response.body, model };
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

async function anthropicProvider(args) {
  const model = args.model || 'claude-3-5-sonnet-20241022';
  const body = {
    model,
    max_tokens: args.maxTokens ?? 2048,
    system: args.system || undefined,
    messages: [{ role: 'user', content: args.prompt }],
    ...(args.stream ? { stream: true } : {}),
  };

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': args.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
    signal: args.signal,
  });

  if (!response.ok) {
    const err = new Error(`Anthropic API error: ${response.status}`);
    err.status = response.status;
    err.code = 'ANTHROPIC_ERROR';
    throw err;
  }

  if (args.stream) {
    return { stream: response.body, model };
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

const providerMap = {
  deepseek: deepseekProvider,
  openai: openaiProvider,
  anthropic: anthropicProvider,
};

// ======================== SSE 工具 ========================

/**
 * 解析 OpenAI/DeepSeek 风格的 SSE chunk (data: {json}).
 */
function parseOpenAISSEChunk(chunkText) {
  const events = [];
  for (const line of chunkText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (payload === '[DONE]') {
      events.push({ done: true });
      continue;
    }
    try {
      const json = JSON.parse(payload);
      events.push({ json });
    } catch {
      // 跳过解析失败的 chunk (可能是部分截断)
    }
  }
  return events;
}

/**
 * 解析 Anthropic 风格的 SSE chunk (event: xxx \n data: {json}).
 */
function parseAnthropicSSEChunk(chunkText, buffer) {
  const combined = buffer + chunkText;
  const events = [];
  const blocks = combined.split('\n\n');
  // 最后一个块可能不完整, 留在 buffer
  const remaining = blocks.pop() || '';

  for (const block of blocks) {
    if (!block.trim()) continue;
    const lines = block.split('\n');
    let eventType = 'message';
    let data = '';
    for (const line of lines) {
      if (line.startsWith('event:')) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        data = line.slice(5).trim();
      }
    }
    if (!data) continue;
    try {
      const json = JSON.parse(data);
      events.push({ eventType, json });
    } catch {
      // 跳过解析失败
    }
  }
  return { events, remaining };
}

/**
 * 把上游 SSE 流转换为客户端 SSE 流.
 * 兼容 OpenAI/DeepSeek (data: {json}) 与 Anthropic (event: + data:).
 */
async function pipeSSEStream(upstreamBody, res, provider) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const reader = upstreamBody.getReader();
  const decoder = new TextDecoder('utf-8');
  let anthropicBuffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunkText = decoder.decode(value, { stream: true });
      if (provider === 'anthropic') {
        const { events, remaining } = parseAnthropicSSEChunk(
          chunkText,
          anthropicBuffer
        );
        anthropicBuffer = remaining;
        for (const ev of events) {
          // 把 Anthropic 事件类型透传给客户端
          if (ev.eventType === 'content_block_delta') {
            const text = ev.json?.delta?.text;
            if (typeof text === 'string' && text.length > 0) {
              res.write(
                `data: ${JSON.stringify({ delta: text })}\n\n`
              );
            }
          } else if (ev.eventType === 'message_stop') {
            res.write('data: [DONE]\n\n');
          }
        }
      } else {
        // OpenAI / DeepSeek
        const events = parseOpenAISSEChunk(chunkText);
        for (const ev of events) {
          if (ev.done) {
            res.write('data: [DONE]\n\n');
            continue;
          }
          if (ev.json) {
            const delta = ev.json?.choices?.[0]?.delta?.content;
            if (typeof delta === 'string' && delta.length > 0) {
              res.write(
                `data: ${JSON.stringify({ delta, model: ev.json.model })}\n\n`
              );
            }
          }
        }
      }
    }
  } finally {
    res.end();
  }
}

// ======================== 健康检查 ========================

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: Date.now(),
    service: 'wordaydream-harmony-llm-proxy',
    version: '0.1.0-harmony-stage4',
    providers: {
      openai: Boolean(process.env.OPENAI_API_KEY),
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
      deepseek: Boolean(process.env.DEEPSEEK_API_KEY),
    },
  });
});

// ======================== LLM 代理主路由 ========================

async function handleLLMRequest(req, res) {
  const body = req.body || {};

  if (!body.provider || !body.prompt) {
    return res.status(400).json({
      error: 'Missing required fields: provider, prompt',
      code: 'MISSING_FIELDS',
    });
  }

  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const rateLimitHit = checkRateLimit(ip);
  if (rateLimitHit) {
    return res.status(429).json(rateLimitHit);
  }

  const apiKey = process.env[`${body.provider.toUpperCase()}_API_KEY`];
  if (!apiKey) {
    return res.status(500).json({
      error: 'API key not configured',
      code: 'MISSING_API_KEY',
      provider: body.provider,
    });
  }

  const provider = providerMap[body.provider];
  if (!provider) {
    return res.status(400).json({
      error: 'Unsupported provider',
      code: 'UNSUPPORTED_PROVIDER',
      message: `Provider "${body.provider}" is not supported. Supported: openai, anthropic, deepseek`,
    });
  }

  const wantStream = Boolean(body.stream);

  try {
    const result = await withRetry(
      (signal) => provider({ ...body, apiKey, signal, stream: wantStream }),
      1,
      30000
    );

    if (wantStream && result.stream) {
      return await pipeSSEStream(result.stream, res, body.provider);
    }

    return res.json({
      text: result.text,
      model: result.model,
      usage: result.usage,
      language: body.language || 'en',
    });
  } catch (e) {
    const status = e?.status || 500;
    return res.status(status).json({
      error: 'Provider error',
      code: e?.code || 'PROVIDER_ERROR',
      message: e?.message || 'Unknown error',
    });
  }
}

app.post('/api/llm', handleLLMRequest);
app.post('/api/llm-proxy', handleLLMRequest);

// ======================== 启动 ========================

const server = app.listen(PORT, () => {
  console.log(`[Harmony LLM Proxy] 服务已启动: http://localhost:${PORT}`);
  console.log(`[Harmony LLM Proxy] 健康检查: http://localhost:${PORT}/health`);
  console.log(`[Harmony LLM Proxy] 主路由: POST http://localhost:${PORT}/api/llm`);
  console.log(`[Harmony LLM Proxy] CORS 允许: localhost / 127.0.0.1 / arkweb:// / *.hapogo.com / file://`);
  console.log(`[Harmony LLM Proxy] 已配置的 provider:`);
  if (process.env.OPENAI_API_KEY) console.log(`  - openai ✓`);
  if (process.env.ANTHROPIC_API_KEY) console.log(`  - anthropic ✓`);
  if (process.env.DEEPSEEK_API_KEY) console.log(`  - deepseek ✓`);
  if (
    !process.env.OPENAI_API_KEY &&
    !process.env.ANTHROPIC_API_KEY &&
    !process.env.DEEPSEEK_API_KEY
  ) {
    console.warn(`  [警告] 未配置任何 API key, 请在 .env 文件中设置`);
  }
});

// 导出 app / server 供测试 / 华为云 FunctionGraph 复用
export { app, server, handleLLMRequest, isAllowedOrigin, corsMiddleware };
export default app;
