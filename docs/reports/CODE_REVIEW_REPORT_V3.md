# Wordaydream V3 代码审查报告

> **审查范围**: 全项目深度审查（运行时崩溃、异步竞态、状态一致性、资源泄漏、逻辑错误、性能）
> **基线版本**: v1.5.3（V2 报告 24 项修复已合入）
> **审查日期**: 2026-07-10
> **排除项**: V2-P1-001 ~ V2-P3-006 已修复问题不重复报告
> **发现问题**: 8 项 P2（功能错误）+ 6 项 P3（代码质量），共 14 项

---

## 目录

- [P2 功能错误](#p2-功能错误)
  - [V3-P2-001 MemoryTray 统计数据硬编码假数据](#v3-p2-001-memorytray-统计数据硬编码假数据)
  - [V3-P2-002 InlineAnswerPanel evaluateAnswer 无 abort 保护](#v3-p2-002-inlineanswerpanel-evaluateanswer-无-abort-保护)
  - [V3-P2-003 RemedyPanel load() 异步竞态](#v3-p2-003-remedypanel-load-异步竞态)
  - [V3-P2-004 ReviewSessionPage setTimeout(nextCard) 无 cleanup](#v3-p2-004-reviewsessionpage-settimeoutnextcard-无-cleanup)
  - [V3-P2-005 复习流成就评估传空 context 导致多项成就无法解锁](#v3-p2-005-复习流成就评估传空-context-导致多项成就无法解锁)
  - [V3-P2-006 exportService CSV 转义不完整](#v3-p2-006-exportservice-csv-转义不完整)
  - [V3-P2-007 getDueCards 正则推断语言对德语小写词误判](#v3-p2-007-getduecards-正则推断语言对德语小写词误判)
  - [V3-P2-008 schedulerAdapter learning_steps 硬编码影响 FSRS 调度](#v3-p2-008-scheduleradapter-learning_steps-硬编码影响-fsrs-调度)
- [P3 代码质量](#p3-代码质量)
  - [V3-P3-001 useReadingHistoryStore addEntry 同毫秒 id 冲突](#v3-p3-001-usereadinghistorystore-addentry-同毫秒-id-冲突)
  - [V3-P3-002 useLLMGenerator llm config 变化时未重置 isLoading](#v3-p3-002-usellmgenerator-llm-config-变化时未重置-isloading)
  - [V3-P3-003 glossAdapter detectLanguage umlaut 启发式 fallback 误判](#v3-p3-003-glossadapter-detectlanguage-umlaut-启发式-fallback-误判)
  - [V3-P3-004 InteractivePassage paragraphRanges 全空 parts 边界](#v3-p3-004-interactivepassage-paragrapranges-全空-parts-边界)
  - [V3-P3-005 passageGenerator detectCompoundWordsForTokens 原地修改 token](#v3-p3-005-passagegenerator-detectcompoundwordsfortokens-原地修改-token)
  - [V3-P3-006 loadSession abort 不传递给 generatePassage](#v3-p3-006-loadsession-abort-不传递给-generatepassage)

---

## P2 功能错误

### V3-P2-001 MemoryTray 统计数据硬编码假数据

| 属性 | 值 |
|------|-----|
| **严重程度** | P2（功能错误 — 数据展示虚假） |
| **文件** | `src/features/review/components/MemoryTray.tsx` |
| **行号** | L113-118 |

**问题描述**

MemoryTray 组件的统计区域展示"学习中"和"已掌握"两个数字，但这两个数字是用 `Math.floor(totalCount * 0.7)` 和 `Math.floor(totalCount * 0.3)` 硬编码算出来的，与记忆库中卡片的真实 FSRS 状态（`card.status`）完全无关。

```tsx
// L113-118 当前代码
<div className={styles.statItem}>
  <span className={styles.statValue}>{Math.floor(totalCount * 0.7)}</span>
  <span className={styles.statLabel}>学习中</span>
</div>
<div className={styles.statItem}>
  <span className={styles.statValue}>{Math.floor(totalCount * 0.3)}</span>
  <span className={styles.statLabel}>已掌握</span>
</div>
```

**根因分析**

这是 v0.x 时代的占位假数据，后续迭代中未替换为真实统计。`useMemoryStore` 已有 `getReviewingCards()` 方法可获取复习中的卡片，且每张 `MemoryCard` 都有 `status` 字段（`new` / `learning` / `review` / `relearning`），完全有能力计算真实分布。

用户看到"总数 10、学习中 7、已掌握 3"，但实际可能是 10 张全是 `new` 状态（刚加入，未复习过），统计完全失真。

**修复建议**

```tsx
const cards = useMemoryStore((state) => state.cards);
// ...existing code...

const stats = useMemo(() => {
  let learning = 0;
  let mastered = 0;
  for (const card of cards.values()) {
    if (card.status === 'new' || card.status === 'learning' || card.status === 'relearning') {
      learning++;
    } else if (card.status === 'review' && card.reps >= 2) {
      mastered++;
    }
  }
  return { learning, mastered };
}, [cards]);
```

---

### V3-P2-002 InlineAnswerPanel evaluateAnswer 无 abort 保护

| 属性 | 值 |
|------|-----|
| **严重程度** | P2（功能错误 — 卸载后 setState + 资源泄漏） |
| **文件** | `src/features/reading/components/InlineAnswerPanel.tsx` |
| **行号** | L114-154 |

**问题描述**

`handleSubmit` 中调用 `await evaluateAnswer(...)`（L120-125），这是一个可能耗时数秒的 LLM 异步调用。该调用没有 AbortController 保护。虽然 v1.5.2 修复了 `resolveTimerRef` 的 setTimeout 泄漏（L29-44），但 `evaluateAnswer` 本身的 fetch 请求无法被取消。

组件卸载场景：用户点击 token 激活 InlineAnswerPanel → 输入答案 → 点击确认（触发 evaluateAnswer 的 LLM 调用）→ 在 LLM 响应返回前，用户点击另一个 token 或按 Esc 关闭面板 → 组件卸载 → LLM 响应返回 → `setEvaluation(result)` / `setIsSubmitting(false)` 触发 React "Can't perform a React state update on an unmounted component" 警告。

```tsx
// L114-154 当前代码（关键部分）
const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  if (!answer.trim() || isSubmitting) return;
  setIsSubmitting(true);
  try {
    const result = await evaluateAnswer(  // 无 abort，组件卸载后仍会返回
      answer.trim(),
      token.lemma,
      token.objectiveDifficulty,
      language
    );
    setEvaluation(result);  // 卸载后 setState
    // ...
```

**根因分析**

`evaluateAnswer` 内部调用 `generateWithFallback` → `getProvider()` → Edge Function fetch，整条链路未暴露 AbortSignal 参数。V2 修复了 `useReadingSessionStore.loadSession` 的竞态（V2-P2-004），但 InlineAnswerPanel 的 LLM 评估调用遗漏了同类保护。

**修复建议**

方案 A（推荐 — 最小改动）：用 `mountedRef` 守卫 setState

```tsx
const mountedRef = useRef(true);
useEffect(() => {
  return () => { mountedRef.current = false; };
}, []);

const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  if (!answer.trim() || isSubmitting) return;
  setIsSubmitting(true);
  try {
    const result = await evaluateAnswer(
      answer.trim(), token.lemma, token.objectiveDifficulty, language
    );
    if (!mountedRef.current) return;  // 卸载后不 setState
    setEvaluation(result);
    if (result.grade === 'correct') {
      // ...existing logic...
    }
  } catch (error) {
    if (!mountedRef.current) return;
    setEvaluation({ /* ... */ });
  } finally {
    if (mountedRef.current) setIsSubmitting(false);
  }
};
```

方案 B（彻底修复）：给 `evaluateAnswer` / `generateWithFallback` 透传 AbortSignal，在组件卸载时 abort。

---

### V3-P2-003 RemedyPanel load() 异步竞态

| 属性 | 值 |
|------|-----|
| **严重程度** | P2（功能错误 — 竞态导致释义错位） |
| **文件** | `src/features/evaluation/components/RemedyPanel.tsx` |
| **行号** | L96-104 |

**问题描述**

`useEffect` 中的 `load()` 异步函数调用 `getGloss(token)` 获取释义。当 `token` prop 快速变化时（用户连续答错多个词，每个词都渲染 RemedyPanel），旧的 `getGloss` 请求可能晚于新请求返回，导致 `setGloss(result)` 用旧 token 的释义覆盖新 token 的释义。

```tsx
// L96-104 当前代码
useEffect(() => {
  const load = async () => {
    setIsLoading(true);
    const result = await getGloss(token);  // 无竞态保护
    setGloss(result);                       // 旧请求可能覆盖新请求
    setIsLoading(false);
  };
  load();
}, [token]);
```

**根因分析**

V2 修复了 `CompoundWordDisplay` 的同类竞态（V2-P2-003，加了 `cancelled` 标志），但 RemedyPanel 的 `load()` 遗漏了同样的保护。这是 V2 修复时的遗漏，而非新引入的问题。

**修复建议**

```tsx
useEffect(() => {
  let cancelled = false;
  const load = async () => {
    setIsLoading(true);
    const result = await getGloss(token);
    if (cancelled) return;
    setGloss(result);
    setIsLoading(false);
  };
  load();
  return () => { cancelled = true; };
}, [token]);
```

---

### V3-P2-004 ReviewSessionPage setTimeout(nextCard) 无 cleanup

| 属性 | 值 |
|------|-----|
| **严重程度** | P2（功能错误 — 卸载后 setState + 跨卡片跳转） |
| **文件** | `src/features/review/components/ReviewSessionPage.tsx` |
| **行号** | L156-159 |

**问题描述**

用户评分后通过 `setTimeout(() => nextCard(), 50)` 延迟跳转到下一张卡片。这个 setTimeout 没有 cleanup。如果用户在 50ms 内退出复习（点击"退出"按钮），组件卸载后 setTimeout 仍会触发 `nextCard()`，导致：

1. React 卸载后 setState 警告
2. `nextCard()` 修改 `useReviewSessionStore` 状态（`currentIndex` / `mode`），可能导致已退出的复习会话状态被错误更新

```tsx
// L156-159 当前代码
onRate={(rating: Rating) => {
  completeReview(rating);
  setTimeout(() => nextCard(), 50);  // 无 cleanup
}}
```

**根因分析**

50ms 延迟的目的是让 RatingBar 的评分动画播放完毕再跳转，但没有用 `useRef` 持有 timer 引用并在组件卸载时清理。对比 InlineAnswerPanel 的 `resolveTimerRef`（V1.5.2 fix P1-4 已修复同类问题），这里遗漏了。

**修复建议**

```tsx
// 在 ReviewSessionPage 组件顶部
const nextCardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

useEffect(() => {
  return () => {
    if (nextCardTimerRef.current !== null) {
      clearTimeout(nextCardTimerRef.current);
    }
  };
}, []);

// 在 onRate 中
onRate={(rating: Rating) => {
  completeReview(rating);
  nextCardTimerRef.current = setTimeout(() => {
    nextCardTimerRef.current = null;
    nextCard();
  }, 50);
}}
```

---

### V3-P2-005 复习流成就评估传空 context 导致多项成就无法解锁

| 属性 | 值 |
|------|-----|
| **严重程度** | P2（功能错误 — 成就系统部分失效） |
| **文件** | `src/features/review/store/useReviewSessionStore.ts` |
| **行号** | L124-132（startReview）、L221-229（nextCard 完成时） |

**问题描述**

复习流在 `startReview` 和 `nextCard`（复习完成时）调用 `useAchievementStore.getState().checkAndUnlock()`，但传入的 `AchievementContext` 中 `languages: []`、`totalWords: 0`、`totalSessions: 0`、`masteredByLevel` 全为 0、`completedCompounds: 0`。

```typescript
// L124-132 startReview 中
useAchievementStore.getState().checkAndUnlock({
  streak: useStreakStore.getState().currentStreak,
  totalWords: 0,           // 始终为 0
  totalSessions: 0,        // 始终为 0
  languages: [],           // 始终为空
  masteredByLevel: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },  // 始终为 0
  completedCompounds: 0,   // 始终为 0
  lastSessionPerfect: false,
});

// L221-229 nextCard 完成时 — 同样全为 0/空
```

这导致以下成就**永远无法从复习流解锁**（只能从阅读流 `loadSession` 解锁）：

| 成就 ID | 条件 | 是否受影响 |
|---------|------|-----------|
| `bilingual` | `languages.length >= 2` | 永远为空，无法解锁 |
| `polyglot_2` | `languages.length >= 2 && totalWords >= 100` | 永远为空/0，无法解锁 |
| `words_50` | `totalWords >= 50` | 永远为 0，无法解锁 |
| `words_500` | `totalWords >= 500` | 永远为 0，无法解锁 |
| `first_session` | `totalSessions >= 1` | 永远为 0，无法解锁 |
| `difficult_climb` | `masteredByLevel[5] >= 10` | 永远为 0，无法解锁 |
| `compound_master` | `completedCompounds >= 5` | 永远为 0，无法解锁 |

只有 `streak_3` / `streak_7` / `streak_30` / `streak_100`（依赖 streak）和 `first_perfect`（依赖 lastSessionPerfect）能从复习流解锁。

**根因分析**

复习流 `checkAndUnlock` 调用是 v1.5.0 Stage 2 加入的，但 context 字段全部硬编码为 0/空，没有像阅读流 `loadSession`（L186-219）那样从 `useMemoryStore` / `useReadingHistoryStore` 读取真实数据。

**修复建议**

抽取公共的 context 构建函数，复习流和阅读流共用：

```typescript
// src/features/achievements/services/buildContext.ts
import { useMemoryStore } from '../../review/store/useMemoryStore';
import { useReadingHistoryStore } from '../../reading/store/useReadingHistoryStore';
import { useStreakStore } from '../../streak/store/useStreakStore';
import type { AchievementContext, DifficultyLevel } from '../../../types';

export function buildAchievementContext(
  lastSessionPerfect: boolean = false
): AchievementContext {
  const streak = useStreakStore.getState().currentStreak;
  const memoryState = useMemoryStore.getState();
  const historyState = useReadingHistoryStore.getState();

  const totalWords = memoryState.getCardCount();
  const totalSessions = historyState.history.length;
  const languages = Array.from(
    new Set(historyState.history.map((h) => h.language))
  );

  const masteredByLevel: Record<DifficultyLevel, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const card of memoryState.cards.values()) {
    if (card.status === 'review' && card.reps >= 2) {
      const lv = card.objectiveDifficulty;
      if (lv >= 1 && lv <= 5) masteredByLevel[lv] += 1;
    }
  }

  return {
    streak,
    totalWords,
    totalSessions,
    languages,
    masteredByLevel,
    completedCompounds: 0,
    lastSessionPerfect,
  };
}
```

在复习流中调用：

```typescript
// startReview
useAchievementStore.getState().checkAndUnlock(buildAchievementContext(false));

// nextCard 完成时
const stats = get().getStats();
const lastSessionPerfect = stats.total > 0 && stats.wrong === 0;
useAchievementStore.getState().checkAndUnlock(buildAchievementContext(lastSessionPerfect));
```

---

### V3-P2-006 exportService CSV 转义不完整

| 属性 | 值 |
|------|-----|
| **严重程度** | P2（功能错误 — 数据完整性） |
| **文件** | `src/features/review/services/exportService.ts` |
| **行号** | L45-73（toCSV）、L102-114（toAnkiCSV） |

**问题描述**

`toCSV` 方法对 `card.lemma` 用 `"${card.lemma}"` 包裹，但未转义内部双引号（CSV 规范要求内部双引号用 `""` 转义）。同时 `card.id` 等字段完全未加引号包裹。

```typescript
// L59-70 当前代码
const rows = cards.map((card) => [
  card.id,                              // 未加引号
  `"${card.lemma}"`,                    // 加了引号但未转义内部 "
  card.objectiveDifficulty,
  this.formatDate(card.firstLearnedAt),
  // ...
]);
return [headers, ...rows].map((row) => row.join(',')).join('\n');
```

`toAnkiCSV`（L102-114）同样存在此问题，且 `back` 字段包含换行符（L105-109），虽然用引号包裹了但内部双引号未转义。

**根因分析**

CSV 转义规范（RFC 4180）要求：
1. 字段含逗号、双引号或换行符时，必须用双引号包裹
2. 字段内部的双引号必须用两个双引号 `""` 转义

当前实现只对 `lemma` 加了引号但漏了转义，其它字段既没加引号也没转义。虽然英语/德语词汇极少包含双引号或逗号，但多词表达（如 "self-aware"）或含撇号的词可能导致 CSV 解析异常。

**修复建议**

```typescript
private static escapeCSVField(value: string | number): string {
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

private static toCSV(cards: MemoryCard[]): string {
  const headers = ['ID', '词汇', '难度等级', /* ... */];
  const rows = cards.map((card) => [
    this.escapeCSVField(card.id),
    this.escapeCSVField(card.lemma),
    this.escapeCSVField(card.objectiveDifficulty),
    this.escapeCSVField(this.formatDate(card.firstLearnedAt)),
    this.escapeCSVField(this.formatDate(card.due)),
    this.escapeCSVField(card.reps),
    this.escapeCSVField(card.lapses),
    this.escapeCSVField(this.getStatusLabel(card.status)),
    this.escapeCSVField(card.stability.toFixed(2)),
    this.escapeCSVField(card.difficulty.toFixed(2)),
  ]);
  return [headers, ...rows].map((row) => row.join(',')).join('\n');
}
```

---

### V3-P2-007 getDueCards 正则推断语言对德语小写词误判

| 属性 | 值 |
|------|-----|
| **严重程度** | P2（功能错误 — 复习队列语言过滤错误） |
| **文件** | `src/features/review/store/useMemoryStore.ts` |
| **行号** | L118-137 |

**问题描述**

`getDueCards` 在 `card.language` 字段缺失时（向后兼容旧卡片），用 `/^[a-z]/` 正则推断语言：小写字母开头判为英语，否则判为德语。但德语动词/形容词/副词都是小写开头（如 `laufen`、`schön`、`verstehen`），会被误判为英语。

```typescript
// L126-132 当前代码
} else {
  // 向后兼容：旧卡片无 language 字段时，用正则推断
  const isEnglish = /^[a-z]/.test(card.lemma);
  if (language === 'en' && !isEnglish) continue;
  if (language === 'de' && isEnglish) continue;  // laufen 被判为英语，德语复习时被过滤掉
}
```

**根因分析**

V2 修复了 `useMemoryStore` 的德语正则问题（V2-P1-002，移除了 `i` 标志），但该修复只让正则更严格（仅匹配小写），并没有解决根本问题：德语名词大写、其它词类小写，单靠首字母大小写无法区分英德语。

实际影响：用户选择"德语复习"时，所有无 `language` 字段的德语小写词（动词/形容词/副词，占德语词汇的大多数）都会被过滤掉，无法出现在复习队列中。

**修复建议**

正则推断本身就不可靠，应改用 `card.language` 字段优先，并在 `createInitialMemoryCard` 时强制写入 `language`。对于已存在的无 `language` 旧卡片，应通过 persist migrate 补全，而非用启发式猜测。

短期修复（减少误判）：用变音符号 + 首字母大写综合判断

```typescript
} else {
  // 向后兼容：旧卡片无 language 字段时的启发式推断
  // 德语特征：含 ä/ö/ü/ß，或首字母大写（德语名词）
  const hasGermanChars = /[äöüß]/i.test(card.lemma);
  const startsUpper = /^[A-ZÄÖÜ]/.test(card.lemma);
  const isGerman = hasGermanChars || startsUpper;
  if (language === 'en' && isGerman) continue;
  if (language === 'de' && !isGerman) continue;
}
```

长期修复：在 `onRehydrateStorage` 中为无 `language` 字段的旧卡片补全（基于 `lemma` 所在的 passage language），并升级 schema version 触发 migrate。

---

### V3-P2-008 schedulerAdapter learning_steps 硬编码影响 FSRS 调度

| 属性 | 值 |
|------|-----|
| **严重程度** | P2（功能错误 — FSRS 调度精度） |
| **文件** | `src/features/review/services/schedulerAdapter.ts` |
| **行号** | L112 |

**问题描述**

`scheduleNextReview` 构造 `fsrsCard` 时硬编码 `learning_steps: 1`。`learning_steps` 是 ts-fsrs v5 中 `Card` 对象的字段，表示当前学习步骤索引。硬编码为 1 意味着每次评分时卡片的学习步骤都被重置为 1，FSRS 无法正确追踪 Learning 态卡片的步骤进度。

```typescript
// L102-113 当前代码
const fsrsCard: Card = {
  due: new Date(card.due),
  stability: card.stability,
  difficulty: card.difficulty,
  elapsed_days: card.elapsedDays,
  scheduled_days: card.scheduledDays,
  reps: card.reps,
  lapses: card.lapses,
  state: card.status === 'new' ? State.New : /* ... */,
  last_review: new Date(card.lastReviewAt ?? card.firstLearnedAt),
  learning_steps: 1,  // 硬编码，每次评分都重置
};
```

同时 `fsrsCardToMemoryCard`（L33-67）在转换回 `MemoryCard` 时未保留 `learning_steps`，导致该字段在持久化中丢失，下次评分时又从 1 开始。

**根因分析**

`MemoryCard` 类型未包含 `learning_steps` 字段，`fsrsCardToMemoryCard` 无法持久化它。这导致 FSRS 的多步学习（learning steps）机制失效：卡片在 Learning 态的多个步骤（如 1min → 10min）之间无法正确推进，每次评分都被重置到步骤 1。

实际影响：Learning 态卡片的复习间隔可能偏短（始终停留在第一步的间隔），用户会感觉这些卡片"复习得太频繁"。

**修复建议**

1. 在 `MemoryCard` 类型中新增 `learningSteps: number` 字段
2. `fsrsCardToMemoryCard` 持久化 `learning_steps`
3. `scheduleNextReview` 从 `card.learningSteps` 读取而非硬编码

```typescript
// types/index.ts
export interface MemoryCard {
  // ...existing fields...
  learningSteps: number;
}

// schedulerAdapter.ts — fsrsCardToMemoryCard
return {
  // ...existing fields...
  learningSteps: fsrsCard.learning_steps,
};

// schedulerAdapter.ts — scheduleNextReview
const fsrsCard: Card = {
  // ...
  learning_steps: card.learningSteps ?? 1,  // 从持久化读取
};

// schedulerAdapter.ts — createInitialMemoryCard
return fsrsCardToMemoryCard(card, /* ... */ , language);
// fsrsCardToMemoryCard 中 learningSteps 取 emptyCard.learning_steps（默认 0）
```

注意：需配合 persist migrate（schema version +1）为旧数据补 `learningSteps: 1` 默认值。

---

## P3 代码质量

### V3-P3-001 useReadingHistoryStore addEntry 同毫秒 id 冲突

| 属性 | 值 |
|------|-----|
| **严重程度** | P3（代码质量 — 极端情况下 id 冲突） |
| **文件** | `src/features/reading/store/useReadingHistoryStore.ts` |
| **行号** | L36-45 |

**问题描述**

`addEntry` 用 `history-${Date.now()}` 生成 id。如果同一毫秒内调用两次 `addEntry`（理论上可能发生在快速连续生成 passage 时），两个 entry 会拿到相同的 id，导致 `completeEntry` / `getEntry` / `removeEntry` 操作错误的 entry。

```typescript
// L36-45 当前代码
addEntry: (entry) => {
  const newEntry: HistoryEntry = {
    ...entry,
    id: `history-${Date.now()}`,  // 同毫秒会冲突
  };
  // ...
```

**根因分析**

`Date.now()` 精度为毫秒，在正常用户交互下几乎不可能同毫秒触发两次 passage 生成。但自动化测试或未来可能的批量导入场景下可能触发。

**修复建议**

```typescript
let historyIdCounter = 0;

addEntry: (entry) => {
  const newEntry: HistoryEntry = {
    ...entry,
    id: `history-${Date.now()}-${historyIdCounter++}`,
  };
  // ...
```

---

### V3-P3-002 useLLMGenerator llm config 变化时未重置 isLoading

| 属性 | 值 |
|------|-----|
| **严重程度** | P3（代码质量 — 极端情况下 loading 卡死） |
| **文件** | `src/features/llm/services/llmAdapter.ts` |
| **行号** | L356-395 |

**问题描述**

`useLLMGenerator` hook 在 `llm.provider/model/apiKey/baseUrl` 变化时（L364-366），只重置 `lastResult` 不重置 `isLoading`。如果用户在 LLM 调用进行中修改了 LLM 配置，`isLoading` 会保持 true，而 `lastResult` 被清空。旧请求完成后 `setLastResult` 会写入基于旧配置的结果，但 `isLoading` 在 `finally` 中被重置。

```typescript
// L364-366 当前代码
useEffect(() => {
  setLastResult(null);
  // isLoading 未重置
}, [llm.provider, llm.model, llm.apiKey, llm.baseUrl]);
```

**根因分析**

这是一个边界场景：用户在 LLM 调用进行中修改配置。`finally` 块（L389-391）会重置 `isLoading`，所以不会永久卡死。但如果旧请求因配置变化而失败/超时，用户会看到 `isLoading=true` 持续到超时。

**修复建议**

```typescript
useEffect(() => {
  setLastResult(null);
  setIsLoading(false);  // 配置变化时重置 loading 状态
}, [llm.provider, llm.model, llm.apiKey, llm.baseUrl]);
```

---

### V3-P3-003 glossAdapter detectLanguage umlaut 启发式 fallback 误判

| 属性 | 值 |
|------|-----|
| **严重程度** | P3（代码质量 — 无变音符的德语词误判） |
| **文件** | `src/features/evaluation/services/glossAdapter.ts` |
| **行号** | L160-165 |

**问题描述**

`detectLanguage` 在 `fallback` 参数未传入时，用 `/[äöüß]/` 检测 surfaceForm：含变音符判德语，否则判英语。大量德语词不含变音符（如 `laufen`、`gehen`、`Haus`、`verstehen`），会被误判为英语，导致查英语 Wiktionary 而非德语 Wiktionary。

```typescript
// L160-165 当前代码
function detectLanguage(token: TokenOccurrence, fallback?: Language): Language {
  if (fallback === 'en' || fallback === 'de') return fallback;
  const surface = token.surfaceForm;
  if (/[äöüß]/.test(surface)) return 'de';
  return 'en';  // laufen / gehen / Haus 全部误判为英语
}
```

**根因分析**

V2 修复了 `RemedyPanel` 的语言判断（V2-P3-004，改用 `language` prop），但 `glossAdapter.detectLanguage` 作为底层函数仍保留启发式 fallback。当调用方未传 `language` 时（如 `getGloss(token)` 无第二参数），会走这条不可靠的路径。

实际影响：查词释义时对德语无变音符词查了英语 Wiktionary，返回错误语言的释义或查无结果。

**修复建议**

让 `getGloss` 的 `language` 参数变为必传（调用方 `RemedyPanel` 已传入），删除启发式 fallback：

```typescript
export async function getGloss(
  token: TokenOccurrence,
  language: Language  // 改为必传
): Promise<GlossPayload> {
  const adapter = getDictionaryAdapter();
  // ...
}

// detectLanguage 可删除，或保留但标记 deprecated
```

---

### V3-P3-004 InteractivePassage paragraphRanges 全空 parts 边界

| 属性 | 值 |
|------|-----|
| **严重程度** | P3（代码质量 — 极端 LLM 输出导致文章不渲染） |
| **文件** | `src/features/reading/components/InteractivePassage.tsx` |
| **行号** | L209-260 |

**问题描述**

`paragraphRanges` useMemo 在 `text` 含 `\n\n` 时，用 `text.split(/\n\n+/).filter((p) => p.trim().length > 0)` 切分段落。如果 LLM 返回的 text 全部由 `\n\n` 组成（如 `"\n\n\n\n"`），`filter` 后 `parts` 为空数组，`ranges` 也为空数组。

后续 `paragraphSegments`（L379-413）在 `paragraphRanges.length === 0` 时返回空数组，导致整个 passage 的文本不渲染。

```typescript
// L213-228 当前代码
if (/\n\n/.test(text)) {
  const parts = text.split(/\n\n+/).filter((p) => p.trim().length > 0);
  const ranges: ParagraphRange[] = [];
  // ... 遍历 parts 构建 ranges
  return ranges;  // parts 全空时返回 []
}
// 兜底分支不会被触发（因为 text 含 \n\n，进了 if 分支）
```

**根因分析**

兜底分支（L231-259，按句子切分）只在 text 不含 `\n\n` 时触发。当 text 含 `\n\n` 但 split 后全空时，既不进兜底分支，ranges 又为空，passage 文本完全丢失。

实际影响：极低概率（LLM 不太可能输出纯 `\n\n`），但属于防御性编程缺失。

**修复建议**

在 `\n\n` 分支末尾加兜底：

```typescript
if (/\n\n/.test(text)) {
  const parts = text.split(/\n\n+/).filter((p) => p.trim().length > 0);
  if (parts.length === 0) {
    return [{ text, start: 0, end: text.length }];
  }
  // ...existing logic...
  return ranges;
}
```

---

### V3-P3-005 passageGenerator detectCompoundWordsForTokens 原地修改 token

| 属性 | 值 |
|------|-----|
| **严重程度** | P3（代码质量 — 副作用隐患） |
| **文件** | `src/features/reading/services/passageGenerator.ts` |
| **行号** | L94-107 |

**问题描述**

`detectCompoundWordsForTokens` 直接修改传入的 `tokens` 数组中的 token 对象（`token.isCompound = true`、`token.compoundParts = ...`）。这些 token 对象来自 `buildPassageFromLLM` 构建的 `passage.tokens`，而该 passage 可能被放入缓存（L328）。

```typescript
// L94-107 当前代码
async function detectCompoundWordsForTokens(
  tokens: TokenOccurrence[],
  language: Language
): Promise<void> {
  if (language !== 'de') return;
  for (const token of tokens) {
    const compoundData = await splitCompound(token.lemma, language);
    if (compoundData) {
      token.isCompound = true;              // 原地修改
      token.compoundParts = compoundData.parts.map((p) => p.text);
    }
  }
}
```

**根因分析**

当前调用顺序（L326-329）是先 `detectCompoundWordsForTokens` 再 `putIntoCache`，所以缓存中的 passage 已经包含复合词信息，不会丢失。但如果未来有人调整调用顺序（先缓存再检测），缓存中的 passage 会被意外修改。此外，`applyDifficulties`（L236-251）也是原地修改 passage，同样有此隐患。

**修复建议**

改为不可变更新（返回新数组而非原地修改）：

```typescript
async function detectCompoundWordsForTokens(
  tokens: TokenOccurrence[],
  language: Language
): Promise<TokenOccurrence[]> {
  if (language !== 'de') return tokens;
  const result: TokenOccurrence[] = [];
  for (const token of tokens) {
    const compoundData = await splitCompound(token.lemma, language);
    if (compoundData) {
      result.push({
        ...token,
        isCompound: true,
        compoundParts: compoundData.parts.map((p) => p.text),
      });
    } else {
      result.push(token);
    }
  }
  return result;
}

// 调用处
enriched.tokens = await detectCompoundWordsForTokens(enriched.tokens, language);
```

---

### V3-P3-006 loadSession abort 不传递给 generatePassage

| 属性 | 值 |
|------|-----|
| **严重程度** | P3（代码质量 — abort 仅检查不取消） |
| **文件** | `src/features/reading/store/useReadingSessionStore.ts` |
| **行号** | L111-220 |

**问题描述**

V2 修复了 `loadSession` 的竞态（V2-P2-004），加入了 `AbortController`。但 abort 仅用于在几个检查点（L124、L132、L142）判断是否提前 return，并未将 `controller.signal` 传递给 `generatePassage`。

这意味着：用户快速连续点击"生成新文本"时，旧请求的 `generatePassage`（可能包含数秒的 LLM 调用 + 难度评估 + 语法检测）不会被真正取消，仍会在后台执行完毕。旧请求的结果虽然被 abort 检查丢弃（不 setState），但浪费了 LLM API 调用配额和网络带宽。

```typescript
// L129-130 当前代码
try {
  passage = await generatePassage(language, difficulty, dueCards);
  // generatePassage 未接收 controller.signal
```

**根因分析**

`generatePassage` 签名不支持 `AbortSignal`。要从根本上取消 LLM 调用，需要整条链路透传 signal：`loadSession` → `generatePassage` → `generateWithFallback` → `getProvider()` → Edge Function fetch。

这是一个较大的改造，且 V2 的检查点方案已能避免竞态覆盖，所以列为 P3。

**修复建议**

分阶段实施：

1. 给 `generatePassage` 加可选 `signal` 参数
2. 透传到 `generateWithFallback`（已支持 `signal`）
3. 透传到 `detectGrammarPoints` / `splitCompound` / `evaluateDifficulty`

```typescript
// passageGenerator.ts
export async function generatePassage(
  language: Language,
  difficulty: DifficultyLevel,
  dueCards: MemoryCard[] = [],
  signal?: AbortSignal  // 新增
): Promise<Passage> {
  // ...
  const result = await generateWithFallback(llm, {
    // ...
    signal,  // 透传
  });
  // 在各 await 后检查 signal.aborted
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  // ...
}

// useReadingSessionStore.ts
passage = await generatePassage(language, difficulty, dueCards, controller.signal);
```

---

## 汇总统计

| 严重程度 | 数量 | 问题编号 |
|---------|------|---------|
| P1（崩溃/数据丢失） | 0 | — |
| P2（功能错误） | 8 | V3-P2-001 ~ V3-P2-008 |
| P3（代码质量） | 6 | V3-P3-001 ~ V3-P3-006 |
| **合计** | **14** | |

### 按维度分类

| 审查维度 | 涉及问题 |
|---------|---------|
| 运行时崩溃风险 | V3-P3-004（极端 LLM 输出） |
| 异步竞态条件 | V3-P2-002、V3-P2-003、V3-P2-004、V3-P3-006 |
| 状态一致性 | V3-P2-005、V3-P2-007、V3-P2-008 |
| 资源泄漏 | V3-P2-002、V3-P2-004 |
| 逻辑错误 | V3-P2-001、V3-P2-005、V3-P2-006、V3-P2-007、V3-P2-008、V3-P3-003 |
| 性能问题 | V3-P3-005、V3-P3-006 |

### 修复优先级建议

1. **优先修复**（影响核心功能）: V3-P2-005（成就无法解锁）、V3-P2-007（德语复习队列缺失）、V3-P2-008（FSRS 调度失真）
2. **尽快修复**（影响用户体验）: V3-P2-001（假数据）、V3-P2-002（卸载警告）、V3-P2-003（释义错位）、V3-P2-004（卸载跳转）
3. **择机修复**（数据完整性）: V3-P2-006（CSV 转义）
4. **低优先级**（代码质量）: V3-P3-001 ~ V3-P3-006

---

## 审查覆盖范围

### 已审查目录

| 目录 | 关键文件数 | 发现问题数 |
|------|-----------|-----------|
| `src/features/reading/` | 8 | 4 |
| `src/features/review/` | 6 | 5 |
| `src/features/llm/` | 8 | 2 |
| `src/features/grammar/` | 3 | 0 |
| `src/features/evaluation/` | 3 | 2 |
| `src/features/achievements/` | 2 | 1 |
| `src/features/dictionary/` | 2 | 0 |
| `src/store/` | 2 | 0 |
| `src/components/` | 3 | 0 |
| `netlify/edge-functions/` | 1 | 0 |

### 未发现问题的模块

- `src/features/grammar/` — V2 已修复 grammarDetector LLM 路径和 CompoundWordDisplay 竞态，当前无新增问题
- `src/features/dictionary/` — wiktextractAdapter 有 inflight Map 去重 + LRU 缓存，实现完整
- `src/store/` — useToastStore 已用 toastTimers Map 追踪，offlineMode init() 返回 cleanup
- `netlify/edge-functions/` — llm-proxy 仅支持 openai 并对其它返回 501，行为明确

---

*报告结束*
