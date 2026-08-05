# Wordaydream 技术架构

> 维护说明: 本文档每次发布版本 (v2.x.x) 后同步更新; 任何 store / feature / persist key
> 变更必须在此反映. v2.2.4 Round 6 全面校对过全部 10 个 store 的实际代码.

## 概述

Wordaydream 是一个基于 React 19 + TypeScript 的语境化词汇学习应用，采用 Feature-Sliced Design 架构模式，通过 LLM 生成真实文本、FSRS 算法进行间隔重复复习，帮助用户在真实语境中学习词汇。

## 技术栈

| 分类 | 技术 | 版本 |
|------|------|------|
| 框架 | React | 19.x |
| 语言 | TypeScript | 6.x |
| 构建工具 | Vite | 8.x |
| 状态管理 | Zustand | 5.x (含 persist 中间件) |
| 复习算法 | ts-fsrs | 5.4.1 |
| 代码规范 | Oxlint | 1.71.x (no-explicit-any: error) |
| 测试 | Vitest | 4.x (pool: threads) |
| 端到端测试 | Playwright | (浏览器 e2e, scripts/e2e_screenshots/) |

## 架构模式

### Feature-Sliced Design

项目采用 Feature-Sliced Design 架构，按功能模块组织代码：

```
src/
├── features/              # 功能模块 (按业务领域划分)
│   ├── achievements/      # 成就系统 (解锁 / Toast / Modal)
│   ├── analytics/         # 学习数据统计与可视化
│   ├── dictionary/        # 字典查询 (wiktextract) + Gloss 缓存
│   ├── difficulty-coupling/ # 难度评估与推荐联动
│   ├── evaluation/        # 答题评估 + 补救学习 (Remedy)
│   ├── graduation/        # 毕业 Modal
│   ├── grammar/           # 语法点检测 + 复合词拆分
│   ├── home/              # 首页 (Hero / TodayCard / AchievementWall)
│   ├── llm/               # LLM 服务 (router / providers / proxy / offlineMode)
│   ├── reading/           # 阅读会话 (passageGenerator / InteractivePassage)
│   ├── review/            # 间隔重复复习 (MemoryTray / RatingBar / schedulerAdapter)
│   ├── settings/          # 应用设置 (LLM / 主题 / 难度)
│   ├── streak/            # 连续学习天数
│   └── wordlist/          # CSV 词库管理 + IndexedDB 两层存储
├── components/            # 通用 UI 组件 (跨模块复用, 含 ErrorBoundary)
├── hooks/                 # 自定义 Hooks (跨模块复用, useFocusTrap 等)
├── domain/                # 领域层 (events.ts 事件总线 / wordlistDomain / memoryDomain)
├── store/                 # 全局 store (useToastStore 等瞬时态)
├── styles/                # 全局样式 (tokens.css 三套主题色板)
├── types/                 # TypeScript 类型定义
└── utils/                 # 通用工具函数
```

### 模块职责

| 模块 | 职责 | 关键组件 / 服务 |
|------|------|----------------|
| achievements | 成就解锁、Toast 提示、成就墙展示 | AchievementEngine、useAchievementStore、AchievementListModal |
| analytics | 学习数据统计与可视化 | useAnalyticsStore、AnalyticsChart、useHomeAnalytics |
| dictionary | 字典查询、Gloss 持久化缓存 | wiktextractAdapter、glossPersistentCache |
| difficulty-coupling | 难度评估与推荐联动 | difficultyEvaluator、difficultyAdvisor、DifficultySuggestion |
| evaluation | 答案评估、补救学习 | evaluateAnswer、glossAdapter、RemedyPanel |
| graduation | 毕业 Modal | GraduationModal |
| grammar | 语法点检测、复合词拆分、语法教学 | GrammarDetector、CompoundSplitter、GrammarPanel |
| home | 首页仪表盘 | HeroSection、TodayCard、ProgressRing、StreakBadge |
| llm | LLM 路由、Provider、连接测试、提示词、离线模式 | LlmRouter、providerFactory、prompts、useOfflineModeStore |
| reading | 阅读会话、文本生成、词元解析、阅读历史 | passageGenerator、InteractivePassage、useReadingSessionStore、useReadingHistoryStore |
| review | 间隔重复复习、评分、卡片调度 | useMemoryStore、useReviewSessionStore、RatingBar、schedulerAdapter、fsrsOptimizer |
| settings | LLM 配置、主题、难度 | useSettingsStore、SettingsPanel |
| streak | 连续学习天数 | useStreakStore |
| wordlist | CSV 词库管理、IndexedDB 两层存储 | useWordlistStore、WordlistPage |

