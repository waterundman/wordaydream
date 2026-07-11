---
title: "SPEC — Wordaydream v1.1.0"
date: "2026-07-09"
version: "1.1.0"
project: "Wordaydream"
tags:
  - artifact/spec
  - version/1.1.0
  - project/Wordaydream
  - confidence/medium
confidence: 0.78
upstream:
  - "[[cache/v1.1.0/direction-insights]]"
  - "[[cache/v1.1.0/comparison-matrix]]"
  - "[[CONTEXT]]"
  - "[[preview]]"
  - "[[bayesian/v1.0.0/history]]"
downstream:
  - "[[bayesian/v1.1.0/plan]]"
---

# SPEC — Wordaydream v1.1.0

## 迭代方向 (1 句话)

> 解决真实 LLM 集成后三类 passage 质量缺陷: 文本显示问题 (显示) / 段落切分问题 (段落) / 划线精准度问题 (token offset 对齐)。

## 核心问题诊断 (来自 v1.0.0 -> v1.1.0 真实 LLM 调试)

| 问题 | 根因 | 涉及代码 |
|------|------|---------|
| **显示问题** | LLM 输出含 markdown 字符 (`**`, `#`, `*`) / Windows 换行 (`\r\n`) / 首尾空白 / 零宽空格, 直接渲染异常 | InteractivePassage.tsx 渲染层无 text 清洗 |
| **段落问题** | 真实 LLM 输出单段 (无 `\n\n`), InteractivePassage L124 `split(/\n+/)` 失效; L242-268 双层 paragraph split 状态机过复杂 | InteractivePassage.tsx L124, L242-268 |
| **划线精准度** | LLM 给的 `startIndex/endIndex` 与 `surfaceForm` 经常错位 (debug_browser_network.log L101: walked 实际 index 13, grammar 给 10); grammarPoints `id: int` 导致 React key 冲突 | InteractivePassage.tsx L181, L203; LLM prompt 无 char offset 强约束 |

## 实现要点 (供 Bayesian Plan 消费)

### Stage 1: Prompt 优化 + text 清洗

```yaml
expect:
  - symbol: "prompts.ts (新建 PASSAGE_GENERATION_PROMPT_V2)"
    file: "src/features/llm/config/prompts.ts"
    assert:
      - "显式要求 text 必须含 2-3 段落用 \\n\\n 分隔"
      - "显式要求 id 字段是 string (UUID)"
      - "含 few-shot 对齐示例 (text 含 \\n\\n + tokens offsets 严格对齐)"
      - "self-check 步骤在 prompt 末尾强制执行"
    source: "code:modified file"
    confidence: 0.85

  - symbol: "prompts.ts (新建 GRAMMAR_DETECTION_PROMPT_V2)"
    file: "src/features/llm/config/prompts.ts"
    assert:
      - "grammar points id 必须是 string"
      - "startIndex/endIndex 必须严格基于 text 字段字符偏移"
      - "text 字段必须是 text 中真实连续子串"
    source: "code:new constant"
    confidence: 0.85

  - symbol: "OpenAICompatibleProvider.generate 改造"
    file: "src/features/llm/services/openaiProvider.ts"
    assert:
      - "调用时设 response_format: { type: 'json_object' }"
      - "temperature 默认 0.5 不变"
    source: "code:modified file"
    confidence: 0.85

  - symbol: "textNormalize.ts (新建)"
    file: "src/features/llm/utils/textNormalize.ts"
    assert:
      - "normalizeText(text): \\r\\n -> \\n, \\r -> \\n, trim, 去零宽空格 (U+200B, U+FEFF)"
      - "去除首尾空白, 保留内部空白"
      - "移除独立的 markdown 字符行 (只含 ** 或 # 或 -)"
    source: "code:new file"
    confidence: 0.80

  - symbol: "passageGenerator 调用 normalizeText"
    file: "src/features/llm/services/llmAdapter.ts"
    assert:
      - "收到 LLM response 后, 对 passage.text 调用 normalizeText"
      - "normalized text 长度变化时, 自动重算 tokens/grammarPoints 的 offsets"
    source: "code:modified file"
    confidence: 0.75
```

### Stage 2: Alignment Validator (核心层)

