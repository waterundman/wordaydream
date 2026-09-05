> [!IMPORTANT]
> 本文件是早期 Harmony 移植记录，保留用于追溯。其中的 “Stage 1”、API 12、DevEco 5.0、占位桥接和部分构建/签名说明已经过时。请以 [CURRENT_STATUS.md](./CURRENT_STATUS.md) 作为当前 HarmonyOS 6.0.2 / API 22 架构、能力边界、验证证据和后续工作的权威说明。
>
> 不要依据下方历史阶段表判断当前鸿蒙化进度。

# Wordaydream HarmonyOS NEXT Shell — Stage 1 骨架（历史文档）

> **版本**: v0.1.0-harmony Stage 1
> **架构**: 方案 B (Web 容器 + 原生能力) — ArkWeb 加载 Vite 构建产物, 通过 JSBridge 桥接鸿蒙原生能力
> **目标平台**: HarmonyOS NEXT (5.0+) / API 12+
> **DevEco Studio**: 5.0+

本目录是 Wordaydream 鸿蒙移动版的壳工程, 通过 DevEco Studio 5.0+ 构建为 HAP/APP 包, 内嵌 ArkWeb 加载 Web 端 Vite 构建产物. 本文件给出从 0 到打包的完整步骤.

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

| 工具 | 最低版本 | 备注 |
|---|---|---|
| **DevEco Studio** | 5.0+ | 推荐 5.0.5+ (含 hvigor 5.0) |
| **HarmonyOS SDK** | 5.0+ (API 12) | 通过 DevEco Studio SDK Manager 安装 |
| **HarmonyOS NDK** | 不强制 (Stage 1 无 C++ 代码) | Stage 4+ 若需 ts-fsrs 原生加速再装 |
| **Node.js** | 20+ | 与 Web 端共用, 跑 `npm run build:harmony` |
| **签名材料** | debug 可由 DevEco 自动生成 | release 需用户提供 (见 §6) |

---

## 3. SDK 版本说明

`harmony/build-profile.json5` 中:

```json5
"products": [
  {
    "name": "default",
    "signingConfig": "debug",
    "compatibleSdkVersion": "5.0.0(12)",
    "runtimeOS": "HarmonyOS"
  }
]
```

- `compatibleSdkVersion: "5.0.0(12)"` 表示最低运行版本为 **HarmonyOS 5.0 / API 12**.
- 此版本是 ArkWeb 支持 Service Worker 的最低要求 (Cann8.0+ 内核).
- 若目标设备低于此版本, ArkWeb 将无法加载 PWA 离线缓存, 但基础 Web 容器功能仍可用.

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

2. **打开 DevEco Studio 5.0+** → `File > Open` → 选择 `harmony/` 目录.

3. **等待 hvigor 同步**: DevEco 会自动解析 `oh-package.json5` 与 `build-profile.json5`,
   下载 `@ohos/hypium` 等依赖. 首次同步可能耗时 2–5 分钟.

4. **检查 SDK 配置**: `File > Project Structure > Project > SDK Manager` 确认
   HarmonyOS SDK 5.0+ (API 12) 已安装.

5. **检查签名配置** (默认 debug):
   `File > Project Structure > Project > Signing Configs` 看到 `debug` 条目.
   若 DevEco 提示"材料缺失", 选择 `Automatically generate signing` 让 DevEco
   为本地调试自动生成临时签名材料.

6. **运行**:
   - 选择 `entry` 模块运行配置 → 选真机或 HarmonyOS 模拟器 (建议 Phone / API 12+)
   - 点 `Run` 或 `Shift+F10`

### 预期行为