## 状态管理

### Zustand Store 结构

项目使用 Zustand 进行状态管理，每个功能模块独立维护自己的 store:

```typescript
// 阅读会话 (部分持久化)
useReadingSessionStore: {
  session: ReadingSession | null;
  activeOccurrenceId: string | null;
  hoveredGroupId: string | null;
  activeGrammarPointId: string | null;
  hoveredGrammarTypeId: string | null;
  isLoading: boolean;
  lastConfig: { language: Language; difficulty: DifficultyLevel } | null;
  currentHistoryId: string | null;
  loadSession: (language: Language, difficulty: DifficultyLevel) => Promise<void>;
  loadFromHistory: (passage: Passage, language: Language, difficulty: DifficultyLevel, options?: { resetResolved?: boolean }) => void;
  markOccurrenceResolved: (occurrenceId: string) => void;
  getLinkedOccurrences: (groupId: string) => TokenOccurrence[];
  getResolvedCount: () => number;
  getReviewTokens: () => TokenOccurrence[];
  clearSession: () => void;
}

// 阅读历史 (持久化)
useReadingHistoryStore: {
  history: HistoryEntry[];
  maxHistory: number;
  addEntry: (entry: Omit<HistoryEntry, 'id'>) => string;
  completeEntry: (id: string) => void;
  getEntry: (id: string) => HistoryEntry | undefined;
  removeEntry: (id: string) => void;
  clearHistory: () => void;
}

// 记忆卡片 (持久化, 含 FSRS 调度)
useMemoryStore: {
  cards: Map<string, MemoryCard>;
  newlyAdded: string[];
  ratingHistory: Array<{ cardId: string; rating: Rating; at: number }>;
  schemaVersion: number;
  addCardFromToken: (token: TokenOccurrence, language?: Language) => MemoryCard;
  rateCard: (cardId: string, rating: Rating) => void;
  getDueCards: (language?: Language, now?: number, states?: MemoryCard['status'][]) => MemoryCard[];
  getCardByLemma: (lemma: string, language?: Language) => MemoryCard | undefined;
  clearNewlyAdded: () => void;
  resetAll: () => void;
}

// 复习会话 (持久化)
useReviewSessionStore: {
  mode: ReviewMode;               // 'idle' | 'reviewing' | 'completed'
  language: Language;
  queue: MemoryCard[];
  currentIndex: number;
  userAnswer: string;
  evaluation: AnswerEvaluation | null;
  isEvaluating: boolean;
  isPaused: boolean;
  showRatingBar: boolean;
  results: ReviewCardResult[];
  startedAt: number;
  cardContexts: Record<string, string>;
  startReview: (language?: Language) => void;
  submitAnswer: (answer?: string) => Promise<AnswerEvaluation | null>;
  completeReview: (rating: Rating) => void;
  nextCard: () => void;
  pauseReview: () => void;
  resumeReview: () => void;
  exitReview: () => void;
}

// 分析 (持久化)
useAnalyticsStore: {
  dailyRecords: DailyLearningRecord[];
  addLearningRecord: (count: number) => void;
  getLearningCurve: (days: number) => DailyLearningRecord[];
  getStreak: () => number;
}

// 设置 (持久化, version 7)
useSettingsStore: {
  llm: LLMSettings;       // provider / model / temperature / enabled ...
  difficulty: DifficultyLevel;
  theme: Theme;           // 'light' | 'dark' | 'sepia'
  totalSecondsToday: number;
  lastSessionDate: string | null;
  fsrsWeights?: number[];
  setProvider: (provider: LLMProvider) => void;
  testConnection: () => Promise<{ ok: boolean; error?: string }>;
}

// 词库 (持久化, IndexedDB 两层存储)
useWordlistStore: {
  progress: Record<string, WordProgress>;
  linearMode: boolean;
  schemaVersion: number;
  dailyGoal: DailyGoal;
  getLevelTotalSync: (language: Language, difficulty: DifficultyLevel) => number;
  getMasteredCount: (language: Language, difficulty: DifficultyLevel) => number;
  syncFromMemoryCards: (cards: Map<string, MemoryCard>) => void;
  markWordLearning: (language: Language, lemma: string) => void;
  markWordMastered: (language: Language, lemma: string) => void;
  recordEncounter: (language: Language, lemma: string, passageId: string) => void;
  setLinearMode: (linear: boolean) => void;
  resetAll: () => void;
}

// 成就 (持久化)
useAchievementStore: {
  achievements: Achievement[];       // 全部 13 个成就快照 (含 unlocked / unlockedAt)
  newUnlocks: AchievementUnlock[];   // 本次会话新解锁队列 (toast 用, 不持久化)
  checkAndUnlock: (ctx: AchievementContext) => void;
  dismissToast: (id: string) => void;
  reset: () => void;
}

// 连续天数 (持久化)
useStreakStore: {
  lastStudyDate: string | null;
  currentStreak: number;
  longestStreak: number;
  recordDay: () => void;
  reset: () => void;
}

// 复习会话 (持久化, 见上)

// 离线模式 (持久化, 含 navigator.onLine 镜像)
useOfflineModeStore: {
  isOffline: boolean;
  cachedProvider: CachedProvider;
  init: () => () => void;   // 返回 cleanup
  setOffline: (offline: boolean) => void;
}

// 瞬时 (无 persist)
useToastStore: {
  notifications: Notification[];
  showNotification: (key, message) => void;
  dismissNotification: (key: string) => void;
}
```