```yaml
expect:
  - symbol: "alignmentValidator.ts (新建)"
    file: "src/features/llm/utils/alignmentValidator.ts"
    assert:
      - "validateToken(token, text): AlignmentResult = { start, end, status, originalOffset }"
      - "validation: text.slice(start, end) === surfaceForm (case-sensitive)"
      - "case-insensitive 验证通过但 case-sensitive 失败 -> 校正为 original, status: corrected"
      - "fuzzy match: Levenshtein 距离 <= 2, 找 text 中 first index"
      - "找不到 -> status: dropped, token 不进入渲染"
    source: "code:new file"
    confidence: 0.85

  - symbol: "levenshtein.ts (新建, 轻量实现)"
    file: "src/features/llm/utils/levenshtein.ts"
    assert:
      - "levenshtein(a, b): number 距离"
      - "O(m*n) DP, 无外部依赖"
      - "< 100 LOC"
    source: "code:new file"
    confidence: 0.90

  - symbol: "passageGenerator 集成 alignmentValidator"
    file: "src/features/llm/services/llmAdapter.ts"
    assert:
      - "对每个 token 调 validateToken"
      - "对每个 grammarPoint 调 validateToken (用其 text 字段)"
      - "filtered tokens = 只保留 status != dropped"
      - "alignmentStats 返回 { perfect: N, corrected: M, dropped: K, total: T }"
    source: "code:modified file"
    confidence: 0.85

  - symbol: "alignmentValidator 单元测试"
    file: "src/features/llm/utils/alignmentValidator.test.ts"
    assert:
      - "T01: 完全对齐 (slice == surfaceForm) -> perfect"
      - "T02: 大小写差异 -> corrected"
      - "T03: 偏移 1-2 字符 -> corrected (fuzzy)"
      - "T04: 完全不在 text 中 -> dropped"
      - "T05: 中文 Unicode 边界正确处理"
      - "T06: Levenshtein 距离算法单测"
    source: "code:new test file"
    confidence: 0.90
```

### Stage 3: Retry + Repair + Fallback 增强

```yaml
expect:
  - symbol: "json-repair 库依赖"
    file: "package.json"
    assert:
      - "deps: jsonrepair (^0.6.0)"
      - "bundle size < 10KB"
    source: "code:package.json"
    confidence: 0.90

  - symbol: "jsonParser.ts 改造"
    file: "src/features/llm/services/jsonParser.ts"
    assert:
      - "parseLLMResponse(raw): 先尝试 JSON.parse, 失败调 jsonrepair, 再失败抛错"
      - "Zod schema 验证 (text / tokens / grammarPoints 字段类型)"
      - "失败重试: 第 1 次 parse 失败 -> repair -> 再 parse, 仍失败抛错"
    source: "code:modified file"
    confidence: 0.85

  - symbol: "router.ts generateWithFallback 改造"
    file: "src/features/llm/services/router.ts"
    assert:
      - "parse 失败 -> 重试 1 次 (附上错误信息到 prompt 末尾)"
      - "重试仍失败 -> 走 mock fallback"
      - "保留现有 timeout / abort / backoff 逻辑"
    source: "code:modified file"
    confidence: 0.85

  - symbol: "retry+repair 单元测试"
    file: "src/features/llm/services/router.test.ts (新建)"
    assert:
      - "T01: LLM 返回无效 JSON -> repair 后成功"
      - "T02: repair 仍失败 -> mock fallback 触发"
      - "T03: LLM 返回合法 JSON -> 不走 repair"
      - "T04: retry 1 次后仍失败 -> mock"
    source: "code:new test file"
    confidence: 0.85
```

### Stage 4: Paragraph 重构 + E2E 验证

```yaml
expect:
  - symbol: "InteractivePassage.tsx 段落渲染重构"
    file: "src/features/reading/components/InteractivePassage.tsx"
    assert:
      - "useMemo(text => text.split(/\\n\\n+/).filter(p => p.trim())) 替换双层 split"
      - "保留 usePageEntranceAnimation 段落 staggered 动画"
      - "paragraph 内部 segments useMemo 不变 (token 排序逻辑保留)"
    source: "code:modified file"
    confidence: 0.80

  - symbol: "InteractivePassage 段落测试"
    file: "src/features/reading/components/InteractivePassage.test.tsx (新建)"
    assert:
      - "T01: passage 含 \\n\\n -> 渲染多段"
      - "T02: passage 不含 \\n\\n -> 单段"
      - "T03: passage 含 \\r\\n\\r\\n -> 正确切分 (被 normalizeText 清洗后)"
    source: "code:new test file"
    confidence: 0.85

  - symbol: "Playwright E2E 验证"
    file: "debug_verify_v110.py (新建)"
    assert:
      - "生成 5+ 真实 LLM passage (DeepSeek 真实 API)"
      - "每个 passage 检查: (a) 段落数 >= 2, (b) 划线精准度 100% (offset 与 surfaceForm 完全对齐), (c) 无 markdown 字符泄漏"
      - "三视口截图 (1440/1024/390) 各 2+ 张"
      - "0 pageerror / 0 console.error"
    source: "code:new debug script"
    confidence: 0.85
```

