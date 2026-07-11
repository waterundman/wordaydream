---
title: LLM Router 配置全规格指南
tags:
  - llm-router
  - openrouter
  - provider
  - api-config
  - token-plan
aliases:
  - LLM路由
  - 大模型路由配置
  - provider配置
cssclasses:
  - wide-page
---

# LLM Router 配置全规格指南

## 概述

LLM Router 是统一的大模型 API 网关层，聚合多个模型提供商的 API，提供统一的接口规范、智能路由、故障转移和成本优化。核心需求包括：

- 各厂商 Provider 配置与兼容协议
- 统一的 API 调用规范
- 模型名称的同步更新
- Token 计费计划管理
- 路由策略（成本优先 / 速度优先 / 可用性优先）

---

## Provider 厂商完整目录

### 国际厂商

| 厂商 | API Base URL | 兼容协议 | Auth 方式 | 特色 |
|------|-------------|----------|----------|------|
| **OpenAI** | `https://api.openai.com/v1` | OpenAI Chat Completions | `Authorization: Bearer sk-*` | GPT-5.5 / GPT-5 / o3 / o4-mini |
| **Anthropic** | `https://api.anthropic.com/v1` | Anthropic Messages / OpenAI(partial) | `x-api-key: sk-ant-*` | Claude Opus 4.7 / Sonnet 4.5 / Haiku |
| **Google Gemini** | `https://generativelanguage.googleapis.com/v1beta` | Google AI / OpenAI(partial) | `API_KEY` query param | Gemini 3.5 Pro / Flash, Gemma 4 |
| **DeepSeek** | `https://api.deepseek.com` | OpenAI compatible + Anthropic compatible | `Authorization: Bearer sk-*` | DeepSeek V4 Flash/Pro, V3.2 |
| **xAI Grok** | `https://api.x.ai/v1` | OpenAI compatible | `Authorization: Bearer xai-*` | Grok 4.3, Grok 4 |
| **Mistral AI** | `https://api.mistral.ai/v1` | OpenAI compatible | `Authorization: Bearer *` | Mistral Large 4, Codestral, Pixtral |
| **Meta Llama** | (via providers) | 需通过 AWS/Azure/OpenRouter 等 | 平台认证 | Llama 4 系列 |
| **Ollama** | `http://localhost:11434/v1` | OpenAI compatible | 无需认证（本地） | 本地运行开源模型 |
| **Cohere** | `https://api.cohere.com/v1` | Cohere native / OpenAI(partial) | `Authorization: Bearer *` | Command R+, Embed 系列 |
| **Together AI** | `https://api.together.xyz/v1` | OpenAI compatible | `Authorization: Bearer *` | 开源模型托管 |

### 国内厂商

| 厂商                 | API Base URL                                                                           | 兼容协议                          | Auth 方式                             | 特色                                                                     |
| ------------------ | -------------------------------------------------------------------------------------- | ----------------------------- | ----------------------------------- | ---------------------------------------------------------------------- |
| **通义千问 (Qwen)**    | `https://dashscope.aliyuncs.com/compatible-mode/v1`                                    | OpenAI compatible             | `Authorization: Bearer sk-*`        | Qwen3.5 系列（397B/122B/35B/9B/4B），Qwen3-Omni                             |
| **智谱 (GLM)**       | `https://open.bigmodel.cn/api/paas/v4`                                                 | OpenAI compatible             | `Authorization: Bearer *`           | GLM-5.1, GLM-4.7, GLM-4.6V(多模态)                                        |
| **月之暗面 (Kimi)**    | `https://api.moonshot.cn/v1`                                                           | OpenAI compatible             | `Authorization: Bearer sk-*`        | Kimi K2.6，长上下文 262K                                                    |
| **Minimax**        | `https://api.minimax.chat/v1`                                                          | OpenAI compatible             | `Authorization: Bearer *`           | MiniMax-01, MiniMax-VL                                                 |
| **DeepSeek**       | `https://api.deepseek.com`                                                             | OpenAI + Anthropic compatible | `Authorization: Bearer sk-*`        | V4 Flash/Pro，1M context                                                |
| **Mimo (小米 MiMo)** | `https://api.mimo-v2.com/v1`（OpenAI）<br>`https://api.mimo-v2.com/anthropic`（Anthropic） | OpenAI + Anthropic 双兼容        | `api-key` / `Authorization: Bearer` | MiMo-V2.5-Pro, V2.5, V2-Pro, V2-Omni, V2-Flash；1M context；旗舰级 Agent 模型 |
| **字节豆包 (Doubao)**  | `https://ark.cn-beijing.volces.com/api/v3`                                             | OpenAI compatible             | `Authorization: Bearer *`           | 字节跳动自研模型                                                               |
| **百度千帆 (Qianfan)** | `https://qianfan.baidubce.com/v2`                                                      | OpenAI compatible             | IAM / Bearer                        | ERNIE 4.5, CoBuddy                                                     |
| **讯飞星火 (Spark)**   | `https://spark-api.xf-yun.com/v3.5`                                                    | WebSocket / OpenAI(partial)   | `apiKey+apiSecret` 签名               | Spark 4.0                                                              |
|                    |                                                                                        |                               |                                     |                                                                        |

