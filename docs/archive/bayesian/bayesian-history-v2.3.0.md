---
title: "Bayesian History v2.3.0"
date: "2026-07-15"
version: "2.3.0"
project: "wordaydream"
tags:
  - artifact/history
  - version/2.3.0
---

# Bayesian History — wordaydream v2.3.0

## Stage 完成记录

### Stage 1: 数据模型 + 静态课程定义
- **时间**: 2026-07-15
- **结果**: PASS
- **文件**: types.ts (100行) + en.ts (214行) + de.ts (231行) + index.ts (42行)
- **设计决策**:
  - en 词表每级仅 80 词,采用 5 Lesson/Module (75词/Module ≤ 80)
  - de 词表充裕 (A1=645/B1=1000/B2=1569),采用 6 Lesson/Module
  - 主题池实际位置: `src/features/llm/config/prompts.ts` 的 `DIFFICULTY_CONSTRAINTS[level].exampleTopics`
  - de A1 词表 `sein`/`ihr` 重复,取首次出现
- **反思**: SPEC 假设的 "4×6×15=360" 对 en 词表超量,subagent 自适应调整为 5 Lesson/Module。SPEC 应预留词表容量校验步骤。

### Stage 2: useCourseStore
- **时间**: 2026-07-15
- **结果**: PASS
- **文件**: useCourseStore.ts (358行) + test (242行)
- **测试**: 10/10 pass (8 critical + 2 non-critical)
- **设计决策**:
  - LessonProgress 用 `wordsEncountered: string[]` 而非 number (便于审计 + 去重)
  - checkCompletion 已完成的课时再次调用返回 false (防重复标记)
  - reviewTotalCount=0 时 accuracy 视为 0 (无法满足 0.7 阈值)
  - enrollCourse 重复调用会重置 lessonProgress
  - startLesson 非 'available' 状态 silently return (不抛异常)
- **反思**: import 路径深度计算容易出错 (任务描述给的路径不对,subagent 自行修正)。zustand v5 persist API 用 `name` 而非 `key`。

### Stage 3: passageGenerator + loadSession
- **时间**: 2026-07-15
- **结果**: PASS
- **文件**: 5 文件修改 (types/index.ts + passageGenerator.ts + useReadingSessionStore.ts + 2 test files)
- **测试**: 31/31 pass (6 critical + 25 existing, 无回归)
- **设计决策**:
  - generatePassage 当前签名是位置参数 (非 options 对象),targetLemmas 作为第 7 个可选参数追加
  - loadSession 同理,lessonId 作为第 3 个可选位置参数
  - prompt 注入位置: buildPassagePrompt 返回的 prompt 中,插在 "MANDATORY self-check" 前
  - 命中率检查时机: selectHighlightsByDensity 之后、return 之前
  - recordEncounter 对 passage 所有 token 的 lemma 去重后调用 (case-insensitive)
- **Gap**: loadSession 不会自动把 lesson.targetLemmas 传给 generatePassage (Stage 5 修复)
- **反思**: 位置参数扩展到 7 个已经很长,未来重构应改为 options 对象。

### Stage 4: CoursePathPage UI
- **时间**: 2026-07-15
- **结果**: PASS
- **文件**: 8 文件 (3 组件 + 3 CSS + 1 测试 + App.tsx/useAppModeStore 修改)
- **测试**: 27/27 pass (6 critical + 2 non-critical,全 T01-T08 覆盖)
- **设计决策**:
  - 未选课时展示课程选择列表,已选课时展示 Module 列表
  - ModuleSection 默认展开规则: 含 in-progress 或首个含 available lesson 的 Module
  - LessonCard available 状态不渲染进度条 (尚未开始)
  - T06 路由测试用静态检查 (VALID_APP_MODES + App.tsx 源码正则),避免 render App 引入 heavy 依赖
  - T08 CSS 测试用 fs.readFileSync 读 CSS 验证 @media query
- **反思**: pnpm test 因 pnpm-lock.yaml 过期无法运行,改用 node node_modules/vitest/vitest.mjs。lockfile 问题应在迭代前解决。