- 设备/模拟器启动后, 应用全屏展示 ArkWeb, 内嵌显示 Web 端首页
- Web 端的所有交互 (路由切换 / IndexedDB / Zustand 持久化) 应正常工作
- JSBridge (`window.harmonyBridge`) 已注入但方法为空实现 (Stage 3 替换)
- 控制台日志可看到 `EntryAbility: loadContent success` 和 `registerHarmonyBridge deferred` 警告

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
├── assets/
│   ├── index-[hash].js
│   ├── index-[hash].css
│   └── ...
└── (无 sw.js / manifest.webmanifest - harmony 模式禁用 PWA)
```

**重要**: 每次修改 `src/` 下的 Web 端代码后, 必须重新执行 `npm run build:harmony`,
否则 DevEco 内运行的 HAP 仍使用旧版产物. DevEco 不会自动监听 rawfile 变化.

### 5.2 HAP/APP 包 (DevEco Studio)

1. 在 DevEco 内点 `Build > Build HAP(s)/APP(s) > Build HAP(s)`.
2. 等待 hvigor 编译, 产物位于:
   - debug: `harmony/entry/build/default/outputs/default/entry-default-signed.hap`
   - release: 同上, 但需 release 签名 (见 §6)
3. 也可通过命令行:
   ```bash
   cd harmony
   hvigorw assembleHap --mode module -p product=default -p buildMode=debug --no-daemon
   ```

### 5.3 一键流水 (Web + Harmony)

后续 (Stage 2+) 可在仓库根 `package.json` 增加:

```json
"build:harmony:all": "npm run build:harmony && cd harmony && hvigorw assembleHap"
```

Stage 1 暂未引入, 避免在没装 DevEco CLI 的 CI 上报错.

---

## 6. 签名配置

`harmony/build-profile.json5` 中 `signingConfigs` 数组预置了 `debug` 与 `release` 两个占位条目:

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

DevEco Studio 5.0+ 默认在首次 `Run` 时自动生成 debug 签名 (自动管理材料).
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

DevEco Studio 5.0+ 内置 HarmonyOS 模拟器:
`Tools > Device Manager > Create Device > Phone` (建议 API 12).

注意模拟器无法测试:
- 振动 (`triggerHapticFeedback` 调用无效)
- 通知提醒 (`registerReminder` 调用失败)
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

Web 端通过 `window.harmonyBridge` 调用鸿蒙原生能力. **接口契约** (Stage 1 占位, Stage 3 实现):

| 方法 | 签名 | Stage |
|---|---|---|
| `getDueCardsCount()` | `() => number` | 3 |
| `registerReminder(payload)` | `(payload: string) => void` | 3 |
| `readPreferences(key)` | `(key: string) => string` | 3 |
| `writePreferences(payload)` | `(payload: string) => void` | 3 |
| `triggerHapticFeedback()` | `() => void` | 3 |

Web 端使用前需做存在性判断:

```typescript
const bridge = (window as any).harmonyBridge;
if (bridge?.getDueCardsCount) {
  const count = bridge.getDueCardsCount();
}
```

Stage 1 阶段调用上述方法返回的都是占位值 (`0` / `'{}'` / `undefined`), Stage 3 会替换为真实实现.

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

## 10. 与 Stage 进度的对应关系

| Stage | 涉及本目录的改动 |
|---|---|
| **Stage 1** (本期) | 创建工程骨架, 配置 build:harmony 脚本, JSBridge 占位 |
| Stage 2 | 离线模式适配 (评估 ArkWeb SW 支持路径) |
| Stage 3 | 实现 `HarmonyBridge` class, 替换 `HarmonyBridgePlaceholder`, 接入 EntryAbility 真实 controller |
| Stage 4 | ts-fsrs 原生加速 (可选 NDK) |
| Stage 5 | 元服务分享卡片 (`share_card.json` 填充) |
| Stage 6 | 服务卡片 (`form_config.json` 填充) + 应用图标 PNG |

---

## 11. 常见问题排查

### Q1: DevEco 报错 `Module not found: @kit.ArkWeb`

A: HarmonyOS SDK 未安装 ArkWeb 模块. 打开 `File > Settings > SDK Manager`,
勾选 `HarmonyOS 5.0` 下的 `ArkWeb` 组件并安装.

### Q2: 运行后白屏

A: 几乎都是 rawfile 路径错误:

1. 确认 `harmony/entry/src/main/resources/rawfile/dist/index.html` 存在
2. `vite.config.ts` 中 `base: './'` (rawfile 协议必须 relative path)
3. DevEco 控制台 `hilog` 看 EntryAbility 是否 `loadContent success`
4. ArkWeb DevTools 看 Console 是否有 404

### Q3: `npm run build:harmony` 失败

A: 常见原因:

- node_modules 缺失 → 先 `npm install`
- vite.config.ts 语法错误 → 先 `npm run typecheck`
- harmony/ 目录无写权限 → 检查目录权限

### Q4: HAP 包过大

A: Web 端 dist 通常 1-3 MB, 加上 ArkWeb 运行时和系统资源, HAP 包约 5-10 MB.
若异常偏大 (>50 MB), 检查是否误把 `node_modules` / `public/assets/img/*.jpg` 打入 rawfile.

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
