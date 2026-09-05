# Wordaydream 鸿蒙版本当前状态

> 更新日期：2026-08-13
> 本文档描述当前工作树，作为鸿蒙实现、验证证据和后续工作的权威入口。`README.md` 中原有的 “Stage 1 / API 12” 内容是早期历史记录，不代表当前工程状态。

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
| 应用版本 | AppScope `0.3.0`；仓库根包 `2.3.0`，两者版本口径尚未统一 |
| 原生权限 | `ohos.permission.INTERNET`、`ohos.permission.VIBRATE` |
| 签名 | `signingConfigs` 为空；当前只能生成 unsigned HAP |
| 模拟器 | `nova 16 Pro`、HarmonyOS 6.0.2（API 22）；最新 content-ready unsigned HAP 已覆盖安装，冷启动、显式内容 ACK、首页渲染和热启动 FIFO 通过 |

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
| JavaScriptProxy | 已实现 | API 22 同步/异步方法分组集中在 `BridgeMethodRegistry.ets`；同步 4 项、异步 12 项。启动处理 ready 与 React content-ready 使用相互独立的 ACK，避免仅完成模块初始化便误判页面已可见。 |
| Web 主业务 | 已实现 | 阅读、LLM 评估、词典/语法、FSRS 复习、词表、课程、成就、连续学习和统计继续复用 React 代码。 |
| RDB 卡片镜像 | 已实现 | 并发初始化共用 Promise；所有操作等待存储就绪；ResultSet 在 `finally` 关闭；删除按 Web Map 的 `lexemeGroupId` 对齐。 |
| Preferences | 已实现 | 原生白名单读写并向 Web 暴露异步桥接。 |
| 原生 TTS | 已实现，待设备验收 | 支持朗读、停止、引擎可用性和引擎列表；处理并发创建、旧请求取消和 Ability 销毁时释放。 |
| 振动 | 已实现，待真机验收 | 通过同步桥接触发，模块已声明 VIBRATE；模拟器不能证明真实触觉反馈。 |
| 冷/热启动分发 | 已实现，运行验证通过 | `onCreate` / `onNewWant` 共用入口；原生队列等待 Web 显式 ready，Web 端再用持久 FIFO 等待 RDB 恢复。模拟器已实时捕获 `onNewWant -> queued -> dispatched remaining=0`。 |
| `action=startReview` | 已实现，部分运行验证 | 分享、服务卡或通知可唤起复习；会等待原生卡片恢复并选择可用语言。当前无到期卡片的模拟器热启动保持首页且无异常，尚未覆盖有到期卡片的实际跳转。 |
| `action=openCard` | 未闭环 | 查询解析和校验存在，但产品尚无定向卡片界面；目前明确提示不支持。 |
| 服务卡 | 已实现基础生命周期，未完全闭环 | 正规 `FormExtensionAbility` 支持创建、系统更新、尺寸变化和移除；显示 RDB 到期/今日统计。复习完成后的主动即时刷新和跨进程策略尚未得到运行验证。 |
| 元服务分享入口 | 已实现配置，待设备验收 | `share_card.json` 指向 `pages/Index`，默认触发 `action=startReview`。 |
| 到期通知 | 受限 | 已到期请求可发布普通本地通知并携带复习 Want；尚未建立完整的权限请求产品流程。 |
| 未来定时提醒 | 安全降级 | 未配置 `reminderAgent` 开放能力、`PUBLISH_AGENT_REMINDER` 与签名 Profile 时，未来通知会被跳过，避免错误地立即发布。 |
| 远程 LLM | 受配置限制 | 模块已有 INTERNET 权限，Harmony 构建会从同一 URL 注入前端代理地址和 CSP origin；仓库当前没有 `.env.harmony`，所以远程代理尚未形成可运行配置。 |
| PWA / Service Worker | 不适用 | Harmony 构建主动禁用 PWA 和 HTTP `.br` / `.gz` sidecar；ArkWeb 使用 HAP 内 rawfile，不依赖 Web 服务器语义。 |

## 4. 本轮结构与技术债改进

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
| `npm run typecheck` | 通过 |
| `npm run test:run` | 108 个测试文件、1178 项测试全部通过；第二轮新增改动另有定向测试通过 |
| `npm run lint` | 0 个错误；28 条现存警告 |
| `npm run build` | 普通 Web 生产构建通过，仍保留代码分包、module Worker 与 PWA |
| 虚拟同源定向测试 | 3 个测试文件、29 项测试通过；覆盖 origin/path/MIME、双编码穿越和源码接线契约 |
| Harmony 构建验证器 | 7/7 通过；要求标准 ESM 入口、modulepreload、两个 module Worker、多 JS/CSS 分包、严格 CSP，并从 `index.html` 遍历依赖图拒绝缺失或不可达产物 |
| HAP 日志识别器 | 3/3 通过；能识别带 ANSI 颜色的成功与失败日志 |

这些测试覆盖 Web 业务回归以及 Harmony 的桥接契约、Manifest、启动队列、CSP、静态资源、通知安全守卫、TTS 镜像和服务卡数据契约，但不能替代 Harmony 运行时测试。

### Harmony 构建层级

构建命令已经提供：

```powershell
npm run build:harmony
npm run build:harmony:hap
```

其中：

