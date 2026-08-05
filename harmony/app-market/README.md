# AppGallery 元服务上架素材 (Stage 8)

> 本目录存放 AppGallery 元服务上架所需的全部素材.
> PNG 二进制文件由沙箱约束无法生成, 用户需在 DevEco Studio / 真机内制作.

## 素材清单

| 文件 | 说明 | 状态 |
|---|---|---|
| `icon_512.png` | 元服务图标 512x512 | 占位 (见下) |
| `screenshots/` | 元服务截图 5+ 张 | 占位 (见 screenshots/README.md) |
| `description_zh_CN.txt` | 中文应用市场描述 | 已就绪 |
| `description_en_US.txt` | 英文应用市场描述 | 已就绪 |
| `privacy_policy_url.txt` | 隐私政策 URL (占位) | 已就绪, 上架前替换 |

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

## 隐私政策 URL

`privacy_policy_url.txt` 当前为占位 `https://wordaydream.example.com/privacy`.
上架前必须替换为真实可访问的隐私政策页面 URL.

## category

AppGallery 元服务分类: `education` (教育)