### 聚合路由厂商

| 路由服务 | API Base URL | 兼容协议 | 覆盖模型数 | 特色功能 |
|---------|-------------|----------|-----------|---------|
| **OpenRouter** | `https://openrouter.ai/api/v1` | OpenAI compatible | 315+ | 路由策略(price/throughput)、自动故障转移、BYOK、免费模型 |
| **SiliconFlow (硅基流动)** | `https://api.siliconflow.cn/v1` | OpenAI compatible | 100+ | 国内开源模型托管、推理优化、免费额度 |
| **OpenAI Responses API** | `https://api.openai.com/v1/responses` | Responses API | 全部 OpenAI | MCP 集成、WebSearch 工具、多步骤推理 |
| **Vercel AI SDK** | 项目配置 | OpenAI compatible | 聚合 | 前端 SDK + Edge Functions + 流式 |
| **Cloudflare AI Gateway** | `https://gateway.ai.cloudflare.com/v1` | OpenAI compatible | 聚合 | 缓存 + 限流 + 日志 |
| **Portkey** | `https://api.portkey.ai/v1` | OpenAI compatible | 聚合 | 可观测性 + 护栏 + 缓存 |

---

## OpenRouter 深度配置

### 基础接入

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key="<OPENROUTER_API_KEY>",
)

completion = client.chat.completions.create(
    extra_headers={
        "HTTP-Referer": "https://your-site.com",  # 可选，用于排名
        "X-Title": "Your App Name",               # 可选，用于排名
    },
    model="openai/gpt-5.5",
    messages=[{"role": "user", "content": "Hello"}]
)
```

### 模型命名规范

OpenRouter 使用 `provider/model` 格式命名模型：
- `openai/gpt-5.5`
- `anthropic/claude-opus-4.7`
- `google/gemini-3.5-flash`
- `deepseek/deepseek-v4-pro`
- `x-ai/grok-4.3`
- `moonshotai/kimi-k2.6`
- `z-ai/glm-5.1`
- `minimax/minimax-01`

### 路由策略

| 策略 | Header / 参数 | 行为 |
|------|-------------|------|
| 价格优先（默认） | `sort: "price"` | 自动选择 cheapest 可用供应商 |
| 速度优先 | `sort: "throughput"` | 自动选择最快供应商 |
| 自动降级 | `route: "fallback"` | 主供应商失败时自动切换 |
| BYOK | `provider: {"order": [...]}` | 使用自有 API Key，收取 5% 使用费 |
| Free 模型 | 模型名含 `:free` 后缀 | 免费但限制 50 请求/天 |

### Provider 路由控制（精细控制）

OpenRouter 允许直接指定路由优先级：

```json
{
  "model": "deepseek/deepseek-v4-pro",
  "provider": {
    "order": ["DeepSeek", "Together", "Novita"],
    "allow_fallbacks": true
  }
}
```

---

## 主流 Provider API 配置对照

### OpenAI GPT 系列

```python
client = OpenAI(
    api_key="sk-...",
    base_url="https://api.openai.com/v1"
)
```
- 最新模型：gpt-5.5, gpt-5.4, o4-mini, o3
- 上下文：最高 1.1M tokens
- 定价参考：输入 $5/M tokens，输出 $30/M tokens (gpt-5.5)

### Anthropic Claude 系列

```python
import anthropic
client = anthropic.Anthropic(
    api_key="sk-ant-...",
)
```
或使用 OpenAI 兼容格式：
```python
client = OpenAI(
    api_key="sk-ant-...",
    base_url="https://api.anthropic.com/v1"
)
```
- 最新模型：claude-opus-4.7, claude-sonnet-4.5
- 上下文：最高 1M tokens（Prompt Caching 可大幅降价）
- 特色：Hooks 系统原生支持 30 个事件

### Google Gemini 系列

```python
import google.generativeai as genai
genai.configure(api_key="...")
```
或 OpenAI 兼容模式：
```python
client = OpenAI(
    api_key="...",
    base_url="https://generativelanguage.googleapis.com/v1beta/openapi/"
)
```
- 最新模型：gemini-3.5-pro, gemini-3.5-flash
- 特色：1M 上下文窗口，多模态原生

### DeepSeek 系列

```python
client = OpenAI(
    api_key="sk-...",
    base_url="https://api.deepseek.com"
)
```
亦兼容 Anthropic 协议：
```python
client = anthropic.Anthropic(
    api_key="sk-...",
    base_url="https://api.deepseek.com/anthropic"
)
```
- 最新模型：deepseek-v4-flash（免费可用）, deepseek-v4-pro
- 旧名（即将弃用 2026/07/24）：deepseek-chat, deepseek-reasoner
- 上下文：1M tokens
- 定价参考：V4 Pro 输入 $0.44/M，输出 $0.87/M tokens
- 推理模式：`thinking: {"type": "enabled"}` + `reasoning_effort: "high"|"max"`

---

### 智谱 (GLM) 系列

智谱 AI (Z.AI) 提供 GLM 系列模型，官方 OpenAI 兼容 API：

```python
from openai import OpenAI

