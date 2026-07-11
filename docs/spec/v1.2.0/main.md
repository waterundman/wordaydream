---
title: "SPEC — Wordaydream v1.2.0"
date: "2026-07-09"
version: "1.2.0"
project: "Wordaydream"
tags:
  - artifact/spec
  - version/1.2.0
  - project/Wordaydream
  - confidence/medium
confidence: 0.82
upstream:
  - "[[cache/v1.2.0/research/direction-insights]]"
  - "[[cache/v1.2.0/research/comparison-matrix]]"
  - "[[cache/v1.2.0/research/stack-decision]]"
  - "[[cache/v1.1.0/NEXT-VERSION-DIRECTION]]"
  - "[[bayesian/v1.1.0/history]]"
downstream:
  - "[[bayesian/v1.2.0/plan]]"
---

# SPEC — Wordaydream v1.2.0

## 迭代方向 (1 句话)

> 解决 v1.1.0 三大遗留问题: 跨 stage 集成 gap (P0) / alignment status UI 不透明 (P1) / 真实 LLM 输出残缺 (P1)。

## 核心问题诊断 (来自 v1.1.0 history R6-R7)

| 问题 | 优先级 | 根因 | 涉及代码 |
|------|--------|------|---------|
| **集成 gap** | P0 | Stage 1-3 subagent 各自验证单 stage, 漏测跨 stage 集成 (passageGenerator 漏调 alignmentValidator) | `passageGenerator.ts` L235-244 (v1.1.0 hotfix 前) |
| **alignment status 不透明** | P1 | Stage 2 输出 5 字段 stats, 但 token.alignmentStatus 字段未传到 InteractivePassage 渲染层, 用户看不到"这个词位置已校正" | `InteractivePassage.tsx` token span 渲染 + useAnalyticsStore |
| **LLM 输出残缺** | P1 | 5 次跑 1 次 Run 5 DeepSeek 返回无 text/tokens 字段, maxAttempts=2 不足, mock fallback 无 UI 提示 | `router.ts` L175 (maxAttempts) + `mockProvider.ts` (无 banner 提示) |

## 实现要点 (供 Bayesian Plan 消费)

### Stage 1: 跨 stage 集成验证基础设施 (P0, 方向 A)

```yaml
expect:
  - symbol: "MockLLMProvider fixture 增强"
    file: "src/features/llm/services/mockProvider.ts"
    assert:
      - "新增 MockFixture 类型: success / broken-json / missing-fields / fuzzy-offsets / throw-network"
      - "setFixture() 切换场景"
      - "保留现有 echo fallback (向后兼容)"
    source: "code:modified file"
    confidence: 0.88

  - symbol: "passage-full-pipeline 集成测试"
    file: "src/__integration__/passage-full-pipeline.test.tsx"
    assert:
      - "5 fixture 场景各 1 case, 覆盖完整链路 passageGenerator → llmAdapter → textNormalize → alignmentValidator → InteractivePassage"
      - "T01 success: 段落达标 + token 划线精准 + alignment status=perfect"
      - "T02 broken-json: jsonrepair 修复后成功"
      - "T03 missing-fields: mock fallback 触发 + alignment 0 触发"
      - "T04 fuzzy-offsets: alignmentValidator 校正 (status=corrected) + 段落渲染"
      - "T05 throw-network: mock fallback 触发 + retry 2 次后 mock"
    source: "code:new test file"
    confidence: 0.88

  - symbol: "vitest include glob 扩展"
    file: "vitest.config.ts (或 vite.config.ts)"
    assert:
      - "确认 include 覆盖 src/__integration__/**/*.test.{ts,tsx}"
    source: "code:config"
    confidence: 0.85
```

### Stage 2: alignment status UI 提示 (P1, 方向 B)

```yaml
expect:
  - symbol: "@radix-ui/react-tooltip 集成"
    file: "package.json"
    assert:
      - "deps: @radix-ui/react-tooltip ^1.1.4"
      - "bundle size +5KB gzipped"
    source: "code:package.json"
    confidence: 0.80

  - symbol: "TooltipProvider 全局包裹"
    file: "src/main.tsx 或 src/App.tsx"
    assert:
      - "TooltipProvider 包裹根组件"
      - "delayDuration=300 (避免误触)"
      - "skipDelayDuration=100 (连击友好)"
    source: "code:modified file"
    confidence: 0.78

  - symbol: "TokenSpan 集成 Tooltip"
    file: "src/features/reading/components/InteractivePassage.tsx"
    assert:
      - "TokenSpan 包裹 Tooltip.Root/Trigger/Portal/Content"
      - "tooltip 内容: status (perfect/corrected/fallback/dropped) + originalOffset + surfaceForm"
      - "支持 hover + focus 触发, Esc 关闭"
      - "prefers-reduced-motion 兼容"
    source: "code:modified file"
    confidence: 0.78

  - symbol: "TokenSpan 单元测试"
    file: "src/features/reading/components/InteractivePassage.test.tsx (扩展)"
    assert:
      - "T06: TokenSpan 含 alignment status 字段 -> 渲染 tooltip"
      - "T07: TokenSpan 不含 alignment status (mock 数据) -> 不渲染 tooltip"
      - "T08: hover trigger 触发 aria-describedby"
    source: "code:modified test file"
    confidence: 0.75
```

