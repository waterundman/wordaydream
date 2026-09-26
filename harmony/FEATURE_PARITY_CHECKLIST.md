# Wordaydream Harmony Stage 4 — 14 Feature 模块功能对等清单

> **本文档的事实基线（版本 / 测试数 / SDK / 权限 / 能力状态 / 验证层级）以 [CURRENT_STATUS.md](./CURRENT_STATUS.md) 为唯一真源；本文件仅保留「14 个 feature 模块 × 验收点」的功能对照结构与其勾选状态。**

> **目的**: 验证 14 个 feature 模块在鸿蒙 ArkWeb 容器内全部可用, 与 Web 端功能对等, 无降级.
> **范围**: `src/features/` 下 14 个模块 + 关键用户流程 (生成文本 → 划词 → 评估 → 建卡 → FSRS 调度 → 复习 → 成就解锁)
> **测试基线**: 不在本文件维护数字；Web 端 vitest 当前通过数以 CURRENT_STATUS §5「当前 Web / TypeScript 工作树」为准（本文件创建时的 Stage 4 基线 656 项早已作废）。
> **测试覆盖**: `src/__integration__/harmony-feature-parity.test.ts` 自动验证每个模块的 entry point 可加载
> **验证层级提示**: 下文验收点均为「自动测试可覆盖」的静态/契约层；ArkWeb 容器内的运行时表现属模拟器/真机层级，判定口径见 CURRENT_STATUS §5「尚缺少的验证层级」与 §8 的四层规则。

---

## 1. 14 Feature 模块清单

| # | 模块 | 路径 | 关键符号 | Web 端测试 |
|---|---|---|---|---|
| 1 | reading | `src/features/reading/` | `ReadingSessionPage`, `InteractivePassage`, `useReadingSessionStore`, `useReadingHistoryStore`, `passageGenerator` | ReadingSessionPage.test.tsx + InteractivePassage.test.tsx + useReadingSessionStore.test.ts + useReadingHistoryStore.test.ts |
| 2 | review | `src/features/review/` | `ReviewSessionPage`, `RatingBar`, `useMemoryStore`, `useReviewSessionStore`, `schedulerAdapter`, `fsrsOptimizer` | ReviewSessionPage.test.tsx + useMemoryStore.test.ts + schedulerAdapter.test.ts + fsrsOptimizer.test.ts |
| 3 | grammar | `src/features/grammar/` | `GrammarPanel`, `GrammarHighlight`, `CompoundWordDisplay`, `grammarDetector`, `compoundSplitter` | grammarDetector.functional.test.ts + (component 测试) |
| 4 | analytics | `src/features/analytics/` | `AnalyticsPanel`, `AnalyticsChart`, `useAnalyticsStore`, `useHomeAnalytics` | useHomeAnalytics.test.ts |
| 5 | achievements | `src/features/achievements/` | `AchievementListModal`, `AchievementToast`, `useAchievementStore`, `achievementEngine` | useAchievementStore.test.ts |
| 6 | course | `src/features/course/` | `CoursePathPage`, `LessonCard`, `LessonCompleteModal`, `useCourseStore` | CoursePathPage.test.tsx + LessonCompleteModal.test.tsx + useCourseStore.test.ts |
| 7 | wordlist | `src/features/wordlist/` | `WordlistPage`, `WordlistRow`, `useWordlistStore` | WordlistPage.test.tsx + WordlistPage.csv.test.tsx + useWordlistStore.test.ts |
| 8 | settings | `src/features/settings/` | `SettingsPanel`, `useSettingsStore` | SettingsPanel.test.tsx + SettingsPanel.cache.test.tsx + SettingsPanel.status.test.tsx + useSettingsStore.cleanup.test.tsx + useSettingsStore.provider-migrate.test.ts |
| 9 | dictionary | `src/features/dictionary/` | `wiktextractAdapter`, `glossPersistentCache`, `cache` | glossPersistentCache.test.ts |
| 10 | evaluation | `src/features/evaluation/` | `evaluateAnswer`, `glossAdapter`, `RemedyPanel` | glossAdapter.cache.test.ts + glossAdapter.expectJson.test.ts + glossAdapter.functional.test.ts |
| 11 | graduation | `src/features/graduation/` | `GraduationModal` | (component 测试) |
| 12 | home | `src/features/home/` | `HomePage`, `HeroSection`, `TodayCard`, `TodayReviewCard`, `AchievementWall`, `ProgressRing`, `StreakBadge`, `CurrentLessonCard` | TodayCard.test.tsx + TodayReviewCard.test.tsx + CurrentLessonCard.test.tsx |
| 13 | streak | `src/features/streak/` | `useStreakStore` | useStreakStore.test.ts |
| 14 | llm | `src/features/llm/` | `router`, `providerFactory`, `llmAdapter`, `llmStream`, `openaiProvider`, `anthropicProvider`, `deepseekProvider`, `mockProvider`, `streamingProvider`, `useOfflineModeStore`, `prompts`, `llmConfig`, `jsonParser`, `alignmentValidator`, `levenshtein`, `textNormalize` | router.test.ts + router.expectJson.test.ts + providerFactory.test.ts + anthropicProvider.test.ts + deepseekProvider.test.ts + openaiProvider.test.ts + mockProvider.test.ts + streamingProvider.test.ts + offlineMode.test.ts + llmConfig.test.ts + prompts.test.ts + jsonParser.test.ts + jsonParser.schema.test.ts + jsonParser.repair.test.ts + adapters.expectJson.test.ts + alignmentValidator.test.ts + alignmentValidator.integration.test.ts + levenshtein.test.ts + textNormalize.test.ts |

