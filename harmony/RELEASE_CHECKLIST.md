# Wordaydream 鸿蒙版发布检查清单 (Stage 8)

> **版本**: v0.1.0-harmony Stage 8
> **用途**: v0.1.0-harmony 发布前的完整检查清单, 全部勾选后方可提交 AppGallery.
> **关联**: harmony/app-market/ (素材) / harmony/PERFORMANCE_BASELINE.md (性能) / e2e/harmony_full.spec.ts (E2E).

## 1. Web 端 0 regression 守护

- [ ] `npm run typecheck` — tsc 0 errors
- [ ] `npm run test:run` — vitest 917/917 PASS (Stage 1-7 全部测试)
- [ ] `npm run build` — Web 端构建成功
- [ ] `npm run build:harmony` — 鸿蒙端构建成功 (输出到 harmony/entry/src/main/resources/rawfile/dist/)
- [ ] `npm run lint` — oxlint 0 errors (可选, 建议)

## 2. Harmony 构建

- [ ] `npm run build:harmony` 成功, rawfile/dist/index.html 存在
- [ ] DevEco Studio 导入 `harmony/` 工程 (File → Open → 选 harmony/)
- [ ] 工程无报错 (Sync hvigor + Build → Build HAP)
- [ ] harmony/build-profile.json5 签名配置完整 (debug + release)

## 3. 签名配置

