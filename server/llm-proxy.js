/**
 * Wordaydream LLM 代理服务 (Node.js 版)
 *
 * 替代 Netlify Edge Function, 在你自己的服务器上运行。
 * API key 从环境变量读取, 前端永远看不到 key。
 *
 * 端口: 默认 3001 (通过 PORT 环境变量可改)
 * 路由: POST /api/llm-proxy
 *
 * 环境变量:
 *   DEEPSEEK_API_KEY  - DeepSeek API key
 *   OPENAI_API_KEY    - OpenAI API key (可选)
 *   ANTHROPIC_API_KEY - Anthropic API key (可选)
 *   PORT              - 监听端口 (默认 3001)
 *
 * 用 PM2 管理进程:
 *   pm2 start ecosystem.config.cjs
 *   pm2 logs wordaydream-proxy
 *   pm2 restart wordaydream-proxy
 */

import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3001;
const RATE_LIMIT = 60; // 每分钟每 IP 最多 60 次请求

// 速率限制 (内存计数器, 进程重启会清零)
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

// 重试 + 超时
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

// ======================== Providers ========================

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
    ...(args.expectJson ? { response_format: { type: 'json_object' } } : {}),
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
    ...(args.expectJson ? { response_format: { type: 'json_object' } } : {}),
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

// ======================== 流式 (SSE) 代理 ========================

/**
 * v1.6.4: 三家 provider 的 SSE 流式支持.
 *
 * 此前 body.stream 被整个忽略: 代理照常走 non-stream provider 并返回 JSON, 客户端
 * (streamingProvider) 判定「响应不是 SSE」后静默降级到 mock 文本 —— 用户以为在用
 * 真流式, 其实拿到的是内置示例数据.
 *
 * 帧语义与 netlify/edge-functions/utils/sse.ts 逐字一致: 统一 `data: {"delta":"..."}\n\n`
 * 增量 + `data: [DONE]\n\n` 收尾, 因为客户端 parseSSEStream 只认这一种格式.
 */
const openaiCompatExtract = (payload) =>
  JSON.parse(payload)?.choices?.[0]?.delta?.content ?? null;

const STREAM_SPECS = {
  openai: {
    url: 'https://api.openai.com/v1/chat/completions',
    headers: (k) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${k}` }),
    body: (a) => ({
      model: a.model || 'gpt-4o-mini',
      messages: [
        ...(a.system ? [{ role: 'system', content: a.system }] : []),
        { role: 'user', content: a.prompt },
      ],
      temperature: a.temperature ?? 0.7,
      max_tokens: a.maxTokens ?? 2048,
      stream: true,
    }),
    extract: openaiCompatExtract,
  },
  deepseek: {
    url: 'https://api.deepseek.com/v1/chat/completions',
    headers: (k) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${k}` }),
    body: (a) => ({
      model: a.model || 'deepseek-chat',
      messages: [
        ...(a.system ? [{ role: 'system', content: a.system }] : []),
        { role: 'user', content: a.prompt },
      ],
      temperature: a.temperature ?? 0.7,
      max_tokens: a.maxTokens ?? 2048,
      stream: true,
    }),
    extract: openaiCompatExtract,
  },
  anthropic: {
    url: 'https://api.anthropic.com/v1/messages',
    headers: (k) => ({
      'Content-Type': 'application/json',
      'x-api-key': k,
      'anthropic-version': '2023-06-01',
    }),
    body: (a) => ({
      model: a.model || 'claude-3-5-sonnet-20241022',
      max_tokens: a.maxTokens ?? 2048,
      temperature: a.temperature ?? 0.7,
      system: a.system ?? '',
      messages: [{ role: 'user', content: a.prompt }],
      stream: true,
    }),
    // Anthropic 增量只在 content_block_delta 事件里; ping / message_* 事件无文本
    extract: (payload) => {
      const p = JSON.parse(payload);
      return p.type === 'content_block_delta' ? p.delta?.text ?? null : null;
    },
  },
};