> 注: `src/features/` 实有 16 个子目录, 其中 `difficulty-coupling`（DifficultySuggestion / difficultyEvaluator / difficultyAdvisor）与 `shortcuts`（`store/useShortcutsStore.ts`, 快捷键配置持久化）是辅助模块, 不计入 14 个核心 feature；前者的功能已包含在 evaluation + reading + llm 模块的用户流程中, 后者属设置类外围能力, 待补验收点。§2.1 R8 提到的 `useGlobalShortcuts` 实际位于 `src/features/reading/hooks/`, 归 reading 模块。

---

## 2. 验收点 (每个模块 5-10 条)

### 2.1 reading (阅读)

- [ ] **R1**: `ReadingSessionPage` 在 ArkWeb 内可挂载, 无白屏
- [ ] **R2**: `passageGenerator.generatePassage()` 调用 LLM Proxy (ArkWeb 跨域), 返回有效 Passage
- [ ] **R3**: `InteractivePassage` 渲染段落 + token 高亮, 点击词汇触发 `wiktextractAdapter.fetchEntry()`
- [ ] **R4**: `useReadingSessionStore.loadSession(language, difficulty)` 端到端跑通, session 状态正确写入
- [ ] **R5**: `useReadingHistoryStore.addEntry()` 写入历史, 跨刷新可读 (持久化)
- [ ] **R6**: `markOccurrenceResolved(occurrenceId)` 推进阅读进度, UI 实时更新
- [ ] **R7**: `getLinkedOccurrences(groupId)` 返回同词元组其它出现, 高亮联动
- [ ] **R8**: `useGlobalShortcuts` 键盘快捷键 (Tab/Enter/Esc) 在 ArkWeb 内有效
- [ ] **R9**: `WordUnveilAnimation` / `ResolvedUnderlineMotion` 动画遵守 `prefers-reduced-motion`
- [ ] **R10**: `ReadingHistoryPanel` 显示历史列表, 点击可 `loadFromHistory`

### 2.2 review (复习)

- [ ] **RV1**: `ReviewSessionPage` 在 ArkWeb 内可挂载
- [ ] **RV2**: `useMemoryStore.addCardFromToken(token, language)` 建卡, cards Map 更新
- [ ] **RV3**: `useMemoryStore.rateCard(cardId, rating)` 走 `schedulerAdapter` (FSRS), due/stability/difficulty 更新
- [ ] **RV4**: `useMemoryStore.getDueCards(language, now, states)` 返回到期卡片, states 过滤正确
- [ ] **RV5**: `useReviewSessionStore.startReview(language)` 加载队列, mode='reviewing'
- [ ] **RV6**: `submitAnswer(answer)` 走 `evaluateAnswer` → LLM Proxy 评估, evaluation 状态写入
- [ ] **RV7**: `completeReview(rating)` 调 `rateCard`, nextCard 推进, results 数组更新
- [ ] **RV8**: `RatingBar` 4 按钮评分 (Again/Hard/Good/Easy) 可点击, 键盘可达
- [ ] **RV9**: `MemoryTray` 显示新建卡 (newlyAdded), clearNewlyAdded 正确清空
- [ ] **RV10**: `ExportButton` 导出 CSV (exportService), ArkWeb 内下载可用

