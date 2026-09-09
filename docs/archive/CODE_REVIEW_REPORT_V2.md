# Wordaydream v1.5.2 全量代码审查报告 V2

**审查日期**: 2026-07-10
**审查版本**: v1.5.2 (v1.5.2 迭代修复 30 问题 + 5 核心 bug 后)
**审查范围**: 6 维度 (架构设计 / 类型安全 / 运行时健壮性 / 状态管理 / 性能 / 测试覆盖)
**审查文件**: 20 个核心文件 + 横切关注点 (tsconfig / package.json / 全量 store / 类型定义)

---

## 1. 执行摘要

### 整体健康度评分: **78 / 100**

| 维度 | 评分 | 说明 |
|------|------|------|
| 架构与设计 | 85/100 | Feature-Sliced 边界清晰, provider factory + 灰度路由设计优秀, 但 store 间耦合略多 |
| 类型安全 | 65/100 | tsconfig 未启用 `strict: true`, `as any` / `as unknown as` 使用较多, 接口可选性不一致 |
| 运行时健壮性 | 80/100 | v1.5.2 修复了主要 timeout/timer cleanup, 但仍有竞态条件和静默吞错 |
| 状态管理 | 75/100 | 10 个 store 职责划分合理, 但 Set 序列化 hack、持久化过期快照、partialize 不一致 |
| 性能 | 82/100 | memo/useCallback 使用充分, 但缺大列表虚拟化, store getter 未 memoize |
| 测试覆盖 | 72/100 | 31 个测试文件覆盖 LLM/FSRS/alignment 核心, 但 grammarDetector LLM 路径/竞态/Edge Function 无测试 |

### 关键发现

1. **grammarDetector LLM 路径完全失效** (P1): `expectJson: true` 走 `parseLLMResponse` → `PassagePayloadSchema`, 但语法检测返回 JSON 数组而非 PassagePayload 对象, zod 永远拒绝, 导致 LLM 语法检测 100% fallback 到 mock, 用户永远只看到 mock 语法点。
2. **tsconfig 未启用 `strict: true`** (P1): 项目声称 "TypeScript 6 严格模式", 但 `tsconfig.app.json` 缺少 `"strict": true`, 导致 `strictNullChecks` / `noImplicitAny` 等关键检查未生效。
3. **AbortSignal.any() 兼容性风险** (P1): `router.ts:390` 使用 `AbortSignal.any()`, 该 API 在 Safari < 17.4 / Firefox < 124 不支持, 可导致 LLM 请求在旧浏览器直接报错。
4. **6 个 P2 级问题**: 持久化过期快照 / 异步竞态 / 静默吞错 / mock 随机位置 / localStorage 膨胀 / 请求无取消。
5. **架构亮点**: providerFactory 灰度路由 + 每次抽样不缓存 (v1.5.2 fix M5) 设计精良; alignmentValidator 5 步协议是 LLM offset 校正的工业级实现; SSE streaming 的 buffer reset + mock fallback 链路完整。

---

## 2. 风险矩阵

| ID | 优先级 | 文件 | 简述 |
|----|--------|------|------|
| V2-P1-001 | P1 | `src/features/grammar/services/grammarDetector.ts` | LLM 语法检测因 expectJson + JSON 数组不兼容而永远失败 |
| V2-P1-002 | P1 | `tsconfig.app.json` | 未启用 `strict: true`, 声称严格模式但实际未开启 |
| V2-P1-003 | P1 | `src/features/llm/services/router.ts:390` | `AbortSignal.any()` 在旧浏览器不支持, 无 polyfill |
| V2-P2-001 | P2 | `src/features/review/store/useReviewSessionStore.ts` | 持久化 queue (MemoryCard[] 快照), 重载后 FSRS 状态过期 |
| V2-P2-002 | P2 | `src/features/review/services/schedulerAdapter.ts:117` | `(result as any)[fsrsRating]` 绕过类型安全 |
| V2-P2-003 | P2 | `src/features/grammar/components/CompoundWordDisplay.tsx:22-30` | splitCompound 异步竞态, token 切换后 stale setCompoundData |
| V2-P2-004 | P2 | `src/features/reading/store/useReadingSessionStore.ts:100-201` | loadSession 无 AbortController, 快速连续点击产生竞态 |
| V2-P2-005 | P2 | `src/features/reading/services/passageGenerator.ts:332` | catch 块静默吞错, 无日志输出 |
| V2-P2-006 | P2 | `src/features/grammar/services/grammarDetector.ts:115-116` | mockDetectGrammarPoints 用 Math.random 生成 startIndex, 位置错误 |
| V2-P2-007 | P2 | `src/features/reading/store/useReadingHistoryStore.ts` + `useReadingSessionStore.ts` | 持久化 50 条完整 Passage (含 tokens), localStorage 膨胀风险 |
| V2-P2-008 | P2 | `src/features/reading/store/useReadingSessionStore.ts:48-53` | buildReviewTokens 中 usedIndices 死代码 |
| V2-P2-009 | P2 | `src/features/reading/ReadingSessionPage.tsx:90-95` | 首次加载时 language/difficulty 初始值与持久化 session 不同步 |
| V2-P3-001 | P3 | `src/features/analytics/store/useAnalyticsStore.ts:221-257` | getStreak 与 useStreakStore 逻辑重复, 两套 streak 可分歧 |
| V2-P3-002 | P3 | `src/features/reading/store/useReadingSessionStore.ts:347` | partialize Set 序列化用 `as unknown as Set<string>` hack |
| V2-P3-003 | P3 | `src/store/useToastStore.ts:40-42` | addToast setTimeout 无 cleanup, 快速连发累积 timer |
| V2-P3-004 | P3 | `src/features/evaluation/components/RemedyPanel.tsx:113` | hasUmlaut 启发式判断语言, 无 umlaut 德语词取英文句 |
| V2-P3-005 | P3 | `src/features/reading/ReadingSessionPage.tsx:97-108` | resolved tokens 同步 effect 依赖含 session 对象, 每次更新都重跑 |
| V2-P3-006 | P3 | `src/types/index.ts:215` | MemoryCard.lastReviewAt 标注可选但 schedulerAdapter 始终赋值 |

---

## 3. 详细发现

### V2-P1-001: grammarDetector LLM 路径完全失效

- **优先级**: P1 (高)
- **位置**: `w:\项目仓库\For trae\wordaydream\src\features\grammar\services\grammarDetector.ts` L136-199
- **问题描述**:
  `llmDetectGrammarPoints` 函数通过 `generateWithFallback(llm, { expectJson: true, ... })` 调用 LLM 获取语法点。但 LLM 返回的是 JSON **数组** (`[{ id, text, ... }, ...]`), 而 `expectJson: true` 路由到 `generateWithJsonRetry` → `parseLLMResponse` → `PassagePayloadSchema.safeParse`。`PassagePayloadSchema` 期望的是一个 JSON **对象** (含 `text` / `tokens` 字段), 对数组输入 zod 校验必定失败。

