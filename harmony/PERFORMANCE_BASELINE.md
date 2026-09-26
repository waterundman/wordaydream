# Wordaydream 鸿蒙版性能基线报告 (Stage 8)

> **本文档的事实基线（版本 / SDK / 设备矩阵 / 已完成的验证层级）以 [CURRENT_STATUS.md](./CURRENT_STATUS.md) 为唯一真源；本文件仅保留「性能指标定义 + 测试方法 + 采集结果填写位」这一职责。**
>
> **当前状态：基线待采集。** 下文 5 项指标的「真机测试结果」全部为空，采集入口是 `npm run collect:harmony-perf`（`scripts/harmony/collect-perf.mjs`，模拟器/真机在线时运行；离线时输出 `skipped:true` 且退出码 0）。在采集完成前，本文件中的任何数字都不得被引用为实测值，也不得与 CURRENT_STATUS §5 的构建/测试证据混层（四层验证不互相替代）。

> **用途**: 元服务性能基线测试模板, 真机测试由用户在 DevEco Studio 内完成.
> **沙箱约束**: subagent 无法运行 DevEco Profiler / 真机测试, 仅提供报告模板.
> **关联**: RELEASE_CHECKLIST.md §性能基线测试 / e2e/harmony_full.spec.ts HF02/HF10 (软门控) / CURRENT_STATUS.md §6 可复现工作流.

## 测试环境要求