client = OpenAI(
    api_key="<ZHIPU_API_KEY>",
    base_url="https://open.bigmodel.cn/api/paas/v4"  # 国内
    # 海外: https://api.z.ai/api/paas/v4
)
```

- 最新模型：GLM-5.1 (754B MoE, 198K ctx), GLM-5.0, GLM-4.7, GLM-4.6V (多模态)
- 免费模型：GLM-4.5-Flash（速度极快，适合开发测试）
- 上下文：GLM-5 最高 200K tokens
- 定价参考（2026年5月）：
  - GLM-5.1: 输入 ¥6/M tokens，输出 ¥28/M tokens
  - GLM-4.5-Flash: 免费
  - GLM-4.7: 输入 ¥1/M tokens，输出 ¥2/M tokens
- SDK：`pip install zai-sdk` 或使用 OpenAI SDK
- 特色：深度思考模式 `thinking: {"type": "enabled"}`，工具调用，流式输出
- 特性：`reasoning_content` 返回思考过程，`prompt_tokens_details.cached_tokens` 缓存计费

```python
# 思考模式示例
response = client.chat.completions.create(
    model="glm-4.7",
    messages=[{"role": "user", "content": "请分析..."}],
    thinking={"type": "enabled"}
)
# response.choices[0].message.reasoning_content 包含思考过程
```

### 通义千问 (Qwen) 系列 - 阿里云百炼

阿里云百炼平台提供 Qwen 全系列模型的 OpenAI 兼容 API：

```python
from openai import OpenAI

client = OpenAI(
    api_key="<DASHSCOPE_API_KEY>",
    base_url="https://dashscope.aliyuncs.com/compatible-mode/v1"
)
```

- 最新模型：Qwen3.5 Max (397B), Qwen3.5 Plus (122B), Qwen3.5-35B-A3B, Qwen3.5-9B, Qwen3.5-4B, Qwen3-Omni
- 上下文：Qwen3.5 Max 最高 262K tokens
- 定价参考（2026年5月）：
  - Qwen3.5 Max: 输入 $0.80/M，输出 $3.50/M (Plus: $0.40/$1.60)
  - Qwen3-Omni: 文本同 Plus 定价，视觉加收
- 特色：Qwen3-Omni 原生全模态（文本+图像+音频），Qwen3.5 VL 视觉理解
- 也通过阿里云百炼支持 MiniMax、Kimi 等第三方模型调用

### 月之暗面 (Kimi) 系列

Kimi 通过 Moonshot 开放平台提供 OpenAI 兼容 API：

```python
from openai import OpenAI

client = OpenAI(
    api_key="sk-...",
    base_url="https://api.moonshot.cn/v1"
)
```

或通过阿里云百炼调用（北京地域）：
```python
client = OpenAI(
    api_key="<DASHSCOPE_API_KEY>",
    base_url="https://dashscope.aliyuncs.com/compatible-mode/v1"
)
```

- 最新模型：Kimi K2.6 (1T MoE, 32B active, 256K ctx)
- 其他模型：Kimi K2.5, Moonshot V1 (128K)
- 定价参考（2026年5月）：
  - K2.6: 输入 $0.73~$0.95/M，输出 $3.40~$4.00/M（缓存 $0.16/M）
  - K2.5: 输入 $0.60/M，输出 $3.00/M
  - Moonshot V1: 输入 $2.00/M，输出 $5.00/M
- 特色：
  - 思考模式：`thinking: {"type": "enabled"}`（默认启用），关闭需 `{"type": "disabled"}`
  - 256K 上下文窗口，原生多模态（图片+视频输入），MoonViT 视觉编码器
  - Agent 能力：4000+ 工具调用，支持 300 子智能体并行协作
  - SWE-Bench Verified 80.2%，Terminal-Bench 66.7%
- 模型 ID：`kimi-k2.6`, `kimi-k2.5`, `moonshot-v1-128k`

### MiniMax 系列

MiniMax 同时提供 OpenAI 和 Anthropic 兼容 API：

```python
# OpenAI 兼容
client = OpenAI(
    api_key="<MINIMAX_API_KEY>",
    base_url="https://api.minimax.chat/v1"
)

