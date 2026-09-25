# Wordaydream v1.6.1 SPEC — 前端优化与交互升级

**版本**: v1.6.1（web `3.6.1` / harmony `1.6.1` / versionCode `1000070`）
**日期**: 2026-09-25
**方向来源**: 用户指令「从前端优化，动画等交互逻辑升级去考虑」
**替代关系**: 本版**取代** `docs/vault/v1.6.1-NEXT-VERSION-DIRECTION.md` 的「例句层」主推方向（该方向降级为 v1.6.2 候选，理由见 §10）
**起点 posterior**: 0.99（v1.6.0 终点承接）
**沙箱可执行**: 100%（全部为前端代码 + 静态资源；无外部服务依赖）

---

## 1. 背景：为什么本轮从前端入手

v1.6.0 完成了「课程化」数据层与教学编排层（英语 CEFR 词表 4070 词条、生成约束、难度解锁、毕业机制）。数据与逻辑已就位，但**感知层从未被系统性优化过**：动画系统是逐版本叠加出来的（25 个 CSS 文件含 `@keyframes`、58 个文件含 `transition/animation`），既留下了死代码，也有可量化的负载浪费。

本轮不改架构，只做**可测量的优化与体验修补**：首屏负载、静态资源格式、过渡一致性、动效守卫、焦点可达性。

---

## 2. 实测基线（本轮勘察产出，全部为命令实测值）

### 2.1 构建产物

| 指标 | 实测值 | 来源 |
|---|---|---|
| JS 合计 | **2277 KB / 60 chunk** | `find dist -name "*.js"` 聚合 |
| CSS 合计 | 178 KB / 8 文件 | 同上 |
| **首屏 JS** | **389 KB**（entry 29.0 KB + 21 个 `modulepreload` chunk 360.4 KB） | `dist/index.html` preload 清单逐个 `stat` 求和 |
| 首屏最大 chunk | `react-vendor` 178.3 KB、`radix-ui` 58.4 KB、`entry` 29.0 KB、`passages` 26.2 KB | 同上 |
| 8 个词表 chunk | 971 KB（en 4 + de 4，均动态 import 不进首屏） | `ls -l dist/assets/{a,b}[12]-*.js` |
| 公共静态资源 | **1.08 MB / 18 文件** | `find public -type f` 聚合 |

> 注：`dist/` 内 mtime 较旧的 18 个文件经核实是 `public/` 的**拷贝**（Vite 保留源文件 mtime），**不是陈旧残留** —— 初始怀疑已被证伪，`dist/` 干净。

### 2.2 静态资源压缩实测（Pillow 12.0.0，system python）

| 文件 | 原大小 | WebP q80 | AVIF q60 | 说明 |
|---|---|---|---|---|
| `paper-texture-dark.jpg` | 302.0 KB | 160.7 KB (−46.8%) | 132.4 KB (−56.2%) | CSS `background-image`（2 处） |
| `paper-texture-warm.jpg` | 213.9 KB | 68.6 KB (−67.9%) | 42.7 KB (−80.0%) | CSS `background-image`（1 处） |
| `ink-splash-terracotta.jpg` | 206.2 KB | 61.1 KB (−70.4%) | 50.2 KB (−75.7%) | `<img>`（1 处） |
| **纹理小计** | **722.1 KB** | **290.4 KB (−59.8%)** | **225.3 KB (−68.8%)** | |
| `icon-512.png` | 294.3 KB | — | — | PNG `optimize=True` **零收益**；`quantize256` → 157.3 KB (−46.5%) |
| `icon-192.png` | 44.9 KB | — | — | `quantize256` → 24.2 KB (−46.1%) |
| **图标小计** | **339.2 KB** | | | → **181.5 KB (−46.5%)** |
| **可优化合计** | **1061.3 KB** | | | **→ 472 KB，可省 ~589 KB（−55.5%）** |

维度补充：两张 paper texture 均为 1368×768，ink-splash 为 1024×1024。

### 2.3 动画与交互现状

| 项 | 实测 | 说明 |
|---|---|---|
| 含 `@keyframes` 的 CSS | 25 个文件 | `src/styles/animations.css` 为中枢 |
| 含 `transition/animation` 的 CSS | 58 个文件 | |
| CSS module 总数 | 57 | |
| `prefers-reduced-motion` 处理 | tokens.css 全局 + 多数组件模块 | 覆盖较好；**但 `useCursorGlow` 无守卫** |
| `content-visibility` | **0 处** | 未使用 |
| `will-change` | 14 个 CSS 文件 | 需审计是否常驻提升合成层 |
| `PageTransition.tsx` | **零引用（死代码）** | 仅被 `useUrlHashSync.ts` 注释提及 |
| 路由预取 | **无** | `scheduleIdleTask`（requestIdleCallback 封装）已存在，但只用于成就评估 |
| View Transitions API | **0 处** | 未使用 |
| 路由切换后焦点管理 | **无**（`App.tsx` 零 `focus()`） | |

---

## 3. 已核实的缺口清单

### P0-1 首屏 JS 含非首屏必需模块（−42 KB 潜力）

机制已定位：`App.tsx` 静态导入 `useReadingSessionStore`（仅取 `mode`）→ 该 store 静态导入 `mocks/passages`（26.2 KB chunk）与 `useCourseStore`（15.9 KB chunk）+ `achievements/buildContext` + `data/courses`。因此**首屏就下载了 mock 语料与课程 store**，而它们只在下钻到阅读/课程页时才需要。

> 待执行期验证：需确认收窄 selector 后 Vite 是否真的把这 42 KB 移出 preload 清单（rolldown 的 preload 推导可能因其他引用路径保留）。

### P0-2 装饰性静态资源未现代化（−589 KB 潜力）

