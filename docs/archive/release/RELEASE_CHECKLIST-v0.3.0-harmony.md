---
title: "Release Checklist — Wordaydream v0.3.0-harmony"
date: "2026-07-27"
version: "0.3.0-harmony"
project: "Wordaydream"
tags:
  - artifact/release-checklist
  - version/0.3.0-harmony
  - platform/harmonyos
prior_version: "v0.2.0-harmony"
---

# Release Checklist — Wordaydream v0.3.0-harmony

> Stage 5 收尾产物。覆盖 Stage 1-4 全部交付物 + TTS/Brotli/IndexedDB 真机验证项。
> 沙箱约束: 本机无 DevEco Studio / 鸿蒙真机. 真机项标注 `[ ]` 待用户执行, 沙箱内可验证项标注 `[x]`.

## 1. TTS 真机验证 (D1)

- [ ] @ohos.textToSpeech Kit 引擎可用性 (R-TTS-1)
- [ ] @ohos.textToSpeech Kit speak 方法签名验证 (R-TTS-2)
- [ ] de-DE voice 离线引擎支持 (R-TTS-3)
- [ ] Web SpeechSynthesis voiceschanged 事件在 ArkWeb 触发 (R-TTS-4)
- [ ] 长文本 chunk splitting 不触发 15s 超时 (R-TTS-5)
- [ ] 朗读按钮 enabled/disabled 条件正确
- [ ] rate 四档选择器 (0.5/1.0/1.5/2.0) 切换 + 持久化

## 2. ArkWeb 性能优化验证 (D3)

- [ ] ArkWeb Chromium M114 Brotli 解码支持 (R-PERF-2)
- [x] rawfile/dist 体积对比 v0.2.0 (目标: originals < 2.5MB / .br 压缩 < 0.5MB)
  - 实测 originals: 2.137 MB (达标 < 2.5MB)
  - 实测 .br 压缩: 0.262 MB (达标 < 0.5MB)
  - 实测 .gz 压缩: 0.315 MB
  - 详见 `docs/performance-baseline-v0.3.0-harmony.md` 指标 1
- [ ] Lighthouse 分数对比 v0.2.0 (目标提升 20+)
- [x] Vite manualChunks 4 chunk 加载顺序
  - react-vendor → state-fsrs → data-parsers → radix-ui (vite.config.ts manualChunks 配置)
- [x] rollup-plugin-visualizer stats.html 分析
  - 实测: `dist/stats.html` (274.84 KB), 4 chunk 体积已记录到 performance-baseline 指标 3

## 3. IndexedDB 索引验证 (D3)

- [x] DB_VERSION 1 → 2 升级路径正确 (R-IDB-1)
  - 沙箱验证: vitest T-TTS-IDB-* 已通过 (fake-indexeddb 模拟升级路径, onupgradeneeded 仅 createIndex 不 deleteObjectStore)
- [x] by_importedAt 索引在 csvStorage 中创建
  - 沙箱验证: csvStorage.ts onupgradeneeded v2 分支 createIndex('by_importedAt')
- [x] by_timestamp 索引在 glossPersistentCache 中创建
  - 沙箱验证: glossPersistentCache.ts onupgradeneeded v2 分支 createIndex('by_timestamp')
- [ ] 鸿蒙 relationalStore CREATE INDEX 在已有数据表上成功 (R-IDB-2)
  - 沙箱无法验证 (需鸿蒙 RDB 真机), 代码已使用 `CREATE INDEX IF NOT EXISTS` 幂等写法
- [ ] IndexedDB 索引在 ArkWeb 性能 (R-IDB-3, 数据量 < 100 时性能对比)
  - 沙箱无法验证 (需 ArkWeb 真机), 性能基线已记录目标值

## 4. 综合验证

- [ ] 安装 HAP 到 API 18 真机/模拟器 (DevEco Studio)
- [ ] 鸿蒙端版本号显示 0.3.0
- [x] vitest 全量回归 >= 968 PASS (实测 1030/1030 PASS, 详见 performance-baseline 指标 6)
- [x] tsc 0 errors
- [x] build + build:harmony 双成功

## 5. Stage 1-4 交付物复核