# Anthropic 兼容（推荐，支持 thinking block）
import anthropic
client = anthropic.Anthropic(
    api_key="<MINIMAX_API_KEY>",
    base_url="https://api.minimax.chat/anthropic"
)
```

- 最新模型：MiniMax-M2.7 (205K ctx), MiniMax-M2.5 (197K ctx, 229B MoE)
- 其他模型：MiniMax-M2.1, MiniMax-M1, MiniMax-01 (1M ctx), MiniMax-M2-Her
- 定价参考（2026年5月）：
  - M2.7: 输入 $0.28/M，输出 $1.20/M（缓存 $0.06/M）
  - M2.5: 输入 $0.15/M，输出 $1.15/M（缓存 $0.03/M）
  - M2.1: 输入 $0.29/M，输出 $0.95/M
  - MiniMax-01 (1M ctx): 输入 $0.20/M，输出 $1.10/M
  - M1: 输入 $0.40/M，输出 $2.20/M
- 特色：默认思考模式（Anthropic 协议下返回 `thinking` block），工具调用，视觉
- 注意：M2.5 不支持 `thinking_budget`，思维链+回复共 32K
- Hailuo 视频生成（图生视频/文生视频）API 通过同平台提供

### xAI Grok 系列

xAI Grok 通过 OpenAI 兼容 API 提供：

```python
from openai import OpenAI

client = OpenAI(
    api_key="xai-...",
    base_url="https://api.x.ai/v1"
)
```

- 最新模型：Grok 4.3 (1M ctx), Grok 4.20 (2M ctx), Grok 4.20 Multi-Agent (2M ctx)
- 废弃说明：Grok 4.1 Fast, Grok 4, Grok Code Fast 1 已于 2026/05/15 废弃，自动重定向至 Grok 4.3
- 定价参考（2026年5月）：
  - Grok 4.3 / 4.20: 输入 $1.25/M，输出 $2.50/M（所有型号统一价位）
  - Grok 3 (旧存档): 输入 $3.00/M，输出 $15.00/M
- 特色：实时 X/Twitter 数据接入，2M 超长上下文（Grok 4.20），推理模式
- 模型 ID：`grok-4-0709`, `grok-4.3`, `grok-4.20`

### Mistral AI 系列

Mistral AI 通过 La Plateforme 提供 OpenAI 兼容 API：

```python
from openai import OpenAI

client = OpenAI(
    api_key="<MISTRAL_API_KEY>",
    base_url="https://api.mistral.ai/v1"
)
```

- 最新模型（2026年5月）：
  - Mistral Large 3 (675B, 262K ctx): 输入 $0.50/M，输出 $1.50/M
  - Mistral Medium 3.5 (256K ctx): 输入 $1.50/M，输出 $7.50/M
  - Mistral Small 4 (256K ctx): 输入 $0.15/M，输出 $0.60/M
  - Codestral (256K ctx): 输入 $0.20/M，输出 $0.60/M（代码专用，80+ 语言）
  - Devstral 2 (123B, 256K ctx): 输入 $0.40/M，输出 $2.00/M（代码智能体，SWE-bench 72.2%）
  - Ministral 3B/8B/14B: 边缘部署，3B 仅 $0.04/$0.04/M
  - Pixtral Large: 多模态旗舰，输入 $2.00/M，输出 $6.00/M
- 特色：GDPR 合规（法国公司），Apache 2.0/MIT 开源权重，Function Calling 能力突出
- 注意：旧版模型（Mistral Large 2407/2411, Codestral 旧版, Mistral Nemo）已废弃
- Le Chat 免费版：可有限使用 Large 2 模型

### Together AI

Together AI 是开源模型推理托管平台，完全兼容 OpenAI 格式：

```python
from openai import OpenAI

client = OpenAI(
    api_key="<TOGETHER_API_KEY>",
    base_url="https://api.together.xyz/v1"
)
```

- 定价模式：按 token 付费，通常比专有模型便宜 50-80%
- 托管模型示例（价格 per 1M tokens）：
  - GLM-5.1: 输入 $1.40，输出 $4.40
  - Llama 3.3 70B: ~$0.18（输入输出同价）
  - Qwen 2.5 Coder 32B: ~$0.20
  - DeepSeek V4 Pro: ~$0.44
  - Mistral 7B: $0.10
- 特色：FlashAttention-4 加速，Batch API 降 50% 成本，Fine-tuning 服务，GPU 集群
- 注册送 $1 体验金（无需绑卡），足够测试数百万 tokens

### Cohere

Cohere 提供企业级 RAG 和生成模型：

```python
import cohere