- **根因分析**:
  `generateWithJsonRetry` (router.ts:248-326) 内部调用 `parseLLMResponse(result.text, expectedLanguage)`, 该函数在 `finalizeParseResult` 中用 `PassagePayloadSchema.safeParse(parsed)` 校验。`PassagePayloadSchema` 是 `z.object({...})`, 对数组输入 `safeParse` 返回 `{ success: false }`。因此:
  1. attempt 0: parse 失败 → `lastError = "Schema validation failed"`
  2. attempt 1: retry prompt + error context → LLM 仍返回数组 → parse 失败
  3. 所有 attempt 耗尽 → fallback 到 `MockLLMProvider.generate(options)`
  4. `result.parsed` 为 `undefined` → `!result.parsed || !Array.isArray(result.parsed)` 为 true → 走 `mockDetectGrammarPoints`

  **结论**: 即使用户配置了真实 LLM provider, 语法点检测也永远走 mock 路径。LLM 生成的语法点永远不会被使用。

- **影响**:
  - 用户配置 OpenAI/Anthropic/DeepSeek 后, 语法点仍是 mock 数据 (固定 5 条, 随机位置)
  - LLM token 浪费: 每次生成 passage 都会触发 2-3 次 LLM 调用 (retry), 全部 parse 失败后走 mock
  - 用户体验: 语法点高亮位置不准确 (mock 用 Math.random), 且语法点内容与实际文本无关

- **修复建议**:
  方案 A (推荐): 不走 `expectJson` 路径, 改用 `expectJson: false` + 手动 JSON 解析:

  ```typescript
  async function llmDetectGrammarPoints(text: string, language: Language): Promise<GrammarPoint[]> {
    const { llm } = useSettingsStore.getState();
    const langName = language === 'en' ? '英语' : '德语';

    const system = `You are a language learning grammar assistant...`;
    const prompt = `Passage (${langName}):\n${text}\n\nIdentify 2-4 key grammar points...\nReturn ONLY a valid JSON array, no extra text.`;

    // 不用 expectJson, 走 retryWithBackoff 路径
    const result = await generateWithFallback(llm, {
      system,
      prompt,
      temperature: 0.3,
      maxTokens: 800,
      expectJson: false, // 关键: 不走 PassagePayloadSchema 校验
    });

    // 手动解析 JSON 数组
    const parsed = safeJsonParse<unknown[]>(result.text);
    if (!parsed || !Array.isArray(parsed)) {
      return mockDetectGrammarPoints(text, language);
    }
    // ... 后续校验逻辑不变
  }
  ```

  方案 B: 为语法点创建独立的 zod schema + 独立的 parse 函数, 不复用 `parseLLMResponse`。

---

### V2-P1-002: tsconfig 未启用 `strict: true`

- **优先级**: P1 (高)
- **位置**: `w:\项目仓库\For trae\wordaydream\tsconfig.app.json`
- **问题描述**:
  项目文档和 spec 声称使用 "TypeScript 6 严格模式", 但 `tsconfig.app.json` 的 `compilerOptions` 中没有 `"strict": true`。当前只启用了 `noUnusedLocals` / `noUnusedParameters` / `noFallthroughCasesInSwitch`。

- **根因分析**:
  `"strict": true` 是以下所有检查的快捷方式:
  - `strictNullChecks`: null/undefined 不能随意赋给其他类型
  - `noImplicitAny`: 禁止隐式 any
  - `strictFunctionTypes`: 函数类型逆变检查
  - `strictBindCallApply`: bind/call/apply 类型检查
  - `strictPropertyInitialization`: 类属性必须初始化
  - `alwaysStrict`: 输出 "use strict"

  未启用 `strict` 意味着:
  - `strictNullChecks` 关闭: 代码中大量 `card.lastReviewAt ?? card.firstLearnedAt` 等空值处理实际不会被编译器强制
  - `noImplicitAny` 关闭: 函数参数可以隐式为 any 而不报错
  - 当前 `as any` (schedulerAdapter.ts:117) 和 `as unknown as` (40 处) 的使用不会被 strict 模式进一步约束

- **影响**:
  - 类型安全保障不足, 运行时可能遇到 null/undefined 引发的崩溃
  - 代码中已有的空值防护 (`??`, `?.`) 是手动添加而非编译器强制, 新代码可能遗漏
  - 与项目文档 "严格模式" 描述不符

- **修复建议**:
  分阶段启用 strict 模式:

  ```json
  // tsconfig.app.json - 第一步: 启用 strictNullChecks
  {
    "compilerOptions": {
      "strictNullChecks": true,
      "noImplicitAny": true,
      // ... 其他保持不变
    }
  }
  ```

  启用后需修复编译错误 (预计 20-50 处 null 检查), 然后逐步启用其余 strict 子选项。

---

### V2-P1-003: AbortSignal.any() 浏览器兼容性

- **优先级**: P1 (高)
- **位置**: `w:\项目仓库\For trae\wordaydream\src\features\llm\services\router.ts` L389-391
- **问题描述**:
  ```typescript
  const combinedSignal = options.signal
    ? AbortSignal.any([options.signal, timeoutSignal])
    : timeoutSignal;
  ```
  `AbortSignal.any()` 是相对新的 Web API:
  - Chrome 116+ (2023-08)
  - Firefox 124+ (2024-03)
  - Safari 17.4+ (2024-03)

  在更旧的浏览器中, `AbortSignal.any` 为 `undefined`, 调用会抛 `TypeError: AbortSignal.any is not a function`。

- **根因分析**:
  项目目标是 PWA 离线可用, 可能覆盖使用旧浏览器的用户。`AbortSignal.any` 没有 polyfill, 且 `tsconfig.app.json` 的 `lib` 仅包含 `ES2023` + `DOM`, 不保证该 API 在运行时可用。

- **影响**:
  - 旧浏览器 (Safari < 17.4, Firefox < 124) 用户点击 "生成新文本" 时, LLM 请求直接报错
  - 错误被 router 的 catch 块捕获, 走 mock fallback, 用户看到 mock 文本但不知原因
  - 与 PWA 离线模式的通知混淆, 难以区分是离线还是浏览器不兼容

- **修复建议**:
  添加兼容性降级:

  ```typescript
  function combineSignals(signals: AbortSignal[]): AbortSignal {
    if (signals.length === 0) {
      return new AbortController().signal;
    }
    if (signals.length === 1) {
      return signals[0];
    }
    // 优先使用原生 AbortSignal.any
    if (typeof AbortSignal.any === 'function') {
      return AbortSignal.any(signals);
    }
    // 降级: 手动组合
    const controller = new AbortController();
    for (const signal of signals) {
      if (signal.aborted) {
        controller.abort();
        break;
      }
      signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    return controller.signal;
  }

  // 使用:
  const combinedSignal = options.signal
    ? combineSignals([options.signal, timeoutSignal])
    : timeoutSignal;
  ```

