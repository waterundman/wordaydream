# Wordaydream 鸿蒙版本当前状态

> 更新日期：2026-09-26
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
| 应用版本 | 单一版本真源（仓库根包 `3.6.2=harmony major+2`）；AppScope `1.6.2`、entry `1.6.2` 与之对齐，由 `scripts/check-version-alignment.mjs` 自动校验；v3.0.0 起 harmony 跨入 major 1.0.0，versionCode 线性规则（major≠0 未覆盖）自动跳过校验，数值延续递增 `1000075` |
| 原生权限 | `ohos.permission.INTERNET`、`ohos.permission.VIBRATE` |
| 签名 | `signingConfigs` 为空；当前只能生成 unsigned HAP |
| 模拟器 | `nova 16 Pro`、HarmonyOS 6.0.2（API 22）；此前 content-ready unsigned HAP 已覆盖安装，冷启动、显式内容 ACK、首页渲染和热启动 FIFO 通过。**Wave 1（2026-09-26）改动的运行时复证未执行**——模拟器本轮离线，见 §5「尚缺少的验证层级」 |

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

### 4.1 Wave 1 — API 22 通道收敛、死代码清除与构建链加固（2026-09-26）

- **复杂返回通道统一**：`getRecentlyReviewedCards` / `getTodayReviewStats` / `getSpeechEngines` 由返回对象/数组改为返回 JSON 字符串，与已实证的 `getAllCards` 走同一可用通道；Web 侧消费者同步解析。
- **卡片恢复通道合并**：`useMemoryStore.ts` 的原生推送接收器与 `getAllCards` 拉取兜底抽出共用 `applyRestoredCards`；`window.__applyNativeCardRestore` 进入 `declare global` 并标注 `TODO(API22)`，说明 async JSProxy 修复后可撤。
- **原生健壮性**：`runJavaScript` 派发加超时复位，`pendingLaunchQueries` 设上限（16），防止 FIFO 永久卡死；`HarmonyBridge` 单例新增 `refreshContext`，供 Ability 重建时刷新 context。
- **契约防漂移**：`bridgeRegistry.test.ts` 改为解析 `.ets` 数组字面量并与 TS 侧方法名做双向集合断言（不再写死计数）；新增 `harmonyOriginSync.test.ts` 守护三份 ArkWeb origin 白名单一致；为 `bridgeInputValidator` 补 `.ets` 镜像对照测试。
- **死代码清除**：删除 `EntryAbility.ets` 的 emitter(10001) 服务卡刷新死链（跨进程无订阅者；真实链路 `notifyReviewCompleted` → `FormRefresher` → `updateForm` 保留）；删除 `NotificationService` 中未来触发的死逻辑 `computeTriggerAt` / `applyWindow`（改为 `isInNotificationWindow` 判定）；删除 `BridgeInputValidator.isAllowedArkWebOrigin`、`harmonyCsp.injectConnectSrcOrigin` 与 Web 侧零调用桥 wrapper；`speak` 不再向 Web 抛异常。
- **结构**：卡片多语言文案抽到新文件 `widget/CardTextFormatter.ets`（单一真源），尺寸口径抽到 `widget/CardFormDimension.ets`（`FormDimension` 枚举/常量）；`MemoryCardStore` 提取 `withResultSet` 泛型助手统一 ResultSet 生命周期；`FormIdStore` / `ReminderAgentService` 对齐 init 失败复位模式；提醒文案 i18n 走 `notification/templates.ets`。
- **日志脱敏**：`Index.ets` 的 `onConsole` 只转发 warn/error 或诊断前缀并截断；原生 info 日志中的 cardId / due / formId / query 明文降级或使用 `%{private}`。受保护的运行验证日志子串（`seedDebugCards done` / `Page begin` / `Web content ready` / `Web launch handler ready` / `getAllCards done: count=` / `dispatching query` / `[harmonyLaunch] openCard`）逐字保留，不断链。
- **构建链与 CI**：`check-version-alignment.mjs` 覆盖 major≠0 盲区并新增与 `scripts/harmony/last-release.json` 的 versionCode 单调性校验；`verify-harmony-build.mjs` 优先消费新 Vite 插件导出的 `harmony-chunk-graph.json`（mapDeps 正则降为 fallback）；抽出 `scripts/harmony/lib/hdc.mjs` 去重 `seed-and-verify` / `collect-perf`，统一 `DEVECO_STUDIO_HOME` fail-fast；`package.json` 新增 `verify:harmony-runtime` / `collect:harmony-perf` / `test:harmony-scripts` 入口；`.github/workflows/netlify-deploy.yml` 的 ci job 追加纯 Node 的 `build:harmony` + verify + 脚本单测步骤。
- **验证层级**：本轮只到「自动测试 + HAP 编译通过」层级；API 22 模拟器本轮离线，`seed-and-verify` 未执行，不构成模拟器/真机通过的证据（见 §5、§8）。

