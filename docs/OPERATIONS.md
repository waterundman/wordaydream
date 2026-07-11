# Wordaydream v1.5.1 运维手册 (OPERATIONS.md)

> **版本**: v1.5.1 (Stage 1 — 4 沙箱阻塞点 runbook)
> **日期**: 2026-07-10
> **承接**: v1.5.0 已就绪配置层 (netlify.toml + .github/workflows/netlify-deploy.yml + lighthouse.config.js + e2e/offline-install.spec.ts)
> **目标**: 4 阻塞点 (Netlify 部署 + 3 API key + Lighthouse + Playwright) 全部 runbook 化, 用户可手动执行真实跑分
> **0 emoji**: 硬约束
> **0 breaking change**: 不动 v1.5.0 已就绪的配置层, 只补 runbook + 强化

---

## 目录

- [1. 真实 Netlify 部署 (8 步骤)](#1-真实-netlify-部署-8-步骤)
- [2. 3 API key 真实配置 (15 步骤)](#2-3-api-key-真实配置-15-步骤)
- [3. Lighthouse 5 项真实跑分 (5 步骤)](#3-lighthouse-5-项真实跑分-5-步骤)
- [4. Playwright 4 场景真实 E2E (6 步骤)](#4-playwright-4-场景真实-e2e-6-步骤)
- [5. 验收清单 (Contract 23 + 24)](#5-验收清单-contract-23--24)
- [6. 故障排查 FAQ](#6-故障排查-faq)
- [7. 参考链接](#7-参考链接)

---

## 1. 真实 Netlify 部署 (8 步骤)

> 沙箱无 netlify CLI + 无 3 API key, 配置层 100% 写完, 真实部署由用户手动执行.

### 1.1 注册 Netlify 账号 + 连接 GitHub

1. 打开 https://app.netlify.com/signup
2. 选择 "Sign up with GitHub" 按钮
3. 在 GitHub 授权页面确认授权 Netlify 访问你的 GitHub 账号
4. 验证邮箱 (Netlify 会发一封确认邮件)
5. 进入 Netlify dashboard: https://app.netlify.com/

> **注意**: 推荐使用 GitHub 账号直接登录, 后续可一键 import 仓库, 无需额外 PAT.

### 1.2 创建 Site (Import from Git)

1. 在 Netlify dashboard 点击 "Add new site" -> "Import an existing project"
2. 选择 "Deploy with GitHub"
3. 在仓库列表中找到 `wordaydream` (或你 fork 后的仓库名), 点击选中
4. 配置基本信息:
   - **Owner**: 你的 GitHub 账号或 org
   - **Branch to deploy**: `main` (默认)
   - **Base directory**: 留空 (项目根目录就是构建目录)
   - **Build command**: `npm run build` (v1.5.0 netlify.toml 已声明, 留空也行)
   - **Publish directory**: `dist` (v1.5.0 netlify.toml 已声明, 留空也行)
5. 点击 "Deploy site" 按钮
6. 等待首次部署完成 (首次约 1-3 分钟, 之后增量约 30s-1min)

> **注意**: 不要勾选 "Deploy with GitHub Actions" 复选框, Netlify 自身的 GitHub integration 更稳定. 我们额外用 `.github/workflows/netlify-deploy.yml` 做 CI 验证 (非 deploy).

### 1.3 配置环境变量 (NODE_VERSION + 6 VITE 字段 + 3 API key)

1. 进入 Netlify Site dashboard -> Site configuration -> Environment variables
2. 点击 "Add a variable" -> "Add environment variables" (批量)
3. 一次性粘贴以下 10 个变量 (key=value 格式, 换行分隔):

```
NODE_VERSION=20
VITE_LLM_PROVIDER=openai
VITE_LLM_API_KEY=
VITE_LLM_PROXY_URL=https://your-site-name.netlify.app/.netlify/edge-functions/llm-proxy
VITE_LLM_GRAYSCALE=100
VITE_OFFLINE_FALLBACK=true
VITE_APP_VERSION=1.5.1
```

4. API key (3 个, 留空也行, 阻塞点 2 单独处理):

```
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
DEEPSEEK_API_KEY=
```

5. 在 "Deploy contexts" 下拉框中, 对所有 3 个 API key 变量选择 "All scopes" (生产 + 预览 + branch deploy 全部可见)
6. 对 6 VITE 字段变量选择 "Same value for all deploy contexts" 或分别配置 staging/production 不同值
7. 点击 "Save" 保存

> **重要**: VITE_* 前缀的变量在 build 时会被注入到 client bundle. OPENAI_API_KEY 等无前缀的只在服务端 (Edge Function) 可见, 不会泄漏到客户端.

### 1.4 触发首次部署

方式 A (推荐): Netlify 自动触发

- 完成 1.3 后, Netlify 会自动触发首次部署, 在 Deploys 页面查看进度.

方式 B: GitHub Actions 触发

```bash
cd /path/to/wordaydream
git checkout main
git commit --allow-empty -m "chore: trigger first netlify deploy"
git push origin main
```

- 推送后, .github/workflows/netlify-deploy.yml 的 `ci` job 会先跑 (lint + test + build)
- ci 通过后, `deploy` job (仅 main branch) 跑, 调用 `nwtgck/actions-netlify@v3.0` 部署到 Netlify

### 1.5 验证部署

1. 部署完成后, Netlify 会分配一个 `*.netlify.app` 域名 (例如 `wordaydream-xyz123.netlify.app`)
2. 在浏览器访问该域名, 确认:
   - 主页正常加载 (Hero 标题 + TodayCard + ProgressRing + StreakBadge + AchievementWall)
   - 浏览器 Console 无红色 error (允许 warning)
   - Settings 面板打开正常, LLM Provider 选项完整
3. 验证 PWA 资源:
   ```bash
   curl -I https://your-site-name.netlify.app/manifest.webmanifest
   # 期望: HTTP 200, Content-Type: application/manifest+json
   curl -I https://your-site-name.netlify.app/sw.js
   # 期望: HTTP 200, Content-Type: application/javascript, Cache-Control: public, max-age=0, must-revalidate
   ```
4. 验证 PWA install 能力:
   - 打开 Chrome DevTools -> Application -> Manifest
   - 检查: Name / Short name / Start URL / Display (standalone) / Theme color / 3 Icons 全部存在
   - 打开 Lighthouse DevTools -> 跑 PWA 评级, 期望 >= 90

### 1.6 配置自定义域名 (可选)

> 推荐: 如果你有自己的域名 (例如 wordaydream.com), 配置自定义域名更专业.

1. 在 Netlify Site dashboard -> Domain settings -> Custom domains
2. 点击 "Add a domain alias", 输入你的域名 (例如 `wordaydream.com` + `www.wordaydream.com`)
3. Netlify 会提示配置 DNS:
   - **方式 A (推荐)**: 在域名注册商 (例如 Cloudflare / Namecheap) 将 NS 记录改为 Netlify 的 nameservers
   - **方式 B (保留原 DNS)**: 在域名注册商添加 CNAME 记录:
     - `www.wordaydream.com` -> `your-site-name.netlify.app`
     - 根域 (apex) 用 ALIAS / ANAME 记录 -> `your-site-name.netlify.app` (或 Netlify load balancer IP)
4. DNS 生效后 (通常 5-30 分钟), Netlify 自动签发 Let's Encrypt HTTPS 证书
5. 在 Netlify -> HTTPS 页面确认 "Your site has HTTPS enabled" 显示绿色
6. 启用 "Force HTTPS" 重定向 (HTTP -> HTTPS)

### 1.7 验证 Edge Function (LLM Proxy)

```bash
# Test 端点 (注意: test 端点需要先配置 OPENAI_API_KEY 才能返回非 500 响应)
curl -X POST https://your-site-name.netlify.app/.netlify/edge-functions/llm-proxy \
  -H "Content-Type: application/json" \
  -d '{"provider":"openai","prompt":"Reply with: OK","maxTokens":10}'
```

期望响应 (HTTP 200):
```json
{
  "text": "OK",
  "model": "gpt-4o-mini",
  "usage": { "inputTokens": 12, "outputTokens": 3 },
  "language": "en"
}
```

如果 API key 未配置, 期望响应 (HTTP 500):
```json
{
  "error": "API key not configured",
  "code": "MISSING_API_KEY"
}
```

> **说明**: 这条命令 v1.5.1 仅作为连通性验证, 不带 `?action=test`. 真实流式端点见 1.8.

### 1.8 验证 SSE 流式 (Streaming)

> 浏览器 DevTools Network 面板直接验证最直观.

1. 打开 https://your-site-name.netlify.app
2. 打开 DevTools -> Network 面板 -> 勾选 "Preserve log"
3. 进入 Reading 页面, 点击 "生成" 按钮触发 streaming
4. 在 Network 列表中找到 `llm-proxy` 请求 (路径含 `/.netlify/edge-functions/llm-proxy`)
5. 检查:
   - **Status**: 200
   - **Content-Type**: `text/event-stream`
   - **Transfer-Encoding**: `chunked`
6. 点击该请求 -> Response 标签, 看到类似:
   ```
   data: {"delta":"Hello"}
   data: {"delta":" world"}
   data: {"delta":"!"}
   data: [DONE]
   ```
7. 验证前端 React UI: 文本逐字出现, 不是一次性渲染

> **如果 stream 失败**: 检查 OPENAI_API_KEY 是否有效 + 是否超过 rate limit (60 req/min per IP).

---

## 2. 3 API key 真实配置 (15 步骤)

> 3 个 provider × 5 步骤 = 15 步骤. 真实 API key 由用户在 provider 官网创建, Netlify 注入由 Netlify UI 或 CLI 完成.

### 2.1 OPENAI_API_KEY (5 步骤)

#### 步骤 1: 注册 OpenAI 账号

- 打开 https://platform.openai.com/signup
- 用邮箱或 Google / Microsoft 账号注册
- 完成手机号验证

#### 步骤 2: 创建 API key

1. 登录 https://platform.openai.com/api-keys
2. 点击 "+ Create new secret key" 按钮
3. 填写:
   - **Name**: `wordaydream-prod` (方便记忆)
   - **Project**: `Default project` (或新建一个 `wordaydream`)
   - **Permissions**: `All` (默认, 包含 read + write)
4. 点击 "Create secret key"
5. **立即复制** 生成的 `sk-...` 字符串 (窗口关闭后无法再次查看)

#### 步骤 3: 设置 rate limit + budget

1. 进入 https://platform.openai.com/account/limits
2. 确认 Tier (新账号是 Tier 1, $100/月, 60 req/min)
3. 如需更高: 充值 $50+ 可升级 Tier 2 (500 req/min, 5000 req/min)
4. 进入 https://platform.openai.com/settings/organization/billing
5. 设置 **Usage limit**: 建议 `Hard limit = $20` (避免意外超额)
6. 设置 **Email notification threshold**: 50% / 75% / 100% 三个勾都勾上
7. 充值: 信用卡 / Apple Pay / Google Pay 任意一种, 建议先充 $10 测试

#### 步骤 4: Netlify env 注入

方式 A: Netlify UI

1. Site dashboard -> Site configuration -> Environment variables
2. 找到 `OPENAI_API_KEY` 变量, 点击 "Edit"
3. Value 字段粘贴 `sk-...` 字符串
4. 部署上下文选择 "All scopes"
5. 点击 "Save"

方式 B: Netlify CLI (推荐, 可记录到 dotenv)

```bash
npm install -g netlify-cli
netlify login
netlify link  # 关联到 wordaydream site
netlify env:set OPENAI_API_KEY "sk-proj-xxxxxxxxxxxxxxxxxxxx"
# 重复对 ANTHROPIC_API_KEY / DEEPSEEK_API_KEY
```

#### 步骤 5: 验证连通性

```bash
# 重新部署 (Netlify UI: Deploys -> Trigger deploy -> Deploy site)
# 部署完成后:
curl -X POST https://your-site-name.netlify.app/.netlify/edge-functions/llm-proxy \
  -H "Content-Type: application/json" \
  -d '{"provider":"openai","prompt":"Say OK in 1 word","maxTokens":5}'
```

期望 HTTP 200 + 包含 `"text":"OK"`.

---

### 2.2 ANTHROPIC_API_KEY (5 步骤)

#### 步骤 1: 注册 Anthropic 账号

- 打开 https://console.anthropic.com/
- 用邮箱或 Google 账号注册
- 完成手机号验证 (注意: Anthropic 当前仅支持部分国家手机号)

#### 步骤 2: 创建 API key

1. 登录 https://console.anthropic.com/settings/keys
2. 点击 "+ Create Key" 按钮
3. 填写:
   - **Name**: `wordaydream-prod`
   - **Workspace**: `Default` (或新建)
4. 点击 "Create Key"
5. **立即复制** `sk-ant-...` 字符串

#### 步骤 3: 设置 monthly limit

1. 进入 https://console.anthropic.com/settings/limits
2. **Monthly spend limit**: 建议 `$30` (默认 free 账号仅 $5, 需绑定信用卡解锁更高)
3. **Email alerts**: 50% / 75% / 100% 三个勾
4. 充值: 绑定信用卡, 建议先充 $10 测试

#### 步骤 4: Netlify env 注入

```bash
netlify env:set ANTHROPIC_API_KEY "sk-ant-api03-xxxxxxxxxxxxxxxxxxxx"
```

#### 步骤 5: 验证连通性

```bash
curl -X POST https://your-site-name.netlify.app/.netlify/edge-functions/llm-proxy \
  -H "Content-Type: application/json" \
  -d '{"provider":"anthropic","prompt":"Say OK","maxTokens":5}'
```

期望 HTTP 200 + 包含 `"text":"OK"` + `"model":"claude-3-5-haiku-20241022"` 或类似.

---

### 2.3 DEEPSEEK_API_KEY (5 步骤)

#### 步骤 1: 注册 DeepSeek 账号

- 打开 https://platform.deepseek.com/signup
- 用邮箱注册
- 完成手机号验证

#### 步骤 2: 创建 API key

1. 登录 https://platform.deepseek.com/api_keys
2. 点击 "+ Create new API key" 按钮
3. 填写:
   - **Name**: `wordaydream-prod`
4. 点击 "Create"
5. **立即复制** `sk-...` 字符串

#### 步骤 3: 设置余额

1. 进入 https://platform.deepseek.com/top_up
2. DeepSeek 充值规则: 1 元起充, 按 token 用量扣费 (deepseek-chat 约 1元/百万 input token)
3. 建议先充 ¥10 (约 $1.4) 测试
4. 微信 / 支付宝扫码支付

#### 步骤 4: Netlify env 注入

```bash
netlify env:set DEEPSEEK_API_KEY "sk-xxxxxxxxxxxxxxxxxxxx"
```

#### 步骤 5: 验证连通性

```bash
curl -X POST https://your-site-name.netlify.app/.netlify/edge-functions/llm-proxy \
  -H "Content-Type: application/json" \
  -d '{"provider":"deepseek","prompt":"Say OK","maxTokens":5}'
```

期望 HTTP 200 + 包含 `"text":"OK"` + `"model":"deepseek-chat"`.

---

### 2.4 验证 Provider 切换 (SettingsPanel UI)

1. 打开 Netlify 部署的 site
2. 点击 Settings 按钮
3. 在 LLM Provider 下拉框中, 依次选 `OpenAI` / `Anthropic` / `DeepSeek`
4. 每个 provider 切换后, 点击 "测试连接" 按钮 (或进入 Reading 页面点 "生成")
5. 验证: 返回文本正常 + 无 console error + Netlify 函数日志显示对应 provider 被调用

### 2.5 限速策略 (Rate Limit)

服务端 (Netlify Edge Function `llm-proxy.ts`):

- 已实现: 60 req/min per IP (`checkRateLimit` from `netlify/edge-functions/utils/rateLimit.ts`)
- 真实部署后, 可在 Netlify dashboard -> Functions -> Logs 查看 rate limit 触发

客户端 (前端 `useSettingsStore`):

- 用户可手动设置每日 LLM 调用上限 (SettingsPanel -> Advanced)
- 默认: 100 calls/day (够日常使用)

API key 安全:

- API key 仅在 Netlify env 注入, 不进入 client bundle (无 VITE_ 前缀)
- pre-commit hook (`scripts/pre-commit-secret-scan.sh`) 拦截误入代码的 sk-/ant- 字符串
- Netlify env 在 dashboard 加密存储, 仅 deployment 可访问

---

## 3. Lighthouse 5 项真实跑分 (5 步骤)

> 沙箱无 Lighthouse CLI + Chrome, 配置层 100% 写完, 真实跑分由用户执行.

### 3.1 用户本地: 安装 @lhci/cli

```bash
# 推荐全局安装 (避免每次 npx 下载)
npm install -g @lhci/cli

# 验证安装
lhci --version
# 期望: 0.14.x 或更新
```

> 备选: 也可 `npx -p @lhci/cli lhci autorun` 不全局安装.

### 3.2 用户本地: 跑分 (5 项阈值 PWA>=90/Performance>=80/A11y>=90/BP>=90/SEO>=90)

```bash
# 方式 A: lhci autorun (推荐, 自动跑 3 次取中位数)
lhci autorun --config=./lighthouse.config.js

# 方式 B: 单次直接跑
npx -p lighthouse lighthouse https://your-site-name.netlify.app \
  --config-path=./lighthouse.config.js \
  --output=json \
  --output-path=./lighthouse-report.json \
  --chrome-flags="--headless --no-sandbox"
```

跑分后, 在 `lighthouseci/` 目录会生成:

- `lighthouse-*.json` (机器可读)
- `lighthouse-*.html` (人类可读, 浏览器打开看)
- `manifest.json` (汇总)

> **重要**: 5 项阈值在 `lighthouse.config.js` 中以 `assertScore` 隐式实现 (v1.5.1 强化: 5% buffer + retry 3, 见 Section 8).

### 3.3 CI 集成: `.github/workflows/lighthouse.yml`

- workflow 文件: `.github/workflows/lighthouse.yml` (v1.5.1 NEW)
- 触发条件: 每周一 06:00 UTC cron + 手动 `workflow_dispatch`
- 跑分目标: Netlify preview URL (PR 触发时) 或 production URL (cron 触发时)
- 报告上传: GitHub Actions Artifacts (保留 30 天)
- 5 项阈值: 与 3.2 本地一致, 失败则 workflow exit 1

```yaml
# 简化版 (详见 .github/workflows/lighthouse.yml)
- name: Run Lighthouse CI
  uses: treosh/lighthouse-ci-action@v11
  with:
    configPath: ./lighthouse.config.js
    uploadArtifacts: true
    temporaryPublicStorage: true
```

### 3.4 报告解读: 5 项分数 + 优化建议

打开 `lighthouse-report.html` 浏览器查看, 5 项分数显示在顶部:

| 维度 | 阈值 | 优化 tips (典型问题 + 解法) |
|------|------|---------------------------|
| **PWA** | >= 90 | - 缺 manifest / icon: 检查 `public/manifest.webmanifest` + `public/icons/icon-192.png` + `icon-512.png`<br>- SW 注册失败: 检查 `public/sw.js` 是否在 build 后复制到 `dist/sw.js`<br>- 缺 themed-omnibox: 检查 `manifest.theme_color = '#1c1917'` |
| **Performance** | >= 80 | - TTI > 5s: bundle 拆 code split, 动态 import `src/features/llm/*`<br>- FCP > 2s: 关键 CSS inline, 字体 preload<br>- JS bundle > 200KB: `vite build --analyze` 看 chunk 大小<br>- 图像未优化: icon 改 WebP |
| **Accessibility** | >= 90 | - viewport meta 缺: `index.html` 检查 `<meta name="viewport">`<br>- content-width 错误: viewport content 不能 `width=数值` (用 `width=device-width`)<br>- 颜色对比度: dark ink `#1c1917` on warm paper `#faf8f5` 对比度 13.5:1, OK |
| **Best Practices** | >= 90 | - HTTPS: 强制 HTTPS (Netlify 1.6 自动)<br>- 0 console error: 检查 browser console<br>- 0 deprecated API: 升级 React 19 / Vite 8 / VitePWA 1.3 (v1.5.0 已升级) |
| **SEO** | >= 90 | - meta description 缺: `index.html` 检查 `<meta name="description">` (默认 1.5.0 vite-plugin-pwa manifest.description)<br>- viewport: 同 A11y<br>- robots.txt: 部署 `public/robots.txt` |

> **优先级**: PWA > A11y > Performance > Best Practices > SEO.
> PWA 是 v1.4.1 合同, 不可破. A11y 必备 (满足基础用户群). Performance 优化看业务需求, 不卡 80 即可.

### 3.5 持续监控

- **每周跑分**: cron `0 6 * * 1` (周一 06:00 UTC) 触发
- **阈值告警**: workflow 失败时, GitHub 自动给 repo maintainer 发邮件
- **历史趋势**: 上传报告到 https://googlechrome.github.io/lighthouse-ci/ (temporary public storage, 7 天有效, 适合周对比)
- **生产事故响应**: 若某周分数掉到阈值以下, 创建 issue 跟踪 + 优先修复 (例如 PWA 缺 icon / Performance bundle 增大)

---

## 4. Playwright 4 场景真实 E2E (6 步骤)

> 沙箱无 Playwright Chromium, 模板 100% 写完, 真实跑分由用户执行.

### 4.1 用户本地: 安装 Playwright Chromium

```bash
# 在项目根目录
npm install -D @playwright/test
npx playwright install chromium --with-deps

# 验证安装
npx playwright --version
# 期望: 1.49.x 或更新
```

> **注意**: `--with-deps` 在 Linux/Mac 安装系统依赖. Windows 跳过 (Playwright 自带 Chromium runtime).

### 4.2 用户本地: 跑 4 场景 E2E

```bash
# 启动 dev server (后台)
npm run dev &
# 等待 3s 让 server 起来

# 跑全部测试
npx playwright test

# 跑单个 spec
npx playwright test e2e/offline-install.spec.ts

# 跑单个 test (T01 = offline banner)
npx playwright test -g "P1_4_T01"

# 跑指定 browser project
npx playwright test --project=chromium
npx playwright test --project=mobile-chrome
```

4 场景覆盖 (见 `e2e/offline-install.spec.ts`):

| 编号 | 场景 | 验证点 |
|------|------|--------|
| T01 | offline banner | `setOffline(true)` + 触发 `offline` event + `[data-testid="offline-banner"]` 可见 |
| T02 | install prompt | 模拟 `beforeinstallprompt` event + Settings 面板打开 + `[data-testid="install-prompt-button"]` 可见 |
| T03 | SW registration | `navigator.serviceWorker.ready` 非 null (仅 production build, dev mode SW 关闭) |
| T04 | streaming typing | 点 generate 按钮 + `[data-testid="streaming-text"]` 出现 + 完成 + `[data-testid="interactive-passage"]` 渲染 |

### 4.3 CI 集成: `.github/workflows/playwright.yml`

- workflow 文件: `.github/workflows/playwright.yml` (v1.5.1 NEW)
- 触发条件: PR + push to main/develop + 每周六 cron
- 4 browser projects: chromium (默认) + firefox + webkit + mobile-chrome
- 报告上传: GitHub Actions Artifacts (保留 30 天, 包含 `playwright-report/` HTML 报告 + 4 截图归档)
- 4 截图归档: T01-T04 每个场景的 `[role=main]` 截图存到 `debug_shots_v151/T01-T04-{viewport}.png`

```yaml
# 简化版 (详见 .github/workflows/playwright.yml)
- name: Run Playwright tests
  uses: microsoft/playwright-github-action@v1
- name: Upload Playwright Report
  uses: actions/upload-artifact@v4
  with:
    name: playwright-report
    path: playwright-report/
```

### 4.4 报告解读: 4 场景 pass/fail + 截图归档

跑分后, 报告分两部分:

1. **HTML 报告**: `playwright-report/index.html` (浏览器打开)
   - 顶部: Passed X / Failed Y / Flaky Z
   - 列表: 每个 test 的 4 browser project 结果
   - 点击失败 test -> 详情 (log + trace + screenshot + video)

2. **截图归档** `debug_shots_v151/`:
   - `T01-offline-banner-chromium.png`
   - `T02-install-prompt-chromium.png`
   - `T03-sw-registration-chromium.png`
   - `T04-streaming-typing-chromium.png`
   - 同 T01-T04 × {firefox, webkit, mobile-chrome} = 4 × 4 = 16 张
   - 通过 `page.screenshot({ path: 'debug_shots_v151/T01-offline-banner-chromium.png', fullPage: true })` 归档

> **v1.5.1 强化**: 4 spec 每个加了 `data-testid` 校对 + `waitForSelector` 等待策略 + screenshot 归档, 减少 flaky test.

### 4.5 失败调试: trace viewer + 视频回放

失败时, Playwright 自动生成 `test-results/` 目录:

- **trace.zip**: 完整 trace (含 DOM snapshot + network + console + 截图 + 视频)
- **video.webm**: 整个 test 录屏
- **screenshot**: 失败瞬间截图
- **error-context.md**: 自动提取的失败上下文

本地 trace viewer:

```bash
npx playwright show-trace test-results/T01-offline-banner-chromium/trace.zip
```

打开后: 看到每一步的 DOM / network / console, 可前后滚动时间轴, 定位失败点.

### 4.6 持续监控

- **PR 触发**: 每次 PR 自动跑 4 browser × 4 scenario = 16 test
- **每周 cron**: 每周六 06:00 UTC 跑
- **失败告警**: workflow 失败时, GitHub 发邮件 + Slack 通知 (如果配置了 Slack webhook)
- **历史趋势**: 在 GitHub Actions 页面查看 90 天内的 workflow run 历史

---

## 5. 验收清单 (Contract 23 + 24)

### Contract 23 NEW: 4 阻塞点 runbook 完整 (本文件覆盖)

- [x] **1. Netlify 部署 8 步骤**: 1.1-1.8 全部 runbook 化
- [x] **2. 3 API key 配置 15 步骤**: 2.1-2.3 (5 × 3 = 15) + 2.4 注入 + 2.5 验证
- [x] **3. Lighthouse 跑分 5 步骤**: 3.1-3.5 (本地安装 + 跑分 + CI + 报告 + 监控)
- [x] **4. Playwright E2E 6 步骤**: 4.1-4.6 (本地安装 + 跑分 + CI + 报告 + 调试 + 监控)
- [x] **总步骤数**: 8 + 15 + 5 + 6 = 34 步骤

### Contract 24 NEW: pre-commit secret scan 0 命中

- [x] **脚本**: `scripts/pre-commit-secret-scan.sh` (v1.5.1 NEW)
- [x] **模式**: 扫描 `git diff --cached` 中 `sk-` / `sk-ant-` / `sk-proj-` 前缀
- [x] **退出**: 命中则 exit 1 阻断 commit
- [x] **0 命中**: 当前 0 真实 API key 入库

### 0 regression 验证

- v1.5.0 22 合同 (18 沿用 v1.4.1 + 4 NEW v1.5.0) 保持
- v1.4.1 18 合同 + v1.4.0 13 合同 + v1.3.0 9 HARD 合同保持
- 22 沿用 + 2 NEW v1.5.1 = 24 合同 (Contract 23 + 24 合并为 1 维 runbook 验收)
- 0 breaking change: v1.5.0 已就绪配置层 0 行为变更, 只补 runbook + 强化

---

## 6. 故障排查 FAQ

### Q1: Netlify 部署失败, 日志显示 "vite: not found"

**原因**: 依赖未安装. `netlify.toml` 已声明 `command = "npm run build"`, 但 Netlify 需要先 `npm install`.

**解法**:
1. 在 Netlify Site -> Build & deploy -> Build settings
2. 添加 environment variable: `NPM_FLAGS = --legacy-peer-deps`
3. 或修改 `netlify.toml` 在 `[build]` 前添加 `NPM_FLAGS = "--legacy-peer-deps"`

### Q2: Edge Function 返回 "API key not configured"

**原因**: Netlify env 未设置 / 设置的 scope 不对 / 变量名拼写错.

**解法**:
```bash
# 列出当前 site 全部 env
netlify env:list
# 确认 OPENAI_API_KEY 在列表中
# 如缺失, 重新注入
netlify env:set OPENAI_API_KEY "sk-proj-xxxxx"
# 重新部署
```

### Q3: Lighthouse 跑分 PWA < 90

**原因**: manifest 缺字段 / icon 缺失 / SW 未注册.

**解法**:
1. 打开 Chrome DevTools -> Application -> Manifest, 检查字段完整
2. 确认 `dist/manifest.webmanifest` + `dist/icons/icon-192.png` + `icon-512.png` 存在
3. 确认 `dist/sw.js` 存在且 `navigator.serviceWorker.register('/sw.js')` 在生产 build 后能成功

### Q4: Playwright 跑分 timeout 30s

**原因**: webServer 启动慢 / selector 找不到.

**解法**:
1. 增大 `playwright.config.ts` 的 `timeout` 字段 (默认 30s, 改 60s)
2. 显式 `await page.waitForSelector('[data-testid="offline-banner"]', { timeout: 10000 })` 而不是 `expect(...).toBeVisible()` (后者默认 5s)
3. 检查 dev server 是否在 `http://localhost:5173` 启动 (Vite 默认)

### Q5: API key 误入代码怎么办

**解法 (立刻执行)**:
1. **在 provider 官网立即 revoke 该 key** (平台 menu -> API keys -> Delete / Revoke)
2. 创建新 key, 重新注入 Netlify env
3. 从 git history 中彻底清除:
   ```bash
   git filter-repo --invert-paths --path <误入的文件>
   # 或: bfg-repo-cleaner --delete-files <文件名>
   git push --force
   ```
4. 验证 pre-commit hook 生效: `bash scripts/pre-commit-secret-scan.sh`

### Q6: SSE 流式没反应, 一直 loading

**原因**: 1) 浏览器不支持 (用 Chrome 90+); 2) Netlify 端 stream 路径仅支持 openai; 3) CORS 问题.

**解法**:
1. 切到 Chrome / Edge 浏览器
2. 确认 provider = openai (其它 provider 返回 501)
3. 检查 DevTools Network, `llm-proxy` 请求的 Response headers 是否有 `Content-Type: text/event-stream`
4. 如有 CORS 错误, 检查 `netlify/edge-functions/utils/cors.ts` 的 `Access-Control-Allow-Origin`

---

## 7. 参考链接

### Netlify 官方文档

- 入门: https://docs.netlify.com/get-started/
- 部署: https://docs.netlify.com/site-deploys/overview/
- 环境变量: https://docs.netlify.com/environment-variables/overview/
- Edge Functions: https://docs.netlify.com/build/edge-functions/overview/
- CLI: https://docs.netlify.com/cli/get-started/
- 自定义域名: https://docs.netlify.com/domains-https/custom-domains/
- HTTPS: https://docs.netlify.com/domains-https/https-ssl/

### LLM Provider 官方文档

- OpenAI API keys: https://platform.openai.com/api-keys
- OpenAI usage limits: https://platform.openai.com/account/limits
- OpenAI billing: https://platform.openai.com/settings/organization/billing
- Anthropic console: https://console.anthropic.com/
- Anthropic API keys: https://console.anthropic.com/settings/keys
- Anthropic limits: https://console.anthropic.com/settings/limits
- DeepSeek platform: https://platform.deepseek.com/
- DeepSeek API keys: https://platform.deepseek.com/api_keys
- DeepSeek top up: https://platform.deepseek.com/top_up

### Lighthouse 官方文档

- @lhci/cli: https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/getting-started.md
- treosh/lighthouse-ci-action: https://github.com/treosh/lighthouse-ci-action
- LHCI 阈值: https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/configuration.md#assert
- Lighthouse 报告解读: https://developer.chrome.com/docs/lighthouse/overview/

### Playwright 官方文档

- 入门: https://playwright.dev/docs/intro
- 配置文件: https://playwright.dev/docs/test-configuration
- webServer: https://playwright.dev/docs/test-webserver
- Trace viewer: https://playwright.dev/docs/trace-viewer
- microsoft/playwright-github-action: https://github.com/microsoft/playwright-github-action
- 截图归档: https://playwright.dev/docs/screenshots

### GitHub Actions 官方文档

- 入门: https://docs.github.com/en/actions/quickstart
- Secrets: https://docs.github.com/en/actions/security-guides/using-secrets-in-github-actions
- Artifacts: https://docs.github.com/en/actions/advanced-guides/storing-workflow-data-as-artifacts
- cron schedule: https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#schedule

---

**END of OPERATIONS.md (v1.5.1 Stage 1)**
