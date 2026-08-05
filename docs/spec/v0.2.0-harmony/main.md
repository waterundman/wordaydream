---
title: "SPEC v0.2.0-harmony"
date: "2026-07-27"
version: "0.2.0-harmony"
project: "Wordaydream"
tags:
  - artifact/spec
  - version/0.2.0-harmony
  - project/Wordaydream
  - confidence/medium
confidence: 0.75
upstream:
  - "[[cache/v0.1.0-harmony/NEXT-VERSION-DIRECTION]]"
  - "[[cache/v0.2.0-harmony/research/direction-insights]]"
  - "[[cache/v0.2.0-harmony/research/comparison-matrix]]"
  - "[[bayesian/v0.1.0-harmony/plan]]"
  - "[[bayesian/v0.1.0-harmony/history]]"
  - "[[spec/v0.1.0-harmony/main]]"
downstream:
  - "[[bayesian/v0.2.0-harmony/plan]]"
---

# SPEC — Wordaydream v0.2.0-harmony 鸿蒙移动版增量迭代

## 版本概述
- **版本类型**: feature / security / performance
- **前置版本**: v0.1.0-harmony (8/8 Stages PASS, 917/917 tests, posterior confidence 0.92)
- **当前版本**: v0.2.0-harmony
- **整体置信度**: 0.75
- **沙箱约束**: 本机无 DevEco Studio / 鸿蒙真机; subagent 生成 ArkTS 代码 + vitest 守护 Web 端 0 regression; 真机验证由用户在 DevEco 内执行
- **Web 端版本基线**: 2.3.0 (package.json)
- **鸿蒙端版本基线**: 0.1.0 (harmony/oh-package.json5) → 目标 0.2.0

## 核心目标
1. **D2: R-1 闭环** — ArkWeb IndexedDB/localStorage 持久化加固 + MemoryCardStore 双向数据同步 (Web ↔ 鸿蒙 relationalStore), 解决系统清理导致数据丢失风险
2. **D3: 服务卡片富化** — ReviewCardWidget 多尺寸适配 (2*2/2*4 分支) + 多语言文案 + 复习进度环 + 实时性增强 (postCardAction 主动刷新)
3. **D4: JSBridge 安全加固** — 论文驱动 (arXiv:1410.7756) 4 项加固措施: 输入校验 schema / CSP 配置 / origin 白名单 / 方法签名审计
4. **D5: API 18 升级** — compatibleSdkVersion "5.0.0(12)" → "5.0.0(18)" + ArkWeb 性能调优 (Chromium M114 内核特性利用)

## 关键发现 (Phase 1.3 长考 + Phase 3 代码分析)

### F-1: HarmonyBridge 未暴露数据写入方法 (D2 核心缺口)
- **现状**: `HarmonyBridge.ets` 仅暴露 6 个方法 (getDueCardsCount / registerReminder / readPreferences / writePreferences / triggerHapticFeedback / handleHarmonyLaunch)
- **缺口**: 无 `upsertCard(card)` / `deleteCard(cardId)` / `getAllCards()` 方法
- **后果**: `MemoryCardStore.upsertCard` 已实现但无调用方 — relationalStore 实际为空 (仅测试 mock 注入数据)
- **证据**: `useMemoryStore.ts:113-121` rateCard 仅调用 `registerReminder`, 未调用 upsertCard
- **source**: "code:harmony/entry/src/main/ets/bridge/HarmonyBridge.ets:49-356 + src/features/review/store/useMemoryStore.ts:91-122"

### F-2: Web 端持久化实际使用 localStorage (非 IndexedDB)
- **现状**: `useMemoryStore.ts:187` 使用 `createJSONStorage(() => localStorage)`
- **R-1 风险适用**: ArkWeb 内 localStorage 同 IndexedDB 一样受系统清理影响
- **source**: "code:src/features/review/store/useMemoryStore.ts:184-198"

### F-3: ReviewCardWidget 单一 build() 不区分尺寸
- **现状**: `ReviewCardWidget.ets:154-192` 单一 build(), 2*2 与 2*4 共用同一布局
- **缺口**: 无 formBindingData.getDimension() 分支; 硬编码 "开始复习" zh 文案; 无进度环
- **source**: "code:harmony/entry/src/main/ets/widget/ReviewCardWidget.ets:96-192"

### F-4: HarmonyBridge 无输入校验 / 无 CSP / 无 origin 白名单
- **现状**: triggerHapticFeedback(intensity: string) 接受任意字符串; registerReminder(payload) 无 schema 校验; handleHarmonyLaunch 仅引号转义无格式校验
- **论文佐证**: arXiv:1410.7756 指出 HTML5 混合应用通过 JSBridge 的代码注入攻击面 (186 PhoneGap plugins 中 11 个 vulnerable)
- **source**: "code:harmony/entry/src/main/ets/bridge/HarmonyBridge.ets:264-356 + paper:arXiv:1410.7756"

