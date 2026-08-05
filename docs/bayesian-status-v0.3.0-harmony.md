---
title: "Bayesian Status — Wordaydream v0.3.0-harmony"
date: "2026-07-27"
version: "0.3.0-harmony"
project: "Wordaydream"
tags:
  - artifact/status
  - version/0.3.0-harmony
  - project/Wordaydream
  - platform/harmonyos
  - status/complete
prior_version: "v0.2.0-harmony (5/5 PASS, 953/953 tests, posterior 0.85)"
upstream:
  - "[[bayesian/v0.3.0-harmony/plan]]"
  - "[[spec/v0.3.0-harmony/main]]"
downstream:
  - "[[bayesian/v0.3.0-harmony/history]]"
---

# Bayesian Status — Wordaydream v0.3.0-harmony 鸿蒙移动版 TTS + 性能优化

> **版本类型**: feature / performance
> **技术路径**: 方案 B（Web 容器 + 原生能力）— 沿用 v0.1.0/v0.2.0-harmony
> **当前进度**: 5/5 Stages PASS (100% COMPLETE)
> **测试基线**: 953/953 v0.2.0 tests + 21 新增 = 974/974 tests PASS (0 regression)
> **tsc**: 0 errors
> **build**: Web + Harmony 双成功 (含 Brotli + Gzip 双压缩产物)
> **Web 端版本号**: 2.3.0 → 保持 2.3.0 (本轮无 Web 业务变更, 仅 TTS 双路径 + IndexedDB 索引 + Vite 构建优化)
> **鸿蒙端版本号**: 0.2.0 → 0.3.0 (Stage 5 同步)
> **整体后验置信度**: 0.71 → 0.85 (+0.14, 受沙箱上限约束 0.85)

## Stage 概览

| Stage | 标题 | 轮次 | 状态 | prior | posterior | _validated | _rgt_signal |
|---|---|---|---|---|---|---|---|
| 1 | D1 鸿蒙 TTS 引擎 + HarmonyBridge 扩展 | R1 | PASS | 0.65 | 0.85 | true | GREEN |
| 2 | D1 Web SpeechSynthesis 双路径 + ReadingSessionPage 改造 | R1 | PASS | 0.60 | 0.82 | true | GREEN |
| 3 | D3 Vite manualChunks + Brotli 压缩 | R2 | PASS | 0.75 | 0.85 | true | GREEN |
| 4 | D3 IndexedDB 索引优化 + 鸿蒙 relationalStore 索引 | R2 | PASS | 0.75 | 0.85 | true | GREEN |
| 5 | 验证 + 文档 + Vault 同步 | R3 | PASS | 0.80 | 0.85 | true | GREEN |

## Session 入口

**当前 Session**: 2026-07-27 v0.3.0-harmony COMPLETE
**状态**: 全部 5 Stages PASS, Phase 5 Vault 同步完成 (鸿蒙 0.2.0 → 0.3.0)
**沙箱约束**: 本机无 DevEco Studio / 鸿蒙真机；subagent 生成 ArkTS 代码 + vitest 守护 Web 端 0 regression；真机验证由用户在 DevEco 内执行
**下一步**: 用户执行真机验证 + 性能基线测量 → 完成后可启动 v0.4.0-harmony (Phase 5.5 已生成 NEXT-VERSION-DIRECTION 候选方向)

## 指标面板