co = cohere.Client("<COHERE_API_KEY>")
# 或 OpenAI 兼容
client = OpenAI(
    api_key="<COHERE_API_KEY>",
    base_url="https://api.cohere.com/v1"
)
```

- 生成模型：
  - Command A: 旗舰模型，RAG + 工具调用
  - Command R+: 输入 $2.50/M，输出 $10.00/M (128K ctx)
  - Command R: 输入 $0.15/M，输出 $0.60/M (128K ctx)
  - Command R7B: 输入 $0.0375/M（最便宜）
- Embedding：Embed v3 Small/Base/Large: $0.02/$0.10/$0.30/M
- Rerank 3: $3.00/1K calls
- 特色：企业级 RAG 完整方案（Embed→Search→Rerank→Generate），多语言支持，SOC 2 合规
- 免费试用：1,000 calls/month 免费额度

### Ollama（本地模型）

Ollama 提供本地运行的 OpenAI 兼容 API：

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:11434/v1",
    api_key="ollama"  # 必填但本地不校验
)
```

- 常用模型：llama3.2, llama3.1, mistral, qwen2.5, gemma3, phi-4
- 特色：完全本地运行零成本，数据不出机器，支持 Vision/Embedding 模型和工具调用
- 端口默认 11434，可通过 `OLLAMA_HOST` 修改
- 适用：开发测试、隐私敏感场景、离线环境、成本敏感场景

### 字节豆包 (Doubao) - 火山引擎

字节跳动通过火山引擎方舟平台提供豆包系列模型的 OpenAI 兼容 API：

```python
from openai import OpenAI

client = OpenAI(
    api_key="<VOLCENGINE_API_KEY>",
    base_url="https://ark.cn-beijing.volces.com/api/v3"
)
```

- 注意：需要在火山引擎控制台创建推理接入点 (Endpoint)，获取 Endpoint ID 而非直接使用模型名
- 最新模型 Seed 2.0 系列（2026-02-14）：
  - doubao-seed-2.0-pro: 输入 $0.514/M，输出 $2.57/M
  - doubao-seed-2.0-code: 输入 $0.343/M，输出 $1.71/M
  - doubao-seed-2.0-lite: 输入 $0.129/M，输出 $0.64/M
  - doubao-seed-2.0-mini: 输入 $0.086/M，输出 $0.43/M
- 前代：Seed 1.6 flash: 输入 $0.022/M，输出 $0.219/M（最便宜）
- 上下文：全部 256K（Seed 系列）
- 特色：多模态理解、视觉推理、工具调用、JSON 输出、思考模式
- 额外能力：Seedream 图像生成、Seedance 视频生成、语音识别/合成
- 首次注册有免费额度

### 百度千帆 (Qianfan)

百度千帆提供文心 (ERNIE) 系模型 API，鉴权方式为 access_token：

```python
import requests

# 1. 获取 access_token
resp = requests.post(
    "https://aip.baidubce.com/oauth/2.0/token",
    params={
        "grant_type": "client_credentials",
        "client_id": "<API_KEY>",
        "client_secret": "<SECRET_KEY>"
    }
)
access_token = resp.json()["access_token"]

# 2. 调用 ERNIE（原生接口非 OpenAI 格式）
response = requests.post(
    f"https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-4.0-8k-latest?access_token={access_token}",
    json={"messages": [{"role": "user", "content": "你好"}]}
)
```

- 最新模型：ERNIE 5.1（2026-05-09，综合能力对标全球第一梯队）
- 其他模型：ERNIE 5.0, ERNIE 4.5, ERNIE X1.1（思考模型）, ERNIE-4.0-128K
- 免费模型（长期免费）：ERNIE-Speed-8K/128K, ERNIE-Lite-8K/128K, ERNIE-Tiny-8K
- 定价参考：ERNIE 4.0-8K ¥10/M tokens
- 特色：中文能力顶尖，百度搜索插件深度集成
- 注意：原生 API 非 OpenAI 格式，需通过 access_token 鉴权；第三方网关提供 OpenAI 兼容代理

### 讯飞星火 (Spark)

讯飞星火提供 WebSocket 原生协议 + OpenAI 兼容 HTTP API：

```python
# HTTP 方式（OpenAI 兼容，推荐）
from openai import OpenAI

client = OpenAI(
    api_key="<APIPassword>",  # 使用控制台的 APIPassword
    base_url="https://spark-api-open.xf-yun.com/v2"
)
# 版本与 endpoint 对应：
# Spark X2:  https://spark-api-open.xf-yun.com/v2
# Spark Ultra: https://spark-api-open.xf-yun.com/v4.0
# Spark Max:  https://spark-api-open.xf-yun.com/v3.5
# Spark Pro:  https://spark-api-open.xf-yun.com/v3.1
# Spark Lite: https://spark-api-open.xf-yun.com/v1.1
```

