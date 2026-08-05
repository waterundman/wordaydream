# 执行历史 — Wordaydream v0.1.0-harmony

## 迭代信息
- 版本: 0.1.0-harmony
- 版本类型: feature/migration
- 开始时间: 2026-07-24
- 结束时间: 进行中 (4/8 Stages PASS)

## Phase 执行状态

### Phase 0: 全量审查 — 已完成
- 4 维度并行 search agent 审查 (架构/类型/UX/功能)
- 输出 audit-report-v0.1.0-harmony.md
- 识别 4 项阻塞 (H-1 speechSynthesis / H-2 installPrompt / H-3 SW注册 / H-4 CORS)
- 3 项技术路径调研 (ArkTS原生 / Web容器 / RN-Harmony / Flutter)
- 决策矩阵选定方案 B (Web 容器 + 原生能力)

### Phase 1: 规划 — 已完成
- SPEC 生成: spec-v0.1.0-harmony-main.md
- 用户确认 8 Stages 全选
- Bayesian Plan: bayesian-plan-v0.1.0-harmony.md
- 整体先验置信度: 0.72
- 5 轮串行执行 (Round 1: S1 / Round 2: S2+S3 / Round 3: S4 / Round 4: S5→S6+S7 / Round 5: S8)

### Phase 3: 执行 — 4/8 Stages 完成

#### Stage 1: 鸿蒙工程脚手架 + DevEco Studio 项目 — PASS
- 17 files created in harmony/
- harmony/build-profile.json5 (debug + release 签名占位)
- harmony/entry/src/main/module.json5 (atomicService / installationFree: true)
- harmony/entry/src/main/ets/entryability/EntryAbility.ets (UIAbility + loadContent)
- harmony/entry/src/main/ets/pages/Index.ets (ArkWeb + rawfile 加载)
- vite.config.ts 新增 build:harmony target (outDir: rawfile/dist)
- ArkTS 无 any / 无对象字面量类型 / 无 var
- vitest 643/643 PASS / tsc 0 errors / build + build:harmony 双成功

#### Stage 2: PlatformCapability 抽象 + Web 端条件降级 — PASS
- 9 new files + 4 modified files in src/platform/
- PlatformCapability interface (isHarmonyOS / supportsServiceWorker / supportsSpeechSynthesis / supportsInstallPrompt / getNativeBridge)
- detect.ts 单例缓存, 通过 navigator.userAgent 检测 ArkWeb
- HarmonyBridge TS interface stub + window.harmonyBridge 全局类型
- 三个降级点覆盖: InstallPromptButton / ReadingSessionPage speechSynthesis / main.tsx SW 注册
- swRegistration.ts 抽取提升可测性
- vitest.config.ts pwaRegisterStubPlugin 镜像 harmonyPwaStubPlugin 模式
- T01-T07 全 PASS / vitest 653/653 / tsc 0 errors

#### Stage 3: JSBridge 双向通信层 — PASS
- 3 new files + 3 modified files
- ArkTS HarmonyBridge.ets class: preferences + vibrator 真实实现
- getDueCardsCount + registerReminder Stage 6/7 占位 (try/catch + hilog 兜底 + 技术注释)
- EntryAbility controller 共享问题解决: Index.ets .onControllerAttached 回调注册 HarmonyBridge
- useMemoryStore rateCard 后 fire-and-forget registerReminder (.catch 兜底)
- T01-T06 全 PASS / vitest 656/656 / tsc 0 errors / build + build:harmony 双成功
- 已知偏差: SPEC assert 期望 getDueCardsCount/registerReminder 在 Stage 3 完整实现, 实际按 plan 分阶段到 Stage 6/7
- 风险: module.json5 未声明 VIBRATE 权限 (Stage 5 元服务配置时补充)

#### Stage 4: LLM Proxy 独立部署 + 完整功能对等验证 — PASS
- 12/12 deliverables 齐全
- harmony/server/llm-proxy.js (528 行, ESM + express)
  - GET /health + POST /api/llm + POST /api/llm-proxy 别名 + OPTIONS 预检
  - 3 providers (deepseek/openai/anthropic) 真实 fetch 调用, 非 mock
  - SSE pipeSSEStream 完整实现 (OpenAI/DeepSeek + Anthropic 双格式)
  - CORS 白名单: localhost + 127.0.0.1 + arkweb:// + *.hapogo.com + file:// (SPEC 允许的扩展)
  - 速率限制 60 req/min/IP + withRetry 重试机制
