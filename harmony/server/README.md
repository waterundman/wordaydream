# Wordaydream Harmony LLM Proxy (Stage 4 独立部署)

> **版本**: v0.1.0-harmony Stage 4
> **作用**: 脱离 Netlify Edge Function, 为鸿蒙 ArkWeb 提供独立 LLM 代理服务
> **位置**: `harmony/server/llm-proxy.js`

本目录是 Wordaydream 鸿蒙移动版的独立 LLM Proxy 服务, 与项目根 `server/llm-proxy.js` 平行, 不依赖项目根 `package.json` 的依赖. 专为 ArkWeb 部署场景设计, 也兼容标准浏览器 / Node.js 客户端.

---

## 1. 与项目根 server/llm-proxy.js 的区别

| 维度 | 项目根 `server/llm-proxy.js` | `harmony/server/llm-proxy.js` (本目录) |
|---|---|---|
| 部署目标 | PM2 / 自管 Node.js | 华为云 FunctionGraph / DevEco 内嵌 / 独立 PM2 |
| 路由 | `POST /api/llm-proxy` | `POST /api/llm` + `POST /api/llm-proxy` (别名) |
| 响应模式 | JSON only | JSON + SSE 双模式 (支持 `stream: true`) |
| CORS | 通配符 (`cors()`) | 显式白名单 (ArkWeb origin) |
| 依赖 | 项目根 `package.json` | 本目录 `package.json` (独立) |
| 部署文档 | 项目根 README | `deploy-huaweicloud-functiongraph.md` (本目录) |

> 注: 项目根 `server/llm-proxy.js` 保持不变 (Web 端继续使用), 本目录是鸿蒙 Stage 4 新增的独立版本.

---

## 2. 快速启动

### 2.1 安装依赖

```bash
cd harmony/server
npm install
```

### 2.2 配置环境变量

```bash
cp .env.example .env
# 编辑 .env, 填入至少一个 API key
```

`.env` 字段:

| 变量 | 必填 | 说明 |
|---|---|---|
| `OPENAI_API_KEY` | 至少一个 | OpenAI API key |
| `ANTHROPIC_API_KEY` | 至少一个 | Anthropic API key |
| `DEEPSEEK_API_KEY` | 至少一个 | DeepSeek API key |
| `PORT` | 否 | 监听端口 (默认 3001) |
| `CORS_ALLOWED_ORIGINS` | 否 | 附加允许的 CORS origin (逗号分隔) |

### 2.3 启动服务

```bash
# 直接启动
node llm-proxy.js

# 或 npm script
npm start

# 开发模式 (文件变化自动重启)
npm run dev
```

预期输出:

```
[Harmony LLM Proxy] 服务已启动: http://localhost:3001
[Harmony LLM Proxy] 健康检查: http://localhost:3001/health
[Harmony LLM Proxy] 主路由: POST http://localhost:3001/api/llm
[Harmony LLM Proxy] CORS 允许: localhost / 127.0.0.1 / arkweb:// / *.hapogo.com / file://
[Harmony LLM Proxy] 已配置的 provider:
  - deepseek ✓
```

### 2.4 健康检查

```bash
curl http://localhost:3001/health
# {"status":"ok","timestamp":...,"service":"wordaydream-harmony-llm-proxy","providers":{...}}
```

---

## 3. API 接口

### 3.1 POST /api/llm (JSON 模式)

**请求**:

```json
POST /api/llm
Content-Type: application/json

{
  "provider": "deepseek",
  "prompt": "Explain photosynthesis",
  "system": "You are a helpful tutor.",
  "temperature": 0.7,
  "maxTokens": 2048,
  "expectJson": false,
  "language": "en",
  "stream": false
}
```

**响应** (200 OK):

```json
{
  "text": "Photosynthesis is ...",
  "model": "deepseek-chat",
  "usage": { "inputTokens": 12, "outputTokens": 150 },
  "language": "en"
}
```

### 3.2 POST /api/llm (SSE 模式)

**请求** (含 `stream: true`):

```json
{
  "provider": "openai",
  "prompt": "Tell me a story",
  "stream": true
}
```

**响应** (200 OK, `Content-Type: text/event-stream`):

```
data: {"delta":"Once","model":"gpt-4o-mini"}

data: {"delta":" upon","model":"gpt-4o-mini"}

data: {"delta":" a","model":"gpt-4o-mini"}

data: [DONE]
```

### 3.3 POST /api/llm-proxy (别名)

与 `/api/llm` 完全一致, 用于与项目根 `server/llm-proxy.js` 的 URL 兼容.

### 3.4 错误响应

