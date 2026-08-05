---
title: "Release Checklist — Wordaydream v0.2.0-harmony"
date: "2026-07-27"
version: "0.2.0-harmony"
project: "Wordaydream"
tags:
  - artifact/release-checklist
  - version/0.2.0-harmony
  - platform/harmonyos
prior_version: "v0.1.0-harmony"
---

# Release Checklist — Wordaydream v0.2.0-harmony

## Stage 1: API 18 升级清单

- [x] harmony/build-profile.json5 compatibleSdkVersion '5.0.0(12)' → '5.0.0(18)' (default + release)
- [x] harmony/oh-package.json5 version '0.1.0' → '0.2.0'
- [x] harmony/entry/build-profile.json5 (无需修改, apiType stageMode 通用)
- [x] harmony/entry/src/main/module.json5 兼容性矩阵检查通过 (atomicService / deviceTypes / installationFree / requestPermissions 全部 API 18 兼容)
- [x] vitest 917/917 baseline 0 regression
- [x] tsc --noEmit 0 errors
- [x] vite build + vite build --mode harmony 双成功
- [ ] 真机验证: DevEco Studio 内构建 HAP, 安装到 API 18 真机/模拟器

## Stage 2: JSBridge 安全加固清单

- [x] harmony/entry/src/main/ets/bridge/BridgeInputValidator.ets 新建 (6 + 1 = 7 validate 方法)
- [x] src/platform/bridgeInputValidator.ts TS mirror (供 vitest 单测)
- [x] src/platform/__tests__/bridgeInputValidator.test.ts 17 单测用例 (T01-T15 + 2 附加)
- [x] HarmonyBridge.ets 5 方法签名审计 (triggerHapticFeedback / registerReminder / readPreferences / writePreferences / handleHarmonyLaunch)
- [x] w:\wordaydream\index.html CSP meta 标签注入
- [x] harmony/entry/src/main/ets/pages/Index.ets origin 白名单检查 (5 条 regex)
- [ ] 真机验证: accessedUrl() 在 onControllerAttached 时返回 arkweb:// 或 file:// 之一 (R-D4-2)
- [ ] 真机验证: LLM Proxy SSE 流式不被 CSP 阻塞 (R-D4-1)
- [ ] 真机验证: 非白名单 origin (如 http://evil.com) 无法调用 harmonyBridge

## Stage 3: 双向同步清单

- [x] harmony/entry/src/main/ets/data/MemoryCardSchema.ets 新增 TodayReviewStats 接口
- [x] harmony/entry/src/main/ets/data/MemoryCardStore.ets 新增 4 查询方法 (getAllCards / getRecentlyReviewedCards / getTodayReviewStats / getCardById)
- [x] harmony/entry/src/main/ets/bridge/HarmonyBridge.ets 新增 5 async 同步方法 (upsertCard / deleteCard / getAllCards / getRecentlyReviewedCards / getTodayReviewStats)
- [x] harmony/entry/src/main/ets/pages/Index.ets BRIDGE_METHODS 数组追加 5 方法名 (供 registerJavaScriptProxy 暴露)
- [x] src/platform/harmonyBridge.ts 新增 5 TS 方法 + MemoryCardRecordBridge + TodayReviewStatsBridge 接口
- [x] src/features/review/store/useMemoryStore.ts 同步触发点 (rateCard / addCardFromToken / deleteCard / resetAll) + onRehydrateStorage 逻辑 (R-1 闭环)
- [x] src/features/review/store/__tests__/sync.test.ts 9 单测用例 (T01-T09)
- [ ] 真机验证: rateCard 后 relationalStore 表内有对应记录 (R-D2-1 冲突解决策略)
- [ ] 真机验证: localStorage 清空后重启应用, getAllCards rehydrate 恢复卡片 (R-D2-3)
- [ ] 真机验证: 1000 张卡片 rehydrate 延迟 < 500ms (性能基线 指标 3)

## Stage 4: 卡片富化清单

- [x] harmony/entry/src/main/ets/widget/CardDataProvider.ets 新增 3 方法 (getTodayReviewStatsForWidget / getLanguage / getRecentlyReviewedCardsForWidget)
- [x] harmony/entry/src/main/ets/widget/ReviewCardWidget.ets 尺寸分支 (2*2 / 2*4) + 多语言 + 进度环
- [x] harmony/entry/src/main/ets/entryability/EntryAbility.ets emitter 事件发布 + 5 分钟节流
- [x] src/platform/cardDataProvider.ts TS mirror (供 vitest 单测)
- [x] src/platform/__tests__/cardDataProvider.test.ts 7+ 单测用例 (T01-T07)
- [ ] 真机验证: 添加 2*2 卡片, 验证紧凑布局 (无进度环)
- [ ] 真机验证: 添加 2*4 卡片, 验证富布局 (含进度环 + 词位 + 更新时间)
- [ ] 真机验证: review 一张卡片后, 5 分钟内卡片 dueCount 自动更新 (R-D3-1)
- [ ] 真机验证: 切换 app_language 后, 卡片 CTA / DueCountText 文案切换 (zh/en/de)

## Stage 5: 验证清单

- [x] vitest run 953/953 PASS (917 v0.1.0 基线 + 36 新增: 17 Stage 2 + 9 Stage 3 + 10 Stage 4)
- [x] tsc --noEmit 0 errors
- [x] vite build 成功 (web dist)
- [x] vite build --mode harmony 成功 (CSP 已注入到 rawfile/dist/index.html)
- [~] oxlint: 2 pre-existing errors in `vite.config.ts` (typescript(no-explicit-any), 与 Stage 5 无关) + 18 warnings (既有未使用变量 / react-hooks, 与 Stage 5 无关); Stage 5 约束禁止修改源代码, 无法在本 Stage 修复
- [x] harmony/oh-package.json5 version === '0.2.0'
- [x] docs/performance-baseline-v0.2.0-harmony.md 性能基线模板创建
- [x] docs/RELEASE_CHECKLIST-v0.2.0-harmony.md 发布清单创建

## 真机验证项汇总 (用户执行)

1. 安装 HAP 到 API 18 真机/模拟器 (DevEco Studio)
2. 验证 ArkWeb IndexedDB 清理后 rehydrate 恢复卡片 (R-D2-3)
3. 验证 CSP 不破坏 LLM Proxy SSE 流式 (R-D4-1)
4. 验证 origin 白名单不误拦截正常 rawfile 加载 (R-D4-2)
5. 验证桌面服务卡片 2*2 / 2*4 布局正确
6. 验证 review 一张卡片后 5 分钟内卡片自动刷新 (R-D3-1)
7. 验证切换 app_language 后卡片文案切换
8. 填写 performance-baseline-v0.2.0-harmony.md 真机实测数据

## 版本号同步

- Web 端: 2.3.0 (保持, 本轮无 Web 业务变更)
- 鸿蒙端: 0.1.0 → 0.2.0 (Stage 1 已同步)
- ArkWeb Chromium: API 12 → API 18 (OpenHarmony 4.1-5.1, M114 内核)

---

**最后更新**: 2026-07-27 v0.2.0-harmony Stage 5 COMPLETE