### 持久化策略

**10 个 persist store** 全部通过 Zustand 的 `persist` 中间件持久化到 localStorage
(`useToastStore` v2.2.4 起为瞬时态, 不再持久化):

| Store | localStorage Key | version | 持久化字段 |
|-------|------------------|---------|-----------|
| useSettingsStore | wordaydream:settings | 7 | llm / difficulty / theme / totalSecondsToday / lastSessionDate / fsrsWeights / fsrsWeightsBackup |
| useReadingSessionStore | wordaydream:reading-session | 1 | session / lastConfig / currentHistoryId |
| useReadingHistoryStore | wordaydream:reading-history | 2 | history / maxHistory |
| useMemoryStore | wordaydream:memory | 2 | cards / ratingHistory / schemaVersion |
| useReviewSessionStore | wordaydream:review-session | 1 | mode / language / currentIndex / results / startedAt / cardContexts |
| useAnalyticsStore | wordaydream:analytics | 1 | dailyRecords / lastLearnedAt / llmRepairCount |
| useWordlistStore | wordaydream:wordlist | 4 | progress / linearMode / schemaVersion / dailyGoal |
| useAchievementStore | wordaydream:achievements | 1 | achievements |
| useStreakStore | wordaydream:streak | 1 | lastStudyDate / currentStreak / longestStreak |
| useOfflineModeStore | wordaydream-offline-mode | 1 | isOffline / lastOnlineAt / lastOfflineAt / cachedProvider |

注: `useWordlistStore` 同时使用 IndexedDB 两层存储 (大 CSV 词库 + 行索引).

### 持久化扫描测试

