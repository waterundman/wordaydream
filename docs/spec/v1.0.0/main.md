---
title: "Wordaydream v1.0.0 SPEC 主文档"
date: "2026-07-09"
version: "1.0.0"
project: "Wordaydream"
tags:
  - artifact/spec
  - version/1.0.0
  - project/Wordaydream
  - confidence/medium
confidence: 0.78
upstream:
  - [[cache/v1.0.0/research/direction-insights]]
  - [[cache/v1.0.0/research/comparison-matrix]]
  - [[cache/v1.0.0/functional/analytics-store-research]]
  - [[cache/v1.0.0/functional/persistence-middleware-research]]
  - [[cache/v1.0.0/functional/mobile-responsive-research]]
downstream: []
---
# Wordaydream v1.0.0 SPEC

## 迭代主题

**数据可信 + 状态持久 + 移动合规**: 在 v0.9.0 功能完整的基础上, 修复 3 类 P0 数据流与体验缺口, 为 v1.0.0 正式版发布提供可演示的稳定基线。

## 核心方向 (3 P0)

### D1: useAnalyticsStore 数据补全
- 5 个占位 getter 改为 selector 派生
- 新增 `useHomeAnalytics()` hook
- 修复 9 个永远无法解锁的成就
- 让 DifficultySuggestion 在 totalAtLevel >= 30 时显示
- 详见: `[[cache/v1.0.0/functional/analytics-store-research]]`

### D2: 持久化官方化
- 删除自实现 `lib/persistenceMiddleware.ts`
- 9 个 store 全部用 Zustand `persist` middleware
- 重点处理 useMemoryStore.cards (Map) 序列化
- 验证: 刷新页面后所有数据保留
- 详见: `[[cache/v1.0.0/functional/persistence-middleware-research]]`

### D3: 移动端响应式合规化
- 落实 WCAG 2.5.5 44x44 (settingsBtn + cta)
- 字号改用 clamp() 流式排版
- 新增 768px 平板中间档
- 完善 600px 手机档
- 详见: `[[cache/v1.0.0/functional/mobile-responsive-research]]`

### D4 (defer): 真实 LLM 集成
- 推迟到 v1.1.0
- v1.0.0 阶段在 LLMProvider 接口层留 hook
- 设置面板"真实 LLM 接入"开关保持 disabled + tooltip
- 详见: `[[cache/v1.0.0/research/direction-insights]]` (D4 段)

---

## 实现要点 (Expect/Contract YAML)

