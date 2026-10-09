# Wordaydream 鸿蒙版本当前状态

> 更新日期：2026-09-30
> 本文档描述当前工作树，是鸿蒙端版本口径、SDK、桥接契约、测试与构建数字、能力状态和验证证据的**唯一数字真源**。`harmony/README.md`、`FEATURE_PARITY_CHECKLIST.md`、`RELEASE_CHECKLIST.md`、`PERFORMANCE_BASELINE.md`、`app-market/README.md` 与 `docs/vault/` 下的阶段报告不再各自维护这些数字，只保留自身职责并链接到本文。`README.md` 中原有的 “Stage 1 / API 12” 内容是早期历史记录，不代表当前工程状态。

## 1. 当前结论

Wordaydream 的鸿蒙端不是 ArkUI 全量重写，而是一个 **HarmonyOS 6.0.2 / API 22 的混合应用**：

- React 19 + Vite 8 负责主要产品界面和学习业务；Harmony 构建把 Web 产物写入 HAP 的 `rawfile/dist`。
- ArkTS `EntryAbility` 以 ArkWeb 加载打包内容，并通过受控 JavaScriptProxy 提供原生能力。
- 原生层负责 RDB、Preferences、振动、通知、TTS、服务卡和鸿蒙启动参数；Web 层继续负责阅读、评估、FSRS 复习、词表、课程、成就和统计等核心体验。
- 工程采用 Stage 模型，模块类型是 `entry`，设备范围是 phone、tablet、2in1，并启用了免安装入口。

当前已经达到“可完整构建、API 22 模拟器可启动并渲染首页、核心桥接链路有自动测试”的阶段，但还不能称为完成真机验收：签名、真机运行和部分系统开放能力仍缺少外部条件。

## 2. 工程基线

| 项目 | 当前事实 |
|---|---|
| 目标系统 | HarmonyOS 6.0.2 |
| compatible / target SDK | `6.0.2(22)` / `6.0.2(22)` |
| 工程模型 | Stage 模型，单 `entry` 模块 |
| DevEco Studio | `6.0.2.660`，安装于 `D:\DevEco Studio` |
| DevEco Node | `18.20.1` |
| Hvigor | `6.22.7` |
| ohpm | `6.0.1` |
| 应用版本 | 单一版本真源（仓库根包 `3.6.4=harmony major+2`）；AppScope `1.6.4`、entry `1.6.4` 与之对齐，由 `scripts/check-version-alignment.mjs` 自动校验；v3.0.0 起 harmony 跨入 major 1.0.0，versionCode 线性规则（`VERSION_CODE_BASES[1]`）为 `1000035 + minor*5 + patch*5`，实测 `1000085`（v1.6.4 S5 收口，上次发布 `1000075`）。`harmony/build-profile.json5` 的 `app` 段**不含版本字段**，校验器按「无版本字段, 跳过」处理（不新增非 schema 字段） |
| 原生权限 | `ohos.permission.INTERNET`、`ohos.permission.VIBRATE` |
| 签名 | `signingConfigs` 为空；当前只能生成 unsigned HAP |
| 模拟器 | `nova 16 Pro`、HarmonyOS 6.0.2（API 22）；content-ready unsigned HAP 已覆盖安装，冷启动、显式内容 ACK、首页渲染和热启动 FIFO 通过。Wave 1（2026-09-26）运行时复证已当日补齐（A1–A7 全 PASS，见 §5）。**v1.6.3 S1 委托拆分的运行时复证已于 2026-10-09 补齐：对当前工作树重建的 v1.6.4 HAP 执行 `verify:harmony-runtime`，A1–A7 全 PASS（含 A4 经 `delegates/CardBridgeDelegate` 的 `getAllCards done: count=5` 与 A7 复习页真实到达），冷启动 388 ms / PSS 138496 KB 同步采集** —— 见 §5 v1.6.4 两条目。**口径更正**：原文「v1.6.4 未改动 `harmony/entry/src/**`」不成立 —— 工作树相对 HEAD 的 `harmony/entry/src/**` 差异（桥 façade + 4 个委托 + `Index.ets` 色值资源引用 + `base/dark/element/color.json`）与 v1.6.3 S1 属**同一批未提交改动**，无法按版本切分；该批现已整体通过运行时复证，但仍须整体提交，半提交会使委托目录与守卫测试脱钩 |

关键路径：

```text
React/Vite source (src/)
  -> npm run build:harmony
  -> harmony/entry/src/main/resources/rawfile/dist/
  -> ArkWeb pages/Index.ets
  <-> JavaScriptProxy HarmonyBridge
  -> ArkTS system services / RDB / Preferences / FormExtensionAbility
```

## 3. 能力矩阵

状态含义：**已实现**表示源码链路和相关自动测试存在；**受限**表示实现受系统权限、产品能力或设备验证约束；**未闭环**表示仍有明确工程工作。