- `build:harmony` 生成 rawfile Web 资源后，检查标准 ESM 入口、modulepreload、CSP、根绝对资源路径、两个 Worker、依赖图可达性、丢失资源、source map 和 `.br` / `.gz` sidecar。
- `build:harmony:hap` 使用 `D:\DevEco Studio` 的工具链编译 API 22 HAP，并要求日志明确出现成功结果和实际 HAP 文件。
- 2026-08-13 00:07 对包含 content-ready ACK 与 12 秒失败/重试保护的最新工作树完整执行 `npm run build:harmony:hap`，进程退出码为 0；`CompileArkTS`、`PackageHap` 与 packing 均通过，Hvigor 明确报告 `BUILD SUCCESSFUL`。
- 当前产物为 `harmony/entry/build/default/outputs/default/entry-default-unsigned.hap`，修改时间 2026-08-13 00:07:35，大小 3,245,173 bytes，SHA-256 为 `6883ADBA6231628297C0CF2320783290312E7E2C6A7B460C573D2630968C255E`。该产物仍未签名，但已成功覆盖安装到 API 22 模拟器并完成冷/热启动复验。
- 构建包装器的 ANSI 控制符归一化已修复，相关测试 3/3 通过，不再因带颜色的成功日志产生假阴性。

### API 22 模拟器运行证据

- `hdc` 安装返回 `install bundle successfully`；强制停止后冷启动成功，应用保持前台且首页完整渲染。
- 最新 content-ready HAP 覆盖安装成功；冷启动在 00:18:05.901、00:18:06.163、00:18:06.215 依次捕获虚拟 HTTPS `Page begin`、`Web launch handler ready: generation=1` 与 `Web content ready`，随后 `getAllCards=0`，确认原生加载层只在 React 实际提交内容后撤下。
- 截图和 UI 可访问性树均确认 `Wordaydream`、学习进度、`开始阅读`、`选择课程` 等实际 Web 内容存在，不是空的 ArkWeb 外壳；Web 节点实际地址为 `https://app.wordaydream.invalid/index.html`，无 Loading 或 Failure 覆盖层残留。
- 最新产物运行日志中 CORS、`ERR_FAILED`、Web/HTTP load error、`Uncaught`、`TypeError`、`ReferenceError`、`FATAL`、content-ready timeout 和 critical load failure 均为 0；此前的白屏已消除，12 秒失败保护未被误触发。
- `action=startReview` 热启动在进程 PID 28489 保持不变的情况下实时捕获 `onNewWant -> dispatching query -> queued queueSize=1 -> dispatched remaining=0`，证明 native FIFO 到 Web handler 的交付闭环。模拟器当前没有到期卡片，因此实际进入复习页面仍未覆盖。
- 虚拟 HTTPS 冷启动日志捕获 `Page begin`、`Web launch handler ready: generation=1` 和 RDB 初始化；全缓冲扫描中 CORS、`ERR_FAILED`、Web/HTTP load error、脚本异常、fatal、DNS/host resolver/network error 均为 0，也未发生 `.invalid` 域名真实联网。

### 尚缺少的验证层级

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
npm run build:harmony
npm run build:harmony:hap
```

然后在 DevEco Studio 中打开 `harmony/`，配置有效调试签名，选择 HarmonyOS 6.0.2 / API 22 设备运行。连接状态可用下列命令检查：

```powershell
& 'D:\DevEco Studio\sdk\default\openharmony\toolchains\hdc.exe' list targets
```

远程 LLM 测试前，把 `.env.harmony.example` 复制为未纳入 Git 的 `.env.harmony`，并填写设备可访问的绝对 HTTP(S) 代理 URL。真机不能通过 `localhost` 访问开发电脑服务。

## 7. 下一轮优先级

1. 在模拟器预置到期卡片，正向验证 RDB 恢复、Web ready ACK、冷/热启动 FIFO 消费和实际进入复习页；补齐稳定的运行日志采集。
2. 在 API 22 模拟器实际触发 CSV 与 LLM module Worker，并与此前 classic 基线比较首屏、主进程加 renderer 的总 PSS 和大输入交互延迟。
3. 配置调试签名并在真机验证 TTS、振动、普通通知、RDB 冷启动恢复和服务卡生命周期。
4. 持久化有效 formId，并用系统支持的方式完成“复习状态变化后主动刷新服务卡”闭环。
5. 申请 `reminderAgent` 开放能力和签名 Profile 后，实现去重、更新、取消与恢复策略；在此之前保持未来提醒安全跳过。
6. 提供真实 Harmony LLM 代理环境，验证代理 URL、CSP、TLS、超时与弱网行为。
7. 统一根包、Harmony AppScope 和发布包的版本策略，并逐步清理仍带早期 Stage 编号或乱码的源码注释/历史文档。

## 8. 状态维护规则

- 不用百分比表示迁移进度；以能力矩阵和对应证据为准。
- “自动测试通过”“HAP 编译通过”“模拟器通过”“真机通过”是四个不同层级，不互相替代。
- 每次修改 Web 源码后都必须重新运行 `build:harmony`；每次修改 ArkTS、Manifest 或 profile 后都必须重新运行 `build:harmony:hap`。
- 只有与当前源码对应的构建产物才能作为当前版本证据。
