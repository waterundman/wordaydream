---
title: "Performance Baseline — Wordaydream v0.2.0-harmony"
date: "2026-07-27"
version: "0.2.0-harmony"
project: "Wordaydream"
tags:
  - artifact/performance-baseline
  - version/0.2.0-harmony
  - platform/harmonyos
prior_version: "v0.1.0-harmony (沙箱内未测, 真机数据待用户填充)"
---

# Performance Baseline — Wordaydream v0.2.0-harmony

> 沙箱约束: 本机无 DevEco Studio / 鸿蒙真机. 性能数据由用户在真机内填充. 目标值来自 SPEC contract.

## 指标 1: ArkWeb 首屏加载时间

| 场景 | v0.1.0 实测 | v0.2.0 目标 | v0.2.0 实测 | 状态 |
|------|------------|------------|------------|------|
| 冷启动 (first paint) | TBD (真机) | < 2s | TBD | 待测 |
| 热启动 (first paint) | TBD (真机) | < 1s | TBD | 待测 |

**测量方法**: ArkWeb controller onPageBegin / onPageEnd 时序, 或 Web 端 performance.now() 在 main.tsx 入口 + React render 完成.

## 指标 2: rateCard → upsertCard 同步延迟 (fire-and-forget)

| 场景 | v0.2.0 目标 | v0.2.0 实测 | 状态 |
|------|------------|------------|------|
| rateCard 触发 upsertCard (单卡) | < 50ms | TBD | 待测 |
| upsertCard 阻塞主流程? | 不阻塞 (fire-and-forget) | TBD | 待测 |

**测量方法**: Web 端 `performance.mark()` 在 rateCard 调用前后 + harmonyBridge.upsertCard resolve 时间.

**沙箱内验证**: vitest T09 (Stage 3) 已验证 fire-and-forget 不阻塞主流程 (mock bridge reject → rateCard 仍返回正确 card).

## 指标 3: getAllCards rehydrate 延迟 (大数据量)

| 卡片数量 | v0.2.0 目标 | v0.2.0 实测 | 状态 |
|---------|------------|------------|------|
| 100 张 | < 100ms | TBD | 待测 |
| 500 张 | < 250ms | TBD | 待测 |
| 1000 张 | < 500ms | TBD | 待测 |

**测量方法**: 鸿蒙端 MemoryCardStore.getAllCards() SELECT * FROM table ORDER BY due ASC, 在 ArkTS 内 console.time/timeEnd.

**沙箱内验证**: vitest T07 (Stage 3) 验证 SQL 字符串包含 "ORDER BY due ASC" (排序逻辑正确), 真机 RDB 性能未测.

## 指标 4: 服务卡片 aboutToAppear 延迟

| 场景 | v0.1.0 实测 | v0.2.0 目标 | v0.2.0 实测 | 状态 |
|------|------------|------------|------------|------|
| 2*2 卡片 aboutToAppear | TBD (真机) | < 200ms | TBD | 待测 |
| 2*4 卡片 aboutToAppear | TBD (真机) | < 300ms | TBD | 待测 |

**测量方法**: ArkUI FormExtensionAbility aboutToAppear 开始 + CardDataProvider 异步方法全 resolve 完成时间.

## 指标 5: CSP 启用后 LLM SSE 流式延迟变化

| 场景 | v0.1.0 (无 CSP) | v0.2.0 (含 CSP) | 退化 % | 状态 |
|------|----------------|----------------|--------|------|
| LLM Proxy SSE 首 token 延迟 | TBD (真机) | TBD (真机) | < 10% | 待测 |
| LLM Proxy SSE 完整响应时间 | TBD (真机) | TBD (真机) | < 10% | 待测 |

**测量方法**: 真机 LLM 请求 `POST /api/llm` (stream: true), Web 端 performance.now() 在 fetch 开始 + 第一个 SSE event + 完整响应结束.

**沙箱内验证**: vitest T15 (Stage 2) 验证 CSP meta 标签存在于 rawfile/dist/index.html (CSP 已注入), SSE 流式延迟真机未测.

## 风险 (真机验证项)

| ID | 风险 | 沙箱状态 | 真机验证步骤 |
|----|------|---------|------------|
| R-D2-3 | ArkWeb localStorage 清理时机不可预测 | rehydrate 逻辑已实现 (Stage 3) | 1. 鸿蒙真机安装应用, 添加几张卡片; 2. 系统设置 → 应用 → wordaydream → 清除存储; 3. 重启应用, 验证卡片是否通过 getAllCards rehydrate 恢复 |
| R-D4-1 | CSP 破坏 LLM SSE 流式 | CSP meta 已注入 (Stage 2) | 1. 真机配置 LLM Proxy URL; 2. 发起一次 LLM 对话 (stream: true); 3. 验证 SSE 流式 token 正常推送 |
| R-D4-2 | origin 白名单误拦截 ArkWeb rawfile | Index.ets origin check 已实现 (Stage 2) | 1. 真机启动应用; 2. 检查 hilog 是否出现 'Origin whitelist rejected'; 3. 若出现, 检查 accessedUrl() 实际返回值并调整白名单 |
| R-D3-1 | 60min 系统刷新限制无法实时更新 | emitter 5min 节流已实现 (Stage 4) | 1. 添加桌面服务卡片; 2. 在应用内 review 一张卡片; 3. 5 分钟内观察卡片是否更新 dueCount |
| R-D5-1 | API 18 不兼容 API 12 deprecated API | 兼容性矩阵已检查 (Stage 1) | 1. 真机安装 HAP; 2. 验证 atomicService / form / notification 全部功能正常 |

## 测量工具清单 (真机)

- DevEco Studio Profiler (ArkWeb 性能 trace)
- hilog (filter: wordaydream / HarmonyBridge / MemoryCardStore / ReviewCardWidget)
- Web 端 performance API (performance.mark / measure)
- 鸿蒙 RDB 工具 (检查 wordaydream_memory.db 数据完整性)

---

**最后更新**: 2026-07-27 v0.2.0-harmony Stage 5 (沙箱内验证完成, 真机数据待用户填充)
