# SPEC — v1.6.3 鸿蒙原生质量轮（B1 拆分 · 服务卡运行时验证 · HAP 体积归因）

> 状态：**已收口**（S1 拆分 / S3 体积归因 / S4 E2E 矩阵 / S5 版本收口已落地；S2 服务卡运行时验证 NOT DELIVERED（模拟器离线，转真机验收项）；S1 运行时复证 A1–A7 待补。决策与执行期偏离见 §7 R2；收口报告 `docs/vault/v1.6.3-HARMONY-QUALITY-REPORT.md`）
> 承接：Wave 1（`73a94ab`）已按「自动测试 + HAP 编译」层级收口并于 2026-09-26 补齐运行时复证（A1–A7 全 PASS，commit `7300780`）。本轮为 v1.6.2 之后第一个以**鸿蒙原生侧**为主题的版本轮。

## 1. 背景与目标

上一轮 Wave 1 完成了 API 22 通道收敛、死代码清除与构建链加固，但三件事被显式推迟或遗留：

1. **B1 上帝文件拆分**：`bridge/HarmonyBridge.ets`（1213 行，20 个桥接方法 + FIFO 启动队列 + 单例生命周期）与 `pages/Index.ets`（535 行）。当时推迟理由是「无运行时回归手段」——该前提 **2026-09-26 已解除**（模拟器 CLI 可拉起 + seed-and-verify A1–A7 + collect-perf 全部实测可用）。
2. **服务卡跨进程刷新**：代码闭环已就绪（`notifyReviewCompleted` → `FormRefresher.refreshAllForms` → `updateForm`），从未在模拟器实机验证。
3. **HAP 体积归因欠账**：v1.6.2 轮留有 ~122 KB 无法归因；Wave 1 又 +133,600 bytes 未拆包核对。

本轮目标：在「运行时回归手段可用」的新前提下，完成原生侧结构收敛 + 两个遗留验证 + 体积账目闭环。

## 2. 基线实测（2026-09-26，全部实测非估算）

| 项 | 值 | 来源 |
|---|---|---|
| 工作树 | `7300780`（本地）/ 远端 `73a94ab` | git |
| vitest | 167 files / 1580 tests | CURRENT_STATUS §5 |
| scripts 套件 | 9 files / **129 tests**（collect-perf 修复 +4） | `test:harmony-scripts` |
| HAP | `entry-default-unsigned.hap` **4,649,568 bytes** | Wave 1 构建 |
| 冷启动（Page begin → content ready） | **579ms** | `harmony/docs/reports/perf-report-wave1.json` |
| PSS | **144232 KB**（≈141 MiB） | 同上 |
| 模拟器 | `nova 16 Pro`，HarmonyOS 6.0.2(22)，`127.0.0.1:5555` | CLI 拉起实测 |
| HarmonyBridge.ets | 1213 行，方法按 6 域聚集（RDB×6 / Preferences×2 / TTS×4 / 通知提醒×5 / FIFO×5 / 生命周期+触感） | 结构扫描 |
| pages/Index.ets | 535 行（ArkWeb 容器 + 加载层 + console 转发 + launch query 透传） | 结构扫描 |

## 3. Stage 分解

### S1 — B1 上帝文件拆分

**HarmonyBridge.ets → facade + 域委托**：

- `HarmonyBridge` 保留为 facade：单例、`refreshContext`、方法注册表分发（`BridgeMethodRegistry.ets` 是唯一方法真源，**契约面不变**——Web/原生双向集合断言测试已存在，拆分不得改动注册的方法名与签名）。
- 按既有域拆出委托（与现有 `MemoryCardStore` / `NotificationService` / `ReminderAgentService` / `FormIdStore` 对接，把 HarmonyBridge 内的粘合逻辑下沉）：
  - `bridge/delegates/CardBridgeDelegate.ets`（upsertCard / deleteCard / getAllCards / getRecentlyReviewedCards / getTodayReviewStats / getDueCardsCount）
  - `bridge/delegates/PrefsBridgeDelegate.ets`（read/writePreferences）
  - `bridge/delegates/SpeechBridgeDelegate.ets`（speak / stopSpeech / isSpeechSupported / getSpeechEngines）
  - `bridge/delegates/NotifyBridgeDelegate.ets`（registerReminder / notifyReviewCompleted / requestNotificationPermission / scheduleReviewReminder / cancelReviewReminder）
  - `bridge/delegates/LaunchQueueDelegate.ets`（handleHarmonyLaunch / notifyWebReady / notifyWebContentReady / resumePendingLaunches / 超时复位）
  - 触感 `triggerHapticFeedback` 体量小，留在 facade。
