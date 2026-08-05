# 元服务截图素材 (Stage 8)

> AppGallery 元服务上架要求 5+ 张截图, 覆盖核心功能场景.
> 沙箱约束无法生成 PNG, 用户需在 DevEco Studio 真机或模拟器内截屏.

## 截图清单

| 文件名 | 场景 | viewport | 备注 |
|---|---|---|---|
| `screenshot_01_home.png` | 首页 | 375x812 | HeroSection + brand + 连续打卡 |
| `screenshot_02_reading.png` | 阅读页 | 375x812 | 长文本 + passage-token 划词 |
| `screenshot_03_review.png` | 复习页 | 375x812 | 卡片翻转 + FSRS 评分按钮 |
| `screenshot_04_widget.png` | 服务卡片 | 2x2 + 2x4 | 桌面卡片显示 due count |
| `screenshot_05_settings.png` | 设置页 | 375x812 | Notifications section 可见 |
| `screenshot_06_achievements.png` | 成就解锁 | 375x812 | 成就列表 + 解锁动画 |

## 规格要求

- 尺寸: 1080 x 1920 px (鸿蒙标准截图分辨率)
- 格式: PNG (无 JPEG 压缩伪影)
- 色彩: sRGB, 不嵌入 ICC profile
- 语言: 截图内 UI 文案应与上架语言一致 (zh-CN 主语言, 提供 en-US / de-DE 各一套)

## 截图方法

### 方法 A: DevEco Studio 模拟器

1. 打开 DevEco Studio, 导入 `harmony/` 工程
2. 运行 `npm run build:harmony` 生成 rawfile/dist
3. 启动模拟器 (HarmonyOS 5.0+ 手机型号)
4. 逐个进入场景页面, 系统截屏快捷键导出 PNG
5. 重命名为上述文件名, 复制到本目录

### 方法 B: 真机截屏

1. 真机连接 DevEco Studio, 安装元服务 debug 包
2. 操作到目标场景, 同时按 电源键 + 音量下键 截屏
3. 通过 hdc 或文件管理器导出 PNG
4. 重命名为上述文件名, 复制到本目录

## 场景准备清单

为获得高质量截图, 截图前应:

- [ ] 首页: 已选课 (English / German), 连续打卡 ≥ 3 天, 成就有解锁项
- [ ] 阅读页: 已生成至少 1 篇 passage, 含 passage-token 高亮, 难度等级显示
- [ ] 复习页: 有 ≥ 5 张待复习卡片, 展示卡片正面 + 评分按钮
- [ ] 服务卡片: 桌面已添加 2x2 + 2x4 卡片, due count > 0
- [ ] 设置页: Notifications section 展开, 通知开关 ON, 时间窗已设置
- [ ] 成就页: 至少 1 个成就解锁, 展示解锁状态 + 进度条

## 多语言版本

如需上架多语言, 建议为每种语言提供一套截图:

- `screenshot_01_home_zh.png` / `screenshot_01_home_en.png` / `screenshot_01_home_de.png`
- (可选, AppGallery 允许复用一套主语言截图)
