# Wordaydream v1.5.1 SPEC — 4 阻塞点文档化 + 主页布局优化

> **版本**: v1.5.1 (小版本, 收口型 + 主页优化)
> **日期**: 2026-07-10
> **起点 posterior**: 0.97+ (v1.5.0 终点承接, 不 minor 重置)
> **终点 posterior**: 0.99+ (+0.02, 5 stages 小版本)
> **工期**: 5 工作日
> **决策权重**: 价值 30% + 沙箱 25% + 风险 20% + 工期 15% + 维护 10%

---

## 1. 概述

v1.5.1 是 v1.5.0 之后的小版本迭代, 同时做 2 件事:

1. **兑现 4 阻塞点 (P0 必做)**: v1.5.0 沉淀的 4 沙箱阻塞点 (Netlify 部署 + 3 API key + Lighthouse + Playwright), v1.5.1 输出完整 runbook 让用户手动执行真实跑分
2. **主页布局优化 (P0 新功能)**: 主页方案 A+C 混合 (Hero-First 重设计 + 内部组件 Refined Paper 改良)

### 1.1 与 v1.5.0 的关系

- **承接**: 22 合同 (18 沿用 v1.4.1 + 4 NEW v1.5.0) 全保持
- **兑现**: 4 阻塞点配置层 v1.5.0 已就绪, v1.5.1 补 runbook + 强化
- **新功能**: 主页方案 A+C 混合 (3 NEW 合同 23-25 + 26)

### 1.2 设计语言保持

- **warm paper**: #faf8f5 主背景, #f5f2ed 暖白
- **dark ink**: #1c1917 主文字, #4a4540 次文字
- **accent**: #2d5a4d (深绿), #e07a3b (暖橙)
- **serif title**: Source Serif Pro + Noto Serif SC
- **sans body**: Inter + Noto Sans SC
- **动画**: 全部支持 prefers-reduced-motion

---

## 2. 阻塞点 4 项 (Stage 1 重点)

### 2.1 阻塞点 P0_1: 真实 Netlify 部署

**现状 (v1.5.0)**:
- `netlify.toml` 完整 (6 VITE 字段占位 + 2 context + SPA redirects + 3 缓存头)
- `.github/workflows/netlify-deploy.yml` 完整 (CI + deploy 双 job)
- `netlify/edge-functions/llm-proxy.ts` 加 `?action=stream` 端点注释

**v1.5.1 需求**:
- `docs/OPERATIONS.md` NEW: 完整运维手册 (Netlify 部署 + 3 API key + Lighthouse + Playwright 步骤化)
- `.github/workflows/netlify-deploy.yml` 强化: retry + health check + status badge
- 步骤化 runbook (8 步骤):
  1. 用户注册 Netlify 账号 + 连接 GitHub repo
  2. 创建 Site + 关联 wordaydream repo
  3. 配置环境变量: NODE_VERSION=20 + 6 VITE 字段 + 3 API key 占位
  4. 触发首次部署: git push main 触发 GitHub Actions
  5. 验证部署: 访问 Netlify 域名, 检查 manifest + sw.js
  6. 配置自定义域名 (可选): DNS CNAME + Netlify HTTPS
  7. 验证 Edge Function: curl https://site.netlify.app/api/ai?action=test
  8. 验证 SSE 流式: 浏览器 DevTools Network 检查 text/event-stream

**验收 (Contract 23 之一)**:
- OPERATIONS.md 8 步骤 runbook 完整
- GitHub Secrets 注入文档 (NETLIFY_AUTH_TOKEN + NETLIFY_SITE_ID)
- 部署验证命令 (curl Edge Function)
- 0 emoji

### 2.2 阻塞点 P0_2: 3 API key 真实配置

**现状 (v1.5.0)**:
- netlify.toml 占位 (VITE_LLM_OPENAI_API_KEY 等 3 字段)
- 真实 API key 需用户手动注入

**v1.5.1 需求**:
- OPERATIONS.md 步骤化 runbook (5 步骤/每 provider):
  1. 用户申请 API key (platform.openai.com / console.anthropic.com / platform.deepseek.com)
  2. 创建 key + 设置 rate limit + budget
  3. Netlify env 注入: `netlify env:set OPENAI_API_KEY sk-...`
  4. 验证: curl Edge Function test 端点
  5. 限速策略: rate limit + 月度成本监控
- `scripts/pre-commit-secret-scan.sh` NEW: 防止 API key 误入代码 (grep sk-/ant-/sk- + exit 1)

