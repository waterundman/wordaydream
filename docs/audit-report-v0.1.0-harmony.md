---
title: "Audit Report v0.1.0-harmony"
date: "2026-07-24"
version: "0.1.0-harmony"
project: "Wordaydream"
tags:
  - artifact/cache
  - type/audit
---

# Wordaydream 全量审计报告 v0.1.0-harmony

> 来源：subagent 全量审计（架构/代码质量/状态管理/依赖/测试/UI/鸿蒙移植可行性）
> 审计日期：2026-07-24
> 项目路径：`w:\项目仓库\For trae\wordaydream`

## 执行摘要

| 维度 | 评级 | 结论 |
|------|------|------|
| 架构设计 | A− | Feature-Sliced Design 落地清晰，14 个 feature 模块（文档仍称 13，需补 useCourseStore 文档） |
| 代码质量 | A− | 0 处 TODO/FIXME，8 处显式 `any`（全部在第三方/动态数据边界） |
| 状态管理 | A | 13 个 Zustand store，useSettingsStore 7 版本迁移链完整 |
| 依赖与外部服务 | A− | 依赖全部最新主版本；LLM 代理架构安全合规；PWA 配置完备 |
| 测试覆盖 | B+ | 74 个测试文件 / 545 用例全 PASS；缺正式 e2e 套件 |
| UI/UX | A | 三套主题 + prefers-reduced-motion + useFocusTrap + ARIA |
| 鸿蒙移植可行性 | B | PWA 主体可走 ArkWeb 直接复用；关键阻塞为 Service Worker / IndexedDB / Web Speech API / Edge Function 代理四项需适配 |

**总体评价**：工程质量在同类 React PWA 中属于上游水平。鸿蒙移植推荐走"PWA 直接复用 + 元服务壳"方案。

## 关键文件位置

### 架构与配置
- [package.json](file:///w:/项目仓库/For%20trae/wordaydream/package.json) — 依赖与版本（v2.2.4）
- [vite.config.ts](file:///w:/项目仓库/For%20trae/wordaydream/vite.config.ts) — Vite + PWA + dev server 配置
- [ARCHITECTURE.md](file:///w:/项目仓库/For%20trae/wordaydream/docs/ARCHITECTURE.md) — 架构文档（需更新 store 数量）
- [CHANGELOG.md](file:///w:/项目仓库/For%20trae/wordaydream/CHANGELOG.md) — 版本历史

### 状态管理
- [useSettingsStore.ts](file:///w:/项目仓库/For%20trae/wordaydream/src/features/settings/store/useSettingsStore.ts) — 7 版本迁移链样板
- [useMemoryStore.ts](file:///w:/项目仓库/For%20trae/wordaydream/src/features/review/store/useMemoryStore.ts) — FSRS + 迁移
- [useCourseStore.ts](file:///w:/项目仓库/For%20trae/wordaydream/src/features/course/store/useCourseStore.ts) — v2.3.0 新增（文档未同步）
- [offlineMode.ts](file:///w:/项目仓库/For%20trae/wordaydream/src/features/llm/store/offlineMode.ts) — 0 副作用导入样板
- [events.ts](file:///w:/项目仓库/For%20trae/wordaydream/src/domain/events.ts) — 事件总线

### LLM 与外部服务
- [router.ts](file:///w:/项目仓库/For%20trae/wordaydream/src/features/llm/services/router.ts) — LLM 路由与重试
- [jsonParser.ts](file:///w:/项目仓库/For%20trae/wordaydream/src/features/llm/services/jsonParser.ts) — JSON 修复
- [providerFactory.ts](file:///w:/项目仓库/For%20trae/wordaydream/src/features/llm/services/providerFactory.ts) — Provider 工厂
- [llm-proxy.js](file:///w:/项目仓库/For%20trae/wordaydream/server/llm-proxy.js) — LLM 代理服务端

### 数据持久化
- [csvStorage.ts](file:///w:/项目仓库/For%20trae/wordaydream/src/data/wordlists/csvStorage.ts) — IndexedDB CSV 存储
- [glossPersistentCache.ts](file:///w:/项目仓库/For%20trae/wordaydream/src/features/dictionary/services/glossPersistentCache.ts) — Gloss 缓存

### UI/UX
- [App.tsx](file:///w:/项目仓库/For%20trae/wordaydream/src/App.tsx) — 顶层组件（SettingsPanel 顶层渲染）
- [main.tsx](file:///w:/项目仓库/For%20trae/wordaydream/src/main.tsx) — 入口（SW 注册 + offlineMode init）
- [useFocusTrap.ts](file:///w:/项目仓库/For%20trae/wordaydream/src/hooks/useFocusTrap.ts) — 焦点 trap
- [tokens.css](file:///w:/项目仓库/For%20trae/wordaydream/src/styles/tokens.css) — 三套主题 token
- [ReadingSessionPage.tsx](file:///w:/项目仓库/For%20trae/wordaydream/src/features/reading/ReadingSessionPage.tsx) — 阅读页（speechSynthesis cleanup）

### 测试
- [passage-full-pipeline.test.tsx](file:///w:/项目仓库/For%20trae/wordaydream/src/__integration__/passage-full-pipeline.test.tsx) — 端到端集成测试
- [persistMigration.test.ts](file:///w:/项目仓库/For%20trae/wordaydream/src/__tests__/persistMigration.test.ts) — 持久化迁移扫描

## 鸿蒙移植阻塞项

| ID | 阻塞项 | 优先级 | 解决方案 |
|----|--------|--------|---------|
| H-1 | Web Speech API 在鸿蒙端可用性未知 | P0 | 真机测试 `speechSynthesis` 可用性；不可用则隐藏朗读按钮（Stage 2 PlatformCapability 抽象） |
| H-2 | LLM proxy 无法直接复用 Netlify | P0 | 改为独立 Node.js 服务部署（Stage 4） |
| H-3 | PWA install prompt 在鸿蒙无效 | P1 | 鸿蒙端条件渲染隐藏 `InstallPromptButton`（Stage 2） |
| H-4 | Service Worker 早期 ArkWeb 版本不全 | P1 | 最低版本要求 HarmonyOS 5.0+；SW 不可用时降级（Stage 2） |
| H-5 | FSRS WASM binding 兼容性 | P2 | 已有 catch 降级到 ts-fsrs 纯 JS，无需额外工作 |

## 推荐的下一步行动

### 立即（本周）
- N-1: 同步 `package.json` 版本到 `2.3.0` 或回退 `useCourseStore.ts` 文件头注释
- N-2: 更新 `ARCHITECTURE.md` 把 store 数量从 10 改为 13，补充 `useCourseStore` 文档
- N-3: 补全 `useCourseStore.checkCompletion` 的 `requiredSessionTypes` 校验逻辑

### 短期（v2.3.x）
- S-1: 为剩余 6 个持久化 store 补充 migrate 函数
- S-2: 建立正式 Playwright e2e 套件
- S-3: 增加离线场景自动化测试
- S-4: LLM provider 真实网络集成测试

### 中期（v0.1.0-harmony）
- M-1: 抽象 `PlatformCapability` 接口（Stage 2）
- M-2: LLM proxy 抽象为接口，支持多后端（Stage 4）
- M-3: 字体资源本地化（避免鸿蒙端依赖 Google Fonts CDN）
- M-4: 鸿蒙 5.0+ 真机验证 ArkWeb 的 SW/IndexedDB/Web Speech API 实际行为