### Stage 5: Modal + Card + HomePage
- **时间**: 2026-07-15
- **结果**: PASS (YELLOW → Stage 6 修复)
- **文件**: 7 文件 (4 创建 + 3 修改)
- **测试**: 614/614 pass (26 新增 CurrentLessonCard 测试)
- **RGT YELLOW 原因**: Plan T01-T03 是 LessonCompleteModal 独立测试,subagent 重新编号为 CurrentLessonCard 测试。LessonCompleteModal 缺少独立测试。
- **设计决策**:
  - LessonCompleteModal 自包含 (自己监听 store),可在任何地方渲染
  - shownRef 记录已弹出的 lessonId,防重复
  - 进度环用 CSS conic-gradient + --progress 变量
  - loadSession 内部修复 Stage 3 gap: 通过 useCourseStore.getState() + getLessonById 查找 lesson.targetLemmas
- **反思**: subagent 倾向于测试自己熟悉的组件 (CurrentLessonCard),跳过复杂的 modal 组件。dispatch prompt 应更明确地要求每个组件都有独立测试文件。

### Stage 6: 数据迁移 + 集成测试
- **时间**: 2026-07-15
- **结果**: PASS
- **文件**: 4 文件 (2 修改 + 1 新建 + 1 既有测试更新)
- **测试**: 643/643 pass (33 Part A + 17 Part B,无回归)
- **设计决策**:
  - 迁移策略选 Plan 3 (最简最安全): migrateWordlistToCourse 仅升级 schemaVersion,不分配 progress
  - 旧用户 progress 保留在 useWordlistStore,useCourseStore 从空开始
  - LessonCompleteModal.test.tsx 补充 M01-M08 (17 tests),修复 Stage 5 YELLOW
- **反思**: Plan 3 虽然最安全,但旧用户的词汇进度不会自动迁移到课程体系。未来 v2.4.0 可考虑 Plan 1/2 (实际分配 progress 到 lessonProgress)。

## 反思记录

### 反思 1: SPEC 词表容量假设
- **问题**: SPEC 假设 "4×6×15=360" 词,但 en 词表每级仅 80 词 (总 320),不足以支撑 360 词分配
- **解决**: subagent 自适应调整 en 为 5 Lesson/Module (75词/Module)
- **教训**: SPEC 生成阶段应校验实际数据容量,不应假设词表大小

### 反思 2: 位置参数 vs Options 对象
- **问题**: generatePassage 扩展到 7 个位置参数,loadSession 扩展到 3 个,可读性差
- **解决**: 保持向后兼容,但未来重构应改为 options 对象
- **教训**: 函数参数超过 3 个时应使用 options 对象,避免位置参数地狱

### 反思 3: subagent 测试覆盖偏差
- **问题**: Stage 5 subagent 跳过 LessonCompleteModal 独立测试,把测试编号重新分配给 CurrentLessonCard
- **解决**: Stage 6 dispatch 时明确要求补充 LessonCompleteModal.test.tsx
- **教训**: dispatch prompt 中每个文件都应有对应的测试文件要求,不能假设 subagent 会自动覆盖所有组件

### 反思 4: pnpm-lock.yaml 过期
- **问题**: pnpm test 因 ERR_PNPM_OUTDATED_LOCKFILE 无法运行
- **解决**: 改用 node node_modules/vitest/vitest.mjs 直接调用
- **教训**: 迭代前应检查 pnpm-lock.yaml 状态,必要时 pnpm install 更新

## 校准日志

| Stage | Prior | Posterior | 偏差 | 校准方向 |
|-------|-------|-----------|------|---------|
| 1 | 0.80 | 0.85 | +0.05 | LibreLingo 强参考,实现质量高 |
| 2 | 0.70 | 0.80 | +0.10 | algorithm 类型 TDD 强制,测试覆盖充分 |
| 3 | 0.70 | 0.78 | +0.08 | 向后兼容 + 命中率检查,但有 Stage 5 修复的 gap |
| 4 | 0.63 | 0.75 | +0.12 | UI 组件 + CSS 设计质量高,tokens.css 变量全用 |
| 5 | 0.65 | 0.72 | +0.07 | YELLOW 降级,Stage 6 修复后恢复 |
| 6 | 0.65 | 0.78 | +0.13 | Plan 3 最简最安全,迁移幂等 + 容错 |

**校准总结**: 所有 Stage posterior > prior,说明 prior 估计保守。UI 组件 (Stage 4/5) 的校准幅度最大 (+0.12/+0.07),说明 UI 设计的不确定性被高估。algorithm 类型 (Stage 2) 校准稳定 (+0.10)。

**下一版本 prior 建议**: 
- config 类型: 0.85 (从 0.80 上调)
- algorithm 类型: 0.75 (从 0.70 上调)
- ui_component 类型: 0.70 (从 0.63 上调)
- cross_module_async: 0.72 (从 0.70 上调)
