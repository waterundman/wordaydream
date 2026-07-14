# v2.2.3 SPEC — 组件优化迭代

## 版本信息
- 版本: 2.2.3
- 版本类型: optimization (非 hotfix, 纯优化)
- 前置版本: v2.2.2 (512 tests)
- 目标: 提高可标注词汇数量 + 优化核心组件 UX + 清理代码质量

## 背景与动机

v2.2.2 端到端测试发现:
1. LLM 返回 8-12 个 token,但 alignment validator 丢弃约 25-50%,最终只剩 5-6 个可标注词汇
2. InteractivePassage 用 CSS modules 哈希,E2E selector 无法定位 token
3. 段落 stagger 动画不尊重 prefers-reduced-motion
4. WordlistPage 大量 inline style 违反设计规范
5. ReviewSessionPage 计时器不更新 + statsLine 重复 filter

## Stage 1: Token 存活率提升

### D1-1: alignmentValidator 增加 Step 4.5 宽松匹配层

**文件**: src/features/llm/utils/alignmentValidator.ts

在 Step 4 (词边界正则) 失败后、Step 5 (dropped) 之前,增加宽松匹配:
1. 用 `surfaceForm.trim()` 去除前后空格再做词边界匹配
2. 用 `surfaceForm.toLowerCase()` 全小写再做词边界匹配
3. 对英文/德语简单词干化 (去 -ed/-s/-ing 后缀) 再匹配
4. 最后兜底:用 `indexOf` 子串匹配 (配合 InteractivePassage 边界检查)

返回 status='fallback',originalOffset 保留。

### D1-2: passageGenerator wordlist 补偿

**文件**: src/features/reading/services/passageGenerator.ts

当 alignedPayload.tokens.length < 8 时,从 wordlist 取未学词补齐:
1. 调用 `getUnlearnedWordsSync(language, difficulty, 8 - currentCount)` 取补充词
2. 对每个补充词,在 passage.text 中用词边界正则查找首次出现位置
3. 找到则创建 `kind: 'normal'` token,找不到则跳过
4. 确保最终 token 数量尽量接近 8

### 测试用例

| ID | 描述 | 类型 |
|----|------|------|
| T01 | Step 4.5 trim 匹配: surfaceForm 前后有空格时能匹配 | unit |
| T02 | Step 4.5 toLowerCase 匹配: surfaceForm 大写但 text 小写时能匹配 | unit |
| T03 | Step 4.5 词干化匹配: surfaceForm="walked" 能匹配 text 中的 "walk" | unit |
| T04 | Step 4.5 兜底 indexOf: 极端情况下用子串匹配 (status='fallback') | unit |
| T05 | passageGenerator 补偿: alignedTokens < 8 时从 wordlist 补齐 | unit |
| T06 | passageGenerator 补偿: 补齐的 token 在 text 中找到匹配位置 | unit |

## Stage 2: InteractivePassage 优化

### D2-1: 添加 data-testid 属性

**文件**: src/features/reading/components/InteractivePassage.tsx

- TokenSpan wrapper: `data-testid="passage-token"` + `data-token-id={token.id}`
- GrammarSpan wrapper: `data-testid="passage-grammar"`
- LinkedOccurrenceHighlight trigger: `data-testid="token-trigger"`
- passage root: 已有 `data-passage-root`
- paragraph: 已有 `data-paragraph`

### D2-2: prefers-reduced-motion 支持

**文件**: src/features/reading/components/InteractivePassage.tsx

段落 stagger 动画 (L504-523) 检测 `prefers-reduced-motion`:
- 若用户启用减少动画:一次性 `setVisibleParagraphs(new Set(allParagraphIndices))`,跳过 setTimeout stagger
- 若未启用:保持现有 100ms stagger 行为

### D2-3: token 焦点可见性提升

**文件**: src/features/reading/components/InteractivePassage.module.css

- token focused 状态增加 `background: var(--color-bg-subtle, #f0ede5)`
- 保持现有 outline 不变

### 测试用例

| ID | 描述 | 类型 |
|----|------|------|
| T07 | TokenSpan 渲染 data-testid="passage-token" | unit |
| T08 | TokenSpan 渲染 data-token-id | unit |
| T09 | prefers-reduced-motion 启用时段落一次性可见 (无 stagger) | unit |
| T10 | prefers-reduced-motion 禁用时保持 stagger 行为 | unit |

## Stage 3: 代码质量优化

### D3-1: WordlistPage inline style 清理

**文件**: src/features/wordlist/WordlistPage.tsx + src/features/wordlist/WordlistPage.module.css

- CSV 导入预览 (L392-509): inline style 提取到 `.csvPreview` / `.csvPreviewError` / `.csvPreviewRow` 等 class
- 我的词库列表 (L551-636): inline style 提取到 `.wordlistItem` / `.wordlistActions` 等 class
- 颜色硬编码 (`#b91c1c` / `#fef2f2`) 替换为 CSS variables (`--color-error-text` / `--color-error-bg`)

### D3-2: ReviewSessionPage 性能优化

**文件**: src/features/review/components/ReviewSessionPage.tsx

- statsLine (L193-208) 3 个 filter 提取到 useMemo
- formatElapsed (L498-503) 用 useReadingTimeTracker hook 替代手动计算
- progressBar 样式与 ReadingSessionPage 统一 (用 CSS module)

### 测试用例

| ID | 描述 | 类型 |
|----|------|------|
| T11 | WordlistPage CSV 预览使用 CSS module class (无 inline color) | unit |
| T12 | WordlistPage 词库列表使用 CSS module class | unit |
| T13 | ReviewSessionPage statsLine 用 useMemo | unit |
| T14 | ReviewSessionPage 实时计时器更新 (useReadingTimeTracker) | unit |

## 验证协议

- 单元测试: >= 512 + T01-T14 (526+)
- tsc: 0 errors
- 端到端: 验证 token 数量 >= 8 + data-testid 可定位
- 设计约束: 暖白 #faf8f5 + 深墨 #1c1917 + 无 emoji + prefers-reduced-motion 支持

## 不在本次 scope

- 虚拟列表 (react-window / @tanstack/react-virtual) — v2.3.0
- RAG 集成 — v2.3.0
- per-word FSRS — v2.3.0
- Playwright 自动化测试套件 — v2.3.0