---

### V2-P2-001: useReviewSessionStore 持久化 queue 快照过期

- **优先级**: P2 (中)
- **位置**: `w:\项目仓库\For trae\wordaydream\src\features\review\store\useReviewSessionStore.ts` L310-318
- **问题描述**:
  `partialize` 持久化了 `queue` (MemoryCard[] 数组), 这是复习会话开始时的卡片快照。页面刷新后, 复习会话恢复, 但 queue 中的卡片是序列化时的快照, 其 FSRS 状态 (`stability` / `difficulty` / `reps` / `due`) 可能已与 `useMemoryStore` 中的最新状态不一致。

- **根因分析**:
  1. 用户开始复习 → `startReview` 从 `useMemoryStore.getDueCards()` 拷贝卡片到 `queue`
  2. 用户答对 1 张, `completeReview` 调 `useMemoryStore.rateCard()` 更新 memory store 中的卡片
  3. 用户刷新页面 → `useReviewSessionStore` 从 localStorage 恢复 `queue`, 其中已答对的卡片仍是旧快照 (reps=0)
  4. `completeReview` 用 `queue[currentIndex]` 调 `rateCard` → 对旧快照的 `lexemeGroupId` 评分, memory store 中的卡片被重复评分

  另外, `evaluation` / `userAnswer` / `showRatingBar` 不在 `partialize` 中, 刷新后丢失。用户回到当前卡片时看不到之前的评估结果, 但 `showRatingBar` 被重置为 false, RatingBar 不会显示, 用户无法评分, 卡在当前卡片。

- **影响**:
  - FSRS 状态不一致: 重复评分导致 `reps` / `lapses` 错误累加
  - 用户刷新后卡在当前卡片: `showRatingBar=false` 且 `evaluation=null`, 但 `isEvaluating=false`, 用户可以重新提交, 但之前的评分已记录在 `results` 中

- **修复建议**:
  方案 A: 不持久化 `queue`, 刷新后若 `mode='reviewing'` 则重新从 memory store 拉取:
  ```typescript
  partialize: (state) => ({
    mode: state.mode,
    language: state.language,
    // 不持久化 queue, 刷新后按需重建
    currentIndex: state.currentIndex,
    results: state.results,
    startedAt: state.startedAt,
    cardContexts: state.cardContexts,
  }),
  onRehydrateStorage: () => (state) => {
    if (!state) return;
    if (state.mode === 'reviewing') {
      // 重新从 memory store 拉取 due cards
      state.queue = useMemoryStore.getState().getDueCards(state.language);
      // clamp currentIndex
      if (state.currentIndex >= state.queue.length) {
        state.currentIndex = Math.max(0, state.queue.length - 1);
      }
    }
  },
  ```

  方案 B: 持久化 queue 但在 rehydrate 时与 memory store 同步:
  ```typescript
  onRehydrateStorage: () => (state) => {
    if (!state || !state.queue) return;
    // 用 memory store 的最新卡片数据替换 queue 中的过期快照
    const memoryState = useMemoryStore.getState();
    state.queue = state.queue
      .map((card) => memoryState.cards.get(card.lexemeGroupId))
      .filter((c): c is MemoryCard => c !== undefined);
  },
  ```

---

### V2-P2-002: schedulerAdapter 使用 `as any` 绕过 FSRS 类型

- **优先级**: P2 (中)
- **位置**: `w:\项目仓库\For trae\wordaydream\src\features\review\services\schedulerAdapter.ts` L117
- **问题描述**:
  ```typescript
  const result = f.repeat(fsrsCard, now);
  const fsrsRating = ratingToFsrsRating(rating);
  const recordLog = (result as any)[fsrsRating];
  const nextCard = recordLog.card;
  ```
  使用 `as any` 访问 `f.repeat()` 的返回值, 完全绕过 TypeScript 类型检查。`ts-fsrs` 的 `repeat` 方法返回 `RecordLogs` 类型, 按 rating 索引获取 `RecordLog`。

- **根因分析**:
  `ts-fsrs` v5 的 `f.repeat()` 返回类型是 `RecordLogs`, 结构为 `{ [Rating.Again]: RecordLog, [Rating.Hard]: RecordLog, [Rating.Good]: RecordLog, [Rating.Easy]: RecordLog }`。`fsrsRating` 是 `FsrsRating` 枚举值 (数字), 直接用 `[fsrsRating]` 索引在 TypeScript 中需要 `Record<Rating, RecordLog>` 类型。开发者用 `as any` 绕过了类型约束。

- **影响**:
  - 如果 `ts-fsrs` 升级后 `repeat` 返回类型变化, 编译器不会报错
  - `recordLog.card` 如果为 undefined (API 变更), 运行时 `fsrsCardToMemoryCard` 会抛错
  - 在未启用 `strict: true` 的环境下 (见 V2-P1-002), 这个 `as any` 更危险

- **修复建议**:
  ```typescript
  import { type RecordLog, type RecordLogs } from 'ts-fsrs';

  const result = f.repeat(fsrsCard, now) as RecordLogs;
  const fsrsRating = ratingToFsrsRating(rating);
  const recordLog: RecordLog = result[fsrsRating];
  const nextCard = recordLog.card;
  ```

---

### V2-P2-003: CompoundWordDisplay 异步竞态条件

- **优先级**: P2 (中)
- **位置**: `w:\项目仓库\For trae\wordaydream\src\features\grammar\components\CompoundWordDisplay.tsx` L22-30
- **问题描述**:
  ```typescript
  useEffect(() => {
    if (token.isCompound && language === 'de') {
      splitCompound(token.lemma, language).then((data) => {
        setCompoundData(data);  // 无竞态保护
      });
    } else {
      setCompoundData(null);
    }
  }, [token.lemma, token.isCompound, language]);
  ```
  `splitCompound` 是异步函数。如果用户快速切换 token (e.g., Tab 键导航), 第一个 `splitCompound` 的 Promise 可能晚于第二个 resolve, 导致 `setCompoundData` 设置了旧 token 的复合词数据。

- **根因分析**:
  effect 没有 cleanup/cancellation 机制。React 19 虽然有 `use` hook 处理 Promise, 但这里用的是 `.then()` 链式调用, 无法取消。当 effect 的依赖变化时, 旧的 Promise 仍在 pending, resolve 后会覆盖新状态。

