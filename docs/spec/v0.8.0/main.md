---
title: "SPEC — Wordaydream v0.8.0"
date: "2026-07-09"
version: "0.8.0"
project: "Wordaydream"
tags:
  - artifact/spec
  - version/0.8.0
  - project/Wordaydream
  - confidence/medium
confidence: 0.82
upstream:
  - "[[preview]]"
  - "[[CONTEXT]]"
  - "[[bayesian/v0.7.0/status]]"
  - "[[cache/v0.8.0/research/direction-insights]]"
downstream:
  - "[[bayesian/v0.8.0/plan]]"
---

# SPEC — Wordaydream v0.8.0

## 迭代主题：阅读主舞台的视觉连续性

v0.8.0 是一次**视觉精修迭代**，不是新功能迭代。目标是把当前影响"阅读不断流"主体验的若干布局问题一次性清理干净,让用户从打开应用的第一秒起,主舞台、侧栏、弹出面板都各司其职、不互相侵占。

## 迭代方向(来自实际浏览器观察 + 代码审计)

> 以下每条问题都通过 Playwright 在 1440x900 / 1366x768 / 1024x768 / 390x844 多个视口下截图确认,证据存放在 `wordaydream/debug_shots/`。

### P1 — 侧栏"伪品牌区"裁切(严重)

**现象**:
- 桌面 1440 / 1366 / 1024 三种宽度下,侧栏顶部 "Wordaydream" 标题文字均被一个圆角矩形 + 箭头按钮**部分遮挡**。
- 1024 宽度下标题几乎只显示 "ordaydream"。

**根因**:
- `ReadingSessionPage.tsx` 中 `aside` 包含两个 `margin-top: auto` 的子元素:`.progressSection`(学习进度条) 和 `.sidebarFooter`(历史 + 分析 + 设置)。
- 两个 `margin-top: auto` 在 flex 容器中**互推**——Flex 规范里,多个 auto margin 会平分剩余空间,导致 progress 块和 footer 块都被推到侧栏中间,互相挤压。
- `.progressSection` 自身有 `border-top: 1px solid` + `padding-top: 1rem`,这条 border 线被推到中段后,在视觉上像"切过品牌区"。
- 同时,ReadingHistoryPanel 收起态(圆角矩形 + 数字 + chevron 箭头)出现在 y≈78 位置,与 brand 区(y≈49)重叠。

**修复方向**:
1. 删掉 `progressSection` 的 `margin-top: auto`,让 progress 自然跟在生成按钮下方。
2. 删掉 `sidebarFooter` 的 `margin-top: auto`,改为只让 `aside` 整体 `justify-content: space-between` 或用单一 `margin-top: auto` 推 footer。
3. 取消 `progressSection` 的 `border-top`(视觉上没意义,且被推到错误位置时反而成为视觉杂讯)。
4. 调整 `ReadingHistoryPanel` 收起态的尺寸:从 64px 高(icon+大数字+label)压缩为 36-40px 的紧凑 chip 形态,避免遮挡品牌区。

### P2 — InlineAnswerPanel / GrammarPanel 遮挡正文

**现象**:
- 23 / 24 截图:激活第一个 token 时,弹出面板左缘 x=852,右缘 1204,但**正文中段"the mo[hub, pro]ving"被面板完全覆盖**。
- 24 截图:激活最后一个 token 时,面板下沿 y=900.5,几乎贴到视口底部。
- 这两个 panel 都使用 `position: absolute; top: 100%; left: 50%; transform: translateX(-50%)` 的居中弹出逻辑,固定宽度 352px / 22-28rem。

**根因**:
- Panel 使用居中弹出策略,对页面中段激活的 token 没问题,但对**靠左**或**靠右**的 token 来说,Panel 会越过阅读区中线,**侵入**旁边 token 的文字。
- 没有"靠近视口边缘时翻转方向"的智能定位。

**修复方向**:
- 引入一个 `usePanelPosition` hook:监听 panel 元素的 bounding rect 与视口边界的关系,自动判断应该居中/靠左/靠右展开。
- 优先级:靠近左边界 → 左对齐;靠近右边界 → 右对齐;中间 → 居中。
- Panel 仍保持 inline 模式(不脱层),但加上"接近底部时上翻到 token 上方"的 flip 逻辑,避免贴底。

### P3 — "暂无可复现词汇" banner 始终占据阅读区上方

**现象**:
- 即使没有复现词、用户刚开始阅读时,banner 仍然占据阅读区顶部 80px 左右的高度。
- banner 上写"继续阅读积累词汇,它们会在适当的时候回来找你。" — 对首次用户是友好提示,但对 5+ 次复现词已经在库的用户是噪音。

**根因**:
- `ReviewPromptBanner` 无条件渲染,只在视觉上"克制"。

**修复方向**:
- 改为只在 `memoryStore.getDueCount() > 0` 时显示完整 banner。
- 在 `dueCount === 0` 时改为一个 1px 高的进度提示线("下次复现约 3 天后"),不占垂直空间。

### P4 — 侧栏底部布局松散

**现象**:
- 1024 宽屏下:进度条在 y=540,"3 阅读历史"折叠面板在 y=715-850,"设置"按钮在 y=900+。
- 三个块之间出现 60-80px 的空白带。

**根因**:
- 多个 `margin-top: auto` + `padding-top: var(--space-4)` 叠加。