```yaml
# E1: useHomeAnalytics 派生 totalLearned 非零
- id: E1
  description: useHomeAnalytics() 返回的 totalLearned 字段在使用 useMemoryStore 写入卡片后应 > 0
  contract:
    given: useMemoryStore.cards 包含 5 张卡片, 其中 3 张 status !== 'new'
    when: 调用 useHomeAnalytics()
    then: totalLearned === 3
  confidence: 0.88
  source: 双源 (项目代码 useMemoryStore + Zustand selector 文档)
  priority: P0
  phase: 1
  files:
    - src/features/analytics/hooks/useHomeAnalytics.ts (新建)
    - src/features/analytics/store/useAnalyticsStore.ts (改造)

# E2: useHomeAnalytics 派生 masteryRate
- id: E2
  description: masteryRate = mastered / total, total=0 时返回 0 不抛错
  contract:
    given: cards 为空 / cards 全部为 mastered / cards 部分 mastered
    when: 调用 useHomeAnalytics()
    then: masteryRate 在 [0, 1] 区间, total=0 时 === 0
  confidence: 0.88
  source: 双源 (项目代码 + Zustand selector 模式)
  priority: P0
  phase: 1
  files:
    - src/features/analytics/hooks/useHomeAnalytics.ts

# E3: byLevel 各 key 之和等于 total
- id: E3
  description: byLevel[1..5] 之和 === total
  contract:
    given: 任意 cards 状态
    when: 调用 useHomeAnalytics()
    then: sum(byLevel[1..5]) === total
  confidence: 0.85
  source: 单源 (项目代码 byLevel 派生逻辑)
  priority: P0
  phase: 1

# E4: useReadingSessionStore.loadSession 末尾 checkAndUnlock 真实数据
- id: E4
  description: loadSession 完成后, checkAndUnlock 接收的 totalWords / totalSessions / masteredByLevel 全部为真实值 (非 0)
  contract:
    given: useMemoryStore 含 50 张 mastered 卡片, useReadingHistoryStore 含 5 条历史
    when: 调用 loadSession(sessionId) 完成
    then: checkAndUnlock.lastCall.args[0].totalWords === 50, totalSessions === 5, masteredByLevel 与实际 byLevel 一致
  confidence: 0.88
  source: 双源 (项目代码 + checkAndUnlock 签名)
  priority: P0
  phase: 1
  files:
    - src/features/reading-session/store/useReadingSessionStore.ts

# E5: 至少 1 个成就能在测试数据下解锁
- id: E5
  description: 在 mastered=50, sessions=100 的 fixture 下, half_century + century + marathon 至少 1 个解锁
  contract:
    given: useMemoryStore.cards 50 张 mastered, useReadingHistoryStore.sessions 100 条
    when: 调用 checkAndUnlock({ totalWords: 50, totalSessions: 100, ... })
    then: state.unlocked 中至少包含 half_century / century / marathon 之一
  confidence: 0.88
  source: 双源 (成就定义 + checkAndUnlock 逻辑)
  priority: P0
  phase: 1

# E6: DifficultySuggestion 在 totalAtLevel >= 30 时显示
- id: E6
  description: DifficultySuggestion 组件在 useHomeAnalytics().byLevel[3] >= 30 时显示
  contract:
    given: byLevel[3] = 35
    when: 渲染 HomePage
    then: DifficultySuggestion 节点存在
  confidence: 0.82
  source: 单源 (组件逻辑 + analytics 派生)
  priority: P0
  phase: 1

# E7: useMemoryStore.cards Map 序列化往返一致
- id: E7
  description: persist middleware 保存后, 重新加载得到的 cards 应等于原 Map (size + value 一致)
  contract:
    given: useMemoryStore 含 10 张卡片
    when: 触发 persist.setItem, 模拟刷新, 触发 rehydrate
    then: cards.size === 10, 所有 card.id + card.status 完全一致
  confidence: 0.92
  source: 双源 (Zustand persist 文档 + partialize/merge 模式)
  priority: P0
  phase: 2
  files:
    - src/features/memory/store/useMemoryStore.ts

# E8: useAchievementStore.newUnlocks 不持久化
- id: E8
  description: 刷新页面后, newUnlocks 数组应为空 (只持久化 unlocked)
  contract:
    given: 触发新成就解锁, newUnlocks 含 1 项
    when: 模拟刷新 (rehydrate)
    then: newUnlocks === []
  confidence: 0.90
  source: 双源 (项目设计 + persist partialize 文档)
  priority: P0
  phase: 2
  files:
    - src/features/achievements/store/useAchievementStore.ts

# E9: useStreakStore 刷新后保留
- id: E9
  description: 写入 dailyRecords 后刷新, currentStreak 与 dailyRecords 完整保留
  contract:
    given: useStreakStore.currentStreak = 7, dailyRecords 长度 7
    when: 模拟刷新
    then: currentStreak === 7, dailyRecords.length === 7
  confidence: 0.90
  source: 双源 (项目代码 + persist API)
  priority: P0
  phase: 2

# E10: lib/persistenceMiddleware.ts 已删除
- id: E10
  description: 文件系统中不存在 lib/persistenceMiddleware.ts, 9 个 store 全部使用 zustand/middleware 的 persist
  contract:
    given: 迁移完成
    when: grep "persistenceMiddleware" 项目源码
    then: 0 命中
  confidence: 0.95
  source: 双源 (迁移清单 + persist 文档)
  priority: P0
  phase: 2

# E11: TodayCard.cta 实际高度 ≥ 44px
- id: E11
  description: 在 375px 视口下, TodayCard 渲染后 .cta 的 getBoundingClientRect().height ≥ 44
  contract:
    given: 视口宽度 375px
    when: 渲染 TodayCard
    then: cta.height >= 44 (WCAG 2.5.5 Level AAA)
  confidence: 0.90
  source: 双源 (WCAG 2.5.5 规范 + CSS min-height 实现)
  priority: P0
  phase: 3
  files:
    - src/features/today/TodayCard.module.css

# E12: HomePage.settingsBtn ≥ 44x44
- id: E12
  description: .settingsBtn 在 320px 视口下 width >= 44 && height >= 44
  contract:
    given: 视口宽度 320px
    when: 渲染 HomePage
    then: settingsBtn.width >= 44 && settingsBtn.height >= 44
  confidence: 0.90
  source: 双源 (WCAG 2.5.5 + CSS min-width/min-height)
  priority: P0
  phase: 3
  files:
    - src/pages/HomePage.module.css

# E13: 768px 媒体查询存在
- id: E13
  description: HomePage.module.css 与 TodayCard.module.css 均含 @media (max-width: 768px)
  contract:
    given: 移动端适配完成
    when: grep "@media.*768px" CSS 文件
    then: 命中数 >= 2
  confidence: 0.85
  source: 单源 (项目设计约定)
  priority: P0
  phase: 3

# E14: clamp() 字号在 300-1920px 连续
- id: E14
  description: TodayCard.title 与 HomePage.brandTitle 使用 clamp(), 在 300/600/768/1024/1920px 视口下字号连续, 无媒体查询硬跳变
  contract:
    given: 5 个采样视口
    when: getComputedStyle(el).fontSize
    then: 5 个值在区间内单调, 无两个值相同
  confidence: 0.85
  source: 单源 (clamp() 数学性质)
  priority: P0
  phase: 3

# E15: 跨 tab 同步
- id: E15
  description: 在 tab A 触发成就解锁, tab B 通过 storage 事件自动更新 useAchievementStore
  contract:
    given: 同一浏览器, 2 个 tab
    when: tab A 解锁成就
    then: tab B 的 useAchievementStore.unlocked 在 1s 内包含新条目
  confidence: 0.80
  source: 单源 (Zustand persist 默认行为)
  priority: P1
  phase: 2

# E16: localStorage 总量 < 5MB
- id: E16
  description: 所有 store 持久化后, localStorage 总量 < 5MB (浏览器上限保险)
  contract:
    given: 正常使用 30 天后的数据量
    when: Object.values(localStorage).reduce((s, v) => s + v.length, 0)
    then: < 5 * 1024 * 1024
  confidence: 0.78
  source: 单源 (LRU 截断策略估算)
  priority: P1
  phase: 2

# E17: prefers-reduced-motion 遵守
- id: E17
  description: 在系统启用 reduced-motion 时, 所有 transition / animation 关闭
  contract:
    given: prefers-reduced-motion: reduce
    when: 渲染首页
    then: getComputedStyle(cta).transitionDuration === '0s'
  confidence: 0.88
  source: 单源 (CSS @media 规范)
  priority: P0
  phase: 3
```