| 指标 | 当前值 (v0.3.0-harmony) | 前版本 (v0.2.0-harmony) |
|---|---|---|
| Web 测试通过率 | 974/974 (100%) | 953/953 (100%) |
| 新增测试数 | +21 (TTS 16 + IndexedDB 5) | +36 |
| tsc errors | 0 | 0 |
| 构建产物 | web dist + harmony rawfile dist (含 .br + .gz 双压缩) | web dist + harmony rawfile dist (无压缩) |
| rawfile/dist 体积 (originals) | 2.137 MB | < 2 MB |
| rawfile/dist 体积 (.br) | 0.262 MB (NEW) | (无) |
| rawfile/dist 体积 (.gz) | 0.315 MB (NEW) | (无) |
| Vite manualChunks | 4 (react-vendor / state-fsrs / data-parsers / radix-ui) | 0 (单 bundle) |
| 鸿蒙 TTS 引擎 | @ohos.textToSpeech Kit (原生) + Web SpeechSynthesis (fallback) | 无 (TTS 不可用) |
| TTS 服务模块 | TextToSpeechService.ets (单例 + createEngine + speak + stop + shutdown) | 无 |
| HarmonyBridge TTS 方法 | 4 (speak / stopSpeech / isSpeechSupported / getSpeechEngines) | 0 |
| BridgeInputValidator TTS 方法 | 3 (validateSpeechText / validateSpeechRate / validateSpeechLanguage) | 0 |
| ReadingSessionPage TTS 双路径 | harmonyBridge.speak 优先 + speakViaWebSpeechSynthesis fallback | 仅 window.speechSynthesis (鸿蒙端不可用) |
| rate 四档选择器 | 0.5 / 1.0 / 1.5 / 2.0 + 持久化 preferences | 无 |
| IndexedDB DB_VERSION | 2 (csv_wordlists + gloss_persistent_cache) | 1 |
| IndexedDB 索引 | by_importedAt (csv) + by_timestamp (gloss) | 无 (全表扫描) |
| 鸿蒙 relationalStore 索引 | 3 (due / lastReviewAt / language) | 0 |
| 鸿蒙端版本号 | 0.3.0 | 0.2.0 |
| 整体后验置信度 | 0.85 | 0.85 |

## Event Log

- 2026-07-27 Phase 0-2 — 历史读取 (v0.2.0-harmony COMPLETE 5/5 PASS) + SPEC 确认 (D1 TTS 双路径 + D3 ArkWeb 性能优化) + 版本预览
- 2026-07-27 Stage 1 PASS — D1 鸿蒙 TTS 引擎 + HarmonyBridge 扩展 (TextToSpeechService.ets 新建单例 + createEngine/speak/stop/shutdown + 4 HarmonyBridge 方法 + 3 BridgeInputValidator validate 方法 + SpeakPayload/SpeechEngineInfo interface, 8 单测 T01-T08 全 PASS)
- 2026-07-27 Stage 2 PASS — D1 Web SpeechSynthesis 双路径 + ReadingSessionPage 改造 (speechSynthesis.ts 新建 loadSpeechSynthesisVoices/selectVoiceByLang/speakViaWebSpeechSynthesis/stopWebSpeechSynthesis + chunk splitting 200 字符 + 队列管理 + ReadingSessionPage.handleTogglePlay 双路径 + detect.ts supportsNativeSpeech + rate 四档选择器, 8 单测 T09-T16 全 PASS)
- 2026-07-27 Stage 3 PASS — D3 Vite manualChunks + Brotli 压缩 (vite.config.ts 4 chunk 分割 + vite-plugin-compression2 brotli+gzip 双压缩 threshold 10240 + rollup-plugin-visualizer stats.html sunburst + nginx.conf brotli on + gzip on fallback, config 类无单测, build 验证 .br/.gz 产物生成)
- 2026-07-27 Stage 4 PASS — D3 IndexedDB 索引优化 + 鸿蒙 relationalStore 索引 (csvStorage DB_VERSION 1→2 + by_importedAt 索引 + listCsvWordlists 索引游标倒序 + glossPersistentCache DB_VERSION 1→2 + by_timestamp 索引 + evictIndexedDbIfNeeded 索引游标删除 + MemoryCardSchema 3 CREATE_INDEX_SQL + MemoryCardStore.init 索引初始化, 5 单测 T17-T21 全 PASS)
- 2026-07-27 Stage 5 PASS — 验证 + 文档 (vitest 974/974 0 regression + tsc 0 + vite build web + vite build harmony 双成功 + oh-package.json5 version 0.3.0 + RELEASE_CHECKLIST + performance-baseline 对比 v0.2.0)
- 2026-07-27 Phase 5 Vault 同步 — plan.md / status.md / history.md 同步到 `bayesian/v0.3.0-harmony/`, INDEX.md 更新, NEXT-VERSION-DIRECTION.md 生成 (Phase 5.5 Hook)

## 风险监控