- 每个委托持有 context 的方式必须走 `refreshContext` 同源刷新（Wave 1 已埋的刷新点），禁止委托自持陈旧 context。
- `pages/Index.ets`：仅提取与 ArkWeb 容器无关的独立单元（加载层组件、console 转发过滤器），**不做**激进重排——535 行属可接受范围，本轮以 HarmonyBridge 为主目标。

**验收**：tsc 0 / oxlint 0w0e / vitest 全绿零回归 / `build:harmony` + `build:harmony:hap` 通过 / `verify:harmony-runtime` A1–A7 全 PASS / collect-perf 冷启动与 PSS 无显著回退（冷启动 +200ms 内、PSS +5% 内视为噪声）。

### S2 — 服务卡跨进程刷新运行时验证（探针先行）

- 先做 **15 分钟可行性探针**：模拟器桌面能否添加 2×4 服务卡（FormExtensionAbility `onAddForm` 日志可见即可行）。
- 可行 → 固化为自动化断言脚本（挂到 seed-and-verify 或独立 `verify:harmony-form`）：复习完成 → hilog 断言 `refreshAllForms` → `updateForm` 数据推送。
- 不可行（模拟器不支持卡片添加）→ 如实 NOT DELIVERED，转真机验收项，不伪造。

### S3 — HAP 体积归因闭环

- 用已沉淀的自读 zip central directory 方法（`0x06054b50` / `0x02014b50`，按条目排序归因）对比 Wave 1 HAP 与 v1.6.2 HAP（若产物已不在，checkout 对应 tag 重建）。
- 输出：+133,600 bytes 的逐条目归因表 + v1.6.2 轮 122 KB 欠账的补归因。归档进 Vault 报告。

### S4 — webkit/firefox E2E 矩阵决策（web 侧遗留，本轮一并决策）

- 现状：chromium 24/24 基线全绿；全矩阵 89/96（webkit ×6 + firefox ×1，全部是 webkit-on-Windows 能力差异，非本轮回归）。
- **推荐方案：矩阵收缩**——CI 与本地默认只跑 chromium（产品目标平台是 ArkWeb/Chromium 内核 + 桌面 Chrome），webkit/firefox 保留为手动 `--project` 选项并在 `playwright.config.ts` 注释定性。理由：修 webkit 兼容（30s 超时/下载 API/SW/speechSynthesis 四类）工程量大且产品收益存疑。
- 备选：修 webkit 兼容（工作量约一个完整 Stage，不在本轮推荐）。

### S5 — 版本收口

- bump：web `3.6.3` / AppScope·entry `1.6.3` / versionCode `1000080`（1.x 线每版 +5 规则延续）。
- CHANGELOG + Vault 报告（`v1.6.3-HARMONY-QUALITY-REPORT.md`）+ CURRENT_STATUS 同步（唯一数字真源）。

## 4. 全局验收标准

1. 四道门：tsc 0 / oxlint 0w0e / vitest 全绿零回归 / E2E chromium 基线全绿。
2. `build:harmony` + `build:harmony:hap` 通过；`check:versions` PASS。
3. `verify:harmony-runtime` A1–A7 全 PASS（拆分后的实际证据，非拆分前的）。
4. 服务卡验证：自动化断言落地，或如实 NOT DELIVERED 记录探针证据。
5. HAP 体积归因表进 Vault；两个未归因数字清零。
6. 版本四处对齐 + versionCode 单调性通过。

> 执行期状态（2026-09-29 收口，详见 §7 R2）：第 1、2、5、6 条已满足（E2E chromium 24/24、`build:harmony:hap` PASS 4,809,670 bytes、S3 归因清零、版本四处对齐 + versionCode 单调性 PASS）；**第 3 条未满足**——模拟器离线，`verify:harmony-runtime` 未执行，S1 的运行时证据缺失；第 4 条 S2 NOT DELIVERED（模拟器离线）。

## 5. 风险与边界

| 风险 | 缓解 |
|---|---|
| 拆分引入启动队列/FIFO 回归 | FIFO 是冷启动关键链路：A1–A7 断言链直接覆盖；`runJavaScript` 超时复位与 `pendingLaunchQueries` 上限行为保持逐字不变 |
| ArkTS 约束（arkts-no-obj-literals-as-types 等） | 委托类型全部显式 interface；API 22 常见坑清单已在用户级 MEMORY 沉淀 |
| 模拟器会话不稳定 | CLI 拉起命令已入 CURRENT_STATUS §6；HAP 与报告可离线复跑 |
| 服务卡在模拟器不可用 | 探针先行，15 分钟内定性，不可行即 NOT DELIVERED |
| push 通道间歇性 RST | 已验证 credential-store + `credential.helper=` 空值重置命令链；恢复后补推 |