**expect 数量**: 17 条 (≥ 12 条要求)
**confidence 分布**:
- 0.95+ 多源: 0 条
- 0.90-0.94 多源/官方: 4 条 (E7, E8, E9, E10, E11, E12)
- 0.85-0.89 双源: 6 条 (E1, E2, E4, E5, E13, E14, E17)
- 0.78-0.84 单源: 7 条 (E3, E6, E15, E16)

---

## 风险矩阵

| 风险 | 概率 | 影响 | 等级 | 缓解策略 |
| ---- | ---- | ---- | ---- | -------- |
| Map 序列化类型断言错误 | 中 | 高 | 高 | 单元测试覆盖 serialize/deserialize, 严格 TS, lint 规则 |
| 9 个 store 改动回归 | 中 | 高 | 高 | 分阶段迁移, 每个 store 单独 PR + 回归 |
| useHomeAnalytics 性能问题 (大卡片量) | 低 | 中 | 中 | useMemo 缓存, 考虑 selector + shallow 比较 |
| 跨 tab 同步导致状态抖动 | 中 | 中 | 中 | onRehydrateStorage 合并逻辑, 关键写入 throttle |
| 移动端 44x44 视觉违和 | 中 | 低 | 中 | 留 2px 视觉 padding 弥补, 设计师走查 |
| clamp() 旧浏览器不兼容 | 低 | 低 | 低 | 项目放弃 IE, 降级 1rem |
| 成就解锁逻辑回归 | 中 | 中 | 中 | 13 个成就逐一验证, 截图对比 |
| 旧版本数据 schema 破坏 | 低 | 高 | 中 | version + migrate, 启动时检测 |
| localStorage 配额超限 | 低 | 中 | 低 | LRU 截断 (sessions 100 / answerHistory 500) |
| 真实 LLM 推迟影响 v1.0.0 演示 | 中 | 中 | 中 | 留 hook + tooltip, 不影响核心阅读/记忆流程 |