## 验收合约 (Contract)

```yaml
contract:
  - "5+ 真实 LLM passage 中, 段落数 >= 2 的占比 >= 100%"
  - "5+ 真实 LLM passage 中, 划线精准度 (offset slice == surfaceForm) >= 90%"
  - "5+ 真实 LLM passage 中, 含 markdown 字符泄漏的占比 0%"
  - "无效 JSON 触发 json-repair 成功率 >= 80%"
  - "repair+retry 全部失败时, mock fallback 100% 兜底"
  - "alignmentStats 在 console.log 输出, 用于监控"
  - "prefers-reduced-motion 仍被遵守"
  - "prefers-reduced-motion 仍被遵守, 段落动画降级为无延迟"
```

## 风险矩阵

| 风险 | 等级 | 缓解 |
|------|------|------|
| json-repair 引入新依赖 | low | 仅 5KB, 0 依赖, 可选 |
| fuzzy match 误校正 | medium | 限制 Levenshtein <= 2, 输出 alignment status 让 UI 提示 |
| prompt 强化触发 LLM 算错更多 | low | 强化同时 + few-shot + alignment validator 兜底 |
| 段落 split 改动破坏现有动画 | low | 保留 usePageEntranceAnimation, 段落切换仍然 staggered |
| E2E 测试 5+ 段生成消耗 token | medium | 用 DeepSeek 真实 API, 控制生成次数 <= 10 |
| normalizeText 后 token offsets 重算有错 | medium | 写 vitest 覆盖所有边界 case (空字符串 / 中文 / 表情) |
| response_format 强制后某些 provider 不支持 | low | DeepSeek / Kimi / Qwen 都支持; Mock 走自定义 |

## 实施路径 (4 stages)

### Stage 1: Prompt 优化 + text 清洗 (源头预防)
- 改 prompts.ts: passageGenerator + grammarDetector 加 V2 提示词
- 加 few-shot 对齐示例
- 加 response_format: json_object 强制
- 新建 textNormalize.ts: trim / 换行 / 零宽 / markdown 字符
- llmAdapter 集成 normalizeText

### Stage 2: Alignment Validator (核心)
- 新建 alignmentValidator.ts + levenshtein.ts
- 对每个 token / grammarPoint 验证 + 校正
- 输出 alignmentStats
- 6 个 vitest case

### Stage 3: Retry + Repair + Fallback
- 加 jsonrepair 依赖
- jsonParser 集成 repair 逻辑
- router 改造: 失败重试 + 错误上下文 prompt
- 4 个 vitest case

### Stage 4: Paragraph 重构 + E2E 验证
- InteractivePassage 段落渲染简化 (单层 split)
- 3 个 vitest case
- Playwright E2E: 5+ 真实 LLM passage 验证

## 与 v1.0.0 连续性

- v1.0.0 9 store 持久化 -> v1.1.0 不变
- v1.0.0 useHomeAnalytics -> v1.1.0 不变
- v1.0.0 移动端 CSS -> v1.1.0 不变
- v1.0.0 mock passages.ts -> v1.1.0 保留, 作为 fallback
- v1.0.0 LLM provider 集成 -> v1.1.0 在 router 层叠加 alignment validation + retry/repair
- v1.0.0 InteractivePassage -> v1.1.0 段落渲染简化 (重写 useMemo 第一层 split)
- v1.0.0 prompts.ts -> v1.1.0 改写 (V2)

## 改进建议 (来自 v1.0.0 history)

采纳:
- v1.0.0 history 改进建议 #5: "v1.1.0 引入真实 LLM 时, 优先在 LLMProvider 接口层加 mock 覆盖率断言" -> Stage 3 强化
- v1.0.0 history 改进建议 #1: "为 useHomeAnalytics 添加 storybook stories" -> defer 到 v1.2.0

新增 (来自 v1.1.0 调研):
- alignmentStatus 让 UI 提示用户 "这个词位置已校正" (透明性)
- alignmentStats 上报, 用于监控 LLM 质量
- prefers-reduced-motion 用户段落动画降级

## 下一步

进入 Bayesian Planner 阶段: 基于本 SPEC 生成 `bayesian/v1.1.0/plan.md` (5 stages JSON), 用户确认后调度 subagent 执行。