| 能力 | 状态 | 当前实现与边界 |
|---|---|---|
| ArkWeb 容器 | 已实现 | 以严格的 `https://app.wordaydream.invalid/index.html` 虚拟同源入口呈现 HAP 内 `rawfile/dist`；只映射白名单路径并设置明确 MIME，同源非法请求本地返回 404/405、不会回落公网。关闭文件访问，阻止非入口主页面和子 frame 导航，提交非可信文档时立即注销原生代理。原生加载层只在 React 提交可见内容并显式发送 content-ready ACK 后撤下；12 秒未收到 ACK 或关键资源加载失败时展示错误与重试入口。Harmony 已恢复标准 ESM、路由/CSS 分包、modulepreload 与同源 module Worker。 |
| JavaScriptProxy | 已实现 | API 22 同步/异步方法分组集中在 `BridgeMethodRegistry.ets`（该方法清单是唯一真源）；同步 4 项、异步 16 项，与 §5 桥接注册表快照一致。异步方法的复杂返回值一律以 JSON 字符串回传（API 22 webview 的 async JSProxy 对象/数组回执不可用，见 `docs/vault/v1.6.0-EMULATOR-VERIFY-REPORT.md`）。启动处理 ready 与 React content-ready 使用相互独立的 ACK，避免仅完成模块初始化便误判页面已可见。 |
| Web 主业务 | 已实现 | 阅读、LLM 评估、词典/语法、FSRS 复习、词表、课程、成就、连续学习和统计继续复用 React 代码。 |
| RDB 卡片镜像 | 已实现 | 并发初始化共用 Promise；所有操作等待存储就绪；ResultSet 在 `finally` 关闭；删除按 Web Map 的 `lexemeGroupId` 对齐。 |
| Preferences | 已实现 | 原生白名单读写并向 Web 暴露异步桥接。 |
| 原生 TTS | 已实现，待设备验收 | 支持朗读、停止、引擎可用性和引擎列表；处理并发创建、旧请求取消和 Ability 销毁时释放。 |
| 振动 | 已实现，待真机验收 | 通过同步桥接触发，模块已声明 VIBRATE；模拟器不能证明真实触觉反馈。 |
| 冷/热启动分发 | 已实现，运行验证通过 | `onCreate` / `onNewWant` 共用入口；原生队列等待 Web 显式 ready，Web 端再用持久 FIFO 等待 RDB 恢复。模拟器已实时捕获 `onNewWant -> queued -> dispatched remaining=0`。 |
| `action=startReview` | 已实现，部分运行验证 | 分享、服务卡或通知可唤起复习；会等待原生卡片恢复并选择可用语言。当前无到期卡片的模拟器热启动保持首页且无异常，尚未覆盖有到期卡片的实际跳转。 |
| `action=debugSeed`（运行验证） | 已实现（仅 debug 构建） | `hdc shell aa start --ps query action=debugSeed` 在原生 RDB 预置 5 张到期卡（3 en + 2 de，due=now-1h，幂等）；`applicationInfo.debug` 守卫使 release 构建直接跳过，且该 query 不在 Web 派发白名单内。配套 `scripts/harmony/seed-and-verify.mjs` 自动断言 RDB 恢复 → FIFO → 复习页日志链。 |
| `action=openCard` | 已闭环 | 2*4 卡片词位区点击 → 携带 `action=openCard&cardId=<id>` 拉起 App → 复习会话 `jumpToCard` 定位（Web 域层 openCard 行为表 + 原生 `nextCardId` 同源推送）；运行验证脚本已含 openCard 断言（seed-and-verify A6/A7），模拟器在线即可执行 |
| 服务卡 | 已实现主动刷新闭环，跨进程待运行验证 | 正规 `FormExtensionAbility` 支持创建、系统更新、尺寸变化和移除；`FormIdStore` 持久化 formId 集合，复习完成后 `notifyReviewCompleted` 经 `FormRefresher.refreshAllForms` 主动 `updateForm` 推送最新到期/今日统计（失败静默降级）。跨进程实际刷新行为待模拟器/真机验证。 |
| 元服务分享入口 | 已实现配置，待设备验收 | `share_card.json` 指向 `pages/Index`，默认触发 `action=startReview`。 |
| 到期通知 | 权限产品流程已实现 | 已到期请求可发布普通本地通知并携带复习 Want；设置面板通知开关首次开启时经 `requestNotificationPermission` 触发系统授权弹窗（granted/denied/error 三态），denied/error 时 UI 显示引导提示。 |
| 未来定时提醒 | 安全降级 + 代码就绪 | `ReminderAgentService` 已封装发布去重、取消与启动对账恢复（`getAllValidReminders` 对账，过期条目自动清理）；未配置 `reminderAgent` 开放能力、`PUBLISH_AGENT_REMINDER` 与签名 Profile 时，`isSupported()` 探测失败 → 全部 API 返回 `{skipped:true}`，未来通知/提醒继续被安全跳过，绝不误发布。权益开通后即插即用。 |
| 远程 LLM | 受配置限制 | 模块已有 INTERNET 权限，Harmony 构建会从同一 URL 注入前端代理地址和 CSP origin；仓库当前没有 `.env.harmony`，所以远程代理尚未形成可运行配置。 |
| PWA / Service Worker | 不适用 | Harmony 构建主动禁用 PWA 和 HTTP `.br` / `.gz` sidecar；ArkWeb 使用 HAP 内 rawfile，不依赖 Web 服务器语义。 |

## 4. 本轮结构与技术债改进

### 4.1 v1.6.3 — B1 上帝文件拆分 + HAP 体积归因闭环 + E2E 矩阵收缩（2026-09-29）

**S1 — B1 上帝文件拆分（`HarmonyBridge.ets` → facade + 4 域委托）**

- 拆分前 `bridge/HarmonyBridge.ets` **1170 行**（20 个契约方法 + FIFO 启动队列 + 单例生命周期 + 触感）；拆分后 **533 行 facade**，只保留单例 / `refreshContext` / 契约方法转发 / launch 域 / `triggerHapticFeedback`。
- 低风险纯请求-响应域下沉到 `bridge/delegates/`（实现逐字迁自拆分前，语义不变）：
  - `CardBridgeDelegate.ets`（288 行）—— upsertCard / deleteCard / getAllCards / getAllCardsRaw / getRecentlyReviewedCards / getTodayReviewStats / getDueCardsCount
  - `PrefsBridgeDelegate.ets`（146 行）—— readPreferences / writePreferences
  - `SpeechBridgeDelegate.ets`（168 行）—— speak / stopSpeech / isSpeechSupported / getSpeechEngines
  - `NotifyBridgeDelegate.ets`（280 行）—— registerReminder / notifyReviewCompleted / requestNotificationPermission / scheduleReviewReminder / cancelReviewReminder
- **契约面不变**：`BridgeMethodRegistry.ets` 仍是唯一方法真源，20 个方法名与签名逐字保留；`Index.ets` 的 `registerJavaScriptProxy` 按名反射 facade 实例，桥接注册面零改动。
- **context 同源刷新**：facade 的 `refreshContext` 同源刷新所有持 context 的委托（Card / Prefs / Notify），委托不自持陈旧 context；`SpeechBridgeDelegate` 无 context（TTS 为无 context 单例）。
- **launch 域留在 facade**（执行期偏离 SPEC §3 S1 列出的可选 `LaunchQueueDelegate`）：FIFO 启动队列与冷启动链路强耦合，且 `runJavaScript` 超时复位、`pendingLaunchQueries` 上限（16）行为须逐字不变，故不抽取。
- `pages/Index.ets` **未做结构抽取**（508 行，与拆分前等长）；本轮仅把加载/错误层的硬编码色值改为 `$r('app.color.*')` 资源引用（属设计 token 收敛，非拆分）。
- 原生 `.ets` 规模：**25 个文件 / 5813 行**（拆分前 21 个文件；新增 4 个委托，facade 变薄）。
- **安全守卫测试适配**：4 个静态守卫测试的读取路径改指委托文件，**断言文本逐字不变**——`harmony-widget.test.ts` → `CardBridgeDelegate`；`cardDataProvider.test.ts` / `reminderAgentSafety.test.ts` → `NotifyBridgeDelegate`；`textToSpeechService.test.ts` → `SpeechBridgeDelegate`。

**S3 — HAP 体积归因闭环（两个历史欠账清零）**

- 新增归因工具 `scripts/attribute-hap-size.mjs`（自读 zip central directory `0x06054b50` / `0x02014b50`，逐条目压缩体积）+ 单测 `scripts/attribute-hap-size.test.mjs`（7 项，含归一化反向用例与碰撞回退）。三项必要修正：剥离 Vite 内容 hash、hash 判定须含大写/数字、归一化碰撞回退原名。
- 通过 3 个 worktree（v1.6.0 `f26f613` / v1.6.2 `d247f9d` / Wave 1 `73a94ab`）+ junction 复用依赖做到同环境重建，定位两笔欠账的**共同根因**：记录 v1.6.2 产物时 `ets/sourceMaps.map`（129,676 B）未进包。
- 结论：Wave 1 记录增量 **+133,600 B** → 真实源码级 **+15,270 B**（70% 来自新增 `harmony-chunk-graph.json` sidecar）；v1.6.2 记录 **−249,171 B** → 真实源码级 **−120,062 B**（与预测 −122.2 KB 吻合到 1.8 KB）。**两个未归因数字 = 0**。详见 `docs/vault/v1.6.3-HAP-SIZE-ATTRIBUTION-REPORT.md`。

