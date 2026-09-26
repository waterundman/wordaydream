> [!IMPORTANT]
> **本文档的事实基线（版本 / 测试数 / SDK / 桥接契约 / 能力状态 / 验证证据）以 [CURRENT_STATUS.md](./CURRENT_STATUS.md) 为唯一真源；本文件仅保留如何构建、导入 IDE、签名与调试的操作性说明。**
>
> 本文件是早期 Harmony 移植记录（Stage 1 骨架），保留用于追溯。其中的 “Stage 1”、API 12、DevEco 5.0、占位桥接和部分构建/签名说明已经过时。不要依据下方历史阶段表判断当前鸿蒙化进度，也不要把本文件中出现的任何数字当作当前值——需要数字请查 CURRENT_STATUS。

# Wordaydream HarmonyOS NEXT Shell — Stage 1 骨架（历史文档）

> **历史定位**: v0.1.0-harmony Stage 1 的骨架说明，当时按 HarmonyOS NEXT 5.0+ / API 12 + DevEco Studio 5.0 撰写。
> **当前工程已不是这套口径**：现为 HarmonyOS 6.0.2 / API 22、单 `entry` 模块 Stage 模型；SDK / DevEco / Hvigor / ohpm / Node / versionCode 的具体数值只写在 [CURRENT_STATUS.md §2 工程基线](./CURRENT_STATUS.md#2-工程基线)，本文件不复制。
>
> 本目录是 Wordaydream 鸿蒙移动版的壳工程, 内嵌 ArkWeb 加载 Web 端 Vite 构建产物, 通过 JSProxy 桥接鸿蒙原生能力。下文 §4–§7、§11 的构建与调试步骤仍然可用（版本要求以 CURRENT_STATUS 为准）。

---

## 1. 目录结构

```
harmony/
├── build-profile.json5            # DevEco 工程级配置 (signingConfigs / products)
├── oh-package.json5              # 工程依赖声明
├── .gitignore                     # 排除 build/ 与签名材料
├── README.md                      # 本文件
└── entry/                         # 唯一 entry 模块
    ├── build-profile.json5        # 模块级配置
    ├── oh-package.json5            # 模块依赖
    └── src/main/
        ├── module.json5            # type='atomicService' / installationFree=true
        ├── ets/
        │   ├── entryability/
        │   │   └── EntryAbility.ets   # UIAbility: 加载 pages/Index + 注册 JSBridge 占位
        │   └── pages/
        │       └── Index.ets          # @Entry @Component: ArkWeb 加载 $rawfile('dist/index.html')
        └── resources/
            ├── rawfile/                # Vite 构建产物输出目录
            │   ├── .gitkeep
            │   └── dist/                # ← `npm run build:harmony` 输出到此处
            │       ├── index.html
            │       ├── assets/...
            │       └── ...
            └── base/
                ├── element/
                │   ├── string.json     # 字符串资源
                │   └── color.json      # 颜色资源
                ├── media/
                │   └── README.md       # 图标占位说明 (Stage 6 提供 PNG)
                └── profile/
                    ├── main_pages.json  # 页面路由
                    ├── form_config.json # 服务卡片配置占位 (Stage 6 填充)
                    └── share_card.json  # 元服务分享卡片占位 (Stage 5 填充)
```

---

## 2. 环境要求

> 版本口径（DevEco Studio / HarmonyOS SDK / Hvigor / ohpm / DevEco 内置 Node / versionCode）**统一记录在 [CURRENT_STATUS.md §2 工程基线](./CURRENT_STATUS.md#2-工程基线)**，本文件不再维护副本。

操作性补充（与版本无关）：

- **HarmonyOS NDK**: 不强制；工程当前无 C++ 代码。
- **签名材料**: debug 可由 DevEco 自动生成；release 需用户提供（见 §6）。当前仓库 `signingConfigs` 为空，只能产出 unsigned HAP。
- **Web 依赖**: 仓库根目录先 `npm install`，`npm run build:harmony` 与 Web 端共用同一份 node_modules。

---

## 3. SDK 版本说明

当前 `harmony/build-profile.json5` 的两个 products 均已把 `compatibleSdkVersion` / `targetSdkVersion` 提到同一档 HarmonyOS 6.0.2（runtimeOS `HarmonyOS`），**具体字符串以 CURRENT_STATUS §2 为准**。

> 历史（Stage 1）：当时写的是 `5.0.0(12)`，理由是「ArkWeb 支持 Service Worker 的最低要求」。该结论已作废——harmony 构建模式现在**主动禁用 PWA / Service Worker 与 `.br`/`.gz` sidecar**，ArkWeb 走虚拟 HTTPS 同源入口加载 HAP 内 rawfile，不依赖 SW 语义（见 CURRENT_STATUS §3「PWA / Service Worker」行）。

---

## 4. 首次导入 DevEco Studio

> 前置: 仓库根目录已执行过 `npm install`, node_modules 完整.

### 步骤

1. **构建 Web 端产物到 rawfile**:

   ```bash
   # 在仓库根目录执行 (不是 harmony/ 内)
   npm run build:harmony
   ```

   该命令底层为 `vite build --mode harmony`, 会:
   - 以 `mode='harmony'` 触发 `vite.config.ts` 内 harmony 分支
   - 输出到 `harmony/entry/src/main/resources/rawfile/dist/`
   - `base: './'` 保证 ArkWeb rawfile 协议下资源路径解析正确
   - 跳过 PWA 插件 (rawfile 上下文不支持 SW 注册)

2. **打开 DevEco Studio**（版本要求见 CURRENT_STATUS §2）→ `File > Open` → 选择 `harmony/` 目录.

3. **等待 hvigor 同步**: DevEco 会自动解析 `oh-package.json5` 与 `build-profile.json5`,
   下载 `@ohos/hypium` 等依赖. 首次同步可能耗时 2–5 分钟.

4. **检查 SDK 配置**: `File > Project Structure > Project > SDK Manager` 确认
   工程所需的 HarmonyOS SDK 已安装（版本口径见 CURRENT_STATUS §2）.

5. **检查签名配置**:
   `File > Project Structure > Project > Signing Configs`. 仓库默认 `signingConfigs` 为空,
   只能产出 unsigned HAP; 本地调试选择 `Automatically generate signing` 让 DevEco
   生成临时签名材料 (材料不入库, 见 §6).

6. **运行**:
   - 选择 `entry` 模块运行配置 → 选真机或 HarmonyOS 模拟器 (Phone / 与工程一致的系统版本)
   - 点 `Run` 或 `Shift+F10`

### 预期行为

- 设备/模拟器启动后, 应用全屏展示 ArkWeb, 内嵌显示 Web 端首页
- Web 端的所有交互 (路由切换 / IndexedDB / Zustand 持久化) 应正常工作
- 原生桥 `window.harmonyBridge` 已注入**真实实现**（占位类早已不存在）；方法清单见 §8.2 指向的注册表真源
- 原生加载层只在 React 提交可见内容并回 content-ready ACK 后撤下；hilog 关键行依次为 `loadContent success` → `Page begin` → `Web launch handler ready: generation=N` → `Web content ready`

---

## 5. 构建步骤

### 5.1 Web 端产物 (Vite)

```bash
# 在仓库根目录
npm run build:harmony
```

**输出位置**: `harmony/entry/src/main/resources/rawfile/dist/`

输出包含:

```
dist/
├── index.html
├── assets/                 # 标准 ESM 分包 + CSS 分包 + module Worker
├── icons/ , icons.svg , favicon.svg
├── harmony-chunk-graph.json # 打包器导出的依赖图，供 verify-harmony-build 消费
└── (无 sw.js / manifest.webmanifest / *.br / *.gz - harmony 模式禁用 PWA 与压缩 sidecar)
```

产物文件数、JS/CSS 计数等**当轮数字只在 [CURRENT_STATUS.md §5](./CURRENT_STATUS.md#5-当前验证证据) 记录**，本文件不复制。

**重要**: 每次修改 `src/` 下的 Web 端代码后, 必须重新执行 `npm run build:harmony`,
否则 DevEco 内运行的 HAP 仍使用旧版产物. DevEco 不会自动监听 rawfile 变化.

### 5.2 HAP/APP 包 (DevEco Studio)

1. 在 DevEco 内点 `Build > Build HAP(s)/APP(s) > Build HAP(s)`.
2. 等待 hvigor 编译, 产物位于 `harmony/entry/build/default/outputs/default/`:
   - 未配置签名（当前仓库状态）: `entry-default-unsigned.hap`
   - 配置签名后: `entry-default-signed.hap`（需 release 签名, 见 §6）
3. 推荐用仓库根的一等入口，而不是裸 `hvigorw`:

   ```bash
   npm run build:harmony:hap   # = build:harmony + scripts/assemble-harmony-hap.mjs
   ```

   包装器固定使用 DevEco 内置 Node/JBR/SDK 并扫描 Hvigor 日志，避免“日志显示失败但退出码为 0”被误判为成功；工具路径可用 `DEVECO_STUDIO_HOME` 覆盖，缺失即 fail-fast。

### 5.3 一键流水 (Web + Harmony)

已落地：`npm run build:harmony`（Web 产物 + `verify-harmony-build`）→ `npm run build:harmony:hap`（HAP 打包）。
纯 Node 的 CI 门禁用 `npm run verify:harmony-build` 与 `npm run test:harmony-scripts`；运行验证 `npm run verify:harmony-runtime` / 性能采集 `npm run collect:harmony-perf` 在无 hdc、无模拟器时输出 `skipped:true` 且退出码 0，不会红 CI。

---

## 6. 签名配置

> **当前事实**：`harmony/build-profile.json5` 的 `signingConfigs` 是**空数组**，products 的 `signingConfig` 为空串，因此本仓库目前只能产出 unsigned HAP（口径见 [CURRENT_STATUS.md §2](./CURRENT_STATUS.md#2-工程基线)）。下文是**尚未落地**的 Stage 1 设计稿，保留作为接入签名时的操作指引。

配置签名后 `signingConfigs` 中 `release` 条目的目标形态：

```json5
{
  "name": "release",
  "type": "HarmonyOS",
  "material": {
    "certpath": "./signature/release.cer",
    "storePassword": "${KEYSTORE_PASSWORD}",
    "keyAlias": "release",
    "keyPassword": "${KEYSTORE_PASSWORD}",
    "profile": "./signature/release.p7b",
    "signAlg": "SHA256withECDSA",
    "storeFile": "./signature/release.p12"
  }
}
```

### 6.1 Debug 签名

DevEco Studio 默认在首次 `Run` 时自动生成 debug 签名 (自动管理材料).
若需手动指定, 把 `.p12` / `.cer` / `.p7b` 放到 `harmony/signature/` 目录下,
命名为 `debug.p12` / `debug.cer` / `debug.p7b`, 然后在 `File > Project Structure`
里把 `debug` 配置切换为 `Manual`.

### 6.2 Release 签名

发布包必须使用开发者自有 release 签名. 流程:

1. 在 [HarmonyOS 开发者联盟](https://developer.huawei.com/) 注册企业/个人账号.
2. 在 `AppGallery Connect` 创建应用, 申请证书 (`.cer`) + Profile (`.p7b`).
3. 用 `keytool` 生成 keystore:
   ```bash
   keytool -genkeypair -alias release -keyalg EC -keysize 256 \
     -validity 3650 -keystore release.p12 -storetype PKCS12
   ```
4. 把 `release.p12` / `release.cer` / `release.p7b` 放到 `harmony/signature/` 下.
5. 通过环境变量提供密码 (不要写入仓库):
   ```bash
   export KEYSTORE_PASSWORD="your-keystore-password"
   ```
6. 在 DevEco `File > Project Structure > Signing Configs > release` 选择 `Manual`,
   把 `storePassword` / `keyPassword` 改为读取环境变量, 或直接填入 (但禁止提交).

> **重要**: `harmony/.gitignore` 已排除 `signature/` 下的所有 `.p12` / `.p7b` / `.cer`,
> 防止误提交凭证. 任何情况下都不要把这些材料 commit 到 git.

---

## 7. 真机 / 模拟器调试

### 7.1 真机

1. 手机开启 `设置 > 关于本机 > 连续点击 HarmonyOS 版本 7 次` 进入开发者模式.
2. `设置 > 系统与更新 > 开发者选项` 打开:
   - USB 调试
   - 仅充电模式下允许 ADB 调试 (如适用)
3. USB 连接电脑, DevEco 设备列表选中真机 → Run.
4. 若提示 `Device unauthorized`, 在手机弹窗同意.

### 7.2 模拟器

DevEco Studio 内置 HarmonyOS 模拟器:
`Tools > Device Manager > Create Device > Phone`（系统版本须与工程一致，口径见 CURRENT_STATUS §2）。

模拟器在线时可直接跑运行验证与性能采集（入口见 [CURRENT_STATUS.md §6](./CURRENT_STATUS.md#6-可复现工作流)）：
`npm run verify:harmony-runtime` / `npm run collect:harmony-perf`。

注意模拟器无法证明:
- 振动 (`triggerHapticFeedback` 调用无真实触觉反馈)
- 通知与 `reminderAgent` 定时提醒（后者还需开放能力权益与签名 Profile，无权益期间代码保持安全跳过）
- 真机指纹 / 摄像头等硬件

### 7.3 DevTools 调试 Web 层

ArkWeb 支持 Chrome DevTools 协议:
1. 运行中的应用 → DevEco 控制台点 `Debug` 图标
2. 或在终端执行 `hdc shell aa dump -h` 找到 pid, 然后 `hdc shell netstat -an | grep 5678`
3. 在桌面 Chrome 打开 `chrome://inspect/#devices`, 通过 `Configure` 添加设备的 `localhost:5678`

> 在 rawfile 模式下, DevTools 可以 inspect DOM / Network / Sources / Console / Application (除 SW).

---

## 8. 与 Web 端代码同步流程

### 8.1 单向同步 (Web → Harmony)

Stage 1 是单向: Web 端源码 → `npm run build:harmony` → 鸿蒙 rawfile dist. 鸿蒙侧不修改 Web 端代码.

典型工作流:

```
1. 修改 src/ 下任意 Web 端源码
2. (本地验证) npm run dev / npm run test / npm run typecheck
3. 同步到鸿蒙: npm run build:harmony
4. 切换到 DevEco → Run / Debug
```

### 8.2 JSBridge 接口契约

Web 端通过 `window.harmonyBridge` 调用鸿蒙原生能力. **方法清单与同步/异步分组以 `harmony/entry/src/main/ets/bridge/BridgeMethodRegistry.ets` 为唯一真源**（当前为同步 4 项 / 异步 16 项，逐项方法与边界见 [CURRENT_STATUS.md §3 能力矩阵](./CURRENT_STATUS.md#3-能力矩阵)），本文件不再维护副本；两侧有双向集合断言测试防止漂移。

契约要点（详见 CURRENT_STATUS §3/§4）：

- API 22 的 async JSProxy **不支持对象/数组回执**，异步方法的复杂返回值一律以 JSON 字符串回传，Web 侧自行 `JSON.parse`。
- 卡片恢复以原生 `runJavaScript` 推送通道为准，`getAllCards` 拉取仅作兜底。

Web 端调用前仍应做存在性判断（纯 Web 环境下桥不存在）：

```typescript
const bridge = window.harmonyBridge;
if (bridge?.getDueCardsCount) {
  // ...
}
```

---

## 9. ArkTS 适配规则

工程内所有 `.ets` 文件遵守以下规则:

- ❌ 不使用 `any`
- ❌ 不使用对象字面量类型 (`{ foo: string }` 必须定义为 `interface` / `class`)
- ❌ 不使用 `var` (用 `let` / `const`)
- ❌ 不使用 `in` 操作符做类型断言
- ✅ 类成员必须显式声明类型
- ✅ import 使用标准 ES module 语法

Stage 1 已通过的检查项见仓库根 `docs/audit-report-v0.1.0-harmony.md`.

---

## 10. 与 Stage 进度的对应关系（历史，已作废）

上表中的 Stage 1–6 是 v0.1.0-harmony 时代的排期口径，**不代表当前进度**，也不再更新。当前能力状态、验证层级与下一轮优先级统一记录在
[CURRENT_STATUS.md](./CURRENT_STATUS.md)（§3 能力矩阵 / §5 当前验证证据 / §7 下一轮优先级）；本文其余部分只保留操作步骤。

---

## 11. 常见问题排查

### Q1: DevEco 报错 `Module not found: @kit.ArkWeb`

A: HarmonyOS SDK 未安装 ArkWeb 模块. 打开 `File > Settings > SDK Manager`,
勾选工程所用 HarmonyOS 版本（见 CURRENT_STATUS §2）下的 `ArkWeb` 组件并安装.

### Q2: 运行后白屏

A: 几乎都是 rawfile 路径 / 同源入口问题:

1. 确认 `harmony/entry/src/main/resources/rawfile/dist/index.html` 存在
2. `vite.config.ts` 中 `base: './'` (rawfile 协议必须 relative path)
3. DevEco 控制台 `hilog` 看 EntryAbility 是否 `loadContent success`
4. ArkWeb DevTools 看 Console 是否有 404

> 当前工程已不走 `resource://`（该 opaque origin 曾导致白屏），而是虚拟 HTTPS 同源入口
> `https://app.wordaydream.invalid/index.html`；口径见 [CURRENT_STATUS.md §3 ArkWeb 容器行](./CURRENT_STATUS.md#3-能力矩阵)。

### Q3: `npm run build:harmony` 失败

A: 常见原因:

- node_modules 缺失 → 先 `npm install`
- vite.config.ts 语法错误 → 先 `npm run typecheck`
- harmony/ 目录无写权限 → 检查目录权限

### Q4: HAP 包过大

A: 当前 HAP 体积以 [CURRENT_STATUS.md §5](./CURRENT_STATUS.md#5-当前验证证据) 记录的实测字节数为准，本文件不复制该数字。
若体积异常偏大，检查是否误把 `node_modules` / 未优化的 `public/assets/img/*.jpg` 打入 rawfile；
rawfile 条目不压缩，且 harmony 模式不产出 `.br` / `.gz` sidecar，所以词表类 JSON 会以原始体积计入。

### Q5: 签名材料被提交到 git

A: 立即吊销证书并重新生成. `harmony/.gitignore` 已排除 `signature/` 下所有二进制材料.
若仍误提交, 执行:

```bash
git rm --cached harmony/signature/*.p12 harmony/signature/*.p7b harmony/signature/*.cer
```

---

## 12. 参考

- HarmonyOS NEXT 官方文档: https://developer.huawei.com/consumer/cn/doc/harmonyos-guides
- ArkWeb 组件参考: https://developer.huawei.com/consumer/cn/doc/harmonyos-references
- DevEco Studio 下载: https://developer.huawei.com/consumer/cn/deveco-studio/
- 项目根 SPEC: `docs/spec-v0.1.0-harmony/main.md` (本仓库)
- v2.2.4 经验反思: `docs/audit-report-v0.1.0-harmony.md` (本仓库)