### Stage 3: LLM 稳定性强化 (P1, 方向 C)

```yaml
expect:
  - symbol: "router maxAttempts 2 -> 3"
    file: "src/features/llm/services/router.ts"
    assert:
      - "jsonMaxAttempts 默认值 2 -> 3 (从 useSettingsStore 读取, 可配置)"
      - "useSettingsStore 加 llm.jsonMaxAttempts 字段 (默认 3)"
    source: "code:modified file"
    confidence: 0.80

  - symbol: "jsonrepair 埋点"
    file: "src/features/llm/services/jsonParser.ts"
    assert:
      - "parseLLMResponse 检测到 repaired=true 时, console.info 计数 + 写入 useAnalyticsStore"
      - "useAnalyticsStore 加 'llm.repair.count' 字段"
    source: "code:modified file"
    confidence: 0.80

  - symbol: "NotificationBanner 组件"
    file: "src/components/NotificationBanner.tsx (新建)"
    assert:
      - "全局 banner, 顶部 sticky 位置"
      - "显示 '已切换到预存文本 (LLM 服务暂不可用)'"
      - "可关闭 (X 按钮)"
      - "useToastStore 派发, 复用现有 toast 模式"
    source: "code:new component"
    confidence: 0.75

  - symbol: "router mock fallback UX"
    file: "src/features/llm/services/router.ts"
    assert:
      - "fallbackToMock=true 时, 调用 useToastStore.showNotification('llm-fallback', ...)"
      - "console.warn 保留, 但 UI 提示新增"
    source: "code:modified file"
    confidence: 0.75

  - symbol: "LLM 稳定性单元测试"
    file: "src/features/llm/services/router.test.ts (扩展)"
    assert:
      - "T06: maxAttempts=3 时, 第 3 次成功 -> 返回数据 (不 fallback)"
      - "T07: maxAttempts=3 + 3 次都失败 -> mock fallback + 派发 toast"
      - "T08: missing-fields fixture 触发后, useAnalyticsStore 记录 1 次 repair"
    source: "code:modified test file"
    confidence: 0.80
```

### Stage 4: 跨方向 E2E 回归 + 视口截图 (验证层)

```yaml
expect:
  - symbol: "Playwright E2E 验证 v1.2.0 整体"
    file: "debug_verify_v120.py (新建)"
    assert:
      - "5+ 真实 LLM (DeepSeek) passage 生成 + 验证"
      - "v1.1.0 7 合同: 段落 >= 2 / 划线精准度 >= 90% / markdown 0% / 视口截图 6+ / 0 pageerror / 0 console.error / [Alignment] 3+"
      - "v1.2.0 新增 4 合同: tooltip 元素存在 / tooltip 4 status 可见 / repair count > 0 / fallback banner 触发"
      - "三视口截图 1440/1024/390 各 2+ 张"
      - "alignment tooltip 截图 2+ 张 (hover 状态)"
    source: "code:new debug script"
    confidence: 0.85

  - symbol: "E2E_REPORT_v120.md"
    file: "E2E_REPORT_v120.md (新建)"
    assert:
      - "11 合同验收 (7 v1.1.0 + 4 v1.2.0)"
      - "tooltip 视觉确认截图清单"
      - "alignment status 4 状态各 1+ 截图"
    source: "code:new report"
    confidence: 0.85
```

## 验收合约 (Contract)