- **影响**:
  - 用户快速切换复合词时, 可能看到前一个词的拆分结果
  - 视觉闪烁: compoundData 先设为新值, 被旧 Promise 覆盖, 再被新 Promise 修正

- **修复建议**:
  ```typescript
  useEffect(() => {
    if (!token.isCompound || language !== 'de') {
      setCompoundData(null);
      return;
    }

    let cancelled = false;
    splitCompound(token.lemma, language).then((data) => {
      if (!cancelled) {
        setCompoundData(data);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [token.lemma, token.isCompound, language]);
  ```

---

### V2-P2-004: loadSession 无请求取消机制

- **优先级**: P2 (中)
- **位置**: `w:\项目仓库\For trae\wordaydream\src\features\reading\store\useReadingSessionStore.ts` L100-201
- **问题描述**:
  `loadSession` 是 async 函数, 内部调用 `generatePassage` (可能耗时数秒, 含 LLM 调用)。如果用户在生成期间再次点击 "生成新文本" 或切换语言/难度, 新的 `loadSession` 调用会与旧的并发执行。两个 `generatePassage` 的 Promise 都会 resolve, 最后 `set()` 的那个覆盖状态, 但中间状态可能闪烁。

- **根因分析**:
  `loadSession` 没有接收 `AbortSignal`, 也没有在 store 中追踪 "当前请求 ID"。`isLoading` 被设为 true, 但第二次调用也会 `set({ isLoading: true })`, 不会阻止第一次的 Promise resolve。

  关键路径:
  1. 用户点击生成 → loadSession('en', 2) 开始
  2. 2 秒后用户切换到德语 → loadSession('de', 2) 开始
  3. loadSession('en', 2) 的 generatePassage resolve → set({ session: EnglishPassage, ... })
  4. loadSession('de', 2) 的 generatePassage resolve → set({ session: GermanPassage, ... })
  5. 用户最终看到德语文本, 但中间短暂看到了英语文本

- **影响**:
  - 用户体验: 生成期间切换语言/难度, 可能短暂看到错误语言的文本
  - 成就/streak 副作用: `loadSession` 末尾调用 `recordDay()` + `checkAndUnlock()`, 两次 loadSession 会触发两次成就评估 (幂等, 无害但浪费)
  - LLM 成本: 两个并发的 generatePassage 都会调 LLM, 浪费 token

- **修复建议**:
  ```typescript
  // store 中添加
  private loadSessionAbort: AbortController | null = null;

  loadSession: async (language, difficulty) => {
    // 取消上一个请求
    if (loadSessionAbort) {
      loadSessionAbort.abort();
    }
    const controller = new AbortController();
    loadSessionAbort = controller;

    set({ isLoading: true });
    await new Promise((resolve) => setTimeout(resolve, 300));

    try {
      const dueCards = useMemoryStore.getState().getDueCards(language);
      const passage = await generatePassage(language, difficulty, dueCards);

      // 如果已被取消, 不更新状态
      if (controller.signal.aborted) return;

      // ... 后续逻辑不变
      set({ session, ... });
    } catch (err) {
      if (controller.signal.aborted) return;
      // ... fallback 逻辑
    }
  },
  ```

---

### V2-P2-005: passageGenerator catch 块静默吞错

- **优先级**: P2 (中)
- **位置**: `w:\项目仓库\For trae\wordaydream\src\features\reading\services\passageGenerator.ts` L332-334
- **问题描述**:
  ```typescript
  } catch {
    // LLM 异常, 落到 mock
  }
  // 3. fallback 到 mock 文本
  return getMockPassage(language, difficulty);
  ```
  LLM 调用失败 (网络错误 / API 错误 / JSON 解析失败 / alignment 全部 dropped) 时, catch 块完全静默, 无任何日志输出。

- **根因分析**:
  开发者可能故意吞错以保持 fallback 行为的 "静默降级" 体验。但这使得:
  - LLM 配置错误 (API key 无效 / proxy URL 错误) 完全不可见
  - alignment 全部 dropped (LLM 输出与文本完全不匹配) 时静默 fallback, 无法发现问题
  - 与 `router.ts` 中有 `log('error', ...)` 的风格不一致

- **影响**:
  - 调试困难: 用户报告 "总是看到 mock 文本" 时, 开发者无法从控制台日志定位原因
  - 隐藏真实故障: API key 过期 / Edge Function 部署错误等持续故障被静默吞掉

- **修复建议**:
  ```typescript
  } catch (error) {
    // LLM 异常, 记录日志后降级到 mock
    console.warn(
      '[passageGenerator] LLM generation failed, falling back to mock:',
      error instanceof Error ? error.message : error
    );
  }
  return getMockPassage(language, difficulty);
  ```

---

### V2-P2-006: grammarDetector mock 用 Math.random 生成错误位置

- **优先级**: P2 (中)
- **位置**: `w:\项目仓库\For trae\wordaydream\src\features\grammar\services\grammarDetector.ts` L113-126
- **问题描述**:
  ```typescript
  function mockDetectGrammarPoints(text: string, language: Language): GrammarPoint[] {
    const candidates = mockGrammarPoints[language];
    const count = Math.min(3, candidates.length);
    const selected = candidates.slice(0, count);

    let lastIndex = 0;
    return selected.map((gp) => {
      const textLen = text.length;
      const startIndex = Math.min(lastIndex + Math.floor(Math.random() * 30) + 10, textLen - 10);
      const endIndex = Math.min(startIndex + gp.text.length + Math.floor(Math.random() * 5), textLen);
      lastIndex = endIndex;
      return { ...gp, startIndex, endIndex, isActive: false };
    });
  }
  ```
  mock 语法点的 `startIndex` / `endIndex` 是随机生成的, 与实际文本内容完全无关。`gp.text` (e.g. "was/were + verb-ing") 在 passage 文本中根本不存在。

- **根因分析**:
  mock 数据的 `text` 字段是语法模式描述 (如 "was/were + verb-ing"), 不是 passage 中的实际子串。用随机 offset 定位后, `InteractivePassage` 的 `isValidRange` 可能通过 (范围合法), 但 `text.slice(startIndex, endIndex)` 取出的文本与 `grammarPoint.text` 不匹配。

- **影响**:
  - 语法点高亮出现在文本的随机位置, 高亮的文本与语法点说明完全无关
  - 用户点击高亮 → 弹出 GrammarPanel, 看到的语法解释与高亮的文本不对应
  - 由于 V2-P1-001 (LLM 语法检测失效), 所有用户都看到这个 mock 行为