3 张纹理 + 2 个图标合计 1061 KB，实测可压至 472 KB（§2.2）。其中 **`icon-512.png` 单个占 294 KB** 最突出 —— 同为 PNG 且 `optimize=True` 已无收益，说明它是**用无损 PNG 存了照片型内容**。

### P1-1 死代码：`PageTransition`

`src/components/PageTransition.tsx` + `PageTransition.module.css` 零引用。App.tsx 实际使用 `InkWipeTransition`。

### P1-2 `App.tsx` 过渡层重复 5 次 + 导航一致性缺陷

- 5 个路由分支各自包裹一份 `<InkWipeTransition active onCovered onComplete>`（5× 重复，易漂移）
- `navigateTo` 在 `isTransitioning === true` 时**同步 `setAppMode` 绕过过渡**（v2.4.0 为修死锁而加）。副作用：**首屏开场动画（1.9s）期间点击任何导航都没有过渡**，与常态交互不一致。

### P1-3 路由切换后零焦点管理（可访问性真实缺口）

`App.tsx` 无任何焦点处理。从首页（点击「开始阅读」）切到阅读页后：被点击的按钮已卸载，焦点落回 `document.body`，键盘用户 Tab 从头开始，读屏用户不会被告知页面已切换。这是一个**功能可用但交互不完整**的缺陷。

### P2-1 动效守卫不足

- `useCursorGlow(true)` 无条件启用：无 `prefers-reduced-motion` 守卫、无 `pointer: coarse` 守卫。触摸设备（Harmony 手机）上 `mousemove` 永不触发 → 白挂一个 `position: fixed` 200×200 层 + 2 个监听器；`will-change: transform, opacity` 常驻提升合成层。全局 reduced-motion 规则只把 `transition-duration` 压到 0.01ms，元素与监听器**依然存在**。
- `glow.className = 'cursor-glow'` 是**空类名**：全仓无任何 CSS 规则命中 `.cursor-glow`，全部样式走内联（误导性残留）。

### P2-2 无路由预取

5 个 lazy 路由 + SettingsPanel。首次进入任一页面都要等一次 chunk 下载，期间只显示纯文字 `LoadingFallback`（「加载中…」）。`scheduleIdleTask` 已就位，复用它做 idle 预取的边际成本极低。

### P2-3 `will-change` 常驻（14 文件）

需逐文件判定：装饰性常驻动画（如 `[data-breathing]`）保留合理；纯交互触发型应改为激活时加、结束时移除。

---

## 4. 设计决策

### D1 纹理格式：WebP（不用 AVIF）

- WebP 相对 AVIF 少压 33.5 KB（290.4 vs 225.3），但 **WebP 在全部目标引擎上无需 `<picture>` 回退**：3 张纹理中 2 张走 CSS `background-image`，CSS 无法做格式回退（除非 `image-set()`）。用 WebP 即可直接换 URL，实现最简单、风险最低。
- AVIF 的 `image-set()` 方案留作后续可选优化（若后续证实 ArkWeb/浏览器矩阵已全支持，可换）。
- 实现时**保留原 JPG 文件不删**（同目录并存），仅改引用 —— 回滚成本为零。

### D2 图标：保留 PNG，做 256 色量化

- PWA manifest（`vite.config.ts:252-255`）显式声明 `type: 'image/png'`，且 `src/platform/arkWebLocalResourcePolicy.test.ts:27` 断言了 `icon-192.png → image/png` 的 MIME 映射。换格式会同时破坏 PWA 兼容性与既有契约测试。
- 因此只做 **`quantize(colors=256)`**：339 KB → 181.5 KB。**风险：照片型内容量化可能产生色带**，执行时必须逐图目视复核（icon-512 是带纹理底的字标，属高风险图）。

### D3 `content-visibility` 的适用范围

只用于 **HomePage 首屏之下的独立 section**（`TodayCard` / `TodayReviewCard` / `AchievementWall` / seedling 等）。必须配套 `contain-intrinsic-size`（用实测高度，否则滚动条会跳）。**不用**在 `useScrollReveal` 的容器本身上（避免与 IntersectionObserver 的可见性判定相互干扰）。

### D4 焦点管理：切页后聚焦页面容器

切页完成（`handleCovered` 之后）时，把焦点移到当前页面容器（`tabIndex={-1}` + `focus({ preventScroll: true })`），并给容器 `aria-label`。**仅在键盘/读屏路径触发**，不抢鼠标用户的焦点（判定：最近一次交互是否为键盘 —— 用 `:focus-visible` 或记录 last interaction modality）。

### D5 View Transitions API：渐进增强，且**先验证再决定**

`document.startViewTransition` 在 ArkWeb（API 22）的支持**未经验证**。执行顺序强制为：先写探针验证 → 支持才接；不支持则**明确记为 NOT DELIVERED**，不引入不可回退的依赖。

---

## 5. 分阶段实施

### Stage 1: 首屏负载收窄（P0-1 + P2-3 的 `content-visibility` 部分）

1. 收窄 `App.tsx` 的 store 订阅：`useReadingSessionStore` 只取 `mode`；把 `mocks/passages` / `useCourseStore` / `buildContext` / `data/courses` 从入口静态图移出（动态 import 或依赖下沉）
2. HomePage 首屏之下 section 加 `content-visibility: auto` + `contain-intrinsic-size`
3. **前置埋点**：新增 `scripts/measure-bundle.mjs` 输出「首屏 JS 总量 / 各 preload chunk / 静态资源总量」为 JSON，作为 before/after 对比基线
4. 验收：首屏 JS **389 KB → ≤ 350 KB**；`content-visibility` 落地数 ≥ 4

### Stage 2: 静态资源现代化（P0-2）

