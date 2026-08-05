/**
 * Wordaydream Harmony Stage 4 — 鸿蒙端 E2E Playwright 配置 (soft gate)
 *
 * 专用配置: 仅跑 e2e/harmony.spec.ts, 模拟 ArkWeb 移动环境.
 * 与 playwright.config.ts (Web 端 v1.5.1) 隔离, 互不干扰.
 *
 * 运行方式:
 *   npm install -D @playwright/test
 *   npx playwright install chromium
 *   npx playwright test --config=playwright.harmony.config.ts
 *
 * soft gate (与 FEATURE_PARITY_CHECKLIST.md §6 一致):
 * - 沙箱 / CI 无 DevEco 真机, 用 Chromium + 移动 viewport + ArkWeb UA 模拟.
 * - 需真实 ArkWeb 的场景 (rawfile / VIBRATE / SW) 在 spec 内 test.describe.skip.
 *
 * 设计:
 * - testDir: 'e2e' (与 offline-install.spec.ts 同目录)
 * - testMatch: 仅匹配 harmony.spec.ts (不跑 offline-install.spec.ts)
 * - 单 project: chromium + 移动 viewport (375x812) + ArkWeb userAgent
 * - webServer: dev server (port 3001, 与 vite.config.ts server.port 一致)
 *   原因: harmony build 输出到 rawfile/dist, 无法直接 serve; dev server 跑同一份前端代码.
 * - baseURL: http://localhost:3001
 * - 截图归档: debug_shots_harmony/ (与 spec 内 page.screenshot 配合)
 *
 * 0 emoji (项目硬约束)
 * 0 breaking change: 仅新增配置, 不改动 playwright.config.ts (Web 端)
 */

import { defineConfig, devices } from '@playwright/test';

const BASE_URL = 'http://localhost:3001';

/**
 * 模拟 ArkWeb userAgent. 真实 ArkWeb UA 含 "ArkWeb" 标识.
 */
const ARKWEB_UA =
  'Mozilla/5.0 (Linux; Android 12; HarmonyOS) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36 ArkWeb/4.1.5.3';

export default defineConfig({
  // 仅扫描 e2e/ 目录, 仅匹配 harmony.spec.ts
  testDir: './e2e',
  testMatch: /harmony\.spec\.ts/,

  // ArkWeb 模拟: 移动 viewport + ArkWeb UA
  use: {
    baseURL: BASE_URL,
    viewport: { width: 375, height: 812 },
    userAgent: ARKWEB_UA,
    // 移动端 touch 事件
    hasTouch: true,
    // 设备像素比 (逼近鸿蒙手机)
    deviceScaleFactor: 3,
    // 失败保留 trace / screenshot / video
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 30 * 1000,
    navigationTimeout: 30 * 1000,
    // locale 中文 (与鸿蒙系统默认一致)
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  },

  // 单 project: chromium (移动模拟). 不跑 firefox/webkit (ArkWeb 基于 Chromium 内核)
  projects: [
    {
      name: 'arkweb-chromium',
      use: {
        ...devices['Desktop Chrome'],
        // 覆盖 Desktop Chrome 的桌面 viewport, 用移动 viewport
        viewport: { width: 375, height: 812 },
        userAgent: ARKWEB_UA,
        hasTouch: true,
        deviceScaleFactor: 3,
      },
    },
  ],

  // dev server (vite.config.ts server.port = 3001)
  // 不用 preview (harmony build 输出到 rawfile, 不是 dist/), dev server 跑同一份前端代码.
  webServer: {
    command: 'npm run dev',
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120 * 1000,
    stdout: 'pipe',
    stderr: 'pipe',
  },

  // HTML + JSON + list 三 reporter
  reporter: [
    ['html', { outputFolder: 'playwright-report-harmony', open: 'never' }],
    ['json', { outputFile: 'playwright-report-harmony/results.json' }],
    ['list'],
  ],

  timeout: 30 * 1000,
  expect: {
    timeout: 5 * 1000,
  },

  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  outputDir: 'test-results-harmony/',
});