### 4.2 此前轮次记录

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
| `npm run test:run` | 167 个测试文件、1580 项测试全部通过（Wave 1 技术债修复轮：新增 `harmonyOriginSync.test.ts`、`bridgeRegistry.test.ts` 改双向集合断言、`scripts/harmony/lib/` 的 hdc/chunk-graph 与 `scripts/lib/deveco-paths` 单测；零回归） |
| `npm run lint` | 通过（oxlint 0 个警告 0 个错误，383 文件） |
| `npm run verify:wordlists` | 通过（en A1-B2 / de A1-B2 字段契约 + `courses/en.ts` 20 Lesson targetLemmas 命中校验；德语同形异义 11 处记为 warning） |
| `npm run verify:static-assets` | 通过（v1.6.1 S2：3 纹理为 WebP、2 图标为量化 PNG、原图保留在 `assets-sources/` 回滚路径） |
| `npm run check:versions` | 通过（四处版本口径一致，已接入 CI） |
| `npm run build` | 普通 Web 生产构建通过，仍保留代码分包、module Worker 与 PWA |
| 虚拟同源定向测试 | 通过（origin/path/MIME、双编码穿越和源码接线契约） |
| Harmony 构建验证器 | 9/9 通过；要求标准 ESM 入口、modulepreload、两个 module Worker、多 JS/CSS 分包、严格 CSP，并从 `index.html` 遍历依赖图拒绝缺失或不可达产物 |
| HAP 日志识别器 | 3/3 通过；能识别带 ANSI 颜色的成功与失败日志 |
| 运行验证断言关键词静态核验 | **7/7 逐字命中**（Wave 1 收口轮新增的独立复核）：日志脱敏改动后，A1–A7 断言关键词仍逐字存在于日志源 —— A1 `seedDebugCards done`(EntryAbility) · A2 `Page begin`(Index.ets) · A3 `Web content ready`(HarmonyBridge) · A4 `getAllCards done: count=`(useMemoryStore + HarmonyBridge) · A5 `Web launch handler ready: generation=`(HarmonyBridge) · A6 `dispatching query=action=openCard`(EntryAbility) · A7 `[harmonyLaunch] openCard`(harmonyLaunch.ts + Index.ets)。**口径**：这只是「关键词 ↔ 日志源」的静态一致性证据，**不能替代** `verify:harmony-runtime` 的实机日志命中 |
| 桥接注册表快照 | 同步 4 / 异步 16（真源为 `BridgeMethodRegistry.ets`；Stage 3 新增 requestNotificationPermission / scheduleReviewReminder / cancelReviewReminder）。Wave 1 起 Web 与原生两侧测试对方法名做双向集合断言，不再写死计数 |
| `npm run test:harmony-scripts` | 通过（`vitest run scripts`：Wave 1 后 125 项脚本单测全绿，覆盖 seed-and-verify / check-version-alignment / `harmony/lib/hdc` / `harmony/lib/chunk-graph` / `lib/deveco-paths` / measure-bundle / generate-en-examples / verify-wordlists.example / lint.warn 共 9 个文件）。`scripts/verify-harmony-build.test.mjs` 与 `scripts/hvigor-output.test.mjs` 属 `node --test` 套件，由 `test:harmony-build-verifier`（9/9）与 `test:harmony-build-wrapper`（3/3）单独执行，已从 vitest 收集中排除 |

