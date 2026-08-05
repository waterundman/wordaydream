/**
 * Wordaydream Harmony Stage 4 — T01 独立 LLM Proxy 启动测试
 *
 * 测试对象: harmony/server/llm-proxy.js (独立 Node.js 服务, 脱离 Netlify Edge Function)
 *
 * 测试策略:
 * - 静态源码扫描: 验证文件存在 / 关键路由 / ArkWeb CORS 白名单 / SSE 支持 / 三 provider 实现
 * - 沙箱求值 (new Function + mock express/cors): 验证模块可加载, 不被 express 依赖阻塞.
 *   vi.mock 对 src/ 外的 .js 文件无效 (Vite import-analysis 先于 mock 拦截器),
 *   故读源码 → 剥离 import/export → 注入 mock → new Function 求值, 提取纯函数.
 * - 纯函数测试: isAllowedOrigin / corsMiddleware / handleLLMRequest
 *
 * CORS 白名单 (与 FEATURE_PARITY_CHECKLIST.md §4.4 一致):
 * - http://localhost:* / http://127.0.0.1:*  (本地调试)
 * - arkweb://*                                  (ArkWeb rawfile / resource 协议)
 * - https://*.hapogo.com                        (生产域名, 支持子域)
 * - file://                                     (本地文件协议)
 *
 * 0 emoji (与项目硬约束一致)
 * 0 改动: harmony/server/llm-proxy.js 不变, Web 端 vitest 656/656 基线不破坏
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROXY_PATH = resolve(__dirname, '../../harmony/server/llm-proxy.js');
const PROXY_PKG_PATH = resolve(__dirname, '../../harmony/server/package.json');

// ======================== 沙箱求值: 加载 llm-proxy.js 的纯函数 ========================

/**
 * llm-proxy.js 顶层 import express / cors, 这两个包不在项目根 node_modules 内
 * (harmony/server 有独立 package.json). vi.mock 对 src/ 外的 .js 无效,
 * 故用 new Function 沙箱: 读源码 → 剥 ESM import/export → 注入 mock → 求值.
 *
 * 返回模块导出的纯函数: isAllowedOrigin / corsMiddleware / handleLLMRequest + app 引用.
 */
interface ProxyModule {
  isAllowedOrigin: (origin: unknown) => boolean;
  corsMiddleware: (req: unknown, res: unknown, next?: () => void) => void;
  handleLLMRequest: (req: unknown, res: unknown) => Promise<void>;
  app: unknown;
  server: unknown;
}

interface SandboxState {
  module: ProxyModule | null;
  mockApp: {
    use: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    post: ReturnType<typeof vi.fn>;
    listen: ReturnType<typeof vi.fn>;
  };
}