1. 新增 `scripts/optimize-static-assets.mjs`（Pillow 通道）：3 纹理 → WebP q80；2 图标 → quantize256 PNG
2. 改引用：3 处 CSS `background-image` + 1 处 `<img src>`（走 `publicAssetUrl()`）+ `publicAssetUrl.test.ts` 文件名断言
3. **目视复核**：每张转换后图片必须打开看（尤其 icon-512 色带）；
4. 保留原 JPG（回滚路径）
5. 验收：纹理 + 图标合计 **1061 KB → ≤ 500 KB**；转换后视觉无可见劣化（截图对比归档）

### Stage 3: 动画与过渡升级（P1-1 + P1-2 + D5）

1. 删除死代码 `PageTransition.tsx` / `.module.css`
2. `App.tsx` 5× 过渡包裹 → 提升为**单层**包裹（`<InkWipeTransition>` 包一次 + 内层按 mode `key` 切内容）
3. 修 `navigateTo` 一致性：`isTransitioning` 期间不再静默同步换页，改为**排队** pendingMode（或缩短首屏开场窗口），消除「开场期间导航无过渡」
4. View Transitions API 探针 + 渐进增强（**支持才做**）
5. 验收：`InkWipeTransition` 在 App.tsx 中出现次数 5 → 1；E2E 断言「首屏开场期间导航仍有过渡或正确排队」

### Stage 4: 交互逻辑升级（P1-3 + P2-1 + P2-2）

1. 路由切换焦点管理（D4）
2. `useCursorGlow` 守卫：`pointer: coarse` 不挂载、`prefers-reduced-motion` 不挂载；删除空类名 `.cursor-glow`
3. 路由预取：复用 `scheduleIdleTask` 在 idle 预取 home→reading/wordlist/course；HomePage 卡片上的 hover/focus intent 预取
4. `will-change` 审计（P2-3）：逐文件判定并收敛
5. 验收：`LoadingFallback` 在预取命中时**不出现**（E2E 断言）；焦点迁移断言通过

### Stage 5: 验证 + 版本 bump + 归档

1. 四道质量门 + 新增 perf 基线对比（before/after JSON）
2. 版本 bump：`package.json` 3.6.1 / AppScope·entry 1.6.1 / versionCode 1000070；`check:versions` PASS
3. CHANGELOG + `harmony/CURRENT_STATUS.md` + Vault 报告（含 before/after 数据表 + 诚实声明）

---

## 6. 测试契约

### 6.1 vitest 新增（目标 ~18 项）

- `useCursorGlow.guard.test.ts`（4）：coarse pointer 不挂载 / reduced-motion 不挂载 / 正常挂载且清理 / 无空类名
- `App.routeFocus.test.tsx`（3）：切页后容器获焦 / 鼠标交互不抢焦 / 容器 `tabIndex=-1`
- `App.transition.test.tsx`（3）：单层包裹 / 开场期间导航排队 / `key` 切换生效
- `routePrefetch.test.ts`（3）：idle 预取调用 `import()` / 命中缓存不重复预取 / 预取失败静默
- `staticAssets.test.ts`（3）：纹理引用为 `.webp` / 图标仍为 `.png` 且 MIME 断言不变 / 原 JPG 仍存在（回滚路径）
- `measureBundle.test.mjs`（2）：基线 JSON 结构 / 首屏 JS 汇总正确

### 6.2 E2E 新增（目标 3 项，`e2e/web.spec.ts` → 19）

- T17：首屏加载后 idle 窗口内预取命中 → 点「开始阅读」时 `LoadingFallback` **未出现**且阅读页直达
- T18：reduced-motion 模拟（`prefers-reduced-motion: reduce`）下进入阅读页 → 无动画竞态、内容可见
- T19：键盘 Tab 进入 → 切页后焦点在新页容器（`document.activeElement` 断言）

### 6.3 硬指标

- tsc 0 errors
- vite build 0 errors
- 全量 vitest 全绿（基线 151 files / 1434 tests）
- E2E 19/19
- `verify:wordlists` / `check:versions` PASS
- **首屏 JS ≤ 350 KB、静态资源子集合计 ≤ 500 KB**（`measure-bundle` 前后对比）

---

## 7. 合同预测：v1.6.1 新增 5 合同

- Contract 49: 首屏依赖图收窄（入口静态依赖下沉，首屏 JS ≤ 350 KB）
- Contract 50: 静态资源现代化（纹理 WebP + 图标 PNG 量化，−55%）
- Contract 51: 过渡层收敛与导航一致性（5× 重复 → 1；开场期间导航不再被吞）
- Contract 52: 路由焦点管理与动效守卫（可访问性 + 省电/低端设备友好）
- Contract 53: 路由预取（idle + intent，消除首次导航 LoadingFallback）

累计：34-35 → **39-40 合同**

---

## 8. 风险与缓解

### 8.1 图标量化产生色带（中）
- 影响：PWA 图标视觉劣化
- 缓解：逐图目视复核 + 截图归档；若劣化可见则**放弃图标量化**，只做纹理 WebP（仍可省 432 KB）

### 8.2 `content-visibility` 引起滚动条跳动或与 scroll reveal 打架（中）
- 影响：首页滚动体验倒退
- 缓解：`contain-intrinsic-size` 用**实测高度**而非估算；只用于首屏之下独立 section；E2E 加滚动稳定性断言；异常即回退该 section

### 8.3 首屏依赖收窄未达预期（中）
- 影响：Contract 49 部分达成
- 缓解：`measure-bundle` 强制 before/after 对比，**用数字说话**；若 rolldown preload 推导仍保留 chunk，则如实记为部分达成并记录原因，不上调 posterior

