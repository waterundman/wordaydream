# AppGallery 元服务上架素材 (Stage 8)

> **本文档的事实基线（版本 / 测试数 / SDK / 能力状态）以 [CURRENT_STATUS.md](../CURRENT_STATUS.md) 为唯一真源；本文件仅保留「上架素材清单与其真实就绪度」这一职责。**

> 本目录存放 AppGallery 元服务上架所需的全部素材.
> **注意**：早期写下的「PNG 无法生成、目录内只有说明」口径已过期——素材文件确实存在，但**当前全部不合格**（见下表实测校验结果），上架前必须重做。

## 素材清单

| 文件 | 说明 | 状态 |
|---|---|---|
| `icon_512.png` | 元服务图标 512x512 | **不合格**：实测为 1832x1832、`.png` 扩展名但内容实为 JPEG（JFIF）流、不透明背景；且与 6 张「截图」字节完全相同（md5 `19a0b822…`） |
| `screenshots/` | 元服务截图 5+ 张 | **不合格**：6 个 `*_mockup.png` 都是上面同一张图的副本，非场景截图，需真机/模拟器实拍替换 |
| `description_zh_CN.txt` | 中文应用市场描述 | 已就绪 |
| `description_en_US.txt` | 英文应用市场描述 | 已就绪 |
| `privacy_policy_url.txt` | 隐私政策 URL (占位) | 已就绪, 上架前替换 |
| `generate-images.ps1` | 早期素材生成脚本 | 保留作历史，产物即上述不合格副本 |

> 上述尺寸为只读实测（文件头 + md5）结论，不随版本变化，故本文件保留；版本号 / 能力状态等一律查 CURRENT_STATUS。

## icon_512.png 制作说明

- 规格: 512 x 512 px
- 用途: AppGallery 元服务图标
- 格式: PNG, 透明背景
- 颜色模式: sRGB
- 内容: Wordaydream 品牌 logo (建议沿用 Web 端 favicon / PWA icon 风格, 保持品牌一致性)
- 圆角: 不需要 (系统自动裁圆角, 提交方形原图)

### 生成方式 (任选其一)

1. **DevEco Studio Icon Generator** (推荐)
   - 打开 DevEco Studio → 右键 `entry` 模块 → New → Image Asset
   - 选择 Icon Type: `App Icon`
   - 配置 512x512 前景 + 背景, 导出后复制到 `harmony/app-market/icon_512.png`

2. **设计师制作**
   - 提供设计稿 (512x512, PNG, 透明背景), 直接放入本目录
   - 注意: 前景内容应在安全区内 (建议中心 384x384, 留 64px padding 防裁剪)

3. **从 Web 端 PWA icon 复用** (临时方案)
   - Web 端 `public/pwa-512x512.png` (若存在) 可作为基础
   - 但鸿蒙端要求透明背景 + 元服务特定样式, 建议重新设计

## 截图素材

见 `screenshots/README.md`. 至少 5 张, 覆盖首页 / 阅读 / 复习 / 卡片 / 设置.
当前目录内的 `*_mockup.png` 全为同一张图的设计稿副本，仅作构图参考，**不可用于上架**。

## 隐私政策 URL

`privacy_policy_url.txt` 当前为占位 `https://wordaydream.example.com/privacy`.
上架前必须替换为真实可访问的隐私政策页面 URL.

## category

AppGallery 元服务分类: `education` (教育)