- 最新模型：Spark X2 (深度推理，¥2~3/M), Spark X2 Flash (¥1~2/M)
- 其他：Spark Ultra (高性价比), Spark Pro/Max, Spark Lite (免费)
- 特色：讯飞语音技术原生集成，Function Call 支持，联网搜索
- 鉴权方式：HTTP 用 APIPassword 做 Bearer Token；WebSocket 需 AppID+APIKey+APISecret 三重签名
- 注意：WebSocket 协议仍为主要调用方式，HTTP OpenAI 兼容接口为近年新增

### Mimo (小米 MiMo) 深度配置

小米 MiMo 支持 OpenAI + Anthropic 双协议：

```python
# OpenAI 协议
client = OpenAI(
    api_key="<MIMO_API_KEY>",
    base_url="https://api.mimo-v2.com/v1"
)

# Anthropic 协议
import anthropic
client = anthropic.Anthropic(
    api_key="<MIMO_API_KEY>",
    base_url="https://api.mimo-v2.com/anthropic"
)
```

- 模型列表：MiMo-V2.5-Pro (旗舰 Agent), V2.5, V2-Pro, V2-Omni, V2-Flash
- 定价参考：V2.5 Pro 输入 $1.00/M，输出 $3.00/M
- 上下文：1M tokens
- 特色：双协议兼容，Agent 能力突出，国内直连

### SiliconFlow (硅基流动) 深度配置

国内最大开源模型推理托管平台之一：

```python
from openai import OpenAI

client = OpenAI(
    api_key="<SILICONFLOW_API_KEY>",
    base_url="https://api.siliconflow.cn/v1"
)
```

- 注册赠送 14 元体验金（约 2000 万 tokens）
- 付费模型（价格 ¥/M tokens）：
  - DeepSeek-V4-Flash: 输入 ¥1，输出 ¥2
  - Kimi-K2.6 (Pro): 输入 ¥6.5，输出 ¥27
  - GLM-5.1 (Pro): 输入 ¥6，输出 ¥28
  - MiniMax-M2.5: 输入 ¥2.1，输出 ¥8.4
- 免费模型（15+）：DeepSeek-R1-Distill 系列，Qwen3-8B，GLM-4-9B，PaddleOCR-VL
- 模型 ID 格式：`provider/model_name`，加速版加 `Pro/` 前缀
- 特色：国内访问快速，部分模型免费，支持预留实例和私有化部署

---

## Token Plan 计费方案

| 方案 | 覆盖范围 | 特点 |
|------|---------|------|
| **OpenRouter Pay-as-you-go** | 315+ 模型 | 无月费，按 token 付费，充值后使用 |
| **Mimo Token Plan** | Mimo 自有+合作模型 | 企业批量购买，包月/包年 |
| **智谱 Token Plan** | GLM 全系列 | 预付费包，多档位选择 |
| **Minimax Token Plan** | MiniMax 全系列 | 按量计费+预付费包 |
| **OpenCode Go/Zen** | 75+ 提供商 | OpenCode 内置路由，聚合多种购买策略 |

### 定价对比（2026年5月，每百万 tokens 输入/输出）

| 模型 | 输入价格 | 输出价格 | 质量评分 |
|------|---------|---------|---------|
| OpenAI GPT-5.5 | $5.00 | $30.00 | 100 |
| Google Gemini 3.1 Pro | $2.00 | $12.00 | 95 |
| Claude Opus 4.7 | $5.00 | $25.00 | 95 |
| GPT-5.4 | $2.50 | $15.00 | 94 |
| Gemini 3.5 Flash | $1.50 | $9.00 | 92 |
| MiMo V2.5 Pro | $1.00 | $3.00 | 91 |
| Kimi K2.6 | $0.73 | $3.49 | 89 |
| Grok 4.3 | $1.25 | $2.50 | 88 |
| DeepSeek V4 Pro | $0.44 | $0.87 | 86 |
| DeepSeek V4 Flash | $0.14 | $0.28 | 82 |

---

## 多 Provider 路由架构最佳实践

### 策略一：OpenRouter 统一入口
```
App → OpenRouter (openrouter.ai/api/v1)
        ├── price 路由 → GPT-5.5 / Claude
        ├── throughput 路由 → DeepSeek / Gemini Flash
        └── fallback → 备用供应商
```

### 策略二：OpenCode 原生多 Provider
OpenCode 通过 AI SDK + Models.dev 原生支持 75+ LLM Provider：
```
/connect 添加 API Keys
    → opencode.json 中配置 provider 优先级
    → 自动分发到不同模型
```

### 策略三：自建路由层
```
App → 自建 Gateway (e.g. Cloudflare AI Gateway / Portkey)
        ├── 优先级 1: Anthropic Claude (核心任务)
        ├── 优先级 2: OpenAI GPT (通用任务)
        ├── 优先级 3: DeepSeek (成本敏感)
        └── 优先级 4: Ollama (本地备用)
```