### 8.4 View Transitions 在 ArkWeb 不支持（高概率）
- 影响：Contract 未含此项（本就规划为渐进增强）
- 缓解：先探针后接入；不支持则显式 NOT DELIVERED，不引入不可回退依赖

### 8.5 焦点管理抢走鼠标用户焦点（中）
- 影响：体验倒退（鼠标用户点击后页面滚动位置异常）
- 缓解：`focus({ preventScroll: true })` + 仅在键盘模态触发；Vitest 双向断言（键盘迁移 / 鼠标不迁移）

### 8.6 预取增加流量与内存（低）
- 影响：低端设备内存压力
- 缓解：只在 idle 且 `navigator.connection.saveData !== true` 时预取；单次预取上限 3 个 chunk

---

## 9. 兼容性（0 breaking change 清单）

- 静态资源：原 JPG **保留不删**，仅改引用 → 可即时回滚
- PWA manifest 图标：格式与 MIME **不变**（仍 PNG），`arkWebLocalResourcePolicy.test.ts` 契约不破
- `useCursorGlow` / `useBreathingEffect` 签名不变（仅加守卫）
- `InkWipeTransition` 对外 props 不变（仅调用点收敛）
- 焦点管理为**新增行为**，不改变既有键盘快捷键语义
- 路由预取为**纯增量**（失败静默降级到原有 lazy 加载）
- store / persist schema **零改动**（本轮不碰数据结构）

---

## 10. 待用户 review 的关键问题

1. **方向替代确认**：本轮以前端优化/动画/交互取代上一轮方向文档里的「例句层」。例句层（英语 4070 + 德语 3366 词条缺例句；`de/a1` 645 条例句为死数据）顺延为 v1.6.2 候选 —— 是否接受？
2. **Stage 2 激进程度**：纹理 WebP 是低风险（−432 KB）；图标量化有目视劣化风险（−158 KB）。是否接受「图标量化 + 目视复核，劣化则放弃」？
3. **Stage 3 的导航一致性修法**：`navigateTo` 在开场期间被吞是 v2.4.0 修死锁留下的副作用。修法有两条 —— (a) pendingMode 排队，等当前动画走完再切（保过渡，但首屏 1.9s 内点击会「排队延迟」）；(b) 缩短首屏开场窗口，让窗口内也能正常过渡。倾向 (b)，但需确认是否接受改动开场时长。
4. **Stage 4 预取是否默认开启**：idle 预取会多下载 ~80 KB（reading/wordlist/course 三个 chunk）。是否默认开启，还是仅 hover/focus intent 时预取（更保守）？

---

## 11. 与 R13 (v1.6.1 原方向) 对比

| 维度 | R13 原方向（例句层） | R13 本方向（前端优化与交互升级） |
|------|----------------------|-----------------------------------|
| 核心 | 词表数据质量与消费闭环 | 感知层负载与交互完整性 |
| 依赖 | 外部例句语料（沙箱不确定） | 全部本地代码 + 静态资源（100% 沙箱可执行） |
| 硬指标 | 例句覆盖率 | 首屏 JS ≤ 350 KB / 静态资源 ≤ 500 KB |
| 风险 | 语料不可达 → 合同无法交付 | 图标量化目视风险 / content-visibility 滚动风险（均可回退） |
| 合同增量 | +3-4 | +5 |
| 顺延 | — | 例句层 → v1.6.2 |

---

## 12. 执行期修订记录

> 原则：不改写 §1-§11 已批准内容，只在此处如实记录执行期与计划的偏离及原因。

### R1（Stage 1）首屏 JS 实际降幅超出阈值

- 计划：§5 Stage 1 验收「首屏 JS 389 KB → ≤ 350 KB」
- 实际：**389.8 KB → 303.1 KB（−86.6 KB / −22.2%）**，超出阈值要求。
- 增量来源（原计划未预见）：`vite.config.ts` 中 `@radix-ui/react-tooltip -> 'radix-ui'` 的
  `manualChunks` 规则，为一个「仅被懒加载路由消费的孤立包」单独建 chunk 时，
  **rolldown 会把 React 运行时同时打进 `react-vendor` 与 `radix-ui` 两个 chunk**
  （实测两份都含 `react.transitional.element` / `Symbol.for('react.portal')` /
  `__REACT_DEVTOOLS`）。移除该规则后 React 只剩一份。
  **判定依据**：全量 JS 仅 +1.6 KB —— 证明收益是「去重复」而非「挪位置」。
- 附带：`main.tsx` 根部 `TooltipProvider` 下沉至 `ReadingSessionPage`
  （全仓唯一消费者 `InteractivePassage` 只在阅读页使用，属职责归属修正；单独不足以移出 radix）。

### R2（Stage 2）原始素材位置：`public/` 同目录 → `assets-sources/`

- 计划：§4 D1 与 §5 Stage 2 第 4 步要求「原 JPG 保留不删（同目录并存）」，§9 记为
  「可即时回滚」的兼容性保证。
- **冲突**：§6.3 / §11 的验收指标「静态资源子集合计 ≤ 500 KB」按 `public/` 目录聚合。
  原图若留在 `public/`，Vite 会整目录复制进 `dist/` —— 合计变成 **1211.3 KB**，
  验收直接不达标。
- 实际做法：原始素材移入仓库根 `assets-sources/`（**不参与打包**）。
  - 保留「仓库内可即时回滚」的意图（`git checkout HEAD -- public/assets public/icons`）
  - 让 `scripts/optimize-static-assets.mjs` **永久可重跑**：调 q 值 / 换量化参数只需改
    `TARGETS` 再跑 `--force`，不必回 git 历史捞二进制
  - 代价：仓库多存 761 KB 原始素材（本就在 git 历史中，属可见化而非新增）