**S4 — E2E 矩阵收缩（决策落地）**

- 默认与 CI 只跑 chromium（产品目标平台 ArkWeb/Chromium 内核 + 桌面 Chrome）；firefox / webkit / mobile-chrome 降级为手动 opt-in（`E2E_FULL_MATRIX=true`）。`playwright.config.ts` 与 `.github/workflows/playwright.yml` 已同步（CI 的 `playwright install` 只装 chromium）。定性依据见 `docs/vault/v1.6.2-WAVE1-TECHDEBT-REPORT.md` §3.1（webkit ×6 + firefox ×1 均为 webkit-on-Windows 能力差异，非本项目回归）。

**验证层级**：S1 落在 API 22 运行链路上，2026-09-29 当轮模拟器离线，只到「自动测试 + HAP 编译通过」层级；**2026-10-09 已对当前工作树重建的 HAP 补跑 `verify:harmony-runtime`，A1–A7 全 PASS**（详见 §5 v1.6.4 运行时复证条目与 `harmony/docs/reports/seed-report-v164-runtime.json`）。

### 4.2 Wave 1 — API 22 通道收敛、死代码清除与构建链加固（2026-09-26）

- **复杂返回通道统一**：`getRecentlyReviewedCards` / `getTodayReviewStats` / `getSpeechEngines` 由返回对象/数组改为返回 JSON 字符串，与已实证的 `getAllCards` 走同一可用通道；Web 侧消费者同步解析。
- **卡片恢复通道合并**：`useMemoryStore.ts` 的原生推送接收器与 `getAllCards` 拉取兜底抽出共用 `applyRestoredCards`；`window.__applyNativeCardRestore` 进入 `declare global` 并标注 `TODO(API22)`，说明 async JSProxy 修复后可撤。
- **原生健壮性**：`runJavaScript` 派发加超时复位，`pendingLaunchQueries` 设上限（16），防止 FIFO 永久卡死；`HarmonyBridge` 单例新增 `refreshContext`，供 Ability 重建时刷新 context。
- **契约防漂移**：`bridgeRegistry.test.ts` 改为解析 `.ets` 数组字面量并与 TS 侧方法名做双向集合断言（不再写死计数）；新增 `harmonyOriginSync.test.ts` 守护三份 ArkWeb origin 白名单一致；为 `bridgeInputValidator` 补 `.ets` 镜像对照测试。
- **死代码清除**：删除 `EntryAbility.ets` 的 emitter(10001) 服务卡刷新死链（跨进程无订阅者；真实链路 `notifyReviewCompleted` → `FormRefresher` → `updateForm` 保留）；删除 `NotificationService` 中未来触发的死逻辑 `computeTriggerAt` / `applyWindow`（改为 `isInNotificationWindow` 判定）；删除 `BridgeInputValidator.isAllowedArkWebOrigin`、`harmonyCsp.injectConnectSrcOrigin` 与 Web 侧零调用桥 wrapper；`speak` 不再向 Web 抛异常。
- **结构**：卡片多语言文案抽到新文件 `widget/CardTextFormatter.ets`（单一真源），尺寸口径抽到 `widget/CardFormDimension.ets`（`FormDimension` 枚举/常量）；`MemoryCardStore` 提取 `withResultSet` 泛型助手统一 ResultSet 生命周期；`FormIdStore` / `ReminderAgentService` 对齐 init 失败复位模式；提醒文案 i18n 走 `notification/templates.ets`。
- **日志脱敏**：`Index.ets` 的 `onConsole` 只转发 warn/error 或诊断前缀并截断；原生 info 日志中的 cardId / due / formId / query 明文降级或使用 `%{private}`。受保护的运行验证日志子串（`seedDebugCards done` / `Page begin` / `Web content ready` / `Web launch handler ready` / `getAllCards done: count=` / `dispatching query` / `[harmonyLaunch] openCard`）逐字保留，不断链。
- **构建链与 CI**：`check-version-alignment.mjs` 覆盖 major≠0 盲区并新增与 `scripts/harmony/last-release.json` 的 versionCode 单调性校验；`verify-harmony-build.mjs` 优先消费新 Vite 插件导出的 `harmony-chunk-graph.json`（mapDeps 正则降为 fallback）；抽出 `scripts/harmony/lib/hdc.mjs` 去重 `seed-and-verify` / `collect-perf`，统一 `DEVECO_STUDIO_HOME` fail-fast；`package.json` 新增 `verify:harmony-runtime` / `collect:harmony-perf` / `test:harmony-scripts` 入口；`.github/workflows/netlify-deploy.yml` 的 ci job 追加纯 Node 的 `build:harmony` + verify + 脚本单测步骤。
- **验证层级**：本轮只到「自动测试 + HAP 编译通过」层级；API 22 模拟器本轮离线，`seed-and-verify` 未执行，不构成模拟器/真机通过的证据（见 §5、§8）。

### 4.3 此前轮次记录

- 移除引用不存在调试 HTML 的 `IndexDebug.ets` 和 `WebTest.ets`，页面清单只保留生产入口。
- 统一 JSBridge 方法注册表，修复 API 22 同步/异步注册差异，并限制代理暴露范围。
- 将启动处理 ready 与 React 内容提交 ACK 解耦：`onPageEnd` 不再直接撤下原生加载层；React 首次提交后发送 content-ready ACK，超时或关键资源失败时保留原生错误层并提供重试。
- 为鸿蒙启动请求增加原生代次保护和 Web 持久队列，修复冷启动、页面未就绪和 RDB 尚未恢复时的丢请求风险。
- 加固 `MemoryCardStore` 初始化和结果集生命周期，修正 `id` / `lexemeGroupId` 删除语义不一致。
- 重构 TTS 的并发、停止、错误回传和销毁流程，并同步 Web 播放状态测试。
- 把服务卡接入正规的 `FormExtensionAbility`，将数据提供与卡片 UI 分离。
- 对没有 `reminderAgent` 权益的未来提醒实施安全降级，不再把未来提醒立即发布。
- 修复 rawfile 资源的相对路径、缺失纹理和无效压缩文件；增加构建产物完整性检查。
- 曾将 Harmony 产物临时收敛为 classic 单包以定位 `resource://` opaque origin 白屏；迁移到虚拟 HTTPS 同源入口后已撤销该临时兼容层。
- 已恢复标准 ESM、路由与 CSS 分包、modulepreload、CSV/LLM module Worker；CSV 页面使用异步 Worker API，Worker 崩溃或超时会熔断并稳定降级到主线程。
- Harmony 专用 LLM 代理配置只接受设备可达且证书有效的 HTTPS URL，保持 ArkWeb MixedMode 关闭，避免明文混合内容产生“构建成功但运行被拦截”。
- 统一 Harmony LLM 代理 URL 与 CSP 的配置来源，并补充 INTERNET 权限。
- 增加 HAP 构建包装器：固定使用 DevEco 内置 Node/JBR/SDK，并扫描 Hvigor 日志，防止“日志显示失败但退出码为 0”被误判为成功；ANSI 日志识别的假阴性已修复，包装器测试 3/3 通过。

