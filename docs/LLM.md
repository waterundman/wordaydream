# LLM 集成文档

## 概述

Wordaydream 使用 LLM（大语言模型）生成真实文本、检测语法点、拆分复合词和评估答案。支持四种 Provider 模式 (v1.4.0+): Mock、OpenAI、Anthropic、DeepSeek。v1.3.0+ 通过 Netlify Edge Function 代理 LLM 请求, API key 不再暴露给客户端。

## Provider 配置

### 配置项 (v1.5.2)

```typescript
interface LLMSettings {
  provider: 'mock' | 'openai' | 'anthropic' | 'deepseek' | 'kimi' | 'qwen' | 'minimax';
  apiKey: string;          // v1.3.0+: 客户端可留空, 由 Edge Function 持有
  baseUrl: string;
  model: string;
  temperature: number;
  enabled: boolean;
  timeout: number;         // 请求超时 (秒)
  maxRetries: number;      // 网络重试次数
  streaming: boolean;      // 启用 SSE 流式响应
  jsonMaxAttempts?: number; // JSON 解析失败重试次数 (1-5, 默认 3)
}
```

注: kimi/qwen/minimax 在 LLMProvider 类型保留 (向后兼容), 但 v1.4.0 Stage 1/2 已删除函数式实现, 实际不可用。

### 默认配置

| Provider | Model | Temperature |
|----------|-------|-------------|
| OpenAI | gpt-4o-mini | 0.7 |
| Anthropic | claude-3-5-sonnet-20241022 | 0.7 |
| DeepSeek | deepseek-chat | 0.7 |

### Mock 模式

Mock 模式使用内置示例数据，无需 API Key，适合演示和开发：

```typescript
const mockPassage = {
  text: 'The cat is sitting on the mat.',
  tokens: [...],
  grammarPoints: [...],
};
```

## 核心服务

### Router 入口 (v1.4.1+ 函数式)

`generateWithFallback(settings, options)` 是主入口, 不再使用 class-based LlmRouter:

```typescript
// router.ts (v1.4.0+: 0 class 残留)
export async function generateWithFallback(
  settings: LLMSettings,
  options: GenerateOptions
): Promise<LLMResponse> {
  // v1.4.1: 离线模式短路
  if (window.navigator.onLine === false) {
    return new MockLLMProvider().generate(options);
  }
  if (!settings.enabled || settings.provider === 'mock') {
    return new MockLLMProvider().generate(options);
  }
  // v1.4.0: 函数式 provider factory (内部缓存 + 灰度路由)
  const providerFn = getProvider(); // 来自 providerFactory.ts
  // expectJson=true: parse-retry + error context
  // expectJson=false: 网络重试
  return generateWithJsonRetry(providerFn, options, signal, maxAttempts);
}
```

### Provider Factory (v1.4.0+)

`providerFactory.ts` 根据 `VITE_LLM_PROVIDER` env 路由到对应函数式 provider:

```typescript
function routeOpenAI(): ProviderFn {
  return async (options) => openaiGenerate(options);
}
function routeAnthropic(): ProviderFn {
  return async (options) => anthropicGenerate(options);
}
function routeDeepSeek(): ProviderFn {
  return async (options) => deepseekGenerate(options);
}

export function getProvider(): ProviderFn {
  // v1.5.0 Stage 4: 灰度发布 (仅 openai 启用)
  // v1.5.2 fix M5: 灰度模式每次抽样不缓存
  const config = getLLMConfig();
  if (config.provider === 'openai' && config.grayscale < 100) {
    const selected = selectByWeight(config.grayscale);
    return selected === 'anthropic' ? routeAnthropic() : routeOpenAI();
  }
  // 非灰度: 缓存命中直接返回
  if (cachedProvider) return cachedProvider;
  switch (config.provider) {
    case 'openai': cachedProvider = routeOpenAI(); break;
    case 'anthropic': cachedProvider = routeAnthropic(); break;
    case 'deepseek': cachedProvider = routeDeepSeek(); break;
  }
  return cachedProvider;
}
```

### 连接测试 (v1.4.0+)

```typescript
async testProviderConnection(): Promise<{ ok: boolean; error?: string }>
```

走 Edge Function 探测 (POST 一个 maxTokens=1 的最小请求):
- 200 ok: 服务端 API key 已配置
- 500 + code: "MISSING_API_KEY": 服务端无 key
- 其它错误: 透传 HTTP status

## 提示词配置

### 文本生成

用于生成阅读文本的提示词：

```typescript
const passagePrompt = `Generate a ${difficulty}-level ${language} passage about ${topic}.
Requirements:
- ${length} words
- Natural, engaging content
- Include common vocabulary and grammar patterns
- Return JSON with "text" and "title" fields`;
```

### 语法检测

用于检测文本中语法点的提示词：

```typescript
const grammarPrompt = `Analyze the following ${language} text and identify grammar points:
${text}
Return JSON array of GrammarPoint objects with type, explanation, and examples.`;
```

### 复合词拆分

用于拆分德语复合词的提示词：

```typescript
const compoundPrompt = `Split the following German compound words and explain their meaning:
${words}
Return JSON array of CompoundWord objects with parts and meanings.`;
```