### 2.3 grammar (语法)

- [ ] **G1**: `GrammarPanel` 在 ArkWeb 内可挂载
- [ ] **G2**: `grammarDetector.detect(passage)` 返回 GrammarPoint[], 高亮渲染
- [ ] **G3**: `CompoundWordDisplay` 显示复合词组成部分
- [ ] **G4**: `compoundSplitter.split(lemma)` 返回 compoundParts[]
- [ ] **G5**: `GrammarHighlight` 高亮区域可点击, 弹出 GrammarPanel 详情
- [ ] **G6**: 焦点 trap (useFocusTrap) 在 GrammarPanel modal 内有效
- [ ] **G7**: `prefers-reduced-motion` 时动画禁用

### 2.4 analytics (分析)

- [ ] **A1**: `AnalyticsPanel` 在 ArkWeb 内可挂载
- [ ] **A2**: `useAnalyticsStore.addLearningRecord(count)` 写入 dailyRecords, 跨刷新可读
- [ ] **A3**: `useHomeAnalytics` 计算总学习数 / 复习统计 / 掌握率 / 难度分布 / 掌握分布
- [ ] **A4**: `AnalyticsChart` 渲染曲线图 / 柱状图, 数据正确
- [ ] **A5**: `getStreak()` 返回连续学习天数 (与 useStreakStore 同步)
- [ ] **A6**: `getLearningCurve(days)` 返回最近 N 天的记录数组
- [ ] **A7**: `getAccuracyTrend(days)` / `getDailyDuration(days)` 派生数据正确

### 2.5 achievements (成就)

- [ ] **AC1**: `AchievementListModal` 在 ArkWeb 内可挂载
- [ ] **AC2**: `useAchievementStore.checkAndUnlock(ctx)` 解锁条件触发, achievements 数组更新
- [ ] **AC3**: 解锁时 `AchievementToast` 弹出, 5 秒后自动消失 (或手动 dismiss)
- [ ] **AC4**: `dismissToast(id)` 从 newUnlocks 队列移除
- [ ] **AC5**: 13 个成就快照在初始 state 正确加载
- [ ] **AC6**: `achievementEngine` 评估 streak / cards / mastery / accuracy / difficulty 等条件
- [ ] **AC7**: 跨刷新后已解锁成就保留 (持久化)
- [ ] **AC8**: `AchievementWall` 在首页显示已解锁成就

### 2.6 course (课程)

- [ ] **C1**: `CoursePathPage` 在 ArkWeb 内可挂载
- [ ] **C2**: `useCourseStore` 加载课程路径数据 (modules + lessons)
- [ ] **C3**: `LessonCard` 显示课程状态 (locked / active / completed)
- [ ] **C4**: 点击 active `LessonCard` 跳转到阅读会话 (lastConfig 同步)
- [ ] **C5**: `LessonCompleteModal` 显示完成统计, 关闭后回到 CoursePathPage
- [ ] **C6**: `ModuleSection` 分组显示课程, 折叠 / 展开有效
- [ ] **C7**: 跨刷新后课程进度保留 (持久化)

### 2.7 wordlist (词库)