**验收 (Contract 23+24)**:
- OPERATIONS.md 5 步骤 × 3 provider = 15 步骤 runbook
- pre-commit secret scan 0 命中
- 0 emoji

### 2.3 阻塞点 P0_3: Lighthouse 5 项真实跑分

**现状 (v1.5.0)**:
- `lighthouse.config.js` 5 项阈值 (PWA>=90/Performance>=80/A11y>=90/BP>=90/SEO>=90)
- `scripts/lighthouse-audit.mjs` 完整

**v1.5.1 需求**:
- OPERATIONS.md 步骤化 runbook (5 步骤):
  1. 用户本地: `npm install -g @lhci/cli`
  2. 用户本地: `lhci autorun --config=lighthouse.config.js`
  3. CI 集成: `.github/workflows/lighthouse.yml` NEW (treosh/lighthouse-ci-action@v11 + 5% buffer + retry 3)
  4. 报告解读: 5 项分数 + 优化建议 (perf 优先, A11y 必备)
  5. 持续监控: 每周跑分 + 阈值告警
- `lighthouse.config.js` 强化: 5% buffer + retry 3

**验收 (Contract 23 之三)**:
- OPERATIONS.md 5 步骤 runbook
- lighthouse.yml 完整 (treosh/lighthouse-ci-action@v11)
- 5 项阈值 (PWA>=90/Performance>=80/A11y>=90/BP>=90/SEO>=90)
- 0 emoji

### 2.4 阻塞点 P0_4: Playwright 4 场景真实 E2E

**现状 (v1.5.0)**:
- `e2e/offline-install.spec.ts` 4 场景模板 (offline / install / SW / streaming)

**v1.5.1 需求**:
- `playwright.config.ts` NEW (~80 LOC): webServer + baseURL + 4 projects (chromium / firefox / webkit / mobile)
- `e2e/offline-install.spec.ts` 强化: selector 校对 + 等待策略 + 截图归档 (`debug_shots_v151/`)
- `.github/workflows/playwright.yml` NEW (~50 LOC, microsoft/playwright-github-action@v1)
- OPERATIONS.md 步骤化 runbook (6 步骤):
  1. 用户本地: `npx playwright install chromium`
  2. 用户本地: `npx playwright test`
  3. CI 集成: playwright.yml 自动跑分
  4. 报告解读: 4 场景 pass/fail + 截图归档
  5. 失败调试: trace viewer + 视频回放
  6. 持续监控: PR 触发 + 每周跑分

**验收 (Contract 23 之四)**:
- OPERATIONS.md 6 步骤 runbook
- playwright.config.ts 完整
- playwright.yml 完整
- 4 场景模板 + selector 校对
- 0 emoji

---

## 3. 主页方案 A+C 混合 (Stage 2-4 重点)

### 3.1 方案 A: Hero-First 重设计 (Stage 2)

