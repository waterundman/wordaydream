# 华为云 FunctionGraph 部署适配 (Harmony LLM Proxy)

> **目标**: 把 `harmony/server/llm-proxy.js` 部署到华为云 FunctionGraph, 作为鸿蒙 ArkWeb 的生产 LLM 代理.
> **场景**: 鸿蒙 HAP 包发布到 AppGallery 后, 通过 FunctionGraph 提供 LLM 推理服务.

本文件给出三种部署路径, 按推荐程度排序.

---

## 1. 路径 A — 自管服务器 + PM2 (推荐, 成本最低)

适用: 个人开发者 / 小规模用户 (< 100 QPS).

### 1.1 准备

- 一台云服务器 (华为云 ECS / 阿里云 ECS / 自管 VPS, 2C4G 起步)
- Node.js 18+ (推荐 20 LTS)
- 公网 IP + 域名 (可选, 推荐配置 HTTPS)

### 1.2 部署步骤

```bash
# 1. 拉代码
git clone <repo> wordaydream
cd wordaydream/harmony/server

# 2. 安装依赖
npm install --production

# 3. 配置 .env
cp .env.example .env
vim .env  # 填入 OPENAI_API_KEY / DEEPSEEK_API_KEY / ANTHROPIC_API_KEY

# 4. PM2 启动
npm install -g pm2
pm2 start llm-proxy.js --name wordaydream-harmony-proxy
pm2 save
pm2 startup  # 开机自启

# 5. (可选) nginx 反向代理 + HTTPS
# nginx.conf 示例:
# location /api/llm {
#   proxy_pass http://127.0.0.1:3001;
#   proxy_set_header Host $host;
#   proxy_set_header X-Real-IP $remote_addr;
#   proxy_buffering off;  # SSE 必须
#   proxy_cache off;
# }
```

### 1.3 验证

```bash
curl https://your-domain.com/health
# {"status":"ok",...}
```

---

## 2. 路径 B — 华为云 FunctionGraph (Serverless)

适用: 中等规模 / 按量付费 / 无需运维服务器.

### 2.1 前置概念

华为云 FunctionGraph 是 Serverless 函数计算服务, 与 AWS Lambda / 阿里云 FC 类似.
它支持两种运行模式:
- **事件函数**: 由 APIG / OBS / Kafka 等触发, 接收 JSON 事件
- **HTTP 函数**: 直接暴露 HTTP 端点, 接收标准 HTTP 请求

LLM Proxy 需要 **HTTP 函数** 模式, 因为要处理 CORS 预检 / SSE 流.

### 2.2 创建函数

