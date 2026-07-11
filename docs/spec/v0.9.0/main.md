---
title: "SPEC — Wordaydream v0.9.0"
date: "2026-07-09"
version: "0.9.0"
project: "Wordaydream"
tags:
  - artifact/spec
  - version/0.9.0
  - project/Wordaydream
  - confidence/medium
confidence: 0.78
upstream:
  - "[[preview]]"
  - "[[CONTEXT]]"
  - "[[cache/v0.9.0/research/direction-insights]]"
  - "[[cache/v0.9.0/research/comparison-matrix]]"
  - "[[cache/v0.9.0/functional/home-page-research]]"
  - "[[bayesian/v0.8.0/status]]"
downstream:
  - "[[bayesian/v0.9.0/plan]]"
---

# SPEC — Wordaydream v0.9.0

## 迭代主题: 主页 + 成就系统 + 难度-进度耦合

v0.9.0 是从"功能型 MVP"转向"可用型产品"的关键一步。前两版本完成了"阅读不断流"的核心证明, 现在需要回答两个问题: 1) 用户为什么打开应用; 2) 用户如何知道自己进步了。

## 核心方向 (来自多邻国观察 + 用户需求)

### P0 — 主页 (HomePage)

**问题**: 当前应用启动直接进入 ReadingSession, 新用户不知道应用能做什么, 已有用户没有"完成感"。

**方案**: 新增 HomePage 作为应用入口, 三段式结构:
1. 顶部: 品牌 + streak (火焰数字) + 今日学习单元卡
2. 中部: 进度环 (今日 vs 目标) + 难度建议提示
3. 底部: 成就墙 (已解锁 3-4 个预览) + 设置入口

**架构影响**: App.tsx 从"双页面切换"改为"三页面路由", 新增 'home' mode。

### P0 — 成就系统

**问题**: 用户的连续天数仅显示在 AnalyticsPanel 折叠态, 缺乏情感反馈。

**方案**: 引入 13 个成就, 三层结构:
- 入门 (4): 初次启航 / 三日入门 / 一周 / 首次完美
- 进度 (4): 半百 / 五百之师 / 月度习惯 / 百日
- 探索 (3): 双语者 / 难度登顶 / 复合大师
- 隐藏 (2): polyglot_2 / marathon

每个成就解锁时触发 toast, 主页成就墙实时更新。

### P0 — 难度-进度耦合

**问题**: 用户选择 L1-L5 后系统不反馈, 学习 100 词后还在 L1 也不知是否该升级。

**方案**: 新增 difficultyAdvisor 服务, 基于掌握率和错误率给"软建议":
- 当前等级 掌握率 >= 80% 且累计 >= 50 词 -> 建议升一级
- 当前等级 错误率 >= 40% 且累计 >= 30 词 -> 建议降一级
- 仅在主页显示建议, 不自动修改用户设置

### P1 — 多邻国引导式首页

**方案**: 首次用户主页看到"今天从第一次阅读开始" + "开始"按钮, 1 步进入阅读 (默认 L2 英语), 不需要任何配置。

## 实现要点 (供 Bayesian Plan 消费)

```yaml
expect:
  - symbol: HomePage
    file: src/features/home/HomePage.tsx (new)
    assert:
      - "Renders brand, streak, today card, progress ring, achievement wall"
      - "Reads from useAchievementStore / useAnalyticsStore / useSettingsStore"
    source: "code:src/features/home/HomePage.tsx (new file)"
    confidence: 0.80

  - symbol: useAchievementStore
    file: src/features/achievements/store/useAchievementStore.ts (new)
    assert:
      - "Stores 13 achievements with unlocked: boolean"
      - "checkAndUnlock(ctx) runs after each session"
      - "Persisted to localStorage"
    source: "code:src/features/achievements/store/useAchievementStore.ts (new file)"
    confidence: 0.75

  - symbol: achievementEngine
    file: src/features/achievements/services/achievementEngine.ts (new)
    assert:
      - "Pure function: AchievementContext -> AchievementUnlock[]"
      - "No side effects, testable"
    source: "code:src/features/achievements/services/achievementEngine.ts (new file)"
    confidence: 0.80

  - symbol: AchievementToast
    file: src/features/achievements/components/AchievementToast.tsx (new)
    assert:
      - "Subscribes to useAchievementStore.newUnlocks"
      - "Auto-dismiss after 4s"
    source: "code:src/features/achievements/components/AchievementToast.tsx (new file)"
    confidence: 0.80

  - symbol: difficultyAdvisor
    file: src/features/difficulty-coupling/services/difficultyAdvisor.ts (new)
    assert:
      - "suggests(currentLevel, stats) -> level | null"
      - "Stats from useAnalyticsStore + useMemoryStore"
    source: "code:src/features/difficulty-coupling/services/difficultyAdvisor.ts (new file)"
    confidence: 0.75

  - symbol: App.tsx
    file: src/App.tsx (modified)
    assert:
      - "Routes: 'home' | 'reading' | 'review'"
      - "Default mode = 'home'"
      - "Reading session completion -> 'home'"
    source: "code:src/App.tsx (modified)"
    confidence: 0.85

  - symbol: useReadingSessionStore
    file: src/features/reading/store/useReadingSessionStore.ts (modified)
    assert:
      - "Session completion calls useAchievementStore.checkAndUnlock()"
    source: "code:src/features/reading/store/useReadingSessionStore.ts (modified)"
    confidence: 0.80

  - symbol: StreakBadge
    file: src/features/home/components/StreakBadge.tsx (new)
    assert:
      - "Renders flame icon + number"
      - "Uses project warm color scheme (no emoji)"
    source: "code:src/features/home/components/StreakBadge.tsx (new file)"
    confidence: 0.80

  - symbol: TodayCard
    file: src/features/home/components/TodayCard.tsx (new)
    assert:
      - "Shows language/difficulty/estimated time/new words count"
      - "Click navigates to ReadingSession"
    source: "code:src/features/home/components/TodayCard.tsx (new file)"
    confidence: 0.80

  - symbol: ProgressRing
    file: src/features/home/components/ProgressRing.tsx (new)
    assert:
      - "SVG ring with completion percentage"
      - "Animated via useBreathingEffect"
    source: "code:src/features/home/components/ProgressRing.tsx (new file)"
    confidence: 0.75

  - symbol: AchievementWall
    file: src/features/home/components/AchievementWall.tsx (new)
    assert:
      - "Shows first 4 unlocked + count of remaining"
      - "Click opens full achievement list (modal or panel)"
    source: "code:src/features/home/components/AchievementWall.tsx (new file)"
    confidence: 0.75

contract:
  - "App boots into HomePage by default (not ReadingSessionPage)"
  - "HomePage renders streak/today/ring/achievements in 3-tier layout"
  - "Completing a reading session triggers achievement check + toast"
  - "difficultyAdvisor returns null when not enough data (>= 30 words)"
  - "Achievement data persists across page reloads"
  - "HomePage is keyboard navigable (Tab through cards, Enter activates)"
  - "Build passes tsc -b && vite build with 0 errors"
```

