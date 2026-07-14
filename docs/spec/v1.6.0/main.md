# Wordaydream v1.6.0 — 词表驱动的课程系统

**版本**: v1.6.0
**日期**: 2026-07-12
**状态**: 规划中, 待用户 review
**起点 posterior**: 0.99+ (v1.5.3 评估反馈优化完成)
**终点 posterior 目标**: 0.99+ (持平, 课程化是产品定位升级, 非技术风险)
**工期**: 3-4 天前端代码 + 词表数据准备

---

## 1. 背景: 当前系统为什么不算课程

v1.5.3 完成评估反馈优化后, 系统在"自由阅读 + 间隔复习"维度已生产可用. 但用户指出核心缺陷: **参照 1-5 难度值生成文本不构成一门课程**, 无法辅助用户"背完所有单词".

### 1.1 当前系统的 7 个课程要素缺口

| 课程要素 | 当前状态 | 证据 |
|---|---|---|
| 预定义词表 | 无, LLM 完全自由生成 | prompts.ts L54-62 只约束数量 |
| 线性学习路径 | 无, 只有难度 1-5 自由切换 | grep course/curriculum/lesson 0 命中 |
| 通关/毕业 | 无, L5 全 mastered 也无毕业事件 | grep graduation 0 命中 |
| "未学词"概念 | 不存在 | 无词表, 无法计算未学词数 |
| 难度自动推进 | 仅软建议, 用户可永远停留 L1 | difficultyAdvisor.ts L46-66 |
| 首页 ProgressRing | 占位未接线, 永远显示 0/8 | HomePage.tsx L52-57 默认值 |
| 词表覆盖率 | 不存在 | 无词表作为分母 |

### 1.2 v1.5.3 方向文档未覆盖

[v1.5.3 方向文档](../../vault/v1.5.3-NEXT-VERSION-DIRECTION.md) 的 P1 方向是"用户认证 + i18n + 词卡复习", 完全未触及课程化缺口. 本文档填补这个空白.

---

## 2. 设计决策 (已与用户确认)

| 决策点 | 选择 | 理由 |
|---|---|---|
| 词表来源 | 标准 CEFR/Goethe 词表 | 用户选"标准词表驱动" |
| 词表范围 | A1-B2 (内置), C1 自由生成 | 覆盖 95% 学习者, Bundle 体积可控 |
| 进度模型 | 闯关模式 (默认) + 自由切换 (设置可开) | 两种用户都照顾 |
| 实施顺序 | 英语先行, 德语跟进 | 风险低, Goethe 词表版权敏感 |
| 目标用户 | 双语通吃 (英语 + 德语) | 用户明确选择 |
| 难度复用 | 复用 1-5, 映射 CEFR A1-C1 | 0 breaking change, 数量恰好对齐 |
| Lesson 划分 | 不划分, 仅按 CEFR 等级追踪 | 轻量, 避免额外元数据 |

---

## 3. 难度映射 (复用 1-5)

| 当前难度 | CEFR 等级 | 词表 | 解锁条件 | UI 标签 |
|---|---|---|---|---|
| 1 | A1 | 内置 ~500 词 | 默认解锁 | A1 入门 |
| 2 | A2 | 内置 ~1000 词 | A1 ≥80% mastered | A2 基础 |
| 3 | B1 | 内置 ~2000 词 | A2 ≥80% mastered | B1 进阶 |
| 4 | B2 | 内置 ~4000 词 | B1 ≥80% mastered | B2 中高级 |
| 5 | C1 | 不内置, 自由生成 | B2 ≥80% mastered | C1 自由阅读 |

**0 breaking change**: 难度类型 `DifficultyLevel = 1 | 2 | 3 | 4 | 5` 完全不变, useSettingsStore.difficulty 字段不变, persist 不升级.

**UI 变化**: 阅读页难度滑块的两端标签从"入门/进阶"改为"A1/C1", 每个圆点 hover 时显示对应 CEFR 等级.

---

## 4. 数据契约

### 4.1 词表 JSON Schema

```json
// src/data/wordlists/en/a1.json
{
  "language": "en",
  "level": "A1",
  "difficulty": 1,
  "version": "1.0.0",
  "total": 500,
  "words": [
    {
      "lemma": "be",
      "pos": "verb",
      "translation": "是",
      "cefr": "A1"
    },
    {
      "lemma": "have",
      "pos": "verb",
      "translation": "有",
      "cefr": "A1"
    }
  ]
}
```

### 4.2 词表文件组织

```
src/data/wordlists/
├── en/
│   ├── a1.json  (~500 词, ~25KB)
│   ├── a2.json  (~1000 词, ~50KB)
│   ├── b1.json  (~2000 词, ~100KB)
│   └── b2.json  (~4000 词, ~200KB)
├── de/
│   ├── a1.json  (~650 词, Goethe A1)
│   ├── a2.json  (~1200 词, Goethe A2)
│   ├── b1.json  (~2350 词, Goethe B1)
│   └── b2.json  (~4400 词, Goethe B2)
└── index.ts     // 按需加载入口
```

**Bundle 体积**: 英语 4 文件共 ~375KB, 德语 4 文件共 ~525KB. 通过动态 import 按需加载, 首屏只加载当前等级词表.

