# Wordaydream 前后端逻辑全面审查报告

> 审查范围：`w:\项目仓库\For trae\wordaydream`
> 项目版本：v1.5.1（2026-07-10）
> 技术栈：React 19.2 + TypeScript 6.0 + Vite 8.1 + Zustand 5.0 + ts-fsrs 5.4.1 + vite-plugin-pwa 1.3
> 审查方式：只读审查，未修改任何文件
> 审查日期：2026-07-10

---

## 目录

1. [执行摘要](#一执行摘要)
2. [项目概览与架构](#二项目概览与架构)
3. [前端架构审查](#三前端架构审查)
4. [后端与 LLM 流式处理审查](#四后端与-llm-流式处理审查)
5. [PWA 与离线模式审查](#五pwa-与离线模式审查)
6. [测试体系审查](#六测试体系审查)
7. [构建与部署配置审查](#七构建与部署配置审查)
8. [风险点汇总与优先级排序](#八风险点汇总与优先级排序)
9. [代码质量亮点](#九代码质量亮点)
10. [改进建议](#十改进建议)

---

## 一、执行摘要

Wordaydream 是一个语境化词汇学习应用，通过 LLM 生成真实文本、FSRS 间隔重复算法巩固记忆。项目历经 v0.5.0 → v1.5.1 共 10+ 个版本迭代，架构从客户端直连 LLM 演进到 Netlify Edge Function 代理 + SSE 流式，整体工程水准较高。

**核心结论：**

- **架构成熟度高**：feature-sliced 分层清晰、状态管理单向无环、LLM 对齐验证工业级、文档化程度极高。
- **存在若干功能性 Bug**：其中 1 个高危 Bug（德语复习语言判定失效）直接导致德语复习功能不可用。
- **存在死代码与配置冗余**：手写 `sw.js` 永远不被加载、`manifest.webmanifest` 双重定义、流式组件未接入主流程。
- **文档与代码不同步**：`ARCHITECTURE.md`/`LLM.md` 描述的是 v1.0-v1.2 class 架构，与实际函数式代码严重不符。

**最需优先处理的 6 项问题：**

| 优先级 | 问题 | 影响 |
|--------|------|------|
| 紧急 | 德语 `getDueCards` 语言判定正则错误 | 德语复习功能完全不可用 |
| 紧急 | FSRS `firstLearnedAt`/`last_review` 语义错误 | 复习调度间隔计算失真 |
| 高 | review/reading session 持久化瞬态字段 | 刷新后 UI 卡死 |
| 高 | `withRetry` 的 signal 未传递给 fetch | 超时形同虚设，并发请求泄漏 |
| 高 | 流式仅 OpenAI 支持的静默降级 | anthropic/deepseek 用户无感知拿到 mock |
| 高 | `public/sw.js` 死代码 + manifest 双重定义 | 维护混淆 |

---

## 二、项目概览与架构

### 2.1 技术栈

| 层 | 选型 | 版本 |
|----|------|------|
| 框架 | React | 19.2.7 |
| 构建 | Vite | 8.1.1 |
| 语言 | TypeScript | ~6.0.2 |
| 状态管理 | Zustand | 5.0.14（+ persist 中间件） |
| 间隔重复 | ts-fsrs | 5.4.1 |
| 校验 | zod 4.4 / jsonrepair 3.15 | — |
| UI | @radix-ui/react-tooltip | 1.1.4 |
| PWA | vite-plugin-pwa | 1.3.0 |
| 代码规范 | oxlint | 1.71.0 |
| 测试 | vitest 4.1 / playwright | — |

### 2.2 架构模式：Feature-Sliced Design

```
src/
├── main.tsx                    # 启动入口（offline/PWA 监听）
├── App.tsx                     # 状态路由 + 全局 overlay 装配
├── components/                 # 通用组件
├── hooks/                      # 跨特性 hooks（动画/快捷键/错误处理）
├── store/useToastStore.ts      # 全局 toast store
├── types/index.ts              # 领域类型
├── config/env.ts               # 环境变量
└── features/
    ├── reading/                # 阅读模块
    ├── review/                 # 复习模块（FSRS）
    ├── llm/                    # LLM 服务（provider/hooks/config/utils）
    ├── achievements/           # 成就引擎
    ├── analytics/              # 学习分析
    ├── streak/                 # 连击
    ├── settings/               # 设置管理
    ├── home/                   # 主页
    ├── grammar/                # 语法教学
    ├── evaluation/             # 答题评估
    ├── dictionary/             # 字典查询
    └── difficulty-coupling/    # 难度建议
```

### 2.3 状态管理：10 个 Zustand Store

| Store | localStorage Key | 职责 | 跨 store 依赖 |
|-------|------------------|------|--------------|
| useReadingSessionStore | `wordaydream:reading-session` | 阅读会话编排 | → memory/history/streak/achievement |
| useMemoryStore | `wordaydream:memory` | FSRS 记忆卡 Map | 无（被多方调用） |
| useReviewSessionStore | `wordaydream:review-session` | 复习状态机 | → memory/streak/achievement |
| useSettingsStore | `wordaydream:settings` | LLM 配置 | → llm/services/router |
| useToastStore | `wordaydream:toast` | 瞬时 toast + 持久 banner | 无 |
| useAnalyticsStore | `wordaydream:analytics` | 每日学习记录 | 无 |
| useStreakStore | `wordaydream:streak` | 连续学习天数 | 无 |
| useAchievementStore | `wordaydream:achievements` | 13 个成就 | → achievementEngine |
| useReadingHistoryStore | `wordaydream:reading-history` | 阅读历史（上限 50） | 无 |
| useOfflineModeStore | `wordaydream-offline-mode` | 离线检测 | → toast |

**跨 store 通信模式**：一律使用 `XStore.getState().method()` 而非 hook 互订阅，依赖图严格单向无环，**无循环依赖**。

### 2.4 核心数据流

**阅读流程：**
```
用户选择语言/难度 → loadSession()
  → useMemoryStore.getDueCards(language)
  → generatePassage(language, difficulty, dueCards)  [LLM/mock]
  → buildReviewTokens(passage, dueCards)
  → useReadingHistoryStore.addEntry()
  → useStreakStore.recordDay()
  → useAchievementStore.checkAndUnlock()
  → 渲染 InteractivePassage
  → 用户点击 token → addCardFromToken → useMemoryStore 建卡
```

**复习流程：**
```
startReview(language) → getDueCards() → queue
  → 用户输入答案 → evaluateAnswer()
  → RatingBar.onRate(rating)
    → useMemoryStore.rateCard(cardId, rating)
      → schedulerAdapter.scheduleNextReview()  [ts-fsrs f.repeat()]
    → nextCard() / mode='completed'
    → useAchievementStore.checkAndUnlock()
```

**LLM 流式流程（v1.4.1+）：**
```
useStreamingPassage.start()
  → streamingGenerate()  [返回 { abort }]
    → POST config.proxyUrl { stream: true }
      → Edge Function llm-proxy.ts
        → handleStreamRequest (仅 openai)
          → openaiStreamProvider → fetch OpenAI with stream:true
          → ReadableStream 逐 chunk 解析 OpenAI SSE → 转为 {delta} 格式
      → Response(stream, SSE_HEADERS)
    → parseSSEStream()  [前端解析]
      → onChunk({delta, done}) → setStreamingText
```

---

## 三、前端架构审查

### 3.1 应用入口与路由

**入口 [src/main.tsx](file:///w:/项目仓库/For%20trae/wordaydream/src/main.tsx)：**
- 模块顶层调用 `useOfflineModeStore.getState().init()` 注册 online/offline 监听
- 监听 `beforeinstallprompt`/`appinstalled` 事件
- prod 模式动态 `import('virtual:pwa-register')` 注册 SW
- `StrictMode + TooltipProvider` 包裹 `<App/>`

**路由 [src/App.tsx](file:///w:/项目仓库/For%20trae/wordaydream/src/App.tsx)：**
- **纯状态驱动，无 react-router**：`appMode: 'home' | 'reading' | 'review'`（useState）
- `useReviewSessionStore.mode` 反向驱动：`mode='reviewing'|'completed'` → `setAppMode('review')`
- `PageTransition` 组件实现 100ms 延迟 + 600ms 淡入动画
- 全局 overlay 常驻：ErrorBoundary + NotificationBanner + OfflineBanner + ToastContainer + AchievementToast + KeyboardShortcutsHelp

**路由机制评价：** 简单无依赖，但**无浏览器后退支持、无深链接、无 URL 状态持久化**。

### 3.2 核心功能模块

#### 阅读模块 [src/features/reading/](file:///w:/项目仓库/For%20trae/wordaydream/src/features/reading)

**ReadingSessionPage.tsx：** 左侧栏（语言/难度/生成/进度/历史/分析/设置）+ 主区（InteractivePassage）；`useIsMobile` 控制抽屉式侧栏；首次挂载 effect 自动 `loadSession`。

**InteractivePassage.tsx（633 行，最复杂组件）：** 三段式渲染管线
1. `paragraphRanges` useMemo：按 `\n\n` 切段，无 `\n\n` 时按句末标点兜底切最多 3 段
2. `segments` useMemo：合并 tokens + grammarPoints 按 startIndex 排序，带 `isValidRange` 越界守卫
3. `paragraphSegments` useMemo：把 segments 按段落 range 分桶

TokenSpan/GrammarSpan 均 memo 化；段落 staggered 入场动画；完整键盘导航。

#### 复习模块 [src/features/review/](file:///w:/项目仓库/For%20trae/wordaydream/src/features/review)

**ReviewSessionPage.tsx：** idle/reviewing/completed 三态；ReviewCard 含输入框 + 评估反馈 + RatingBar；`onRate` 后 `setTimeout(nextCard, 50)`。

**RatingBar.tsx：** FSRS 四档评分（again/hard/good/easy）；`getRatingPreviews` 预览下次复习时间；1-4 快捷键 + 方向键 + Enter。

**schedulerAdapter.ts：** ts-fsrs 适配层；自定义 19 参数权重 `w`，`enable_fuzz`/`request_retention: 0.85`/`maximum_interval: 36500`；`difficultyToInitialDifficulty` 把客观难度 1-5 映射到 FSRS difficulty 3.0-10.0。

#### 成就/分析/连击

- **achievementEngine.ts：** 纯函数；13 成就（4 入门+4 进度+3 探索+2 隐藏）；`evaluate(ctx, current)` 返回新解锁事件
- **useHomeAnalytics.ts：** 从 `useMemoryStore.cards` 派生 total/totalLearned/mastered/masteryRate/byLevel/byStatus
- **useStreakStore：** `recordDay()` 用 `daysBetween`（本地时区 + `Math.round` 消除 DST 误差）判定连续

### 3.3 自定义 Hooks

| Hook | 文件 | 用途 | 状态 |
|------|------|------|------|
| useCursorGlow | [useCursorGlow.ts](file:///w:/项目仓库/For%20trae/wordaydream/src/hooks/useCursorGlow.ts) | 鼠标光晕跟随（永续 rAF） | 在用 |
| useBreathingEffect | [useBreathingEffect.ts](file:///w:/项目仓库/For%20trae/wordaydream/src/hooks/useBreathingEffect.ts) | `[data-breathing]` 正弦呼吸（永续 rAF） | 在用 |
| useInkSpread | [useInkSpread.ts](file:///w:/项目仓库/For%20trae/wordaydream/src/hooks/useInkSpread.ts) | 墨水扩散点击效果 | **死代码** |
| useScrollReveal | [useScrollReveal.ts](file:///w:/项目仓库/For%20trae/wordaydream/src/hooks/useScrollReveal.ts) | IntersectionObserver 滚动揭示 | 在用 |
| useTextReveal | [useTextReveal.ts](file:///w:/项目仓库/For%20trae/wordaydream/src/hooks/useTextReveal.ts) | 文本/段落揭示 | **死代码** |
| useKeyboardShortcuts | [useKeyboardShortcuts.ts](file:///w:/项目仓库/For%20trae/wordaydream/src/hooks/useKeyboardShortcuts.ts) | 快捷键注册表（模块级单例 Map） | 在用 |
| useGlobalShortcuts | [useGlobalShortcuts.ts](file:///w:/项目仓库/For%20trae/wordaydream/src/features/reading/hooks/useGlobalShortcuts.ts) | Escape + 评分快捷键 | 部分死代码 |
| usePanelPosition | [usePanelPosition.ts](file:///w:/项目仓库/For%20trae/wordaydream/src/hooks/usePanelPosition.ts) | popover 智能定位 | 在用 |
| useErrorHandler | [useErrorHandler.ts](file:///w:/项目仓库/For%20trae/wordaydream/src/hooks/useErrorHandler.ts) | 异步重试 + toast 反馈 | 在用 |

### 3.4 前端发现的风险点

#### [H1] 紧急：德语 `getDueCards` 语言判定正则错误

**文件：** [src/features/review/store/useMemoryStore.ts](file:///w:/项目仓库/For%20trae/wordaydream/src/features/review/store/useMemoryStore.ts) L117-129

```typescript
const isEnglish = /^[a-z]/i.test(card.lemma);
if (language === 'en' && !isEnglish) continue;
if (language === 'de' && isEnglish) continue;
```

**问题：** 正则 `/^[a-z]/i` 带了 `i` 标志，同时匹配大小写字母。德语名词一律大写首字母（如 "Haus"、"Straße"），`/^[a-z]/i.test("Haus")` 返回 `true` → `isEnglish=true` → 当 `language='de'` 时被 `continue` 跳过。

**影响：** 德语复习流 `startReview('de')` 调 `getDueCards('de')` 时，**所有德语名词卡片都会被过滤掉**，导致德语复习几乎无卡可练。

#### [H2] 紧急：FSRS `firstLearnedAt`/`last_review` 语义错误

**文件：** [src/features/review/services/schedulerAdapter.ts](file:///w:/项目仓库/For%20trae/wordaydream/src/features/review/services/schedulerAdapter.ts)

- `fsrsCardToMemoryCard`（L47-61）每次转换都写 `firstLearnedAt: Date.now()`，意味着每次评分都**重置** firstLearnedAt，而该字段语义上应为卡片首次学习时间（不可变）。
- `scheduleNextReview`（L101）把 `last_review: new Date(card.firstLearnedAt)` 喂给 ts-fsrs，但 firstLearnedAt 已被上一次评分污染。

**影响：** FSRS 调度算法的 `elapsed_days` 计算失真，复习间隔可能偏离预期。

#### [H3] 高：`useReviewSessionStore` 持久化整个瞬态

**文件：** [src/features/review/store/useReviewSessionStore.ts](file:///w:/项目仓库/For%20trae/wordaydream/src/features/review/store/useReviewSessionStore.ts) L306-311

该 store 的 persist 配置**没有 `partialize`**，`queue`/`results`/`userAnswer`/`isEvaluating`/`isPaused`/`showRatingBar` 全部持久化。

**影响：** 用户在复习中刷新页面，`isEvaluating:true`、`showRatingBar:true` 会被恢复，但底层 LLM 评估早已中断，UI 卡在"判题中"或评分栏悬空状态。

#### [H4] 高：`useReadingSessionStore` partialize 泄漏瞬态字段

**文件：** [src/features/reading/store/useReadingSessionStore.ts](file:///w:/项目仓库/For%20trae/wordaydream/src/features/reading/store/useReadingSessionStore.ts) L325-333

```typescript
partialize: (state) => ({
  ...state,  // ← 展开了全部字段（含 isLoading/activeOccurrenceId/hoveredGroupId）
  session: state.session ? {...} : null,
})
```

**影响：** 若用户在 `loadSession` 进行中（`isLoading:true`）刷新，重载后 `isLoading` 永远为 `true`，生成按钮永久禁用。

#### [M1] 中：孤儿组件群（约 200+ LOC 死代码）

- [StreamingPassagePanel.tsx](file:///w:/项目仓库/For%20trae/wordaydream/src/features/reading/components/StreamingPassagePanel.tsx)：仅自引用，未被任何页面 import
- [useStreamingPassage.ts](file:///w:/项目仓库/For%20trae/wordaydream/src/features/llm/hooks/useStreamingPassage.ts)：同上，无实际调用方
- [useInkSpread.ts](file:///w:/项目仓库/For%20trae/wordaydream/src/hooks/useInkSpread.ts)：`containerRef` Set 从未被读取
- [useTextReveal.ts](file:///w:/项目仓库/For%20trae/wordaydream/src/hooks/useTextReveal.ts)：无调用方

推测为 v1.4.1 流式预研遗留，未接入主流程。

#### [M2] 中：不可达成就

**文件：** [src/features/achievements/services/achievementEngine.ts](file:///w:/项目仓库/For%20trae/wordaydream/src/features/achievements/services/achievementEngine.ts) L218-219

隐藏成就 `polyglot_2` 要求 `ctx.languages.length >= 5`，但项目 `Language` 类型只有 `'en' | 'de'`（2 种）。该成就永远无法解锁。

#### [M3] 中：键盘处理碎片化

项目存在 **4 套**独立键盘监听路径，互不感知：
1. `useKeyboardShortcuts`（注册表 + scoped 全局 listener）
2. `useGlobalShortcuts`（reading 内，独立 window listener）— 其评分路径为死代码
3. `KeyboardShortcutsHelp`（独立 window listener）— 硬编码列表，未读取注册表
4. `RatingBar`（独立 window listener）

#### [M4] 中：双 streak 真相源

`useStreakStore.currentStreak` 与 `useAnalyticsStore.getStreak()` 是两套独立计算的连击逻辑，二者可能产生分歧。

#### [L1] 低：两条永续 requestAnimationFrame 循环

`useCursorGlow` + `useBreathingEffect` 在应用整个生命周期常驻，移动端电池/性能隐患。建议改为事件驱动或 `visibilitychange` 暂停。

#### [L2] 低：store 订阅粒度过粗

`ReadingSessionPage`/`ReviewSessionPage`/`InteractivePassage` 解构整个 store，订阅全部字段，任何 state 变更都触发重渲染。对比 `RatingBar`/`NotificationBanner` 用了细粒度 selector，风格不统一。

#### [L3] 低：无 schema 迁移

所有 store 都设了 `version` 字段但**没有任何 `migrate` 函数**。字段变更时旧用户 localStorage 数据存在运行时崩溃风险。

---

## 四、后端与 LLM 流式处理审查

### 4.1 后端架构：Netlify Edge Functions

**核心入口：** [netlify/edge-functions/llm-proxy.ts](file:///w:/项目仓库/For%20trae/wordaydream/netlify/edge-functions/llm-proxy.ts)

部署在 Netlify Edge Functions（Deno 运行时），设计意图是**对客户端完全隐藏上游 LLM 的 API key**。

**请求处理流程：**
1. CORS preflight（`handleCors`）→ OPTIONS 返回 204
2. 限流（`checkRateLimit(ip, 60)`）→ 超限返回 429
3. 方法校验 → 非 POST 返回 405
4. Body 解析 → 失败返回 400
5. 必填字段校验 → 缺 provider/prompt 返回 400
6. API key 注入 → `Deno.env.get("${provider.toUpperCase()}_API_KEY")`，缺失返回 500
7. 流式分支 → `body.stream === true` → `handleStreamRequest`，否则 → `handleNonStreamRequest`

### 4.2 三个 Provider 适配

| Provider | 文件 | 上游 API | 默认模型 | 流式支持 |
|----------|------|---------|---------|---------|
| OpenAI | [providers/openai.ts](file:///w:/项目仓库/For%20trae/wordaydream/netlify/edge-functions/providers/openai.ts) | api.openai.com/v1/chat/completions | gpt-4o-mini | 是 |
| Anthropic | [providers/anthropic.ts](file:///w:/项目仓库/For%20trae/wordaydream/netlify/edge-functions/providers/anthropic.ts) | api.anthropic.com/v1/messages | claude-3-5-sonnet-20241022 | 否 |
| DeepSeek | [providers/deepseek.ts](file:///w:/项目仓库/For%20trae/wordaydream/netlify/edge-functions/providers/deepseek.ts) | api.deepseek.com/v1/chat/completions | deepseek-chat | 否 |

**注意：** `anthropic.ts` 和 `deepseek.ts` 从 `openai.ts` 导入 `ProviderArgs`/`ProviderResult` 类型，存在耦合，建议提取到 `types.ts`。

### 4.3 前端 LLM 服务层

**调用链：**
```
useStreamingPassage (hook)
  → streamingGenerate (streamingProvider.ts)     [流式路径]

passageGenerator / evaluateAnswer / difficultyEvaluator
  → generateWithFallback (router.ts)             [非流式路径]
    → resolveProviderFn(settings)
      → mock? → MockLLMProvider.generate
      → else → getProvider() (providerFactory.ts)
        → routeOpenAI / routeAnthropic / routeDeepSeek
```

**router.ts 降级链路 [src/features/llm/services/router.ts](file:///w:/项目仓库/For%20trae/wordaydream/src/features/llm/services/router.ts)：**
1. 离线检测 → mock + 派发 `llm-offline` 通知
2. 显式 mock / disabled → mock
3. expectJson 路径 → `generateWithJsonRetry`（JSON parse 重试）
4. 非 JSON 路径 → `retryWithBackoff`（指数退避 + jitter）
5. 全失败兜底 → MockLLMProvider + `llm-fallback` Toast

**JSON 解析三层防御 [src/features/llm/services/jsonParser.ts](file:///w:/项目仓库/For%20trae/wordaydream/src/features/llm/services/jsonParser.ts)：**
1. `safeJsonParse`：markdown fence 剥离 + 尾随逗号清理 + 大括号配对提取
2. `parseLLMResponse`：`jsonrepair` 库修复 + `zod` schema 校验 + language compliance check
3. `parsePassagePayload`：业务级过滤（token slice 与 surfaceForm 不一致则丢弃）

### 4.4 SSE 流式处理机制

**后端 SSE 转发 [providers/openai.ts](file:///w:/项目仓库/For%20trae/wordaydream/netlify/edge-functions/providers/openai.ts) `openaiStreamProvider`：**
- 向 OpenAI 发送 `stream: true` 请求
- 构造新 `ReadableStream`，在 `start(controller)` 中逐 chunk 读取上游
- 把 OpenAI 的 `choices[].delta.content` 转换为客户端约定的 `{"delta":"..."}` 格式
- 流结束时发送 `data: [DONE]\n\n`

**前端 SSE 解析 [src/features/llm/services/llmStream.ts](file:///w:/项目仓库/For%20trae/wordaydream/src/features/llm/services/llmStream.ts) `parseSSEStream`：**
- `response.body.getReader()` 获取底层流
- `TextDecoder` 配置 `{ stream: true }` 处理跨 chunk 多字节字符
- `buffer` 累积不完整事件，按 `\n\n` 切分完整事件块
- 支持 `data: [DONE]` 哨兵终止 + AbortSignal

**流式 Provider 适配 [src/features/llm/services/streamingProvider.ts](file:///w:/项目仓库/For%20trae/wordaydream/src/features/llm/services/streamingProvider.ts) `streamingGenerate`：**
- 同步返回 `{ abort }` 句柄（fire-and-forget 模式）
- 双层 AbortController（内部联动外部 signal）
- `finalize` 闭包封装 `finished` 状态，防止重复回调
- fetch 失败/非 SSE 响应 → `runMockStream` fallback（100ms/chunk 模拟流式）

### 4.5 LLM 后端发现的风险点

#### [H5] 高：`withRetry` 的 signal 未传递给 fetch

**文件：** [netlify/edge-functions/utils/retry.ts](file:///w:/项目仓库/For%20trae/wordaydream/netlify/edge-functions/utils/retry.ts)

`withRetry` 创建了 `AbortController` + `setTimeout(timeoutMs)` 实现超时，但 **`controller.signal` 未传递给 `fn()`**。`fn` 内部的 `fetch` 调用没有接收 signal。

**影响：**
- 超时后 `withRetry` 进入 catch 块重试，但上一个 fetch 请求仍在后台运行
- 最坏情况下（30s 超时 + 1 次重试）会有 2 个并发 fetch 请求同时打到上游 LLM
- 超时机制形同虚设

#### [H6] 高：流式仅 OpenAI 支持的静默降级

**文件：** [netlify/edge-functions/llm-proxy.ts](file:///w:/项目仓库/For%20trae/wordaydream/netlify/edge-functions/llm-proxy.ts) L147-155

`handleStreamRequest` 对非 openai provider 返回 501。前端 `streamingProvider.ts` 检测到 `!response.ok` 后走 mock fallback。

**影响：** 如果用户在 Settings 中选了 anthropic 或 deepseek 并触发流式生成，会**静默降级到 mock 文本**，用户无感知。

#### [M5] 中：灰度路由的"一次性掷骰子"行为

**文件：** [src/features/llm/services/providerFactory.ts](file:///w:/项目仓库/For%20trae/wordaydream/src/features/llm/services/providerFactory.ts) `getProvider` L161

`getProvider()` 首次调用时根据灰度权重 `selectByWeight` 随机选择 provider 并**缓存**。后续所有请求走同一个 provider。

**影响：** 灰度发布实际上是"首次请求随机决定，之后固化"，而非每次请求独立抽样。如果应用生命周期内只调用一次 `getProvider()`，灰度效果等同于一次性掷骰子。

#### [M6] 中：SSE 解析边界情况

**后端 [providers/openai.ts](file:///w:/项目仓库/For%20trae/wordaydream/netlify/edge-functions/providers/openai.ts) L174-177：** `[DONE]` 提前 return 时未调 `controller.close()`，可能导致下游 ReadableStream 处于半开状态（实际影响有限，因前端依赖 `[DONE]` 哨兵主动退出）。

**前端 [llmStream.ts](file:///w:/项目仓库/For%20trae/wordaydream/src/features/llm/services/llmStream.ts) L130-136：** 网络 EOF 时 buffer 残余处理可能导致 done 回调被触发两次（`finalize` 闭包有 `if (finished) return` 保护，但 error 信号会被 done 信号覆盖）。

#### [M7] 中：流式错误恢复文本拼接问题

**文件：** [src/features/llm/services/streamingProvider.ts](file:///w:/项目仓库/For%20trae/wordaydream/src/features/llm/services/streamingProvider.ts)

`runStream` 中 SSE 解析出错时 fallback 到 `runMockStream`，但此时 SSE 流可能已推送部分 delta 到 `onChunk`，`buffer` 已累积真实文本。`runMockStream` 从头推送 mock 文本，导致前端看到"真实文本片段 + mock 文本"的拼接，语义不连贯。

#### [M8] 中：`createTimeoutSignal` 未清理 setTimeout

**文件：** [src/features/llm/services/router.ts](file:///w:/项目仓库/For%20trae/wordaydream/src/features/llm/services/router.ts) L106-110

```typescript
function createTimeoutSignal(seconds: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), seconds * 1000);
  return controller.signal;
}
```

`setTimeout` 没有被 `clearTimeout` 清理。高并发场景下会产生大量 dangling timer。

### 4.6 安全性分析

#### API Key 管理（良好）

- API key **仅在服务端**通过 `Deno.env.get()` 读取，客户端代码不持有真实 key
- `netlify.toml` 第 49-52 行明确：3 个服务端 key 不带 `VITE_` 前缀，通过 Netlify UI 设置
- `testProviderConnection` 走 Edge Function 探测（`maxTokens: 1`）

**风险：** `.env.example` 仍保留 `VITE_OPENAI_API_KEY` 等字段（v1.2.0 历史遗留），可能误导用户在客户端填入真实 key。

#### CORS（需收紧）

`utils/cors.ts` 使用 `Access-Control-Allow-Origin: *`，任何网站都可调用此 Edge Function。生产环境建议限制 Origin 为部署域名。

#### 限流（分布式失效）

`utils/rateLimit.ts` 使用**内存 Map** 计数：
- Edge Function 实例间不共享内存，限流效果大打折扣
- `requestCounts` Map 永远不主动清理过期条目，存在内存泄漏
- 注释明确承认："Edge runtime has ephemeral memory, so this is best-effort"
- 生产建议：改用 Deno KV / Netlify Blobs 做分布式计数

---

## 五、PWA 与离线模式审查

### 5.1 SW 架构

**存在两份 sw.js 源：**
1. [public/sw.js](file:///w:/项目仓库/For%20trae/wordaydream/public/sw.js)（手写，47 行，network-first）— CACHE_NAME = `wordaydream-v1.5.0-fallback`
2. vite-plugin-pwa 在 build 时生成的 `dist/sw.js`（workbox-based，precache + runtimeCaching）

**实际行为：** `vite build` 时 `public/sw.js` 被 Vite 复制到 `dist/sw.js`，**随后** vite-plugin-pwa 生成自己的 `dist/sw.js` 覆盖前者。从 `dist/` 目录可验证存在 `dist/sw.js` + `dist/workbox-9e0cfdd6.js`。

**结论：`public/sw.js` 在当前架构下是死代码，永远不会被浏览器加载。**

`public/sw.js` 注释声称"作为 dev mode + 老浏览器兜底"，但：
- dev 模式 `devOptions.enabled: false`，不注册 SW
- `main.tsx` 中 SW 注册条件是 `import.meta.env.PROD`，dev 不注册
- 即使手写 sw.js 被访问，也没有注册逻辑加载它

### 5.2 Manifest 双重定义

- [public/manifest.webmanifest](file:///w:/项目仓库/For%20trae/wordaydream/public/manifest.webmanifest)（15 行，静态文件）
- [vite.config.ts](file:///w:/项目仓库/For%20trae/wordaydream/vite.config.ts) L24-42 中的 `manifest: {...}` 配置

两份内容当前一致，但 vite-plugin-pwa 会用配置中的 manifest 覆盖 public 版本。**维护时容易遗漏同步**。

### 5.3 离线检测机制

**[src/features/llm/store/offlineMode.ts](file:///w:/项目仓库/For%20trae/wordaydream/src/features/llm/store/offlineMode.ts)：**
- `isOffline` 镜像 `navigator.onLine`
- `init()` 注册 online/offline 事件监听，返回 cleanup 函数
- 冷启动阶段**不派发 banner**（避免误报）
- `setOffline` 状态相同时 early return
- `partialize` 排除 `installPromptEvent`（DOM 事件不可序列化）

**已知问题（CHANGELOG v1.4.1 承认）：** `navigator.onLine` 不可靠——设备 wifi 仍连但实际无网络时，`OfflineBanner` 不会显示。

### 5.4 PWA 风险点

#### [H7] 高：`public/sw.js` 死代码 + manifest 双重定义

`public/sw.js` 永远不被加载，`public/manifest.webmanifest` 被 vite-plugin-pwa 覆盖。维护混淆。

#### [M9] 中：LLM API runtimeCaching 未显式排除 POST

`vite.config.ts` 中 LLM API 的 runtimeCaching 使用 `NetworkFirst` 策略，但 LLM 请求是 POST。workbox 默认不缓存 POST，所以实际不会被缓存——这是"意外的正确行为"，但配置层面没有显式排除。

#### [M10] 中：InstallPromptButton.tsx 注释提到不存在的测试

注释写道"InstallPromptButton.test.tsx (T01-T03) 验证 mount / click / dismiss 行为"，但通过 Glob 查找**该文件不存在**。

---

## 六、测试体系审查

### 6.1 测试文件统计

共 **32 个测试文件**：

| 类型 | 数量 | 示例 |
|------|------|------|
| 单元测试 (*.test.ts/tsx) | 27 | streamingProvider.test.ts, alignmentValidator.test.ts |
| 功能测试 (*.functional.test.ts) | 3 | glossAdapter / difficultyEvaluator / grammarDetector |
| 集成测试 (*.integration.test.ts) | 1 | alignmentValidator.integration.test.ts |
| 跨 stage 集成 (__integration__/) | 1 | passage-full-pipeline.test.tsx |
| 持久化迁移 (__tests__/) | 1 | persistMigration.test.ts |
| Edge Function 测试 | 1 | netlify/edge-functions/llm-proxy.test.ts |
| E2E (e2e/) | 1 | offline-install.spec.ts |

### 6.2 测试基础设施

**[vitest.config.ts](file:///w:/项目仓库/For%20trae/wordaydream/vitest.config.ts)：**
- `environment: 'jsdom'`，`globals: false`（显式 import 避免 全局污染）
- `setupFiles: ['./src/test/setup.ts']`
- `include` 3 个 glob：`src/**`, `src/__integration__/**`, `netlify/edge-functions/**`

**[src/test/setup.ts](file:///w:/项目仓库/For%20trae/wordaydream/src/test/setup.ts)：**
- 引入 `@testing-library/jest-dom/vitest`
- `afterEach`: `cleanup()` + `localStorage.clear()` + `sessionStorage.clear()`

**[src/__fixtures__/index.ts](file:///w:/项目仓库/For%20trae/wordaydream/src/__fixtures__/index.ts)：**
- 10 fixture 集中注册表（5 legacy v1.2.0 + 5 NEW v1.5.0 多语种）
- `FIXTURE_CATALOG` + `ALL_FIXTURES` + `NEW_FIXTURES_V150` + `LEGACY_FIXTURES_V120`
- 设计良好，单一事实源，供 `describe.each` 遍历

### 6.3 关键测试覆盖

| 测试文件 | 用例数 | 覆盖范围 |
|---------|--------|---------|
| streamingProvider.test.ts | T01-T03 | 成功/取消/错误路径 + mock fallback |
| passageGenerator.test.ts | T01-T05 | alignment status 4 态 + expectedLanguage 透传 |
| alignmentValidator.test.ts | T01-T08 | 5 步协议 + 中文 Unicode + 空文本边界 |
| alignmentValidator.integration.test.ts | IT01-IT05 | normalize + validate 串联 + `\r\n` 清洗 |
| passage-full-pipeline.test.tsx | T01-T10 | 跨 stage 全链路 + 5 多语种 fixture |
| router.test.ts | T01-T17 | jsonrepair/retry/fallback/3 provider dispatch |
| persistMigration.test.ts | — | 静态扫描 9 个 store 验证 persist 使用（架构守护） |

### 6.4 测试体系缺陷

#### [M11] 中：useStreamingPassage hook 无单元测试

源文件注释承认"本 hook 不写单测，行为由 streamingProvider.test.ts 覆盖"。但 hook 的 React 特有逻辑（useRef 持有 abort handle / useEffect cleanup / 组件卸载后 isMountedRef 阻止 setState）**未被任何测试覆盖**。

#### [M12] 中：e2e T03 (SW registration) 在当前配置下必然失败

`playwright.config.ts` 的 webServer 是 `npm run dev`（dev 模式），但 dev 模式不注册 SW。T03 依赖 production build，**在当前配置下必然失败**。

#### [M13] 中：e2e T01 的 mockUsed 硬编码 return true

`e2e/offline-install.spec.ts` line 76-81：`mockUsed` 直接 `return true`，注释说"实际由 Stage 1 mock fetch 验证"但未实现，测试无实际验证价值。

#### [M14] 中：CI lint 是 optional

`.github/workflows/netlify-deploy.yml` line 54：`npm run lint 2>&1 || echo "lint optional"`，lint 失败不阻断 CI，可能累积技术债。

#### [L4] 低：.oxlintrc.json 规则偏弱

仅 `react/rules-of-hooks: error` + `react/only-export-components: warn`，缺少 `no-unused-vars` / `no-explicit-any` 等常见规则。

---

## 七、构建与部署配置审查

### 7.1 构建配置

**[vite.config.ts](file:///w:/项目仓库/For%20trae/wordaydream/vite.config.ts)：** 简洁，`react()` + `VitePWA()` 两个插件。runtimeCaching 2 规则（LLM API NetworkFirst + Document StaleWhileRevalidate）。

**tsconfig.json：** 项目引用模式，分 app + node。`tsconfig.app.json`：target es2023, moduleResolution bundler, verbatimModuleSyntax, noEmit, jsx react-jsx, noUnusedLocals/Parameters。`include: ["src", "netlify/edge-functions"]` — Edge Function 也纳入类型检查。

**package.json scripts：** `dev / build (tsc -b && vite build) / lint / preview / test / test:run`。**缺失：** 无 `test:e2e` 脚本（需手动 `npx playwright test`），无 `build:analyze` 脚本。

### 7.2 部署配置

**[netlify.toml](file:///w:/项目仓库/For%20trae/wordaydream/netlify.toml)：**
- `command = "npm run build"`, `publish = "dist"`
- Edge Function 路由：`/.netlify/edge-functions/llm-proxy`
- SPA redirects：`/* -> /index.html, status 200, force false`
- Cache-Control 头：`/sw.js` max-age=0 must-revalidate（正确），`/assets/*` max-age=31536000 immutable（正确）

### 7.3 CI Workflows（3 个）

| Workflow | 触发 | 内容 |
|----------|------|------|
| lighthouse.yml | 每周一 cron + 手动 | treosh/lighthouse-ci-action@v11，5% buffer |
| netlify-deploy.yml | push main/develop + PR | lint(optional) + test + typecheck + build + deploy(2 attempts) + health check |
| playwright.yml | push + 每周六 cron | 4 browser projects |

**netlify-deploy.yml 设计问题：** `matrix.attempt: [1, 2]` 会让两个 attempt 都执行（即使第一个成功），浪费资源。应改用 step-level retry 或 `if: failure()` 条件。

### 7.4 环境变量问题

#### [M15] 中：.env.example 与实际架构不一致

**文件：** [.env.example](file:///w:/项目仓库/For%20trae/wordaydream/.env.example)

1. **provider 冗余**：列了 6 个 provider（openai/anthropic/deepseek/kimi/qwen/minimax），但代码只支持 3 个（openai/anthropic/deepseek），kimi/qwen/minimax 是死配置
2. **字段缺失**：netlify.toml 注释提到 `VITE_LLM_GRAYSCALE` / `VITE_OFFLINE_FALLBACK` / `VITE_APP_VERSION`，但 .env.example 没有列出
3. **历史遗留**：`VITE_OPENAI_API_KEY` 等字段是 v1.2.0 遗留，v1.3.0+ 前端 provider 走 Edge Function 不读这些 key

### 7.5 文档与代码不同步

#### [H8] 高：核心文档描述过时架构

**[docs/ARCHITECTURE.md](file:///w:/项目仓库/For%20trae/wordaydream/docs/ARCHITECTURE.md)：**
- Provider 表格漏了 DeepSeek（仅列 Mock/OpenAI/Anthropic）
- `LlmRouter` 代码示例仍是 class，实际 v1.4.0 已全面函数化
- `LLMSettings` 接口缺 deepseek/jsonMaxAttempts/streaming/timeout/maxRetries

**[docs/LLM.md](file:///w:/项目仓库/For%20trae/wordaydream/docs/LLM.md)：** 同样描述 class 架构，与实际不符。

**完整文档：** [docs/OPERATIONS.md](file:///w:/项目仓库/For%20trae/wordaydream/docs/OPERATIONS.md)（v1.5.1 运维手册，34 步骤 runbook）、[CHANGELOG.md](file:///w:/项目仓库/For%20trae/wordaydream/CHANGELOG.md)（0.5.0 到 v1.5.1 含 Bayesian posterior 累积）质量极高。

---

## 八、风险点汇总与优先级排序

### 紧急（功能性 Bug，需立即修复）

| ID | 问题 | 文件 | 影响 |
|----|------|------|------|
| H1 | 德语 `getDueCards` 正则 `/^[a-z]/i` 错误 | useMemoryStore.ts L117 | 德语复习功能完全不可用 |
| H2 | FSRS `firstLearnedAt`/`last_review` 语义错误 | schedulerAdapter.ts | 复习调度间隔计算失真 |

### 高（架构/安全/可用性风险）

| ID | 问题 | 文件 | 影响 |
|----|------|------|------|
| H3 | useReviewSessionStore 无 partialize 持久化瞬态 | useReviewSessionStore.ts L306 | 刷新后 UI 卡死 |
| H4 | useReadingSessionStore partialize 泄漏 isLoading 等 | useReadingSessionStore.ts L325 | 刷新后按钮永久禁用 |
| H5 | withRetry 的 signal 未传递给 fetch | retry.ts | 超时形同虚设，并发请求泄漏 |
| H6 | 流式仅 OpenAI 支持的静默降级 | llm-proxy.ts L147 | anthropic/deepseek 用户无感知拿 mock |
| H7 | public/sw.js 死代码 + manifest 双重定义 | public/sw.js, vite.config.ts | 维护混淆 |
| H8 | ARCHITECTURE.md/LLM.md 描述过时架构 | docs/ | 误导新开发者 |

### 中（死代码/配置/测试缺陷）

| ID | 问题 | 文件 | 影响 |
|----|------|------|------|
| M1 | 孤儿组件群 200+ LOC | StreamingPassagePanel/useStreamingPassage/useInkSpread/useTextReveal | 死代码 |
| M2 | 不可达成就 polyglot_2 | achievementEngine.ts L218 | 永远无法解锁 |
| M3 | 键盘处理 4 套碎片化 | 多文件 | 维护困难 |
| M4 | 双 streak 真相源 | useStreakStore + useAnalyticsStore | 数据分歧 |
| M5 | 灰度路由"一次性掷骰子" | providerFactory.ts L161 | 灰度效果不符预期 |
| M6 | SSE 解析边界情况 | openai.ts L174, llmStream.ts L130 | 资源释放/信号覆盖 |
| M7 | 流式错误恢复文本拼接 | streamingProvider.ts | 语义不连贯 |
| M8 | createTimeoutSignal 未清理 setTimeout | router.ts L106 | dangling timer |
| M9 | LLM API runtimeCaching 未显式排除 POST | vite.config.ts | 依赖 workbox 默认行为 |
| M10 | InstallPromptButton 注释提到不存在的测试 | InstallPromptButton.tsx | 文档与实现不符 |
| M11 | useStreamingPassage hook 无单元测试 | useStreamingPassage.ts | hook 逻辑未验证 |
| M12 | e2e T03 SW registration 必然失败 | offline-install.spec.ts + playwright.config.ts | E2E 无法通过 |
| M13 | e2e T01 mockUsed 硬编码 return true | offline-install.spec.ts L76 | 测试无验证价值 |
| M14 | CI lint 是 optional | netlify-deploy.yml L54 | 技术债累积 |
| M15 | .env.example 与实际架构不一致 | .env.example | 误导用户配置 |

### 低（性能/体验）

| ID | 问题 | 文件 | 影响 |
|----|------|------|------|
| L1 | 两条永续 rAF 循环 | useCursorGlow, useBreathingEffect | 移动端电池 |
| L2 | store 订阅粒度过粗 | ReadingSessionPage/ReviewSessionPage/InteractivePassage | 不必要重渲染 |
| L3 | 无 schema 迁移 | 所有 store | 字段变更崩溃风险 |
| L4 | oxlint 规则偏弱 | .oxlintrc.json | 缺少常见规则 |
| L5 | InteractivePassage 嵌套 setTimeout 清理不完整 | InteractivePassage.tsx L406 | 残留定时器 |
| L6 | useIsMobile resize 无防抖 | ReadingSessionPage.tsx L18 | 高频触发 |
| L7 | usePanelPosition scroll 监听未节流 | usePanelPosition.ts L96 | 性能 |

---

## 九、代码质量亮点

尽管存在上述问题，项目整体代码质量较高，值得肯定的设计：

1. **领域建模扎实**：`src/types/index.ts` 的 `TokenOccurrence`/`LexemeGroup`/`MemoryCard`/`Passage` 类型设计清晰，`alignmentStatus` 五态枚举（perfect/corrected/fallback/dropped/unknown）体现对 LLM 输出对齐问题的深刻认知。

2. **跨 store 通信模式正确**：全部使用 `XStore.getState()` 而非 hook 互订阅，依赖图严格单向无环，避免了 Zustand 最常见的循环订阅陷阱。

3. **LLM 对齐验证工业级**：`alignmentValidator.ts` 的 5 步协议（exact → case-insensitive → fuzzy → indexOf → dropped）配合 `levenshtein.ts` 和 `textNormalize.ts` 的 offsetMap 重映射，能有效处理 LLM 输出的 offset 漂移。

4. **JSON 解析三层防御**：`safeJsonParse`（markdown 剥离）→ `jsonrepair`（语法修复）→ `zod`（schema 校验），覆盖 LLM 输出常见问题。

5. **0 副作用导入原则**：`offlineMode.ts` 的 `init()` 手动触发模式，避免 module 顶层副作用，便于测试。

6. **fixture 集中注册表**：`src/__fixtures__/index.ts` 单一事实源，`describe.each` 驱动参数化测试。

7. **persistMigration 静态扫描测试**：用 `import.meta.glob` raw 模式加载源码验证 persist 使用，是优秀的架构守护测试。

8. **文档化程度极高**：几乎每个文件都有详尽 JSDoc 注释，记录版本演进轨迹；CHANGELOG 含 Bayesian posterior 累积；OPERATIONS.md 是 34 步骤可执行 runbook。

9. **防御性编程**：`finalize` 闭包的 `if (finished) return` 保护、`try/catch` 包裹 toast 通知、`isMountedRef` 防止卸载后 setState、`isValidRange` 越界守卫。

10. **0 emoji 硬约束**：全项目（源码 + 测试 + 文档 + CI workflow）严格无 emoji，一致性高。

---

## 十、改进建议

### 10.1 紧急修复（建议立即处理）

1. **修复德语 `getDueCards` 正则**：将 `/^[a-z]/i` 改为 `/^[a-z]/`（移除 `i` 标志），或改用更可靠的语言判定（如在 MemoryCard 上增加 `language` 字段）。

2. **修复 FSRS `firstLearnedAt` 语义**：`fsrsCardToMemoryCard` 不应重写 `firstLearnedAt`，应保留原值；`scheduleNextReview` 的 `last_review` 应使用 `Date.now()` 而非 `card.firstLearnedAt`。

### 10.2 高优先级改进

3. **为 review/reading session store 补 `partialize`**：仅持久化 `session`/`results`/`queue` 等必要字段，排除 `isLoading`/`isEvaluating`/`showRatingBar`/`userAnswer` 等瞬态。

4. **修复 `withRetry` 的 signal 传递**：将 `withRetry` 签名改为 `fn: (signal: AbortSignal) => Promise<T>`，provider 层的 `fetch` 接收 signal。

5. **流式支持扩展到 anthropic/deepseek**：或在 `streamingProvider` 检测到非 openai provider 时显式提示用户"当前 provider 不支持流式，将使用非流式生成"。

6. **清理 `public/sw.js` 和 `public/manifest.webmanifest`**：删除手写 SW，仅保留 vite.config.ts 中的 manifest 配置作为单一事实源。

7. **更新 ARCHITECTURE.md/LLM.md**：反映 v1.4.0+ 函数式架构，补充 DeepSeek provider、streaming、灰度等字段。

### 10.3 中优先级改进

8. **清理死代码**：删除 StreamingPassagePanel/useStreamingPassage/useInkSpread/useTextReveal，或接入主流程。

9. **统一键盘处理**：合并 4 套键盘系统到 `useKeyboardShortcuts` 注册表，`KeyboardShortcutsHelp` 读取注册表而非硬编码。

10. **为所有 store 补 `migrate` 函数**：即使当前 version 无变更，也应有 no-op migrate 作为防御。

11. **收紧 CORS**：将 `Access-Control-Allow-Origin: *` 改为部署域名白名单。

12. **限流迁移到分布式存储**：使用 Deno KV / Netlify Blobs 替代内存 Map。

13. **修复 e2e T03**：将 playwright.config.ts 的 webServer 改为 `npm run build && npm run preview`，或移除 T03。

14. **CI lint 改为 required**：移除 `|| echo "lint optional"`。

15. **清理 .env.example**：移除 kimi/qwen/minimax 死配置，补充 VITE_LLM_GRAYSCALE 等缺失字段。

### 10.4 低优先级改进

16. **rAF 循环优化**：`useCursorGlow`/`useBreathingEffect` 改为事件驱动或 `visibilitychange` 暂停。

17. **store 订阅细粒度化**：页面级组件改用 selector 订阅必要字段。

18. **补全 oxlint 规则**：增加 `no-unused-vars`/`no-explicit-any` 等。

19. **debounce resize/scroll 监听**：`useIsMobile` resize、`usePanelPosition` scroll 加防抖。

---

## 附录：关键文件索引

### 前端核心
| 关注点 | 文件 |
|--------|------|
| 入口/路由 | [src/main.tsx](file:///w:/项目仓库/For%20trae/wordaydream/src/main.tsx), [src/App.tsx](file:///w:/项目仓库/For%20trae/wordaydream/src/App.tsx) |
| 阅读编排 | [src/features/reading/store/useReadingSessionStore.ts](file:///w:/项目仓库/For%20trae/wordaydream/src/features/reading/store/useReadingSessionStore.ts) |
| 文章渲染 | [src/features/reading/components/InteractivePassage.tsx](file:///w:/项目仓库/For%20trae/wordaydream/src/features/reading/components/InteractivePassage.tsx) |
| 复习状态机 | [src/features/review/store/useReviewSessionStore.ts](file:///w:/项目仓库/For%20trae/wordaydream/src/features/review/store/useReviewSessionStore.ts) |
| FSRS 适配 | [src/features/review/services/schedulerAdapter.ts](file:///w:/项目仓库/For%20trae/wordaydream/src/features/review/services/schedulerAdapter.ts) |
| 记忆卡 store | [src/features/review/store/useMemoryStore.ts](file:///w:/项目仓库/For%20trae/wordaydream/src/features/review/store/useMemoryStore.ts) |
| 成就引擎 | [src/features/achievements/services/achievementEngine.ts](file:///w:/项目仓库/For%20trae/wordaydream/src/features/achievements/services/achievementEngine.ts) |

### LLM 服务层
| 关注点 | 文件 |
|--------|------|
| SSE 解析 | [src/features/llm/services/llmStream.ts](file:///w:/项目仓库/For%20trae/wordaydream/src/features/llm/services/llmStream.ts) |
| 流式 Provider | [src/features/llm/services/streamingProvider.ts](file:///w:/项目仓库/For%20trae/wordaydream/src/features/llm/services/streamingProvider.ts) |
| Provider 工厂 | [src/features/llm/services/providerFactory.ts](file:///w:/项目仓库/For%20trae/wordaydream/src/features/llm/services/providerFactory.ts) |
| 路由编排 | [src/features/llm/services/router.ts](file:///w:/项目仓库/For%20trae/wordaydream/src/features/llm/services/router.ts) |
| JSON 解析 | [src/features/llm/services/jsonParser.ts](file:///w:/项目仓库/For%20trae/wordaydream/src/features/llm/services/jsonParser.ts) |
| 对齐验证 | [src/features/llm/utils/alignmentValidator.ts](file:///w:/项目仓库/For%20trae/wordaydream/src/features/llm/utils/alignmentValidator.ts) |

### 后端
| 关注点 | 文件 |
|--------|------|
| Edge Function 入口 | [netlify/edge-functions/llm-proxy.ts](file:///w:/项目仓库/For%20trae/wordaydream/netlify/edge-functions/llm-proxy.ts) |
| OpenAI Provider | [netlify/edge-functions/providers/openai.ts](file:///w:/项目仓库/For%20trae/wordaydream/netlify/edge-functions/providers/openai.ts) |
| 限流 | [netlify/edge-functions/utils/rateLimit.ts](file:///w:/项目仓库/For%20trae/wordaydream/netlify/edge-functions/utils/rateLimit.ts) |
| 重试 | [netlify/edge-functions/utils/retry.ts](file:///w:/项目仓库/For%20trae/wordaydream/netlify/edge-functions/utils/retry.ts) |

### PWA/测试/部署
| 关注点 | 文件 |
|--------|------|
| 手写 SW（死代码） | [public/sw.js](file:///w:/项目仓库/For%20trae/wordaydream/public/sw.js) |
| 离线模式 | [src/features/llm/store/offlineMode.ts](file:///w:/项目仓库/For%20trae/wordaydream/src/features/llm/store/offlineMode.ts) |
| 测试配置 | [vitest.config.ts](file:///w:/项目仓库/For%20trae/wordaydream/vitest.config.ts) |
| 部署配置 | [netlify.toml](file:///w:/项目仓库/For%20trae/wordaydream/netlify.toml) |

---

**报告结束。** 本次审查共深入分析 60+ 个文件，覆盖前端架构、后端 LLM、PWA/离线、测试体系、构建部署、文档 6 个维度。所有发现均基于实际代码阅读，未修改任何文件。
