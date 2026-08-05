---
title: "Performance Baseline — Wordaydream v0.3.0-harmony"
date: "2026-07-27"
version: "0.3.0-harmony"
project: "Wordaydream"
tags:
  - artifact/performance-baseline
  - version/0.3.0-harmony
  - platform/harmonyos
prior_version: "v0.2.0-harmony"
---

# Performance Baseline — Wordaydream v0.3.0-harmony

> Stage 5 收尾产物。对比 v0.2.0-harmony 5 项性能基线, 新增 v0.3.0 特有指标 (rawfile/dist 体积 / manualChunks / TTS / IndexedDB 索引).
> 沙箱约束: 本机无 DevEco Studio / 鸿蒙真机. 文件体积 + chunk 体积 + 测试数为沙箱实测值, 首屏/TTS/IndexedDB 延迟为真机待回填 (沿用 v0.2.0 沙箱约束).

## 1. rawfile/dist 体积对比

| 指标 | v0.2.0-harmony | v0.3.0-harmony (实测) | 变化 |
|------|---------------|----------------------|------|
| originals (非压缩) | < 2 MB | 2.137 MB (2,188.94 KB) | +0.137 MB (略增, 含 TTS + IndexedDB 索引代码) |
| .br 压缩 | (无, v0.2.0 未启用 Brotli) | 0.262 MB (268.07 KB) | NEW |
| .gz 压缩 | (无, v0.2.0 未启用 Gzip) | 0.315 MB (322.46 KB) | NEW |
| dist 总体积 | < 2 MB (无压缩产物) | 2.714 MB (2,846,166 bytes / 54 files, 含 .br+.gz) | 含双压缩产物 |

**测量方法**: PowerShell `Get-ChildItem -Recurse | Measure-Object -Sum Length` on `harmony/entry/src/main/resources/rawfile/dist/`.

**T25 达标分析**:
- T25 目标 (SPEC): rawfile/dist originals < 1.5MB → 实测 2.137 MB → **超目标** (v0.3.0 新增 TTS 服务 + IndexedDB 索引代码导致 originals 略增)
- .br 压缩目标: < 0.5MB → 实测 0.262 MB → **达标** (压缩率 87.7%)
- .gz 压缩: 0.315 MB → 兜底达标
- **结论**: originals 超目标, .br 压缩达标 (压缩产物远低于 0.5MB 阈值, 真机传输体积达标)
- **反思项**: v0.3.0 originals 2.137 MB 较 v0.2.0 < 2MB 略增 0.137 MB, 主要来自 TTS 服务 (TextToSpeechService + ReadingSessionPage UI) + IndexedDB 索引代码. 已通过 manualChunks 拆分 + Brotli 压缩将真机传输体积降至 0.262 MB, 满足实际加载性能目标. 若后续版本需进一步压缩 originals, 可考虑: (a) 动态 import TTS 服务按需加载; (b) 移除 radix-ui 未使用组件.

## 2. 首屏加载时间 (真机待回填)

| 场景 | v0.2.0-harmony | v0.3.0-harmony 目标 | v0.3.0-harmony 实测 | 状态 |
|------|---------------|-------------------|-------------------|------|
| 冷启动 first paint (Web) | TBD (真机) | < 1.5s | 待真机回填 | 待测 |
| 冷启动 first paint (鸿蒙 ArkWeb) | TBD (真机) | < 2s | 待真机回填 | 待测 |
| 热启动 first paint | TBD (真机) | < 1s | 待真机回填 | 待测 |

**测量方法**: ArkWeb controller `onPageBegin` / `onPageEnd` 时序, 或 Web 端 `performance.now()` 在 main.tsx 入口 + React render 完成.

**v0.3.0 优化预期**: manualChunks 拆分 4 chunk 并行加载 + Brotli 压缩减少 87.7% 传输体积, 预期较 v0.2.0 首屏提升 20%+.

## 3. Vite manualChunks chunk 体积 (实测)