- [ ] **W1**: `WordlistPage` 在 ArkWeb 内可挂载
- [ ] **W2**: `useWordlistStore.progress` 记录每个 lemma 的状态 (new / learning / mastered)
- [ ] **W3**: `markWordLearning(language, lemma)` / `markWordMastered(language, lemma)` 更新 progress
- [ ] **W4**: `recordEncounter(language, lemma, passageId)` 记录遇见次数
- [ ] **W5**: `syncFromMemoryCards(cards)` 把 useMemoryStore.cards 同步到 progress
- [ ] **W6**: `getLevelTotalSync(language, difficulty)` 返回当前级别总词数
- [ ] **W7**: `getMasteredCount(language, difficulty)` 返回已掌握词数
- [ ] **W8**: CSV 导入 (`WordlistPage` 内) 写入 IndexedDB csvStorage, 跨刷新可读
- [ ] **W9**: `linearMode` 切换学习模式 (按顺序 / 随机), 持久化
- [ ] **W10**: `dailyGoal` 设置 / 跨日重置 / 持久化

### 2.8 settings (设置)

- [ ] **S1**: `SettingsPanel` 在 ArkWeb 内可挂载
- [ ] **S2**: `useSettingsStore.setProvider(provider)` 切换 LLM provider, 持久化
- [ ] **S3**: `setTheme(theme)` 切换 light / dark / sepia, tokens.css 立即生效
- [ ] **S4**: `setDifficulty(level)` 切换难度 (1-5), 持久化
- [ ] **S5**: `testConnection()` 调 LLM Proxy 探测, 返回 ok/error
- [ ] **S6**: `exportSettings()` / `importSettings(json)` 配置导入导出
- [ ] **S7**: `incrementReadingSeconds(delta)` / `resetTodayIfNewDay(today)` 跨日重置
- [ ] **S8**: 跨刷新后所有 settings 字段保留 (持久化 version 7)
- [ ] **S9**: `useFocusTrap` 在 SettingsPanel modal 内有效 (Tab 循环 / Esc 关闭)
- [ ] **S10**: ARIA 属性 (`role="dialog"` / `aria-modal="true"`) 完整

### 2.9 dictionary (字典)

- [ ] **D1**: `wiktextractAdapter.fetchEntry(lemma, language)` 调用字典 API
- [ ] **D2**: `glossPersistentCache.getCachedGloss(language, lemma)` 命中返回 CachedGloss, 未命中返回 null
- [ ] **D3**: `glossPersistentCache.setCachedGloss(language, lemma, gloss)` 写入 IndexedDB, 跨刷新可读
- [ ] **D4**: TTL 30 天过期检查, 命中但过期时删除 entry 返回 null
- [ ] **D5**: LRU 5000 条上限淘汰, 超量时删 timestamp 最旧的
- [ ] **D6**: `sourceHash` 校验: 字典原文变化时缓存自动失效
- [ ] **D7**: IndexedDB 不可用时降级到内存 Map (不抛错)
- [ ] **D8**: `clearAllCachedGlosses()` / `pruneExpiredEntries()` 维护接口可用
- [ ] **D9**: `getCachedGlossCount()` 返回当前缓存条数

### 2.10 evaluation (评估)

- [ ] **E1**: `evaluateAnswer(question, userAnswer, ctx)` 走 LLM Proxy 评估
- [ ] **E2**: `glossAdapter` 改写字典原文为中文释义, 走 LLM Proxy
- [ ] **E3**: `glossAdapter` 命中 `glossPersistentCache` 时跳过 LLM, 直接返回缓存
- [ ] **E4**: 评估结果含 grade (correct / partial / incorrect) + feedback
- [ ] **E5**: `RemedyPanel` 显示补救学习建议 (错误时)
- [ ] **E6**: `evaluateAnswer` 失败时 fallback 到 mock 评估 (不阻塞用户流程)
- [ ] **E7**: `glossAdapter.computeSourceHash` 字典原文稳定 hash

### 2.11 graduation (毕业)

- [ ] **GR1**: `GraduationModal` 在 ArkWeb 内可挂载
- [ ] **GR2**: 满足毕业条件时 (难度所有词掌握) 自动弹出
- [ ] **GR3**: 显示毕业统计数据 (学习时长 / 卡片数 / 准确率)
- [ ] **GR4**: "确认毕业" 按钮跳转到下一难度
- [ ] **GR5**: `useFocusTrap` 在 modal 内有效
- [ ] **GR6**: ARIA 属性完整 (`role="dialog"` / `aria-modal`)

### 2.12 home (首页)