1. 登录 [华为云 FunctionGraph 控制台](https://console.huaweicloud.com/functiongraph)
2. 创建函数:
   - 函数类型: **HTTP 函数**
   - 运行时: **Node.js 18.x** (或更高)
   - 内存: 512 MB (LLM 调用是 IO 密集, 不需要大内存)
   - 超时: 60s (LLM 响应较慢, 不要低于 30s)
   - 执行超时: 60s
3. 上传代码包:
   - 把 `harmony/server/` 目录打包为 zip (含 `llm-proxy.js` + `package.json` + `node_modules/`)
   - 或使用 OBS 对象存储 + 函数拉取

### 2.3 入口适配

FunctionGraph HTTP 函数的入口签名是 `(event, context)`, 不是 express app.
需要在 `llm-proxy.js` 之外创建一个 `fg-handler.js` 适配层:

```javascript
// harmony/server/fg-handler.js (本文件需手动创建, 不在 Stage 4 仓库内)
import app from './llm-proxy.js';

export async function handler(event, context) {
  // FunctionGraph HTTP 函数 event 结构:
  // {
  //   httpMethod: 'POST',
  //   path: '/api/llm',
  //   headers: {...},
  //   body: '...',
  //   isBase64Encoded: false
  // }
  const method = event.httpMethod || 'GET';
  const path = event.path || '/';
  const headers = event.headers || {};
  const body = event.body ? JSON.parse(event.body) : {};

  // 模拟 express req/res
  const req = {
    method,
    path,
    headers,
    body,
    ip: headers['x-real-ip'] || headers['x-forwarded-for'] || '0.0.0.0',
    socket: { remoteAddress: '0.0.0.0' },
  };

  let responsePayload = null;
  let responseStatus = 200;
  let responseHeaders = { 'Content-Type': 'application/json' };

  const res = {
    status(code) { responseStatus = code; return this; },
    setHeader(key, value) { responseHeaders[key] = value; return this; },
    json(data) { responsePayload = JSON.stringify(data); return this; },
    end(data) { responsePayload = data ?? ''; return this; },
    write(chunk) {
      if (!responsePayload) responsePayload = '';
      responsePayload += chunk;
      return this;
    },
    flushHeaders() { return this; },
  };

  // 找到匹配的路由 handler
  // 这里简化为直接调 handleLLMRequest (从 llm-proxy.js 导出)
  // 注: SSE 模式在 FunctionGraph HTTP 函数下不完整支持 (无 chunked 流),
  //     生产环境推荐用路径 A (PM2 + nginx) 或路径 C (APIG + ECS).
  if (path === '/api/llm' || path === '/api/llm-proxy') {
    const { handleLLMRequest } = await import('./llm-proxy.js');
    await handleLLMRequest(req, res);
  } else if (path === '/health') {
    responsePayload = JSON.stringify({
      status: 'ok',
      timestamp: Date.now(),
      service: 'wordaydream-harmony-llm-proxy',
      providers: {
        openai: Boolean(process.env.OPENAI_API_KEY),
        anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
        deepseek: Boolean(process.env.DEEPSEEK_API_KEY),
      },
    });
  } else {
    responseStatus = 404;
    responsePayload = JSON.stringify({ error: 'Not Found' });
  }

  return {
    statusCode: responseStatus,
    headers: responseHeaders,
    body: responsePayload,
    isBase64Encoded: false,
  };
}

export default handler;
```

> 注: `fg-handler.js` 适配层需要部署时手动创建, Stage 4 仓库不预置 (避免误以为已部署就绪).
> SSE 流模式在 FunctionGraph HTTP 函数下不完整支持, 推荐用路径 A 或 C.

### 2.4 配置环境变量

在 FunctionGraph 控制台 → 函数详情 → 配置 → 环境变量, 添加:

| Key | Value |
|---|---|
| `OPENAI_API_KEY` | sk-... |
| `ANTHROPIC_API_KEY` | sk-ant-... |
| `DEEPSEEK_API_KEY` | sk-... |
| `CORS_ALLOWED_ORIGINS` | https://your-hapogo-subdomain.hapogo.com |

### 2.5 配置 APIG 触发器

1. 函数详情 → 触发器 → 创建触发器
2. 类型: **APIG (API 网关)**
3. API 名称: `wordaydream-llm-proxy`
4. 分组: 选择已有分组或新建
5. 路径: `/api/llm` (与代码一致)
6. 方法: `POST` + `OPTIONS` (CORS 预检)
7. 安全认证: **App 认证** (推荐) 或 **IAM 认证** 或 **无认证** (开发期)

### 2.6 验证

```bash
# FunctionGraph 控制台 → 触发器 → 复制调用 URL
curl -X POST https://{apig-endpoint}/api/llm \
  -H 'Content-Type: application/json' \
  -d '{"provider":"deepseek","prompt":"ping","maxTokens":5}'
```

### 2.7 SSE 限制

FunctionGraph HTTP 函数对 SSE 流式响应支持有限:
- 函数返回时一次性把整个 body 返回给 APIG
- APIG 把 body 透传给客户端, 但 `Content-Type: text/event-stream` 不会真的流式推送
- **结论**: SSE 模式在 FunctionGraph 下退化为 JSON 一次性返回

如需真实 SSE 流, 推荐路径 A (PM2 + nginx `proxy_buffering off`) 或路径 C (ECS + APIG 直连).

---

## 3. 路径 C — 华为云 ECS + APIG 网关 (生产推荐)

适用: 大规模 / 高可用 / 需要真实 SSE 流.

### 3.1 架构

```
客户端 (ArkWeb)
  ↓ HTTPS
华为云 APIG (鉴权 + 限流 + 监控)
  ↓ HTTP (内网)
华为云 ECS (Node.js + PM2, 多实例)
  ↓ HTTPS
上游 LLM API (OpenAI / Anthropic / DeepSeek)
```

### 3.2 部署步骤

1. 创建 ECS (2C4G+, 推荐 4C8G)
2. 安装 Node.js 20 + PM2
3. 拉代码 + `npm install`
4. 配置 `.env` (API keys + CORS_ALLOWED_ORIGINS)
5. PM2 启动 `llm-proxy.js`
6. 创建 APIG 实例:
   - 入口: `https://api.your-domain.com/api/llm`
   - 后端: `http://<ecs-private-ip>:3001/api/llm`
   - 后端协议: HTTP
   - 后端超时: 60s
   - 限流策略: 1000 QPS / per IP
   - 鉴权: App 签名 (鸿蒙端在 HAP 内嵌签名密钥)
7. (可选) 配置 APIG 自定义域名 + HTTPS 证书

### 3.3 SSE 配置

APIG 网关默认会缓冲响应, SSE 流需要:
- APIG 控制台 → API 详情 → 高级配置 → 关闭"响应缓冲"
- 或在 APIG API 配置中设置 `X-Accel-Buffering: no` 头 (本服务已自动添加)

---

## 4. 监控与日志

### 4.1 日志

LLM Proxy 通过 `console.log` 输出运行日志, 生产环境建议:

- **PM2 模式**: `pm2 logs wordaydream-harmony-proxy` + `pm2 install pm2-logrotate`
- **FunctionGraph 模式**: 函数详情 → 监控 → 日志 ( LTS 日志流)
- **ECS 模式**: nginx access log + PM2 应用日志 + (可选) ELK / Loki

### 4.2 关键指标

- 健康检查 QPS: `/health` 调用频率 (可用 UptimeRobot / 华为云 APM)
- 错误率: 4xx / 5xx 比例
- 平均响应延迟: LLM 上游延迟 + 网络延迟
- Provider 健康度: 每个 provider 的成功率 (通过日志统计)

### 4.3 告警

- 5xx 错误率 > 5% 持续 5 分钟
- 健康检查连续 3 次失败
- 上游 LLM API 持续 429 (配额耗尽)

---

## 5. 成本估算

| 路径 | 月成本 (低用量) | 月成本 (中用量) | 适用 |
|---|---|---|---|
| A. 自管服务器 | $5 (1C2G VPS) | $20 (2C4G) | 个人 / 小规模 |
| B. FunctionGraph | ¥0 (免费额度) | ¥50-200 | 中等 / 按量 |
| C. ECS + APIG | ¥100 (ECS) + ¥30 (APIG) | ¥300-800 | 生产 / 大规模 |

注: 实际成本取决于流量 / 配置 / 区域, 仅供量级参考.

---

## 6. 常见问题

### Q1: FunctionGraph 部署后 SSE 不流式

A: 见 §2.7. FunctionGraph HTTP 函数不支持真实 SSE 流. 改用路径 A 或 C, 或前端关闭 streaming 模式 (`stream: false`).

### Q2: ArkWeb 跨域被拒绝

A: 检查 `CORS_ALLOWED_ORIGINS` 是否包含 ArkWeb 实际 origin. 真机调试时可用 `console.log(req.headers.origin)` 打印实际 origin. arkweb:// 协议的 origin 可能带路径 (`arkweb://rawfile/`), 本服务的正则已兼容.

### Q3: APIG 504 超时

A: LLM 上游响应慢 (> 60s). 解决:
- APIG 后端超时调到 60s (FunctionGraph 函数超时也调到 60s)
- 降低 `maxTokens` (例如从 2048 调到 1024)
- 升级上游 LLM 模型 (gpt-4o-mini 比 gpt-4o 快)

### Q4: 部署后 OPTIONS 预检失败

A: FunctionGraph 默认不处理 OPTIONS. 解决:
- APIG 控制台 → API 详情 → 跨域配置 → 启用 CORS
- 或在 fg-handler.js 内显式处理 OPTIONS (返回 204 + CORS 头)

### Q5: 速率限制不够

A: 内存计数器在多实例下不共享. 生产环境推荐:
- APIG 限流策略 (按 IP / 按 App)
- Redis 分布式速率限制 (路径 C, ECS 多实例时)

---

## 7. 参考

- 华为云 FunctionGraph 文档: https://support.huaweicloud.com/functiongraph/
- 华为云 APIG 文档: https://support.huaweicloud.com/apig/
- 华为云 ECS 文档: https://support.huaweicloud.com/ecs/
- 本服务源码: `harmony/server/llm-proxy.js`
- 部署 README: `harmony/server/README.md`