`src/__tests__/persistMigration.test.ts` 静态扫描全部 10 个 store, 验证:
- 每个文件 `import { persist } from 'zustand/middleware'`
- 不再 import 旧的 `persistenceMiddleware`
- 调用 `persist()` 包裹 store initializer
- 不保留占位 identity `migrate: (s) => s` (v2.2.4 Round 2 清理)

## 核心数据流

### 阅读流程

```
用户选择语言/难度 → passageGenerator.generatePassage(forceRefresh)
  → LLM proxy (server/llm-proxy.js, 端口 3001) → 文本生成
  → alignmentValidator 6 步协议对齐 token offsets
  → wordlist 补偿 (token < 8 时补齐)
  → 创建 ReadingSession → 渲染 InteractivePassage
  → 用户点击词汇 → wiktextractAdapter.fetchEntry() → 显示释义
  → 用户提交答案 → evaluateAnswer → 评估结果
  → grade === 'correct' 时 → addCardFromToken → useMemoryStore
  → markOccurrenceResolved (UI 进度推进, 与建卡解耦)
  → addLearningRecord → useAnalyticsStore
```

### 复习流程

```
用户点击"开始复习" → loadSession
  → getDueCards({ states: ['review', 'relearning'] }) (过滤 new/learning)
  → 注入复习词到 passage (buildReviewTokens 用词边界正则匹配 lemma)
  → 用户输入答案 → evaluateAnswer → 评估结果
  → 用户选择评分 → rateCard → schedulerAdapter (FSRS)
  → 新卡 due 后延 4 小时 (避免当次会话立即复现)
  → 记录复习结果 → addLearningRecord → 更新分析数据
```

## 核心类型

### TokenOccurrence

文本中词汇的具体出现记录:

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

基于 FSRS 算法的记忆卡片:

```typescript
interface MemoryCard {
  id: string;
  lexemeGroupId: string;
  lemma: string;
  objectiveDifficulty: DifficultyLevel;
  language?: Language;            // v1.5.2: 精确过滤复习卡片
  firstLearnedAt: number;         // v1.5.2: 不可变, 创建时设定
  lastReviewAt?: number;          // v1.5.2: FSRS last_review 语义
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

注意: FSRS `status === 'new'` 语义是"已创建未评分" (reps=0), 不是"用户从未见过此词".
`wordlistDomain.deriveStatus` 把 `'new'` 映射为 `'learning'` 而非 `'unseen'` (v2.2.2 Bug 4 修复).

### Passage

阅读文章完整数据:

```typescript
interface Passage {
  id: string;
  language: Language;
  difficulty: DifficultyLevel;
  text: string;
  title?: string;
  tokens: TokenOccurrence[];
  lexemeGroups: LexemeGroup[];
  grammarPoints: GrammarPoint[];   // v2.2.4 Stage 1: jsonParser 补字段
}
```

## LLM 集成

### Provider 模式

支持四种 LLM Provider:

| Provider | 说明 | API Key 持有方 | 实现位置 |
|----------|------|---------------|---------|
| Mock | 内置示例数据 | 无需 | mockProvider.ts |
| OpenAI | OpenAI API (gpt-4o-mini) | 后端 .env | openaiProvider.ts |
| Anthropic | Anthropic API (claude-3-5) | 后端 .env | anthropicProvider.ts |
| DeepSeek | DeepSeek API (deepseek-chat) | 后端 .env | deepseekProvider.ts |

### Node.js Proxy 架构 (v2.2.0+)

API key 全部由后端 `server/llm-proxy.js` (端口 3001) 持有, 前端不接触 key:

```
Client (browser)
  → POST http://localhost:3001/api/llm
  → server 读 process.env.{PROVIDER}_API_KEY
  → fetch upstream LLM API
  → 返回 JSON 或 SSE 流给客户端