- [ ] **H1**: `HomePage` 在 ArkWeb 内可挂载, 首屏渲染 < 1s
- [ ] **H2**: `HeroSection` 显示应用标题 / 副标题 / CTA 按钮
- [ ] **H3**: `TodayCard` 显示今日学习卡片数 + 进度环
- [ ] **H4**: `TodayReviewCard` 显示今日待复习卡片数, 点击跳转复习
- [ ] **H5**: `CurrentLessonCard` 显示当前课程, 点击跳转阅读
- [ ] **H6**: `AchievementWall` 显示最近解锁成就
- [ ] **H7**: `ProgressRing` SVG 进度环渲染正确 (light / dark / sepia 三套主题)
- [ ] **H8**: `StreakBadge` 显示连续学习天数
- [ ] **H9**: `Dividers` 分隔线在 light / dark / sepia 三套主题下颜色正确
- [ ] **H10**: 响应式断点 (sm / md / lg) 在 ArkWeb viewport 内有效

### 2.13 streak (连续天数)

- [ ] **ST1**: `useStreakStore.recordDay()` 累计 currentStreak
- [ ] **ST2**: 跨日 (lastStudyDate + 1 天) 时 currentStreak+1
- [ ] **ST3**: 跨多日 (gap > 1) 时 currentStreak 重置为 1
- [ ] **ST4**: 同一天重复 recordDay 不累加 (幂等)
- [ ] **ST5**: `longestStreak` 始终保持历史最大值
- [ ] **ST6**: 跨刷新后 lastStudyDate / currentStreak / longestStreak 保留 (持久化)
- [ ] **ST7**: `reset()` 清空所有字段

### 2.14 llm (LLM 服务)

- [ ] **L1**: `router.generateWithFallback(settings, options)` 调用 LLM Proxy, 返回 LLMResponse
- [ ] **L2**: `providerFactory.getProvider()` 路由到 openai / anthropic / deepseek 函数
- [ ] **L3**: `providerFactory.selectByWeight(grayscale)` 灰度发布加权随机
- [ ] **L4**: `mockProvider.generate(options)` mock 模式返回内置示例
- [ ] **L5**: `streamingProvider.streamingGenerate(options, handler)` SSE 流式生成
- [ ] **L6**: `useOfflineModeStore` navigator.onLine=false 时短路到 mock
- [ ] **L7**: `jsonParser.parseLLMResponse(text, { schema, expectedLanguage })` 解析 + jsonrepair + zod 校验
- [ ] **L8**: `alignmentValidator.validateAndAlignPassagePayload(payload, text)` 6 步对齐 token offsets
- [ ] **L9**: `levenshtein.distance(a, b)` 模糊匹配距离计算
- [ ] **L10**: `textNormalize.normalizePassagePayload(payload)` 文本规范化

---

## 3. 关键用户流程 (跨模块)

### 3.1 生成文本 → 划词 → 评估 → 建卡 → FSRS 调度 → 复习 → 成就解锁