- [ ] debug 证书: DevEco 自动生成 / 用户自备 (harmony/signature/debug.p12 + debug.cer + debug.p7b)
- [ ] release 证书: 用户自备 (harmony/signature/release.p12 + release.cer + release.p7b)
- [ ] storePassword / keyPassword 占位符 `${KEYSTORE_PASSWORD}` 已在 CI/CD 或本地环境变量注入
- [ ] 签名材料未提交到 git (harmony/.gitignore 已排除 /signature/*.p12 等二进制)
- [ ] 在 DevEco Studio 内选择 release product 构建签名包 (build-profile.json5 products.release)

## 4. 真机测试

- [ ] 真机连接 DevEco Studio (hdc 已识别设备)
- [ ] 元服务安装 (debug 包安装到真机)
- [ ] 主流程: 首页 → 选课 → 阅读 → 答题 → 建卡 → 复习 → 评分
- [ ] 服务卡片: 桌面添加 2x2 + 2x4 卡片, due count 显示正确
- [ ] 推送: 词汇到期时收到系统通知, 点击跳转复习页
- [ ] Notifications section: 设置页可见, 通知开关 ON, 时间窗可设置
- [ ] 多语言: zh / en / de 切换正常
- [ ] 主题: light / dark / sepia 切换正常
- [ ] 离线模式: 关闭网络后可继续学习 (已缓存数据)

## 5. 性能基线测试

- [ ] 冷启动时间 < 3000ms (P95) — 见 PERFORMANCE_BASELINE.md §1
- [ ] 热启动时间 < 1000ms (P95) — 见 PERFORMANCE_BASELINE.md §2
- [ ] 内存占用 < 200MB — 见 PERFORMANCE_BASELINE.md §3
- [ ] 服务卡片刷新延迟 < 500ms — 见 PERFORMANCE_BASELINE.md §4
- [ ] ArkWeb 滚动 FPS > 50 — 见 PERFORMANCE_BASELINE.md §5
- [ ] PERFORMANCE_BASELINE.md 真机测试结果已填写

## 6. AppGallery 元服务上架素材

- [ ] `harmony/app-market/icon_512.png` — 512x512 元服务图标 (透明背景 PNG)
- [ ] `harmony/app-market/screenshots/` — 至少 5 张截图 (1080x1920 PNG)
  - [ ] screenshot_01_home.png — 首页
  - [ ] screenshot_02_reading.png — 阅读页
  - [ ] screenshot_03_review.png — 复习页
  - [ ] screenshot_04_widget.png — 服务卡片
  - [ ] screenshot_05_settings.png — 设置页
  - [ ] screenshot_06_achievements.png — 成就 (可选)
- [ ] `harmony/app-market/description_zh_CN.txt` — 中文描述
- [ ] `harmony/app-market/description_en_US.txt` — 英文描述
- [ ] `harmony/app-market/privacy_policy_url.txt` — 隐私政策 URL
- [ ] category: education (AppGallery 元服务分类)

## 7. 隐私政策

- [ ] 隐私政策 URL 已替换占位 `https://wordaydream.example.com/privacy`
- [ ] 隐私政策页面真实可访问 (HTTPS)
- [ ] 隐私政策内容覆盖: 数据存储 (本地 IndexedDB / relationalStore) / API key 持有方 (后端 LLM Proxy) / 不收集个人信息

## 8. LLM Proxy 部署

- [ ] 部署方式已选择 (见 harmony/server/deploy-huaweicloud-functiongraph.md):
  - [ ] 方案 A: 华为云 FunctionGraph (Serverless, 推荐)
  - [ ] 方案 B: 华为云 ECS + APIG (长驻服务)
  - [ ] 方案 C: PM2 本地 / 自建服务器 (开发调试)
- [ ] LLM Proxy 已部署并可通过 HTTPS 访问
- [ ] API key 已配置 (环境变量, 不提交到仓库):
  - [ ] OPENAI_API_KEY (若用 OpenAI)
  - [ ] ANTHROPIC_API_KEY (若用 Anthropic)
  - [ ] DEEPSEEK_API_KEY (若用 DeepSeek)
- [ ] CORS_ALLOWED_ORIGINS 已配置 (允许元服务的 origin)
- [ ] LLM Proxy 健康检查通过 (GET /health 返回 200)

## 9. 环境变量配置

- [ ] `.env.harmony` (或 CI/CD 环境变量) `VITE_LLM_PROXY_URL_HARMONY` 已替换为生产 URL
- [ ] 本地 .env.harmony 未提交到 git (harmony/.gitignore 已排除 .env)
- [ ] .env.harmony.example 作为模板已提交 (harmony/server/.env.example)

## 10. 元服务版本号

- [ ] harmony/app.json5 (或 module.json5) versionName: "0.1.0"
- [ ] harmony/app.json5 versionCode: 1 (或递增)
- [ ] harmony/oh-package.json5 version: "0.1.0"
- [ ] 元服务版本号标识: 0.1.0-harmony (Stage 8 完成版)

## 11. 多语言测试

- [ ] zh-CN: 全部 UI 文案正确 (默认语言)
- [ ] en-US: 全部 UI 文案正确
- [ ] de-DE: 全部 UI 文案正确 (若支持德语课程)
- [ ] 推送通知文案多语言正确 (NotificationService templates: zh / en / de)
- [ ] 截图多语言版本 (可选, AppGallery 允许复用主语言截图)

## 12. 主题测试

- [ ] light: 全部组件可读, 对比度达标
- [ ] dark: 全部组件可读, 对比度达标
- [ ] sepia: 全部组件可读, 对比度达标
- [ ] 主题切换实时生效 (无 reload)
- [ ] 主题持久化跨启动

## 13. E2E 测试 (可选, 真机环境)

- [ ] e2e/harmony_full.spec.ts HF01-HF10 真机执行 (见 RELEASE_CHECKLIST §4)
- [ ] 0 console.error / 0 pageerror (HF02-HF10 全部通过)
- [ ] 性能基线软门控 (HF02 冷启动 < 3s, HF10 热启动 < 1s)

## 发布后

- [ ] AppGallery 元服务审核通过
- [ ] 真机下载安装验证 (从 AppGallery)
- [ ] 监控告警配置 (LLM Proxy 错误率 / 延迟)
- [ ] 用户反馈渠道 (AppGallery 评论区 / 邮箱)