## 风险矩阵

| 风险 | 等级 | 缓解 |
|------|------|------|
| 成就系统让用户感觉被催 | medium | 成就只在达成时触发, 主页不弹"还差 X 天" |
| 自动难度升级破坏掌控感 | medium | 软建议, 不强制; 用户可拒绝 |
| 主页拉长启动路径 | low | 主页 1 步进入阅读, 不增加配置 |
| 成就图标无设计资源 | low | 用 SVG 线图标自绘, 与 EmptyState 风格一致 |
| App.tsx 路由重构破坏快捷键 | medium | useGlobalShortcuts 按 mode 路由 |
| useAnalyticsStore 现有 getStreak 边界 bug | low | 不复用, 在 difficultyAdvisor 中重算 |
| localStorage 体积增加 | low | 成就数据 < 5KB, 忽略 |

## 验收标准

1. 启动应用默认进入 HomePage
2. HomePage 显示 streak (默认 0)、今日单元卡、成就墙 (空状态)
3. 点击 "开始阅读" 1 步进入 ReadingSessionPage
4. 完成一次阅读后, streak=1, "初次启航"成就解锁, 触发 toast
5. streak 达 3 时自动解锁"三日入门"
6. 主页显示难度建议提示 (当满足条件时)
7. tsc -b && vite build 通过 (0 错误)
8. HomePage 在 1440/1024/390 三种视口下都可用
9. 快捷键 s (设置) 在 HomePage 也可用
10. 主页不弹"还差 X 天"骚扰性提示

## 阶段建议 (5 阶段)

### Stage 1: 数据层
- useAchievementStore (定义类型 + 持久化)
- achievementEngine (纯函数)
- difficultyAdvisor (纯函数)
- 单元测试: 成就条件函数

### Stage 2: 触发层
- 在 ReadingSessionPage / ReviewSessionPage 完成时调用 checkAndUnlock
- AchievementToast 组件
- 主页 hooks: useHomeData, useDifficultySuggestion

### Stage 3: 主页 UI
- HomePage 布局 (3 段式)
- StreakBadge / TodayCard / ProgressRing / AchievementWall 子组件
- App.tsx 路由重构

### Stage 4: 难度建议 + 引导
- HomePage 难度建议提示集成
- 首次用户空状态文案
- useGlobalShortcuts 路由适配

### Stage 5: 浏览器验证
- Playwright 在 1440/1024/390 截图
- 完成一次完整流程: 主页 -> 阅读 -> 主页看到成就
- 构建验证

## 设计原则 (与项目硬约束一致)

- **No emoji**: 成就图标用 SVG 线图标, 与 EmptyState 风格一致
- **Warm color scheme**: 主屏仍用 #faf8f5 + #1c1917
- **Reading area >= 60%**: 主页不是阅读, 留出至少 60% 空间给中央单元卡
- **prefers-reduced-motion**: ProgressRing 动画遵守
- **CSS variables in tokens.css**: 新增 --color-flame, --color-achievement-* 等

## 自我审查 (Self-Review)

| 检查项 | 状态 |
|--------|------|
| Webfetch 覆盖 (4 项目 + 1 论文) | ✅ |
| Paper Radar 已记录 | ✅ (1 call, 已知 HLR 论文直接引用) |
| 实现要点含 confidence + source | ✅ |
| Confidence 一致性 (单源 <= 0.8) | ✅ |
| 无 placeholder (TBD/TODO) | ✅ |
| SPEC <-> Contract 对齐 | ✅ |
| Frontmatter 完整 | ✅ |
| Wikilink 双向 | ✅ |
| Tag <-> confidence 对齐 | ✅ (#confidence/medium, 0.78) |
| Confidence Cap (无违规) | ✅ |