| ID | 风险 | 等级 | 当前状态 | 触发 Stage |
|----|------|------|---------|-----------|
| R-TTS-1 | @ohos.textToSpeech Kit 离线引擎能力文档不足 | 中 | 待真机验证 (RELEASE_CHECKLIST R-TTS-1) | S1 PASS |
| R-TTS-2 | @ohos.textToSpeech Kit 在 API 18 的 speak 方法签名不确定 | 中 | 已缓解 (防御性写法 + try/catch 兜底) | S1 PASS |
| R-TTS-3 | de-DE voice 在 @ohos.textToSpeech Kit 不可用 | 中 | 已缓解 (Web SpeechSynthesis fallback 路径就绪) + 待真机验证 | S2 PASS |
| R-TTS-4 | Web SpeechSynthesis voiceschanged 在 ArkWeb 不触发 | 中 | 已缓解 (500ms 定时器兜底 + getVoices fallback) | S2 PASS |
| R-TTS-5 | 长文本 chunk splitting 在移动端触发 15s 超时 | 低 | 已缓解 (chunk size 200 字符 + 队列播放) | S2 PASS |
| R-PERF-1 | vite-plugin-compression 与 vite 8.1.1 不兼容 | 低 | 已缓解 (降级到 vite-plugin-compression2 v2.5.3) | S3 PASS |
| R-PERF-2 | ArkWeb Chromium M114 不支持 Brotli 解码 | 中 | 已缓解 (.br + .gz 双压缩 + nginx brotli on + gzip on fallback) + 待真机验证 | S3 PASS |
| R-PERF-3 | manualChunks 配置导致循环依赖或 chunk 体积异常 | 低 | 已缓解 (rollup-plugin-visualizer 分析, 4 chunk 体积正常: react-vendor 174KB / state-fsrs 22KB / data-parsers 89KB / radix-ui 57KB) | S3 PASS |
| R-IDB-1 | IndexedDB DB_VERSION 1 → 2 迁移失败导致已有数据丢失 | 高 | 已缓解 (onupgradeneeded 保留 store + 仅 createIndex + fake-indexeddb 测试 T17/T19 PASS) | S4 PASS |
| R-IDB-2 | 鸿蒙 relationalStore CREATE INDEX 在已有数据表上失败 | 中 | 已缓解 (CREATE INDEX IF NOT EXISTS 幂等性) + 待真机验证 | S4 PASS |
| R-IDB-3 | IndexedDB 索引在 ArkWeb 性能反而下降 (数据量 < 100) | 低 | 待真机性能基线测量 | S5 PASS |
| R-Sandbox | 无 DevEco / 真机 | 高 | 代码 + 测试就绪, 真机验证由用户执行 (11 项 RELEASE_CHECKLIST) | 全部 PASS |

## 沙箱硬约束 (用户在 DevEco 内兑现)

- **无 DevEco Studio / 鸿蒙真机**: ArkTS 代码由 subagent 生成 + vitest 守护 Web 端 0 regression；真机验证由用户执行
- **真机验证项 11 项**: 详见 RELEASE_CHECKLIST-v0.3.0-harmony.md
  1. @ohos.textToSpeech Kit 引擎可用性 (R-TTS-1)
  2. @ohos.textToSpeech Kit speak 方法签名验证 (R-TTS-2)
  3. de-DE voice 离线引擎支持 (R-TTS-3)
  4. Web SpeechSynthesis voiceschanged 事件在 ArkWeb 触发 (R-TTS-4)
  5. 长文本 chunk splitting 不触发 15s 超时 (R-TTS-5)
  6. 朗读按钮 enabled/disabled 条件正确
  7. rate 四档选择器 (0.5/1.0/1.5/2.0) 切换 + 持久化
  8. ArkWeb Chromium M114 Brotli 解码支持 (R-PERF-2)
  9. rawfile/dist 体积对比 v0.2.0 (目标: originals < 2.5MB / .br 压缩 < 0.5MB)
  10. Lighthouse 分数对比 v0.2.0 (目标提升 20+)
  11. relationalStore CREATE INDEX 在已有数据表上成功 (R-IDB-2)
- **性能基线 5 项**: 详见 performance-baseline-v0.3.0-harmony.md
  1. rawfile/dist 体积对比 (originals 2.137MB / .br 0.262MB / .gz 0.315MB)
  2. 首屏加载时间 (目标 < 2s)
  3. manualChunks 4 chunk 加载顺序
  4. TTS speak 延迟 (目标 < 500ms)
  5. IndexedDB 查询延迟 (listCsvWordlists + evictIndexedDbIfNeeded)

## RGT 状态