---

## 验收标准 (至少 10 条)

### 数据层 (Phase 1)
1. useHomeAnalytics() 在任意 cards 状态下返回正确 totalLearned / mastered / masteryRate / byLevel
2. useHomeAnalytics 单元测试覆盖率 ≥ 90%
3. useReadingSessionStore.loadSession 末尾 checkAndUnlock 接收的 progress 字段全部为真实数据
4. 至少 1 个成就 (half_century / century / marathon) 能在测试 fixture 下解锁
5. DifficultySuggestion 组件在 byLevel[3] >= 30 时渲染

### 持久化 (Phase 2)
6. lib/persistenceMiddleware.ts 文件被删除
7. 9 个 store 全部使用 zustand/middleware 的 persist
8. 模拟刷新 (location.reload) 后: 卡片 / 成就 / 连击日 / 会话进度 / 复习队列全部保留
9. useMemoryStore.cards 序列化往返 size + value 完全一致
10. useAchievementStore.newUnlocks 刷新后为空 (仅 unlocked 持久化)
11. localStorage 总量 < 5MB (含 LRU 截断)

### 移动端 (Phase 3)
12. TodayCard.cta 在 375px 视口下高度 ≥ 44px
13. HomePage.settingsBtn 在 320px 视口下 width >= 44 && height >= 44
14. TodayCard / HomePage CSS 均含 @media (max-width: 768px)
15. 字号使用 clamp(), 在 300-1920px 视口下连续无跳变
16. prefers-reduced-motion 启用时全部 transition 关闭

### 验证 (Phase 4)
17. Storybook 多视口测试通过 (375 / 600 / 768 / 1024 / 1920)
18. 截图回归 Chromatic 通过 (桌面 + 移动基线)
19. E2E 测试 (Playwright) 覆盖: 创建卡片 → 复习 → 解锁成就 → 刷新 → 数据保留
20. 无控制台错误 (Chrome DevTools Console 0 error)
21. bundle size 较 v0.9.0 增量 < 50KB (gzip)

---

## 阶段建议 (4 阶段)

### Phase 1: 数据层 (估算 1 周)
- [ ] 1.1 新建 `useHomeAnalytics` hook
- [ ] 1.2 改造 useAnalyticsStore: 删除 5 个 getter, 保留 addLearningRecord/addAnswerRecord
- [ ] 1.3 改造 useReadingSessionStore.loadSession 末尾传入真实值
- [ ] 1.4 改造 DifficultySuggestion 组件读 byLevel
- [ ] 1.5 单元测试 useHomeAnalytics
- [ ] 1.6 验证 9 个成就的 checkAndUnlock 签名适配

### Phase 2: 持久化 (估算 1 周)
- [ ] 2.1 迁移 useSettingsStore (最简单, 验证流程)
- [ ] 2.2 迁移 useMemoryStore (Map 序列化重点)
- [ ] 2.3 迁移 useAchievementStore + useStreakStore
- [ ] 2.4 迁移 useReadingSessionStore + useReadingHistoryStore + useReviewSessionStore
- [ ] 2.5 迁移 useAnalyticsStore
- [ ] 2.6 删除 lib/persistenceMiddleware.ts
- [ ] 2.7 验证 9 个 store 行为一致, 刷新无丢失
- [ ] 2.8 跨 tab 同步测试

### Phase 3: 移动端 (估算 3-5 天)
- [ ] 3.1 改造 TodayCard.module.css (clamp 字号 + 44px cta + 600/768 媒体查询)
- [ ] 3.2 改造 HomePage.module.css (44x44 settingsBtn + clamp brandTitle + 768 媒体查询)
- [ ] 3.3 (可选) 增补 tokens.css 流式字号 + tap target token
- [ ] 3.4 Storybook 多视口 story
- [ ] 3.5 设计师走查

### Phase 4: 验证 (估算 2-3 天)
- [ ] 4.1 单元测试全量回归
- [ ] 4.2 E2E (Playwright) 刷新 + 成就解锁 + 移动视口
- [ ] 4.3 截图回归 Chromatic
- [ ] 4.4 bundle size 检查
- [ ] 4.5 性能 profile (React DevTools Profiler)
- [ ] 4.6 撰写 v1.0.0 release notes