**设计要点**:
- **Hero 标题**: clamp(2.5rem, 6vw, 4rem) serif 字体
- **Hero 双行 tagline**: "在语境中学习词汇" / "每个词都在它出现的语境里"
- **大 CTA**: 触摸目标 56px+, 主按钮 "开始今日阅读"
- **桌面 split**: 左 60% Hero + 右 40% TodayCard 预览
- **移动 stack**: Hero 上 + TodayCard 下, 加大 padding 32px
- **大屏 ultrawide**: max-width 1200px 中央居中
- **入场动画**: fade-in + slide-up 8px, 200ms ease-out-quart
- **背景**: 渐变 paper-warm (#f5f2ed) -> paper (#faf8f5)

**验收 (Contract 25)**:
- Hero 标题 clamp + serif + dark ink
- 双行 tagline + 大 CTA 56px+
- 桌面 60/40 split + 移动 stack + ultrawide 1200px
- 入场 fade-in + slide-up 8px, 200ms
- prefers-reduced-motion 兼容
- 0 emoji

### 3.2 方案 C: Refined Paper 改良 (Stage 3)

**设计要点**:
- **ProgressRing label**: "今日完成 X/Y 词" 显式展示
- **StreakBadge 呼吸动效**: 0.97 -> 1.03 scale, 2s ease-in-out infinite
- **TodayCard 行高**: 1.7 -> 1.8, 卡片内间距 12px -> 16px
- **AchievementWall 卡片间距**: 12px -> 16px
- **tokens 新增**: --home-card-gap / --home-section-gap / --home-paragraph-leading

**验收 (Contract 26 之一)**:
- ProgressRing label 显式
- StreakBadge 呼吸动效 2s
- TodayCard 行高 1.8 + 间距 16px
- AchievementWall 卡片间距 16px
- prefers-reduced-motion 兼容
- 0 emoji

### 3.3 滚动叙事 (Stage 4)

**设计要点**:
- **4 段 IntersectionObserver**: Hero (立即) / TodayCard (threshold 0.3) / ProgressRing (0.5) / AchievementWall (0.7)
- **入场动画**: fade-in (opacity 0 -> 1) + slide-up (translateY 16px -> 0), 350ms ease-out-quart
- **rootMargin**: -50px 0px (提前 50px 触发)
- **prefers-reduced-motion 兼容**: transform + opacity 0 0.001s
- **0 layout shift** (CLS = 0)
- **`useScrollReveal` hook**: ~60 LOC, 支持 4 段 + threshold + rootMargin

**验收 (Contract 26 之二)**:
- 4 段滚动入场
- 入场动画 350ms ease-out-quart
- rootMargin -50px
- prefers-reduced-motion 兼容
- CLS = 0
- 0 emoji

---

## 4. 25 合同 (22 沿用 v1.5.0 + 3 NEW v1.5.1)

### 4.1 22 沿用 v1.5.0 (全 PASS)

- H1-H9 (9 项 HARD): 段落达标率 / 划线精准度 / markdown 0% / 0 console.error / [Alignment] log / 集成测试 5 fixture / maxAttempts=3 / Fallback banner / Edge Function
- S1-S3 (3 项 SOFT): 视口截图 / 0 pageerror / language_compliance_rate >= 50%
- N1-N4 v1.4.0: 段落达标 / 划线精准 / TokenSpan tooltip / 函数式 provider routing
- N1-N5 v1.4.1: streaming chunk / streaming 取消 / SW 注册 / offline fallback / PWA manifest
- N19-N22 v1.5.0: pwa 升级 / sw.js / 10 fixture / 灰度发布

### 4.2 3 NEW v1.5.1 (Stage 1-4)

- **Contract 23 NEW (Stage 1)**: 4 阻塞点 runbook 完整 (OPERATIONS.md 8+5+5+6 步骤 + 3 GitHub Actions workflow + pre-commit secret scan)
- **Contract 24 NEW (Stage 1)**: pre-commit secret scan 0 命中 (scripts/pre-commit-secret-scan.sh)
- **Contract 25 NEW (Stage 2)**: 主页 Hero-First 落地 (clamp 字号 + 60/40 split + 大 CTA 56px + 渐变背景)
- **Contract 26 NEW (Stage 3+4)**: 主页组件 Refined Paper + 滚动叙事 4 段 (ProgressRing label + Streak 呼吸 + IntersectionObserver + reduced-motion)

---

## 5. 12 风险 + 10 回退 (沿用 v1.5.0 模式)

### 12 风险

- P0 (5 项): 1) 真实 Netlify 部署 token 泄漏, 2) 3 API key 配置错误, 3) Lighthouse 跑分波动, 4) Playwright selector 失效, 5) 主页 Hero CTA 桌面端溢出
- P1 (4 项): 6) 滚动叙事 IntersectionObserver 触发错位, 7) StreakBadge 呼吸动效移动端耗能, 8) ProgressRing label 多语种溢出, 9) 主页移动端 32px padding 内容溢出
- P2 (3 项): 10) pre-commit hook 误报, 11) Hero 渐变背景大屏拉伸, 12) AchievementWall 卡片间距移动端过宽

### 10 回退

- R1: Hero 失败回退 v1.5.0 三段式 + C 风格
- R2: Streak 呼吸动效失败移除
- R3: ProgressRing label 失败移除
- R4: 滚动叙事失败移除
- R5: 桌面 split 失败改单列 stack
- R6: 大 CTA 56px 失败缩小到 48px
- R7: 渐变背景失败改纯色
- R8: Hero 字号 clamp 失败改固定 2.5rem
- R9: 主页组件间距 16px 失败回退 12px
- R10: 全部失败仅保留 OPERATIONS.md (0 regression)

---

## 6. 项目硬约束 (来自 v0.5.0+)

- **0 emoji**: UI / 文档 / 验收脚本 全部 0 emoji
- **warm paper**: #faf8f5 主背景 + dark ink #1c1917
- **阅读区**: max-width 42rem (672px), 居中
- **响应式**: 3 档 (mobile < 768 / tablet 768-1023 / desktop >= 1024)
- **prefers-reduced-motion**: 全部动画必须兼容
- **CSS 变量**: 集中在 src/styles/tokens.css
- **0 breaking change**: 双签名 / 默认值回退 / 灰度默认 100 / PWA 升级 0 行为变更