- **修复建议**:
  mock 路径应在 passage 文本中搜索语法模式的近似出现, 而非随机定位:

  ```typescript
  function mockDetectGrammarPoints(text: string, language: Language): GrammarPoint[] {
    const candidates = mockGrammarPoints[language];
    const result: GrammarPoint[] = [];

    for (const gp of candidates) {
      // 在 text 中搜索语法模式的近似出现
      // e.g. "was/were + verb-ing" -> 搜索 "was " 或 "were "
      const keywords = gp.text.split(/[\s/]+/).filter((w) => w.length > 2);
      for (const kw of keywords) {
        const idx = text.toLowerCase().indexOf(kw.toLowerCase());
        if (idx >= 0) {
          // 扩展到完整短语 (向后取 20-40 字符)
          const end = Math.min(idx + 30, text.length);
          result.push({
            ...gp,
            startIndex: idx,
            endIndex: end,
            isActive: false,
          });
          break;
        }
      }
      if (result.length >= 3) break;
    }
    return result;
  }
  ```

---

### V2-P2-007: 持久化大量 Passage 对象导致 localStorage 膨胀

- **优先级**: P2 (中)
- **位置**: `w:\项目仓库\For trae\wordaydream\src\features\reading\store\useReadingHistoryStore.ts` + `useReadingSessionStore.ts`
- **问题描述**:
  `useReadingHistoryStore` 持久化最多 50 条 `HistoryEntry`, 每条包含完整的 `Passage` 对象 (含 `text` + `tokens[]` + `lexemeGroups[]` + `grammarPoints[]`)。`useReadingSessionStore` 额外持久化当前 session 的完整 Passage。

  单条 Passage 估算:
  - text: ~2000 字符
  - tokens: ~15 个, 每个 ~200 字符 (含所有字段)
  - grammarPoints: ~3 个, 每个 ~500 字符
  - 单条总计: ~5000-8000 字符

  50 条历史 + 1 条当前 session ≈ 250KB-400KB。localStorage 限制 5-10MB, 单项不超限, 但加上 memory store (cards Map)、settings、analytics 等, 总量可能接近 1MB。

- **根因分析**:
  history store 持久化完整 Passage 是为了支持 "历史重读" 功能 (`loadFromHistory`)。但 Passage 中的 `tokens[]` 含大量冗余字段 (`alignmentStatus` / `originalOffset` / `isCompound` / `compoundParts` 等), 历史重读时不需要这些。

- **影响**:
  - localStorage 写入性能: 每次 addEntry 序列化 50 条 Passage, 可能导致 100ms+ 的 JSON.stringify 阻塞
  - localStorage 配额: 长期使用后接近 5MB 限制, `setItem` 抛 `QuotaExceededError`
  - 页面加载性能: rehydrate 时 JSON.parse 50 条 Passage, 增加 TTI

- **修复建议**:
  方案 A: 历史只存摘要, 重读时重新生成:
  ```typescript
  interface HistoryEntry {
    id: string;
    // 不存完整 passage, 只存元数据
    passageText: string; // 仅文本, 不含 tokens
    passageTitle?: string;
    language: Language;
    difficulty: DifficultyLevel;
    startedAt: number;
    completedAt?: number;
    resolvedCount: number;
    totalTokenCount: number;
  }
  // loadFromHistory 时用 passageText + language/difficulty 重新标注
  ```

  方案 B: 压缩存储, 去掉 tokens 中不需要的字段:
  ```typescript
  partialize: (state) => ({
    history: state.history.map(entry => ({
      ...entry,
      passage: {
        ...entry.passage,
        tokens: entry.passage.tokens.map(t => ({
          id: t.id,
          lexemeGroupId: t.lexemeGroupId,
          surfaceForm: t.surfaceForm,
          lemma: t.lemma,
          objectiveDifficulty: t.objectiveDifficulty,
          startIndex: t.startIndex,
          endIndex: t.endIndex,
          isResolved: t.isResolved,
          isActive: t.isActive,
          kind: t.kind,
          isCompound: t.isCompound,
          // 不存 alignmentStatus / originalOffset / compoundParts
        })),
      },
    })),
  }),
  ```

---

### V2-P2-008: buildReviewTokens usedIndices 死代码

- **优先级**: P2 (中)
- **位置**: `w:\项目仓库\For trae\wordaydream\src\features\reading\store\useReadingSessionStore.ts` L48-53
- **问题描述**:
  ```typescript
  function buildReviewTokens(passage, dueCards) {
    const newTokens: TokenOccurrence[] = [];
    const usedIndices = new Set<number>();

    for (const token of passage.tokens) {
      usedIndices.add(token.startIndex);
      usedIndices.add(token.endIndex);
    }
    // usedIndices 在后续循环中从未被引用
    for (const card of dueCards) {
      // ... 使用 passage.tokens.some() 检查重叠, 不用 usedIndices
    }
  }
  ```
  `usedIndices` 被构建但从未使用。重叠检查 (L62-64) 直接用 `passage.tokens.some()`。

- **根因分析**:
  可能是早期重构遗留: 原本计划用 `usedIndices` 做 O(1) 重叠检查, 后来改为 `passage.tokens.some()` 但忘记删除 `usedIndices`。

- **影响**:
  - 代码可读性: 误导读者以为 `usedIndices` 参与了重叠检查
  - 微量性能浪费: 构建 Set 的 O(n) 遍历

- **修复建议**:
  删除 `usedIndices` 相关代码 (L48-53)。

---

### V2-P2-009: ReadingSessionPage 首次加载 language/difficulty 与持久化 session 不同步

- **优先级**: P2 (中)
- **位置**: `w:\项目仓库\For trae\wordaydream\src\features\reading\ReadingSessionPage.tsx` L44-45, L90-95
- **问题描述**:
  ```typescript
  const [language, setLanguage] = useState<Language>('en');
  const [difficulty, setDifficulty] = useState<DifficultyLevel>(2);
  // ...
  useEffect(() => {
    const currentSession = useReadingSessionStore.getState().session;
    if (!currentSession) {
      loadSession(language, difficulty);
    }
  }, []); // empty deps, mount only
  ```
  页面加载时, `language` / `difficulty` 初始值固定为 `'en'` / `2`。如果 localStorage 中持久化了上一个 session (e.g. 德语 / 难度 4), `currentSession` 不为 null, 不触发 `loadSession`。但 UI 的语言/难度选择器显示 `en` / `2`, 与实际 passage 的 `de` / `4` 不一致。

- **根因分析**:
  `language` / `difficulty` 是 ReadingSessionPage 的局部 state, 不从 store 中的 session 反推。store 有 `lastConfig` 字段但未被读取。

- **影响**:
  - 用户刷新页面后, 语言/难度选择器显示错误值
  - 用户点击 "生成新文本" 时, 用错误的 language/difficulty 生成新 passage
  - 如果用户先修改语言再生成, 会看到两次切换的延迟