这些测试覆盖 Web 业务回归以及 Harmony 的桥接契约、Manifest、启动队列、CSP、静态资源、通知安全守卫、TTS 镜像和服务卡数据契约，但不能替代 Harmony 运行时测试。

### Harmony 构建层级

构建命令已经提供：

```powershell
npm run build:harmony
npm run build:harmony:hap
```

其中（**下列带日期的条目是各轮实测快照，只有最后一条 Wave 1 条目对应当前工作树**；引用 HAP 体积 / 测试数时一律取最新一条）：

- `build:harmony` 生成 rawfile Web 资源后，检查标准 ESM 入口、modulepreload、CSP、根绝对资源路径、两个 Worker、依赖图可达性、丢失资源、source map 和 `.br` / `.gz` sidecar。
- `build:harmony:hap` 使用 `D:\DevEco Studio` 的工具链编译 API 22 HAP，并要求日志明确出现成功结果和实际 HAP 文件。
- 2026-08-13 00:07 对包含 content-ready ACK 与 12 秒失败/重试保护的最新工作树完整执行 `npm run build:harmony:hap`，进程退出码为 0；`CompileArkTS`、`PackageHap` 与 packing 均通过，Hvigor 明确报告 `BUILD SUCCESSFUL`。
- 2026-09-09 v0.5.0-harmony Stage 0-4 完整执行 `npm run build:harmony:hap`：Hvigor `BUILD SUCCESSFUL`，产物 `harmony/entry/build/default/outputs/default/entry-default-unsigned.hap`（3,845,446 bytes）。构建包装器新增 realpathSync 规范化 cwd —— hvigor 对盘符大小写敏感（`w:\` 报 "Path not found"，`W:\` 正常），现从任意大小写 cwd 启动均可构建。
- 当前产物仍未签名，但可覆盖安装到 API 22 模拟器（模拟器在线时执行 seed-and-verify 自动验证）。
- 2026-09-25 v1.6.0 Stage 1 完整执行 `npm run build:harmony:hap`：Hvigor `BUILD SUCCESSFUL`，产物 `entry-default-unsigned.hap` **4,765,139 bytes**（v1.5.0 为 3,773,777 bytes）。增量 +991 KB 全部来自本次替换的英语 CEFR 词表 —— 词表 JSON 位于 HAP 的 `rawfile/dist` 内，**不做压缩**（Web 侧 brotli 后仅 12–22 KB/级，harmony 侧 rawfile 保留原始体积）。
- 2026-09-25 v1.6.1 Stage 5 执行 `npm run build:harmony`：通过，`[verify:harmony-build] passed (60 ESM/Worker JS, 8 CSS, 86 files, 72 local references)`。同轮 `npm run verify:static-assets` PASS（5 项静态资源均已优化）；`npm run verify:wordlists` PASS；四道门 tsc 0 / oxlint 0 警告 0 错误（366 文件 / 104 规则）/ vitest 158 files 1465 tests 全绿 / E2E 19-19。**本轮未重新执行 `build:harmony:hap`**（HAP 打包与体积数字留待需要时补测），故本节上方 HAP 字节数仍为 v1.6.0 产物。
- 2026-09-25 v1.6.2 Stage 4 完整执行 `npm run build:harmony:hap`：Hvigor `BUILD SUCCESSFUL`，产物 `entry-default-unsigned.hap` **4,515,968 bytes**（4.31 MiB；上一次实测基线为 v1.6.0 的 4,765,139 bytes ⇒ **−249,171 bytes / −5.2%**）。拆包实测：101 条目、**全部 STORED（不压缩）**；原生侧 985.5 KB（`icon.png` 350.9 / `foreground.png` 365.9 / `modules.abc` 209.7 / `widgets.abc` 31.3）、rawfile 侧 3407.5 KB（86 条目，rawfile 内 0 个 `.br`/`.gz` sidecar —— harmony 模式不启用压缩 sidecar）。**口径提示**：v1.6.1 未重测 HAP，故该差值**跨越两个版本**；已知主导项为 v1.6.1 位图 −589.4 KB 与本轮英语例句 +467.2 KB（净 −122.2 KB），**余下约 122 KB 缺少可比对的旧 HAP 产物、不予归因**。同轮 `npm run build:harmony` 通过；`check:versions` PASS（3.6.2 / 1.6.2 / 1000075）；`measure:bundle` 首屏 JS **306.2 KB 零回退**、全量 JS 2748.9 KB（+467.2 KB）、CSS 178.7 KB；四道门 tsc 0 / oxlint 0w0e（374 文件）/ vitest 163 files 1493 tests 全绿 / E2E **20-20**。
- 构建包装器的 ANSI 控制符归一化已修复，相关测试 3/3 通过，不再因带颜色的成功日志产生假阴性。
- **2026-09-26 Wave 1（当前工作树的构建层级）**：`npm run build:harmony` 通过，`[verify:harmony-build] passed (60 ESM/Worker JS, 8 CSS, 87 files, 72 local references)`，并优先从新 Vite 插件导出的 `harmony-chunk-graph.json` 读取依赖图（mapDeps 正则降为 fallback）。`npm run build:harmony:hap` Hvigor 报告 `BUILD SUCCESSFUL`，产物 `harmony/entry/build/default/outputs/default/entry-default-unsigned.hap` **4,649,568 bytes**（v1.6.2 的 4,515,968 bytes ⇒ +133,600 bytes / +3.0%；候选解释为本轮 ArkTS/桥接层改动与新增的 `harmony-chunk-graph.json` sidecar，未做拆包归因核对，不作为结论）。`npm run check:versions` 通过（web 3.6.2 / harmony 1.6.2 / versionCode 1000075，且 ≥ `last-release.json` 基线）。**API 22 模拟器本轮离线，`verify:harmony-runtime`（seed-and-verify）未执行**，故上述数字只构成「自动测试 + HAP 编译」层级证据，产物仍未签名。

### API 22 模拟器运行证据

- `hdc` 安装返回 `install bundle successfully`；强制停止后冷启动成功，应用保持前台且首页完整渲染。
- 最新 content-ready HAP 覆盖安装成功；冷启动在 00:18:05.901、00:18:06.163、00:18:06.215 依次捕获虚拟 HTTPS `Page begin`、`Web launch handler ready: generation=1` 与 `Web content ready`，随后 `getAllCards=0`，确认原生加载层只在 React 实际提交内容后撤下。
- 截图和 UI 可访问性树均确认 `Wordaydream`、学习进度、`开始阅读`、`选择课程` 等实际 Web 内容存在，不是空的 ArkWeb 外壳；Web 节点实际地址为 `https://app.wordaydream.invalid/index.html`，无 Loading 或 Failure 覆盖层残留。
- 最新产物运行日志中 CORS、`ERR_FAILED`、Web/HTTP load error、`Uncaught`、`TypeError`、`ReferenceError`、`FATAL`、content-ready timeout 和 critical load failure 均为 0；此前的白屏已消除，12 秒失败保护未被误触发。
- `action=startReview` 热启动在进程 PID 28489 保持不变的情况下实时捕获 `onNewWant -> dispatching query -> queued queueSize=1 -> dispatched remaining=0`，证明 native FIFO 到 Web handler 的交付闭环。模拟器当前没有到期卡片，因此实际进入复习页面仍未覆盖。
- 虚拟 HTTPS 冷启动日志捕获 `Page begin`、`Web launch handler ready: generation=1` 和 RDB 初始化；全缓冲扫描中 CORS、`ERR_FAILED`、Web/HTTP load error、脚本异常、fatal、DNS/host resolver/network error 均为 0，也未发生 `.invalid` 域名真实联网。