## 6. 明确不做（本轮）

- 签名 HAP / 真机验收（TTS、振动、通知触觉）——外部条件不变。
- `reminderAgent` 开放能力验证——无权益。
- `.env.harmony` LLM 代理端到端——无配置。
- `window.__applyNativeCardRestore` 的 TODO(API22) 清除——依赖系统级 webview 修复。

## 7. 执行期修订记录

### R1 — UX 缺陷轮前置（用户实测反馈，2026-09-26）

用户确认 SPEC 的同时报告实测问题：①输入释义的输入框乱跑且全局卡顿；②功能不明确；③设置界面信息冗余。判定 UX 缺陷优先级高于 S1 结构重构，插入 S-UX1 / S-UX2 两阶段：

**S-UX1（已完成，commit `317ed59`）— 输入面板乱跑+卡顿根因修复**：

- 根因：CSS 级联 `animation fill-forwards > inline style > class`。InlineAnswerPanel 把 `pageEntrance` 入场动画内联叠加在面板上，动画终态 `transform: translateY(0)`（无 `translateX(-50%)`）永久压死 `.panel.open` 的居中位移与边缘偏移修正 → 面板右漂约半宽（~170px）→ 溢出视口 → 浏览器 focus 自动滚屏 → `usePanelPosition` 的 capture scroll 监听重算位置 → transform 过渡滑行 → 循环 = 乱跑 + 卡顿。
- 修复：面板与入场动画解耦；`--panel-shift-x` 统一承载水平位移（center = `calc(-50% + Npx)`，edge = 纯 `Npx`）；transform 移出 transition（纠错瞬时化）；GrammarPanel 同型 keyframes 硬编码问题一并修；缺省 anchorRef 改稳定引用（此前每 keystroke 强制 reflow）；死代码清除（useVocabPulseAnimation + vocabPulse keyframes，全仓无规则命中的死类）。
- 回归：`panelPositioning.test.ts` 7 项 CSS 契约 + InlineAnswerPanel 2 项定位/焦点不变量；vitest **168 files / 1593 tests**（1580 + 4 collect-perf + 9 本轮，账目闭合）/ E2E chromium **24/24** / tsc 0 / oxlint 0w0e。

**S-UX2（待用户决策）— 设置面板信息架构精简**：审计结论 = 单弹层 **13 个区块**（语言模型提供商 / 连接配置 / 测试连接 / LLM 路由 / 课程模式 / 预设模板 / 配置迁移 / 外观主题 / 应用安装 / FSRS 参数优化 / 词库管理 / AI 释义缓存 / 复习提醒），其中 LLM 配置占 4 个语义重叠区块。精简提案见 §10 决策点。

### R2 — S1/S3/S4 执行记录（2026-09-29）

**前置决策**：模拟器本轮离线，S1 的运行时门禁（A1–A7）跑不了 → 用户选择「**拆分 + 离线项一起推进**」（只跑静态门禁，运行时复证留待模拟器在线）；拆分必然要改 4 个安全守卫测试的读取路径（断言不变）→ 用户选择「**按计划拆 4 域 + 改守卫指向**」。

**S1（已完成，工作树未提交）— B1 上帝文件拆分**

- `bridge/HarmonyBridge.ets` **1170 → 533 行 facade**；新增 `bridge/delegates/`：
  - `CardBridgeDelegate.ets`（288 行）· `PrefsBridgeDelegate.ets`（146 行）· `SpeechBridgeDelegate.ets`（168 行）· `NotifyBridgeDelegate.ets`（280 行）
- 契约面逐字不变（`BridgeMethodRegistry.ets` 仍为唯一方法真源，20 方法名/签名保留）；facade `refreshContext` 同源刷新 Card / Prefs / Notify 三委托；Speech 无 context（TTS 为无 context 单例）。
- **执行期偏离 SPEC §3 S1**（两处，均为缩窄而非扩大）：
  1. 未抽取 `LaunchQueueDelegate.ets`——launch 域（FIFO / ready 握手 / 超时复位）与冷启动链路强耦合，`runJavaScript` 超时复位与 `pendingLaunchQueries` 上限（16）行为须逐字不变，留在 facade。
  2. `pages/Index.ets` 未做结构抽取（508 行，与拆分前等长）；本轮仅把加载/错误层硬编码色值改为 `$r('app.color.*')` 资源引用（属设计 token 收敛，非拆分）。