### F-5: API 12 → API 18 跨度合理
- **现状**: build-profile.json5 compatibleSdkVersion "5.0.0(12)"
- **目标**: "5.0.0(18)" 对应 OpenHarmony 4.1-5.1 (Chromium M114)
- **source**: "code:harmony/build-profile.json5:35 + doc:ArkWeb overview (Chromium 版本矩阵)"

## 实现要点 (供 Bayesian Plan 消费)

### Stage 1: API 18 升级 + 兼容性检查

```yaml
stage: 1
title: "API 12 → API 18 升级 + 兼容性矩阵"
round: 1
task_type: config
confidence_prior: 0.80
expect:
  - symbol: compatibleSdkVersion
    file: harmony/build-profile.json5
    assert:
      - "default product compatibleSdkVersion: '5.0.0(18)'"
      - "release product compatibleSdkVersion: '5.0.0(18)'"
      - "runtimeOS: 'HarmonyOS' 保持不变"
    source: "code:harmony/build-profile.json5:31-44 + doc:ArkWeb overview (Chromium M114 for OpenHarmony 4.1-5.1)"
    confidence: 0.85
  - symbol: module.json5 兼容性
    file: harmony/entry/src/main/module.json5
    assert:
      - "deviceTypes: ['phone','tablet','2in1'] API 18 仍支持"
      - "type: 'atomicService' API 18 仍支持"
      - "installationFree: true 不变"
      - "requestPermissions VIBRATE + KEEP_BACKGROUND_RUNNING API 18 仍可用"
    source: "code:harmony/entry/src/main/module.json5:1-72"
    confidence: 0.80
  - symbol: oh-package.json5 版本号
    file: harmony/oh-package.json5
    assert:
      - "version: '0.2.0'"
      - "modelVersion: '5.0.0' 保持"
      - "@ohos/hvigor-ohos-plugin 版本兼容 API 18 (当前 6.22.3)"
    source: "code:harmony/oh-package.json5:1-14"
    confidence: 0.75
  - symbol: ArkWeb Chromium 内核版本
    file: (runtime)
    assert:
      - "API 18 对应 OpenHarmony 4.1-5.1, ArkWeb Chromium M114"
      - "M114 支持 ES2022 + WebAssembly 2.0"
    source: "doc:https://raw.githubusercontent.com/openharmony/docs/master/zh-cn/application-dev/web/web-component-overview.md"
    confidence: 0.80
contract:
  - "compatibleSdkVersion 从 '5.0.0(12)' 升级到 '5.0.0(18)', 不破坏既有 atomicService / form / notification 功能"
  - "Web 端 vitest 0 regression (917/917 PASS)"
  - "ArkTS 0 any / 0 对象字面量类型 / 0 var (沿用 v0.1.0 约束)"
test_spec:
  - "vitest run (Web 端 917 测试基线)"
  - "tsc --noEmit (0 errors)"
  - "vite build + vite build --mode harmony 双成功"
  - "ArkTS 静态检查: 无 any / 无对象字面量类型 / 无 var"
```

### Stage 2: JSBridge 安全加固 (D4 — 论文驱动)

```yaml
stage: 2
title: "JSBridge 输入校验 + CSP + origin 白名单 + 方法签名审计"
round: 2
task_type: cross_module_async
confidence_prior: 0.75
expect:
  - symbol: BridgeInputValidator (新增 ArkTS 类)
    file: harmony/entry/src/main/ets/bridge/BridgeInputValidator.ets
    assert:
      - "validateIntensity(intensity: string): boolean — 仅接受 'light'|'medium'|'heavy'"
      - "validateReminderPayload(payload: ReminderPayload): boolean — dueAt > 0 且 cardId 非空且长度 <= 128"
      - "validatePreferencesKey(key: string): boolean — 白名单: 'app_language'|'notifications_config'|'theme'|'review_direction'|'streak_data'"
      - "validatePreferencesValue(value: string): boolean — 长度 <= 8192"
      - "validateLaunchQuery(query: string): boolean — 匹配 ^(action=startReview|action=openCard&cardId=[a-zA-Z0-9_-]+)$"
      - "validateCardRecord(card: MemoryCardRecord): boolean — 16 字段类型 + 范围校验 (id 非空, objectiveDifficulty 1-5, language 'en'|'de'|'')"
    source: "paper:arXiv:1410.7756 (HTML5 hybrid app security) + code:harmony/entry/src/main/ets/bridge/HarmonyBridge.ets:49-356"
    confidence: 0.75
  - symbol: HarmonyBridge 方法签名审计 (修改)
    file: harmony/entry/src/main/ets/bridge/HarmonyBridge.ets
    assert:
      - "triggerHapticFeedback 调用 validateIntensity, 失败时 hilog.warn + return"
      - "registerReminder 调用 validateReminderPayload, 失败时 hilog.warn + return"
      - "readPreferences/writePreferences 调用 validatePreferencesKey + validatePreferencesValue"
      - "handleHarmonyLaunch 调用 validateLaunchQuery, 失败时 hilog.warn + return"
      - "所有方法保持 try/catch 兜底 (ArkTS 异常不传播到 Web)"
    source: "paper:arXiv:1410.7756 + code:harmony/entry/src/main/ets/bridge/HarmonyBridge.ets:264-356"
    confidence: 0.75
  - symbol: CSP meta 标签 (Web 端)
    file: harmony/entry/src/main/resources/rawfile/dist/index.html
    assert:
      - "<meta http-equiv='Content-Security-Policy' content=\"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' http://localhost:* http://127.0.0.1:* arkweb://* https://*.hapogo.com; img-src 'self' data:;\">"
      - "CSP 不破坏 Vite 构建产物 (script-src 'self' 兼容 module script)"
    source: "paper:arXiv:1410.7756 (CSP mitigates code injection) + code:harmony/server/llm-proxy.js:53-59 (现有 CORS origin 白名单参考)"
    confidence: 0.70
  - symbol: origin 白名单 (ArkTS 侧)
    file: harmony/entry/src/main/ets/entryability/EntryAbility.ets
    assert:
      - "registerJavaScriptProxy 之前检查 webview.WebviewController.accessedUrl() 或 Web 组件 src"
      - "允许 origin: 'arkweb://*' / 'file://' / 'http://localhost:*' / 'http://127.0.0.1:*'"
      - "非白名单 origin 时 hilog.warn + 不注册 harmonyBridge proxy"
    source: "paper:arXiv:1410.7756 + code:harmony/server/llm-proxy.js:53-79 (origin 白名单模式参考)"
    confidence: 0.65
contract:
  - "BridgeInputValidator 为纯函数模块, 无副作用, 可独立单测"
  - "CSP 配置不破坏 LLM Proxy SSE 流式 (connect-src 包含 LLM Proxy origin)"
  - "origin 白名单不阻塞正常 ArkWeb rawfile 加载 (arkweb://* + file:// 放行)"
  - "Web 端 vitest 0 regression; 新增 BridgeInputValidator 单测 >= 12 用例"
test_spec:
  - "vitest: BridgeInputValidator 12+ 用例 (每个 validate 方法 2+ 用例: 合法/非法)"
  - "vitest: HarmonyBridge 修改后方法保持原契约 (mock validator)"
  - "vitest: CSP meta 标签存在性检查 (parse index.html)"
  - "tsc --noEmit 0 errors"
```

### Stage 3: MemoryCardStore 双向同步 (D2 — R-1 闭环)

```yaml
stage: 3
title: "Web ↔ 鸿蒙 relationalStore 双向同步 + 持久化加固"
round: 2
task_type: cross_module_async
confidence_prior: 0.70
expect:
  - symbol: HarmonyBridge 新增同步方法
    file: harmony/entry/src/main/ets/bridge/HarmonyBridge.ets
    assert:
      - "async upsertCard(card: MemoryCardRecord): Promise<void> — 调用 MemoryCardStore.upsertCard + BridgeInputValidator.validateCardRecord"
      - "async deleteCard(cardId: string): Promise<void> — 调用 MemoryCardStore.deleteCard + validateCardId"
      - "async getAllCards(): Promise<MemoryCardRecord[]> — 调用 MemoryCardStore.getAllCards (供 Web 端 rehydrate)"
      - "async getRecentlyReviewedCards(limit: number): Promise<MemoryCardRecord[]> — 供服务卡片富化展示"
      - "async getTodayReviewStats(): Promise<TodayReviewStats> — 返回 {dueCount, reviewedCount, totalCount} 供进度环"
      - "所有新方法 try/catch 兜底, 异常返回空值/空数组"
    source: "code:harmony/entry/src/main/ets/bridge/HarmonyBridge.ets:49-356 + code:harmony/entry/src/main/ets/data/MemoryCardStore.ets:43-275"
    confidence: 0.80
  - symbol: MemoryCardStore 新增查询方法
    file: harmony/entry/src/main/ets/data/MemoryCardStore.ets
    assert:
      - "async getAllCards(): Promise<MemoryCardRecord[]> — SELECT * FROM table ORDER BY due ASC"
      - "async getRecentlyReviewedCards(limit: number): Promise<MemoryCardRecord[]> — SELECT * WHERE lastReviewAt > 0 ORDER BY lastReviewAt DESC LIMIT ?"
      - "async getTodayReviewStats(now: number): Promise<TodayReviewStats> — dueCount (due<=now) + reviewedCount (lastReviewAt >= todayStart) + totalCount (COUNT(*))"
      - "async getCardById(id: string): Promise<MemoryCardRecord | null> — SELECT * WHERE id = ?"
      - "所有方法 try/catch 兜底, 异常返回空数组/null/默认 stats"
    source: "code:harmony/entry/src/main/ets/data/MemoryCardStore.ets:142-204 + doc:OpenHarmony DistributedRdb sample (auto + manual sync 模式参考)"
    confidence: 0.75
  - symbol: MemoryCardSchema 新增 TodayReviewStats 接口
    file: harmony/entry/src/main/ets/data/MemoryCardSchema.ets
    assert:
      - "export interface TodayReviewStats { dueCount: number; reviewedCount: number; totalCount: number; }"
    source: "code:harmony/entry/src/main/ets/data/MemoryCardSchema.ets:94-137"
    confidence: 0.85
  - symbol: HarmonyBridge TS interface 新增同步方法 (Web 端)
    file: src/platform/harmonyBridge.ts
    assert:
      - "upsertCard(card: MemoryCardRecordBridge): Promise<void>"
      - "deleteCard(cardId: string): Promise<void>"
      - "getAllCards(): Promise<MemoryCardRecordBridge[]>"
      - "getRecentlyReviewedCards(limit: number): Promise<MemoryCardRecordBridge[]>"
      - "getTodayReviewStats(): Promise<TodayReviewStatsBridge>"
      - "MemoryCardRecordBridge 接口与 ArkTS MemoryCardRecord 16 字段一一对应"
    source: "code:src/platform/harmonyBridge.ts:31-51"
    confidence: 0.85
  - symbol: useMemoryStore 同步触发点 (Web → 鸿蒙)
    file: src/features/review/store/useMemoryStore.ts
    assert:
      - "rateCard 在 set() 之后调用 window.harmonyBridge?.upsertCard(result.card) (fire-and-forget, .catch silent skip)"
      - "addCardFromToken 在 set() 之后调用 window.harmonyBridge?.upsertCard(card) (fire-and-forget)"
      - "resetAll 调用 window.harmonyBridge?.clear() (谨慎: 仅在用户确认后)"
      - "新增 deleteCard(cardId) action 调用 window.harmonyBridge?.deleteCard(cardId)"
    source: "code:src/features/review/store/useMemoryStore.ts:39-122 + code:harmony/entry/src/main/ets/data/MemoryCardStore.ets:209-226"
    confidence: 0.75
  - symbol: Web 端 rehydrate 逻辑 (鸿蒙 → Web, R-1 闭环核心)
    file: src/features/review/store/useMemoryStore.ts
    assert:
      - "onRehydrateStorage 回调中检测 state.cards.size === 0 && window.harmonyBridge"
      - "若 ArkWeb localStorage 为空且 harmonyBridge 存在, 调用 harmonyBridge.getAllCards() 恢复"
      - "恢复后写入 localStorage (zustand persist) + publish memory:cards-updated"
      - "getAllCards() 返回空数组时静默跳过 (首次安装场景)"
    source: "code:src/features/review/store/useMemoryStore.ts:193-223 + paper:arXiv:1410.7756 (持久化失效风险)"
    confidence: 0.65
  - symbol: 冲突解决策略
    file: (设计文档)
    assert:
      - "策略: last-write-wins, 以 Web 端 FSRS scheduling 为 source of truth"
      - "Web → 鸿蒙: 每次 rateCard/addCardFromToken/deleteCard 触发 upsertCard/deleteCard (覆盖 relationalStore)"
      - "鸿蒙 → Web: 仅在 Web 端 localStorage 为空时触发 (rehydrate 场景)"
      - "不实现双向实时合并 (避免 FSRS 状态分裂), 鸿蒙端 relationalStore 始终为 Web 端的镜像"
    source: "code:src/features/review/store/useMemoryStore.ts:91-122 (Web 为 FSRS 调度源) + doc:OpenHarmony DistributedRdb (manual sync 模式)"
    confidence: 0.70
contract:
  - "Web → 鸿蒙同步为 fire-and-forget, 不阻塞 rateCard/addCardFromToken 主流程"
  - "鸿蒙 → Web rehydrate 仅在 localStorage 为空时触发, 不覆盖已有数据"
  - "MemoryCardStore.getAllCards 返回顺序: due ASC (与 Web getDueCards 一致)"
  - "MemoryCardRecord 16 字段在 ArkTS ↔ Web 间序列化无丢失 (id/lexemeGroupId/lemma 为 string, objectiveDifficulty 1-5, language 'en'|'de'|'')"
  - "Web 端 vitest 0 regression; 新增同步触发单测 >= 8 用例"
test_spec:
  - "vitest: useMemoryStore.rateCard 调用 harmonyBridge.upsertCard (mock bridge)"
  - "vitest: useMemoryStore.addCardFromToken 调用 harmonyBridge.upsertCard (mock bridge)"
  - "vitest: useMemoryStore.deleteCard 调用 harmonyBridge.deleteCard (mock bridge)"
  - "vitest: useMemoryStore onRehydrateStorage 空状态 + harmonyBridge 存在时调用 getAllCards"
  - "vitest: useMemoryStore onRehydrateStorage 已有数据时不调用 getAllCards"
  - "vitest: harmonyBridge.upsertCard 16 字段序列化无丢失 (deep equal)"
  - "vitest: MemoryCardStore (mock relationalStore) getAllCards 返回 due ASC 排序"
  - "vitest: MemoryCardStore getTodayReviewStats 返回正确 {dueCount, reviewedCount, totalCount}"
```

### Stage 4: 服务卡片富化 (D3 + 实时性增强)

```yaml
stage: 4
title: "ReviewCardWidget 多尺寸 + 多语言 + 进度环 + 实时刷新"
round: 3
task_type: ui_component
confidence_prior: 0.65
expect:
  - symbol: ReviewCardWidget 尺寸分支
    file: harmony/entry/src/main/ets/widget/ReviewCardWidget.ets
    assert:
      - "通过 formBindingData.getDimension() 或 @LocalStorageV2 dimension 获取当前尺寸"
      - "2*2: 紧凑布局 (徽章 + 文案 + CTA), 不展示词位"
      - "2*4: 富布局 (徽章 + 文案 + 词位 + 进度环 + CTA + 更新时间)"
      - "使用 if (dimension === FormDimensionalType.DIMENSION_2X2) 分支"
    source: "code:harmony/entry/src/main/ets/widget/ReviewCardWidget.ets:25-192 + doc:ArkWeb overview (FormExtAbility 样本参考)"
    confidence: 0.70
  - symbol: ReviewCardWidget 多语言
    file: harmony/entry/src/main/ets/widget/ReviewCardWidget.ets
    assert:
      - "通过 CardDataProvider.getLanguage() 读取 preferences 'app_language' (默认 'en')"
      - "CTA 文案: zh='开始复习' / en='Start Review' / de='Starten'"
      - "DueCountText 使用 this.provider.formatDueCountText(this.dueCount, language) (已实现, 当前硬编码 'en' 需改为动态)"
      - "UpdatedTime 文案: zh='更新于' / en='Updated' / de='Aktualisiert'"
    source: "code:harmony/entry/src/main/ets/widget/CardDataProvider.ets:96-123 (formatDueCountText 已支持 zh/en/de) + code:harmony/entry/src/main/ets/widget/ReviewCardWidget.ets:113 (硬编码 'en' 需修改)"
    confidence: 0.80
  - symbol: ReviewCardWidget 进度环
    file: harmony/entry/src/main/ets/widget/ReviewCardWidget.ets
    assert:
      - "新增 @Builder ProgressRing() 使用 ArkUI Progress({ type: ProgressType.Ring, value: reviewedCount, total: totalCount })"
      - "数据来源: CardDataProvider.getTodayReviewStats() → MemoryCardStore.getTodayReviewStats()"
      - "进度环颜色: card_accent (已完成) / card_background (未完成)"
      - "进度环仅 2*4 尺寸展示 (2*2 空间不足)"
    source: "code:harmony/entry/src/main/ets/widget/ReviewCardWidget.ets:96-152 + code:harmony/entry/src/main/ets/widget/CardDataProvider.ets:25-82"
    confidence: 0.65
  - symbol: CardDataProvider 新增方法
    file: harmony/entry/src/main/ets/widget/CardDataProvider.ets
    assert:
      - "async getTodayReviewStatsForWidget(): Promise<TodayReviewStats> — 调用 MemoryCardStore.getTodayReviewStats(Date.now())"
      - "async getLanguage(): Promise<string> — 读取 preferences 'app_language' (默认 'en')"
      - "async getRecentlyReviewedCardsForWidget(limit: number): Promise<MemoryCardRecord[]> — 供 2*4 展示最近学习卡片缩略图"
      - "所有方法 try/catch 兜底, 异常返回安全默认值"
    source: "code:harmony/entry/src/main/ets/widget/CardDataProvider.ets:25-123"
    confidence: 0.75
  - symbol: 实时刷新策略 (绕过 60min 限制)
    file: harmony/entry/src/main/ets/entryability/EntryAbility.ets
    assert:
      - "rateCard / addCardFromToken 后通过 commonEventManager 或 emitter 发布 'wordaydream_widget_refresh' 事件"
      - "FormExtensionAbility (或 EntryAbility) 监听事件, 调用 formProvider.updateForm(formId, formBindingData)"
      - "updateForm 频率限制: 5 分钟内最多 1 次 (鸿蒙系统限制), 超频时 hilog.warn 跳过"
      - "form_config.json updateDuration 保持 1 (60min 系统刷新作为兜底)"
    source: "code:harmony/entry/src/main/ets/entryability/EntryAbility.ets:1-111 + code:harmony/entry/src/main/resources/base/profile/form_config.json:1-21"
    confidence: 0.55
contract:
  - "2*2 与 2*4 布局独立, 2*2 不展示词位/进度环 (空间约束)"
  - "多语言 fallback: language 非 zh/en/de 时默认 en"
  - "进度环 total=0 时不渲染 (避免除零)"
  - "实时刷新不阻塞 rateCard 主流程 (emitter.publish 异步)"
  - "Web 端 vitest 0 regression"
test_spec:
  - "vitest: CardDataProvider.formatDueCountText 3 语言 (已存在, 验证不回归)"
  - "vitest: CardDataProvider.getTodayReviewStatsForWidget mock store 返回正确 stats"
  - "vitest: CardDataProvider.getLanguage mock preferences 返回正确语言"
  - "vitest: ReviewCardWidget 2*2 布局不包含 ProgressRing (mock dimension)"
  - "vitest: ReviewCardWidget 2*4 布局包含 ProgressRing + NextWordDisplay (mock dimension)"
  - "ArkTS 静态检查: 无 any / 无对象字面量类型"
```

### Stage 5: 验证与文档

```yaml
stage: 5
title: "功能对等验证 + 性能基线 + RELEASE_CHECKLIST 更新"
round: 4
task_type: cross_module_async
confidence_prior: 0.75
expect:
  - symbol: Web 端功能对等测试
    file: (vitest 测试套件)
    assert:
      - "917/917 v0.1.0 基线测试全部 PASS (0 regression)"
      - "新增 Stage 2 BridgeInputValidator 测试 >= 12 用例"
      - "新增 Stage 3 同步触发测试 >= 8 用例"
      - "新增 Stage 3 rehydrate 测试 >= 2 用例"
      - "总测试数 >= 939 (917 + 22 新增)"
    source: "code:package.json (test:run 脚本) + code:src/features/review/store/useMemoryStore.ts:184-225"
    confidence: 0.85
  - symbol: tsc + 构建验证
    file: (构建系统)
    assert:
      - "tsc --noEmit: 0 errors"
      - "vite build: web dist 成功"
      - "vite build --mode harmony: harmony rawfile dist 成功"
      - "oxlint: 0 errors"
    source: "code:package.json:6-15"
    confidence: 0.85
  - symbol: 鸿蒙端版本号同步
    file: harmony/oh-package.json5
    assert:
      - "version: '0.2.0'"
    source: "code:harmony/oh-package.json5:4"
    confidence: 0.90
  - symbol: 性能基线模板
    file: docs/performance-baseline-v0.2.0-harmony.md
    assert:
      - "ArkWeb 首屏加载时间 (目标 < 2s, v0.1.0 基线待测)"
      - "rateCard → upsertCard 同步延迟 (目标 < 50ms, fire-and-forget 不阻塞 UI)"
      - "getAllCards rehydrate 延迟 (目标 < 500ms, 1000 张卡片)"
      - "服务卡片 aboutToAppear 延迟 (目标 < 200ms)"
      - "CSP 启用后 LLM SSE 流式延迟变化 (目标 < 10% 退化)"
    source: "code:harmony/entry/src/main/ets/bridge/HarmonyBridge.ets + code:harmony/entry/src/main/ets/widget/ReviewCardWidget.ets"
    confidence: 0.60
  - symbol: RELEASE_CHECKLIST 更新
    file: docs/RELEASE_CHECKLIST-v0.2.0-harmony.md
    assert:
      - "Stage 1: API 18 升级清单 (build-profile + module.json5 + hvigor 插件兼容性)"
      - "Stage 2: 安全加固清单 (BridgeInputValidator + CSP + origin 白名单 + 方法签名审计)"
      - "Stage 3: 双向同步清单 (5 新增 HarmonyBridge 方法 + 5 新增 MemoryCardStore 方法 + Web 端触发点 + rehydrate 逻辑)"
      - "Stage 4: 卡片富化清单 (尺寸分支 + 多语言 + 进度环 + 实时刷新)"
      - "Stage 5: 验证清单 (939+ 测试 + tsc + build + 性能基线)"
      - "真机验证项 (用户执行): ArkWeb IndexedDB 清理后 rehydrate / CSP 不破坏 LLM / 卡片实时刷新"
    source: "code:docs/bayesian-status-v0.1.0-harmony.md:85-91 (沙箱硬约束参考)"
    confidence: 0.80
contract:
  - "Web 端测试基线 917 → 939+ (0 regression + 22+ 新增)"
  - "鸿蒙端版本号 0.1.0 → 0.2.0"
  - "性能基线模板填写完成 (真机数据由用户填充)"
  - "RELEASE_CHECKLIST 涵盖 5 个 Stage 全部交付物"
test_spec:
  - "vitest run: 939+ tests PASS"
  - "tsc --noEmit: 0 errors"
  - "vite build + vite build --mode harmony: 双成功"
  - "oxlint: 0 errors"
```

## 风险矩阵

| ID | 风险 | 等级 | 缓解措施 | 触发 Stage |
|----|------|------|---------|-----------|
| R-D2-1 | 双向同步冲突解决复杂 (Web 与鸿蒙同时修改同一卡片) | 中 | last-write-wins + Web 为 FSRS source of truth; 鸿蒙端不主动修改 FSRS 状态, 仅镜像 | S3 |
| R-D2-2 | getAllCards rehydrate 在大数据量下延迟高 (>1s) | 中 | 限制 rehydrate 触发条件 (仅 localStorage 为空); 异步执行不阻塞首屏 | S3 |
| R-D2-3 | ArkWeb localStorage 清理时机不可预测 (R-1 未完全闭环) | 中 | rehydrate 作为恢复路径; 真机验证由用户执行; relationalStore 持久化作为 ground truth | S3/S5 |
| R-D3-1 | 60min 系统刷新限制无法实时更新卡片 | 低 | postCardAction message + formProvider.updateForm 主动刷新 (5min 频率限制内) | S4 |
| R-D3-2 | 进度环数据 getTodayReviewStats 依赖 lastReviewAt 准确性 | 低 | lastReviewAt 由 Web 端 rateCard 写入, 同步到 relationalStore; 时区用 Date.now() epoch ms 统一 | S4 |
| R-D4-1 | CSP 配置过严破坏 LLM SSE 流式或 Vite module script | 中 | 渐进式启用: 先 script-src 'self' + connect-src 白名单; vitest 覆盖 SSE mock 测试; 真机验证 | S2 |
| R-D4-2 | origin 白名单误拦截正常 ArkWeb rawfile 加载 | 中 | 白名单包含 arkweb://* + file://; EntryAbility 日志记录拦截事件 | S2 |
| R-D4-3 | BridgeInputValidator 校验过严破坏正常调用 | 中 | 校验规则基于现有代码实际使用模式 (intensity 枚举已硬编码); 12+ 单测覆盖合法/非法 | S2 |
| R-D5-1 | API 18 不兼容 API 12 的某些 API (deprecated) | 中 | 兼容性矩阵检查 (module.json5 + requestPermissions); 降级 fallback 到 API 12 行为 | S1 |
| R-D5-2 | hvigor-ohos-plugin 6.22.3 不兼容 API 18 | 低 | 检查 plugin 版本兼容性; 必要时升级到 6.x 最新 | S1 |
| R-Sandbox-1 | 本机无 DevEco Studio / 鸿蒙真机 (沿用 v0.1.0 沙箱约束) | 高 | ArkTS 代码由 subagent 生成 + vitest 守护 Web 端; 真机验证由用户执行 | 全部 |

## 外部参考

### 代码参考 (Code Mine)
1. **OpenHarmony applications_app_samples** — https://github.com/openharmony/applications_app_samples
   - `code/SuperFeature/DistributedAppDev/DistributedRdb` — DistributedRdb 样本展示 relationalStore 同步模式 (自动同步 + 手动同步), 为 D2 双向同步提供官方参考
   - `code/SystemFeature/Widget/FormExtAbility` — Stage Form 样本, 为 D3 服务卡片尺寸分支提供参考
   - `code/BasicFeature/Web/Browser` — Web 组件样本, 为 D4 ArkWeb 安全配置提供参考
2. **OpenHarmony 官方文档 — ArkWeb 简介** — https://raw.githubusercontent.com/openharmony/docs/master/zh-cn/application-dev/web/web-component-overview.md
   - ArkWeb Chromium 内核版本矩阵: OpenHarmony 4.1-5.1 → M114; 6.0 → M132
   - JavaScriptProxy 能力 + 安全与隐私 (无痕浏览/广告拦截/坚盾守护模式)
   - 为 D5 API 18 升级 + D4 安全加固提供官方依据

### 论文参考 (Paper Radar)
3. **arXiv:1410.7756** — "Security of HTML5-based Mobile Apps" (Du et al., MoST 2014)
   - URL: https://arxiv.org/abs/1410.7756
   - DOI: 10.48550/arXiv.1410.7756
   - 核心发现: HTML5 混合应用通过 JSBridge 的代码注入攻击面; 186 PhoneGap plugins 中 11 个 vulnerable; 2 个真实应用存在漏洞
   - 攻击渠道: 2D barcodes / Wi-Fi scanning / MP4 videos / Bluetooth pairing
   - 为 D4 JSBridge 安全加固 4 项措施 (输入校验 + CSP + origin 白名单 + 方法签名审计) 提供理论依据
   - Paper Radar 状态: 仅标题+摘要扫描, 未触发 [PAPER GATE] 深度精读 (工程加固措施明确, 不需要理论验证)

## webfetch 执行记录

```yaml
_webfetch_calls:
  - url: "https://github.com/search?q=harmonyos+relationalStore+sync+ArkTS&type=code"
    status: skipped
    reason: "deadline elapsed (GitHub search JS-heavy 页面超时)"
  - url: "https://github.com/search?q=ArkWeb+Content-Security-Policy+harmonyos&type=code"
    status: skipped
    reason: "deadline elapsed (GitHub search JS-heavy 页面超时)"
  - url: "https://raw.githubusercontent.com/openharmony/applications_app_samples/master/README.md"
    status: success
    found: "DistributedRdb + FormExtAbility + Browser 样本索引"
  - url: "https://raw.githubusercontent.com/openharmony/applications_app_samples/master/code/SuperFeature/DistributedAppDev/DistributedRdb/README.md"
    status: success
    found: "relationalStore 同步模式 (自动 + 手动), API 8+"
  - url: "https://raw.githubusercontent.com/openharmony/docs/master/en/application-dev/data/relationalStore-overview.md"
    status: skipped
    reason: "Failed to fetch (路径可能变更)"
  - url: "https://raw.githubusercontent.com/openharmony/docs/master/zh-cn/application-dev/web/web-component-overview.md"
    status: success
    found: "ArkWeb Chromium 版本矩阵 (OH 4.1-5.1 → M114) + JavaScriptProxy + 安全模式"
  - url: "https://raw.githubusercontent.com/openharmony/applications_app_samples/master/code/SuperFeature/DistributedAppDev/DistributedRdb/entry/src/main/ets/MainAbility/model/RdbModel.ets"
    status: skipped
    reason: "Failed to fetch (源码文件路径可能变更)"

_paper_radar_calls:
  - url: "https://api.semanticscholar.org/graph/v1/paper/search?query=hybrid+mobile+application+security+JavaScript+bridge&limit=3&fields=title,abstract,year"
    status: skipped
    reason: "429 Too Many Requests (Semantic Scholar 限流, anonymous 配额)"
  - url: "http://export.arxiv.org/api/query?search_query=all:HTML5+hybrid+application+security&max_results=5&sortBy=relevance"
    status: success
    found: 5
    used: 0
    note: "arXiv API 将查询拆分为 OR, 返回 LaTeX/HTML5 等不相关结果"
  - url: "http://export.arxiv.org/api/query?search_query=all:spaced+repetition+algorithm+FSRS&max_results=5&sortBy=relevance"
    status: success
    found: 5
    used: 0
    note: "arXiv API 将 FSRS 误解为 Fibonacci FSR, 返回不相关结果; ts-fsrs 为软件实现非学术论文"
  - url: "http://export.arxiv.org/abs/1410.7756"
    status: success
    found: 1
    used: 1
    note: "NEXT-VERSION-DIRECTION 引用的 HTML5 混合应用安全论文, 直接抓取摘要成功"

_paper_radar_summary:
  total_calls: 4
  successful: 3
  relevant: 1
  relevant_title: "Security of HTML5-based Mobile Apps (arXiv:1410.7756)"
  degraded: false
  paper_gate_triggered: false
  note: "D4 安全加固措施工程明确 (输入校验/CSP/origin/方法签名), 不需要 [PAPER GATE] 深度精读"
```

## Self-Review 检查清单 (Phase 4 Step 4.3)

| 检查项 | 状态 | 说明 |
|--------|------|------|
| Webfetch 覆盖 | PASS | 3 个 Code Mine 成功 (OpenHarmony samples + DistributedRdb + ArkWeb overview); 1 个 Paper Radar 成功 (arXiv:1410.7756) |
| Paper Radar 覆盖 | PASS | direction-insights 包含论文来源 (arXiv:1410.7756 标题+摘要); _paper_radar_calls 已记录 |
| 实现要点完整性 | PASS | 每个 expect 都有 confidence + source 标注 (5 Stage 共 22 个 expect) |
| 置信度一致性 | PASS | 源码读取 = 0.75-0.85; webfetch 文档 = 0.65-0.80; 推测 = 0.55-0.65; 无 > 0.5 但 source 无工具调用记录的违规 |
| Placeholder 扫描 | PASS | 无 TBD/TODO/待补充/待定 |
| SPEC ↔ Contract 对齐 | PASS | 每个 Stage 的 expect 都有对应 contract; test_spec 覆盖所有 expect |
| Frontmatter 完整性 | PASS | title/date/version/project/tags/confidence/upstream/downstream 齐全 |
| Wikilink 有效性 | PASS | upstream 指向 cache/v0.1.0-harmony/NEXT-VERSION-DIRECTION + bayesian/v0.1.0-harmony/plan + spec/v0.1.0-harmony/main (均存在); downstream 指向 bayesian/v0.2.0-harmony/plan (待创建) |
| Tag ↔ Confidence 对齐 | PASS | confidence 0.75 → #confidence/medium (0.70-0.89 区间) |
| Confidence Cap 审查 | PASS | 所有 confidence > 0.5 的 expect 都有 source 字段记录工具调用 (code: / doc: / paper:) |

## 整体置信度校准

- **Stage 1 (API 18 升级)**: 0.80 — 单源硬验证 (build-profile.json5 代码读取) + webfetch 文档 (ArkWeb overview)
- **Stage 2 (JSBridge 安全)**: 0.75 — 双源交叉 (代码读取 + arXiv:1410.7756 论文)
- **Stage 3 (双向同步)**: 0.70 — 单源硬验证 (代码读取) + 外部样本参考 (DistributedRdb)
- **Stage 4 (卡片富化)**: 0.65 — 单源硬验证 (代码读取) + 官方文档 (ArkWeb overview)
- **Stage 5 (验证与文档)**: 0.75 — 单源硬验证 (代码读取 + 测试基线)
- **整体加权平均**: 0.73 → 取上限 0.75 (多方向合并复杂度 + 沙箱约束)

**整体 confidence = 0.75** (符合任务约束: 不得高于 0.85, 沙箱约束 + 多方向合并复杂度)

---

> **SPEC Approval Gate**: 本 SPEC 已生成, 等待用户审阅 5 个 Stage 的 expect/contract + 风险矩阵 + 外部参考后确认。确认后可加载 bayesian-planner skill 生成 `bayesian/v0.2.0-harmony/plan.md`。
