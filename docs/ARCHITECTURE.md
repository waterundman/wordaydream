# Wordaydream 技术架构

## 概述

Wordaydream 是一个基于 React 19 + TypeScript 的语境化词汇学习应用，采用 Feature-Sliced Design 架构模式，通过 LLM 生成真实文本、FSRS 算法进行间隔重复复习，帮助用户在真实语境中学习词汇。

## 技术栈

| 分类 | 技术 | 版本 |
|------|------|------|
| 框架 | React | 19.x |
| 语言 | TypeScript | 6.x |
| 构建工具 | Vite | 8.x |
| 状态管理 | Zustand | 5.x |
| 复习算法 | ts-fsrs | 5.4.1 |
| 代码规范 | Oxlint | 1.71.x |

## 架构模式

### Feature-Sliced Design

项目采用 Feature-Sliced Design 架构，按功能模块组织代码：

```
src/
├── features/          # 功能模块（按业务领域划分）
│   ├── reading/       # 阅读功能
│   ├── review/        # 复习功能
│   ├── grammar/       # 语法教学
│   ├── analytics/     # 学习分析
│   ├── dictionary/    # 字典查询
│   ├── evaluation/    # 答题评估
│   ├── llm/           # LLM服务
│   └── settings/      # 设置管理
├── components/        # 通用UI组件（跨模块复用）
├── hooks/             # 自定义Hooks（跨模块复用）
├── types/             # TypeScript类型定义
├── lib/               # 核心工具库
└── utils/             # 通用工具函数
```

### 模块职责

| 模块 | 职责 | 关键组件/服务 |
|------|------|--------------|
| reading | 阅读会话管理、文本生成、词元解析 | InteractivePassage、PassageGenerator |
| review | 间隔重复复习、评分、卡片调度 | MemoryTray、RatingBar、SchedulerAdapter |
| grammar | 语法点检测、复合词拆分、语法教学 | GrammarDetector、CompoundSplitter |
| analytics | 学习数据统计、可视化 | AnalyticsStore、AnalyticsChart |
| dictionary | 字典查询、释义适配 | DictionaryAdapter |
| evaluation | 答案评估、补救学习 | EvaluationService、GlossAdapter |
| llm | LLM路由、连接测试、提示词配置 | LlmRouter、Prompts |
| settings | LLM配置、应用设置 | SettingsStore、SettingsPanel |

## 状态管理

### Zustand Store 结构

项目使用 Zustand 进行状态管理，每个功能模块独立维护自己的 store：

```typescript
// 阅读状态
useReadingSessionStore: {
  session: ReadingSession | null;
  isLoading: boolean;
  generatePassage: () => void;
  resolveToken: (tokenId: string) => void;
  setActiveOccurrence: (id: string | null) => void;
}

// 记忆状态
useMemoryStore: {
  cards: Map<string, MemoryCard>;
  addCard: (card: MemoryCard) => void;
  rateCard: (cardId: string, rating: Rating) => ReviewUpdate;
  getDueCards: () => MemoryCard[];
}

// 分析状态
useAnalyticsStore: {
  dailyRecords: DailyLearningRecord[];
  addLearningRecord: (count: number) => void;
  getLearningCurve: (days: number) => DailyLearningRecord[];
  getStreak: () => number;
}

// 设置状态
useSettingsStore: {
  llm: LLMSettings;
  setProvider: (provider: LLMProvider) => void;
  testConnection: () => Promise<{ ok: boolean; error?: string }>;
}
```

### 持久化策略

所有 store 通过 Zustand 的 `persist` 中间件持久化到 localStorage：

| Store | localStorage Key | 持久化字段 |
|-------|------------------|-----------|
| reading | wordaydream:reading | - |
| memory | wordaydream:memory | cards |
| analytics | wordaydream:analytics | dailyRecords, lastLearnedAt |
| settings | wordaydream:settings | llm |

## 核心数据流

### 阅读流程

```
用户选择语言/难度 → generatePassage() → LLM路由 → 文本生成
  → 解析词元 → 创建ReadingSession → 渲染InteractivePassage
  → 用户点击词汇 → fetchEntry() → 字典查询 → 显示释义面板
  → 用户标记已学 → createCard() → 添加到MemoryStore → addLearningRecord()
```

### 复习流程