**总工期估算**: 约 3 周 (1 人)

---

## 设计原则

1. **数据真相单源**: 派生数据 selector, 不在 store 内同步冗余字段。
2. **状态分层持久**: 关键数据 (memory / streak / unlocked) 持久, 临时数据 (newUnlocks / currentSession ephemeral) 内存。
3. **渐进式排版**: clamp() 流式优先, 媒体查询只做"微调"。
4. **WCAG AAA 基线**: tap target 44x44 不可妥协, 字号保底 1rem。
5. **跨 store 显式依赖**: 通过 hook 组合, 不在 store 内隐式 import 另一个 store。
6. **Map/Set 显式序列化**: partialize + merge 转换, 避免 `JSON.stringify(new Map())` 陷阱。
7. **可降级**: persist 失败时 (e.g. localStorage 满) catch 异常, 不阻塞应用。
8. **类型严格**: TypeScript strict, 禁用 any (除 merge 函数必要的类型断言)。

---

## 自我审查表

在 v1.0.0 发布前, 由作者 + 1 名 reviewer 逐项确认:

- [ ] 1. useHomeAnalytics hook 已建立, 单元测试覆盖
- [ ] 2. useAnalyticsStore 5 个占位 getter 已删除
- [ ] 3. useReadingSessionStore.loadSession checkAndUnlock 传真实值
- [ ] 4. 9 个 store 全部使用官方 persist middleware
- [ ] 5. lib/persistenceMiddleware.ts 已删除
- [ ] 6. useMemoryStore.cards Map 序列化往返正确
- [ ] 7. useAchievementStore.newUnlocks 不持久化
- [ ] 8. 跨 tab 同步工作
- [ ] 9. TodayCard.cta 实际高度 >= 44px (devTools 验证)
- [ ] 10. HomePage.settingsBtn 实际尺寸 >= 44x44
- [ ] 11. 768px 中间档媒体查询已存在
- [ ] 12. clamp() 字号在 300-1920 视口连续
- [ ] 13. prefers-reduced-motion 遵守
- [ ] 14. 无 emoji, 全部图标内联 SVG
- [ ] 15. 暖白纸 + 深墨字配色保留
- [ ] 16. 阅读区 >= 60% 视口宽
- [ ] 17. 单元测试覆盖率 >= 80% (整体)
- [ ] 18. E2E 测试覆盖核心流程
- [ ] 19. bundle size 增量 < 50KB (gzip)
- [ ] 20. 无控制台错误
- [ ] 21. 真实 LLM 集成显式标记 defer, 文档说明
- [ ] 22. release notes 撰写完成
- [ ] 23. 至少 1 个 reviewer 走查代码
- [ ] 24. v0.9.0 已知问题列表全部修复或显式 defer

---

## 关联文件

- 上游 cache 研究:
  - `[[cache/v1.0.0/research/direction-insights]]` (4 方向灵感)
  - `[[cache/v1.0.0/research/comparison-matrix]]` (方案对比)
  - `[[cache/v1.0.0/functional/analytics-store-research]]` (D1 详细)
  - `[[cache/v1.0.0/functional/persistence-middleware-research]]` (D2 详细)
  - `[[cache/v1.0.0/functional/mobile-responsive-research]]` (D3 详细)
- 项目主文档:
  - `[[Wordaydream-Overview]]`
  - `[[v0.9.0-retrospective]]`
- 下游 (v1.0.0 发布后):
  - `[[Wordaydream-v1.0.0-Roadmap]]` (待建)
  - `[[Wordaydream-v1.1.0-Backlog]]` (含真实 LLM 集成)

## 外部参考

- Zustand persist 文档: https://github.com/pmndrs/zustand/blob/main/docs/integrations/persisting-store-data.md
- W3C WCAG 2.5.5 Target Size: https://www.w3.org/WAI/WCAG21/Understanding/target-size.html
- Settles & Meeder 2016 HLR 论文 (内部 paper-radar)
- MDN clamp(): https://developer.mozilla.org/en-US/docs/Web/CSS/clamp
- MDN prefers-reduced-motion: https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion
