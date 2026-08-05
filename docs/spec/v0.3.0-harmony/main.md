---
title: "SPEC v0.3.0-harmony (local mirror)"
date: "2026-07-27"
version: "0.3.0-harmony"
project: "Wordaydream"
tags:
  - artifact/spec
  - version/0.3.0-harmony
  - project/Wordaydream
  - platform/harmonyos
  - confidence/medium
  - mirror/local
confidence: 0.72
vault_canonical: "D:\\obsidian分2\\ai引用库\\项目概况\\Wordaydream\\spec\\v0.3.0-harmony\\main.md"
---

# SPEC — Wordaydream v0.3.0-harmony (local mirror)

> [!important] 本地镜像
> 本文件为 Vault canonical 文件的本地镜像，用于 subagent 读取。canonical 文件位于:
> `D:\obsidian分2\ai引用库\项目概况\Wordaydream\spec\v0.3.0-harmony\main.md`
>
> 修改时应同步更新两个文件。

## 概述

v0.3.0-harmony 是 Wordaydream 鸿蒙移动版的第 3 次迭代，基于 v0.2.0-harmony（5/5 PASS, 953/953 tests, posterior 0.85）的工程基线。本版本聚焦 2 个 P1 方向:

- **D1 TTS 语音合成**（confidence 0.70）: 通过 @ohos.textToSpeech Kit 实现鸿蒙原生 TTS 路径，配合 Web SpeechSynthesis 作为 fallback，恢复鸿蒙端朗读功能（v0.2.0-harmony 因 ArkWeb speechSynthesis 不可靠已禁用）
- **D3 ArkWeb 性能优化**（confidence 0.75）: 通过 Vite manualChunks + Brotli 压缩 + IndexedDB 索引优化，将 rawfile/dist 体积从 < 2MB 降至 < 1.5MB，Lighthouse 分数从基线提升 20+

### 决策依据

| 决策 | 来源 | confidence |
|------|------|-----------|
| 跳过 D5 真机验证（用户并行执行）| NEXT-VERSION-DIRECTION.md 决策点 1 | 0.90 |
| D2 离线 LLM 延后 v0.4.0+ | NEXT-VERSION-DIRECTION.md 决策点 2 | 0.85 |
| D4 多设备适配延后（无 tablet 真机）| NEXT-VERSION-DIRECTION.md + comparison-matrix | 0.65 |
| 选定 @ohos.textToSpeech Kit 而非 AudioManager | direction-insights.md D1 灵感来源 1 | 0.85 |
| 选定 vite-plugin-compression 而非 compression2 | comparison-matrix.md D3 关键差异 1 | 0.80 |

### 沙箱约束（沿用 v0.2.0-harmony）

- **本机无 DevEco Studio / 鸿蒙真机**: ArkTS 代码由 subagent 生成 + vitest 守护 Web 端 0 regression；真机验证由用户在 DevEco 内执行
- **TTS 引擎能力未验证**: @ohos.textToSpeech Kit 在 API 18 的离线引擎能力 + 德语 de-DE 支持需真机验证
- **Brotli 兼容性未验证**: ArkWeb Chromium M114 的 Brotli 解码支持需真机验证（理论支持，未实测）
- **IndexedDB 索引迁移**: DB_VERSION 1 → 2 升级需在 fake-indexeddb 测试环境验证迁移逻辑

## Stage 拆分汇总

| Stage | 标题 | task_type | test_applicable | tdd_state | 依赖 | 估计 prior |
|-------|------|-----------|----------------|-----------|------|------------|
| 1 | D1 鸿蒙 TTS 引擎 + HarmonyBridge 扩展 | algorithm + cross_module_async | true | RED | - | 0.65 |
| 2 | D1 Web SpeechSynthesis 双路径 + ReadingSessionPage 改造 | ui_component + third_party_api | true | RED | S1 | 0.60 |
| 3 | D3 Vite manualChunks + Brotli 压缩 | config | false | N/A | - | 0.75 |
| 4 | D3 IndexedDB 索引优化 + 鸿蒙 relationalStore 索引 | algorithm | true | RED | - | 0.75 |
| 5 | 验证 + 文档 + Vault 同步 | config | true | RED | S1-S4 | 0.80 |

**整体先验置信度**: 0.71（5 Stage prior 加权平均）
**沙箱上限约束**: posterior ≤ 0.85（沿用 v0.2.0-harmony 沙箱上限约束，不允许超过 v0.1.0-harmony 0.92）

## Stage 1: D1 鸿蒙 TTS 引擎 + HarmonyBridge 扩展

### 期望（expect）

- `class TextToSpeechService` (harmony/entry/src/main/ets/tts/TextToSpeechService.ets, 新建)
  - 单例模式: getInstance() 静态方法返回同一实例
  - createEngine(): Promise<void> 异步初始化引擎
  - speak(payload: SpeakPayload): Promise<void> 命令型异步 speak
  - stop(): void 立即返回 stop
  - shutdown(): void 销毁引擎 + 释放资源
  - speakListener 与 stopListener 分离避免回调混淆
  - confidence: 0.65 (单源硬验证: 新建代码 + CSDN 博客参考)

- `interface SpeakPayload` (新建)
  - text: string 必填，长度上限 4096 由 validateSpeechText 守卫
  - language: 'de-DE' | 'en-US' 枚举，由 validateSpeechLanguage 守卫
  - rate: 0.5 | 1.0 | 1.5 | 2.0 四档枚举，由 validateSpeechRate 守卫
  - voiceId?: string 可选，多引擎选择
  - confidence: 0.65 (CSDN TextToSpeechPlugin + 本地推断)

- `HarmonyBridge.speak` (扩展)
  - 调用 BridgeInputValidator.validateSpeechText(payload.text) 前置校验
  - 调用 BridgeInputValidator.validateSpeechLanguage(payload.language) 前置校验
  - 调用 BridgeInputValidator.validateSpeechRate(payload.rate) 前置校验
  - 调用 TextToSpeechService.getInstance().speak(payload)
  - try/catch 兜底，异常 hilog.warn + return（不抛到 Web）
  - fire-and-forget 模式（沿用 v0.2.0 HarmonyBridge 契约）
  - confidence: 0.75 (沿用 v0.2.0 HarmonyBridge 模式)

- `HarmonyBridge.stopSpeech` (扩展)
  - 调用 TextToSpeechService.getInstance().stop()
  - try/catch 兜底，异常 hilog.warn + return
  - confidence: 0.75

- `HarmonyBridge.isSpeechSupported` (扩展)
  - 调用 TextToSpeechService.getInstance().isSupported()
  - 返回 Promise<boolean>
  - try/catch 兜底，异常 return false
  - confidence: 0.70

- `HarmonyBridge.getSpeechEngines` (扩展)
  - 调用 TextToSpeechService.getInstance().getEngines()
  - 返回 Promise<SpeechEngineInfo[]>
  - try/catch 兜底，异常 return []
  - confidence: 0.65

- `BridgeInputValidator.validateSpeechText` (扩展)
  - 纯函数，无副作用
  - 校验: typeof text === 'string' && text.length > 0 && text.length <= 4096
  - 返回 boolean
  - confidence: 0.85

- `BridgeInputValidator.validateSpeechRate` (扩展)
  - 校验: rate ∈ {0.5, 1.0, 1.5, 2.0}
  - 返回 boolean
  - confidence: 0.85

- `BridgeInputValidator.validateSpeechLanguage` (扩展)
  - 校验: language ∈ {'de-DE', 'en-US'}
  - 返回 boolean
  - confidence: 0.85

### 契约（contract）

- TextToSpeechService.getInstance().speak(payload: SpeakPayload): Promise<void>
- TextToSpeechService.getInstance().stop(): void
- TextToSpeechService.getInstance().isSupported(): Promise<boolean>
- TextToSpeechService.getInstance().getEngines(): Promise<SpeechEngineInfo[]>
- HarmonyBridge.speak(payload: SpeakPayload): Promise<void>
- HarmonyBridge.stopSpeech(): void
- HarmonyBridge.isSpeechSupported(): Promise<boolean>
- HarmonyBridge.getSpeechEngines(): Promise<SpeechEngineInfo[]>

### 测试用例（test_spec）

| ID | 描述 | 类型 | 关键性 |
|----|------|------|--------|
| T01 | TextToSpeechService 单例: getInstance() 两次返回同一实例 | unit | critical |
| T02 | speak(payload) 调用 BridgeInputValidator 前置校验 text/language/rate | unit | critical |
| T03 | validateSpeechText: 长度 0 / > 4096 / 非字符串 返回 false | unit | critical |
| T04 | validateSpeechRate: 0.5 / 1.0 / 1.5 / 2.0 返回 true; 其他值返回 false | unit | critical |
| T05 | validateSpeechLanguage: 'de-DE' / 'en-US' 返回 true; 'zh-CN' / 'fr-FR' 返回 false | unit | critical |
| T06 | HarmonyBridge.speak 异常时 try/catch 兜底，不抛到 Web | integration | critical |
| T07 | HarmonyBridge.isSpeechSupported 引擎不可用时返回 false（不抛异常） | integration | critical |
| T08 | HarmonyBridge.getSpeechEngines 异常时返回空数组（不抛异常） | integration | non-critical |

### 文件清单

**新建**:
- harmony/entry/src/main/ets/tts/TextToSpeechService.ets
- src/platform/__tests__/textToSpeechService.test.ts

**修改**:
- harmony/entry/src/main/ets/bridge/HarmonyBridge.ets
- harmony/entry/src/main/ets/bridge/BridgeInputValidator.ets
- src/platform/harmonyBridge.ts
- src/platform/bridgeInputValidator.ts

## Stage 2: D1 Web SpeechSynthesis 双路径 + ReadingSessionPage 改造

### 期望（expect）

- `interface SpeakPayload` (TS mirror, src/platform/harmonyBridge.ts, 扩展)
  - 与 ArkTS SpeakPayload 字段一一对应
  - text: string / language: 'de-DE' | 'en-US' / rate: 0.5 | 1.0 | 1.5 | 2.0 / voiceId?: string
  - confidence: 0.85

- `interface SpeechEngineInfo` (扩展)
  - engineId: string / engineName: string / supportedLanguages: string[] / isOnline: boolean
  - confidence: 0.55 (CSDN + 本地推断)

- `HarmonyBridge.speak` (TS mirror, 扩展)
  - speak(payload: SpeakPayload): Promise<void>
  - stopSpeech(): void
  - isSpeechSupported(): Promise<boolean>
  - getSpeechEngines(): Promise<SpeechEngineInfo[]>
  - confidence: 0.85

- `function loadSpeechSynthesisVoices` (src/platform/speechSynthesis.ts, 新建)
  - 监听 window.speechSynthesis.onvoiceschanged 事件
  - 缓存 voices 列表到模块级变量
  - getVoices() 返回缓存列表
  - selectVoiceByLang(lang: 'de-DE' | 'en-US'): SpeechSynthesisVoice | null
  - 优先选择 localService=true 且 lang 完全匹配的 voice
  - confidence: 0.65

- `function speakViaWebSpeechSynthesis` (新建)
  - 实现 chunk splitting: 长文本（>200 字符）按句切分
  - 队列播放: 维护 utterance 队列，逐个 speak
  - rate 映射: 0.5/1.0/1.5/2.0 直接赋值 utterance.rate
  - lang 映射: de-DE / en-US 通过 selectVoiceByLang 选择 voice
  - onend / onerror 回调，end 后播放下一个 chunk
  - stop() 调用 window.speechSynthesis.cancel() 清空队列
  - confidence: 0.60

- `ReadingSessionPage.handleTogglePlay` (改造)
  - 优先调用 window.harmonyBridge?.speak(payload)（如存在）
  - fallback 到 speakViaWebSpeechSynthesis(payload)
  - isPlaying 状态切换 + onend/onerror 回调
  - rate 四档 UI 选择器（新增 state: currentRate）
  - confidence: 0.75

- `detectPlatform.supportsSpeechSynthesis` (改造)
  - isHarmony 时返回 true（由 harmonyBridge.speak 兜底）
  - 非 isHarmony 时检测 'speechSynthesis' in window
  - 新增 supportsNativeSpeech: () => isHarmony（仅鸿蒙有原生 TTS）
  - confidence: 0.80

- `ReadingSessionPage` UI 改造
  - 朗读按钮 disabled 条件改为: !supportsSpeechSynthesis() && !window.harmonyBridge?.speak
  - 新增 rate 选择器 UI（4 档按钮组）
  - isPlaying 时显示 stop 按钮
  - confidence: 0.75

### 契约（contract）

- loadSpeechSynthesisVoices(): Promise<SpeechSynthesisVoice[]>
- selectVoiceByLang(lang: 'de-DE' | 'en-US'): SpeechSynthesisVoice | null
- speakViaWebSpeechSynthesis(payload: SpeakPayload): void
- stopWebSpeechSynthesis(): void
- ReadingSessionPage.handleTogglePlay(): Promise<void>
- detectPlatform.supportsSpeechSynthesis(): boolean
- detectPlatform.supportsNativeSpeech(): boolean

### 测试用例（test_spec）

| ID | 描述 | 类型 | 关键性 |
|----|------|------|--------|
| T09 | loadSpeechSynthesisVoices: 监听 onvoiceschanged + 缓存 voices | unit | critical |
| T10 | selectVoiceByLang('de-DE'): 返回 lang 匹配且 localService=true 的 voice | unit | critical |
| T11 | speakViaWebSpeechSynthesis: 长文本（>200 字符）按句切分为多个 utterance | unit | critical |
| T12 | ReadingSessionPage: 鸿蒙端 harmonyBridge.speak 存在时朗读按钮 enabled | integration | critical |
| T13 | ReadingSessionPage: 非鸿蒙端 speechSynthesis 存在时朗读按钮 enabled | integration | critical |
| T14 | ReadingSessionPage: 双端都不可用时朗读按钮 disabled | integration | non-critical |
| T15 | handleTogglePlay: 优先调用 harmonyBridge.speak, fallback 到 speakViaWebSpeechSynthesis | integration | critical |
| T16 | rate 四档选择器: 0.5/1.0/1.5/2.0 切换 + 持久化到 preferences | integration | non-critical |

### 文件清单

**新建**:
- src/platform/speechSynthesis.ts
- src/platform/__tests__/speechSynthesis.test.ts
- src/features/reading/__tests__/reading-session-tts.test.tsx

**修改**:
- src/features/reading/ReadingSessionPage.tsx
- src/platform/detect.ts

## Stage 3: D3 Vite manualChunks + Brotli 压缩

### 期望（expect）

- `vite.config.ts build.rollupOptions.output.manualChunks` (扩展)
  - react-vendor: ['react', 'react-dom']
  - state-fsrs: ['zustand', 'ts-fsrs', '@open-spaced-repetition/binding']
  - data-parsers: ['papaparse', 'jsonrepair', 'zod']
  - radix-ui: ['@radix-ui/react-tooltip']
  - confidence: 0.80

- `vite-plugin-compression 配置` (新增)
  - algorithm: 'brotliCompress'
  - threshold: 10240
  - deleteOriginalAssets: false（保留原文件作为 fallback）
  - 同时生成 .br + .gz 双压缩（gzip 作为不支持 brotli 的客户端 fallback）
  - confidence: 0.75

- `rollup-plugin-visualizer 配置` (新增)
  - open: false（CI 环境）
  - filename: 'dist/stats.html'
  - template: 'sunburst'
  - confidence: 0.65

- `server/nginx.conf brotli 配置` (新增)
  - 新增 brotli on
  - brotli_comp_level 6
  - brotli_types text/css application/javascript application/json image/svg+xml
  - 保留 gzip on 作为 fallback
  - confidence: 0.75

### 契约（contract）

- vite.config.ts 包含 manualChunks + compression + visualizer 3 个新配置
- package.json devDependencies 新增 vite-plugin-compression + rollup-plugin-visualizer
- server/nginx.conf 同时配置 brotli + gzip

### 文件清单

**修改**:
- vite.config.ts
- server/nginx.conf
- package.json (devDependencies)

### 验证方式

- vite build 成功
- rawfile/dist 包含 .br + .gz 双压缩文件

## Stage 4: D3 IndexedDB 索引优化 + 鸿蒙 relationalStore 索引

### 期望（expect）

- `csvStorage.ts onupgradeneeded 升级` (改造)
  - DB_VERSION: 1 → 2
  - onupgradeneeded 中检查 db.version
  - 若 version < 2: 调用 store.createIndex('by_importedAt', 'importedAt', { unique: false })
  - 保留已有数据（不删除 store）
  - confidence: 0.85

- `csvStorage.listCsvWordlists 改造`
  - 用 idx.openCursor(null, 'prev') 替代 store.getAll() + 内存 sort
  - 返回 Promise<StoredCsvWordlist[]>
  - confidence: 0.85

- `glossPersistentCache.ts onupgradeneeded 升级` (改造)
  - DB_VERSION: 1 → 2
  - 新增 store.createIndex('by_timestamp', 'timestamp', { unique: false })
  - confidence: 0.85

- `glossPersistentCache.evictIndexedDbIfNeeded 改造`
  - 用 idx.openCursor(null, 'next') 升序遍历最旧记录
  - cursor.delete() + counter 增量，直到 deleted >= toDelete
  - 不再 getAll + sort + 逐条 delete
  - confidence: 0.80

- `MemoryCardSchema CREATE_INDEX_SQL` (扩展)
  - 新增 CREATE_INDEX_SQL_DUE: 'CREATE INDEX IF NOT EXISTS idx_due ON memory_cards (due)'
  - 新增 CREATE_INDEX_SQL_LAST_REVIEW: 'CREATE INDEX IF NOT EXISTS idx_lastReviewAt ON memory_cards (lastReviewAt)'
  - 新增 CREATE_INDEX_SQL_LANGUAGE: 'CREATE INDEX IF NOT EXISTS idx_language ON memory_cards (language)'
  - confidence: 0.85

- `MemoryCardStore.init 升级` (扩展)
  - executeSql(CREATE_TABLE_SQL) 后调用 3 次 executeSql(CREATE_INDEX_SQL_*)
  - CREATE INDEX IF NOT EXISTS 保证幂等
  - confidence: 0.80

### 契约（contract）

- csvStorage.DB_VERSION === 2
- glossPersistentCache.DB_VERSION === 2
- csvStorage.listCsvWordlists() 使用索引游标
- glossPersistentCache.evictIndexedDbIfNeeded() 使用索引游标删除
- MemoryCardStore.init() 创建 3 个索引（due / lastReviewAt / language）

### 测试用例（test_spec）

| ID | 描述 | 类型 | 关键性 |
|----|------|------|--------|
| T17 | csvStorage DB_VERSION 升级 1 → 2 时创建 by_importedAt 索引（不删除已有数据） | integration | critical |
| T18 | csvStorage.listCsvWordlists 用索引游标倒序遍历（不再 getAll + sort） | unit | critical |
| T19 | glossPersistentCache DB_VERSION 升级 1 → 2 时创建 by_timestamp 索引 | integration | critical |
| T20 | glossPersistentCache.evictIndexedDbIfNeeded: 5000 条时删除最旧 N 条（不再 getAll） | unit | critical |
| T21 | MemoryCardSchema CREATE_INDEX_SQL_DUE/LAST_REVIEW/LANGUAGE 字符串正确 | unit | non-critical |

### 文件清单

**修改**:
- src/data/wordlists/csvStorage.ts
- src/features/dictionary/services/glossPersistentCache.ts
- harmony/entry/src/main/ets/data/MemoryCardSchema.ets
- harmony/entry/src/main/ets/data/MemoryCardStore.ets
- src/data/wordlists/__tests__/csvStorage.test.ts
- src/features/dictionary/services/__tests__/glossPersistentCache.test.ts

## Stage 5: 验证 + 文档 + Vault 同步

### 期望（expect）

- `vitest 全量回归` (src/platform/__tests__/)
  - v0.2.0-harmony 953 tests 全部 PASS（0 regression）
  - 新增 TTS 测试 ≥ 11 个（TextToSpeechService mock + BridgeInputValidator 3 + speechSynthesis 4 + ReadingSessionPage 4）
  - 新增 IndexedDB 索引测试 ≥ 4 个（csvStorage 升级 1 + glossPersistentCache 升级 1 + 查询性能 2）
  - 总测试数 ≥ 968
  - confidence: 0.85

- `tsc --noEmit 0 errors`
  - 0 TypeScript 编译错误
  - 0 any 类型新增
  - confidence: 0.85

- `vite build web + harmony 双成功`
  - vite build 成功（含 manualChunks + compression）
  - vite build --mode harmony 成功（rawfile/dist 包含 .br + .gz）
  - rawfile/dist 体积 < 1.5MB（v0.2.0 < 2MB，目标 -25%）
  - confidence: 0.75

- `harmony/oh-package.json5 version`
  - version: '0.2.0' → '0.3.0'
  - confidence: 0.95

- `RELEASE_CHECKLIST-v0.3.0-harmony.md` (新建)
  - 包含 5 Stage 全部交付物清单
  - 包含 TTS 真机验证项（@ohos.textToSpeech 引擎可用性 + de-DE 离线支持 + rate 四档）
  - 包含 Brotli 真机验证项（ArkWeb Content-Encoding: br 接受性）
  - 包含 IndexedDB schema 迁移验证项（DB_VERSION 1 → 2 升级路径）
  - confidence: 0.85

- `performance-baseline-v0.3.0-harmony.md` (新建)
  - 对比 v0.2.0-harmony 5 项性能基线
  - 新增 rawfile/dist 体积指标（目标 < 1.5MB）
  - 新增 Lighthouse 分数指标（目标 80+）
  - 新增 TTS speak 延迟指标（目标 < 200ms 首次响应）
  - confidence: 0.80

### 契约（contract）

- vitest test:run 退出码 0, 总测试数 ≥ 968
- tsc --noEmit 退出码 0
- vite build + vite build --mode harmony 退出码 0
- harmony/oh-package.json5 version === '0.3.0'
- docs/RELEASE_CHECKLIST-v0.3.0-harmony.md 存在
- docs/performance-baseline-v0.3.0-harmony.md 存在

### 测试用例（test_spec）

| ID | 描述 | 类型 | 关键性 |
|----|------|------|--------|
| T22 | vitest 全量回归: 953 v0.2.0 tests + 15 新增 ≥ 968 PASS | integration | critical |
| T23 | tsc --noEmit 0 errors | integration | critical |
| T24 | vite build web + harmony 双成功 | integration | critical |
| T25 | rawfile/dist 体积 < 1.5MB | benchmark | non-critical |
| T26 | harmony/oh-package.json5 version === '0.3.0' | integration | critical |
| T27 | RELEASE_CHECKLIST-v0.3.0-harmony.md 存在 + 包含 TTS/Brotli/IndexedDB 验证项 | integration | non-critical |
| T28 | performance-baseline-v0.3.0-harmony.md 存在 + 对比 v0.2.0 5 项基线 | integration | non-critical |

### 文件清单

**新建**:
- docs/RELEASE_CHECKLIST-v0.3.0-harmony.md
- docs/performance-baseline-v0.3.0-harmony.md

**修改**:
- harmony/oh-package.json5

## 风险矩阵

| 风险 ID | 风险描述 | 等级 | 缓解策略 | 触发 Stage |
|---------|---------|------|---------|----------|
| R-TTS-1 | @ohos.textToSpeech Kit 离线引擎能力文档不足 | 中 | 真机验证 + RELEASE_CHECKLIST 加入 de-DE 离线支持验证项 | S1 |
| R-TTS-2 | @ohos.textToSpeech Kit 在 API 18 的 speak 方法签名不确定 | 中 | 防御性写法 + try/catch 兜底（沿用 v0.2.0 HarmonyBridge 契约） | S1 |
| R-TTS-3 | de-DE voice 在 @ohos.textToSpeech Kit 不可用 | 中 | Web SpeechSynthesis 作为 fallback + 真机验证 + RELEASE_CHECKLIST | S2 |
| R-TTS-4 | Web SpeechSynthesis voiceschanged 在 ArkWeb 不触发 | 中 | 定时器兜底（500ms 后调用 getVoices） + 真机验证 | S2 |
| R-TTS-5 | 长文本 chunk splitting 在移动端触发 15s 超时 | 低 | chunk size 200 字符 + 队列播放 + 真机验证 | S2 |
| R-PERF-1 | vite-plugin-compression 与 vite 8.1.1 不兼容 | 低 | 安装前验证 peerDependencies + 失败时降级到 vite-plugin-compression2 | S3 |
| R-PERF-2 | ArkWeb Chromium M114 不支持 Brotli 解码 | 中 | 同时生成 .br + .gz 双压缩 + nginx brotli on + gzip on fallback + 真机验证 | S3 |
| R-PERF-3 | manualChunks 配置导致循环依赖或 chunk 体积异常 | 低 | rollup-plugin-visualizer 分析 + 调整 chunk 边界 | S3 |
| R-IDB-1 | IndexedDB DB_VERSION 1 → 2 迁移失败导致已有数据丢失 | 高 | onupgradeneeded 中保留已有 store + 仅 createIndex 不 deleteObjectStore + fake-indexeddb 测试 | S4 |
| R-IDB-2 | 鸿蒙 relationalStore CREATE INDEX 在已有数据表上失败 | 中 | CREATE INDEX IF NOT EXISTS 幂等性 + 真机验证 | S4 |
| R-IDB-3 | IndexedDB 索引在 ArkWeb 性能反而下降（数据量 < 100） | 低 | 性能基线对比 v0.2.0 + 真机测量 | S5 |
| R-Sandbox | 无 DevEco / 真机 | 高 | 沿用 v0.2.0-harmony 沙箱约束，subagent 生成代码 + vitest 守护 Web 端 0 regression | 全部 |

## Bayesian 消费指引

- **整体先验**: 0.71（5 Stage 加权平均）
- **沙箱上限**: 0.85（沿用 v0.2.0-harmony 沙箱约束，不允许超过 v0.1.0-harmony 0.92）
- **整体置信度来源**: 工程实践（Code Mine）+ 1 次论文降级，未触发 [PAPER GATE]
- **Bayesian C_spec**: 因 5 个 expect confidence 在 0.55-0.85 之间，整体中等可信，C_spec 起始值 0.75（不需要降低 0.20-0.25 惩罚，但需在 Stage 执行中根据测试结果动态调整）

## 最后更新

2026-07-27 v0.3.0-harmony SPEC 生成（Phase 5 完成，等待用户确认 SPEC Approval Gate）