- **守卫测试**：4 个静态守卫测试读取路径改指委托文件，**断言文本逐字不变**——`harmony-widget.test.ts` → Card；`cardDataProvider.test.ts` / `reminderAgentSafety.test.ts` → Notify；`textToSpeechService.test.ts` → Speech。
- **门禁（实测，2026-09-29）**：tsc 0 / oxlint 0w0e（387 文件）/ vitest **170 files / 1604 tests** 全绿 / `build:harmony` `passed (60 ESM/Worker JS, 8 CSS, 89 files, 72 local references)` / `build:harmony:hap` `BUILD SUCCESSFUL`（**4,798,144 bytes**，连续两次构建逐字节相同）。**`verify:harmony-runtime` 未执行**（模拟器离线）——本轮只到「自动测试 + HAP 编译」层级。

**S3（已完成）— HAP 体积归因闭环**

- 工具 `scripts/attribute-hap-size.mjs`（自读 zip central directory）+ 单测 `scripts/attribute-hap-size.test.mjs`（7 项）；3 worktree（`f26f613` / `d247f9d` / `73a94ab`）+ junction 同环境重建。
- 两个欠账清零：Wave 1 记录 `+133,600 B` → 真实源码级 `+15,270 B`；v1.6.2 记录 `−249,171 B` → 真实源码级 `−120,062 B`；共同根因 = 记录产物缺 `ets/sourceMaps.map`（129,676 B）。
- 报告：`docs/vault/v1.6.3-HAP-SIZE-ATTRIBUTION-REPORT.md`；数据：`harmony/docs/reports/hap-attribution-*.json`。

**S4（已完成）— E2E 矩阵收缩（决策落地）**

- 默认与 CI 只跑 chromium；firefox / webkit / mobile-chrome 降级为手动 opt-in（`E2E_FULL_MATRIX=true`）。`playwright.config.ts` 已加定性注释，`.github/workflows/playwright.yml` 同步（`playwright install` 只装 chromium）。

**S5（已完成，2026-09-29 收口）— 版本收口**

- bump：web `3.6.3` / AppScope·entry `1.6.3` / versionCode `1000080`（1.x 线每版 +5 规则）；`check:versions` PASS（四处对齐 + versionCode 单调性，已高于 `last-release.json` 的 `1000075`）。
- CHANGELOG `[3.6.3]` 章节 + `docs/vault/v1.6.3-HARMONY-QUALITY-REPORT.md` + `harmony/CURRENT_STATUS.md` 版本口径同步。

**S2 未交付**

- S2 服务卡跨进程刷新运行时验证：探针先行，依赖模拟器在线；本轮模拟器离线，探针无法执行 → 如实 NOT DELIVERED，转真机验收项，不伪造。
- S1 运行时复证（A1–A7 + collect-perf）：模拟器在线后补跑（判据：冷启动 +200ms 内、PSS +5% 内视为噪声）；详见 `docs/vault/v1.6.3-HARMONY-QUALITY-REPORT.md` §5。

## 10. S-UX2 设置面板精简提案（决策点）

三层信息架构：

| 层 | 内容 | 处置 |
|---|---|---|
| 常显层 | 外观主题 / 语言 / 课程模式 / 复习提醒 / LLM 提供商+模型+Key+测试连接（四区块合一） | 保留并整合 |
| 高级折叠（LLM） | temperature / timeout / maxRetries / streaming / LLM 路由 | `<details>` 默认折叠 |
| 数据与高级折叠 | FSRS 参数优化 / AI 释义缓存 / 词库管理 / 配置迁移 | `<details>` 默认折叠 |
| 语境化 | 应用安装（PWA） | 仅 web PWA 语境显示，ArkWeb/harmony 内隐藏 |

同时解决「功能不明确」：所有折叠组头行加一句后果说明（如「LLM 路由 = 多提供商按权重分流，单 Key 用户保持关闭」）；「课程模式」「预设模板」与提供商预设的语义重叠需在执行期逐一裁定保留/合并/删除。

## 9. Approval Gate

> 审批状态：**已批准**（2026-09-26 用户确认「开工」；决策点 1 选「是」、2 选「不激进重排」、3 选「收缩为 chromium 基线」）。执行结果与偏离见 §7 R1 / R2。

回复「**确认**」即按上述 S1→S5 顺序执行（子代理执行，主 session 审计收口）。决策点：

1. **B1 本轮执行？** 推荐：是（运行时回归手段已具备，A1–A7 断言链可即时抓回归）。
2. **Index.ets 拆分深度**：推荐：仅提取加载层/console 过滤器，不激进重排。
3. **S4 webkit 矩阵**：推荐收缩为 chromium 基线 + 手动 project 选项；或选「修 webkit 兼容」。
4. **versionCode 1000080**（+5 规则）：如无异议默认执行。