```
1. home.HomePage 挂载, 显示 TodayCard / TodayReviewCard / CurrentLessonCard
2. 点击 TodayCard 或 CurrentLessonCard → reading.ReadingSessionPage 挂载
3. reading.passageGenerator.generatePassage(forceRefresh)
   → llm.router.generateWithFallback(settings, options)
   → llm.providerFactory.getProvider() (openai/anthropic/deepseek)
   → 走 harmony/server/llm-proxy.js (ArkWeb 跨域调用)
   → llm.jsonParser.parseLLMResponse (jsonrepair + zod)
   → llm.textNormalize.normalizePassagePayload
   → llm.alignmentValidator.validateAndAlignPassagePayload (6 步对齐)
4. reading.InteractivePassage 渲染段落 + token 高亮
5. 用户点击词汇 → dictionary.wiktextractAdapter.fetchEntry(lemma, language)
   → evaluation.glossAdapter (LLM 改写为中文释义)
   → dictionary.glossPersistentCache.setCachedGloss (IndexedDB 持久化)
6. 用户提交答案 → evaluation.evaluateAnswer(question, userAnswer, ctx)
   → 走 LLM Proxy 评估
   → 返回 grade + feedback
7. grade === 'correct' 时 → review.useMemoryStore.addCardFromToken(token, language)
   → 建卡 (createInitialMemoryCard, status='new', reps=0)
   → analytics.useAnalyticsStore.addLearningRecord(1)
   → wordlist.useWordlistStore.markWordLearning(language, lemma)
   → reading.useReadingSessionStore.markOccurrenceResolved(occurrenceId)
8. reading.useReadingSessionStore.markOccurrenceResolved → UI 进度推进
9. analytics.useAnalyticsStore.addAnswerRecord(isCorrect)
10. streak.useStreakStore.recordDay() (累计连续天数)
11. achievements.useAchievementStore.checkAndUnlock(ctx)
    → achievementEngine 评估条件
    → 解锁时 achievements.AchievementToast 弹出
    → home.AchievementWall 更新
12. 跨日: 阅读会话结束后, settings.useSettingsStore.incrementReadingSeconds(delta)
    → settings.resetTodayIfNewDay(today) 跨日重置 totalSecondsToday
13. 复习阶段: review.useReviewSessionStore.startReview(language)
    → review.useMemoryStore.getDueCards(language, now, ['review', 'relearning'])
    → 注入复习词到 passage (buildReviewTokens)
    → 用户输入答案 → evaluation.evaluateAnswer
    → 用户选择评分 → review.useMemoryStore.rateCard(cardId, rating)
    → review.schedulerAdapter.scheduleNextReview (FSRS)
    → 新卡 due 后延 4 小时 (避免当次会话立即复现)
    → analytics.useAnalyticsStore.addLearningRecord + addAnswerRecord
    → review.useReviewSessionStore.completeReview(rating) → nextCard 推进
14. 全部完成后: achievements.checkAndUnlock 再次评估 (复习相关成就)
    → graduation.GraduationModal (难度所有词掌握时) 弹出
```

### 3.2 设置面板 → 切换主题 → 切换 provider → 测试连接

```
1. settings.SettingsPanel 挂载
2. setTheme('dark') → tokens.css 应用 dark 主题色板
3. setProvider('deepseek') → llm.providerFactory.resetProviderCache()
4. testConnection() → llm.router.testProviderConnection(settings)
   → POST harmony/server/llm-proxy.js /api/llm (maxTokens=1)
   → 200 ok = 服务端 API key 已配置
   → 500 + code:MISSING_API_KEY = 服务端无 key
5. setDifficulty(3) → 切换难度, 下次 generatePassage 用新难度
6. 关闭 SettingsPanel → useFocusTrap 焦点回到触发按钮
```

---

## 4. ArkWeb 兼容性验证

### 4.1 持久化 (IndexedDB + localStorage)

| 数据层 | 存储 | 验收点 |
|---|---|---|
| csvStorage | IndexedDB `wordaydream-csv-wordlists` | 跨刷新数据完整 |
| glossPersistentCache | IndexedDB `wordaydream-gloss-cache` | 跨刷新数据完整 + TTL + LRU |
| 10 个 Zustand persist store | localStorage | 跨刷新数据完整 |

10 个 Zustand persist store (来自 ARCHITECTURE.md §持久化策略):

| Store | localStorage Key | version |
|---|---|---|
| useSettingsStore | wordaydream:settings | 7 |
| useReadingSessionStore | wordaydream:reading-session | 1 |
| useReadingHistoryStore | wordaydream:reading-history | 2 |
| useMemoryStore | wordaydream:memory | 2 |
| useReviewSessionStore | wordaydream:review-session | 1 |
| useAnalyticsStore | wordaydream:analytics | 1 |
| useWordlistStore | wordaydream:wordlist | 4 |
| useAchievementStore | wordaydream:achievements | 1 |
| useStreakStore | wordaydream:streak | 1 |
| useOfflineModeStore | wordaydream-offline-mode | 1 |

### 4.2 主题切换 (light / dark / sepia)