- 验收：`public/` 位图 **1061.3 KB → 471.9 KB（−589.4 KB / −55.5%）** ✓

### R3（Stage 2）图标量化的方法与参数细化

- 计划：§4 D2 仅写「`quantize(colors=256)`」，§5 Stage 2 第 3 步要求「逐图目视复核」。
- 执行期实测发现两个必须明确的约束：
  1. **Pillow 12 限制**：RGBA 图只允许 `FASTOCTREE` 或 `libimagequant`；本机 Pillow
     未编译 `libimagequant`，而 `FASTOCTREE` 对 RGBA 输入只会产出约 64 色（质量受限）。
  2. 两张图标 **alpha 恒为 255**（「假透明」）→ 先降为 RGB，即可用 `MEDIANCUT`
     高质量量化器，且去掉了冗余 alpha 通道。
- 三方案实测对比（由 §5 第 3 步的目视复核流程选定）：

  | 方案 | icon-512 | PSNR | icon-192 | PSNR | 合计 | 判定 |
  |------|----------|------|----------|------|------|------|
  | RGBA + FASTOCTREE 256 | 34.1 KB | 39.0 dB | 7.5 KB | 38.2 dB | 331 KB | 8× 放大可见块状涂抹 |
  | RGB + MAXCOVERAGE 256 | 75.1 KB | 40.2 dB | 15.0 KB | 43.7 dB | 378 KB | 误差图最亮 |
  | **RGB + MEDIANCUT 256** | **157.3 KB** | **45.3 dB** | **24.2 KB** | **46.9 dB** | **472 KB** | **选用** |

- 依据：8× 放大误差图与像素放大对比中 `MEDIANCUT` 明显最保真（误差图最暗、
  细颗粒结构保留最好）；`MEDIANCUT` 降到 160 色时 PSNR 断崖式下滑（45.3 → 41.6 dB）
  而体积仅省 9%，故 256 色即为甜点。目视复核证据：
  `docs/vault/assets/v1.6.1/s2-static-assets-visual-review.webp`。
- 附加：新增 `src/__tests__/staticAssets.test.ts`（5 项）把优化后状态固化为不变式，
  并新增 `npm run verify:static-assets`（`--check` 模式，未优化则 exit 1）。

### R4（Stage 3）View Transitions API：探针已完成，**判定为 NOT DELIVERED**

- 计划：§4 D5「先写探针验证 → 支持才接；不支持则明确记为 NOT DELIVERED」
- **探针结果：引擎支持（原假设"ArkWeb 支持未验证"被证伪）**
  - 运行时探针（playwright chromium，脚本 `.tmp-metrics/view-transition-probe.mjs`）：
    `typeof document.startViewTransition === 'function'`、
    `CSS.supports('view-transition-name: none') === true`
  - 鸿蒙侧内核取证（华为官方 ArkWeb 简介文档）：
    | 系统版本 | ArkWeb Chromium 内核 |
    |----------|----------------------|
    | HarmonyOS 4.1–5.1 | M114 |
    | **HarmonyOS 6.0（本项目目标 6.0.2 / API 22）** | **M132（默认，推荐）** / M114（可选） |
    | HarmonyOS 6.1 | M132 |
    | HarmonyOS 7.0 | M144 |

    View Transitions（same-document）自 Chrome 111 提供 → M114 与 M132 **都满足**。
- **但采纳被否决**（理由是设计收益，不是缺少支持）：
  1. 现有 `InkWipeTransition` 在 cover 阶段以 `transform: scaleX(1)` **全屏遮挡**内容切换
     （`onCovered` 才 `setAppMode`）—— 换页本就不可见，VT 的跨状态快照/交叉淡入
     作用面与之**完全重叠**，没有可见收益。
  2. 若改用 VT 取代墨迹转场，等于把品牌化转场换成通用交叉淡入，属**产品降级**。
  3. 若两者叠加，需把换页改成 `document.startViewTransition(async () => …)` 并
     **await 懒加载 chunk**（VT 要求 DOM 变更在回调内同步完成），与现有
     `React.lazy` + `Suspense` 结构直接冲突，复杂度和回退风险不成比例。
  4. Web 侧仍需特性检测（Firefox same-document View Transitions 落地较晚），
     收益被进一步摊薄。
- 结论：**NOT DELIVERED**，不引入该依赖。探针证据与内核版本对照表已留档。

### R5（Stage 3）修复 `InkWipeTransition` 的一个真实健壮性缺陷（计划外）

- 现象：`src/__tests__/App.transition.test.tsx` 首次整体渲染 `<App />` 时，
  `ErrorBoundary` 捕获到 `TypeError: p.getTotalLength is not a function`，
  整个应用被替换成错误页。
- 根因：`InkWipeTransition` 对 sprig 装饰 SVG 的每条 `path` 直接调用
  `SVGPathElement.getTotalLength()`。该 API 在 jsdom 中未实现（真实浏览器/ArkWeb 有），
  但**effect 内未捕获的异常会直接冒泡到 ErrorBoundary** —— 即"装饰性增强失败"
  会拖垮整个应用。这只在测试暴露，但它是一个真实的脆弱点（任何缺少该 API 的
  WebView/降级环境都会命中）。
- 修复：改为按 `typeof p.getTotalLength === 'function'` 过滤后再度量；量不到长度就
  跳过 dash 预置，由 CSS 的 `stroke-dasharray: var(--sprig-length, 500)` 兜底。
  不改变对外 props。

### R6（Stage 4）`App.routeFocus.test.tsx` 的失败根因是**测试隔离**，不是焦点逻辑

- 现象：T01 通过、T02/T03 失败；在默认 5s test timeout 下表现为 `Test timed out`，
  在放宽超时后暴露真实错误 `Unable to find an element by: [data-testid="hero-cta"]`
  —— 即测试以为在首页，DOM 里其实是**阅读页**。