function loadProxyInSandbox(state: SandboxState): ProxyModule {
  const source = readFileSync(PROXY_PATH, 'utf-8');

  // 剥 ESM import 语句, 用 mock 引用替换
  let code = source
    .replace(/import\s+express\s+from\s+['"]express['"];?/g, 'const express = __mockExpress;')
    .replace(/import\s+cors\s+from\s+['"]cors['"];?/g, 'const cors = __mockCors;')
    // 剥 export 语句 (沙箱内不需要 ESM 导出, 用 return 提取)
    .replace(/export\s*\{[^}]*\}\s*;?/g, '')
    .replace(/export\s+default\s+\w+\s*;?/g, '');

  // 在末尾追加 return 语句, 把要导出的符号返回
  code += '\nreturn { app, server, handleLLMRequest, isAllowedOrigin, corsMiddleware };';

  // 构造 mock express / cors
  const mockApp = state.mockApp;
  const mockExpress: unknown = vi.fn(() => mockApp);
  (mockExpress as { json: unknown }).json = vi.fn(
    () => (_req: unknown, _res: unknown, next?: () => void) => {
      if (typeof next === 'function') next();
    }
  );
  const mockCors: unknown = vi.fn(
    () => (_req: unknown, _res: unknown, next?: () => void) => {
      if (typeof next === 'function') next();
    }
  );

  // 用 new Function 求值, 注入 mock
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(
    '__mockExpress',
    '__mockCors',
    code
  ) as (e: unknown, c: unknown) => ProxyModule;
  return factory(mockExpress, mockCors);
}

// ======================== mock req / res 工具 ========================

interface MockReq {
  body: unknown;
  ip?: string;
  socket?: { remoteAddress?: string };
  headers: Record<string, string>;
  method: string;
}

interface MockRes {
  statusCode: number;
  headers: Record<string, string | string[]>;
  body: unknown;
  ended: boolean;
  writtenChunks: string[];
  status: (code: number) => MockRes;
  json: (data: unknown) => MockRes;
  setHeader: (name: string, value: string | string[]) => void;
  end: () => void;
  write: (chunk: string) => void;
  flushHeaders?: () => void;
}

function makeMockReq(body: unknown, opts: Partial<MockReq> = {}): MockReq {
  return {
    body,
    ip: opts.ip ?? '127.0.0.1',
    socket: { remoteAddress: opts.ip ?? '127.0.0.1' },
    headers: opts.headers ?? {},
    method: opts.method ?? 'POST',
  };
}

function makeMockRes(): MockRes {
  const res: MockRes = {
    statusCode: 200,
    headers: {},
    body: null,
    ended: false,
    writtenChunks: [],
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end() {
      this.ended = true;
    },
    write(chunk) {
      this.writtenChunks.push(String(chunk));
    },
    flushHeaders() {},
  };
  return res;
}

// ======================== 测试 ========================

describe('[T01] 独立 LLM Proxy (harmony/server/llm-proxy.js) 启动 + 契约测试', () => {
  let source: string;
  let pkgJson: {
    name: string;
    version: string;
    type?: string;
    engines?: { node: string };
    dependencies: Record<string, string>;
    scripts: Record<string, string>;
  };
  let sandbox: SandboxState;
  let proxyModule: ProxyModule;

  beforeAll(() => {
    source = readFileSync(PROXY_PATH, 'utf-8');
    pkgJson = JSON.parse(readFileSync(PROXY_PKG_PATH, 'utf-8'));

    // 沙箱加载 llm-proxy.js, 提取纯函数 (只做一次)
    sandbox = {
      module: null,
      mockApp: {
        use: vi.fn(),
        get: vi.fn(),
        post: vi.fn(),
        listen: vi.fn((_port: number, cb?: () => void) => {
          if (typeof cb === 'function') cb();
          return { close: vi.fn(() => {}) };
        }),
      },
    };
    proxyModule = loadProxyInSandbox(sandbox);
    sandbox.module = proxyModule;
  });

  beforeEach(() => {
    // 清理环境变量 (避免 test 间 API key 泄漏), 不清 mockApp 调用记录
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.CORS_ALLOWED_ORIGINS;
    delete process.env.KIMI_API_KEY;
    delete process.env.QWEN_API_KEY;
    delete process.env.UNKNOWNPROVIDER_API_KEY;
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.CORS_ALLOWED_ORIGINS;
    delete process.env.KIMI_API_KEY;
    delete process.env.QWEN_API_KEY;
    delete process.env.UNKNOWNPROVIDER_API_KEY;
  });

  // ----------- T01.1: 文件存在 + package.json 独立 -----------

  describe('T01.1 文件结构 + 独立 package.json', () => {
    it('harmony/server/llm-proxy.js 文件存在且非空', () => {
      expect(source).toBeTruthy();
      expect(source.length).toBeGreaterThan(1000);
    });

    it('harmony/server/package.json 声明独立依赖 (express + cors), 与项目根 package.json 解耦', () => {
      expect(pkgJson.name).toBe('wordaydream-harmony-llm-proxy');
      expect(pkgJson.version).toContain('harmony');
      expect(pkgJson.dependencies).toHaveProperty('express');
      expect(pkgJson.dependencies).toHaveProperty('cors');
      expect(pkgJson.scripts).toHaveProperty('start');
      expect(pkgJson.scripts.start).toContain('llm-proxy.js');
    });

    it('package.json "type": "module" 声明 ESM 模式', () => {
      expect(pkgJson.type).toBe('module');
    });

    it('package.json engines.node >= 18 (Node.js 内置 fetch + AbortController)', () => {
      expect(pkgJson.engines?.node).toBeTruthy();
      const minNode = parseInt(String(pkgJson.engines.node).replace(/\D/g, ''), 10);
      expect(minNode).toBeGreaterThanOrEqual(18);
    });
  });

  // ----------- T01.2: 源码静态扫描 — 路由定义 -----------

  describe('T01.2 路由定义 (静态扫描)', () => {
    it('定义 GET /health 健康检查', () => {
      expect(source).toMatch(/app\.get\(['"]\/health['"]/);
      expect(source).toMatch(/wordaydream-harmony-llm-proxy/);
    });

    it('定义 POST /api/llm 主路由', () => {
      expect(source).toMatch(/app\.post\(['"]\/api\/llm['"]/);
    });

    it('定义 POST /api/llm-proxy 别名 (与项目根 server/llm-proxy.js 兼容)', () => {
      expect(source).toMatch(/app\.post\(['"]\/api\/llm-proxy['"]/);
    });

    it('导出 app / server / handleLLMRequest / isAllowedOrigin / corsMiddleware (供测试 / FunctionGraph 复用)', () => {
      expect(source).toMatch(/export\s*\{[^}]*\bapp\b[^}]*\}/);
      expect(source).toMatch(/export\s*\{[^}]*\bhandleLLMRequest\b[^}]*\}/);
      expect(source).toMatch(/export\s*\{[^}]*\bisAllowedOrigin\b[^}]*\}/);
      expect(source).toMatch(/export\s*\{[^}]*\bcorsMiddleware\b[^}]*\}/);
      expect(source).toMatch(/export\s+default\s+app/);
    });
  });

  // ----------- T01.3: 源码静态扫描 — CORS 白名单 -----------

  describe('T01.3 ArkWeb CORS 白名单 (静态扫描)', () => {
    it('允许 http://localhost:* (本地调试)', () => {
      expect(source).toMatch(/https?:\/\/localhost/);
    });

    it('允许 http://127.0.0.1:* (本地调试)', () => {
      expect(source).toMatch(/127\.0\.0\.1/);
    });

    it('允许 arkweb://* (ArkWeb rawfile / resource 协议)', () => {
      expect(source).toMatch(/arkweb:\/\//);
    });

    it('允许 https://*.hapogo.com (生产域名, 支持子域)', () => {
      expect(source).toMatch(/hapogo\.com/);
    });

    it('允许 file:// (本地文件协议, ArkWeb 部分场景使用)', () => {
      expect(source).toMatch(/file:\/\//);
    });

    it('支持 CORS_ALLOWED_ORIGINS 环境变量附加 origin', () => {
      expect(source).toMatch(/CORS_ALLOWED_ORIGINS/);
    });

    it('CORS 头包含 Access-Control-Allow-Methods / Allow-Headers / Max-Age', () => {
      expect(source).toMatch(/Access-Control-Allow-Methods/);
      expect(source).toMatch(/Access-Control-Allow-Headers/);
      expect(source).toMatch(/Access-Control-Max-Age/);
    });

    it('OPTIONS 预检返回 204', () => {
      expect(source).toMatch(/OPTIONS/);
      expect(source).toMatch(/204/);
    });
  });

  // ----------- T01.4: 源码静态扫描 — SSE 模式 -----------

  describe('T01.4 SSE 流式模式 (静态扫描)', () => {
    it('检测 body.stream 字段切换 SSE', () => {
      expect(source).toMatch(/body\.stream/);
    });

    it('SSE 响应 Content-Type: text/event-stream', () => {
      expect(source).toMatch(/text\/event-stream/);
    });

    it('SSE 响应 Cache-Control: no-cache + X-Accel-Buffering: no', () => {
      expect(source).toMatch(/no-cache/);
      expect(source).toMatch(/X-Accel-Buffering/);
    });

    it('SSE 末尾发送 data: [DONE]', () => {
      expect(source).toMatch(/data: \[DONE\]/);
    });

    it('解析 OpenAI/DeepSeek 风格 SSE chunk', () => {
      expect(source).toMatch(/parseOpenAISSEChunk/);
    });

    it('解析 Anthropic 风格 SSE chunk (event: + data:)', () => {
      expect(source).toMatch(/parseAnthropicSSEChunk/);
    });
  });

  // ----------- T01.5: 源码静态扫描 — 三 provider -----------

  describe('T01.5 三 provider 实现 (静态扫描)', () => {
    it('实现 openaiProvider (调用 api.openai.com)', () => {
      expect(source).toMatch(/openaiProvider/);
      expect(source).toMatch(/api\.openai\.com/);
    });

    it('实现 anthropicProvider (调用 api.anthropic.com, 含 x-api-key 头)', () => {
      expect(source).toMatch(/anthropicProvider/);
      expect(source).toMatch(/api\.anthropic\.com/);
      expect(source).toMatch(/x-api-key/);
    });

    it('实现 deepseekProvider (调用 api.deepseek.com)', () => {
      expect(source).toMatch(/deepseekProvider/);
      expect(source).toMatch(/api\.deepseek\.com/);
    });

    it('providerMap 注册三个 provider', () => {
      expect(source).toMatch(/providerMap\s*=\s*\{[\s\S]*deepseek[\s\S]*openai[\s\S]*anthropic[\s\S]*\}/);
    });

    it('通过 process.env[PROVIDER_API_KEY] 读取 key, 不硬编码', () => {
      expect(source).toMatch(/process\.env\[`\$\{body\.provider\.toUpperCase\(\)\}_API_KEY`\]/);
    });

    it('withRetry 实现 (指数退避 + 4xx 不重试)', () => {
      expect(source).toMatch(/withRetry/);
      expect(source).toMatch(/attempt\s*<=\s*retries/);
    });
  });

  // ----------- T01.6: 模块可加载 (沙箱求值) -----------

  describe('T01.6 模块可加载 (沙箱求值, mock express + cors)', () => {
    it('导出 isAllowedOrigin / corsMiddleware / handleLLMRequest / app / server', () => {
      expect(typeof proxyModule.isAllowedOrigin).toBe('function');
      expect(typeof proxyModule.corsMiddleware).toBe('function');
      expect(typeof proxyModule.handleLLMRequest).toBe('function');
      expect(proxyModule.app).toBeDefined();
      expect(proxyModule.server).toBeDefined();
    });

    it('模块加载时触发 app.listen(PORT, cb) 模拟服务启动', () => {
      expect(sandbox.mockApp.listen).toHaveBeenCalled();
      const [port, cb] = sandbox.mockApp.listen.mock.calls[0];
      expect(typeof port).toBe('number');
      expect(typeof cb).toBe('function');
    });

    it('注册 GET /health 路由', () => {
      const healthRoute = sandbox.mockApp.get.mock.calls.find(
        (args) => args[0] === '/health'
      );
      expect(healthRoute).toBeDefined();
      expect(typeof healthRoute![1]).toBe('function');
    });

    it('注册 POST /api/llm + POST /api/llm-proxy 路由', () => {
      const llmRoute = sandbox.mockApp.post.mock.calls.find(
        (args) => args[0] === '/api/llm'
      );
      const proxyRoute = sandbox.mockApp.post.mock.calls.find(
        (args) => args[0] === '/api/llm-proxy'
      );
      expect(llmRoute).toBeDefined();
      expect(proxyRoute).toBeDefined();
    });
  });

  // ----------- T01.7: isAllowedOrigin — 应通过的 origin -----------

  describe('T01.7 isAllowedOrigin — 白名单 origin 应通过', () => {
    it.each([
      ['http://localhost:3001'],
      ['http://localhost:5173'],
      ['https://localhost'],
      ['http://127.0.0.1:3001'],
      ['http://127.0.0.1'],
      ['arkweb://rawfile/index.html'],
      ['arkweb://resource/page'],
      ['https://www.hapogo.com'],
      ['https://app.hapogo.com'],
      ['https://staging.hapogo.com:8443'],
      ['file:///var/www/index.html'],
      ['file:///rawfile/dist/index.html'],
    ])('origin=%s 应被允许', (origin) => {
      expect(proxyModule.isAllowedOrigin(origin)).toBe(true);
    });
  });

  // ----------- T01.8: isAllowedOrigin — 应拒绝的 origin -----------

  describe('T01.8 isAllowedOrigin — 非白名单 / 恶意 origin 应拒绝', () => {
    it.each([
      ['https://evil.com'],
      ['http://attacker.net'],
      ['https://hapogo.com.evil.com'],
      ['ftp://localhost'],
      ['javascript:alert(1)'],
      [''],
      [null],
      [undefined],
      [123],
      [{ origin: 'http://localhost' }],
    ])('origin=%j 应被拒绝', (origin) => {
      expect(proxyModule.isAllowedOrigin(origin)).toBe(false);
    });

    it('CORS_ALLOWED_ORIGINS 环境变量附加的 origin 应通过 (call-time 读取)', () => {
      // isAllowedOrigin 内部调用 getExtraAllowedOrigins() 读取 process.env,
      // 是 call-time 读取, 不需要重新加载模块.
      process.env.CORS_ALLOWED_ORIGINS = 'https://my-custom.com,https://staging.my-domain.com';
      expect(proxyModule.isAllowedOrigin('https://my-custom.com')).toBe(true);
      expect(proxyModule.isAllowedOrigin('https://staging.my-domain.com')).toBe(true);
      expect(proxyModule.isAllowedOrigin('https://not-in-env.com')).toBe(false);

      // 删除 env 后附加 origin 不再被允许
      delete process.env.CORS_ALLOWED_ORIGINS;
      expect(proxyModule.isAllowedOrigin('https://my-custom.com')).toBe(false);
    });
  });

  // ----------- T01.9: corsMiddleware — OPTIONS 预检 -----------

  describe('T01.9 corsMiddleware — OPTIONS 预检返回 204 + CORS 头', () => {
    it('白名单 origin 的 OPTIONS 请求: 204 + Access-Control-Allow-Origin 回显 + Max-Age', () => {
      const req = {
        method: 'OPTIONS',
        headers: { origin: 'http://localhost:5173' },
      };
      const res = makeMockRes();
      proxyModule.corsMiddleware(req, res);

      expect(res.statusCode).toBe(204);
      expect(res.headers['Access-Control-Allow-Origin']).toBe('http://localhost:5173');
      expect(res.headers['Access-Control-Allow-Methods']).toContain('POST');
      expect(res.headers['Access-Control-Allow-Headers']).toContain('Content-Type');
      expect(res.headers['Access-Control-Max-Age']).toBe('86400');
      expect(res.ended).toBe(true);
    });

    it('arkweb:// origin 的 OPTIONS 请求也应通过 (ArkWeb rawfile 协议)', () => {
      const req = {
        method: 'OPTIONS',
        headers: { origin: 'arkweb://rawfile/index.html' },
      };
      const res = makeMockRes();
      proxyModule.corsMiddleware(req, res);

      expect(res.statusCode).toBe(204);
      expect(res.headers['Access-Control-Allow-Origin']).toBe('arkweb://rawfile/index.html');
    });

    it('非白名单 origin 的 OPTIONS 请求: 仍 204 (不阻塞, 但 Allow-Origin 回退到 *)', () => {
      const req = {
        method: 'OPTIONS',
        headers: { origin: 'https://evil.com' },
      };
      const res = makeMockRes();
      proxyModule.corsMiddleware(req, res);

      expect(res.statusCode).toBe(204);
      expect(res.headers['Access-Control-Allow-Origin']).toBe('*');
    });
  });

  // ----------- T01.10: corsMiddleware — 实际请求 -----------

  describe('T01.10 corsMiddleware — 实际 GET/POST 请求设置 CORS 头 + 调用 next', () => {
    it('POST 请求: 设置 CORS 头 + 调用 next (不结束响应)', () => {
      const req = {
        method: 'POST',
        headers: { origin: 'http://localhost:3001' },
      };
      const res = makeMockRes();
      const next = vi.fn();
      proxyModule.corsMiddleware(req, res, next);

      expect(res.statusCode).toBe(200);
      expect(res.headers['Access-Control-Allow-Origin']).toBe('http://localhost:3001');
      expect(res.headers['Access-Control-Allow-Credentials']).toBe('true');
      expect(res.headers['Vary']).toBe('Origin');
      expect(res.ended).toBe(false);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('无 Origin 头的请求: 仍调用 next (CORS 头设置 Allow-Origin: *)', () => {
      const req = { method: 'GET', headers: {} };
      const res = makeMockRes();
      const next = vi.fn();
      proxyModule.corsMiddleware(req, res, next);

      expect(res.headers['Access-Control-Allow-Origin']).toBe('*');
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  // ----------- T01.11: handleLLMRequest — 缺少字段 -----------

  describe('T01.11 handleLLMRequest — 缺少 provider / prompt 返回 400', () => {
    it('缺少 provider 返回 400 MISSING_FIELDS', async () => {
      const req = makeMockReq({ prompt: 'hello' });
      const res = makeMockRes();
      await proxyModule.handleLLMRequest(req, res);
      expect(res.statusCode).toBe(400);
      expect(res.body).toMatchObject({ code: 'MISSING_FIELDS' });
    });

    it('缺少 prompt 返回 400 MISSING_FIELDS', async () => {
      const req = makeMockReq({ provider: 'openai' });
      const res = makeMockRes();
      await proxyModule.handleLLMRequest(req, res);
      expect(res.statusCode).toBe(400);
      expect(res.body).toMatchObject({ code: 'MISSING_FIELDS' });
    });

    it('body 为空对象 返回 400 MISSING_FIELDS', async () => {
      const req = makeMockReq({});
      const res = makeMockRes();
      await proxyModule.handleLLMRequest(req, res);
      expect(res.statusCode).toBe(400);
      expect(res.body).toMatchObject({ code: 'MISSING_FIELDS' });
    });

    it('body 为 null/undefined (req.body 缺失) 返回 400', async () => {
      const req1 = makeMockReq(null);
      const req2 = makeMockReq(undefined);
      const res1 = makeMockRes();
      const res2 = makeMockRes();
      await proxyModule.handleLLMRequest(req1, res1);
      await proxyModule.handleLLMRequest(req2, res2);
      expect(res1.statusCode).toBe(400);
      expect(res2.statusCode).toBe(400);
    });
  });

  // ----------- T01.12: handleLLMRequest — 缺少 API key -----------

  describe('T01.12 handleLLMRequest — 服务端未配置 API key 返回 500', () => {
    it('provider=openai 但无 OPENAI_API_KEY 返回 500 MISSING_API_KEY', async () => {
      const req = makeMockReq({ provider: 'openai', prompt: 'hello' });
      const res = makeMockRes();
      await proxyModule.handleLLMRequest(req, res);
      expect(res.statusCode).toBe(500);
      expect(res.body).toMatchObject({
        code: 'MISSING_API_KEY',
        provider: 'openai',
      });
    });

    it('provider=anthropic 但无 ANTHROPIC_API_KEY 返回 500 MISSING_API_KEY', async () => {
      const req = makeMockReq({ provider: 'anthropic', prompt: 'hello' });
      const res = makeMockRes();
      await proxyModule.handleLLMRequest(req, res);
      expect(res.statusCode).toBe(500);
      expect(res.body).toMatchObject({ provider: 'anthropic' });
    });

    it('provider=deepseek 但无 DEEPSEEK_API_KEY 返回 500 MISSING_API_KEY', async () => {
      const req = makeMockReq({ provider: 'deepseek', prompt: 'hello' });
      const res = makeMockRes();
      await proxyModule.handleLLMRequest(req, res);
      expect(res.statusCode).toBe(500);
      expect(res.body).toMatchObject({ provider: 'deepseek' });
    });
  });

  // ----------- T01.13: handleLLMRequest — 不支持的 provider -----------

  describe('T01.13 handleLLMRequest — 不支持的 provider 返回 400', () => {
    it('provider=kimi (已下线) 返回 400 UNSUPPORTED_PROVIDER', async () => {
      // 注: handleLLMRequest 先检查 API key (process.env.KIMI_API_KEY), 再检查 providerMap.
      // 设置一个假 KIMI_API_KEY 让它通过 key 检查, 触发 UNSUPPORTED_PROVIDER.
      process.env.KIMI_API_KEY = 'fake-key-for-test';
      const req = makeMockReq({ provider: 'kimi', prompt: 'hello' });
      const res = makeMockRes();
      await proxyModule.handleLLMRequest(req, res);
      expect(res.statusCode).toBe(400);
      expect(res.body).toMatchObject({ code: 'UNSUPPORTED_PROVIDER' });
    });

    it('provider=qwen (已下线) 返回 400 UNSUPPORTED_PROVIDER', async () => {
      process.env.QWEN_API_KEY = 'fake-key-for-test';
      const req = makeMockReq({ provider: 'qwen', prompt: 'hello' });
      const res = makeMockRes();
      await proxyModule.handleLLMRequest(req, res);
      expect(res.statusCode).toBe(400);
      expect(res.body).toMatchObject({ code: 'UNSUPPORTED_PROVIDER' });
    });

    it('provider=unknownprovider 返回 400 UNSUPPORTED_PROVIDER', async () => {
      process.env.UNKNOWNPROVIDER_API_KEY = 'fake-key-for-test';
      const req = makeMockReq({ provider: 'unknownprovider', prompt: 'hello' });
      const res = makeMockRes();
      await proxyModule.handleLLMRequest(req, res);
      expect(res.statusCode).toBe(400);
      expect(res.body).toMatchObject({ code: 'UNSUPPORTED_PROVIDER' });
    });
  });

  // ----------- T01.14: handleLLMRequest — 速率限制 -----------

  describe('T01.14 handleLLMRequest — 速率限制触发返回 429', () => {
    it('同一 IP 连续 60 次请求后, 第 61 次返回 429 RATE_LIMIT', async () => {
      // 注: RATE_LIMIT = 60 (per minute per IP)
      // 用一个独特的 IP 避免与其他 test 共享计数 (模块内 requestCounts Map 是闭包级单例).
      const uniqueIp = '203.0.113.99'; // TEST-NET-3, 不会与 127.0.0.1 冲突

      // 先发 60 次 (都应被 MISSING_API_KEY 拦截, 但 rate limit 计数仍累加)
      for (let i = 0; i < 60; i++) {
        const req = makeMockReq(
          { provider: 'openai', prompt: 'ping' },
          { ip: uniqueIp }
        );
        const res = makeMockRes();
        await proxyModule.handleLLMRequest(req, res);
        // 前 60 次都应是 500 (MISSING_API_KEY), 不是 429
        expect(res.statusCode).not.toBe(429);
      }

      // 第 61 次应被 rate limit 拦截
      const req = makeMockReq(
        { provider: 'openai', prompt: 'ping' },
        { ip: uniqueIp }
      );
      const res = makeMockRes();
      await proxyModule.handleLLMRequest(req, res);
      expect(res.statusCode).toBe(429);
      expect(res.body).toMatchObject({ code: 'RATE_LIMIT' });
    });
  });

  // ----------- T01.15: 健康检查 endpoint (从 mockApp.get 提取 handler) -----------

  describe('T01.15 /health 健康检查 handler 行为', () => {
    it('返回 status: ok + service name + provider 配置状态', () => {
      // 从 mockApp.get 的调用记录里提取 /health handler
      const healthCall = sandbox.mockApp.get.mock.calls.find(
        (args) => args[0] === '/health'
      );
      expect(healthCall).toBeDefined();
      const healthHandler = healthCall![1] as (
        req: unknown,
        res: unknown
      ) => void;

      // 设置 API key 后调用
      process.env.DEEPSEEK_API_KEY = 'sk-test-deepseek';
      const req = { headers: {} };
      const res = makeMockRes();
      healthHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body).toMatchObject({
        status: 'ok',
        service: 'wordaydream-harmony-llm-proxy',
      });
      // providers 字段反映 API key 配置
      expect(res.body).toHaveProperty('providers.openai', false);
      expect(res.body).toHaveProperty('providers.anthropic', false);
      expect(res.body).toHaveProperty('providers.deepseek', true);
    });
  });
});