```
用户点击"开始复习" → getDueCards() → 获取待复习卡片
  → 显示复习界面 → 用户输入答案 → evaluateAnswer() → 评估结果
  → 用户选择评分 → rateCard() → FSRS调度 → 更新卡片状态
  → 记录复习结果 → addLearningRecord() → 更新分析数据
```

## 核心类型

### TokenOccurrence

文本中词汇的具体出现记录：

```typescript
interface TokenOccurrence {
  id: string;
  lexemeGroupId: string;
  surfaceForm: string;
  lemma: string;
  objectiveDifficulty: DifficultyLevel;
  startIndex: number;
  endIndex: number;
  isResolved: boolean;
  isActive: boolean;
  kind: 'normal' | 'review';
  cardId?: string;
  isCompound: boolean;
  compoundParts?: string[];
}
```

### MemoryCard

基于 FSRS 算法的记忆卡片：

```typescript
interface MemoryCard {
  id: string;
  lexemeGroupId: string;
  lemma: string;
  objectiveDifficulty: DifficultyLevel;
  // v1.5.2: language 字段用于精确过滤复习卡片 (替代正则推断)
  language?: Language;
  // v1.5.2: firstLearnedAt 不可变, 创建时设定
  firstLearnedAt: number;
  // v1.5.2: lastReviewAt 用于 FSRS last_review 语义 (修复 H2)
  lastReviewAt?: number;
  due: number;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  status: 'new' | 'learning' | 'review' | 'relearning';
}
```

### Passage

阅读文章完整数据：

```typescript
interface Passage {
  id: string;
  language: Language;
  difficulty: DifficultyLevel;
  text: string;
  title?: string;
  tokens: TokenOccurrence[];
  lexemeGroups: LexemeGroup[];
  grammarPoints: GrammarPoint[];
}
```

## LLM 集成

### Provider 模式

支持四种 LLM Provider (v1.4.0 Stage 1/2 + v1.5.2 fix M15):

| Provider | 说明 | API Key 要求 | 实现位置 |
|----------|------|-------------|---------|
| Mock | 内置示例数据 | 无需 | mockProvider.ts |
| OpenAI | OpenAI API (gpt-4o-mini) | 服务端 Edge Function 持有 | openaiProvider.ts |
| Anthropic | Anthropic API (claude-3-5) | 服务端 Edge Function 持有 | anthropicProvider.ts |
| DeepSeek | DeepSeek API (deepseek-chat) | 服务端 Edge Function 持有 | deepseekProvider.ts |

注: kimi / qwen / minimax 在 v1.4.0 Stage 1/2 已删除函数式实现, 仅 LLMProvider 类型保留 (向后兼容).

### Edge Function 代理架构 (v1.3.0+)

API key 不再存储在客户端 localStorage, 改由 Netlify Edge Function (Deno runtime) 服务端持有:

```
Client (browser)
  → POST VITE_LLM_PROXY_URL (Edge Function)
  → Edge Function 读 Deno.env.get('OPENAI_API_KEY')
  → fetch upstream LLM API
  → 返回 JSON 或 SSE 流给客户端
```

### 函数式 Provider 路由 (v1.4.0 Stage 1/2)

`providerFactory.getProvider()` 根据 `VITE_LLM_PROVIDER` env 路由到对应函数:

```typescript
// providerFactory.ts (v1.4.0+: 0 class 残留)
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
  // 缓存命中直接返回 (非灰度场景)
  if (cachedProvider) return cachedProvider;
  const config = getLLMConfig();
  // v1.5.0 Stage 4: 灰度发布 (仅 openai 启用)
  // v1.5.2 fix M5: 灰度模式每次抽样不缓存
  if (config.provider === 'openai' && config.grayscale < 100) {
    const selected = selectByWeight(config.grayscale);
    return selected === 'anthropic' ? routeAnthropic() : routeOpenAI();
  }
  switch (config.provider) {
    case 'openai': cachedProvider = routeOpenAI(); break;
    case 'anthropic': cachedProvider = routeAnthropic(); break;
    case 'deepseek': cachedProvider = routeDeepSeek(); break;
  }
  return cachedProvider;
}
```

### Router 入口 (v1.4.1+)

`generateWithFallback(settings, options)` 是主入口, 内部委托给 providerFactory:

