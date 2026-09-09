---
title: "HarmonyOS Tech Paths Research"
date: "2026-07-24"
version: "0.1.0-harmony"
project: "Wordaydream"
tags:
  - artifact/cache
  - type/research
---

# 鸿蒙移动版技术路径调研报告

> 调研范围：HarmonyOS NEXT（API 12+）、DevEco Studio 5.0+、ArkWeb、RNOH、Flutter-OH
> 调研日期：2026-07-24
> 项目特征：React 19 + TS + Vite 8 + Zustand 5 + ts-fsrs，100+ 组件、10 个持久化 store、LLM 集成、IndexedDB 离线优先 PWA

## 决策矩阵

| 维度（权重） | 方案 A 原生 ArkUI | 方案 B Web 容器 ⭐ | 方案 C RNOH | 方案 D Flutter-OH |
|---|---|---|---|---|
| 复用率 | 15-25% | **85-95%** | 40-55% | 0-5% |
| MVP 工时 | 14-20 周 | **3-6 周** | 8-12 周 | 16-24 周 |
| 性能 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| 生态成熟度 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐ |
| 长期维护 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐ |
| 鸿蒙特性集成 | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐ | ⭐⭐ |
| ts-fsrs 复用 | 中（需 patch）| **高（直接跑）** | 高 | 零（Dart 重写）|
| IndexedDB 复用 | 零 | **高（SW+cann8.0+）** | 零 | 零 |
| Zustand 复用 | 零 | **高** | 高 | 零 |
| LLM/SSE 复用 | 低（重写）| **高** | 中 | 零 |
| 加权总分（教育/离线/LLM 导向）| 3.7 | **4.4** | 2.8 | 2.9 |

> 加权说明：复用率(25%) + MVP 工时(20%) + 鸿蒙特性(15%) + 性能(15%) + 长期维护(15%) + 生态(10%)

## 推荐方案：方案 B（Web 容器）+ 长期演进至 B+A 混合

### 核心理由

1. **复用率压倒性优势**：Wordaydream 的核心资产——ts-fsrs 算法、10+ Zustand store、100+ React 组件、IndexedDB 离线层、LLM 调用链——在 ArkWeb 中几乎原样可跑。ArkWeb 支持 Service Worker（cann8.0+）+ IndexedDB，离线优先架构无需重写。

2. **教育类应用对原生性能不敏感**：Wordaydream 是内容为主的应用（词汇卡片、复习流、LLM 对话），无高频游戏级渲染、无超大列表实时滚动压力。

3. **MVP 速度最快**：把 Vite 产物打包进 HAP，本地 `rawfile` 加载首屏，即可上线验证鸿蒙端用户价值。

4. **风险可控**：业务逻辑不重写，回归测试成本低；Web 端持续迭代可同步反哺鸿蒙端。

### 长期演进路径

MVP 验证后，针对鸿蒙差异化能力逐步引入原生 ArkUI 模块：
- **服务卡片/桌面复习卡片**：用 ArkUI 原生实现（v0.1.0-harmony 已纳入 Stage 6）
- **HarmonyOS 推送**（复习提醒）：原生实现 + 桥接（v0.1.0-harmony 已纳入 Stage 7）
- **原子化服务/元服务**：免安装 + 分享卡片（v0.1.0-harmony 已纳入 Stage 5）
- 最终形态：主应用 Web 容器 + 关键页面/卡片原生 ArkUI，ts-fsrs 与 store 双端共享

### MVP 前置验证项（需 Spike 确认）

1. **ArkWeb IndexedDB 持久化可靠性**：实测数据是否随系统清理丢失，必要时降级为 JSBridge → relationalStore
2. **Service Worker 离线缓存**：cann8.0+ 设备覆盖率，离线包是否生效
3. **LLM SSE 流式**：ArkWeb 内 EventSource 是否可用，降级方案为可读流手动解析
4. **应用商店审核**：补充原生价值（服务卡片 + 推送 + 元服务），避免被判定纯套壳

## 不推荐方案

- **方案 C（RNOH）**：Meta 官方不背书 + 版本滞后 + 大列表性能差，长期风险最高
- **方案 D（Flutter-OH）**：现有代码零复用，等于全量重写，与"迁移现有产品"目标背离
- **方案 A（纯原生）**：复用率过低、周期过长；但作为长期演进的"原生模块补充层"是必要的（v0.1.0-harmony 已纳入服务卡片 + 推送的 ArkUI 实现）

## MVP 阶段功能模块移植优先级

按"用户价值 × 复用难度"排序，v0.1.0-harmony 一次性完成全部 14 个 feature 模块（用户已确认完整功能对等）：

1. 壳工程 + 离线包（Stage 1）
2. PlatformCapability 抽象 + 条件降级（Stage 2）
3. JSBridge 双向通信（Stage 3）
4. LLM Proxy 独立部署 + 14 模块功能对等（Stage 4）
5. 鸿蒙元服务（Stage 5）
6. ArkUI 服务卡片（Stage 6）
7. HarmonyOS 推送（Stage 7）
8. 打包发布 + E2E + 性能基线（Stage 8）

## 关键参考资料（2025-2026）

- HarmonyOS NEXT ArkUI/ArkTS（API 12+/23+）、DevEco Studio 5.0+ — 华为官方文档
- ArkTS 适配规则（arkts-no-typing-with-this / 不支持 any / 对象字面量类型 / var / in / 导入断言等）
- ArkWeb Service Worker 支持（cann8.0+）、WebAbility PWA 迁移、JSBridge 双向通信
- RNOH 0.77.1 适配（atomgit/华为共建，Meta 官方未支持）
- Flutter-OH 3.27.5-ohos-1.0.0、2026 路线图
- 性能对比基准：ArkUI 启动最快/内存最低；Flutter-OH 渲染 FPS 接近但内存高
- HarmonyOS 持久化三件套：preferences / relationalStore / distributedDataObject
- 状态管理 V1→V2：@State/@Observed/@ObjectLink/@Provide/@Consume/AppStorage/LocalStorage/PersistentStorage
- 服务卡片/原子化服务/元服务（API 12 跨设备卡片开发实战）