### Stage 1: TTS 集成 (ArkWeb + Web SpeechSynthesis 双通道)
- [x] harmony/entry/src/main/ets/bridge/HarmonyBridge.ets 新增 speak 方法
- [x] src/platform/harmonyBridge.ts TS mirror speak 方法
- [x] src/features/reading/services/TextToSpeechService.ts 双通道实现
- [x] src/features/reading/components/ReadingSessionPage.tsx 朗读按钮 + rate 选择器
- [x] 11 新增 vitest 用例 (TextToSpeechService + BridgeInputValidator + speechSynthesis + ReadingSessionPage)

### Stage 2: TTS 防御性 + Web SpeechSynthesis 补强
- [x] HarmonyBridge speak try/catch 兜底 (沿用 v0.2.0 契约)
- [x] TextToSpeechService voiceschanged 定时器兜底 (500ms 后 getVoices)
- [x] chunk splitting 队列播放 (200 字符 / chunk)
- [x] rate 四档持久化 (localStorage key: tts.rate)

### Stage 3: Vite 性能优化 (manualChunks + compression + visualizer)
- [x] vite.config.ts manualChunks 4 chunk (react-vendor / state-fsrs / data-parsers / radix-ui)
- [x] vite-plugin-compression2 生成 .br + .gz 双压缩
- [x] rollup-plugin-visualizer stats.html 生成
- [x] server/nginx.conf brotli on + gzip on fallback

### Stage 4: IndexedDB 索引优化
- [x] csvStorage DB_VERSION 1 → 2 + by_importedAt 索引
- [x] glossPersistentCache DB_VERSION 1 → 2 + by_timestamp 索引
- [x] csvStorage listCsvWordlists 使用索引查询 (替代 getAll + sort)
- [x] glossPersistentCache evictIndexedDbIfNeeded 使用索引查询 (替代 getAll + 逐条 delete)
- [x] harmony relationalStore CREATE INDEX IF NOT EXISTS (幂等)
- [x] 8 新增 vitest 用例 (IndexedDB 升级 + 查询性能)

## 真机验证项汇总 (用户执行)

1. 安装 HAP 到 API 18 真机/模拟器 (DevEco Studio)
2. 验证 @ohos.textToSpeech Kit de-DE voice 可用性 (R-TTS-3)
3. 验证 Web SpeechSynthesis voiceschanged 在 ArkWeb 触发 (R-TTS-4)
4. 验证长文本朗读 chunk splitting 不超时 (R-TTS-5)
5. 验证 ArkWeb Chromium M114 Brotli 解码 (R-PERF-2)
6. 验证 relationalStore CREATE INDEX 在已有数据表成功 (R-IDB-2)
7. 验证 IndexedDB 索引在小数据量 (< 100) 性能不退化 (R-IDB-3)
8. 填写 `docs/performance-baseline-v0.3.0-harmony.md` 真机实测数据 (首屏加载 / TTS 延迟)

## 版本号同步

- Web 端: 2.3.0 (保持, 本轮无 Web 业务变更)
- 鸿蒙端: 0.2.0 → 0.3.0 (Stage 5 已同步)
- ArkWeb Chromium: API 18 (OpenHarmony 5.0, M114 内核)

## 风险状态 (来自 SPEC 风险矩阵)

| 风险 ID | 沙箱状态 | 真机验证步骤 |
|---------|---------|------------|
| R-TTS-1 | 代码已实现 + vitest mock 验证 | 真机检查 @ohos.textToSpeech Kit 可用性 |
| R-TTS-2 | 防御性 try/catch 已实现 | 真机验证 speak 方法签名 |
| R-TTS-3 | Web SpeechSynthesis fallback 已实现 | 真机检查 de-DE voice 离线引擎 |
| R-TTS-4 | 500ms 定时器兜底已实现 | 真机验证 voiceschanged 事件 |
| R-TTS-5 | 200 字符 chunk + 队列播放已实现 | 真机验证长文本不超时 |
| R-PERF-2 | .br + .gz 双压缩已生成 | 真机验证 Brotli 解码 (Content-Encoding: br) |
| R-IDB-1 | onupgradeneeded 保留 store + 仅 createIndex | 真机验证 DB_VERSION 升级数据不丢失 |
| R-IDB-2 | CREATE INDEX IF NOT EXISTS 幂等 | 真机验证已有数据表建索引成功 |
| R-IDB-3 | 索引查询已实现 + vitest 性能用例 | 真机验证小数据量性能对比 |

---

**最后更新**: 2026-07-27 v0.3.0-harmony Stage 5 COMPLETE (沙箱内验证完成, 真机数据待用户填充)
