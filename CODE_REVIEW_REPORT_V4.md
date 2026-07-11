# Wordaydream V4 代码审查报告

> **审查范围**: V3 修复回归验证 + 持久化迁移 + PWA/SW + CSS/样式 + React Hooks + LLM 流式响应 + Netlify Edge Functions + 类型安全深化
> **基线版本**: v1.5.3（V3 报告 14 项修复已合入）
> **审查日期**: 2026-07-11
> **编译配置**: strictNullChecks + noImplicitAny 已启用
> **排除项**: V2/V3 已修复问题不重复报告
> **发现问题**: 5 项 P2（功能错误）+ 8 项 P3（代码质量），共 13 项

---

## 目录

- [P2 功能错误](#p2-功能错误)
  - [V4-P2-001 compound_master 成就永远无法解锁 (V3-P2-005 回归)](#v4-p2-001-compound_master-成就永远无法解锁-v3-p2-005-回归)
  - [V4-P2-002 英语专有名词被误判为德语 (V3-P2-007 回归)](#v4-p2-002-英语专有名词被误判为德语-v3-p2-007-回归)
  - [V4-P2-003 learningSteps 缺少持久化迁移 (V3-P2-008 回归)](#v4-p2-003-learningsteps-缺少持久化迁移-v3-p2-008-回归)
  - [V4-P2-004 SSE 解析错误时 mock fallback 被重复 done 回调静默杀死](#v4-p2-004-sse-解析错误时-mock-fallback-被重复-done-回调静默杀死)
  - [V4-P2-005 buildReviewTokens 缺少 isCompound 必填字段](#v4-p2-005-buildreviewtokens-缺少-iscompound-必填字段)
- [P3 代码质量](#p3-代码质量)
  - [V4-P3-001 MemoryTray 统计 learning+mastered≠totalCount (V3-P2-001 回归)](#v4-p3-001-memorytray-统计-learningmasteredtotalcount-v3-p2-001-回归)
  - [V4-P3-002 ReviewSessionPage nextCardTimerRef 多次评分导致 timer 泄漏 (V3-P2-004 回归)](#v4-p3-002-reviewsessionpage-nextcardtimerref-多次评分导致-timer-泄漏-v3-p2-004-回归)
  - [V4-P3-003 CSS z-index 变量定义冲突与未定义变量](#v4-p3-003-css-z-index-变量定义冲突与未定义变量)
  - [V4-P3-004 ReviewCompletedView getState() 非响应式读取 + useMemo 失效](#v4-p3-004-reviewcompletedview-getstate-非响应式读取--usememo-失效)
  - [V4-P3-005 generatePassage LLM 调用后未检查 signal.aborted](#v4-p3-005-generatepassage-llm-调用后未检查-signalaborted)
  - [V4-P3-006 llm-proxy 无效 provider 值导致运行时错误](#v4-p3-006-llm-proxy-无效-provider-值导致运行时错误)
  - [V4-P3-007 streamingProvider expectedLanguage 不必要的类型断言](#v4-p3-007-streamingprovider-expectedlanguage-不必要的类型断言)
  - [V4-P3-008 useMemoryStore getRatingPreviews `{} as MemoryCard` 不安全断言](#v4-p3-008-usememorystore-getratingpreviews-as-memorycard-不安全断言)

---

## P2 功能错误

### V4-P2-001 compound_master 成就永远无法解锁 (V3-P2-005 回归)

| 属性 | 值 |
|------|-----|
| **严重程度** | P2（功能错误 — 成就永远无法解锁） |
| **回归来源** | V3-P2-005-regression |
| **文件** | `src/features/achievements/services/buildContext.ts` |
| **行号** | L53 |

**问题描述**

V3-P2-005 抽取了 `buildAchievementContext` 函数统一构建成就评估上下文，修复了复习流传空 context 的问题。但该函数中 `completedCompounds` 仍然硬编码为 `0`：

```typescript
// buildContext.ts L47-55
return {
  streak,
  totalWords,
  totalSessions,
  languages,
  masteredByLevel,
  completedCompounds: 0,   // ← 硬编码为 0
  lastSessionPerfect,
};
```

`compound_master` 成要求数据来自 `achievementEngine.ts` L128-136：

```typescript
{
  id: 'compound_master',
  condition: { type: 'compound_count', count: 5 },
}
```

`isConditionMet` L215-216 判定逻辑：

```typescript
case 'compound_count':
  return ctx.completedCompounds >= condition.count;  // 0 >= 5 永远 false
```

由于 `buildAchievementContext` 是阅读流（`loadSession`）和复习流（`startReview` / `nextCard`）共用的唯一 context 构建入口，`compound_master` 成就从**任何流程**都永远无法解锁。

**根因分析**

V3-P2-005 的修复目标是"让复习流传真实数据"，抽取了公共函数。但 `completedCompounds` 的真实数据来源（用户在阅读中完成过多少个德语复合词）在当前 store 中并未被追踪。`useReadingHistoryStore` 记录了 passage 历史，但每个 passage 的 `tokens` 中 `isCompound: true` 的 token 数量未被汇总。因此 V3 修复时直接沿用了硬编码 0。

**修复建议**

在 `buildAchievementContext` 中从阅读历史汇总已解析的复合词数：

```typescript
export function buildAchievementContext(
  lastSessionPerfect: boolean = false
): AchievementContext {
  const streak = useStreakStore.getState().currentStreak;
  const memoryState = useMemoryStore.getState();
  const historyState = useReadingHistoryStore.getState();

  // ...existing code...

  // 统计已解析的德语复合词数 (跨所有历史 passage)
  // 复合词 token 的 isCompound === true 且 isResolved === true
  let completedCompounds = 0;
  for (const entry of historyState.history) {
    if (entry.passage.language !== 'de') continue;
    const resolvedCompoundIds = new Set<string>();
    for (const token of entry.passage.tokens) {
      if (token.isCompound && token.isResolved) {
        resolvedCompoundIds.add(token.lexemeGroupId);
      }
    }
    completedCompounds += resolvedCompoundIds.size;
  }

  return {
    streak,
    totalWords,
    totalSessions,
    languages,
    masteredByLevel,
    completedCompounds,  // ← 真实数据
    lastSessionPerfect,
  };
}
```

---

### V4-P2-002 英语专有名词被误判为德语 (V3-P2-007 回归)

| 属性 | 值 |
|------|-----|
| **严重程度** | P2（功能错误 — 英语复习队列缺失专有名词） |
| **回归来源** | V3-P2-007-regression |
| **文件** | `src/features/review/store/useMemoryStore.ts` |
| **行号** | L131-135 |

**问题描述**

V3-P2-007 修复了德语小写词被误判为英语的问题，改进了语言推断逻辑：

```typescript
// useMemoryStore.ts L131-135
const hasGermanChars = /[äöüß]/i.test(card.lemma);
const startsUpper = /^[A-ZÄÖÜ]/.test(card.lemma);
const isGerman = hasGermanChars || startsUpper;
if (language === 'en' && isGerman) continue;
if (language === 'de' && !isGerman) continue;
```

但 `startsUpper` 判断"首字母大写 = 德语名词"的启发式对英语专有名词同样适用。英语中专有名词也大写开头：`London`、`English`、`Monday`、`Shakespeare`、`January` 等。这些英语词汇在英语复习时会被 `isGerman = true` → `if (language === 'en' && isGerman) continue` 过滤掉，无法出现在英语复习队列中。

实际影响：用户在阅读英语文章时标注了 `London` 等专有名词，这些词进入记忆库后（如果 `card.language` 字段缺失，即旧卡片），在英语复习时会被错误过滤，用户永远复习不到这些词。

**根因分析**

V3-P2-007 的修复方向正确（用变音符 + 首字母大写综合判断），但忽略了英语专有名词也大写开头的语言共性。德语名词大写是德语特有规则，但"首字母大写"本身不是德语独有特征 — 英语专有名词、句首单词都大写。

正则推断语言本身就是不可靠的启发式，V3 报告也建议"长期修复：在 onRehydrateStorage 中为无 language 字段的旧卡片补全"。但该长期修复至今未实现，`migrate` 仍是占位函数。

**修复建议**

方案 A（推荐 — 彻底修复）：实现 persist migrate，为旧卡片补全 `language` 字段，消除正则推断路径。

```typescript
// useMemoryStore.ts
const SCHEMA_VERSION = 2;  // bump from 1 to 2

migrate: (persistedState, version) => {
  const state = persistedState as MemoryStore;
  if (!state.cards) return persistedState;
  
  // version < 2: 旧数据可能没有 language 字段, 从 history 推断
  if (version < 2) {
    const historyState = useReadingHistoryStore.getState();
    // 建立 lemma -> language 映射
    const lemmaToLang = new Map<string, Language>();
    for (const entry of historyState.history) {
      for (const token of entry.passage.tokens) {
        lemmaToLang.set(token.lemma.toLowerCase(), entry.language);
      }
    }
    // 为无 language 的卡片补全
    for (const card of state.cards.values()) {
      if (!card.language) {
        card.language = lemmaToLang.get(card.lemma.toLowerCase());
      }
    }
  }
  return state;
},
```

方案 B（短期 — 降低误判）：移除 `startsUpper` 启发式，仅用变音符判断（会漏判无变音符的德语名词，但不会误判英语专有名词）：

```typescript
const hasGermanChars = /[äöüßÄÖÜ]/.test(card.lemma);
const isGerman = hasGermanChars;
if (language === 'en' && isGerman) continue;
if (language === 'de' && !isGerman) continue;
```

---

### V4-P2-003 learningSteps 缺少持久化迁移 (V3-P2-008 回归)

| 属性 | 值 |
|------|-----|
| **严重程度** | P2（功能错误 — 旧卡片 FSRS 多步学习失效） |
| **回归来源** | V3-P2-008-regression |
| **文件** | `src/features/review/store/useMemoryStore.ts` + `src/features/review/services/schedulerAdapter.ts` |
| **行号** | useMemoryStore.ts L25, L170-178; schedulerAdapter.ts L115 |

**问题描述**

V3-P2-008 在 `MemoryCard` 类型中新增了 `learningSteps: number` 字段（`src/types/index.ts` L240），并在 `schedulerAdapter.ts` L115 用 `card.learningSteps ?? 1` 作为 fallback。

但 `useMemoryStore` 的持久化配置缺少迁移逻辑：

```typescript
// useMemoryStore.ts L25
const SCHEMA_VERSION = 1;  // ← 未 bump, 仍为 1

// L170-178 onRehydrateStorage — 仅重建 Map, 不补字段
onRehydrateStorage: () => (state) => {
  if (!state) return;
  if (state.cards && !(state.cards instanceof Map)) {
    state.cards = new Map(Object.entries(state.cards));
  }
  // ← 没有为旧卡片补 learningSteps 字段
},

// L177-178 migrate — 占位函数
migrate: (persistedState) => persistedState,  // ← 直接返回, 无迁移
```

V3-P2-008 报告原文也提到："注意：需配合 persist migrate（schema version +1）为旧数据补 `learningSteps: 1` 默认值。" 但该迁移逻辑至今未实现。

**实际影响**：

1. 旧版持久化的 MemoryCard（V3 修复前创建）没有 `learningSteps` 字段
2. rehydrate 后 `card.learningSteps` 为 `undefined`
3. `schedulerAdapter.ts` L115: `card.learningSteps ?? 1` 回退到 1
4. 每次评分时 `learning_steps` 都被重置为 1 — **这正是 V3-P2-008 要修复的 bug，在旧数据上仍然存在**

同时，`MemoryCard.learningSteps` 在类型中是非可选的 `number`，但 rehydrate 后运行时值为 `undefined`，类型系统无法捕获此不一致。在 `strictNullChecks` 下，编译器认为 `card.learningSteps` 始终是 `number`，但运行时可能是 `undefined`。

**根因分析**

V3-P2-008 的修复只完成了类型定义和 `schedulerAdapter` 的读取逻辑，遗漏了 persist migrate 配置。schemaVersion 未从 1 bump 到 2，migrate 函数仍是占位实现。

**修复建议**

```typescript
// useMemoryStore.ts
const SCHEMA_VERSION = 2;  // bump

// migrate 中补字段
migrate: (persistedState, version) => {
  const state = persistedState as Partial<MemoryStore>;
  if (!state.cards) return persistedState;
  
  // version < 2: 旧卡片没有 learningSteps 字段
  if (version < 2) {
    const cards = state.cards instanceof Map 
      ? state.cards 
      : new Map(Object.entries(state.cards));
    for (const card of cards.values()) {
      if (card.learningSteps === undefined) {
        // 旧卡片: Learning 态补 1 (V3 报告建议值), 其它态补 0
        card.learningSteps = card.status === 'learning' ? 1 : 0;
      }
    }
    state.cards = cards;
  }
  return state;
},
```

---

### V4-P2-004 SSE 解析错误时 mock fallback 被重复 done 回调静默杀死

| 属性 | 值 |
|------|-----|
| **严重程度** | P2（功能错误 — 流式响应返回空内容） |
| **文件** | `src/features/llm/services/llmStream.ts` + `src/features/llm/services/streamingProvider.ts` |
| **行号** | llmStream.ts L226-231, L148-153; streamingProvider.ts L287-304 |

**问题描述**

`parseSSEStream` 在 JSON 解析失败时，`processEventBlock` 会调用 `onChunk({ done: true, error: '...' })` 并返回 `true`。随后 `parseSSEStream` 检测到 `isLast === true`，会**再次**调用 `onChunk({ done: true })`（无 error 字段）。

```typescript
// llmStream.ts — processEventBlock JSON parse 错误分支 (L226-231)
} catch (error) {
    const msg = error instanceof Error ? error.message : 'JSON parse error';
    onChunk({ delta: '', done: true, error: `SSE parse error: ${msg}` });  // 第一次回调
    return true;  // ← 返回 true
}

// llmStream.ts — parseSSEStream 主循环 (L148-153)
const isLast = processEventBlock(eventBlock, onChunk);  // 触发上面的 onChunk
if (isLast) {
    onChunk({ delta: '', done: true });  // ← 第二次回调, 无 error
    return;
}
```

在 `streamingProvider.ts` 的回调中：

```typescript
// streamingProvider.ts L287-304
await parseSSEStream(response, (chunk) => {
  if (chunk.error) {                    // 第一次回调: error 有值
    if (!signal.aborted) {
      finalize.reset();                 // 清空 buffer
      runMockStream(...);               // 启动 mock fallback (异步, fire-and-forget)
    } else {
      finalize.fail(new Error(chunk.error));
    }
    return;                             // 返回, 但 parseSSEStream 会再调一次
  }
  if (chunk.done) {                     // 第二次回调: done=true, 无 error
    finalize.complete();                // ← 设 finished=true, 杀死 mock fallback!
    return;
  }
  finalize.chunk(chunk.delta);
}, signal);
```

`finalize.complete()` 将 `finished` 设为 `true`。随后 `runMockStream` 的 `finalize.chunk()` 调用检查 `if (finished) return;` 直接返回，不推送任何内容。用户得到**空结果**而非 mock fallback 内容。

**根因分析**

`processEventBlock` 的错误分支同时做了两件事：调用 `onChunk` 通知错误 + 返回 `true` 通知停止。但 `parseSSEStream` 的设计是"返回 true = 收到 [DONE]，调一次 `onChunk({ done: true })` 再停止"。错误路径复用了这个 `return true` 机制，导致 `onChunk` 被调用两次。第二次调用（无 error）触发了 `finalize.complete()`，与第一次调用启动的 `runMockStream` 产生竞态。

**修复建议**

方案 A（推荐 — 修复 processEventBlock 返回值语义）：错误路径不返回 `true`，改为返回一个带 `stop` 标记的结果，或在错误路径中不触发二次 `done` 回调。

```typescript
// llmStream.ts — processEventBlock 返回值改为枚举
type ProcessResult = 'continue' | 'done' | 'error';

function processEventBlock(eventBlock: string, onChunk: LLMStreamHandler): ProcessResult {
  // ...
  if (payload === SSE_DONE_MARKER) {
    return 'done';
  }
  try {
    // ... parse delta
  } catch (error) {
    onChunk({ delta: '', done: true, error: `SSE parse error: ${msg}` });
    return 'error';  // ← 不再返回 true, 而是专门的 error 标记
  }
  return 'continue';
}

// parseSSEStream 主循环
for (const eventBlock of events) {
  if (eventBlock.trim().length === 0) continue;
  const result = processEventBlock(eventBlock, onChunk);
  if (result === 'done') {
    onChunk({ delta: '', done: true });
    return;
  }
  if (result === 'error') {
    return;  // ← error 时直接返回, 不再调第二次 onChunk
  }
}
```

方案 B（最小改动 — 在 streamingProvider 中加 finished 守卫）：

```typescript
// streamingProvider.ts
await parseSSEStream(response, (chunk) => {
  if (chunk.error) {
    if (!signal.aborted) {
      finalize.reset();
      runMockStream(options.prompt, signal, finalize);
    } else {
      finalize.fail(new Error(chunk.error));
    }
    return;
  }
  if (chunk.done) {
    // 仅在没有触发 mock fallback 时才 complete
    // (error 路径已经启动了 mock, 不应再 complete)
    if (!finalize.isFallbackActive) {
      finalize.complete();
    }
    return;
  }
  finalize.chunk(chunk.delta);
}, signal);
```

---

### V4-P2-005 buildReviewTokens 缺少 isCompound 必填字段

| 属性 | 值 |
|------|-----|
| **严重程度** | P2（功能错误 — 类型不安全，运行时 isCompound 为 undefined） |
| **文件** | `src/features/reading/store/useReadingSessionStore.ts` |
| **行号** | L62-75 |

**问题描述**

`buildReviewTokens` 构建 review token 时，用 `as TokenOccurrence` 类型断言绕过了类型检查，但对象缺少 `TokenOccurrence` 接口中的必填字段 `isCompound`：

```typescript
// useReadingSessionStore.ts L62-75
newTokens.push({
  id: `review-${card.id}-${occurrenceCount}`,
  lexemeGroupId: card.lexemeGroupId,
  surfaceForm: passage.text.substring(idx, endIdx),
  lemma: card.lemma,
  objectiveDifficulty: card.objectiveDifficulty,
  startIndex: idx,
  endIndex: endIdx,
  isResolved: false,
  isActive: false,
  kind: 'review',
  cardId: card.id,
  isReview: true,
  // ← 缺少 isCompound: boolean (TokenOccurrence 必填字段)
  // ← 缺少 alignmentStatus (可选, 但 buildPassageFromLLM 总是赋值)
  // ← 缺少 originalOffset (可选, 但 buildPassageFromLLM 总是赋值)
} as TokenOccurrence);  // ← as 断言绕过了类型检查
```

`TokenOccurrence` 接口（`src/types/index.ts` L43）要求 `isCompound: boolean`。在 `strictNullChecks` 下，如果没有 `as TokenOccurrence` 断言，编译器会报错。该断言掩盖了类型不一致。

运行时，这些 review token 的 `isCompound` 为 `undefined`（falsy）。大多数检查 `token.isCompound` 的代码（如 `CompoundWordDisplay` 的条件渲染）将 `undefined` 视为 `false`，功能上暂无错误。但这违反了类型契约，且未来若有代码依赖 `isCompound === true` 的严格比较或 `typeof token.isCompound` 检查，会产生意外行为。

**根因分析**

`buildReviewTokens` 在 V2 之前就存在，当时 `isCompound` 可能还不是必填字段或类型定义不严格。V1.2.0 将 `isCompound` 设为必填后，该函数未同步更新，依赖 `as` 断言绕过编译检查。

**修复建议**

补全缺失的必填字段，移除 `as` 断言：

```typescript
newTokens.push({
  id: `review-${card.id}-${occurrenceCount}`,
  lexemeGroupId: card.lexemeGroupId,
  surfaceForm: passage.text.substring(idx, endIdx),
  lemma: card.lemma,
  objectiveDifficulty: card.objectiveDifficulty,
  startIndex: idx,
  endIndex: endIdx,
  isResolved: false,
  isActive: false,
  kind: 'review',
  cardId: card.id,
  isReview: true,
  isCompound: false,              // ← 补全必填字段
  alignmentStatus: 'unknown',    // ← 与 buildPassageFromLLM 保持一致
  originalOffset: 0,
});  // ← 移除 as TokenOccurrence
```

---

## P3 代码质量

### V4-P3-001 MemoryTray 统计 learning+mastered≠totalCount (V3-P2-001 回归)

| 属性 | 值 |
|------|-----|
| **严重程度** | P3（代码质量 — 统计数字不闭合） |
| **回归来源** | V3-P2-001-regression |
| **文件** | `src/features/review/components/MemoryTray.tsx` |
| **行号** | L27-38 |

**问题描述**

V3-P2-001 修复了硬编码假数据，改用真实 FSRS 状态计算统计。但统计逻辑中 `learning` 和 `mastered` 的定义存在覆盖盲区：

```typescript
// MemoryTray.tsx L27-38
const stats = useMemo(() => {
  let learning = 0;
  let mastered = 0;
  for (const card of cards.values()) {
    if (card.status === 'new' || card.status === 'learning' || card.status === 'relearning') {
      learning++;
    } else if (card.status === 'review' && card.reps >= 2) {
      mastered++;
    }
    // ← status === 'review' && reps < 2 的卡片: 既不是 learning 也不是 mastered
  }
  return { learning, mastered };
}, [cards]);
```

`review` 状态且 `reps < 2`（如 `reps === 1`）的卡片不在任何统计桶中。UI 同时展示三个数字（总数 / 学习中 / 已掌握），当存在这类卡片时 `learning + mastered < totalCount`，用户会看到数字不闭合（例如"总数 10、学习中 4、已掌握 3"——其余 3 个去哪了？）。

**根因分析**

V3-P2-001 的修复建议中定义 `mastered` 为 `review && reps >= 2`，但未处理 `review && reps < 2` 的中间态卡片。这些卡片已经从 Learning 态毕业（进入 Review 态），但尚未达到"初步掌握"标准（reps >= 2）。

**修复建议**

将 `review && reps < 2` 的卡片归入 `learning`（仍在学习过程中）：

```typescript
const stats = useMemo(() => {
  let learning = 0;
  let mastered = 0;
  for (const card of cards.values()) {
    if (card.status === 'new' || card.status === 'learning' || card.status === 'relearning') {
      learning++;
    } else if (card.status === 'review') {
      if (card.reps >= 2) {
        mastered++;
      } else {
        learning++;  // review 态但 reps < 2, 仍在初步复习阶段
      }
    }
  }
  return { learning, mastered };
}, [cards]);
```

---

### V4-P3-002 ReviewSessionPage nextCardTimerRef 多次评分导致 timer 泄漏 (V3-P2-004 回归)

| 属性 | 值 |
|------|-----|
| **严重程度** | P3（代码质量 — 极端情况下 timer 泄漏 + 跳卡） |
| **回归来源** | V3-P2-004-regression |
| **文件** | `src/features/review/components/ReviewSessionPage.tsx` |
| **行号** | L47-54, L168-174 |

**问题描述**

V3-P2-004 添加了 `nextCardTimerRef` 和 unmount cleanup。但如果用户在 50ms 内连续触发两次 `onRate`（例如快速双击评分按钮），第二次 `onRate` 会覆盖 `nextCardTimerRef.current`，第一个 timer 的引用丢失，无法被 cleanup 清除：

```typescript
// ReviewSessionPage.tsx L168-174
onRate={(rating: Rating) => {
  completeReview(rating);
  nextCardTimerRef.current = setTimeout(() => {  // ← 第二次调用会覆盖第一次的引用
    nextCardTimerRef.current = null;
    nextCard();
  }, 50);
}}
```

第一个 timer 仍在 50ms 后触发，调用 `nextCard()`（此时 `nextCardTimerRef.current` 已被第二次设为新的 timer 或 null）。随后第二个 timer 也触发，再调用一次 `nextCard()`。结果是 `nextCard()` 被调用两次，跳过一张卡片。

unmount cleanup (L49-53) 只清理 `nextCardTimerRef.current` 指向的最后一个 timer，第一个 timer 泄漏。

**根因分析**

V3-P2-004 的修复仅处理了 unmount 场景的 cleanup，未处理"新 timer 覆盖旧 timer"的场景。每次设置新 timer 前应先清除旧 timer。

**修复建议**

设置新 timer 前先清除旧 timer：

```typescript
onRate={(rating: Rating) => {
  completeReview(rating);
  // 先清除旧 timer, 避免覆盖后泄漏
  if (nextCardTimerRef.current !== null) {
    clearTimeout(nextCardTimerRef.current);
  }
  nextCardTimerRef.current = setTimeout(() => {
    nextCardTimerRef.current = null;
    nextCard();
  }, 50);
}}
```

---

### V4-P3-003 CSS z-index 变量定义冲突与未定义变量

| 属性 | 值 |
|------|-----|
| **严重程度** | P3（代码质量 — 层叠顺序不确定） |
| **文件** | `src/styles/tokens.css` + `src/features/review/components/ExportButton.module.css` |
| **行号** | tokens.css L109, L145-146; ExportButton.module.css L31 |

**问题描述**

存在三个 CSS 变量问题：

**1. `--z-modal` 重复定义**

```css
/* tokens.css L109 */
--z-modal: 1000;

/* tokens.css L145 (v0.9.0 HomePage tokens 区域) */
--z-modal: 1100;  /* ← 覆盖了 L109 的 1000 */
```

L145 的定义覆盖了 L109。同一文件中重复定义同一变量，后者生效。虽然最终值 1100 是正确的（modal 应高于 toast），但重复定义容易在后续维护中混淆——开发者看到 L109 的 1000 可能以为这是当前值。

**2. `--z-toast` 定义但从未使用**

```css
/* tokens.css L146 */
--z-toast: 1000;
```

全局搜索 `--z-toast` 仅在 tokens.css 定义处出现，无任何 CSS 或 TSX 文件引用它。`ToastContainer.module.css` 使用的是 `--z-modal`（L5），不是 `--z-toast`。该变量为死代码。

**3. `--z-modal-backdrop` 使用但从未定义**

```css
/* ExportButton.module.css L31 */
z-index: var(--z-modal-backdrop);
```

全局搜索 `--z-modal-backdrop` 仅在此处使用，tokens.css 中无定义。`var(--z-modal-backdrop)` 解析失败，`z-index` 回退为 `auto`，导致 ExportButton 的 backdrop 层叠顺序不可预期（可能被其他 `--z-elevated` / `--z-overlay` 元素覆盖）。

**根因分析**

v0.9.0 HomePage tokens 新增时覆盖了 `--z-modal` 但未删除 L109 的旧定义。`--z-toast` 和 `--z-modal-backdrop` 分别是规划但未落地 / 已废弃的变量。

**修复建议**

```css
/* tokens.css — 删除 L109 的重复定义, 保留 L145 的 1100 */
/* 删除: --z-modal: 1000; (L109) */

/* tokens.css — 删除未使用的 --z-toast */
/* 删除: --z-toast: 1000; (L146) */

/* tokens.css — 新增 --z-modal-backdrop 定义 */
--z-modal-backdrop: 1099;  /* 低于 modal(1100), 高于 overlay(100) */

/* 或在 ExportButton.module.css 中改用已定义的变量 */
z-index: calc(var(--z-modal) - 1);
```

---

### V4-P3-004 ReviewCompletedView getState() 非响应式读取 + useMemo 失效

| 属性 | 值 |
|------|-----|
| **严重程度** | P3（代码质量 — useMemo 无效） |
| **文件** | `src/features/review/components/ReviewSessionPage.tsx` |
| **行号** | L374-392 |

**问题描述**

`ReviewCompletedView` 组件中，`stats` 通过 `useReviewSessionStore.getState().getStats()` 读取，不在 React 订阅链中。同时 `getStats()` 每次返回新对象，导致 `useMemo` 依赖 `[results, stats, accuracy]` 中 `stats` 每次渲染都变化，memo 永远失效：

```typescript
// ReviewSessionPage.tsx L374-392
const results = useReviewSessionStore((s) => s.results);     // 订阅, 响应式
const stats = useReviewSessionStore.getState().getStats();   // 非订阅, 每次渲染新对象

const accuracy = stats.total > 0
  ? Math.round((stats.correct / stats.total) * 100)
  : 0;

const summary = useMemo(() => {                               // ← useMemo 无效
  return {
    total: results.length,
    correct: stats.correct,
    // ...
    accuracy,
  };
}, [results, stats, accuracy]);  // ← stats 每次新对象, memo 每次重算
```

功能上不会出错（值是正确的），但 `useMemo` 提供的缓存优化完全失效，每次渲染都重新计算。

**根因分析**

`getStats()` 是 store 中定义的方法，返回新创建的 `ReviewStats` 对象。在渲染过程中直接调用 `getState().getStats()` 绕过了 Zustand 的响应式订阅。虽然 `results` 变化会触发重渲染，但 `stats` 不是响应式的。`useMemo` 依赖 `stats`（新对象引用）导致每次都失效。

**修复建议**

直接从订阅的 `results` 派生 stats，无需调用 store 方法：

```typescript
function ReviewCompletedView({ onExit }: { onExit: () => void }) {
  const results = useReviewSessionStore((s) => s.results);

  const summary = useMemo(() => {
    const stats = { total: 0, correct: 0, partial: 0, wrong: 0, again: 0, good: 0, easy: 0 };
    for (const r of results) {
      if (r.evaluation) {
        if (r.evaluation.grade === 'correct') stats.correct++;
        else if (r.evaluation.grade === 'partial') stats.partial++;
        else stats.wrong++;
      }
      if (r.rating) stats[r.rating]++;
    }
    stats.total = results.length;
    const accuracy = stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0;
    return { ...stats, accuracy };
  }, [results]);

  // ...use summary.correct, summary.partial, etc.
}
```

---

### V4-P3-005 generatePassage LLM 调用后未检查 signal.aborted

| 属性 | 值 |
|------|-----|
| **严重程度** | P3（代码质量 — abort 后浪费 CPU/网络） |
| **文件** | `src/features/reading/services/passageGenerator.ts` |
| **行号** | L301-342 |

**问题描述**

V3-P3-006 将 `signal` 透传到了 `generateWithFallback`，LLM fetch 可以被真正取消。但 LLM 调用成功返回后，`generatePassage` 的后续处理（难度评估、语法检测、复合词检测）在多个 `await` 之间不检查 `signal.aborted`：

```typescript
// passageGenerator.ts L301-342
const payload = extractPassageJson(result.text);           // CPU
const normalizedPayload = normalizePassagePayload(payload); // CPU
const { payload: alignedPayload, tokenResults } =
  validateAndAlignPassagePayloadWithResults(normalizedPayload); // CPU
const basePassage = buildPassageFromLLM(...);               // CPU

// ↓ 这些异步操作可能耗时数秒, 期间不检查 signal
await Promise.all(
  uniqueLemmas.map(async (lemma) => {
    const level = await safeEvaluateDifficulty(lemma, language); // 网络 (LLM/字典)
    difficultyMap.set(lemma.toLowerCase(), level);
  })
);
const enriched = applyDifficulties(basePassage, difficultyMap);

const grammarPoints = await detectGrammarPoints(enriched.text, language); // 网络 (LLM)
enriched.grammarPoints = grammarPoints;

enriched.tokens = await detectCompoundWordsForTokens(enriched.tokens, language); // 网络 (字典)

// ← 整个过程中无 signal.aborted 检查
if (!hasDueCards) putIntoCache(cacheKey, enriched);
return enriched;
```

如果用户在 LLM 返回后、后处理期间发起新请求（abort 旧请求），旧请求的后处理仍会执行完毕（可能包含多次 LLM/字典 API 调用），浪费 API 配额。最终结果被 `loadSession` 的 abort 检查（L144）丢弃。

**根因分析**

V3-P3-006 的修复目标是"让 abort 真正中断 LLM fetch"。fetch 本身的取消已实现，但 fetch 之后的 CPU/网络后处理未加 abort 检查点。

**修复建议**

在主要 `await` 之间插入 abort 检查：

```typescript
const payload = extractPassageJson(result.text);
if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
// ...build basePassage...

await Promise.all(uniqueLemmas.map(async (lemma) => {
  const level = await safeEvaluateDifficulty(lemma, language);
  difficultyMap.set(lemma.toLowerCase(), level);
}));
if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

const enriched = applyDifficulties(basePassage, difficultyMap);
const grammarPoints = await detectGrammarPoints(enriched.text, language);
if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

enriched.grammarPoints = grammarPoints;
enriched.tokens = await detectCompoundWordsForTokens(enriched.tokens, language);

if (!hasDueCards) putIntoCache(cacheKey, enriched);
return enriched;
```

注意：`loadSession` 的 catch 块 (L133) 已处理 AbortError，会 fall back 到 mock 然后被 L144 的 abort 检查丢弃，行为正确。

---

### V4-P3-006 llm-proxy 无效 provider 值导致运行时错误

| 属性 | 值 |
|------|-----|
| **严重程度** | P3（代码质量 — 错误信息泄露内部实现） |
| **文件** | `netlify/edge-functions/llm-proxy.ts` |
| **行号** | L184-192 |

**问题描述**

`handleNonStreamRequest` 中通过 `providerMap[body.provider]` 获取 provider 函数，但 `body.provider` 是客户端传入的字符串，类型断言为 `"openai" | "anthropic" | "deepseek"` (L97)。如果客户端发送 `provider: "kimi"` 或其他无效值，`providerMap[body.provider]` 为 `undefined`：

```typescript
// llm-proxy.ts L184-192
const providerMap: Record<
  LLMRequest["provider"],
  (args: ProviderArgs) => Promise<ProviderResult>
> = {
  openai: openaiProvider,
  anthropic: anthropicProvider,
  deepseek: deepseekProvider,
};
const provider = providerMap[body.provider];  // ← 无效值时为 undefined

try {
  const result = await withRetry(
    (signal) => provider({ ...body, apiKey, signal }),  // ← TypeError: provider is not a function
    1,
    30000
  );
```

调用 `undefined({ ... })` 抛出 `TypeError: provider is not a function`，被 catch 块捕获并返回 500 错误，错误信息为 `"Provider error"` + `"provider is not a function"`。该错误信息泄露了内部实现细节（变量名 `provider`）。

**根因分析**

`body = await request.json() as LLMRequest` (L97) 的 `as` 断言不执行运行时验证。客户端可以发送任意 JSON，`provider` 字段不受联合类型约束。

**修复建议**

在 `providerMap` 查找前加显式校验：

```typescript
const provider = providerMap[body.provider];
if (!provider) {
  return new Response(
    JSON.stringify({
      error: "Unsupported provider",
      code: "UNSUPPORTED_PROVIDER",
      message: `Provider "${body.provider}" is not supported. Supported: openai, anthropic, deepseek`,
    }),
    { status: 400, headers: JSON_HEADERS }
  );
}
```

---

### V4-P3-007 streamingProvider expectedLanguage 不必要的类型断言

| 属性 | 值 |
|------|-----|
| **严重程度** | P3（代码质量 — 类型弱化） |
| **文件** | `src/features/llm/services/streamingProvider.ts` |
| **行号** | L223 |

**问题描述**

`runStream` 中构造请求体时，对 `expectedLanguage` 做了不必要的类型断言，将 `Language` 类型弱化为 `string`：

```typescript
// streamingProvider.ts L223
expectedLanguage: (options as { expectedLanguage?: string }).expectedLanguage,
```

`StreamingOptions extends GenerateOptions`（L48），而 `GenerateOptions` 已经定义了 `expectedLanguage?: Language`（`provider.ts` L19）。`options.expectedLanguage` 可以直接访问，类型为 `Language | undefined`。该 `as` 断言：
1. 不必要 — `options` 已有此字段
2. 有害 — 将类型从 `Language` ('en' | 'de') 弱化为 `string`，丢失了类型安全性

**根因分析**

可能是早期 `GenerateOptions` 未定义 `expectedLanguage` 字段时添加的 workaround，后来 `GenerateOptions` 新增了该字段（v1.2.0 hotfix-3）但此处未同步清理。

**修复建议**

```typescript
expectedLanguage: options.expectedLanguage,
```

---

### V4-P3-008 useMemoryStore getRatingPreviews `{} as MemoryCard` 不安全断言

| 属性 | 值 |
|------|-----|
| **严重程度** | P3（代码质量 — 类型不安全） |
| **文件** | `src/features/review/store/useMemoryStore.ts` |
| **行号** | L99-106 |

**问题描述**

`getRatingPreviews` 在卡片不存在时返回空对象，用 `{} as MemoryCard` 断言绕过类型检查：

```typescript
// useMemoryStore.ts L99-106
getRatingPreviews: (cardId: string) => {
  const card = get().cards.get(cardId);
  if (!card) {
    const empty: Record<Rating, { card: MemoryCard; nextReviewAt: number }> = {
      again: { card: {} as MemoryCard, nextReviewAt: 0 },   // ← 空 对象断言为 MemoryCard
      hard: { card: {} as MemoryCard, nextReviewAt: 0 },
      good: { card: {} as MemoryCard, nextReviewAt: 0 },
      easy: { card: {} as MemoryCard, nextReviewAt: 0 },
    };
    return empty;
  }
  // ...
},
```

`{} as MemoryCard` 创建了一个完全没有 `MemoryCard` 字段的对象（`id`、`lemma`、`status`、`due` 等全部为 `undefined`）。如果调用方未检查卡片是否存在就直接访问 `preview.again.card.lemma` 等字段，会得到 `undefined`，在 `strictNullChecks` 下类型系统认为这是安全的（因为类型标注为 `MemoryCard`）。

**根因分析**

这是一个早期占位实现，用 `as` 断言快速通过编译。返回值的不变量（"空 card 的所有字段为 undefined"）未在类型层面表达。

**修复建议**

将 `card` 改为可选，或返回 `null` 让调用方显式处理：

```typescript
getRatingPreviews: (cardId: string) => {
  const card = get().cards.get(cardId);
  if (!card) {
    return null;  // 调用方需处理 null
  }
  return {
    again: scheduleNextReview(card, 'again'),
    hard: scheduleNextReview(card, 'hard'),
    good: scheduleNextReview(card, 'good'),
    easy: scheduleNextReview(card, 'easy'),
  };
},
```

接口签名相应调整：`getRatingPreviews: (cardId: string) => Record<Rating, { card: MemoryCard; nextReviewAt: number }> | null;`

---

## 汇总统计

| 严重程度 | 数量 | 问题编号 |
|---------|------|---------|
| P1（崩溃/数据丢失） | 0 | — |
| P2（功能错误） | 5 | V4-P2-001 ~ V4-P2-005 |
| P3（代码质量） | 8 | V4-P3-001 ~ V4-P3-008 |
| **合计** | **13** | |

### 按维度分类

| 审查维度 | 涉及问题 |
|---------|---------|
| V3 回归 | V4-P2-001、V4-P2-002、V4-P2-003、V4-P3-001、V4-P3-002 |
| 持久化迁移 | V4-P2-002、V4-P2-003 |
| 类型安全 | V4-P2-005、V4-P3-007、V4-P3-008 |
| LLM 流式响应 | V4-P2-004 |
| CSS / 样式 | V4-P3-003 |
| React Hooks | V4-P3-004 |
| 资源管理 | V4-P2-004、V4-P3-002、V4-P3-005 |
| Netlify Edge Functions | V4-P3-006 |
| 状态一致性 | V4-P2-001、V4-P3-001 |

### 按回归来源分类

| 回归来源 | 问题数 | 说明 |
|---------|--------|------|
| V3-P2-001 回归 | 1 | V4-P3-001 (统计数字不闭合) |
| V3-P2-004 回归 | 1 | V4-P3-002 (timer 泄漏) |
| V3-P2-005 回归 | 1 | V4-P2-001 (compound_master 仍不可解锁) |
| V3-P2-007 回归 | 1 | V4-P2-002 (英语专有名词误判) |
| V3-P2-008 回归 | 1 | V4-P2-003 (learningSteps 迁移缺失) |
| V3-P2-006 回归 | 0 | CSV 转义修复正确, 无回归 |
| V3-P3-006 回归 | 1 | V4-P3-005 (signal 后处理未检查, 属改进而非回归) |
| 新发现问题 | 7 | V4-P2-004、V4-P2-005、V4-P3-003、V4-P3-004、V4-P3-006、V4-P3-007、V4-P3-008 |

### 修复优先级建议

1. **优先修复**（V3 回归 + 核心功能）: V4-P2-001（compound_master 永不可解锁）、V4-P2-003（learningSteps 迁移缺失）、V4-P2-002（英语专有名词误判）
2. **尽快修复**（功能错误）: V4-P2-004（SSE mock fallback 失效）、V4-P2-005（类型不安全 as 断言）
3. **择机修复**（代码质量）: V4-P3-001 ~ V4-P3-008

---

## V3 回归验证总结

| V3 修复项 | 回归状态 | 说明 |
|---------|---------|------|
| V3-P2-001 MemoryTray stats | ⚠️ 部分回归 | 统计数字不闭合 (V4-P3-001) |
| V3-P2-002 InlineAnswerPanel abort | ✅ 正确 | mountedRef 守卫实现正确 |
| V3-P2-003 RemedyPanel 竞态 | ✅ 正确 | cancelled 标志实现正确 |
| V3-P2-004 ReviewSessionPage setTimeout | ⚠️ 部分回归 | 多次评分 timer 泄漏 (V4-P3-002) |
| V3-P2-005 buildAchievementContext | ⚠️ 部分回归 | completedCompounds 仍硬编码 (V4-P2-001) |
| V3-P2-006 CSV 转义 | ✅ 正确 | escapeCSVField 实现完整 |
| V3-P2-007 getDueCards 语言推断 | ⚠️ 回归 | 英语专有名词误判 (V4-P2-002) |
| V3-P2-008 learningSteps 持久化 | ⚠️ 回归 | migrate 未实现 (V4-P2-003) |
| V3-P3-001 historyIdCounter | ✅ 正确 | — |
| V3-P3-002 useLLMGenerator isLoading | ✅ 正确 | — |
| V3-P3-003 glossAdapter detectLanguage | ✅ 正确 | language 参数已改为必传 |
| V3-P3-004 paragraphRanges 兜底 | ✅ 正确 | parts.length === 0 兜底已加 |
| V3-P3-005 detectCompoundWords 不可变 | ✅ 正确 | 返回新数组实现正确 |
| V3-P3-006 generatePassage signal | ✅ 正确 | signal 透传链路完整, 有改进空间 (V4-P3-005) |

---

## 审查覆盖范围

### 已审查领域

| 领域 | 关键文件 | 发现问题 |
|------|---------|---------|
| V3 回归验证 | buildContext.ts, useMemoryStore.ts, schedulerAdapter.ts, MemoryTray.tsx, ReviewSessionPage.tsx, exportService.ts, passageGenerator.ts | 5 项回归 |
| 持久化迁移 | useMemoryStore.ts, useReviewSessionStore.ts, useReadingSessionStore.ts, useStreakStore.ts | V4-P2-003 |
| PWA / Service Worker | vite.config.ts (vite-plugin-pwa) | 无问题 (autoUpdate + skipWaiting 配置正确) |
| CSS / 样式 | tokens.css, 所有 .module.css | V4-P3-003 |
| React Hooks | ReviewSessionPage.tsx, MemoryTray.tsx, InlineAnswerPanel.tsx, RemedyPanel.tsx | V4-P3-002, V4-P3-004 |
| LLM 流式响应 | llmStream.ts, streamingProvider.ts, router.ts | V4-P2-004, V4-P3-007 |
| Netlify Edge Functions | llm-proxy.ts, providers/openai.ts, utils/rateLimit.ts | V4-P3-006 |
| 类型安全 | useReadingSessionStore.ts, useMemoryStore.ts, streamingProvider.ts, difficultyAdvisor.ts | V4-P2-005, V4-P3-007, V4-P3-008 |

### 未发现问题的模块

- **PWA / Service Worker**: `vite-plugin-pwa` 的 `autoUpdate` 模式 + `skipWaiting` / `clientsClaim` 默认行为正确。runtime caching 策略合理（LLM API 用 NetworkFirst GET-only，文档用 StaleWhileRevalidate）。无离线 fallback 页面问题（SPA 的 index.html 被 precache 覆盖）。
- **Netlify Edge Functions API key 安全**: API key 从 `Deno.env.get()` 读取，不从 request body 传入，客户端永远看不到 key。✅
- **Netlify Edge Functions 超时处理**: `withRetry` 有 30s timeout (L198)，`createTimeoutSignal` 在 router.ts 中也有独立超时。✅
- **LLM SSE chunk 边界处理**: `parseSSEStream` 的 buffer 累积 + `\n\n` split + 保留最后不完整段落的逻辑正确。✅
- **LLM SSE reader 清理**: `finally` 块中 `signal.removeEventListener('abort', onAbort)` + `reader.releaseLock()` 正确。✅
- **useStreakStore 持久化**: 状态全为原始值 (string/number)，无需 serialize/deserialize，无迁移需求。✅
- **useReviewSessionStore onRehydrateStorage mode 处理**: `ReviewMode = 'idle' | 'reviewing' | 'completed'` 三态全覆盖，`reviewing` 重建 queue，其它清空。✅

---

*报告结束*