- **修复建议**:
  ```typescript
  const [language, setLanguage] = useState<Language>(() => {
    const session = useReadingSessionStore.getState().session;
    return session?.language ?? useReadingSessionStore.getState().lastConfig?.language ?? 'en';
  });
  const [difficulty, setDifficulty] = useState<DifficultyLevel>(() => {
    const session = useReadingSessionStore.getState().session;
    return session?.difficulty ?? useReadingSessionStore.getState().lastConfig?.difficulty ?? 2;
  });
  ```

---

### V2-P3-001: useAnalyticsStore.getStreak 与 useStreakStore 逻辑重复

- **优先级**: P3 (低)
- **位置**: `w:\项目仓库\For trae\wordaydream\src\features\analytics\store\useAnalyticsStore.ts` L221-257
- **问题描述**:
  `useAnalyticsStore.getStreak()` 从 `dailyRecords` 计算 streak, `useStreakStore` 有独立的 `currentStreak` 字段。两套 streak 计算逻辑独立运行, 可能产生不同结果。

- **根因分析**:
  `useStreakStore.recordDay()` 在 `loadSession` 时调用, 用 `daysBetween` 算法计算 streak。`useAnalyticsStore.getStreak()` 从 `dailyRecords` (由 `addLearningRecord` 写入) 反推 streak。两者的数据源不同:
  - `useStreakStore`: `lastStudyDate` + `currentStreak` (显式记录)
  - `useAnalyticsStore`: `dailyRecords[].count > 0` (从学习记录推断)

  如果用户某天 `recordDay()` 被调用但没有 `addLearningRecord()` (e.g. loadSession 后立即退出), streak store 记 1 天, analytics store 记 0 天。

- **影响**:
  - 成就引擎用 `useStreakStore.currentStreak`, 分析面板用 `useAnalyticsStore.getStreak()`, 两者可能不一致
  - 用户困惑: 成就显示 "3 日入门" 但分析面板显示 streak=2

- **修复建议**:
  统一使用 `useStreakStore.currentStreak` 作为唯一 streak 来源, 删除 `useAnalyticsStore.getStreak()` 或改为代理:
  ```typescript
  getStreak: () => {
    return useStreakStore.getState().currentStreak;
  },
  ```

---

### V2-P3-002: partialize Set 序列化 hack

- **优先级**: P3 (低)
- **位置**: `w:\项目仓库\For trae\wordaydream\src\features\reading\store\useReadingSessionStore.ts` L343-358
- **问题描述**:
  ```typescript
  partialize: (state) => ({
    session: state.session
      ? {
          ...state.session,
          resolvedTokens: Array.from(state.session.resolvedTokens) as unknown as Set<string>,
        }
      : null,
    // ...
  }),
  onRehydrateStorage: () => (state) => {
    if (!state?.session) return;
    if (Array.isArray(state.session.resolvedTokens)) {
      state.session.resolvedTokens = new Set(state.session.resolvedTokens);
    }
  },
  ```
  `Array.from(Set)` 后用 `as unknown as Set<string>` 把数组伪装成 Set, 序列化时输出 JSON 数组, rehydrate 时用 `new Set(array)` 转回。

- **根因分析**:
  Zustand 的 `createJSONStorage` 用 `JSON.stringify`, `Set` 序列化为 `{}` (空对象)。这个 hack 是为了绕过 JSON 不支持 Set 的限制。

- **影响**:
  - 类型不安全: `as unknown as Set<string>` 欺骗编译器, 实际运行时是数组
  - 可读性差: 不熟悉这个 pattern 的开发者会困惑
  - 脆弱: 如果 `onRehydrateStorage` 未执行 (e.g. 状态为 null), `resolvedTokens` 可能是数组而非 Set, 后续 `.add()` / `.has()` 调用会失败

- **修复建议**:
  使用 Zustand 推荐的 custom storage 或显式转换:
  ```typescript
  partialize: (state) => ({
    session: state.session
      ? { ...state.session, resolvedTokens: Array.from(state.session.resolvedTokens) }
      : null,
    lastConfig: state.lastConfig,
    currentHistoryId: state.currentHistoryId,
  }),
  onRehydrateStorage: () => (state) => {
    if (!state?.session) return;
    const raw = state.session.resolvedTokens as unknown;
    if (Array.isArray(raw)) {
      state.session.resolvedTokens = new Set(raw as string[]);
    } else if (!(raw instanceof Set)) {
      state.session.resolvedTokens = new Set();
    }
  },
  ```

---

### V2-P3-003: useToastStore.addToast setTimeout 无 cleanup

- **优先级**: P3 (低)
- **位置**: `w:\项目仓库\For trae\wordaydream\src\store\useToastStore.ts` L37-43
- **问题描述**:
  ```typescript
  addToast: (type, message) => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    set((state) => ({ toasts: [...state.toasts, { id, type, message }] }));
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, 3000);
  },
  ```
  每个 toast 的 3 秒自动消失 timer 没有 cleanup 机制。快速连发多个 toast 时, 多个 timer 累积。

- **影响**:
  - 在测试环境中, 这些 timer 可能跨测试泄漏, 导致 "setState after unmount" 警告
  - 极端情况 (1 秒内发 100 个 toast) 会累积 100 个 timer, 但实际影响极小

- **修复建议**:
  低优先级, 可保持现状。若需修复, 可用 timer Map 追踪:
  ```typescript
  const toastTimers = new Map<string, ReturnType<typeof setTimeout>>();

  addToast: (type, message) => {
    const id = `...`;
    set((state) => ({ toasts: [...state.toasts, { id, type, message }] }));
    toastTimers.set(id, setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
      toastTimers.delete(id);
    }, 3000));
  },
  removeToast: (id) => {
    const timer = toastTimers.get(id);
    if (timer) { clearTimeout(timer); toastTimers.delete(id); }
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },
  ```

---

### V2-P3-004: RemedyPanel hasUmlaut 启发式判断语言

- **优先级**: P3 (低)
- **位置**: `w:\项目仓库\For trae\wordaydream\src\features\evaluation\components\RemedyPanel.tsx` L113-120
- **问题描述**:
  ```typescript
  const hasUmlaut = token.surfaceForm.includes('ä') || token.surfaceForm.includes('ö') || token.surfaceForm.includes('ü') || token.surfaceForm.includes('ß');
  const remedy = remedySentences[lemmaKey] || remedySentences[token.lemma.toLowerCase()];
  const targetSentence = hasUmlaut ? remedy?.de : remedy?.en;
  ```
  用 umlaut 存在性判断应该显示德语还是英语例句。但大量德语词不含 umlaut (e.g. "Arbeitgeber", "Fahrrad", "Schreibtisch"), 这些词会取到英语例句。

- **影响**:
  - 德语复合词不含 umlaut 时, 补救面板显示英语例句而非德语
  - 已有 `language` prop (`_language`) 但被忽略 (下划线前缀)