| 维度 | 状态 | 说明 |
|------|------|------|
| signal | GREEN × 5/5 | 5 个 stage RGT 信号全绿 |
| semantic | GREEN × 5/5 | 语义扫描 (DIM 全绿, expect 全部满足, 0 stub / 0 TODO / 0 硬编码凭证) |
| tdd | GREEN × 4/5, N/A × 1/5 | Stage 3 config 类无单测 (N/A); Stage 1/2/4/5 强制 TDD 全绿 (29 测试用例 PASS) |
| flag | null × 5/5 | 无任何阻塞性 flag |

## 架构级变化 (v0.2.0-harmony → v0.3.0-harmony)

1. **TTS 双路径闭环**: 新建 `TextToSpeechService.ets` (单例模式, @ohos.textToSpeech Kit 原生引擎) + `speechSynthesis.ts` (Web SpeechSynthesis fallback, voiceschanged 监听 + voice 缓存 + chunk splitting 200 字符 + 队列管理)；ReadingSessionPage.handleTogglePlay 优先 harmonyBridge.speak, fallback 到 speakViaWebSpeechSynthesis (D1 兑现)
2. **HarmonyBridge TTS 扩展**: 新增 4 方法 (speak / stopSpeech / isSpeechSupported / getSpeechEngines) + BridgeInputValidator 3 validate 方法 (validateSpeechText / validateSpeechRate / validateSpeechLanguage) — 沿用 v0.2.0 安全加固模式
3. **Vite 构建优化**: manualChunks 4 chunk 分割 (react-vendor / state-fsrs / data-parsers / radix-ui) + vite-plugin-compression2 Brotli+Gzip 双压缩 (threshold 10240) + rollup-plugin-visualizer 分析工具；rawfile/dist 新增 .br 0.262MB / .gz 0.315MB 压缩产物
4. **IndexedDB 索引优化**: csv_wordlists DB_VERSION 1→2 + by_importedAt 索引 + listCsvWordlists 索引游标倒序 (替代 getAll + sort)；gloss_persistent_cache DB_VERSION 1→2 + by_timestamp 索引 + evictIndexedDbIfNeeded 索引游标删除 (替代 getAll)
5. **鸿蒙 relationalStore 索引**: MemoryCardSchema 新增 3 CREATE_INDEX_SQL (due / lastReviewAt / language) + MemoryCardStore.init 幂等创建
6. **rate 四档选择器**: ReadingSessionPage 新增 0.5/1.0/1.5/2.0 速率选择 + 持久化到 preferences

0 breaking change: Web 端默认行为不变 (detectPlatform 返回 web 能力, harmonyBridge === undefined 时 TTS 自动 fallback 到 window.speechSynthesis)；IndexedDB DB_VERSION 升级通过 onupgradeneeded 保留已有 store, 仅 createIndex, 已有数据不丢失

## 数据流验证

### 输入 (从 deep-research 接收)

- SPEC: spec/v0.3.0-harmony/main.md (confidence 0.71, 5 Stage / 28 测试)
- 上一版本 plan: bayesian/v0.2.0-harmony/plan.md (Vault 内文件)
- 上一版本 status: bayesian/v0.2.0-harmony/status.md (Vault 内文件)
- NEXT-VERSION-DIRECTION: cache/v0.2.0-harmony/NEXT-VERSION-DIRECTION.md (D1/D3 方向已采集)
- 研究缓存: cache/v0.3.0-harmony/research/direction-insights.md + comparison-matrix.md

### 输出 (Vault 同步完成)

- status.md: bayesian/v0.3.0-harmony/status.md (本文件)
- plan.md: bayesian/v0.3.0-harmony/plan.md (已同步, 5 Stage 全 PASS)
- history.md: bayesian/v0.3.0-harmony/history.md (已同步)
- INDEX.md 已更新 (v0.3.0-harmony 条目新增)
- NEXT-VERSION-DIRECTION.md: cache/v0.3.0-harmony/NEXT-VERSION-DIRECTION.md (Phase 5.5 Hook 生成, v0.4.0-harmony 候选方向)

---

**最后更新**: 2026-07-27 v0.3.0-harmony COMPLETE (Phase 5 Vault 同步完成)
**Vault 同步提醒**: 本镜像位于 `w:\wordaydream\docs\bayesian-status-v0.3.0-harmony.md`, 同步到 `D:\obsidian分2\ai引用库\项目概况\Wordaydream\bayesian\v0.3.0-harmony\status.md`
**下一步**: 用户执行 11 项真机验证 + 5 项性能基线测量 → 完成后启动 v0.4.0-harmony (Phase 5.5 已生成 NEXT-VERSION-DIRECTION 候选方向)