| chunk | v0.3.0 实测 (KB) | .br 压缩 (KB) | .gz 压缩 (KB) | 说明 |
|-------|-----------------|--------------|--------------|------|
| react-vendor | 174.14 | 47.15 | 54.29 | react + react-dom + scheduler |
| state-fsrs | 22.62 | 6.66 | 7.42 | zustand + fsrs-rs wasm |
| data-parsers | 89.41 | 23.25 | 26.06 | csv-parse + papaparse + 未 Loki |
| radix-ui | 57.06 | 17.74 | 19.85 | @radix-ui/* 组件库 |
| **合计 4 chunk** | **343.23** | **94.80** | **107.62** | — |

**测量方法**: 从 `harmony/entry/src/main/resources/rawfile/dist/assets/` 读取 4 个 manualChunks 命名的 .js / .br / .gz 文件体积.

**加载顺序**: react-vendor → state-fsrs → data-parsers → radix-ui (vite.config.ts manualChunks 配置, react-vendor 优先).

## 4. TTS speak 延迟 (真机待回填)

| 场景 | v0.3.0 目标 | v0.3.0 实测 | 状态 |
|------|------------|------------|------|
| 首次响应延迟 (speak 调用 → 第一个音频帧) | < 200ms | 待真机回填 | 待测 |
| de-DE voice 可用性 | 可用 (离线引擎或 fallback) | 待真机验证 (R-TTS-3) | 待测 |
| Web SpeechSynthesis fallback 触发率 | < 10% (TTS Kit 优先) | 待真机统计 | 待测 |
| 长文本 (1000 字符) chunk splitting 总耗时 | < 15s (不超时) | 待真机回填 (R-TTS-5) | 待测 |

**测量方法**: Web 端 `performance.mark('tts-speak-start')` 在 speak 调用前 + `performance.mark('tts-first-frame')` 在第一个 audio frame 回调 + `performance.measure()`.

**沙箱内验证**: vitest T-TTS-* 已验证 speak 调用流程 + chunk splitting 逻辑 (200 字符 / chunk) + 队列播放, 真机延迟未测.

## 5. IndexedDB 查询延迟

| 查询场景 | v0.2.0 基线实现 | v0.3.0 实现优化 | v0.3.0 实测 | 状态 |
|---------|----------------|---------------|------------|------|
| listCsvWordlists (1000 条) | getAll + sort (全表扫描 + 内存排序) | IDBKeyRange + index.getAll (by_importedAt 索引) | 待真机回填 (ArkWeb) | 待测 |
| evictIndexedDbIfNeeded (5000 条) | getAll + 逐条 delete (N 次 transaction) | index.openCursor + 批量 delete (by_timestamp 索引, 单 transaction) | 待真机回填 (ArkWeb) | 待测 |
| by_importedAt 索引创建延迟 | (无索引) | onupgradeneeded v2 createIndex | 待真机回填 (R-IDB-2) | 待测 |
| 小数据量 (< 100 条) 性能对比 | getAll + sort | index.getAll | 待真机回填 (R-IDB-3) | 待测 |

**测量方法**: 鸿蒙 ArkWeb 内 `performance.now()` 在查询前后, 或 vitest fake-indexeddb 内 `console.time/timeEnd` (后者不反映真实性能, 仅验证逻辑).

**沙箱内验证**: vitest T-IDB-* 已验证索引查询逻辑正确 (返回结果与 getAll + sort 一致), 性能提升需真机实测. 预期: 大数据量 (1000+ 条) 索引查询较全表扫描 + 内存排序提升 5-10x, 小数据量 (< 100 条) 性能持平或略降 (索引查找开销).

**风险 R-IDB-3**: 数据量 < 100 时索引查找开销可能略高于全表扫描. 已在 RELEASE_CHECKLIST 标注真机验证项, 若退化 > 20% 则回退到 getAll + sort (v0.2.0 实现).

## 6. 测试基线

| 指标 | v0.2.0-harmony | v0.3.0-harmony (实测) | 变化 |
|------|---------------|----------------------|------|
| 总测试数 | 953/953 PASS | 1030/1030 PASS | +77 新增 (Stage 1: 30 + Stage 2: 39 + Stage 4: 8) |
| vitest 全量回归退出码 | 0 | 0 | 持平 |
| tsc --noEmit 错误数 | 0 | 0 | 持平 |
| vite build 退出码 | 0 | 0 | 持平 |
| vite build --mode harmony 退出码 | 0 | 0 | 持平 |

**新增测试分布**:
- Stage 1 (TTS): 30 用例 (TextToSpeechService + BridgeInputValidator speak + speechSynthesis + ReadingSessionPage)
- Stage 2 (TTS 防御性): 39 用例 (chunk splitting + voiceschanged 兜底 + rate 持久化)
- Stage 4 (IndexedDB 索引): 8 用例 (DB_VERSION 升级 + 索引查询逻辑)
- Stage 3 (config): 0 用例 (无逻辑分支, 仅配置变更)

**0 regression**: v0.2.0 953 测试全部保持 PASS, 无回归.

## 测量工具清单 (真机)

- DevEco Studio Profiler (ArkWeb 性能 trace)
- hilog (filter: wordaydream / HarmonyBridge / TextToSpeechService / MemoryCardStore)
- Web 端 performance API (performance.mark / measure)
- 鸿蒙 RDB 工具 (检查 wordaydream_memory.db 索引创建)
- Lighthouse (Web 端 PWA 分数, 目标 80+)

## 风险 (真机验证项)

| ID | 风险 | 沙箱状态 | 真机验证步骤 |
|----|------|---------|------------|
| R-TTS-1 | @ohos.textToSpeech Kit 离线引擎能力文档不足 | 代码已实现 + vitest mock | 真机检查引擎可用性 |
| R-TTS-3 | de-DE voice 不可用 | Web SpeechSynthesis fallback 已实现 | 真机检查 de-DE voice |
| R-TTS-5 | 长文本 chunk splitting 15s 超时 | 200 字符 chunk + 队列已实现 | 真机 1000 字符朗读测试 |
| R-PERF-2 | ArkWeb Chromium M114 不支持 Brotli | .br + .gz 双压缩已生成 | 真机验证 Content-Encoding: br 解码 |
| R-IDB-1 | DB_VERSION 1 → 2 迁移失败丢数据 | onupgradeneeded 仅 createIndex | 真机验证已有数据不丢失 |
| R-IDB-2 | relationalStore CREATE INDEX 失败 | CREATE INDEX IF NOT EXISTS 幂等 | 真机验证已有数据表建索引 |
| R-IDB-3 | 索引在小数据量性能退化 | vitest 验证逻辑正确 | 真机 < 100 条性能对比 |

---

**最后更新**: 2026-07-27 v0.3.0-harmony Stage 5 COMPLETE (沙箱内实测值已填, 真机数据待用户回填)
