# v2.2.4 SPEC — 全量代码审查优化

## 版本信息
- 版本: 2.2.4
- 版本类型: quality (代码质量优化, 无新功能)
- 前置版本: v2.2.3 (527 tests)
- 目标: 类型安全 + 架构清理 + UX/a11y 一致性 + 文档同步
- 审查基线: 4 维度并行审查, 识别 50+ 问题

## Stage 1: 类型安全 + 死代码清理

### D1-1: PassageJsonPayload 补充 grammarPoints 字段
- 文件: src/features/llm/services/jsonParser.ts
- 修复: 接口增加 `grammarPoints?: Array<{ startIndex: number; endIndex: number; text: string }>`
- 连带消除 llmAdapter.ts 4 处 `as unknown as` 断言

### D1-2: 'en' | 'de' 替换为 Language 类型
- 16 处内联 `'en' | 'de'` 替换为 `import type { Language } from '../../types'`
- 文件: llmAdapter.ts, evaluateAnswer.ts, useMemoryStore.ts, ReviewSessionPage.tsx, mockProvider.ts 等

### D1-3: 删除未使用导出
- LEGACY_FIXTURES_V120 (src/__fixtures__/index.ts:92)
- getActiveShortcutScope (src/hooks/useKeyboardShortcuts.ts:136)
- getAllRegisteredShortcuts (src/hooks/useKeyboardShortcuts.ts:172)

### D1-4: Window 全局类型声明
- 文件: src/vite-env.d.ts
- 扩展 Window 接口: `__TOAST_STORE__` + `__READING_STORE__`
- 消除 2 处 `as unknown as` 断言

### D1-5: Set 序列化类型修正
- 文件: src/features/reading/store/useReadingSessionStore.ts
- partialize 返回类型用 `PersistedReadingSession` (resolvedTokens: string[])

## Stage 2: 架构清理 + 状态管理

### D2-1: reading:completed 死事件清理
- 文件: src/domain/events.ts + src/features/reading/store/useReadingHistoryStore.ts
- 移除 `reading:completed` 事件类型 + publish 调用 (无生产订阅者)

### D2-2: router.ts empty catch 加日志
- 文件: src/features/llm/services/router.ts
- 6 处 `catch { }` 改为 `catch (e) { console.warn('[router] notification failed:', e); }`
- 提取 `safeNotify` helper 消除重复

### D2-3: 占位 migrate 函数清理
- 6 个 store 的 `migrate: (x) => x` 删除 (zustand 默认行为就是返回原 state)
- 保留有真实迁移逻辑的 store (useMemoryStore, useWordlistStore, useSettingsStore)

### D2-4: useToastStore 移除无用 persist
- 文件: src/store/useToastStore.ts
- 移除 persist 中间件 (partialize 持久化空对象, 纯浪费 IO)

### D2-5: ErrorBoundary 重试机制改进
- 文件: src/components/ErrorBoundary.tsx
- 增加 `onReset` prop 让调用方重置相关 store
- 增加"返回首页"按钮 (强制卸载出错子树)

## Stage 3: UX/a11y/CSS 一致性

### D3-1: tokens.css 补全状态色变量
- 文件: src/styles/tokens.css
- 定义 `--color-danger` / `--color-danger-hover` / `--color-danger-text`
- 定义 `--color-warning-bg` / `--color-warning-border` / `--color-warning-text`
- 定义 `--color-success-bg` / `--color-success-text`
- 为 light/dark/sepia 三套主题分别定义

### D3-2: ReadingHistoryPanel 修复
- selector 反模式: `state.getHistory()` → `state.history`
- 折叠头键盘操作: div → button 或加 role/tabIndex/onKeyDown

### D3-3: SettingsPanel 确认弹窗 inline style 清理
- 文件: src/features/settings/components/SettingsPanel.tsx + .module.css
- 2 处确认弹窗 (~80 行 inline style) 提取到 CSS module class
- 硬编码颜色替换为 CSS variables

### D3-4: 暗色模式硬编码颜色修复
- ErrorBoundary.module.css: `#c45c4a` → `var(--color-danger)`
- NotificationBanner.module.css: `#fef3c7`/`#f59e0b` → `var(--color-warning-*)`
- ToastContainer.module.css: `#c45c4a`/`#c9a227` → `var(--color-danger/warning)`
- AchievementToast.module.css: `#e07a3b` → `var(--color-flame)`
- WordlistRow.tsx: `stroke="#ffffff"` → `stroke="var(--color-text-inverse, #ffffff)"`

### D3-5: 模态 a11y 补全
- SettingsPanel: 加 `aria-modal="true"` + ESC 监听
- GrammarPanel: 加 `aria-modal="true"`
- 创建 `useFocusTrap` 公共 hook, 统一 KeyboardShortcutsHelp/GraduationModal/AchievementListModal

### D3-6: ReadingSessionPage source badge inline style 清理
- sourceBadgeConfig IIFE 改为 CSS module class
- 硬编码颜色替换为 CSS variables

## Stage 4: 文档同步 + 配置

### D4-1: CHANGELOG.md 补齐
- 补齐 v1.6.1 → v2.2.3 所有版本记录

### D4-2: README.md 同步
- LLM 配置表补充 DeepSeek provider
- 项目结构更新 (移除 persistenceMiddleware.ts, 补充 domain/)

### D4-3: .env.example + docs 同步
- VITE_APP_VERSION: 1.5.2 → 2.2.3
- docs/FSRS.md 掌握判断标准更新为代码实际逻辑
- docs/ARCHITECTURE.md store 名修正

### D4-4: 配置优化
- vitest.config.ts 固化 `pool: 'threads'`
- package.json 增加 `"typecheck": "tsc --noEmit"`
- .oxlintrc.json `no-explicit-any` 从 warn 升级为 error

## 验证协议
- 单元测试: >= 527 (0 回归)
- tsc: 0 errors
- 无新增 `as unknown as` / `as any` 断言
- 暗色模式: 无硬编码颜色残留
- 文档: CHANGELOG/README/.env.example 与代码一致

## 不在本次 scope
- barrel exports (index.ts) — 大规模重构, v2.3.0
- store action 跨 feature getState() 解耦 — v2.3.0
- 虚拟列表 — v2.3.0
- Playwright E2E 套件 — v2.3.0