- **修复建议**:
  使用传入的 `language` prop 而非 umlaut 启发式:
  ```typescript
  export function RemedyPanel({ token, userAnswer, language }: Props) {
    // ...
    const remedy = remedySentences[lemmaKey] || remedySentences[token.lemma.toLowerCase()];
    const targetSentence = language === 'de' ? remedy?.de : remedy?.en;
  ```

---

### V2-P3-005: ReadingSessionPage resolved tokens 同步 effect 依赖不精确

- **优先级**: P3 (低)
- **位置**: `w:\项目仓库\For trae\wordaydream\src\features\reading\ReadingSessionPage.tsx` L97-108
- **问题描述**:
  ```typescript
  useEffect(() => {
    if (!session) return;
    if (session.isReplay) return;
    const resolvedTokens = session.passage.tokens.filter((t) => t.isResolved);
    for (const token of resolvedTokens) {
      addCardFromToken(token, session.language);
    }
  }, [session?.resolvedTokens.size, addCardFromToken, session]);
  ```
  依赖数组含 `session` 对象。store 每次 `set()` 都会创建新的 `session` 引用, 即使 `resolvedTokens.size` 未变, effect 也会重跑。

- **影响**:
  - 每次 `markOccurrenceResolved` / `setActiveOccurrence` 等不改变 resolvedTokens 的操作, 都会触发 effect 重跑
  - `addCardFromToken` 是幂等的 (检查 existing), 所以功能正确, 但浪费遍历

- **修复建议**:
  ```typescript
  useEffect(() => {
    if (!session || session.isReplay) return;
    const resolvedTokens = session.passage.tokens.filter((t) => t.isResolved);
    for (const token of resolvedTokens) {
      addCardFromToken(token, session.language);
    }
  }, [session?.resolvedTokens.size, addCardFromToken, session?.isReplay, session?.passage.tokens]);
  // 或用 session?.resolvedTokens.size 作为唯一依赖 (已有)
  ```

---

### V2-P3-006: MemoryCard.lastReviewAt 类型可选性与实际必填不一致

- **优先级**: P3 (低)
- **位置**: `w:\项目仓库\For trae\wordaydream\src\types\index.ts` L215, `src\features\review\services\schedulerAdapter.ts` L57
- **问题描述**:
  类型定义: `lastReviewAt?: number;` (可选)
  实际使用: `fsrsCardToMemoryCard` 始终赋值 `lastReviewAt` 参数 (L57: `lastReviewAt`), `scheduleNextReview` 传入 `nowMs` (L129)。

- **影响**:
  - 消费者需要处理 `undefined` 但实际永远不会是 undefined
  - `schedulerAdapter.ts:111` 用 `card.lastReviewAt ?? card.firstLearnedAt` 做空值防护, 但 `??` 右侧永远不会执行

- **修复建议**:
  将 `lastReviewAt` 改为必填:
  ```typescript
  // types/index.ts
  export interface MemoryCard {
    // ...
    lastReviewAt: number; // 改为必填
  }
  ```

---

## 4. 架构观察

### 4.1 设计优点

1. **Feature-Sliced 架构边界清晰**: `features/reading` / `features/llm` / `features/review` / `features/evaluation` / `features/grammar` / `features/achievements` / `features/analytics` 职责单一, 跨 feature 引用通过 `../../../types` 共享类型, 不直接 import 其他 feature 的内部模块。

2. **providerFactory 函数式 provider + 灰度路由**: `getProvider()` 根据 `config.provider` + `config.grayscale` 路由到 `routeOpenAI` / `routeAnthropic` / `routeDeepSeek`, 返回 `ProviderFn`。v1.5.2 fix M5 的 "灰度模式每次抽样不缓存" 设计正确避免了 "一次性骰子" 锁定用户体验。

3. **router → factory → provider 三层数据流**: 
   - `router.ts`: 入口, 负责 retry / fallback / notification
   - `providerFactory.ts`: 路由 + 缓存 + 灰度
   - `openaiProvider.ts` / `anthropicProvider.ts` / `deepseekProvider.ts`: Edge Function 调用
   层次清晰, 每层职责单一。

4. **alignmentValidator 5 步对齐协议**: exact → case-insensitive → fuzzy (Levenshtein) → indexOf → dropped, 是 LLM offset 校正的工业级实现。配合 `alignmentStatus` + `originalOffset` 字段, InteractivePassage 能在 tooltip 中展示真实状态。

5. **SSE streaming 的 mock fallback 链路完整**: `streamingProvider.ts` 的 `finalize` 对象封装了 `chunk` / `complete` / `fail` / `reset` 四个方法, v1.5.2 fix M7 的 `reset()` 确保 mock fallback 前清空已累积的真实文本, 避免混合内容。

6. **Edge Function 安全设计**: API key 仅在 Deno.env 中读取, 客户端永远不持有 key。CORS + rate limit + retry 三层防护完整。

7. **10 个 Zustand store 职责划分合理**: 每个 store 管理一个领域状态, 跨 store 通信通过 `useXxxStore.getState()` 调用 (e.g. `loadSession` 中调 `useMemoryStore.getState().getDueCards()`)。

### 4.2 改进建议

1. **store 间耦合**: `useReadingSessionStore.loadSession` 直接调用 5 个其他 store (`useMemoryStore` / `useReadingHistoryStore` / `useStreakStore` / `useAchievementStore` + 间接 `useSettingsStore`)。建议引入 orchestrator/service 层编排跨 store 副作用, 让 store 只管自己的状态。

2. **persist migrate 函数全是占位**: 10 个 store 中 8 个的 `migrate: (persistedState) => persistedState` 是空操作 (v1.5.2 fix L3 统一添加)。当 schema version 真正 bump 时, 这些占位函数不会做任何迁移, 会导致 rehydrate 后状态结构不匹配。建议为每个 store 预留真实的 migrate 逻辑骨架, 或在 bump version 时强制实现。

3. **grammarDetector 与 passageGenerator 的 JSON 解析路径不统一**: `passageGenerator` 走 `generateWithFallback` + `expectJson: true` (PassagePayloadSchema), `grammarDetector` 也走 `expectJson: true` 但期望不同 schema。建议为不同 LLM 任务创建独立的 parse 函数, 或在 `GenerateOptions` 中支持自定义 zod schema。

4. **useAnalyticsStore 的 getter 在 store 中定义**: `getLearningCurve` / `getStreak` / `getAccuracyTrend` / `getDailyDuration` 是纯计算函数, 放在 store 中每次调用都重新计算。建议提取为独立的 selector/util 函数, 便于 memoize。

5. **类型断言集中在 llmAdapter.ts**: `normalizePassagePayload` 和 `validateAndAlignPassagePayloadInternal` 中有 6 处 `as unknown as`, 主要是处理 `grammarPoints` 可选字段的 duck-typing。建议在 `PassageJsonPayload` 类型中显式声明 `grammarPoints?` 字段, 消除类型断言。