## 5. 当前验证证据

### 当前 Web / TypeScript 工作树

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | 通过（tsc 0 errors） |
| `npm run test:run` | **177 个测试文件、1655 项测试全部通过**（2026-10-09 收口轮实测；v1.6.3 基线 170/1604，v1.6.4 净增 **7 files / 51 tests**：`SettingsPanel.ia.test.tsx` +10、`CollapsibleSection.test.tsx` +11、`check-tokens.test.mjs` +8、`check-theme-parity.test.mjs` +6、`verify-wordlists.gates.test.mjs` +10、`verify-wordlists.smoke.test.mjs` +1、**`scripts/harmony/assertion-keywords.test.mjs` +5（收口轮新增）**，**零回归**） |
| `npm run lint` | 通过（oxlint 0 个警告 0 个错误，399 文件） |
| `npm run verify:wordlists` | 通过（exit 0；**`PASS 39 / EXEMPT 8 / BLOCK 0`**）。v1.6.4 S2 起校验面为 **R1–R5 字段契约 + N1–N9 数据质量闸门**：N1 例句覆盖率（每文件 ≥80% / priority=1 ≥95%）· N2 translation 非空 + 含 CJK + trim 一致 · N3 跨等级重复 lemma · N4 同等级同 pos 重复（已声明 `semanticConflicts` 的同形异义不计）· N5 例句跨词复用 · N6 弱命中率（`matchTier>=2` ≤10%）· N7 `exampleSource=unknown:*` 占比 ≤20% 且缺出处 = 0 · **N8 `courses/*.ts` 纳入校验（由 `courses/en.ts` 单文件扩为 en + de）** · N9 courses 跨模块 `targetLemma` 重复。未达标项经**显式豁免清单**（check + scope + ratchet 基线 + 理由）判定：计数 ≤ 基线打印 `EXEMPT` 不阻断，缺口超过基线即 `BLOCK`；当前 8 项豁免为 N1×3（de A2/B1/B2，待 S3 例句回填）· N3（en 719）· N5（global 582）· N6（de/a1 100）· N7（de/a1 642）· N9（en 11）。**注意：该脚本未接入任何 CI workflow（`netlify-deploy` 只跑 lint / check:versions / test:run / tsc / build），当前「可阻断」只在手动执行时生效** |
| `npm run check:tokens` | 通过（exit 0；token 闭包：168 定义 / 6 运行时注入 / 未定义引用 0；断点违规 0；`font-size` 裸 px 0）—— v1.6.4 S4 新增守护脚本 + 单测 8 项 |
| `npm run check:theme-parity` | 通过（exit 0；`tokens.css` 三块颜色 token base 54 / dark 51 / sepia 51，差集 0）—— v1.6.4 S4 新增守护脚本 + 单测 6 项 |
| `npm run verify:static-assets` | 通过（v1.6.3：7 项静态资源均已优化 —— 3 纹理 WebP、2 图标量化 PNG、2 张课程封面 WebP（Seedream 生成 + `maxWidth` 降采样），原图保留在 `assets-sources/` 回滚路径） |
| `npm run check:versions` | 通过（**web 3.6.4 / AppScope·entry 1.6.4 / versionCode 1000085**，四处对齐 + versionCode 单调性高于 `last-release.json` 的 1000075，无 WARN；`build-profile.json5` 无版本字段按「跳过」处理。已接入 CI） |
| `npm run build` | 普通 Web 生产构建通过，仍保留代码分包、module Worker 与 PWA |
| `npm run build:harmony` | 通过（2026-10-09 当前工作树实测：`[verify:harmony-build] passed (60 ESM/Worker JS, 8 CSS, 89 files, 72 local references)`，与 v1.6.3 同为 89 文件口径） |
| `npm run measure:bundle` | 2026-10-09 实测：首屏 JS **306.1 KB**（19 chunk，vs v1.6.2 基线 306.2 KB 零回退）· 全量 JS **2753.4 KB**（63 chunk，v1.6.2 为 2748.9 KB ⇒ **+4.5 KB**）· CSS **180.8 KB**（8 文件，v1.6.2 为 178.7 KB ⇒ **+2.1 KB**）· 公共静态 **639.2 KB**，其中位图 **599.3 KB / 7 文件**（`staticAssets.test.ts` 预算 640 KB，余量 6.8%）。**口径提示**：`bundle-report.json` 自 v1.6.3 清理轮起被 gitignore，故体积复核的证据链只存在于本表，仓库内不再留存报告副本 |
| E2E（`npx playwright test --project=chromium`） | **24/24 全过**（2026-10-09 在当前工作树复证，3.1m，含 build + preview）—— 基线口径 = web 20 + offline-install 4。该轮覆盖了 v1.6.4 设置面板折叠组（T03 / T06 / T07 经 `e2e/settingsPanelGroups.ts` 的 `expandAllSettingsGroups`）、课程封面（T15）与词表例句行（T20）。S4 起默认只跑 chromium，firefox / webkit / mobile-chrome 为手动 opt-in（`E2E_FULL_MATRIX=true`；注意该 npm 入口用 POSIX 内联赋值，Windows 下须改用 `E2E_FULL_MATRIX=true npx playwright test` 的 shell 形式或经 Git Bash 执行） |
| 人工三主题视觉复核 | **2026-10-09 已执行**（v1.6.4 S4 验收最后一项）：chromium 1280×900、`reducedMotion: reduce`、preview 构建，10 张截图覆盖 base / dark / sepia 首页与课程页、键盘焦点环、设置面板折叠组（收起 + 展开）、词表行 —— **无视觉回归**。新 `--color-focus`（#d97757）在 base 与 dark 下焦点环均可见且未被 `overflow: hidden` 裁切；课程封面全出血（`padding: 0`）无裁切变形；`--color-danger*` 在 FSRS 降级提示上正常生效。**未覆盖**：窄屏 / 移动端断点、阅读页释义输入面板、sepia 词表长列表 |
| 虚拟同源定向测试 | 通过（origin/path/MIME、双编码穿越和源码接线契约） |
| Harmony 构建验证器 | 9/9 通过；要求标准 ESM 入口、modulepreload、两个 module Worker、多 JS/CSS 分包、严格 CSP，并从 `index.html` 遍历依赖图拒绝缺失或不可达产物 |
| HAP 日志识别器 | 3/3 通过；能识别带 ANSI 颜色的成功与失败日志 |
| 运行验证断言关键词契约 | **已由静态复核升级为自动契约测试**（`scripts/harmony/assertion-keywords.test.mjs`，5 项，2026-10-09）：A1–A7 每条断言在证据表里钉死「文件 + 代码字面量」，清单增删或日志源改动即失败。日志源现分布 —— A1 `seedDebugCards done`(EntryAbility) · A2 `Page begin`(Index.ets) · A3 `Web content ready`(HarmonyBridge) · A4 `getAllCards done: count=`(**delegates/CardBridgeDelegate**，B1 拆分迁入) · A5 `Web launch handler ready: generation=`(HarmonyBridge) · A6 `dispatching query=action=openCard`(EntryAbility hilog 前缀 + BridgeInputValidator action 段，拼接串) · A7 `[harmonyLaunch] openCard`(harmonyLaunch.ts)。**两处设计约束**：搜索面剥除注释（EntryAbility 的 A6 说明注释原文含完整关键词，逐字匹配注释等于没有守护 —— 已实测该陷阱），A6 按分段拼接校验并要求运行时串以关键词收尾。**口径**：这仍是「关键词 ↔ 日志源」的静态一致性证据，**不能替代** `verify:harmony-runtime` 的实机日志命中 |
| 桥接注册表快照 | 同步 4 / 异步 16（真源为 `BridgeMethodRegistry.ets`；Stage 3 新增 requestNotificationPermission / scheduleReviewReminder / cancelReviewReminder）。Wave 1 起 Web 与原生两侧测试对方法名做双向集合断言，不再写死计数 |
| `npm run test:harmony-scripts` | 通过（`vitest run scripts`：2026-10-09 实测 **15 个文件 / 166 项**脚本单测全绿，覆盖 seed-and-verify / check-version-alignment / `harmony/lib/hdc` / `harmony/lib/chunk-graph` / `lib/deveco-paths` / measure-bundle / generate-en-examples / verify-wordlists.example / lint.warn / **attribute-hap-size（v1.6.3 新增，7 项）** / check-tokens（v1.6.4，8 项）/ check-theme-parity（v1.6.4，6 项）/ verify-wordlists.gates + .smoke（v1.6.4，11 项）/ **assertion-keywords（2026-10-09 新增，5 项：断言关键词 ↔ 日志源双向契约）**）。`scripts/verify-harmony-build.test.mjs` 与 `scripts/hvigor-output.test.mjs` 属 `node --test` 套件，由 `test:harmony-build-verifier`（9/9）与 `test:harmony-build-wrapper`（3/3）单独执行，已从 vitest 收集中排除 |