- 根因：`window.location` 与 `localStorage` 一样是**跨用例共享**的模块级状态。
  T01 的 `setMode('reading')` 经 `useUrlHashSync` 的"currentMode → hash"分支把
  `window.location.hash` 写成 `#/reading`；T02/T03 的 `beforeEach` 只重置了 store 与
  `localStorage`，**没重置 hash**。于是挂载时 `useUrlHashSync` 的"初始深链接"分支
  依据残留 hash 再次 `setMode('reading')`，首页根本没渲染。
- 修复：两个渲染 `<App/>` 的测试文件（`App.routeFocus` / `App.transition`）的
  `beforeEach` 补 `window.history.replaceState(null, '', '/')`。
  **用 `replaceState` 而非 `location.hash = ''`** —— 后者会触发 `hashchange`，又绕回
  store，等于换个方式重现同一个 bug。
- 顺带加固：T02 原断言 `activeElement !== routeContainer()` 在容器恰好被 Suspense
  卸载时会**平凡通过**（`null !== body`），补一条"容器必须已挂载"的前置断言恢复判别力。
- 教训（可复用）：任何把**URL / 持久化存储**当输入源的功能（深链接、hash 路由、
  `restore` 类中间件），都会让"重置 store"这种常规隔离手段失效。新增此类功能时，
  必须在测试 `beforeEach` 里一并重置对应载体。

### R7（Stage 4）`will-change` 逐站点审计结论（P2-3）

- **审计面修正**：SPEC §5 Stage 4 写的"14 文件"快照含 `src/App.css`（Stage 3 已删）。
  删后 CSS 侧 13 个文件，另有 1 处**内联**站点（`useCursorGlow.ts`）原先未计入。
  实际审计面 = **13 个 .css 文件的 19 条规则 + 1 处 TS 内联 = 20 站点 / 14 文件**。
  （`harmony/entry/.preview/…/rawfile/dist/**/*.css` 里也有 `will-change`，但那是 hvigor
  构建产物，不是源。）
- **判据两条**：① 声明的属性必须真的会在该元素上变化（撒谎 = 噪声 + 误导读者）；
  ② 元素数量是否随数据规模增长 —— 永久 `will-change` = 永久合成层，O(N数据) 不可接受。
- **收敛属性列表（9 处）**：`transform, opacity` → `transform`。这些块的 transition
  只列 `transform`，`opacity` 从未变化：
  `ReviewCard .input` / `ReviewCard .submitBtn` / `ReviewPromptBanner .btn` /
  `InkWipeTransition .overlay`（覆层 opacity 恒为 1）/ `ReadingSessionPage .progressFill` /
  `ReviewSessionPage .actionBtn` / `ReviewSessionPage .progressFill` /
  `AnalyticsPanel .chevron` / `ScrollProgressBar .fill`。
- **整条删除（5 处）**：元素数量随数据增长，且动画只是**数据变化时的一次性过渡**：
  `LinkedOccurrenceHighlight .highlight::after`（逐词，一篇 A2 文章可命中数十词）、
  `AnalyticsPanel .accuracyBar,.durationBar`（逐天，≤30 根）、
  `AnalyticsPanel .distributionFill`（逐 FSRS 桶）、
  `LessonCard .progressFill`（逐课）、`ReadingHistoryPanel .progressFill`（逐行）。
  改为依赖浏览器在过渡**真正开始**时的自动提升。
- **判定保留（6 处）**：`animations.css .breathing-effect,[data-breathing]`（无限动画，
  transform+opacity 均真；现状注记：全仓无 JSX 使用点，当前 0 元素）、
  `HeroSection .hero`、`HeroSection .fleuron,.heading,.underline,.dropcap,.cta`（固定 5 个）、
  `HomePage .reveal`（均为入场/滚动揭示，transform+opacity 均真且 O(1)）、
  `HomePage .revealVisible`（reduced-motion 下 `will-change: auto` **显式释放**，这是全仓
  唯一正确的释放分支）、`useCursorGlow.ts` 内联（JS 在 `mousemove`/`mouseleave` 里真实
  改写 transform 与 opacity）。
- **未做的事（如实记录）**：没有为入场类元素引入 `transitionend` → 加 `.settled`
  → `will-change: auto` 的释放管线。因为这些站点是 O(1)（单例 / 固定 5 个），而管线要
  引入额外状态与生命周期管理；收益不抵复杂度。已作为**有意的非目标**留档。
- **收益的诚实边界**：本环境无法读取 compositor 层内存 / 合成耗时，所以
  - 9 处属性收敛是**语义与维护性**收敛 —— 两种写法都会提升同一合成层，**无度量差异**，
    不要把它记成性能优化；
  - 5 处删除的收益是**合成层数量从 O(N数据) 降到 0**，属原理推算而非实测。残余风险 =
    这些元素过渡的**起始帧**可能多一次提升动作；理论不可感知，但应在 S5 的 E2E / 目视
    环节对课程页（逐课进度条）与统计面板（逐天柱）各抽查一次。