```yaml
contract:
  # v1.1.0 7 合同 (保持)
  - "5+ 真实 LLM passage 中, 段落数 >= 2 占比 >= 100%"
  - "5+ 真实 LLM passage 中, 划线精准度 (offset slice == surfaceForm) >= 90%"
  - "5+ 真实 LLM passage 中, 含 markdown 字符泄漏的占比 0%"
  - "无效 JSON 触发 json-repair 成功率 >= 80%"
  - "repair+retry 全部失败时, mock fallback 100% 兜底"
  - "alignmentStats 在 console.log 输出, 用于监控"
  - "prefers-reduced-motion 仍被遵守"

  # v1.2.0 新增 4 合同
  - "集成测试 5 fixture 场景全部 PASS (Stage 1)"
  - "TokenSpan hover/focus tooltip 可见 4 status (perfect/corrected/fallback/dropped)"
  - "maxAttempts=3 时, 3 次内成功率 >= 90% (对比 v1.1.0 maxAttempts=2)"
  - "mock fallback 触发时, UI NotificationBanner 显示 + useToastStore 派发 1 次"
```

## 风险矩阵

| 风险 | 等级 | 缓解 |
|------|------|------|
| MockLLMProvider 行为与真实 LLM 偏差 | HIGH | 月度回灌: 真实 LLM 输出收集, 转化为新 fixture; 监控 fixture vs 真实 fail rate 差异 |
| 集成测试维护跨 feature, 文件分散 | MEDIUM | 集中 `src/__integration__/`, vitest include glob 自动覆盖 |
| Radix Tooltip bundle +5KB | LOW | 1 个新依赖, 5KB gzipped 可接受; modular import 按需加载 |
| retry 3 vs token 成本 | MEDIUM | 暴露给用户配置 (useSettingsStore.llm.jsonMaxAttempts, 默认 3) |
| 集成 test 5 fixture 维护负担 | MEDIUM | 复用现有 mockProvider class, fixture 切换 setFixture() |
| NotificationBanner 触发后被用户忽略 | LOW | 顶部 sticky + 暖色 + 简短文案, 配合 console.warn 双提示 |
| E2E 测试 5+ 段生成消耗 token | MEDIUM | 用 DeepSeek 真实 API, 控制生成次数 <= 10 (v1.1.0 已验证) |

## 实施路径 (4 stages)

### Stage 1: 跨 stage 集成验证 (P0, 方向 A)
- 增强 MockLLMProvider (5 fixture 场景)
- 新建 `src/__integration__/passage-full-pipeline.test.tsx` (5 cases)
- vitest include glob 扩展

### Stage 2: alignment status UI (P1, 方向 B)
- 加 @radix-ui/react-tooltip 依赖
- TooltipProvider 包裹根组件
- TokenSpan 集成 Tooltip (4 status 文案)
- InteractivePassage.test.tsx 扩展 T06-T08

### Stage 3: LLM 稳定性 (P1, 方向 C)
- router maxAttempts 2 → 3 (useSettingsStore.llm.jsonMaxAttempts)
- jsonrepair 埋点 useAnalyticsStore
- NotificationBanner 组件 + useToastStore 派发
- router.test.ts 扩展 T06-T08

### Stage 4: 跨方向 E2E 回归
- debug_verify_v120.py 真实 LLM 验证
- 11 合同验收 (7 v1.1.0 + 4 v1.2.0)
- 三视口截图 + alignment tooltip 截图
- E2E_REPORT_v120.md

## 与 v1.1.0 连续性

- v1.1.0 MockLLMProvider 简单 echo → v1.2.0 增强为 fixture-based (向后兼容, 默认 success)
- v1.1.0 console.info('[Alignment]', stats) → v1.2.0 保留 + UI tooltip 展示给用户
- v1.1.0 response_format + jsonrepair → v1.2.0 retry 2→3 + jsonrepair 埋点 + mock fallback UX
- v1.1.0 51 vitest tests (单 stage) → v1.2.0 + 5 integration tests (跨 stage)
- v1.1.0 E2E 7 合同 → v1.2.0 11 合同 (新增 4)

## 改进建议 (来自 v1.1.0 history R6-R7)

采纳:
- v1.1.0 R7 "Stage 1-3 subagent 未主动验证集成链路" → Stage 1 跨 stage 集成测试
- v1.1.0 R7 "5/1 概率 LLM 返回无 text/tokens 字段" → Stage 3 retry 3 + UX
- v1.1.0 R7 "alignmentStatus 字段未传到 UI" → Stage 2 tooltip 展示

新增 (来自 v1.2.0 调研):
- MockLLMProvider fixture 模式: 复用项目已有 class, 不引入 MSW
- Radix Tooltip vs 自实现: 选 Radix (工业 a11y, 5KB)
- maxAttempts 用户可配置: 暴露 useSettingsStore.llm.jsonMaxAttempts

## 下一步

进入 Bayesian Planner 阶段: 基于本 SPEC 生成 `bayesian/v1.2.0/plan.md` (4 stages JSON with Mermaid 依赖图), 用户确认后调度 subagent 执行。