- 离线模式 (navigator.onLine === false): 短路到 mock + 派发 'llm-offline' 通知
- expectJson=true: 走 `generateWithJsonRetry` (parse-retry + error context, 最多 N 次)
- expectJson=false: 走 `retryWithBackoff` (网络重试)
- 全失败: mock fallback + 派发 'llm-fallback' 通知

## 错误处理

### ErrorBoundary

全局错误边界组件，捕获 React 渲染错误：

```tsx
class ErrorBoundary extends React.Component {
  state = { hasError: false, error: null };
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    logErrorToService(error, info);
  }
  render() {
    if (this.state.hasError) {
      return <ErrorView error={this.state.error} onRetry={this.props.onRetry} />;
    }
    return this.props.children;
  }
}
```

### useErrorHandler

统一异步错误处理 Hook：

```typescript
const useErrorHandler = () => {
  const toast = useToastStore();
  return {
    handle: async <T>(fn: () => Promise<T>): Promise<T | null> => {
      try {
        return await fn();
      } catch (error) {
        toast.error(error.message);
        return null;
      }
    },
  };
};
```

## 性能优化

### React.memo

对以下组件使用 `React.memo` 避免不必要重渲染：

- TokenSpan（词汇展示）
- GrammarSpan（语法高亮）
- LinkedOccurrenceHighlight（关联词汇高亮）
- GrammarHighlight（语法点高亮）

### useMemo / useCallback

对以下计算使用 `useMemo` / `useCallback`：

- segments/paragraphs/tokenIds 计算
- 事件处理函数缓存
- 过滤和排序逻辑

## 辅助功能

### ARIA 属性

所有交互组件添加完整的 ARIA 属性：

- `aria-label`：描述组件用途
- `aria-live`：实时播报内容变化
- `aria-labelledby` / `aria-describedby`：建立标签关联

### 键盘支持

所有交互支持键盘操作：

- `Tab` / `Shift+Tab`：焦点导航
- `Enter` / `Space`：激活元素
- `Esc`：关闭面板
- 方向键：导航评分按钮

## 响应式设计

### 断点配置

| 断点 | 宽度 | 布局 |
|------|------|------|
| sm | < 640px | 移动端，侧边栏收起 |
| md | 640-768px | 平板端，紧凑布局 |
| lg | > 768px | 桌面端，完整布局 |

### 适配策略

- 字体大小自适应
- 侧边栏可折叠
- 面板堆叠排列

## 代码规范

### Oxlint 规则

项目使用 Oxlint 进行代码规范检查，配置包含：

- `react/rules-of-hooks`：React Hooks 规则
- `react/only-export-components`：组件导出规则
- TypeScript 类型检查

### 命名规范

- 文件：`kebab-case.ts` / `kebab-case.tsx`
- 组件：`PascalCase.tsx`
- 函数：`camelCase()`
- 类型：`PascalCase`
- 常量：`UPPER_CASE`

## 测试

### 单元测试

核心服务使用 Vitest 进行单元测试：

- `grammarDetector.test.ts`
- `compoundSplitter.test.ts`
- `evaluationService.test.ts`

### E2E 测试

关键用户流程使用 Playwright 进行 E2E 测试：

- 阅读模式完整流程
- 复习模式完整流程
- 设置面板配置流程

## 部署

### 开发环境

```bash
npm run dev    # 启动开发服务器
npm run lint   # 代码规范检查
```

### 生产环境

```bash
npm run build  # 构建生产版本
npm run preview # 预览生产版本
```

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| VITE_APP_TITLE | 应用标题 | Wordaydream |

## 安全

### API Key 管理 (v1.3.0+ Edge Function 架构)

- API Key 由 Netlify Edge Function 服务端持有 (Deno.env.get), 客户端不接触 key
- 客户端只配置 `VITE_LLM_PROXY_URL` (Edge Function 路径), 不传 key
- v1.3.0 之前的"客户端 localStorage 持 key"模式已废弃 (仅作为 fallback 兼容)
- 不记录 API Key 到日志
- 支持 Mock 模式，无需 API Key 即可使用

### XSS 防护

- 使用 React 内置的 HTML 转义
- 对用户输入进行验证和过滤

## 国际化

当前支持：

- 英语（en）
- 德语（de）

未来计划支持多语言界面。