这些测试覆盖 Web 业务回归以及 Harmony 的桥接契约、Manifest、启动队列、CSP、静态资源、通知安全守卫、TTS 镜像和服务卡数据契约，但不能替代 Harmony 运行时测试。

### Harmony 构建层级

构建命令已经提供：

```powershell
npm run build:harmony
npm run build:harmony:hap
```

其中（**下列带日期的条目是各轮实测快照**；HAP 体积的最新实测条目为 v1.6.3，v1.6.4 本轮未执行构建，引用体积时取 v1.6.3 条目并注明版本）：

- `build:harmony` 生成 rawfile Web 资源后，检查标准 ESM 入口、modulepreload、CSP、根绝对资源路径、两个 Worker、依赖图可达性、丢失资源、source map 和 `.br` / `.gz` sidecar。
- `build:harmony:hap` 使用 `D:\DevEco Studio` 的工具链编译 API 22 HAP，并要求日志明确出现成功结果和实际 HAP 文件。
- 2026-08-13 00:07 对包含 content-ready ACK 与 12 秒失败/重试保护的最新工作树完整执行 `npm run build:harmony:hap`，进程退出码为 0；`CompileArkTS`、`PackageHap` 与 packing 均通过，Hvigor 明确报告 `BUILD SUCCESSFUL`。
- 2026-09-09 v0.5.0-harmony Stage 0-4 完整执行 `npm run build:harmony:hap`：Hvigor `BUILD SUCCESSFUL`，产物 `harmony/entry/build/default/outputs/default/entry-default-unsigned.hap`（3,845,446 bytes）。构建包装器新增 realpathSync 规范化 cwd —— hvigor 对盘符大小写敏感（`w:\` 报 "Path not found"，`W:\` 正常），现从任意大小写 cwd 启动均可构建。
- 当前产物仍未签名，但可覆盖安装到 API 22 模拟器（模拟器在线时执行 seed-and-verify 自动验证）。
- 2026-09-25 v1.6.0 Stage 1 完整执行 `npm run build:harmony:hap`：Hvigor `BUILD SUCCESSFUL`，产物 `entry-default-unsigned.hap` **4,765,139 bytes**（v1.5.0 为 3,773,777 bytes）。增量 +991 KB 全部来自本次替换的英语 CEFR 词表 —— 词表 JSON 位于 HAP 的 `rawfile/dist` 内，**不做压缩**（Web 侧 brotli 后仅 12–22 KB/级，harmony 侧 rawfile 保留原始体积）。
- 2026-09-25 v1.6.1 Stage 5 执行 `npm run build:harmony`：通过，`[verify:harmony-build] passed (60 ESM/Worker JS, 8 CSS, 86 files, 72 local references)`。同轮 `npm run verify:static-assets` PASS（5 项静态资源均已优化）；`npm run verify:wordlists` PASS；四道门 tsc 0 / oxlint 0 警告 0 错误（366 文件 / 104 规则）/ vitest 158 files 1465 tests 全绿 / E2E 19-19。**本轮未重新执行 `build:harmony:hap`**（HAP 打包与体积数字留待需要时补测），故本节上方 HAP 字节数仍为 v1.6.0 产物。
- 2026-09-25 v1.6.2 Stage 4 完整执行 `npm run build:harmony:hap`：Hvigor `BUILD SUCCESSFUL`，产物 `entry-default-unsigned.hap` **4,515,968 bytes**（4.31 MiB；上一次实测基线为 v1.6.0 的 4,765,139 bytes ⇒ **−249,171 bytes / −5.2%**）。拆包实测：101 条目、**全部 STORED（不压缩）**；原生侧 985.5 KB（`icon.png` 350.9 / `foreground.png` 365.9 / `modules.abc` 209.7 / `widgets.abc` 31.3）、rawfile 侧 3407.5 KB（86 条目，rawfile 内 0 个 `.br`/`.gz` sidecar —— harmony 模式不启用压缩 sidecar）。**口径提示**：v1.6.1 未重测 HAP，故该差值**跨越两个版本**；已知主导项为 v1.6.1 位图 −589.4 KB 与本轮英语例句 +467.2 KB（净 −122.2 KB），**余下约 122 KB 缺少可比对的旧 HAP 产物、不予归因**。同轮 `npm run build:harmony` 通过；`check:versions` PASS（3.6.2 / 1.6.2 / 1000075）；`measure:bundle` 首屏 JS **306.2 KB 零回退**、全量 JS 2748.9 KB（+467.2 KB）、CSS 178.7 KB；四道门 tsc 0 / oxlint 0w0e（374 文件）/ vitest 163 files 1493 tests 全绿 / E2E **20-20**。
- 构建包装器的 ANSI 控制符归一化已修复，相关测试 3/3 通过，不再因带颜色的成功日志产生假阴性。
- **2026-09-26 Wave 1（构建层级）**：`npm run build:harmony` 通过，`[verify:harmony-build] passed (60 ESM/Worker JS, 8 CSS, 87 files, 72 local references)`，并优先从新 Vite 插件导出的 `harmony-chunk-graph.json` 读取依赖图（mapDeps 正则降为 fallback）。`npm run build:harmony:hap` Hvigor 报告 `BUILD SUCCESSFUL`，产物 `harmony/entry/build/default/outputs/default/entry-default-unsigned.hap` **4,649,568 bytes**。`npm run check:versions` 通过（web 3.6.2 / harmony 1.6.2 / versionCode 1000075，且 ≥ `last-release.json` 基线）。该轮记录的 `+133,600 bytes / +3.0%` 已于 **2026-09-29 v1.6.3 S3 拆包归因结清**（见下方 S3 条目）。
- **2026-09-26 Wave 1 运行时复证（模拟器层级，当日补齐）**：模拟器经 CLI 拉起（见 §6），`npm run verify:harmony-runtime` 对 Wave 1 HAP（4,649,568 bytes）执行 **A1–A7 全 PASS**（报告 `harmony/docs/reports/seed-report-wave1-runtime.json`）：seed inserted=5 → Page begin → content ready → `getAllCards done: count=5` → launch handler generation=1 → openCard 原生派发 + Web 域层 `located cardId=debug-seed-1`。改走 JSON 字符串的通道在恢复链路被实机命中（getAllCards），FIFO 派发与日志脱敏后受保护断言子串全部逐字命中。**边界**：另两条改通道返回（getRecentlyReviewedCards / getTodayReviewStats / getSpeechEngines）属特定 UI 触发路径，本轮未逐一实机命中，属静态 + 间接证据。`npm run collect:harmony-perf` 采集基线：**冷启动 579ms**（Page begin → Web content ready）、**PSS 144232 KB**（报告 `harmony/docs/reports/perf-report-wave1.json`；同轮修复 collect-perf 两个口径缺陷并补单测，见 §7.4）。
- **2026-09-29 v1.6.3（构建层级）**：`npm run build:harmony` 通过，`[verify:harmony-build] passed (60 ESM/Worker JS, 8 CSS, 89 files, 72 local references)`（文件数由 Wave 1 的 87 增至 89，增量正是新增的 2 张课程封面 WebP）。`npm run build:harmony:hap` Hvigor 报告 `BUILD SUCCESSFUL`，产物 `entry-default-unsigned.hap` **4,809,670 bytes**（S5 bump 后复测；同 worktree 连续两次构建逐字节相同）。**口径提示**：bump 前实测为 4,798,144 bytes，差值 **+11,526 B** 与源码改动（仅版本字符串）不成比例，归因指向会话可变的 `ets/sourceMaps.map`（本会话 137,537 B，即 S3 已定位的同一类构建会话差异），非源码变更。`npm run check:versions` 通过（web 3.6.3 / harmony 1.6.3 / versionCode 1000080，S5 收口后已递增，无 WARN）。**体积归因**：相对重建 v1.6.2（4,628,830）净增 **+151,290 B**，其中 **86.2%（+130,418 B）为新增课程封面 WebP**、7.1% 为 `harmony-chunk-graph.json` sidecar、代码侧（`ets/*`）净增约 9.9 KB（S1 委托拆分 + 桥接改动）；两个历史欠账（Wave 1 +133,600 / v1.6.2 −249,171）已同轮归因结清，详见 `docs/vault/v1.6.3-HAP-SIZE-ATTRIBUTION-REPORT.md`。**本轮未执行 `verify:harmony-runtime`**——S1 改动落在 API 22 运行链路上，模拟器离线，只到「自动测试 + HAP 编译」层级（见「尚缺少的验证层级」）。
- **2026-09-30 v1.6.4（构建层级，2026-10-09 于当前工作树复证）**：`npm run build:harmony` 通过，`[verify:harmony-build] passed (60 ESM/Worker JS, 8 CSS, 89 files, 72 local references)`（与 v1.6.3 同为 89 文件 —— 本轮无新增 rawfile 资源）。`npm run build:harmony:hap` 产物 `harmony/entry/build/default/outputs/default/entry-default-unsigned.hap` **4,815,454 bytes**（09-30 统一验证轮首次记录，10-09 重建**逐字节同尺寸**，未签名跳过 `signingConfigs` 为空；构建日志残留 7 条 ArkTS WARN，集中于 `ReminderAgentService.ets` 的「Function may throw exceptions」与 `Index.ets:320` 的 `DocumentSelectMode/FILE` 设备能力提示，非本轮引入）。`check:versions` 通过（web 3.6.4 / AppScope·entry 1.6.4 / versionCode 1000085，`module.json` 实测含 1000085）。`measure:bundle`：首屏 JS 306.1 KB 零回退 / 全量 2753.4 KB（+4.5 KB）/ CSS 180.8 KB（+2.1 KB）/ 位图 599.3 KB（预算 640 KB）。体积相对 v1.6.3（4,809,670）**+5,784 B（+0.12%）**。**此前本条目误记为「暂无 v1.6.4 构建数字」，与 `docs/spec/v1.6.4/main.md`、`CHANGELOG [3.6.4]`、`docs/vault/v1.6.4-QUALITY-REPORT.md` 的 4,815,454 B 记录相矛盾，现按实测统一**（§8 真源规则）。
- **2026-10-09 v1.6.4 运行时复证（模拟器层级，同时结清 v1.6.3 S1 欠账）**：模拟器 CLI 拉起后 `hdc list targets` 出现 `127.0.0.1:5555`，对上述 10-09 重建 HAP 执行 `npm run verify:harmony-runtime` —— 6 步全 ok（install / clean-app-data / reset / debugSeed start / openCard start），断言 **A1–A7 全 PASS**（报告 `harmony/docs/reports/seed-report-v164-runtime.json`）：A1 `seedDebugCards done: skipped=0 inserted=5` → A2 `Page begin` → A3 `Web content ready` → **A4 `getAllCards done: count=5`** → A5 `Web launch handler ready: generation=` → A6 `handleLaunchWant: dispatching query=action=openCard` → A7 `[harmonyLaunch] openCard located cardId=debug-seed-1`。**这是 B1 委托拆分至今第一份运行时证据**：A4 的 RDB 恢复链路与 A7 的复习页真实到达，均经过 `bridge/delegates/CardBridgeDelegate.ets` 的实现（拆分后 façade 只转发），证明 JSProxy 对象图与 `this` 绑定改动未破坏 API 22 异步通道与 FIFO 派发。`npm run collect:harmony-perf` 同轮基线：**冷启动 388 ms**（vs Wave 1 的 579 ms，**−191 ms / −33%**）、**PSS 138496 KB**（vs 144232 KB，**−5736 KB / −4.0%**，落在「尚缺少的验证层级」原条目定义的 ±5% 噪声带内且方向更优），报告 `harmony/docs/reports/perf-report-v164.json`。**边界**：`getRecentlyReviewedCards` / `getTodayReviewStats` / `getSpeechEngines` 三条 UI 触发路径仍未被逐一实机命中（静态 + 间接证据），签名 HAP 与真机验收另见「尚缺少的验证层级」。

### API 22 模拟器运行证据

- `hdc` 安装返回 `install bundle successfully`；强制停止后冷启动成功，应用保持前台且首页完整渲染。
- 最新 content-ready HAP 覆盖安装成功；冷启动在 00:18:05.901、00:18:06.163、00:18:06.215 依次捕获虚拟 HTTPS `Page begin`、`Web launch handler ready: generation=1` 与 `Web content ready`，随后 `getAllCards=0`，确认原生加载层只在 React 实际提交内容后撤下。
- 截图和 UI 可访问性树均确认 `Wordaydream`、学习进度、`开始阅读`、`选择课程` 等实际 Web 内容存在，不是空的 ArkWeb 外壳；Web 节点实际地址为 `https://app.wordaydream.invalid/index.html`，无 Loading 或 Failure 覆盖层残留。
- 最新产物运行日志中 CORS、`ERR_FAILED`、Web/HTTP load error、`Uncaught`、`TypeError`、`ReferenceError`、`FATAL`、content-ready timeout 和 critical load failure 均为 0；此前的白屏已消除，12 秒失败保护未被误触发。
- `action=startReview` 热启动在进程 PID 28489 保持不变的情况下实时捕获 `onNewWant -> dispatching query -> queued queueSize=1 -> dispatched remaining=0`，证明 native FIFO 到 Web handler 的交付闭环。模拟器当前没有到期卡片，因此实际进入复习页面仍未覆盖。
- 虚拟 HTTPS 冷启动日志捕获 `Page begin`、`Web launch handler ready: generation=1` 和 RDB 初始化；全缓冲扫描中 CORS、`ERR_FAILED`、Web/HTTP load error、脚本异常、fatal、DNS/host resolver/network error 均为 0，也未发生 `.invalid` 域名真实联网。

### 尚缺少的验证层级

- ~~Wave 1（2026-09-26）改动落在 API 22 运行链路上，模拟器离线、`npm run verify:harmony-runtime` 未跑~~ — **2026-09-26 当日已补齐**：模拟器 CLI 拉起后 A1–A7 全 PASS（见 §5 构建层级的 Wave 1 运行时复证条目），但下述其余层级仍缺，不得互相替代。
- ~~**v1.6.3 S1（2026-09-29）委托拆分改动了 API 22 运行链路，`npm run verify:harmony-runtime` 未执行**~~ — **2026-10-09 已补齐**：对当前工作树重建的 v1.6.4 HAP（4,815,454 B）执行 A1–A7 全 PASS，A4 恢复链路与 A7 复习页到达均经委托实现；同轮 `collect:harmony-perf` 采集冷启动 388 ms / PSS 138496 KB（见 §5 v1.6.4 条目与 `harmony/docs/reports/{seed-report-v164-runtime,perf-report-v164}.json`）。但下述其余层级仍缺，不得互相替代。
- 已签名 HAP 的安装与启动；当前仅验证 unsigned HAP 的模拟器安装。
- API 22 模拟器中带到期卡片的冷/热启动、RDB 原生恢复、服务卡宿主和关键页面交互验证。
- 真机上的 TTS、振动、普通通知和多窗口/后台恢复验证。
- 获得开放能力后的 `reminderAgent` 定时提醒验证。
- 实际 `.env.harmony` 代理端点的网络、CSP、TLS 与 LLM 端到端验证。

## 6. 可复现工作流

在仓库根目录执行：

```powershell
npm run typecheck
npm run test:run
npm run lint
npm run check:versions
npm run build:harmony
npm run build:harmony:hap
```

模拟器在线时的运行验证自动化（Wave 1 起提供 npm 入口，`DEVECO_STUDIO_HOME` 缺失会 fail-fast）：

```powershell
$hdc = "D:\DevEco Studio\sdk\default\openharmony\toolchains\hdc.exe"
npm run verify:harmony-runtime -- --hdc $hdc --out seed-report.json
npm run collect:harmony-perf -- --hdc $hdc --out perf-report.json
npm run test:harmony-scripts
```

模拟器离线时可经 CLI 直接拉起已部署实例（2026-09-26 实测有效，无需打开 DevEco Studio UI）：

```powershell
& "D:\DevEco Studio\tools\emulator\Emulator.exe" -start "nova 16 Pro" -instancePath "D:/test"
# 约 40-60s 后 hdc list targets 出现 127.0.0.1:5555
```

实例注册表在 `%LOCALAPPDATA%\Huawei\Emulator\deployed\lists.json` 为空数组时，必须带 `-instancePath D:/test`（实例真身在 D 盘，由 DevEco 6.1 创建）。

`seed-and-verify` 会安装最新 HAP、以 `action=debugSeed` 冷启动预置 5 张到期卡，
轮询 hilog 断言验证链（RDB seed → Page begin → content ready → getAllCards →
FIFO queued），输出 JSON 报告；模拟器不在线时输出 `skipped:true` 且退出码 0。
`collect-perf` 采集冷启动耗时与进程 PSS 基线。

然后在 DevEco Studio 中打开 `harmony/`，配置有效调试签名，选择 HarmonyOS 6.0.2 / API 22 设备运行。连接状态可用下列命令检查：

```powershell
& 'D:\DevEco Studio\sdk\default\openharmony\toolchains\hdc.exe' list targets
```

远程 LLM 测试前，把 `.env.harmony.example` 复制为未纳入 Git 的 `.env.harmony`，并填写设备可访问的绝对 HTTP(S) 代理 URL。真机不能通过 `localhost` 访问开发电脑服务。

## 7. 下一轮优先级

1. ✅（2026-09-20 已结清）`seed-and-verify.mjs` 模拟器清账 **7/7 断言全 PASS, 退出码 0**: seed (inserted=5) → Page begin → content ready → `getAllCards done: count=5` → Web launch handler ready → onNewWant openCard 派发 + FIFO queued/dispatched → **A7 `[harmonyLaunch] openCard located cardId=debug-seed-1`** (复习页真实到达)。修复 = R-1 恢复改走原生推送通道: async JSProxy 复杂返回值在 API 22 webview 不可用 (Web 端 Promise resolve 成 number, refresh() 亦无效), content-ready 后原生 `pushCardsToWeb()` 经 runJavaScript 推 JSON, Web 端 `window.__applyNativeCardRestore` 空 store 守卫应用; web 侧 `parseBridgeRecords` 兼容数组/string, `getAllCards` 原生改返回 JSON string, 注册后补官方 `refresh()`。过程与契约详见 `docs/vault/v1.6.0-EMULATOR-VERIFY-REPORT.md`。脚本断言关键词已对齐 v1.5.0 实机日志 (A4/A5 改), openCard query 加引号防 shell 拆断 `&`, 新增 `bm clean -d` 保证干净状态出发。
2. ✅（2026-09-26 已结清）**Wave 1 运行时复证**：模拟器 CLI 拉起后 `npm run verify:harmony-runtime` **A1–A7 全 PASS**——JSON 字符串通道（getAllCards 恢复链路 count=5）、`runJavaScript` FIFO 派发、日志脱敏后受保护断言子串逐字命中。边界：getRecentlyReviewedCards / getTodayReviewStats / getSpeechEngines 三条 UI 触发路径未逐一实机命中（静态 + 间接证据），见 §5。
3. ✅（2026-09-29 落地，**2026-10-09 运行时复证结清**）**B1 上帝文件拆分**：`HarmonyBridge.ets` 拆为 facade + 4 域委托（Card / Prefs / Speech / Notify），1170 → 533 行，契约面与方法行为逐字不变；`pages/Index.ets` 未做结构抽取（只做色值 token 收敛）。拆分改动落在 API 22 运行链路上，当轮模拟器离线未跑运行时——**2026-10-09 已对当前工作树重建的 HAP 补跑 `verify:harmony-runtime`：A1–A7 全 PASS + `collect:harmony-perf` 基线**（见 §4.1、§5 v1.6.4 条目）。守护退化已同轮修复（见本节第 14 项）。签名 HAP 仍缺（unsigned 模拟器通道已够断言链路验证）。
4. ✅（2026-09-26 已结清）`collect-perf.mjs` 基线采集落地，**但实测暴露两个口径缺陷并同轮修复**（commit `7300780`）：① `computeColdStartMs` 原实现取全 hilog 窗口时间戳跨度，被系统日志污染得出 188s 假值 → 改为关键词过滤口径（最后一条 `Page begin` → 最后一条 `Web content ready`），API 22 实测 **579ms**；② `extractPssKb` 正则不匹配 API 22 hidumper 三行表头格式 → 补 `Total` 行解析，实测 **PSS 144232 KB**。单测 3 改 7（净 +4，125→129），含假值回归用例；oxlint 0w0e。基线报告 `harmony/docs/reports/perf-report-wave1.json`。
5. 服务卡跨进程主动刷新实际验证（代码闭环已就绪：notifyReviewCompleted → FormRefresher → updateForm）；配置调试签名并在真机验证 TTS、振动、普通通知、RDB 冷启动恢复和服务卡生命周期。
6. 申请 `reminderAgent` 开放能力和签名 Profile 后验证 `ReminderAgentService` 的发布/去重/取消/恢复策略（代码已就绪，无权益期间保持安全跳过）。
7. 提供真实 Harmony LLM 代理环境（`.env.harmony`），验证代理 URL、CSP、TLS、超时与弱网行为。
8. ✅（2026-09-20 已结清）openCard 断言随 seed-and-verify 全绿: A6 (原生 onNewWant 派发) PASS, A7 (web 域层 located 日志) PASS。
9. ✅（2026-09-26 已结清）文档收口：根包 / AppScope 版本口径已统一并由 CI 强制（`check:versions` + `last-release.json` 单调性护栏）；`harmony/` 其余文档已停止各自维护数字副本，统一以本文件为唯一数字真源（各文件顶部有真源声明）。
10. ✅（2026-09-29 已结清）**v1.6.3 S3 HAP 体积归因**：Wave 1 `+133,600 B` 与 v1.6.2 轮 `−249,171 B` 两个历史欠账全部归因清零，共同根因为记录产物缺 `ets/sourceMaps.map`（129,676 B）；真实源码级增量分别为 `+15,270 B` / `−120,062 B`。工具 + 单测 + Vault 报告已落地（见 §4.1 S3）。
11. ✅（2026-09-29 已结清）**v1.6.3 S4 E2E 矩阵收缩**：默认与 CI 只跑 chromium，firefox/webkit/mobile-chrome 降级为手动 opt-in（`E2E_FULL_MATRIX=true`），`playwright.config.ts` + workflow 已同步（见 §4.1 S4）。
12. **v1.6.3 S2 服务卡跨进程刷新运行时验证**（探针先行）：模拟器桌面能否添加 2×4 服务卡，15 分钟内定性；可行则固化为自动化断言，不可行则如实 NOT DELIVERED 转真机验收项，不伪造。依赖模拟器在线。
13. ✅（2026-09-29 已结清）**v1.6.3 S5 版本收口**：bump web `3.6.3` / AppScope·entry `1.6.3` / versionCode `1000080`（1.x 线每版 +5 规则）；CHANGELOG `[3.6.3]` 章节、`docs/vault/v1.6.3-HARMONY-QUALITY-REPORT.md`、本文件版本口径均已同步。`check:versions` PASS（3.6.3 / 1.6.3 / 1000080，已高于 `last-release.json` 的 `1000075`，无 WARN）。
14. ✅（2026-10-09 已结清）**B1 拆分暴露的两处守护退化**：① `bridgeRegistry.test.ts` 的「原生自用豁免清单仍在 ArkTS 桥实现中」用例在拆分后只读 façade，一条转发桩即可满足，RDB 实现是否还活着不再被证明 → 改为读**桥闭包**（façade + `delegates/*.ets`，并断言委托文件数 > 0，防闭包静默塌回 façade-only），除 `async <name>(` 外追加 `store.<name>(` 断言，删掉 delegate 里的 RDB 读取会立刻失败；② 断言关键词清单此前只有结构校验（id 顺序 / level），A4 日志串被静默迁入 `CardBridgeDelegate` 而无人拦截 → 新增 `scripts/harmony/assertion-keywords.test.mjs` 关键词 ↔ 日志源双向契约，并实测确认「EntryAbility 注释原文复述 A6 关键词」这一假阳性陷阱已被剥注释逻辑排除。实测数字见 §5 表（`test:harmony-scripts` 15 文件 / 166 项）。

## 8. 状态维护规则

- **本文件是唯一数字真源**：版本口径、SDK、桥接方法数、测试数、HAP 体积、能力状态只在此处记录。`harmony/README.md`（操作/历史）、`FEATURE_PARITY_CHECKLIST.md`（功能对照）、`RELEASE_CHECKLIST.md`（发布步骤）、`PERFORMANCE_BASELINE.md`（性能定义与填写位）、`app-market/README.md`（素材就绪度）与 `docs/vault/*`（过程报告）只保留各自职责，需要数字时链接本文件，不再维护副本；发现两处不一致，以本文件为准并修正另一处。
- 不用百分比表示迁移进度；以能力矩阵和对应证据为准。
- “自动测试通过”“HAP 编译通过”“模拟器通过”“真机通过”是四个不同层级，不互相替代。
- 每次修改 Web 源码后都必须重新运行 `build:harmony`；每次修改 ArkTS、Manifest 或 profile 后都必须重新运行 `build:harmony:hap`。
- 只有与当前源码对应的构建产物才能作为当前版本证据。