- [ ] tokens.css 三套主题色板 (12 个状态色变量 / light / dark / sepia)
- [ ] `useSettingsStore.setTheme(theme)` 切换 + 持久化
- [ ] `document.documentElement.setAttribute('data-theme', theme)` (或类似机制) 立即生效
- [ ] 阅读区约束 (暖白纸 #faf8f5 + 深墨 #1c1917 in light theme) 在三套主题下保持可读

### 4.3 可访问性 (ARIA / focus trap / prefers-reduced-motion)

- [ ] 所有交互组件 ARIA 属性完整 (`role` / `aria-label` / `aria-modal` / `aria-live`)
- [ ] `useFocusTrap` Hook 在 modal 内有效 (Tab / Shift+Tab 循环)
- [ ] 所有动画支持 `prefers-reduced-motion` 媒体查询
- [ ] 所有可点击 div 改为 `<button>` (Enter / Space 激活)

### 4.4 LLM 调用链路

- [ ] ArkWeb → harmony/server/llm-proxy.js → 上游 LLM API
- [ ] CORS 预检 (OPTIONS) 通过
- [ ] JSON 模式 (默认) 200 OK
- [ ] SSE 模式 (`stream: true`) 200 OK + `Content-Type: text/event-stream`
- [ ] API key 仅后端持有, ArkWeb 不接触
- [ ] 离线模式 (navigator.onLine=false) auto-fallback 到 mock

---

## 5. 测试矩阵

| 测试类型 | 文件 | 覆盖范围 |
|---|---|---|
| 单元测试 (vitest) | `src/features/**/*.test.{ts,tsx}` | Web 端全量回归（数字见 CURRENT_STATUS §5，本文件不维护） |
| 集成测试 (vitest) | `src/__integration__/passage-full-pipeline.test.tsx` | 10 case 跨 stage pipeline (existing) |
| 集成测试 (vitest) | `src/__integration__/harmony-llm-proxy.test.ts` | T01 LLM Proxy 启动 + CORS |
| 集成测试 (vitest) | `src/__integration__/harmony-feature-parity.test.ts` | T02 14 feature 模块可加载 |
| 集成测试 (vitest) | `src/__integration__/harmony-indexeddb-persistence.test.ts` | T03-T05 持久化 (10 store + csvStorage + glossPersistentCache) |
| 集成测试 (vitest) | `src/__integration__/harmony-theme-parity.test.ts` | T06 三套主题切换 |
| E2E (Playwright) | `e2e/harmony.spec.ts` | T08 主流程 (首页 → 阅读 → 复习 → 设置) |

---

## 6. 已知限制 (Stage 4 不验证)

- ~~**module.json5 未声明 VIBRATE 权限**~~ — **已更正**：`ohos.permission.VIBRATE` 与 `ohos.permission.INTERNET` 均已在 `harmony/entry/src/main/module.json5` 声明（口径见 CURRENT_STATUS §2「原生权限」行）。剩余风险不是「未声明」，而是**模拟器不能证明真实触觉反馈**，故振动仍是「已实现，待真机验收」。
- **DevEco 真机缺失** (T08 E2E soft gate, 无真机时 SKIP)
- **ArkWeb IndexedDB 配额限制** (大 CSV 词库可能触发 quota exceeded, Stage 5+ 评估)
- **ArkWeb SW 支持路径** — 结论已定：harmony 构建**主动禁用 PWA / Service Worker 与 `.br`/`.gz` sidecar**，ArkWeb 走虚拟 HTTPS 同源入口加载 HAP 内 rawfile（见 CURRENT_STATUS §3「PWA / Service Worker」行），不再评估 SW 路径。
- **ArkWeb `prefers-reduced-motion` 媒体查询** (待真机验证)
- **async JSProxy 复杂返回值**：API 22 webview 下对象/数组回执不可用，桥接层统一以 JSON 字符串回传（契约见 CURRENT_STATUS §3 JavaScriptProxy 行）。

---

## 7. 变更日志

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-07-24 | v0.1.0-harmony Stage 4 | 初始创建, 14 feature × 5-10 验收点 |
| 2026-09-26 | — | 文档收口：移除自维护的 vitest 数字（656 基线作废，改链 CURRENT_STATUS §5）；更正「未声明 VIBRATE」为已声明、待真机触觉验收；SW 项改为已定结论（harmony 禁用 PWA）；补 async JSProxy 复杂返回契约提示；澄清辅助模块为 difficulty-coupling 与 shortcuts。 |