| 项目 | 要求 |
|---|---|
| DevEco Studio / HarmonyOS SDK | 以 [CURRENT_STATUS §2 工程基线](./CURRENT_STATUS.md#2-工程基线) 为准（当前 HarmonyOS 6.0.2 / API 22），本文件不维护版本副本 |
| 测试设备 | 真机（推荐旗舰机型）；模拟器数据仅供参考，且不能证明振动/提醒类行为 |
| 设备状态 | 非低电量 (< 20% 警告), 非省电模式, 后台无重负载应用 |
| 构建类型 | 签名 release；**当前仓库 `signingConfigs` 为空，只能产出 unsigned HAP，故真机 release 基线在签名就绪前不可采集** |
| 测试次数 | 每项至少 30 次取样, 取 P95 (排除最高/最低各 5%) |

## 性能指标清单 (5 项)

### 1. 冷启动时间

| 项 | 值 |
|---|---|
| **目标值** | < 3000ms (P95) |
| **测试方法** | DevEco Profiler → App Launch; 记录从点击图标到 HomePage hero-section 可见的时间 |
| **测试设备** | 真机（机型与系统口径见上文「测试环境要求」） |
| **取样** | 30 次, 取 P95 |
| **报告格式** | `冷启动 P50: ___ms, P95: ___ms, P99: ___ms` |
| **真机测试结果** | _（用户填写）_ |
| **沙箱参考值** | Playwright Chromium (localhost:3001): 通常 < 2000ms (见 e2e/harmony_full.spec.ts HF02) |

### 2. 热启动时间

| 项 | 值 |
|---|---|
| **目标值** | < 1000ms (P95) |
| **测试方法** | 元服务切到后台 ≥ 5s 后切回前台; 记录从手势切回到 hero-section 可见的时间 |
| **测试设备** | 真机（机型与系统口径见上文「测试环境要求」） |
| **取样** | 30 次, 取 P95 |
| **报告格式** | `热启动 P50: ___ms, P95: ___ms, P99: ___ms` |
| **真机测试结果** | _（用户填写）_ |
| **沙箱参考值** | Playwright page.reload(): 通常 < 1000ms (见 e2e/harmony_full.spec.ts HF10) |

### 3. 内存占用

| 项 | 值 |
|---|---|
| **目标值** | < 200MB (PSS, 稳态) |
| **测试方法** | DevEco Profiler → Memory; 进入阅读页生成 1 篇 passage 后, 稳态 60s 取均值 |
| **测试设备** | 真机（机型与系统口径见上文「测试环境要求」） |
| **取样** | 5 次独立会话, 取最高值 |
| **报告格式** | `PSS 峰值: ___MB, 稳态: ___MB, ArkWeb 进程: ___MB` |
| **真机测试结果** | _（用户填写）_ |
| **说明** | ArkWeb 容器 + Vite 构建产物, 内存主要被 Chromium 内核 + IndexedDB 占用 |

### 4. 服务卡片刷新延迟

| 项 | 值 |
|---|---|
| **目标值** | < 500ms (从数据变更到卡片 UI 更新) |
| **测试方法** | 在元服务内完成一次 rateCard (触发 due count 变更); 记录从 rateCard 返回到桌面卡片显示新数值的时间 |
| **测试设备** | 真机（见上文「测试环境要求」）, 桌面已添加 2x2 + 2x4 卡片 |
| **取样** | 10 次, 取 P95 |
| **报告格式** | `卡片刷新 P50: ___ms, P95: ___ms` |
| **真机测试结果** | _（用户填写）_ |
| **说明** | 卡片刷新受系统定时限制，业务侧真实主动推送链路是 `notifyReviewCompleted` → `FormRefresher.refreshAllForms` → `formBindingData` `updateForm`（数据组装在 `widget/CardDataProvider.ets`，跨进程实测仍待补，见 CURRENT_STATUS §3 服务卡行）。早期文档写的 emitter / onFormEvent 通道已作为死代码删除，不再是实现路径。 |

### 5. ArkWeb 滚动 FPS

| 项 | 值 |
|---|---|
| **目标值** | > 50 FPS (阅读页长文本滚动) |
| **测试方法** | DevEco Profiler → ArkWeb Performance; 阅读页生成 1 篇长 passage, 手动滚动 30s, 取平均 FPS |
| **测试设备** | 真机（机型与系统口径见上文「测试环境要求」） |
| **取样** | 3 次独立滚动会话, 每次 30s, 取均值 |
| **报告格式** | `平均 FPS: ___, 最低 FPS: ___, 丢帧率: ___%` |
| **真机测试结果** | _（用户填写）_ |
| **说明** | ArkWeb 基于 Chromium 内核, 滚动性能与 Chromium 一致; passage-token 高亮不影响滚动 (CSS transform 加速) |

## 测试结果汇总 (用户填写)

> **自动化采集**：冷启动耗时与进程 PSS 两项可由 `npm run collect:harmony-perf -- --hdc <hdc.exe 路径> --out perf-report.json` 在设备在线时自动采样（离线时 `skipped:true` + 退出码 0）；其余三项仍需 DevEco Profiler 人工取样。采集结果回填本表后，同步在 CURRENT_STATUS §5 增补一条带日期的性能证据。

| 指标 | 目标 | 实测 | 是否达标 | 备注 |
|---|---|---|---|---|
| 冷启动时间 | < 3000ms | ___ | __ | _（待 collect-perf 采集）_ |
| 热启动时间 | < 1000ms | ___ | __ | _（待采集）_ |
| 内存占用 | < 200MB | ___ | __ | _（待 collect-perf 采集 PSS）_ |
| 服务卡片刷新延迟 | < 500ms | ___ | __ | _（待采集，跨进程刷新本身待运行验证）_ |
| ArkWeb 滚动 FPS | > 50 | ___ | __ | _（待采集）_ |

## 不达标处理

若某项不达标, 按以下优先级排查:

1. **冷启动 / 热启动超时**
   - 检查 rawfile/dist 资源体积 (应 < 2MB, gzip 后)
   - 检查 EntryAbility.ets 启动时是否阻塞 (同步 IO)
   - 检查 ThemeProvider / settings store 初始化是否阻塞首屏

2. **内存超 200MB**
   - 检查 IndexedDB 是否有未关闭的连接
   - 检查 passage-token 渲染数量 (长文本分段虚拟化)
   - DevEco Memory Profiler 抓 heap snapshot 分析泄漏

3. **卡片刷新超 500ms**
   - 检查 CardDataProvider.ets 数据序列化开销
   - 检查 onFormEvent 是否在主线程阻塞
   - 考虑降低卡片刷新频率 (60 分钟限制内)

4. **ArkWeb FPS < 50**
   - 检查 passage-token 是否触发布局重排 (避免 box-shadow 动画)
   - 检查 CSS containment (will-change: transform)
   - DevEco ArkWeb Performance 抓帧分析