### 难度评估

用于评估词汇难度的提示词：

```typescript
const difficultyPrompt = `Evaluate the difficulty of the following ${language} words:
${words}
Consider: morphological complexity, abstractness, frequency
Return JSON array of DifficultyEvaluation objects with level 1-5.`;
```

## 使用场景

### 文本生成流程

```
1. 用户选择语言和难度
2. 调用 LlmRouter.request(passagePrompt)
3. 解析返回的 JSON
4. 创建 Passage 对象
5. 渲染到 InteractivePassage
```

### 语法检测流程

```
1. 生成文本后调用 grammarDetector.detectGrammarPoints(text)
2. 调用 LlmRouter.request(grammarPrompt)
3. 解析返回的语法点列表
4. 渲染 GrammarHighlight 组件
```

### 复合词拆分流程

```
1. 用户点击复合词
2. 调用 compoundSplitter.splitCompound(word)
3. 调用 LlmRouter.request(compoundPrompt)
4. 解析返回的拆分结果
5. 渲染 CompoundWordDisplay 组件
```

## 错误处理

### 降级策略

当 LLM 请求失败时，自动降级到 Mock 模式：

```typescript
try {
  return await providers[provider].request(prompt);
} catch (error) {
  console.warn('[LLM] Request failed, falling back to mock');
  return mockProvider.request(prompt);
}
```

### 错误提示

使用 Toast 组件显示错误信息：

```typescript
toast.error('LLM 请求失败，已切换到演示模式');
```

## 性能优化

### 请求缓存

对相同的请求进行缓存，避免重复调用：

```typescript
const cache = new Map<string, LLMResponse>();

async request(prompt: string): Promise<LLMResponse> {
  if (cache.has(prompt)) return cache.get(prompt)!;
  const response = await this.fetch(prompt);
  cache.set(prompt, response);
  return response;
}
```

### 请求合并

对批量操作合并请求，减少 API 调用次数：

```typescript
// 将多个词汇的难度评估合并为一次请求
const batchPrompt = `Evaluate these words: ${words.join(', ')}`;
```

## 安全注意事项

### API Key 保护 (v1.3.0+ Edge Function 架构)

- API Key 由 Netlify Edge Function 服务端持有 (Deno.env.get), 客户端代码不接触 key
- 客户端 localStorage 仅存 provider 选择 + VITE_LLM_PROXY_URL, 不存 key
- v1.3.0 之前的"客户端持 key"模式已废弃 (仅作 fallback 兼容)
- 不记录 API Key 到日志
- 支持一键清除缓存

### 输入过滤

对用户输入进行验证和过滤，防止注入攻击：

```typescript
const sanitizedInput = input.replace(/[<>"']/g, '');
```

### 输出验证 (v1.2.0+ 三层防御)

对 LLM 返回的 JSON 进行三层验证：

```typescript
// 1. safeJsonParse: 标准 JSON.parse + 错误捕获
const result1 = safeJsonParse(text);
if (result1.ok) return result1.data;

// 2. jsonrepair: 容错修复尾随逗号 / 引号未闭合等
const result2 = jsonrepair(text);
// 3. zod schema: 结构验证 (字段类型 / 必填 / language 匹配)
const parsed = PassageSchema.safeParse(result2);
if (parsed.success) return parsed.data;
// 全失败 → mock fallback
```

## 配置管理

### 设置面板

用户可以在设置面板配置：

1. Provider 选择（Mock/OpenAI/Anthropic/DeepSeek）
2. API Key 输入（v1.3.0+: 可留空, 由 Edge Function 持有）
3. Base URL 自定义
4. Model 选择
5. Temperature 调整
6. 启用/禁用开关
7. Streaming 开关（v1.4.1+: SSE 流式响应）
8. JSON 重试次数 (v1.2.0+: jsonMaxAttempts 1-5)

### 预设模板

提供常用配置模板：

| 模板 | Provider | Model | 适用场景 |
|------|----------|-------|----------|
| 演示 | Mock | - | 无需 API Key |
| 快速 | OpenAI | gpt-4o-mini | 响应快，成本低 |
| 高质量 | OpenAI | gpt-4o | 生成质量高 |
| 全面 | Anthropic | claude-3-5-sonnet | 长文本处理 |
| 国内 | DeepSeek | deepseek-chat | 国内网络访问 (v1.4.0+) |

## 成本优化

### 建议配置

| 场景 | Provider | Model | 理由 |
|------|----------|-------|------|
| 日常学习 | OpenAI | gpt-4o-mini | 性价比高 |
| 深度学习 | Anthropic | claude-3-5-sonnet | 理解能力强 |
| 国内访问 | DeepSeek | deepseek-chat | 国内网络无墙, 价格低 (v1.4.0+) |
| 开发测试 | Mock | - | 零成本 |

### 用量监控

记录每次 LLM 调用的 token 消耗（计划中）：

```typescript
interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}
```

## 参考资料

- [OpenAI API 文档](https://platform.openai.com/docs/api-reference)
- [Anthropic API 文档](https://docs.anthropic.com/claude/reference/)
- [ts-fsrs GitHub](https://github.com/open-spaced-repetition/ts-fsrs)