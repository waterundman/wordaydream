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