**修复方向**:
- 把 progress + footer 合并为单一 `margin-top: auto` 推到底部,删除中间的多余 padding-top 与 border-top。
- 设置按钮作为 footer 内的"末项",与 reading history 折叠面板视觉上保持紧凑。

### P5 — 单词 token 解析对长复合词边界错误

**现象**:
- 截图 "ng a quiet revo" 标签出现在文本外、孤立显示。
- 这其实是 highlight 标签因为 inline 化后被切断显示,但实际是因为 token.startIndex 偏移,导致 highlight 容器内包含的不是单个词。

**根因**:
- `passageGenerator.ts` 的 token 切分在德语长复合词、英语词形变化时偶尔会产生跨 token 的 startIndex。
- 或者 `InteractivePassage.tsx` 切片逻辑中 `text.slice(currentIndex, nextSegment.token.startIndex)` 对 boundary 处理粗糙。

**修复方向**:
- 增加 `TokenOccurrence` 边界检查:startIndex 必须在 [0, text.length) 且 endIndex > startIndex。
- 在 `useMemo` segments 计算时,遇到 startIndex < currentIndex 的 token 跳过并 warning。

## 实现要点 (供 Bayesian Plan 消费)

```yaml
expect:
  - symbol: ReadingSessionPage.module.css .progressSection
    file: src/features/reading/ReadingSessionPage.module.css
    assert:
      - "不再有 margin-top: auto"
      - "不再有 border-top"
    source: "code:src/features/reading/ReadingSessionPage.module.css:164"
    confidence: 0.85

  - symbol: ReadingSessionPage.module.css .sidebarFooter
    file: src/features/reading/ReadingSessionPage.module.css
    assert:
      - "不再有 margin-top: auto(与 progressSection 互推)"
    source: "code:src/features/reading/ReadingSessionPage.module.css:206"
    confidence: 0.85

  - symbol: ReadingSessionPage.module.css .sidebar
    file: src/features/reading/ReadingSessionPage.module.css
    assert:
      - "单一 margin-top: auto 推 footer 至底部"
    source: "code:src/features/reading/ReadingSessionPage.module.css:11"
    confidence: 0.80

  - symbol: ReadingHistoryPanel.module.css .panelHeader
    file: src/features/reading/components/ReadingHistoryPanel.module.css
    assert:
      - "padding 从 var(--space-4) 减为 var(--space-3)"
      - "min-height 限制在 44px"
    source: "code:src/features/reading/components/ReadingHistoryPanel.module.css:11"
    confidence: 0.75

  - symbol: usePanelPosition
    file: src/hooks/usePanelPosition.ts (new)
    assert:
      - "监听元素 bounding rect 与视口关系"
      - "返回 placement: 'top' | 'bottom' | 'left' | 'right' | 'center'"
      - "支持边缘 flip"
    source: "model: standard pattern for popover positioning"
    confidence: 0.70

  - symbol: InlineAnswerPanel.module.css .panel
    file: src/features/reading/components/InlineAnswerPanel.module.css
    assert:
      - "left 改为由 inline style 传入(动态定位)"
      - "保留 max-height 过渡"
    source: "code:src/features/reading/components/InlineAnswerPanel.module.css:1"
    confidence: 0.80

  - symbol: GrammarPanel.module.css .panel
    file: src/features/grammar/components/GrammarPanel.module.css
    assert:
      - "left 改为由 inline style 传入(动态定位)"
    source: "code:src/features/grammar/components/GrammarPanel.module.css:1"
    confidence: 0.80

  - symbol: ReviewPromptBanner
    file: src/features/review/components/ReviewPromptBanner.tsx
    assert:
      - "只在 dueCount > 0 时显示 banner"
      - "dueCount === 0 时显示 1px 提示线"
    source: "code:src/features/review/components/ReviewPromptBanner.tsx"
    confidence: 0.80

  - symbol: useReadingSessionStore
    file: src/features/reading/store/useReadingSessionStore.ts
    assert:
      - "addTokenBoundaryGuard 在 segments useMemo 中跳过非法 token"
    source: "code:src/features/reading/store/useReadingSessionStore.ts"
    confidence: 0.65

contract:
  - "ReadingSessionPage 加载后,侧栏品牌区不被任何元素遮挡"
  - "InlineAnswerPanel 在靠近视口左右边缘时自动翻转方向"
  - "ReviewPromptBanner 在 dueCount === 0 时不占据垂直空间"
  - "侧栏在 1024/1366/1440 三个宽度下均无空白带"
```

## 风险矩阵

| 风险 | 等级 | 缓解 |
|------|------|------|
| usePanelPosition 引入布局抖动 | low | 用 transform 而非 left/top 切换 |
| progressSection 取消 border-top 后视觉权重过轻 | low | 在 active session 时 progress 自动浮现 |
| token 边界检查触发过多 warning | medium | 仅 console.warn 一次,UI 不弹 |
| ReadingHistoryPanel 收起态压缩影响可点击区域 | low | 保留完整 44px 触控高度,仅压缩内边距 |

## 验收标准

1. **桌面 1440/1366/1024 三种宽度**:侧栏顶部 "Wordaydream" 标题完整可见,无任何遮挡。
2. **任意 token 激活**:弹出 panel 在靠近视口边缘时自动翻转方向,不遮挡周围 token。
3. **首次访问(无复现词)**:阅读区上方不显示完整 banner,只显示 1px 提示线。
4. **有复现词**:banner 正常显示。
5. **构建通过**:`tsc -b && vite build` 无 TypeScript 错误。
6. **侧栏底部布局**:无 60px+ 空白带。