- harmony/server/package.json (独立, name=wordaydream-harmony-llm-proxy, type=module)
- harmony/server/.env.example + README.md + deploy-huaweicloud-functiongraph.md
- harmony/FEATURE_PARITY_CHECKLIST.md (14 feature 模块 + 每模块 5-10 验收点)
- src/__integration__/harmony-*.test.ts* (4 文件: llm-proxy / feature-parity / indexeddb-persistence / theme-parity)
- e2e/harmony.spec.ts (H01-H08 主流程 + H09-H11 ARKWEB-ONLY skip)
- playwright.harmony.config.ts (375x812 viewport, ArkWeb UA, hasTouch)
- vite.config.ts VITE_LLM_PROXY_URL_HARMONY 通过 loadEnv+define 静态注入
- .env.harmony.example
- 6-dimension 验证全 PASS: tsc 0 / vitest 857/857 / build Web 952ms + Harmony 847ms / DIM6 dev server 200
- LLM Proxy 实测独立启动: PORT=3099 node llm-proxy.js + /health 200 OK
- _rgt_signal: GREEN (无 stub / 无 TODO/FIXME / 真实 fetch + 真实 SSE)
- confidence.posterior: 0.95 (SPEC prior=0.80, 大幅超出预期)

### Phase 4: 验证 — 已完成 (Stage 1-4)
- Stage 1: 6-dim PASS, _rgt GREEN
- Stage 2: 6-dim PASS, _rgt GREEN
- Stage 3: 6-dim PASS, _rgt GREEN
- Stage 4: 6-dim PASS, _rgt GREEN, posterior 0.95

### Phase 5: 同步 — 进行中
- L1 status.md 镜像已更新 (bayesian-status-v0.1.0-harmony.md)
- L2 plan.md 镜像已更新 (Stage 4 PASS / posterior 0.95 / tdd_state GREEN)
- L3 history.md 镜像已创建 (本文件)
- Vault 同步待用户手动执行 (vault 路径不在主 session 写权限内)

## 反思记录

### 反思 1: controller 共享是 ArkWeb JSBridge 集成的关键陷阱
Stage 1 在 EntryAbility.onWindowStageCreate 调用 registerJavaScriptProxy 静默失败, 原因是 controller 未与 Web 组件共享. Stage 3 通过 Index.ets 的 Web 组件 .onControllerAttached 回调注册 HarmonyBridge 解决. ArkWeb 的 controller 必须通过 Web 组件的回调获取, 而非独立 new WebviewController().

### 反思 2: ESM 与 CommonJS 在独立 Node.js 服务中的混淆风险
Stage 4 初版 llm-proxy.js 使用 require() (CommonJS) 但 package.json type=module (ESM) 不一致. 修正为 ESM import/export 后启动正常. 独立 Node.js 服务必须确保 type 字段与 import 语法一致.

### 反思 3: Zustand 持久化测试需要保存-还原 localStorage
Stage 4 测试 useSettingsStore theme 跨 reload 持久化时, resetAll() 会把默认值写入 localStorage 覆盖原值. 修正为先保存 localStorage 内容, reset 后还原, 再 rehydrate. reloadStoreFromStorage 工具函数成为后续 10 个 store 持久化测试的通用模式.

### 反思 4: review session mode 在 rehydrate 后回退到 completed
useMemoryStore 在无 due cards 时 rehydrate 会把 review session mode 重置为 completed. 测试必须先 addMemoryCard 再断言 mode 持久化. FSRS 调度状态依赖 due cards 存在性, 测试 setup 必须模拟业务数据.

### 反思 5: PowerShell 不支持 VAR=value command 语法
PowerShell 启动独立服务时 PORT=3099 node llm-proxy.js 会报错. 必须用 $env:PORT='3099'; node llm-proxy.js 语法. 这与 Linux/macOS shell 不同, 在跨平台 subagent dispatch 中需要明确说明.

## 校准日志

| 校准项 | prior | posterior | 偏差 | 原因 |
|--------|-------|-----------|------|------|
| Stage 1 confidence | 0.85 | 0.85 | 0 | 工程脚手架无意外 |
| Stage 2 confidence | 0.80 | 0.85 | +0.05 | 降级点抽取 swRegistration 提升可测性, 超出预期 |
| Stage 3 confidence | 0.75 | 0.80 | +0.05 | controller 共享问题解决后稳定性提升 |
| Stage 4 confidence | 0.80 | 0.95 | +0.15 | LLM Proxy 完整实现 + 3 providers 真实 fetch + SSE 双格式, 远超 SPEC |

---

**最后更新**: 2026-07-24 v0.1.0-harmony Stage 4 PASS
**下一步**: 推进 Stage 5 (元服务 Atomic Service 配置)
