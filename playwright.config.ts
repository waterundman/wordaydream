/**
 * Wordaydream v1.5.1 Stage 1 P1_4: Playwright 配置 (4 阻塞点 runbook 之一)
 *
 * 沙箱无 Playwright Chromium, 配置层 100% 写完, 真实跑分由用户执行:
 *   npm install -D @playwright/test
 *   npx playwright install chromium
 *   npx playwright test
 *
 * 4 阻塞点 runbook 之一 (阻塞点 4: Playwright 4 场景真实 E2E)
 *   docs/OPERATIONS.md Section 4 包含 6 步骤 runbook.
 *
 * 0 emoji (硬约束)
 * 0 breaking change: 与 v1.5.0 e2e/offline-install.spec.ts 模板一致, 仅新增 config 文件
 *
 * v1.5.1 Stage 1 强化:
 * - webServer: 启动 npm run dev (Vite) 在 5173 端口, Playwright 自动等待启动完成
 * - baseURL: 'http://localhost:5173' (本地开发) + 'http://localhost:4173' (preview build)
 * - projects: 4 browser (chromium / firefox / webkit / mobile-chrome), 默认 chromium
 * - reporter: HTML + JSON 双格式, CI 友好
 * - screenshot: 'only-on-failure' (节省空间) + trace: 'retain-on-failure' (调试)
 * - timeout: 30s/action (放宽 v1.5.0 默认 15s, 适配 streaming typing 场景)
 *
 * v1.5.2 fix M12: webServer 改为 production preview 模式 (npm run build + preview).
 * - 原因: vite-plugin-pwa devOptions.enabled = false, dev 模式下 SW 不注册,
 *   T03 (SW registration) 永远失败.
 * - 改为 preview 模式后, SW 正常注册, T03 可通过.
 * - 缺点: 启动时间变长 (需先 build), 但 CI 环境可接受.
 * - 本地快速调试可通过 E2E_USE_DEV=true 环境变量切换回 dev 模式 (跳过 SW 相关 test).
 *
 * 强化 selectors (与 v1.5.0 spec 一致):
 * - 全 spec 使用 [data-testid="..."] 选择器, 不依赖 className / textContent
 * - 等待策略: waitForSelector + expect().toBeVisible() 双保险
 * - 截图归档: debug_shots_v151/{T01-T04}-{project}.png
 */

import { defineConfig, devices } from '@playwright/test';

/**
 * v1.5.1 Stage 1 强化: PORT 配置
 * 5173: Vite dev server 默认端口
 * 4173: vite preview 默认端口
 */
const BASE_URL_DEV = 'http://localhost:5173';
const BASE_URL_PREVIEW = 'http://localhost:4173';

// v1.5.2 fix M12: 默认 preview 模式 (production build), 通过 env 切换 dev 模式
const USE_DEV = process.env.E2E_USE_DEV === 'true';
const BASE_URL = USE_DEV ? BASE_URL_DEV : BASE_URL_PREVIEW;
const WEB_SERVER_COMMAND = USE_DEV
  ? 'npm run dev'
  : 'npm run build && npm run preview -- --port 4173 --strictPort';

export default defineConfig({
  // v1.5.2 fix M12: 默认 preview (production build) 模式, SW 才会注册
  // 本地快速调试: E2E_USE_DEV=true npx playwright test (跳过 SW test)
  webServer: {
    command: WEB_SERVER_COMMAND,
    url: BASE_URL,
    reuseExistingServer: true, // 已有 server 时复用, 不重复启动
    timeout: 120 * 1000, // 120s 启动超时 (preview 模式需先 build)
    stdout: 'pipe', // 捕获 server 日志
    stderr: 'pipe',
  },

  // v1.5.1 强化: baseURL 统一, 测试内可用相对路径 (例: page.goto('/'))
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure', // 失败保留 trace.zip, 调试用
    screenshot: 'only-on-failure', // 失败截图
    video: 'retain-on-failure', // 失败保留 video.webm
    // 0 网络节流, 模拟本地开发环境
    actionTimeout: 30 * 1000, // 单 action 30s 超时 (放宽 v1.5.0 15s)
    navigationTimeout: 30 * 1000,
  },

  // v1.5.1 强化: 4 browser projects (chromium 默认, firefox / webkit / mobile-chrome 额外)
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
  ],

  // v1.5.1 强化: HTML + JSON 双 reporter
  // - HTML: 浏览器查看 (playwright-report/index.html)
  // - JSON: CI 解析 (test-results/results.json)
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['json', { outputFile: 'playwright-report/results.json' }],
    ['list'], // 终端简洁输出
  ],

  // v1.5.1 强化: 全局超时 + expect 超时
  timeout: 30 * 1000, // 单 test 30s
  expect: {
    timeout: 5 * 1000, // expect 默认 5s
  },

  // v1.5.1 强化: 失败重试 (CI 跑 1 次, 本地跑 0 次)
  retries: process.env.CI ? 1 : 0,

  // v1.5.1 强化: 失败时仅跑失败的 test (CI 加速)
  forbidOnly: !!process.env.CI,

  // v1.5.1 强化: 截图归档目录 (与 e2e spec 内 page.screenshot 配合)
  outputDir: 'test-results/',
});