- **固化手段**：新增 `src/__tests__/willChangeAudit.test.ts`（5 项），把上面的纪律做成
  机械可验证的断言：
  - T01：从 CSS 里解析每个 `will-change` 站点，取"动画依据"= 自身 + **变体/后代块**的
    `transition`/`animation` 目标 + 被引用 `@keyframes` 实际变化的属性，断言声明 ⊆ 依据。
    （解析器必须处理 ① 注释里也写着 `will-change`，故先剥离注释；②
    `cubic-bezier(0.22, 1, 0.36, 1)` 里的逗号不属于多属性分隔符，故按**括号深度 0** 切
    token；③ `InkWipeTransition .overlay` 的 transition 写在 `.overlay.covering` /
    `.overlay.revealing` 变体里，故必须做变体合并。）
  - T02：5 处删除站点保持无 `will-change`（锁定删除决定）。
  - T03：3 处保留站点仍声明 `transform` + `opacity`（锁定保留决定，防止被顺手清掉）。
  - T04：`HomePage` 的 reduced-motion 释放分支存在。
  - T05：`useCursorGlow` 的两条声明都有真实写入口（`glow.style.transform =` /
    `glow.style.opacity =`），否则"内联声明"就是假的。
- **判别力验证（变异测试）**：把 `will-change: transform, opacity` 加回
  `AnalyticsPanel .accuracyBar,.durationBar`，测试转红 **2 项**（T01 给出属性级定位
  `声明 "opacity" 但在本元素上看不到对应 transition/@keyframes`；T02 报"数据规模站点
  复活"），回滚后 5/5 恢复绿。

### R8（Stage 3 勘误）SPEC 快照中的 `src/App.css` 计数

- 上一条 R7 已述：SPEC §5 Stage 4 的"`will-change` 14 文件"清单是在 `src/App.css`
  尚未删除时统计的（`git show HEAD:src/App.css` 第 129 行确有
  `will-change: transform, opacity`）。Stage 3 删除该文件后，该快照与仓库不再一致。
  本处以 R7 的 20 站点 / 14 文件为准。

### R9（Stage 5）`React.lazy` 首次渲染**必定挂起一次** → 以 `createRouteComponent` 取代

这是 S5 最重要的发现：**SPEC §5 Stage 4 第 3 步"路由预取"的原验收标准
（「预取命中时 `LoadingFallback` 不出现」）在只用 `React.lazy` 时无法达成**，
不是预取没生效，而是 `React.lazy` 的语义决定的。

- **实证过程（我没有改断言去迁就现实）**：
  E2E T17 首轮跑，断言 2（`chunk 请求时刻 ≤ 点击时刻`）**已通过**，断言 3
  （`appearances === 0`）失败。为定位，把探针从布尔升级为
  `<appearances, visibleMs, stillPresent>` 三段计数，拿到决定性数据：

  ```json
  { "appearances": 1, "visibleMs": 54, "stillPresent": false }
  ```

  即 **chunk 确实已在点击前预取完成**（请求时刻早于点击），但 `LoadingFallback`
  仍然出现 **1 次、可见约 54 ms**。
- **根因**：`React.lazy` 在**首次渲染时**才调用工厂函数。即使目标模块已在
  模块注册表里，工厂返回的是一个**崭新的 `import()` promise**（不是已落定的那个），
  于是首次渲染必然 `throw` 该 promise 挂起一次，等 promise 落定后才重试并渲染真实组件。
  该行为与"是否预取"无关 —— 预取只能让这次 `import()` **瞬间**落定（54 ms 而非数百 ms），
  不能消除挂起。
- **可见性判定**：正常动效下这 54 ms 被 `InkWipeTransition` 的墨迹覆盖层遮住，
  用户看不到；但 **`prefers-reduced-motion` 用户没有覆盖层**，会直接看到加载态闪动
  —— 这正是 E2E T18 要覆盖的人群。所以结论是**必须修实现，不能放宽断言**。
- **实现**：新增 `createRouteComponent(loader)`（`src/platform/routePrefetch.ts`）
  替代 `React.lazy`。它把"模块是否已就绪"变成**渲染时可知的事实**：

  | 记录状态 | `React.lazy` | `createRouteComponent` |
  |---|---|---|
  | 已 resolved | 仍挂起一次（首次） | **同步渲染真实组件**，不挂起、不闪 fallback |
  | pending | `throw promise` | `throw promise`（Suspense 语义不变） |
  | rejected | `throw error` | `throw error`（交给 `ErrorBoundary`） |

  `App.tsx` 的 5 条路由由 `lazy(() => import(…))` 改为
  `createRouteComponent(ROUTE_LOADERS.<mode>)`；`SettingsPanel` 保持 `lazy()`
  （不在预取目标内，无收益）。
- **加载记录按 loader 函数身份索引**（`Map<RouteLoader, RouteEntry>`），使
  **预取路径与渲染路径共享同一条记录** —— 这是"预取完成 ⇒ 首渲染同步"能成立的前提。
  两条路径对 `rejected` 的处理**故意不同**，理由在代码注释里：
  - 渲染路径不替换 rejected 记录（否则每次渲染都重发请求 → 无限重试）；
  - 预取路径 `retryRouteEntry` 换一条全新记录（用户**尚未导航**，重试是安全的，
    覆盖"预取时断网 → 网络恢复 → 用户 hover 再次触发"）。
- **单测**（`routePrefetch.test.ts` 新增 T07/T08/T09，全部通过）：
  - T07：`await preloadRoute(loader)` 后渲染 → `queryByTestId('fb') === null`
    且真实内容在文档里。**判别性来源**：若换回 `React.lazy`，这里必然拿到 fallback。
  - T08：未预取 + 手动 settle → 先 fallback 后真实内容（锁定"Suspense 语义未被改坏"）。
  - T09：`loader` 返回 `Promise.reject(boom)` → 本地 `ErrorBoundary` 捕获
    （锁定"失败仍交给 ErrorBoundary，不无限挂起"）。
- **判别力变异验证（实做，非声明）**：把 `createRouteComponent` 的
  `resolved` 快路径去掉（即退回 `React.lazy` 的"永远 throw promise"行为），
  T07 **转红**；恢复后 4 files / 42 tests 全绿。详见下方"验证记录"。