6. **ErrorBoundary 不区分错误类型**: 当前 ErrorBoundary 对所有错误显示相同的 "出错了" UI。建议区分网络错误 / LLM 错误 / 渲染错误, 提供更有针对性的恢复建议。

---

## 5. 测试覆盖评估

### 5.1 测试文件清单 (31 个)

| 模块 | 测试文件数 | 覆盖核心路径 |
|------|-----------|-------------|
| LLM services | 9 | router / providerFactory / streamingProvider / jsonParser / 3 个 provider / mockProvider |
| LLM utils | 4 | alignmentValidator / levenshtein / textNormalize / integration |
| LLM config | 2 | llmConfig / prompts |
| LLM store | 1 | offlineMode |
| Reading | 3 | useReadingSessionStore / InteractivePassage / passageGenerator |
| Review | 1 | useMemoryStore |
| Streak | 1 | useStreakStore |
| Achievements | 1 | useAchievementStore |
| Analytics | 1 | useHomeAnalytics |
| Grammar | 1 | grammarDetector.functional |
| Evaluation | 1 | glossAdapter.functional |
| Difficulty | 2 | difficultyEvaluator.functional / DifficultySuggestion |
| Components | 2 | NotificationBanner / ScrollProgressBar |
| Hooks | 1 | useReadingTimeTracker |
| Integration | 1 | passage-full-pipeline |

### 5.2 覆盖良好的区域

- **LLM JSON 解析链路**: `jsonParser.test.ts` 覆盖 markdown 剥离 / 尾随逗号 / jsonrepair / zod 校验 / language compliance
- **Alignment 校验**: `alignmentValidator.test.ts` + `alignmentValidator.integration.test.ts` 覆盖 5 步协议全分支
- **Provider factory 灰度路由**: `providerFactory.test.ts` T15-T19 覆盖 grayscale 边界
- **SSE streaming**: `streamingProvider.test.ts` 覆盖 abort / mock fallback / Content-Type 检查
- **FSRS 调度**: `useMemoryStore.test.ts` 覆盖 addCard / rateCard / getDueCards
- **端到端 pipeline**: `passage-full-pipeline.test.tsx` 覆盖 LLM → normalize → align → buildPassage 全链路

### 5.3 测试缺失的区域

1. **grammarDetector LLM 路径无测试** (关联 V2-P1-001): `grammarDetector.functional.test.ts` 只测试 mock 路径, `llmDetectGrammarPoints` 函数无任何测试。如果 有测试, V2-P1-001 会被发现。

2. **schedulerAdapter 无独立测试**: FSRS 适配器是记忆算法核心, 但无独立测试文件。`useMemoryStore.test.ts` 间接覆盖 `rateCard`, 但不验证 `scheduleNextReview` 的边界 (e.g. stability/difficulty 值范围 / 跨日计算 / rating 映射)。

3. **Edge Function 无运行时测试**: `netlify/edge-functions/llm-proxy.test.ts` 存在但沙箱无 Deno 运行时, 实际未执行。SSE provider 的 `openaiStreamProvider` 在 Deno 环境的行为未验证。

4. **竞态条件无测试**: V2-P2-003 (CompoundWordDisplay) / V2-P2-004 (loadSession) 的竞态场景无测试覆盖。

5. **persist 迁移无测试**: `persistMigration.test.ts` 存在但只测试 settings store v1→v4, 其余 7 个 store 的 migrate 占位函数无测试。

6. **InteractivePassage 段落切分边界**: `InteractivePassage.test.tsx` 测试了 token 渲染和键盘导航, 但 `paragraphRanges` 的兜底切分逻辑 (不含 `\n\n` 时按句子切分) 无测试。

7. **evaluateAnswer LLM 路径**: `evaluateAnswer.ts` 直接委托 `llmAdapter.evaluateAnswerViaLLM`, 但后者无独立测试 (只在 `passage-full-pipeline` 间接覆盖)。

---

## 6. 总结与下一步

### 整体评价

Wordaydream v1.5.2 在 v1.5.2 迭代修复后, 核心数据流 (LLM → JSON parse → alignment → passage 构建 → token 渲染 → FSRS 调度) 健壮性良好。v1.5.2 修复的 P0-1 (进度口径) / P0-2 (面板互斥) / P1-3 (错误反馈) / P1-4 (timer cleanup) / P1-5 (历史重读) 五个核心 bug 均已正确修复, 修复代码含清晰注释和测试验证。

剩余风险集中在:
- **类型安全基础**: tsconfig 未启用 strict, 是所有类型相关问题的根因
- **LLM 功能可达性**: grammarDetector LLM 路径失效, 用户永远看到 mock 语法点
- **状态持久化一致性**: review queue 快照过期 / Set 序列化 hack / localStorage 膨胀

### 建议优先级

| 优先级 | 行动项 | 预估工时 |
|--------|--------|---------|
| 紧急 | V2-P1-001: 修复 grammarDetector LLM 路径 (改 expectJson: false + 手动解析) | 2h |
| 紧急 | V2-P1-003: 添加 AbortSignal.any 兼容性降级 | 1h |
| 高 | V2-P1-002: 分阶段启用 tsconfig strict 模式 | 4-8h (含修复编译错误) |
| 高 | V2-P2-004: loadSession 添加请求取消机制 | 2h |
| 高 | V2-P2-005: passageGenerator catch 块添加日志 | 0.5h |
| 中 | V2-P2-001: review session 持久化策略调整 | 3h |
| 中 | V2-P2-003: CompoundWordDisplay 竞态修复 | 1h |
| 中 | V2-P2-006: grammarDetector mock 位置修正 | 2h |
| 中 | V2-P2-007: history store 压缩持久化 | 3h |
| 低 | V2-P2-002 / V2-P2-008 / V2-P2-009 / V2-P3-* | 各 0.5-1h |

### 下一步建议

1. **v1.5.3 hotfix**: 修复 V2-P1-001 (grammarDetector) + V2-P1-003 (AbortSignal.any), 这两个是用户可感知的功能缺陷。
2. **v1.6.0 技术债清理**: 启用 tsconfig strict / 修复 V2-P2-* 级问题 / 补齐 grammarDetector / schedulerAdapter / 竞态条件测试。
3. **架构演进**: 引入 orchestrator 层解耦 store 间直接调用 / 统一 streak 计算 / 评估 IndexedDB 替代 localStorage 存储 history。

---

*报告生成时间: 2026-07-10*
*审查工具: 代码阅读 + 模式分析 + 类型检查*
*审查覆盖: 20 个核心文件 + 10 个 store + tsconfig + package.json + 31 个测试文件清单*