```

注: v1.3.0 Netlify Edge Function (Deno) 架构已迁移到 Node.js proxy.
前端 `settings.apiKey` / `settings.baseUrl` 字段已废弃 (v2.1.1 Stage 4 移除),
`passageGenerator` / `llmAdapter` 不再检查 `apiKey.trim().length > 0`.

### 函数式 Provider 路由

`providerFactory.getProvider()` 根据 provider 名路由到对应函数:

```typescript
function routeOpenAI(): ProviderFn {
  return async (options) => openaiGenerate(options);
}
// 同理 routeAnthropic / routeDeepSeek / routeMock

export function getProvider(): ProviderFn {
  // 缓存命中直接返回 (非灰度场景)
  if (cachedProvider) return cachedProvider;
  const config = getLLMConfig();
  // 灰度发布 (仅 openai 启用, 每次抽样不缓存)
  if (config.provider === 'openai' && config.grayscale < 100) {
    const selected = selectByWeight(config.grayscale);
    return selected === 'anthropic' ? routeAnthropic() : routeOpenAI();
  }
  switch (config.provider) { /* ... */ }
  return cachedProvider;
}
```

### Router 入口

`generateWithFallback(settings, options)` 是主入口, 内部委托给 providerFactory:

- 离线模式 (navigator.onLine === false): 短路到 mock + 派发 'offline-mode' 通知
- expectJson=true: 走 `generateWithJsonRetry` (parse-retry + error context, 最多 N 次)
- expectJson=false: 走 `retryWithBackoff` (网络重试)
- 全失败: mock fallback + 派发 'llm-fallback' 通知 + 保留 `fallbackToMock: true` 标记 (v2.2.1 Bug 3 修复)

### LLM Prompt 多样性 (v2.2.2 Bug 5 修复)

`prompts.ts` + `passageGenerator.ts`:
- 主题池随机选择 (不再传字面主题 hint 给 LLM, 避免逐字复用)
- temperature 0.85 (从 0.5 提高)
- recentTitles LRU 黑名单 (避免连续生成相同标题)

### Alignment Validator 6 步协议

`alignmentValidator.ts` 对齐 LLM 返回的 token offsets 与文章 surface form:

1. exact match (substring 严格校验)
2. case-insensitive match
3. fuzzy match (Levenshtein 距离)
4. word-boundary match (Unicode 词边界正则 `(?<![\p{L}\p{N}])lemma(?![\p{L}\p{N}])`)
4.5. loose match (trim + toLowerCase + 词干化 + indexOf 兜底, v2.2.3 新增)
5. dropped (无法对齐时丢弃, 但用 `safeJsonParse` fallback 让 `validateAndAlignPassagePayloadWithResults` 修复 offsets, v2.2.4 修复)

## 错误处理

### ErrorBoundary (v2.2.4 Stage 2 重构)

全局错误边界组件, 捕获 React 渲染错误:

```tsx
class ErrorBoundary extends Component<Props, State> {
  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }
  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }
  handleRetry = () => {
    this.props.onReset?.();           // v2.2.4 新增: 调用方重置外部状态
    this.setState({ hasError: false, error: null });
  };
  handleGoHome = () => {              // v2.2.4 新增: 返回首页
    window.location.hash = '#/home';
    this.props.onReset?.();
    this.setState({ hasError: false, error: null });
  };
  // render: 错误 UI 含 "重试" + "返回首页" 两个按钮
}
```

### LLM Router 错误通知 (v2.2.4 Stage 2 提取)

`router.ts` 提取 `safeNotify` helper, 6 处 catch 块统一加 console.error 日志:

```typescript
function safeNotify(toast, key, message): void {
  try {
    toast.showNotification(key, message);
  } catch (e) {
    console.error('[router] safeNotify failed', key, e);
  }
}
```

## 性能优化

### React.memo

对以下组件使用 `React.memo` 避免不必要重渲染:

- TokenSpan (词汇展示)
- GrammarSpan (语法高亮)
- LinkedOccurrenceHighlight (关联词汇高亮)
- GrammarHighlight (语法点高亮)

### useMemo / useCallback

- segments / paragraphs / tokenIds 计算
- 事件处理函数缓存
- 过滤和排序逻辑
- ReviewSessionPage statsLine (v2.2.3 优化)
- ReadingHistoryPanel selector 反模式修复 (v2.2.4 Stage 3, 用 useMemo 提取派生 state)

### LRU 缓存

- `passageGenerator` 1 分钟缓存窗口 (forceRefresh 参数跳过, v2.2.1 Bug 1 修复)
- `glossPersistentCache` sourceHash 校验持久化 (v2.1.0)
- `glossAdapter` 内存 LRU

## 辅助功能 (v2.2.4 Stage 3 + Round 2)

### useFocusTrap Hook (D3-5)

`src/hooks/useFocusTrap.ts` 提供模态弹窗 focus trap:
- isActive=true 时自动 focus 第一个可交互元素
- Tab / Shift+Tab 在容器内循环
- `el.offsetParent !== null` 过滤隐藏元素
- ESC 关闭由各组件自行处理 (关闭回调不同)
- 应用于: KeyboardShortcutsHelp / AchievementListModal / GraduationModal / ReviewSessionPage pausedOverlay / GrammarPanel

### ARIA 属性

所有交互组件添加完整的 ARIA 属性:
- `role="dialog"` + `aria-modal="true"` (模态内容容器, 非 overlay)
- `aria-label` / `aria-labelledby` / `aria-describedby`
- `aria-live="polite"` (实时播报内容变化)

### 键盘支持

- `Tab` / `Shift+Tab`: useFocusTrap 循环
- `Enter` / `Space`: 激活元素 (所有可点击 div 必须改为 `<button>`)
- `Esc`: 关闭面板
- 方向键: 导航评分按钮

### prefers-reduced-motion

所有动画必须支持 `prefers-reduced-motion` 媒体查询 (硬约束).
通用重置 (`*, *::before, *::after` + `scroll-behavior`) 集中在 `tokens.css`,
各 CSS 模块仅保留模块特有的 `animation: none !important` 规则 (v2.2.4 Round 3 集中).
`tokens.css` 提供 12 个状态色变量 (light / dark / sepia 三套主题).

## 响应式设计

### 阅读区约束 (硬约束)

- 暖白纸 #faf8f5 + 深墨 #1c1917 (light theme)
- 阅读区 ≥60% 总宽度
- 阅读区最大宽度 42rem (672px), 居中
- `.page` class flexbox 容器, sidebar 为 `flex-shrink: 0` flex child (非 fixed)
- PageTransition 容器 `width: 100%` + `height: 100%`

### 断点配置

| 断点 | 宽度 | 布局 |
|------|------|------|
| sm | < 640px | 移动端, 侧边栏收起 |
| md | 640-768px | 平板端, 紧凑布局 |
| lg | > 768px | 桌面端, 完整布局 |

## 代码规范

### Oxlint 规则

项目使用 Oxlint 进行代码规范检查:

- `no-explicit-any`: error (v2.2.4 Stage 4 从 warn 升级)
- `react/rules-of-hooks`: error
- `react/only-export-components`: error
- TypeScript 严格类型检查
- `npm run typecheck`: tsc --noEmit

### 命名规范

- 文件: `kebab-case.ts` / `kebab-case.tsx`
- 组件: `PascalCase.tsx`
- 函数: `camelCase()`
- 类型: `PascalCase`
- 常量: `UPPER_CASE`

### TypeScript 类型规范 (v2.2.4 Stage 1)

- 16 处 `'en' | 'de'` 收敛为 `Language` 类型
- `llmAdapter` 消除 4 处 `as unknown as` 断言
- `jsonParser` 补 `grammarPoints?` 字段
- `vite-env.d.ts` 扩展 Window 接口 (`__TOAST_STORE__` + `__READING_STORE__`)

## 测试

### 单元测试 (Vitest, pool: threads)

核心服务与组件测试覆盖:

- `grammarDetector.test.ts`
- `compoundSplitter.test.ts`
- `evaluationService.test.ts`
- `alignmentValidator.test.ts` + `alignmentValidator.integration.test.ts`
- `passageGenerator.test.ts` + `.cache.test.ts` + `.source.test.ts`
- `router.test.ts` + `router.expectJson.test.ts`
- `useFocusTrap.test.tsx` (v2.2.4 Round 2 新增)
- `ErrorBoundary.test.tsx` (v2.2.4 Round 2 新增)
- `persistMigration.test.ts` (10 store 扫描)

### 端到端测试 (Playwright)

关键用户流程通过 Playwright + vite dev server 进行浏览器点击测试
(项目记忆: 单元测试 mock store 模块不会触发真实 import 解析, 无法发现跨模块路径错误,
必须在迭代收尾阶段补充浏览器端到端测试):

- 阅读模式完整流程
- 复习模式完整流程
- 设置面板配置流程
- 截图产物: `scripts/e2e_screenshots/`

### 测试约束

- vitest `forks` pool 在系统资源紧张时 worker 启动超时, 统一使用 `--pool=threads`
- 同步函数改 async 后, mock 必须从 `mockReturnValue` 改为 `mockResolvedValue`
- 测试用 `waitFor` / `findByText` 处理异步断言

## 部署

### 开发环境

```bash
npm run dev         # 启动 Vite dev server (前端)
node server/llm-proxy.js  # 启动 LLM proxy (端口 3001, 后端)
npm run lint        # Oxlint 检查
npm run typecheck   # tsc --noEmit
npm run test:run    # vitest run
```

### 生产环境

```bash
npm run build       # tsc -b && vite build
npm run preview     # vite preview
```

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| VITE_APP_TITLE | 应用标题 | Wordaydream |
| `server/.env` | LLM provider API keys (OPENAI_API_KEY / ANTHROPIC_API_KEY / DEEPSEEK_API_KEY) | (不提交) |

## 安全

### API Key 管理 (v2.2.0+ Node.js proxy 架构)

- API Key 由 `server/llm-proxy.js` 后端服务端持有 (`process.env.*_API_KEY`)
- 客户端只配置 `VITE_LLM_PROXY_URL` (默认 `http://localhost:3001`), 不传 key
- v1.3.0 Netlify Edge Function 架构已迁移
- v1.3.0 之前的"客户端 localStorage 持 key"模式已废弃
- 不记录 API Key 到日志
- 支持 Mock 模式, 无需 API Key 即可使用

### XSS 防护

- 使用 React 内置的 HTML 转义
- 对用户输入进行验证和过滤

## 国际化

当前支持:

- 英语 (en)
- 德语 (de)

未来计划支持多语言界面.

## 版本历史摘要

详细见 `CHANGELOG.md`. 关键里程碑:

- v1.6.1: getRetrievability 衰减 + 困难词排序
- v1.8.0: InteractivePassage v2 重构 (段落级渲染 + stagger)
- v1.9.0: LLM 集成 (4 provider + proxy + alignment validator)
- v2.0.0: 领域事件 + CSV 词库 (events.ts 消除循环依赖)
- v2.1.0: FSRS 参数优化 + Gloss 持久化缓存
- v2.2.0: 领域层完善 + FSRS 参数优化 + LLM proxy 迁移
- v2.2.1: Hotfix (LRU 缓存 + 竞态 + fallback 标记)
- v2.2.2: Hotfix (deriveStatus 语义 + 主题多样性 + 词边界匹配 + 复习时机)
- v2.2.3: 组件优化 (Step 4.5 宽松匹配 + wordlist 补偿 + useMemo)
- v2.2.4: 全量代码审查与质量提升 (类型安全 + 工程规范 + 可访问性 + 暗色模式)