### Provider 配置字段规范

完整的多 Provider 路由配置 schema：

```json5
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "LLM Router Provider Config",
  "type": "object",
  "properties": {
    "defaults": {
      "type": "object",
      "properties": {
        "strategy": { "type": "string", "enum": ["cost", "latency", "fallback", "manual"], "default": "fallback" },
        "timeout": { "type": "integer", "default": 30000 },
        "max_retries": { "type": "integer", "default": 2 }
      }
    },
    "providers": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["name", "base_url", "api_key_env", "models"],
        "properties": {
          "name": { "type": "string", "description": "Provider identifier" },
          "base_url": { "type": "string", "format": "uri" },
          "api_key_env": { "type": "string", "description": "Environment variable name for API key" },
          "auth_type": { "type": "string", "enum": ["bearer", "header", "query", "signed"], "default": "bearer" },
          "auth_header": { "type": "string", "default": "Authorization" },
          "compatibility": {
            "type": "array",
            "items": { "type": "string", "enum": ["openai", "anthropic", "cohere", "google"] }
          },
          "models": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["id"],
              "properties": {
                "id": { "type": "string" },
                "aliases": { "type": "array", "items": { "type": "string" } },
                "context_window": { "type": "integer" },
                "max_output": { "type": "integer" },
                "cost": {
                  "type": "object",
                  "properties": {
                    "input": { "type": "number", "description": "USD per 1M tokens" },
                    "output": { "type": "number" },
                    "cache_read": { "type": "number" },
                    "cache_write": { "type": "number" }
                  }
                },
                "features": {
                  "type": "object",
                  "properties": {
                    "streaming": { "type": "boolean" },
                    "thinking": { "type": "boolean" },
                    "tool_calls": { "type": "boolean" },
                    "structured_output": { "type": "boolean" },
                    "vision": { "type": "boolean" }
                  }
                }
              }
            }
          },
          "rate_limits": {
            "type": "object",
            "properties": {
              "rpm": { "type": "integer" },
              "tpm": { "type": "integer" },
              "rpd": { "type": "integer" }
            }
          },
          "routing": {
            "type": "object",
            "properties": {
              "priority": { "type": "integer" },
              "weight": { "type": "number", "minimum": 0, "maximum": 1 },
              "tags": { "type": "array", "items": { "type": "string" } }
            }
          },
          "health_check": {
            "type": "object",
            "properties": {
              "enabled": { "type": "boolean", "default": true },
              "interval": { "type": "integer", "default": 60 },
              "timeout": { "type": "integer", "default": 5 }
            }
          }
        }
      }
    }
  }
}
```

#### 配置实例：三层路由

```json5
{
  "strategy": "cost_first",
  "timeout": 30000,
  "max_retries": 2,
  "providers": [
    {
      "name": "anthropic",
      "base_url": "https://api.anthropic.com/v1",
      "api_key_env": "ANTHROPIC_API_KEY",
      "compatibility": ["anthropic", "openai"],
      "routing": { "priority": 1, "tags": ["core", "reasoning"] },
      "models": [
        { "id": "claude-opus-4.7", "cost": { "input": 5, "output": 25 } }
      ]
    },
    {
      "name": "openai",
      "base_url": "https://api.openai.com/v1",
      "api_key_env": "OPENAI_API_KEY",
      "compatibility": ["openai"],
      "routing": { "priority": 2, "tags": ["general", "vision"] },
      "models": [
        { "id": "gpt-5.5", "cost": { "input": 5, "output": 30 } },
        { "id": "o4-mini", "cost": { "input": 1.1, "output": 4.4 } }
      ]
    },
    {
      "name": "deepseek",
      "base_url": "https://api.deepseek.com",
      "api_key_env": "DEEPSEEK_API_KEY",
      "compatibility": ["openai", "anthropic"],
      "routing": { "priority": 3, "tags": ["cost", "thinking"] },
      "models": [
        { "id": "deepseek-v4-pro", "cost": { "input": 0.44, "output": 0.87 } },
        { "id": "deepseek-v4-flash", "cost": { "input": 0.14, "output": 0.28 } }
      ]
    },
    {
      "name": "ollama",
      "base_url": "http://localhost:11434/v1",
      "api_key_env": "NO_AUTH",
      "compatibility": ["openai"],
      "routing": { "priority": 4, "tags": ["local", "fallback"] },
      "models": [
        { "id": "llama3.2", "cost": { "input": 0, "output": 0 } }
      ]
    }
  ]
}
```

---

## 模型名称同步策略

模型更新频繁，建议：