- **顺带的收益与代价**：`createRouteComponent` 让"预取"真正有意义了（不预取则首入
  仍挂起，预取则同步）；代价是 `routePrefetch.ts` 进入口 chunk（见 R11 体积说明）。

### R10（Stage 5 勘误）`versionCode` 线性公式**只覆盖 0.x 线**；1.x 线按「每版 +5」节奏

- SPEC §5 Stage 5 第 2 步给的 `versionCode 1000070` 是**对的**，但
  `scripts/check-version-alignment.mjs` 里固化并写明"与三个历史锚点全部吻合"的公式

  ```
  versionCode = 1000000 + (minor - 3) * 5 + patch
  ```

  **仅对 harmony `major === 0` 成立**，套到 1.x 会给出错误值（`1.6.0` 代入得
  `1000015`，实际是 `1000065`）。脚本对此是有防护的：
  `expectedVersionCode` 在 `major !== 0` 时**返回 `null` 并跳过校验**，
  所以它是"未覆盖即跳过"而不是"算错了没发现"。
- **1.x 线的真实节奏（git 历史实测，逐版验证）**：

  | harmony | versionCode | | harmony | versionCode |
  |---|---|---|---|---|
  | 0.5.0 | 1000010 | | 1.0.0 | 1000035 |
  | 0.6.0 | 1000015 | | 1.1.0 | 1000040 |
  | 0.7.0 | 1000020 | | 1.2.0 | 1000045 |
  | 0.8.0 | 1000025 | | 1.3.0 | 1000050 |
  | 0.9.0 | 1000030 | | 1.4.0 | 1000055 |
  | | | | 1.5.0 | 1000060 |
  | | | | **1.6.0** | **1000065** |

  即**每次版本迭代 +5**（`major` 跨越 0→1 时基准**不重设**，继续线性累加）。
  因此 `1.6.1`（minor 前进 1、patch 归 0 后的下一个迭代）= `1000065 + 5` = **`1000070`**，
  与 SPEC 结论一致。
- **实务结论**：1.x 线的 `versionCode` 目前**没有机器校验**（`check:versions` 输出会
  注明「规则未覆盖 (major≠0), 跳过」）。这不是本次要修的事（改公式须同步改基准常量，
  属版本策略变更，超出 v1.6.1 范围），但**必须在 SPEC 留档**，避免下一个版本有人
  以为"PASS 就等于 versionCode 正确"。已作为 v1.6.2 候选改进项（见 §10）。
- **验证**：`check:versions` 实际输出 `PASS`，`versionCode 1000070 (规则未覆盖 major≠0, 跳过)`。

### R11（Stage 5）§6.1 测试契约的一处真实缺口（已补齐）与一处脚手架清理

**（a）`scripts/measure-bundle.test.mjs` 原**不存在** —— SPEC §6.1 声明了 2 项，执行期清点时
`find . -name "*measure*test*"` 返回空。这不是"少写了个测试"，而是**声明的契约没有落地**。

- 补齐方式（不是补一个恒真断言）：先把 `measure-bundle.mjs` 的纯逻辑抽为**导出函数**
  `extractFirstScreenUrls(html)`（从 `index.html` 抽 entry `<script src>` + `modulepreload`）
  与 `aggregateFirstScreen(items)`（去重 + 过滤 bytes=0 + 求和 + 降序）；
  再把 CLI 副作用（读 dist / gitHead / 写盘 / 打印）收敛到 `invokedDirectly` 守卫内 ——
  这样单测 `import` 该模块时**不会真的去量 `dist/`**，测试因此不依赖构建产物。
- 测试设计避开平凡通过：T01 断言抽取结果**精确等于**期望数组（含 entry 与 preload 顺序、
  且 `.css` / `.svg` 不被误抓）+ 汇总对象的四字段结构与类型；T02 构造 5 条输入
  （含 1 条重复 file、1 条 `bytes=0` 的缺失文件）断言 `chunkCount === 3`、字节和、降序 ——
  退化实现（不去重 / 不过滤 / 不排序）都会失败。
- **重构等价性验证（逐字节）**：重构后重跑脚本，把输出与重构前的 `s5.json` 做
  除 `label` / `measuredAt` 外的**深度相等**比对 → 一致。

**（b）S4 调试期遗留的脚手架文件已删除**：`src/__tests__/probe-focus.test.ts`（3 项）是排查
jsdom 焦点语义时写的探针（测的是 jsdom 本身，不是产品契约），**不属于 §6.1 契约**，已删除。

**（c）测试总量的口径修正（如实记录）**：
§6.3 写的基线是「151 files / 1434 tests」。本版终值 = **158 files / 1465 tests**
（+7 files / +31 tests）。逐笔对齐后**无未解释余数**：

| 来源 | 文件 | 项数 |
|---|---|---|
| `willChangeAudit.test.ts` | 1 | 5 |
| `routePrefetch.test.ts` | 1 | 9 |
| `staticAssets.test.ts` | 1 | 5 |
| `useCursorGlow.guard.test.ts` | 1 | 4 |
| `App.routeFocus.test.tsx` | 1 | 3 |
| `App.transition.test.tsx` | 1 | 3 |
| `measure-bundle.test.mjs` | 1 | 2 |
| **合计** | **+7** | **+31** |

`1434 + 31 = 1465`、`151 + 7 = 158`，与实测一致。
中间一度出现的「+34」是我误把**已删除**的脚手架 `probe-focus.test.ts`（3 项）重复计入所致；
该文件在本版内**创建又删除**，净贡献为 0，故不参与账目。
契约 6 文件中有 2 个是声明量的超集（`routePrefetch` 9 ≥ 3、`staticAssets` 5 ≥ 3），
1 个（`measure-bundle`）为执行期补齐。