| Status | Code | 说明 |
|---|---|---|
| 400 | `MISSING_FIELDS` | 缺少 `provider` / `prompt` |
| 400 | `UNSUPPORTED_PROVIDER` | provider 不在 openai/anthropic/deepseek |
| 429 | `RATE_LIMIT` | 速率限制 (每分钟 60 次/IP) |
| 500 | `MISSING_API_KEY` | 服务端未配置对应 provider 的 API key |
| 500 | `PROVIDER_ERROR` | 上游 LLM API 调用失败 |

---

## 4. CORS 配置

允许的 origin (白名单):

- `http://localhost:*` / `http://127.0.0.1:*` (本地调试)
- `arkweb://*` (ArkWeb rawfile / resource 协议)
- `https://*.hapogo.com` (生产域名, 支持子域)
- `file://` (本地文件协议)

附加 origin 通过 `CORS_ALLOWED_ORIGINS` 环境变量配置 (逗号分隔).

OPTIONS 预检返回 204 + 标准 CORS 头.

---

## 5. 与 ArkWeb 的集成

### 5.1 前端配置

鸿蒙构建 (`npm run build:harmony`) 时, `vite.config.ts` 会从 `.env.harmony` 读取
`VITE_LLM_PROXY_URL_HARMONY`, 注入为前端的 `VITE_LLM_PROXY_URL`. 前端代码通过
`import.meta.env.VITE_LLM_PROXY_URL` 访问代理 URL, 与 Web 端代码完全一致, 0 改动.

`.env.harmony.example` 模板:

```
VITE_LLM_PROXY_URL_HARMONY=https://dev-proxy.example.com/api/llm
```

### 5.2 ArkWeb 跨域

ArkWeb 页面使用 `https://app.wordaydream.invalid` 虚拟同源入口。Harmony 构建只接受
证书有效、设备可访问的 HTTPS 代理地址，并把该 origin 注入 CSP。开发机上的 HTTP
服务需要放到受信任的 HTTPS 反向代理或隧道后面；不要放宽 ArkWeb MixedMode。

### 5.3 真机调试 IP

DevEco 真机调试时，把 `VITE_LLM_PROXY_URL_HARMONY` 改为设备可访问的 HTTPS 地址：

```
VITE_LLM_PROXY_URL_HARMONY=https://dev-proxy.example.com/api/llm
```

(不要用 `localhost`, 真机的 localhost 指向设备本身, 不是开发机.)

---

## 6. 部署

### 6.1 PM2 (推荐, 自管服务器)

```bash
npm install -g pm2
cd harmony/server
npm install
pm2 start llm-proxy.js --name wordaydream-harmony-proxy
pm2 save
pm2 startup
```

### 6.2 Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY . .
EXPOSE 3001
CMD ["node", "llm-proxy.js"]
```

### 6.3 华为云 FunctionGraph

详见 `deploy-huaweicloud-functiongraph.md`.

---

## 7. 测试

### 7.1 手动 curl 测试

```bash
# 健康检查
curl http://localhost:3001/health

# JSON 模式
curl -X POST http://localhost:3001/api/llm \
  -H 'Content-Type: application/json' \
  -d '{"provider":"deepseek","prompt":"ping","maxTokens":5}'

# SSE 模式
curl -X POST http://localhost:3001/api/llm \
  -H 'Content-Type: application/json' \
  -H 'Accept: text/event-stream' \
  -d '{"provider":"deepseek","prompt":"Tell me a story","stream":true}' \
  --no-buffer
```

### 7.2 自动化测试 (项目根)

LLM Proxy 启动 + CORS 头验证测试位于:

```
src/__integration__/harmony-llm-proxy.test.ts
```

运行:

```bash
# 在项目根目录
npm run test:run -- harmony-llm-proxy
```

---

## 8. 安全约束

- API key 仅由后端 `process.env` 持有, 前端 (ArkWeb) 永远不接触 key
- 不记录 API key 到日志
- 速率限制: 每分钟 60 次/IP (内存计数器, 进程重启清零)
- CORS 白名单: 仅允许 ArkWeb origin + 显式配置域名
- 推荐 nginx 反向代理 + HTTPS + 鉴权头 (生产环境)

---

## 9. 与 Stage 进度的对应关系

| Stage | 涉及本目录的改动 |
|---|---|
| **Stage 4** (本期) | 创建独立 LLM Proxy, 脱离 Netlify Edge Function |
| Stage 5 | 接入华为云 FunctionGraph 部署 (CI/CD) |
| Stage 6 | 接入华为云 APIG 网关 + 鉴权 (生产环境) |

---

## 10. 参考

- 项目根 `server/llm-proxy.js` (原始版本, Web 端使用)
- 项目根 `docs/ARCHITECTURE.md` §LLM 集成
- 华为云 FunctionGraph 部署: `deploy-huaweicloud-functiongraph.md`
- 鸿蒙工程总览: `harmony/README.md`