async function streamProxy(args, apiKey, res) {
  const spec = STREAM_SPECS[args.provider];
  const response = await fetch(spec.url, {
    method: 'POST',
    headers: spec.headers(apiKey),
    body: JSON.stringify(spec.body(args)),
  });

  if (!response.ok) {
    const err = new Error(`${args.provider} API error: ${response.status}`);
    err.status = response.status;
    err.code = `${String(args.provider).toUpperCase()}_ERROR`;
    throw err;
  }
  if (!response.body) {
    const err = new Error(`${args.provider} stream returned no body`);
    err.status = 500;
    err.code = 'STREAM_EMPTY';
    throw err;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE 事件以空行分隔; 末段可能是半截帧, 留在 buffer 等下一次 read
      const events = buffer.split(/\n\n/);
      buffer = events.pop() ?? '';
      for (const block of events) {
        for (const line of block.split(/\n/)) {
          if (!line.startsWith('data: ')) continue; // 跳过 event: / id: / 注释行
          const payload = line.slice(6);
          if (payload === '[DONE]') {
            res.write('data: [DONE]\n\n');
            res.end();
            return;
          }
          let delta = null;
          try {
            delta = spec.extract(payload);
          } catch {
            continue; // 容忍上游非 JSON 心跳包
          }
          if (delta) res.write(`data: ${JSON.stringify({ delta })}\n\n`);
        }
      }
    }
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (e) {
    // 已开始流式, 无法再改状态码: 以错误帧收尾, 客户端据此判定失败
    res.write(`data: ${JSON.stringify({ error: e?.message ?? 'stream error' })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  } finally {
    if (typeof reader.releaseLock === 'function') reader.releaseLock();
  }
}

// ======================== Express 路由 ========================

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// LLM 代理主路由
app.post('/api/llm-proxy', async (req, res) => {
  const body = req.body;

  // 验证必填字段
  if (!body.provider || !body.prompt) {
    return res.status(400).json({
      error: 'Missing required fields: provider, prompt',
    });
  }

  // 速率限制
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const rateLimitHit = checkRateLimit(ip);
  if (rateLimitHit) {
    return res.status(429).json(rateLimitHit);
  }

  // 从环境变量取 API key (不在请求体里传)
  const apiKey = process.env[`${body.provider.toUpperCase()}_API_KEY`];
  if (!apiKey) {
    return res.status(500).json({
      error: 'API key not configured',
      code: 'MISSING_API_KEY',
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

  // v1.6.4: 流式分支. 必须在 withRetry 之前 —— SSE 一旦开始写字节就不能重试.
  if (body.stream === true) {
    try {
      await streamProxy(body, apiKey, res);
    } catch (e) {
      if (res.headersSent) {
        res.end();
        return;
      }
      res.status(e?.status || 500).json({
        error: 'Provider stream error',
        code: e?.code || 'STREAM_ERROR',
        message: e?.message || 'Unknown error',
      });
    }
    return;
  }

  try {
    const result = await withRetry(
      (signal) => provider({ ...body, apiKey, signal }),
      1,
      30000
    );

    res.json({
      text: result.text,
      model: result.model,
      usage: result.usage,
      language: body.language || 'en',
    });
  } catch (e) {
    const status = e?.status || 500;
    res.status(status).json({
      error: 'Provider error',
      code: e?.code || 'PROVIDER_ERROR',
      message: e?.message || 'Unknown error',
    });
  }
});

// ======================== 启动 ========================

app.listen(PORT, () => {
  console.log(`[LLM Proxy] 服务已启动: http://localhost:${PORT}`);
  console.log(`[LLM Proxy] 健康检查: http://localhost:${PORT}/health`);
  console.log(`[LLM Proxy] 已配置的 provider:`);
  if (process.env.DEEPSEEK_API_KEY) console.log(`  - deepseek ✓`);
  if (process.env.OPENAI_API_KEY) console.log(`  - openai ✓`);
  if (process.env.ANTHROPIC_API_KEY) console.log(`  - anthropic ✓`);
  if (!process.env.DEEPSEEK_API_KEY && !process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    console.warn(`  [警告] 未配置任何 API key, 请在 .env 文件中设置`);
  }
});