---

## 7. 验收门 (11-dim 沿用 v1.5.0)

- semantic: 0 regression + 3 NEW 合同
- tdd: 5+ 单元测试 (Hero / Streak / ProgressRing / useScrollReveal / HomePage)
- e2e: 25 合同验收脚本
- doc: docs/OPERATIONS.md + docs/spec/v1.5.1/main.md + INDEX 更新
- regression: 0 (v1.5.0 22 + v1.4.1 18 + v1.4.0 13)
- risk: 12 风险 (5 P0 / 4 P1 / 3 P2) + 10 回退
- contract: 22 沿用 + 3 NEW = 25
- confidence: 0.97+ -> 0.99+ (+0.02)
- tsc: 0
- vitest: 163+ pass
- sandbox: 100% 可执行

---

## 8. 时间表 (5 工作日)

- D1 (Stage 1, 1.5 天): 4 阻塞点文档化
- D2.5 (Stage 2, 1.5 天): 主页 Hero
- D3.5 (Stage 3, 1 天): 主页组件
- D4.5 (Stage 4, 1 天): 滚动叙事
- D5 (Stage 5, 0.5 天): 收尾

---

## 9. 起点与终点

- **prior**: 0.97 (v1.5.0 终点承接)
- **终点 posterior**: 0.99+ (+0.02)
- **关键交付**: 4 阻塞点 runbook + 主页方案 A+C 混合 + 25 合同
- **下一版方向**: 见 `[[cache/v1.5.1/NEXT-VERSION-DIRECTION]]`

---

## 10. 关键文件清单 (Stage 1-5 全部)

### 新增 (15+ 个)

- `docs/OPERATIONS.md` (~400 LOC, Stage 1)
- `playwright.config.ts` (~80 LOC, Stage 1)
- `.github/workflows/lighthouse.yml` (~50 LOC, Stage 1)
- `.github/workflows/playwright.yml` (~50 LOC, Stage 1)
- `scripts/pre-commit-secret-scan.sh` (~30 LOC, Stage 1)
- `src/features/home/components/HeroSection.tsx` (~80 LOC, Stage 2)
- `src/features/home/components/HeroSection.module.css` (~120 LOC, Stage 2)
- `src/hooks/useScrollReveal.ts` (~60 LOC, Stage 2+4)
- `debug_verify_v151.py` (~2200 LOC, Stage 5)
- `E2E_REPORT_v151.md` (Stage 5)
- `docs/spec/v1.5.1/main.md` (Stage 5)
- vault `bayesian/v1.5.1/history.md` (Stage 5)
- vault `cache/v1.5.1/NEXT-VERSION-DIRECTION.md` (Stage 5)

### 修改 (10+ 个)

- `.github/workflows/netlify-deploy.yml` (Stage 1)
- `lighthouse.config.js` (Stage 1)
- `e2e/offline-install.spec.ts` (Stage 1)
- `src/features/home/HomePage.tsx` (Stage 2+4)
- `src/features/home/HomePage.module.css` (Stage 2+4)
- `src/features/home/components/TodayCard.tsx` + .module.css (Stage 3+4)
- `src/features/home/components/ProgressRing.tsx` + .module.css (Stage 3+4)
- `src/features/home/components/StreakBadge.tsx` + .module.css (Stage 3+4)
- `src/features/home/components/AchievementWall.tsx` + .module.css (Stage 3+4)
- `src/styles/tokens.css` (Stage 3)
- `CHANGELOG.md` (Stage 5)
- `package.json` (Stage 5)
- vault `INDEX.md` (Stage 5)

---

## 11. 验收信号灯 (RGT Status)

- GREEN × 5/5: 4 阻塞点 runbook + Hero 落地 + 组件优化 + 滚动叙事 + 收尾
- SEMANTIC × 5/5: 3 NEW 合同实现 + 22 沿用
- TDD × 5/5: 5+ 单元测试 (Hero / Streak / ProgressRing / useScrollReveal / HomePage)
- DOC × 5/5: OPERATIONS.md + spec + INDEX + CHANGELOG
- REGRESSION × 5/5: 0 regression (v1.5.0 22 + v1.4.1 18 + v1.4.0 13)

---

**END of v1.5.1 SPEC main.md**