### 4.3 词表数据来源

**英语** (优先开源):
- CEFR-J Wordlist (https://www.cefr-j.org/) — 学术开源, A1-B2 共 ~7500 词
- 或 EVP-C (English Vocabulary Profile) Cambridge 开源版
- 缺少时用 LLM 从公开语料生成 + 人工校验

**德语** (v1.6.1 跟进):
- Goethe-Institut 官方 A1-B2 词表 (版权敏感, 需确认许可)
- 备选: Tandem Gmbh 开源 Goethe 词表 GitHub 仓库
- 缺少时用 LLM 从 DWDS 语料生成 + 人工校验

### 4.4 词表加载策略

```typescript
// src/data/wordlists/index.ts
const wordlistLoaders: Record<string, () => Promise<Wordlist>> = {
  'en:1': () => import('./en/a1.json').then(m => m.default),
  'en:2': () => import('./en/a2.json').then(m => m.default),
  'en:3': () => import('./en/b1.json').then(m => m.default),
  'en:4': () => import('./en/b2.json').then(m => m.default),
  // de 在 v1.6.1 加入
};

const cache = new Map<string, Wordlist>();

export async function loadWordlist(language: Language, difficulty: DifficultyLevel): Promise<Wordlist | null> {
  const key = `${language}:${difficulty}`;
  if (cache.has(key)) return cache.get(key)!;
  const loader = wordlistLoaders[key];
  if (!loader) return null;  // C1 或未支持语种
  const wordlist = await loader();
  cache.set(key, wordlist);
  return wordlist;
}
```

---

## 5. Store 层契约

### 5.1 useWordlistStore (新增)

```typescript
// src/features/wordlist/store/useWordlistStore.ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Language, DifficultyLevel } from '../../../types';
import { loadWordlist } from '../../../data/wordlists';

type WordStatus = 'unseen' | 'learning' | 'mastered';

interface WordlistStore {
  // key = `${language}:${lemma.toLowerCase()}`, value = status
  progress: Record<string, WordStatus>;
  // 已加载的词表缓存 (内存, 不持久化)
  loadedWordlists: Record<string, string[]>;  // key -> lemma 数组
  // 设置: 闯关模式 vs 自由切换
  linearMode: boolean;  // 默认 true
  schemaVersion: number;

  // 派生查询
  getLevelTotal: (language: Language, difficulty: DifficultyLevel) => Promise<number>;
  getMasteredCount: (language: Language, difficulty: DifficultyLevel) => number;
  getUnlearnedWords: (language: Language, difficulty: DifficultyLevel, limit: number) => Promise<string[]>;
  isLevelUnlocked: (language: Language, difficulty: DifficultyLevel) => boolean;
  getWordStatus: (language: Language, lemma: string) => WordStatus;

  // 状态更新 (由 MemoryStore 变化触发)
  syncFromMemoryCards: (cards: Map<string, MemoryCard>) => void;
  markWordLearning: (language: Language, lemma: string) => void;
  markWordMastered: (language: Language, lemma: string) => void;

  // 设置
  setLinearMode: (linear: boolean) => void;
}

// 持久化: 只持久化 progress + linearMode + schemaVersion
// loadedWordlists 内存态, 启动时按需重新加载
```

### 5.2 进度派生规则

```typescript
// 从 MemoryCard 派生 wordlist progress
function deriveStatus(card: MemoryCard): WordStatus {
  if (card.status === 'review' && card.reps >= 2) return 'mastered';
  if (card.status === 'new') return 'unseen';
  return 'learning';  // learning / relearning / review&&reps<2
}

// mastered 判定 (沿用 useHomeAnalytics.ts L65-108 现有定义)
// learning: 已建卡但未稳定掌握
// unseen: 词表中存在但用户从未见过
```

### 5.3 解锁逻辑

```typescript
isLevelUnlocked: (language, difficulty) => {
  if (!get().linearMode) return true;  // 自由模式全解锁
  if (difficulty <= 1) return true;    // A1 默认解锁
  // 上一级 ≥80% mastered
  const prevDifficulty = difficulty - 1;
  const total = get().getLevelTotalSync(language, prevDifficulty);
  if (total === 0) return true;  // 上一级词表未加载, 容错放行
  const mastered = get().getMasteredCount(language, prevDifficulty);
  return mastered / total >= 0.8;
},
```

### 5.4 与 useMemoryStore 的同步

```typescript
// useMemoryStore.rateCard 后触发同步
// useWordlistStore.syncFromMemoryCards(cards)
//   遍历 cards, 对每个 card:
//     - 查词表是否含此 lemma
//     - 若含, 更新 progress[`${lang}:${lemma}`] = deriveStatus(card)
//   清理词表中不存在的 card (LLM 自由生成的词, 不在词表内)
```

---

## 6. 生成约束契约

### 6.1 buildPassagePrompt 升级

```typescript
// src/features/llm/config/prompts.ts 新增参数
export function buildPassagePrompt(
  language: Language,
  difficulty: DifficultyLevel,
  dueCards: Pick<MemoryCard, 'lemma'>[],
  // v1.6.0 NEW: 词表约束
  wordlistConstraint?: {
    targetWords: string[];  // 必须覆盖的未学词 (5-10 个)
    optionalWords: string[];  // 可选覆盖的未学词 (10-20 个)
  }
): { system: string; prompt: string };
```

### 6.2 Prompt 新增约束段落

```
Wordlist constraint (v1.6.0):
- Your passage MUST include at least 4 of these target words (unlearned):
  [word1, word2, word3, word4, word5, word6, word7, word8]
- These words MUST appear in the "tokens" array with correct startIndex/endIndex.
- You MAY also include any of these optional words:
  [word9, word10, word11, ...]
- If you cannot naturally fit a target word, skip it, but include at least 4.
- After generating, self-check: count how many target words appear in "text".
```

### 6.3 passageGenerator 改造

```typescript
// src/features/reading/services/passageGenerator.ts
export async function generatePassage(
  language: Language,
  difficulty: DifficultyLevel,
  dueCards: MemoryCard[] = [],
  signal?: AbortSignal
): Promise<Passage> {
  // v1.6.0 NEW: 从 wordlistStore 取未学词
  const { getUnlearnedWords } = useWordlistStore.getState();
  const targetWords = await getUnlearnedWords(language, difficulty, 8);
  const optionalWords = await getUnlearnedWords(language, difficulty, 20);

  const wordlistConstraint = targetWords.length > 0
    ? { targetWords, optionalWords }
    : undefined;

  // 沿用 LLM 调用, 多传 wordlistConstraint
  const { system, prompt } = buildPassagePrompt(
    language, difficulty, dueCards, wordlistConstraint
  );
  // ... 后续逻辑不变

  // v1.6.0 NEW: LLM 返回后, 校验 tokens 是否覆盖了 targetWords
  // 若覆盖不足, 记录日志但不重试 (避免 LLM 调用爆炸)
  const coveredTargets = payload.tokens
    .filter(t => targetWords.includes(t.lemma.toLowerCase()))
    .map(t => t.lemma);
  console.info(`[Wordlist] target covered: ${coveredTargets.length}/${targetWords.length}`);

  // v1.6.0 NEW: 把词表中的词标记为已见
  for (const lemma of coveredTargets) {
    useWordlistStore.getState().markWordLearning(language, lemma);
  }
}
```

---

## 7. UI 契约

### 7.1 首页 ProgressRing 接线 (修复占位)

**当前**: [HomePage.tsx L52-57](file:///w:/项目仓库/For%20trae/wordaydream/src/features/home/HomePage.tsx) 默认 `completedCount=0, totalCount=8`, 永远显示 0/8.

**v1.6.0 改造**:
```tsx
// HomePage.tsx
import { useWordlistStore } from '../../features/wordlist/store/useWordlistStore';
import { useSettingsStore } from '../../features/settings/store/useSettingsStore';

export function HomePage({ onStartReading, onOpenSettings }: HomePageProps) {
  const { language, difficulty } = useSettingsStore(s => ({
    language: s.language ?? 'en',
    difficulty: s.difficulty,
  }));
  const masteredCount = useWordlistStore(s => s.getMasteredCount(language, difficulty));
  const levelTotal = useWordlistStore(s => s.getLevelTotalSync(language, difficulty));

  return (
    // ...
    <ProgressRing
      completed={masteredCount}
      total={levelTotal || 1}  // 词表未加载时显示 X/1, 不显示 0/8
      label={`A${difficulty} 已掌握 ${masteredCount}/${levelTotal || '?'} 词`}
      revealClassName={progressClassName}
    />
  );
}
```

### 7.2 难度选择解锁 UI

**当前**: [ReadingSessionPage.tsx L167-185](file:///w:/项目仓库/For%20trae/wordaydream/src/features/reading/ReadingSessionPage.tsx) 5 个圆点, 全部可点击.

**v1.6.0 改造**:
- 未解锁的圆点: 灰色 + 锁图标 (inline SVG, 无 emoji)
- hover tooltip: "完成 A1 80% 掌握可解锁"
- 点击未解锁圆点: 不切换, 显示 toast 提示
- 自由模式 (设置开启): 全部圆点可点击, 无锁

### 7.3 课程进度卡片 (新增)

首页 splitRight 区域, ProgressRing 上方新增:
```
┌─────────────────────────────┐
│ 当前等级 A2 · 基础          │
│ ─────────────────────────── │
│ 已掌握  320 / 1000 词       │
│ 进度    ████████░░░░ 32%    │
│ 距 B1    还差 480 词        │
│                             │
│ [继续学习]  [查看词表]      │
└─────────────────────────────┘
```

### 7.4 毕业机制

当前等级 100% mastered 时:
1. 触发 `levelComplete` 事件
2. 显示毕业 modal: "恭喜完成 A2! 已解锁 B1"
3. 自动解锁下一等级
4. 用户可选择"进入 B1"或"留在 A2 巩固"

全部等级 (A1-B2) 100% mastered 时:
1. 触发 `courseComplete` 事件
2. 显示课程毕业 modal: "恭喜完成全部课程! C1 自由阅读已解锁"
3. 成就系统新增"课程毕业"徽章

### 7.5 设置面板新增

```
课程模式
○ 闯关模式 (推荐) — 完成当前等级 80% 才能解锁下一级
○ 自由模式 — 任意等级自由切换, 仅追踪覆盖率
```

---

## 8. 词表浏览页 (新增)

路由: `/wordlist` (从首页"查看词表"按钮进入)

### 8.1 功能
- 显示当前等级词表 (默认隐藏释义, 类似单词本)
- 按状态筛选: 全部 / 未学 / 学习中 / 已掌握
- 搜索框: 按 lemma 或 translation 搜索
- 点击单词: 展开释义 + 例句 (调 glossAdapter)
- 导出: 当前等级词表 JSON

### 8.2 UI
```
┌──────────────────────────────────────┐
│ A2 词表 · 1000 词                     │
│ [全部] [未学 680] [学习中 120] [已掌握 200] │
│ [搜索...]                             │
│ ──────────────────────────────────── │
│ ✓ have    verb  有      已掌握        │
│ ✓ be      verb  是      已掌握        │
│ ◐ go      verb  去      学习中        │
│ ○ see     verb  看见    未学          │
│ ○ find    verb  找到    未学          │
│ ...                                  │
└──────────────────────────────────────┘
```

---

## 9. 与现有系统的兼容

### 9.1 0 breaking change 清单
- `DifficultyLevel = 1 | 2 | 3 | 4 | 5` 类型不变
- `useSettingsStore.difficulty` 字段不变, persist 不升级
- `useMemoryStore` 完全不变, 仍是 FSRS 数据源
- `passageGenerator.generatePassage` 签名扩展 (wordlistConstraint 可选)
- `buildPassagePrompt` 签名扩展 (wordlistConstraint 可选)
- `InlineAnswerPanel` 完全不变 (建卡逻辑不变)

### 9.2 数据流
```
useWordlistStore (词表 + 进度)
  ↓ getUnlearnedWords(language, difficulty, 8)
passageGenerator.generatePassage
  ↓ buildPassagePrompt(..., wordlistConstraint)
LLM 生成 passage (约束覆盖未学词)
  ↓ 用户答对 token
useMemoryStore.addCardFromToken (建卡, FSRS 排程)
  ↓ syncFromMemoryCards
useWordlistStore.progress 更新 (unseen → learning → mastered)
  ↓ getMasteredCount
HomePage ProgressRing 显示真实进度
```

### 9.3 C1 (难度 5) 的特殊处理
- 不内置词表, `loadWordlist('en', 5)` 返回 null
- `getUnlearnedWords` 返回空数组
- `buildPassagePrompt` 不传 wordlistConstraint
- LLM 完全自由生成 (沿用 v1.5.x 行为)
- ProgressRing 显示"自由阅读模式"而非数字

---

## 10. 实施分期

### Stage 1: 英语词表 + Store (v1.6.0 核心)
1. 准备英语 A1-B2 词表 JSON (4 文件, ~7500 词)
2. 实现 `src/data/wordlists/index.ts` 按需加载
3. 实现 `useWordlistStore` + persist
4. 实现 `syncFromMemoryCards` 同步逻辑
5. 单元测试: 词表加载 + 进度派生 + 解锁逻辑

**工期**: 1.5 天
**沙箱可执行**: 100% (纯前端 + 数据)

### Stage 2: 生成约束 + Prompt 升级
1. `buildPassagePrompt` 添加 wordlistConstraint 参数
2. Prompt 新增词表约束段落
3. `passageGenerator` 取未学词 + 注入 prompt + 校验覆盖
4. 单元测试: prompt 含约束 + LLM 返回覆盖校验

**工期**: 1 天
**沙箱可执行**: 100%

### Stage 3: UI 接线
1. HomePage ProgressRing 接线 (修复 0/8)
2. 课程进度卡片新增
3. 难度选择解锁 UI
4. 设置面板新增"闯关/自由"切换
5. 毕业机制 (modal + 事件)
6. 词表浏览页

**工期**: 1.5 天
**沙箱可执行**: 100%

### Stage 4: 德语词表 (v1.6.1)
1. 确认 Goethe 词表数据源 + 许可
2. 准备德语 A1-B2 词表 JSON
3. 添加 `de:1` ~ `de:4` 加载器
4. 测试德语端到端

**工期**: 1 天 (词表数据准备为主)
**沙箱可执行**: 100% (词表数据依赖外部)

---

## 11. 测试契约

### 11.1 vitest 新增 (~20 测试)
- `useWordlistStore.test.ts`: 词表加载 + 进度派生 + 解锁逻辑 + syncFromMemoryCards (8 测试)
- `passageGenerator.wordlist.test.ts`: wordlistConstraint 注入 + 覆盖校验 (5 测试)
- `prompts.wordlist.test.ts`: prompt 含约束段落 (3 测试)
- `HomePage.progress.test.tsx`: ProgressRing 接线 (2 测试)
- `ReadingSessionPage.unlock.test.tsx`: 难度解锁 UI (2 测试)

### 11.2 tsc 0 errors
### 11.3 vite build 0 errors

---

## 12. 合同预测: v1.6.0 新增 4-5 合同

- Contract 40: 英语 CEFR 词表加载 + 按需 import (A1-B2 4 文件)
- Contract 41: useWordlistStore 进度派生 + 解锁逻辑
- Contract 42: passageGenerator 词表约束生成 (targetWords 覆盖 ≥4)
- Contract 43: HomePage ProgressRing 接线 + 课程进度卡片
- Contract 44: 难度解锁 UI + 毕业 modal

累计: 30 → 34-35 合同

---

## 13. 风险与缓解

### 13.1 词表数据源
- 风险: CEFR-J 词表许可不明确, Goethe 词表版权敏感
- 缓解: 优先 MIT/CC-BY 开源词表; 缺少时用 LLM 从公开语料生成 + 人工校验; 德语 v1.6.1 跟进, 不阻塞 v1.6.0

### 13.2 LLM 词表覆盖不达标
- 风险: LLM 不按约束覆盖 targetWords
- 缓解: prompt 强约束 + self-check; 不达标记录日志不重试 (避免 LLM 调用爆炸); 用户可重新生成下一篇

### 13.3 Bundle 体积
- 风险: 8 个词表 JSON 共 ~900KB 影响首屏
- 缓解: 动态 import 按需加载, 首屏只加载当前等级 (1 个文件 ~25-200KB)

### 13.4 闯关模式用户流失
- 风险: 用户卡在 A1 80% 无法升级, 流失
- 缓解: 默认 80% 而非 100%; 设置可开自由模式; 毕业 modal 鼓励继续

### 13.5 词表与 LLM 自由词的冲突
- 风险: LLM 生成的词不在词表内, 无法计入进度
- 缓解: 词表外的词正常建卡 + FSRS 复习, 但不计入 wordlist progress; ProgressRing 只统计词表内词

---

## 14. 与 v1.5.3 方向文档的关系

v1.5.3 方向文档的 P1 (用户认证 / i18n / 词卡复习) 仍是有效方向, 但本课程化升级优先级更高:
- 课程化是产品定位升级 (从工具到课程)
- 用户认证 / i18n 是体验扩展, 不改变核心定位
- 词卡复习已在 v1.5.x 实现完成 (FSRS + ReviewSessionPage)

**建议**: v1.6.0 课程化优先, v1.6.1 德语词表, v1.7.0 用户认证 + i18n.

---

## 15. 待用户 review 的关键问题

1. **词表数据源**: 是否接受用 LLM 从公开语料生成英语 A1-B2 词表 + 人工校验? 还是你能提供现成词表 JSON?
2. **80% 解锁阈值**: 是否合理? 可调为 70% / 90% / 100%
3. **词表浏览页**: v1.6.0 是否必须? 可延后到 v1.6.1
4. **毕业 modal 视觉**: 是否需要特殊动效 (沿用项目动效系统)?
5. **C1 自由阅读**: 难度 5 不内置词表, 仅显示"自由阅读模式", 是否接受?

---

## 16. 教学编排层 (v1.6.0 增补 — 课程化核心)

> 本节是对第 1-15 节的增补. 第 1-15 节解决了"有词表"和"生成时覆盖未学词", 但用户指出仍不足以"辅助背完所有单词". 根因是缺少**教学编排层**: 按什么顺序学、何时引入新词、何时巩固、怎样算真正掌握.

### 16.1 四个课程性缺口

| 缺口 | 现状证据 | 后果 |
|---|---|---|
| 未学词选取无序 | `getUnlearnedWordsSync` 顺序遍历取前 N 个, 无优先级/主题 | 学习碎片化, 低频词过早出现拖低掌握率 |
| 新词引入无节奏 | passageGenerator 每次固定塞 8 个新 targetWords | learning 词堆积, FSRS 永远追不上, 卡死 80% 解锁线 |
| mastered 无语境闭环 | `review && reps>=2` 即 mastered | 同一篇内靠位置记忆答对, 换语境不认识, 假掌握 |
| 无每日目标 | 仅显示总进度 `320/1000` | 用户不知今日该学几个、还要多久, 无节奏感 |

### 16.2 词表 Schema 升级 (v2)

```json
// src/data/wordlists/en/a1.json (v2)
{
  "language": "en",
  "level": "A1",
  "difficulty": 1,
  "version": "2.0.0",
  "total": 80,
  "words": [
    {
      "lemma": "be",
      "pos": "verb",
      "translation": "是",
      "cefr": "A1",
      "priority": 1,
      "topic": "core"
    }
  ]
}
```

- `priority`: `1` (核心高频) / `2` (常用) / `3` (边缘) — 决定学习队列顺序
- `topic`: 主题簇标签 (core / family / food / work / travel / ...) — 让同批 targetWords 同主题, 文本语义连贯

`WordlistEntry` 接口同步扩展:
```typescript
export interface WordlistEntry {
  lemma: string;
  pos: string;
  translation: string;
  cefr: string;
  priority: 1 | 2 | 3;   // NEW
  topic: string;          // NEW
}
```

### 16.3 Progress Schema 升级 + Migration

progress 从 `Record<string, WordStatus>` 升级为带 encounter 追踪的结构:

```typescript
interface WordProgress {
  status: WordStatus;
  encounterCount: number;   // 在不同 passage 中答对的次数 (按 passageId 去重)
  firstEncounteredAt: number;
  lastEncounteredAt: number;
}
type ProgressMap = Record<string, WordProgress>;  // key = `${language}:${lemma}`
```

persist migration (schemaVersion 1 → 2): 旧值若是字符串 (`WordStatus`), 转为 `{ status: old, encounterCount: 0, firstEncounteredAt: 0, lastEncounteredAt: 0 }`, 不丢失已掌握状态.

### 16.4 词汇学习队列 (有序取词)

`getUnlearnedWordsSync` 改为按优先级 + 主题聚簇排序:

```typescript
getUnlearnedWordsSync: (language, difficulty, limit) => {
  const wordlist = getCachedWordlist(language, difficulty);
  if (!wordlist) return [];
  // 1. 筛未学词
  const unlearned = wordlist.words.filter((w) => {
    const key = `${language}:${w.lemma.toLowerCase()}`;
    const st = get().progress[key]?.status;
    return st !== 'mastered' && st !== 'learning';
  });
  // 2. 按 priority 升序, 同 priority 内按 topic 聚簇
  unlearned.sort((a, b) => a.priority - b.priority || a.topic.localeCompare(b.topic));
  // 3. 取前 limit
  return unlearned.slice(0, limit).map((w) => w.lemma);
}
```

效果: 先学完 priority=1 核心词, 再学 priority=2; 同主题词成批出现, 文本连贯.

### 16.5 新词节奏控制 (Pacing) — 打破 mastered 死锁

passageGenerator 取词策略改为 pacing 感知. 引入 `LEARNING_THRESHOLD`, 当 learning 词过载时转入巩固模式, 不再引入新词:

```typescript
const LEARNING_THRESHOLD = 30;

const wordlistState = useWordlistStore.getState();
const learningWords = wordlistState.getLearningWordsSync(language, difficulty, 999);
const isOverloaded = learningWords.length >= LEARNING_THRESHOLD;

const targetWords = isOverloaded
  ? learningWords.slice(0, 8)   // 巩固模式: learning 词作 target, 强化复现
  : await wordlistState.getUnlearnedWords(language, difficulty, 8);  // 正常: 新词

const optionalWords = isOverloaded
  ? []                           // 巩固模式: 专注 target, 不加 optional
  : wordlistState.getLearningWordsSync(language, difficulty, 20);
```

用户侧可感知: 巩固模式下生成按钮文案可变为"巩固复习" (可选 UI 增强, 非必须).

### 16.6 语境闭环掌握判定

mastered 判定从 `review && reps>=2` 升级为要求**至少 2 个不同 passage** 中答对:

```typescript
function deriveStatus(progress: WordProgress | undefined, card: MemoryCard): WordStatus {
  const enc = progress?.encounterCount ?? 0;
  if (card.status === 'review' && card.reps >= 2 && enc >= 2) return 'mastered';
  if (card.status === 'new') return 'unseen';
  return 'learning';
}
```

encounterCount 递增时机: 用户在 InlineAnswerPanel 答对 token 时, 若该 passageId 未记录过, 则 `encounterCount++` 并记 `lastEncounteredAt`. 同一篇内重复答对只算一次 (按 passageId 去重).

### 16.7 每日学习目标

useWordlistStore 新增 dailyGoal 字段:

```typescript
interface DailyGoal {
  date: string;            // yyyy-mm-dd (跨日重置锚点)
  newWordsTarget: number;  // 今日建议新词数 (初期固定 10)
  newWordsDone: number;    // 今日已学新词数 (markWordLearning 时 ++)
  reviewsTarget: number;   // 今日建议复习数 (取 dueCards.length)
  reviewsDone: number;     // 今日已复习数 (rateCard 时 ++)
}
```

- 跨日重置: 复用 useSettingsStore.resetTodayIfNewDay 模式, 日期变更时 newWordsDone/reviewsDone 清零, newWordsTarget 可按历史节奏调整 (v1 后续优化, 初期固定 10)
- UI: ProgressRing 下方显示"今日 3/10 新词 · 5/8 复习", 完成时高亮

### 16.8 实施分期调整

原 Stage 1-3 已部分完成 (词表+Store, 生成约束, ProgressRing/难度解锁/设置面板). 新增 **Stage 3.5: 教学编排层** 插在毕业机制之前, 作为课程化的真正核心:

**Stage 3.5: 教学编排层**
1. 词表 JSON 升级 v2 schema (4 个英语词表加 priority/topic)
2. `WordlistEntry` 接口 + `WordProgress` 类型 + persist migration (v1→v2)
3. `getUnlearnedWordsSync` 优先级+主题排序
4. passageGenerator pacing 感知取词 (LEARNING_THRESHOLD)
5. encounterCount 追踪 (InlineAnswerPanel 答对时递增, passageId 去重) + mastered 闭环判定
6. dailyGoal 字段 + 跨日重置 + ProgressRing 下方日进度 UI
7. 单元测试: 排序 / pacing 过载切换 / encounterCount 去重 / mastered 闭环 / dailyGoal 重置

**Stage 3.6 (原 Stage 3 剩余):** 毕业机制 + 词表浏览页 (相对次要, 教学编排层完成后做)

**Stage 4 (v1.6.1):** 德语词表 (用 v2 schema)

### 16.9 兼容性

- 旧 progress (字符串) 自动 migration, 不丢数据
- C1 (难度 5) 无词表, pacing/队列/dailyGoal 均走空数组分支, 行为不变
- LLM 自由生成的词表外词: 正常建卡+FSRS, 但 encounterCount 不计入 wordlist progress (词表外词不进 ProgressMap)

---

## 17. 记忆保持层 (v1.6.0 增补二 — "背完"的真实闭环)

> 第 16 节解决"学习节奏" (按什么顺序学、何时引入新词、何时巩固), 但用户指出"辅助背完所有单词"还有更深一层含义: **"背完"不是"曾经标记 mastered", 而是"持续记住"**. 本节填补"记忆质量"和"长期保持"两个缺口, 防止 ProgressRing 沦为"历史峰值"而非"当前真实掌握量".

### 17.1 第 16 节未覆盖的两个记忆缺口

| 缺口 | 现状证据 | 后果 |
|---|---|---|
| mastered 无衰减 | `deriveStatus` 只看 `review && reps>=2 && enc>=2`, 不看 `lastReviewAt` / due date | 半年没复习的词仍显示 mastered, ProgressRing 变"假进度", 用户误以为背完了 |
| 困难词无强化 | pacing 巩固模式 `learningWords.slice(0, 8)` 是 FIFO, 不区分"偶尔答错"和"反复遗忘" | `lapses>=3` 的困难词被淹没在普通 learning 词里, 永远卡住, 用户永远到不了 80% 解锁线 |

### 17.2 缺口 A: mastered 衰减机制 (P0)

**目标**: ProgressRing 反映"当前真实掌握量", 而非"历史峰值". 长期未复习的 mastered 词自动降级为 learning, 重新进入学习队列.

#### 17.2.1 衰减阈值

```typescript
// useWordlistStore.ts
const STALE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000; // 30 天
```

- 30 天依据: FSRS 在 reps>=2 且稳定度足够时, 间隔通常已到 14-30 天; 超过 30 天未复习意味着 due 已严重过期, 记忆曲线已下滑
- 该常量放在 store 顶层, 未来可改为用户可配置 (v1.7+)

#### 17.2.2 deriveStatus 升级

```typescript
function deriveStatus(progress: WordProgress | undefined, card: MemoryCard): WordStatus {
  const enc = progress?.encounterCount ?? 0;
  if (card.status === 'new') return 'unseen';
  // mastered 候选: review + reps>=2 + encounterCount>=2
  if (card.status === 'review' && card.reps >= 2 && enc >= 2) {
    // 衰减判定: 超过阈值未复习 → 降级 learning
    const now = Date.now();
    if (card.lastReviewAt && now - card.lastReviewAt > STALE_THRESHOLD_MS) {
      return 'learning';
    }
    return 'mastered';
  }
  return 'learning';
}
```

#### 17.2.3 衰减触发时机

`deriveStatus` 是纯函数, 但 `progress` 在 `syncFromMemoryCards` 时才写入. 若用户不复习, `syncFromMemoryCards` 不触发, 衰减不会反映到 ProgressRing. 需新增两个触发点:

1. **应用启动时**: `App.tsx` useEffect 中调用一次 `syncFromMemoryCards(useMemoryStore.getState().cards)`, 检查所有 mastered 词是否衰减
2. **dailyGoal 跨日重置时**: 日期变更触发 syncFromMemoryCards, 确保新一天开始时 ProgressRing 反映衰减后的真实状态

不引入定时器 (setInterval), 避免后台耗电和状态不一致.

#### 17.2.4 衰减后的数据流

```
mastered 词 30 天未复习
  ↓ syncFromMemoryCards (启动/跨日触发)
deriveStatus 判定 → learning (降级)
  ↓ progress 更新
ProgressRing: 320/1000 → 305/1000 (真实反映)
  ↓ getLearningWordsSync 包含降级词
pacing 巩固模式: 降级词进入 targetWords, 重新复现
  ↓ 用户答对
recordEncounter (新 passageId) → encounterCount++
  ↓ rateCard → FSRS 更新 lastReviewAt
syncFromMemoryCards → deriveStatus 重新判定
  ↓ now - lastReviewAt < 阈值
mastered (恢复) — ProgressRing 回升
```

关键: 衰减不删 encounterCount, 不重置 FSRS 卡片. 只影响 wordlist progress 的 status 派生. FSRS 卡片状态 (review) 不变, 下次复习时 lastReviewAt 更新, deriveStatus 自动恢复 mastered.

### 17.3 缺口 B: 困难词强化 (P1)

**目标**: pacing 巩固模式优先复现"反复遗忘"的词 (lapses 高), 而非 FIFO. 打破"困难词永远卡住"的死锁.

#### 17.3.1 困难词判定

复用现有 `MemoryCard.lapses` 字段 (FSRS 遗忘次数):

```typescript
const DIFFICULT_LAPSES_THRESHOLD = 3; // lapses >= 3 视为困难词
```

- 3 次依据: FSRS 中 lapses>=3 通常意味着 stability 偏低, 间隔难拉长, 需要强化复现
- 该常量同样放在 store 顶层

#### 17.3.2 pacing 巩固模式取词升级

```typescript
// passageGenerator.ts
const LEARNING_THRESHOLD = 30;
const DIFFICULT_LAPSES_THRESHOLD = 3;

const learningWords = wordlistState.getLearningWordsSync(language, difficulty, 999);
const isOverloaded = learningWords.length >= LEARNING_THRESHOLD;

let targetWords: string[];
if (isOverloaded) {
  // 巩固模式: 按 lapses 降序排, 困难词优先
  const memoryState = useMemoryStore.getState();
  const learningWithLapses = learningWords.map((lemma) => {
    // 按 lemma 查找卡片 (需 useMemoryStore 提供按 lemma 查询的方法)
    const card = memoryState.getCardByLemma(language, lemma);
    return { lemma, lapses: card?.lapses ?? 0 };
  });
  learningWithLapses.sort((a, b) => b.lapses - a.lapses);
  targetWords = learningWithLapses.slice(0, 8).map((w) => w.lemma);
} else {
  targetWords = await wordlistState.getUnlearnedWords(language, difficulty, 8);
}
```

#### 17.3.3 useMemoryStore 新增按 lemma 查询

当前 `useMemoryStore.getCardByLexemeGroup` 按 lexemeGroupId 查. 需新增:

```typescript
// useMemoryStore.ts
getCardByLemma: (language: Language, lemma: string) => MemoryCard | undefined;
```

实现: 遍历 cards, 匹配 `card.lemma === lemma && card.language === language`. 若无匹配返回 undefined.

注: WordlistStore 的 lemma 与 MemoryCard 的 lemma 应对齐 (均来自词表或 LLM 生成时的 lemma 字段).

#### 17.3.4 困难词强化的用户体验

- 巩固模式下, 困难词优先作为 targetWords, 在新 passage 中复现
- 用户答对后, recordEncounter + rateCard 更新 FSRS, lapses 不重置但 stability 上升
- 多次答对后, FSRS 自动拉长间隔, 该词逐渐退出困难区
- 无需额外 UI 标注 (困难词状态由系统感知, 用户无感)

### 17.4 缺口 C: 复习编排 (Stage 3.6, 非本 Stage)

**目标**: 课程主动建议复习, 而非依赖用户主动打开 ReviewSessionPage. dueCards 积压时, pacing 强制巩固模式, 首页提示"先复习".

#### 17.4.1 设计要点 (待 Stage 3.6 细化)

- 首页 ProgressRing 下方显示 "N 个词待复习" (dueCards.length > 0 时)
- pacing 联动: `dueCards.length > REVIEW_OVERLOAD_THRESHOLD` (如 20) 时, 强制巩固模式, targetWords 取 dueCards 的 lemma
- "开始复习"按钮直接跳转 ReviewSessionPage
- dailyGoal 的 reviewsTarget/reviewsDone (spec 16.7) 在此接线

本 Stage 不实现, 留待 Stage 3.6 与毕业机制 + 词表浏览页一起做.

### 17.5 实施分期调整 (更新 16.8)

**Stage 3.5: 教学编排层 + 记忆保持层 (A+B)**

1. 词表 JSON 升级 v2 schema (4 个英语词表加 priority/topic) — **pending**
2. `WordlistEntry` 接口 + `WordProgress` 类型 + persist migration (v1→v2) — ✅ 已完成
3. `getUnlearnedWordsSync` 优先级+主题排序 — pending
4. passageGenerator pacing 感知取词 (LEARNING_THRESHOLD) — pending
5. encounterCount 追踪 + mastered 语境闭环判定 — ✅ 已完成
6. **NEW A: mastered 衰减机制** (deriveStatus 加时间判断 + 启动/跨日触发 syncFromMemoryCards) — pending
7. **NEW B: 困难词强化** (useMemoryStore.getCardByLemma + pacing 按 lapses 排序) — pending
8. dailyGoal 字段 + 跨日重置 + ProgressRing 下方日进度 UI — pending
9. 单元测试: 排序 / pacing 过载切换 / encounterCount 去重 / mastered 闭环 / **NEW 衰减降级** / **NEW 困难词优先** / dailyGoal 重置 — pending

**Stage 3.6: 毕业机制 + 词表浏览页 + 复习编排 (C)** — ✅ 已完成 (2026-07-12)

- 毕业 modal + levelComplete 事件 ✅
- 词表浏览页 (`/wordlist`) ✅
- **NEW C: 复习编排** (首页 dueCards 提示 + pacing 联动 dueCards + dailyGoal reviews 接线) ✅

**Stage 4 (v1.6.1):** 德语词表 (用 v2 schema)

### 17.6 兼容性 (补充 16.9)

- mastered 衰减不删 encounterCount, 不重置 FSRS 卡片状态, 只影响 wordlist progress 派生
- 衰减降级的词在用户复习后 (lastReviewAt 更新) 自动恢复 mastered, 无需手动操作
- 困难词强化仅影响 pacing 取词顺序, 不改变 MemoryCard 或 progress 结构
- `getCardByLemma` 是只读查询, 无副作用
- C1 (难度 5) 无词表, 衰减/困难词逻辑均走空数组分支, 行为不变