1. **使用路由层模型 ID**（如 OpenRouter 的 `deepseek/deepseek-v4-pro`）而不是原始模型名
2. **监控 Deprecation 日期**：deepseek-chat/reasoner 将于 2026/07/24 废弃
3. **订阅各厂商 changelog**：
   - OpenAI: platform.openai.com/changelog
   - Anthropic: docs.anthropic.com/changelog
   - DeepSeek: api-docs.deepseek.com/updates
4. **使用 OpenCode 内置模型列表**自动获取最新模型名

---

## 常用 SDK/框架的 Provider 配置

| 框架 | 多 Provider 支持方式 | 配置文件 |
|------|-------------------|---------|
| OpenCode | `/connect` + `opencode.json` | 原生支持 75+ |
| Claude Code | `~/.claude/settings.json` | 支持 OpenRouter / 自定义 API |
| LangChain | `ChatOpenAI(base_url=...)` | 任意 OpenAI 兼容端点 |
| Vercel AI SDK | `createOpenAI({baseURL, apiKey})` | 任意 OpenAI 兼容端点 |
| Jupyter AI | 设置页选择 provider | `langchain-openai` 驱动 |
| Zed Editor | 设置 `llm_provider` | 支持 OpenAI / Anthropic / Ollama |

---

## Fallback 与高可用策略

### 模式一：顺序 Fallback（简单可靠）

```python
import time
from openai import OpenAI

FALLBACK_CHAIN = [
    {"name": "claude-opus-4.7", "base": "https://api.anthropic.com/v1", "timeout": 60},
    {"name": "gpt-5.5",         "base": "https://api.openai.com/v1",    "timeout": 30},
    {"name": "deepseek-v4-pro", "base": "https://api.deepseek.com",     "timeout": 30},
    {"name": "ollama",           "base": "http://localhost:11434/v1",   "timeout": 120},
]

def chat_with_fallback(messages, **kwargs):
    errors = []
    for provider in FALLBACK_CHAIN:
        try:
            client = OpenAI(
                base_url=provider["base"],
                api_key=os.environ.get(f"{provider['name'].upper()}_API_KEY", "no-key")
            )
            return client.chat.completions.create(
                model=kwargs.get("model", provider["name"]),
                messages=messages,
                timeout=provider["timeout"],
                **{k: v for k, v in kwargs.items() if k != "model"}
            )
        except Exception as e:
            errors.append(f"{provider['name']}: {e}")
            continue
    raise RuntimeError(f"All providers failed: {'; '.join(errors)}")
```

### 模式二：加权路由（成本优化）

```python
import random

PROVIDER_WEIGHTS = [
    ("deepseek-v4-flash", 0.50, "https://api.deepseek.com", 0.14),
    ("deepseek-v4-pro",   0.30, "https://api.deepseek.com", 0.44),
    ("gpt-4o-mini",       0.15, "https://api.openai.com/v1", 1.10),
    ("gpt-5.5",           0.05, "https://api.openai.com/v1", 5.00),
]

def weighted_chat(messages):
    r = random.random()
    cumulative = 0
    for model, weight, base, cost in PROVIDER_WEIGHTS:
        cumulative += weight
        if r <= cumulative:
            client = OpenAI(base_url=base, api_key=os.environ.get("ROUTER_KEY"))
            return client.chat.completions.create(model=model, messages=messages)
    # fallback: 最便宜
    client = OpenAI(base_url="http://localhost:11434/v1")
    return client.chat.completions.create(model="llama3.2", messages=messages)
```

### 模式三：Circuit Breaker（生产级）

```python
from datetime import datetime, timedelta

class CircuitBreaker:
    def __init__(self, name, failure_threshold=3, recovery_timeout=60):
        self.name = name
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.failures = 0
        self.last_failure = None
        self.state = "CLOSED"  # CLOSED → OPEN → HALF_OPEN

    def call(self, func, *args, **kwargs):
        if self.state == "OPEN":
            if datetime.now() - self.last_failure > timedelta(seconds=self.recovery_timeout):
                self.state = "HALF_OPEN"
            else:
                raise CircuitBreakerOpenError(f"{self.name} circuit is OPEN")

        try:
            result = func(*args, **kwargs)
            if self.state == "HALF_OPEN":
                self.state = "CLOSED"
                self.failures = 0
            return result
        except Exception as e:
            self.failures += 1
            self.last_failure = datetime.now()
            if self.failures >= self.failure_threshold:
                self.state = "OPEN"
            raise e

# 使用
breakers = {
    "anthropic": CircuitBreaker("anthropic", failure_threshold=3, recovery_timeout=30),
    "openai":    CircuitBreaker("openai",    failure_threshold=3, recovery_timeout=30),
    "deepseek":  CircuitBreaker("deepseek",  failure_threshold=5, recovery_timeout=15),
}
```
