# Wordaydream 鸿蒙版性能基线报告 (Stage 8)

> **版本**: v0.1.0-harmony Stage 8
> **用途**: 元服务性能基线测试模板, 真机测试由用户在 DevEco Studio 内完成.
> **沙箱约束**: subagent 无法运行 DevEco Profiler / 真机测试, 仅提供报告模板.
> **关联**: RELEASE_CHECKLIST.md §性能基线测试 / e2e/harmony_full.spec.ts HF02/HF10 (软门控).

## 测试环境要求

| 项目 | 要求 |
|---|---|
| DevEco Studio | 5.0.5+ |
| HarmonyOS SDK | 5.0+ (API 12) |
| 测试设备 | 真机 (推荐 Mate 60 / P60 系列, 鸿蒙 5.0+); 模拟器数据仅供参考 |
| 设备状态 | 非低电量 (< 20% 警告), 非省电模式, 后台无重负载应用 |
| 构建类型 | release (signingConfig: "release", 见 build-profile.json5) |
| 测试次数 | 每项至少 30 次取样, 取 P95 (排除最高/最低各 5%) |

## 性能指标清单 (5 项)

### 1. 冷启动时间

| 项 | 值 |
|---|---|
| **目标值** | < 3000ms (P95) |
| **测试方法** | DevEco Profiler → App Launch; 记录从点击图标到 HomePage hero-section 可见的时间 |
| **测试设备** | 真机 (Mate 60 / P60, HarmonyOS 5.0+) |
| **取样** | 30 次, 取 P95 |
| **报告格式** | `冷启动 P50: ___ms, P95: ___ms, P99: ___ms` |
| **真机测试结果** | _（用户填写）_ |
| **沙箱参考值** | Playwright Chromium (localhost:3001): 通常 < 2000ms (见 e2e/harmony_full.spec.ts HF02) |

### 2. 热启动时间

| 项 | 值 |
|---|---|
| **目标值** | < 1000ms (P95) |
| **测试方法** | 元服务切到后台 ≥ 5s 后切回前台; 记录从手势切回到 hero-section 可见的时间 |
| **测试设备** | 真机 (Mate 60 / P60, HarmonyOS 5.0+) |
| **取样** | 30 次, 取 P95 |
| **报告格式** | `热启动 P50: ___ms, P95: ___ms, P99: ___ms` |
| **真机测试结果** | _（用户填写）_ |
| **沙箱参考值** | Playwright page.reload(): 通常 < 1000ms (见 e2e/harmony_full.spec.ts HF10) |

### 3. 内存占用

| 项 | 值 |
|---|---|
| **目标值** | < 200MB (PSS, 稳态) |
| **测试方法** | DevEco Profiler → Memory; 进入阅读页生成 1 篇 passage 后, 稳态 60s 取均值 |
| **测试设备** | 真机 (Mate 60 / P60, HarmonyOS 5.0+) |
| **取样** | 5 次独立会话, 取最高值 |
| **报告格式** | `PSS 峰值: ___MB, 稳态: ___MB, ArkWeb 进程: ___MB` |
| **真机测试结果** | _（用户填写）_ |
| **说明** | ArkWeb 容器 + Vite 构建产物, 内存主要被 Chromium 内核 + IndexedDB 占用 |

### 4. 服务卡片刷新延迟

| 项 | 值 |
|---|---|
| **目标值** | < 500ms (从数据变更到卡片 UI 更新) |
| **测试方法** | 在元服务内完成一次 rateCard (触发 due count 变更); 记录从 rateCard 返回到桌面卡片显示新数值的时间 |
| **测试设备** | 真机 (Mate 60 / P60, HarmonyOS 5.0+), 桌面已添加 2x2 卡片 |
| **取样** | 10 次, 取 P95 |
| **报告格式** | `卡片刷新 P50: ___ms, P95: ___ms` |
| **真机测试结果** | _（用户填写）_ |
| **说明** | 卡片刷新受系统 60 分钟定时限制, 业务变更通过 onFormEvent / messageEvent 主动推送; 见 harmony/entry/.../widget/CardDataProvider.ets |

### 5. ArkWeb 滚动 FPS

| 项 | 值 |
|---|---|
| **目标值** | > 50 FPS (阅读页长文本滚动) |
| **测试方法** | DevEco Profiler → ArkWeb Performance; 阅读页生成 1 篇长 passage, 手动滚动 30s, 取平均 FPS |
| **测试设备** | 真机 (Mate 60 / P60, HarmonyOS 5.0+) |
| **取样** | 3 次独立滚动会话, 每次 30s, 取均值 |
| **报告格式** | `平均 FPS: ___, 最低 FPS: ___, 丢帧率: ___%` |
| **真机测试结果** | _（用户填写）_ |
| **说明** | ArkWeb 基于 Chromium 内核, 滚动性能与 Chromium 一致; passage-token 高亮不影响滚动 (CSS transform 加速) |

## 测试结果汇总 (用户填写)

| 指标 | 目标 | 实测 | 是否达标 | 备注 |
|---|---|---|---|---|
| 冷启动时间 | < 3000ms | ___ | __ | _（用户填写）_ |
| 热启动时间 | < 1000ms | ___ | __ | _（用户填写）_ |
| 内存占用 | < 200MB | ___ | __ | _（用户填写）_ |
| 服务卡片刷新延迟 | < 500ms | ___ | __ | _（用户填写）_ |
| ArkWeb 滚动 FPS | > 50 | ___ | __ | _（用户填写）_ |

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