### 尚缺少的验证层级

- Wave 1（2026-09-26）改动落在 API 22 运行链路上（复杂返回通道、FIFO 超时复位、日志脱敏、卡片文案/尺寸抽取），但模拟器本轮离线，`npm run verify:harmony-runtime` 未跑：以下层级全部待补，**不得以「HAP 编译通过」替代**。
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
2. Wave 1 后的运行时复证：模拟器在线时重跑 `npm run verify:harmony-runtime`，确认改走 JSON 字符串的三条通道、`runJavaScript` 超时复位与 `pendingLaunchQueries` 上限、日志脱敏均未破坏受保护的断言子串（本轮未跑，见 §5）。
3. **B1 上帝文件拆分推迟**：`HarmonyBridge.ets`（1213 行）与 `pages/Index.ets`（535 行）的拆分推迟到**有签名 HAP + 模拟器/真机在线、可做运行时回归**时执行；无运行时回归手段时拆分纯结构风险，不做。
4. 运行 `collect-perf.mjs`（`npm run collect:harmony-perf`）采集冷启动耗时与 PSS 基线；后续补 CSV/LLM Worker 的 uitest 交互级性能对比。
5. 服务卡跨进程主动刷新实际验证（代码闭环已就绪：notifyReviewCompleted → FormRefresher → updateForm）；配置调试签名并在真机验证 TTS、振动、普通通知、RDB 冷启动恢复和服务卡生命周期。
6. 申请 `reminderAgent` 开放能力和签名 Profile 后验证 `ReminderAgentService` 的发布/去重/取消/恢复策略（代码已就绪，无权益期间保持安全跳过）。
7. 提供真实 Harmony LLM 代理环境（`.env.harmony`），验证代理 URL、CSP、TLS、超时与弱网行为。
8. ✅（2026-09-20 已结清）openCard 断言随 seed-and-verify 全绿: A6 (原生 onNewWant 派发) PASS, A7 (web 域层 located 日志) PASS。
9. ✅（2026-09-26 已结清）文档收口：根包 / AppScope 版本口径已统一并由 CI 强制（`check:versions` + `last-release.json` 单调性护栏）；`harmony/` 其余文档已停止各自维护数字副本，统一以本文件为唯一数字真源（各文件顶部有真源声明）。

## 8. 状态维护规则

- **本文件是唯一数字真源**：版本口径、SDK、桥接方法数、测试数、HAP 体积、能力状态只在此处记录。`harmony/README.md`（操作/历史）、`FEATURE_PARITY_CHECKLIST.md`（功能对照）、`RELEASE_CHECKLIST.md`（发布步骤）、`PERFORMANCE_BASELINE.md`（性能定义与填写位）、`app-market/README.md`（素材就绪度）与 `docs/vault/*`（过程报告）只保留各自职责，需要数字时链接本文件，不再维护副本；发现两处不一致，以本文件为准并修正另一处。
- 不用百分比表示迁移进度；以能力矩阵和对应证据为准。
- “自动测试通过”“HAP 编译通过”“模拟器通过”“真机通过”是四个不同层级，不互相替代。
- 每次修改 Web 源码后都必须重新运行 `build:harmony`；每次修改 ArkTS、Manifest 或 profile 后都必须重新运行 `build:harmony:hap`。
- 只有与当前源码对应的构建产物才能作为当前版本证据。
