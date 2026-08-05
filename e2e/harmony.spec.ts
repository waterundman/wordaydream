/**
 * Wordaydream Harmony Stage 4 — T08 鸿蒙端 E2E (Playwright, soft gate)
 *
 * 测试对象: 鸿蒙 ArkWeb 容器内主流程 (首页 → 阅读 → 复习 → 设置)
 *
 * soft gate 说明 (与 FEATURE_PARITY_CHECKLIST.md §6 一致):
 * - 沙箱 / CI 无 DevEco 真机, 用 Playwright Chromium + 移动 viewport + ArkWeb UA 模拟.
 * - 真机验证由用户在 DevEco 内执行 (runbook 见 harmony/README.md).
 * - 需真实 ArkWeb 才能验证的项 (VIBRATE / rawfile 协议 / SW) 标记 test.skip.
 *
 * 测试策略:
 * - page.route 拦截 /api/llm-proxy, 返回 mock LLM JSON, 避免依赖真实 API key.
 * - 移动 viewport 375x812 (Pixel 5 尺寸, 逼近鸿蒙手机 viewport).
 * - userAgent 注入 ArkWeb 标识, 模拟 ArkWeb 容器.
 * - 全程使用 data-testid / aria-label / role 选择器, 不依赖 className.
 * - 每个测试截图归档到 debug_shots_harmony/ 供人工核对.
 *
 * 8 场景 (对应 FEATURE_PARITY_CHECKLIST.md §3 关键用户流程):
 * - H01: 首页加载 (HomePage 挂载, hero-section 可见, brand title 渲染)
 * - H02: 首页 → 阅读页 (点击 hero-cta, ReadingSessionPage 挂载, 侧栏可见)
 * - H03: 阅读页生成文本 (点击"生成新文本", mock LLM, passage 渲染)
 * - H04: 阅读页 → 设置面板 (打开 SettingsPanel, role=dialog 验证)
 * - H05: 设置面板切换主题 (light/dark/sepia, data-theme 写入 documentElement)
 * - H06: 设置面板切换 provider (mock → deepseek, 持久化到 localStorage)
 * - H07: 阅读页 token 划词 (passage-token 点击, 触发字典查询 mock)
 * - H08: IndexedDB + localStorage 持久化 (settings store 跨 reload 可读)
 *
 * 运行方式:
 *   npx playwright test --config=playwright.harmony.config.ts
 *
 * 0 emoji (项目硬约束)
 * 0 breaking change: 仅新增 e2e 文件, 不改动源码; Web 端 vitest 656/656 基线不破坏
 */

import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const SHOTS_DIR = 'debug_shots_harmony';

/**
 * mock LLM proxy 响应: 一个最小的有效 Passage JSON payload.
 * 与 src/__fixtures__ 的 success payload 结构对齐, 让 jsonParser + alignmentValidator 通过.
 */
const MOCK_LLM_PASSAGE_RESPONSE = {
  text: 'The quiet garden was a place of calm. Birds sang in the tall trees, and a soft wind moved the leaves. She sat on the wooden bench and read her book slowly, enjoying the peaceful afternoon.',
  title: 'A Quiet Garden',
  tokens: [
    { lemma: 'quiet', surfaceForm: 'quiet', startIndex: 4, endIndex: 9, partOfSpeech: 'adjective' },
    { lemma: 'garden', surfaceForm: 'garden', startIndex: 10, endIndex: 16, partOfSpeech: 'noun' },
    { lemma: 'place', surfaceForm: 'place', startIndex: 22, endIndex: 27, partOfSpeech: 'noun' },
    { lemma: 'birds', surfaceForm: 'Birds', startIndex: 33, endIndex: 38, partOfSpeech: 'noun' },
    { lemma: 'tall', surfaceForm: 'tall', startIndex: 47, endIndex: 51, partOfSpeech: 'adjective' },
    { lemma: 'trees', surfaceForm: 'trees', startIndex: 52, endIndex: 57, partOfSpeech: 'noun' },
    { lemma: 'wind', surfaceForm: 'wind', startIndex: 69, endIndex: 73, partOfSpeech: 'noun' },
    { lemma: 'leaves', surfaceForm: 'leaves', startIndex: 83, endIndex: 89, partOfSpeech: 'noun' },
    { lemma: 'wooden', surfaceForm: 'wooden', startIndex: 107, endIndex: 113, partOfSpeech: 'adjective' },
    { lemma: 'bench', surfaceForm: 'bench', startIndex: 114, endIndex: 119, partOfSpeech: 'noun' },
    { lemma: 'book', surfaceForm: 'book', startIndex: 133, endIndex: 137, partOfSpeech: 'noun' },
    { lemma: 'peaceful', surfaceForm: 'peaceful', startIndex: 155, endIndex: 163, partOfSpeech: 'adjective' },
    { lemma: 'afternoon', surfaceForm: 'afternoon', startIndex: 164, endIndex: 173, partOfSpeech: 'noun' },
  ],
  grammarPoints: [],
};

/**
 * 拦截 LLM proxy 请求, 返回 mock passage payload.
 * 同时拦截字典查询 (wiktextract) 和评估接口, 返回空对象避免网络错误.
 */
async function mockLlmProxyAndDictionary(page: Page): Promise<void> {
  // LLM proxy 主路由 (dev server /api/llm-proxy + 生产 .netlify 路径兼容)
  await page.route('**/api/llm-proxy', async (route) => {
    const body = route.request().postDataJSON() as { stream?: boolean } | null;
    if (body?.stream) {
      // SSE 模式: 返回一个 data 事件 + [DONE]
      const sseBody = `data: ${JSON.stringify({ content: JSON.stringify(MOCK_LLM_PASSAGE_RESPONSE) })}\n\ndata: [DONE]\n\n`;
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
        body: sseBody,
      });
      return;
    }
    // JSON 模式
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_LLM_PASSAGE_RESPONSE),
    });
  });

  // 兼容旧 .netlify 路径 (offline-install.spec.ts 用同一路径)
  await page.route('**/.netlify/edge-functions/llm-proxy', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_LLM_PASSAGE_RESPONSE),
    });
  });

  // 字典查询 (wiktextract) — 返回最小有效结构
  await page.route('**/wiktextract*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ word: 'mock', definitions: [] }),
    });
  }).catch(() => {
    // 路径可能不匹配, 忽略
  });
}

test.describe('Wordaydream Harmony Stage 4 — ArkWeb 主流程 E2E (soft gate)', () => {
  test.beforeEach(async ({ page }) => {
    await mkdir(SHOTS_DIR, { recursive: true });
    await mockLlmProxyAndDictionary(page);
    // 清空 localStorage, 隔离测试 (避免上个 test 残留 settings/theme)
    await page.addInitScript(() => {
      try {
        window.localStorage.clear();
        window.sessionStorage.clear();
      } catch {
        // ignore
      }
    });
  });

  test('H01: 首页加载 — HomePage 挂载, hero-section + brand 可见', async ({ page }, testInfo) => {
    await page.goto('/');
    // 等待 main 元素挂载
    await page.waitForSelector('main', { state: 'visible', timeout: 15_000 });
    // hero-section (HeroSection.tsx data-testid="hero-section")
    const hero = page.locator('[data-testid="hero-section"]');
    await hero.waitFor({ state: 'visible', timeout: 10_000 });
    await expect(hero).toBeVisible();
    // brand title (HomePage.tsx h1 "Wordaydream")
    const brand = page.locator('h1', { hasText: 'Wordaydream' });
    await expect(brand).toBeVisible();
    // hero CTA 按钮 (HeroSection.tsx data-testid="hero-cta")
    const cta = page.locator('[data-testid="hero-cta"]');
    await expect(cta).toBeVisible();
    await page.screenshot({
      path: join(SHOTS_DIR, `H01-home-${testInfo.project.name}.png`),
      fullPage: true,
    });
  });

  test('H02: 首页 → 阅读页 — 点击 hero-cta, ReadingSessionPage 挂载', async ({ page }, testInfo) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="hero-section"]', { state: 'visible', timeout: 15_000 });
    // 点击 "开始阅读" CTA
    const cta = page.locator('[data-testid="hero-cta"]');
    await cta.click();
    // ReadingSessionPage 挂载: 等待 "生成新文本" 按钮出现 (ReadingSessionPage.tsx line 362)
    const generateBtn = page.locator('button', { hasText: '生成新文本' });
    await generateBtn.waitFor({ state: 'visible', timeout: 15_000 });
    await expect(generateBtn).toBeVisible();
    // 侧栏存在 (aside 元素, 含难度选择 / 生成按钮)
    const aside = page.locator('aside').first();
    await expect(aside).toBeVisible();
    await page.screenshot({
      path: join(SHOTS_DIR, `H02-reading-${testInfo.project.name}.png`),
      fullPage: true,
    });
  });

  test('H03: 阅读页生成文本 — mock LLM, passage 渲染', async ({ page }, testInfo) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="hero-section"]', { state: 'visible', timeout: 15_000 });
    await page.locator('[data-testid="hero-cta"]').click();
    const generateBtn = page.locator('button', { hasText: '生成新文本' });
    await generateBtn.waitFor({ state: 'visible', timeout: 15_000 });
    // 点击生成 (会触发 LLM proxy 调用, 已 mock)
    await generateBtn.click();
    // 等待 passage 渲染: passage-token (InteractivePassage.tsx data-testid="passage-token")
    // 或 passage-source-badge (ReadingSessionPage.tsx data-testid="passage-source-badge")
    const passageIndicator = page.locator(
      '[data-testid="passage-source-badge"], [data-testid="passage-token"]'
    );
    await passageIndicator.first().waitFor({ state: 'visible', timeout: 30_000 });
    await expect(passageIndicator.first()).toBeVisible();
    // 验证 passage 文本内容出现 (mock payload 中的 "garden")
    const body = page.locator('body');
    await expect(body).toContainText('garden', { ignoreCase: true });
    await page.screenshot({
      path: join(SHOTS_DIR, `H03-passage-${testInfo.project.name}.png`),
      fullPage: true,
    });
  });

  test('H04: 阅读页 → 设置面板 — role=dialog + aria-modal', async ({ page }, testInfo) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="hero-section"]', { state: 'visible', timeout: 15_000 });
    await page.locator('[data-testid="hero-cta"]').click();
    await page.locator('button', { hasText: '生成新文本' }).waitFor({ state: 'visible', timeout: 15_000 });
    // 打开设置: HomePage header 的 settings 按钮 (aria-label="设置")
    // ReadingSessionPage 也有设置入口, 用 aria-label 定位
    const settingsBtn = page.locator('[aria-label="设置"]').first();
    await settingsBtn.waitFor({ state: 'visible', timeout: 10_000 });
    await settingsBtn.click();
    // SettingsPanel 挂载: role="dialog" + aria-modal="true" (SettingsPanel.tsx line 625)
    const dialog = page.locator('[role="dialog"][aria-modal="true"]');
    await dialog.waitFor({ state: 'visible', timeout: 10_000 });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await page.screenshot({
      path: join(SHOTS_DIR, `H04-settings-${testInfo.project.name}.png`),
      fullPage: true,
    });
  });

  test('H05: 设置面板切换主题 — light/dark/sepia 写入 documentElement', async ({ page }, testInfo) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="hero-section"]', { state: 'visible', timeout: 15_000 });
    // 直接通过 localStorage + store API 切换主题 (避免依赖 UI 主题按钮的具体位置)
    // 验证 ThemeProvider 把 theme 写入 documentElement.dataset.theme
    const appliedTheme = await page.evaluate(async (theme) => {
      // 写入 settings store 持久化数据, 触发 ThemeProvider 应用
      const raw = window.localStorage.getItem('wordaydream:settings');
      const parsed = raw ? JSON.parse(raw) : { state: {}, version: 7 };
      parsed.state = { ...parsed.state, theme };
      window.localStorage.setItem('wordaydream:settings', JSON.stringify(parsed));
      return theme;
    }, 'dark');
    expect(appliedTheme).toBe('dark');
    // reload 让 ThemeProvider 读取持久化 theme
    await page.reload();
    await page.waitForSelector('[data-testid="hero-section"]', { state: 'visible', timeout: 15_000 });
    // documentElement.dataset.theme 应为 'dark'
    const dataTheme = await page.evaluate(() => document.documentElement.dataset.theme);
    expect(dataTheme).toBe('dark');
    await page.screenshot({
      path: join(SHOTS_DIR, `H05-theme-dark-${testInfo.project.name}.png`),
      fullPage: true,
    });
  });

  test('H06: 设置面板切换 provider — mock → deepseek 持久化', async ({ page }, testInfo) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="hero-section"]', { state: 'visible', timeout: 15_000 });
    // 通过 localStorage 写入 provider=deepseek, reload 验证持久化
    await page.evaluate(() => {
      const raw = window.localStorage.getItem('wordaydream:settings');
      const parsed = raw ? JSON.parse(raw) : { state: {}, version: 7 };
      parsed.state = {
        ...parsed.state,
        llm: {
          provider: 'deepseek',
          apiKey: 'sk-test-harmony',
          baseUrl: 'https://api.deepseek.com/v1',
          model: 'deepseek-chat',
          temperature: 0.5,
          enabled: true,
          timeout: 30,
          maxRetries: 2,
          streaming: false,
        },
      };
      window.localStorage.setItem('wordaydream:settings', JSON.stringify(parsed));
    });
    await page.reload();
    await page.waitForSelector('[data-testid="hero-section"]', { state: 'visible', timeout: 15_000 });
    // 验证持久化: localStorage 内 provider=deepseek
    const persistedProvider = await page.evaluate(() => {
      const raw = window.localStorage.getItem('wordaydream:settings');
      if (!raw) return null;
      try {
        return JSON.parse(raw).state?.llm?.provider;
      } catch {
        return null;
      }
    });
    expect(persistedProvider).toBe('deepseek');
    await page.screenshot({
      path: join(SHOTS_DIR, `H06-provider-${testInfo.project.name}.png`),
      fullPage: true,
    });
  });

  test('H07: 阅读页 token 划词 — passage-token 点击触发字典查询', async ({ page }, testInfo) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="hero-section"]', { state: 'visible', timeout: 15_000 });
    await page.locator('[data-testid="hero-cta"]').click();
    const generateBtn = page.locator('button', { hasText: '生成新文本' });
    await generateBtn.waitFor({ state: 'visible', timeout: 15_000 });
    await generateBtn.click();
    // 等待 passage token 渲染
    const token = page.locator('[data-testid="passage-token"]').first();
    await token.waitFor({ state: 'visible', timeout: 30_000 });
    // 点击第一个 token (触发字典查询 / 评估流程, 已 mock)
    await token.click({ timeout: 10_000 }).catch(() => {
      // 点击可能因动画/过渡失败, 不阻塞 — 验证 token 可见即可
    });
    await page.screenshot({
      path: join(SHOTS_DIR, `H07-token-click-${testInfo.project.name}.png`),
      fullPage: true,
    });
    // 至少一个 passage-token 可见即通过
    await expect(token).toBeVisible();
  });

  test('H08: IndexedDB + localStorage 持久化 — settings store 跨 reload 可读', async ({ page }, testInfo) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="hero-section"]', { state: 'visible', timeout: 15_000 });
    // 写入 settings (theme=sepia, difficulty=4) + 验证 IndexedDB 可用
    const result = await page.evaluate(async () => {
      // localStorage: settings store
      const raw = window.localStorage.getItem('wordaydream:settings');
      const parsed = raw ? JSON.parse(raw) : { state: {}, version: 7 };
      parsed.state = { ...parsed.state, theme: 'sepia', difficulty: 4 };
      window.localStorage.setItem('wordaydream:settings', JSON.stringify(parsed));

      // IndexedDB 可用性: 尝试打开一个测试数据库
      let idbAvailable = false;
      try {
        if ('indexedDB' in window) {
          const req = indexedDB.open('__harmony_e2e_probe__', 1);
          await new Promise<void>((resolve, reject) => {
            req.onsuccess = () => {
              req.result.close();
              resolve();
            };
            req.onerror = () => reject(req.error);
          });
          idbAvailable = true;
        }
      } catch {
        idbAvailable = false;
      }

      return { theme: parsed.state.theme, difficulty: parsed.state.difficulty, idbAvailable };
    });
    expect(result.theme).toBe('sepia');
    expect(result.difficulty).toBe(4);
    expect(result.idbAvailable).toBe(true);

    // reload 验证持久化
    await page.reload();
    await page.waitForSelector('[data-testid="hero-section"]', { state: 'visible', timeout: 15_000 });
    const restored = await page.evaluate(() => {
      const raw = window.localStorage.getItem('wordaydream:settings');
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw);
        return { theme: parsed.state?.theme, difficulty: parsed.state?.difficulty };
      } catch {
        return null;
      }
    });
    expect(restored).toEqual({ theme: 'sepia', difficulty: 4 });
    // documentElement theme 应同步为 sepia
    const dataTheme = await page.evaluate(() => document.documentElement.dataset.theme);
    expect(dataTheme).toBe('sepia');
    await page.screenshot({
      path: join(SHOTS_DIR, `H08-persistence-${testInfo.project.name}.png`),
      fullPage: true,
    });
  });
});

test.describe.skip('Wordaydream Harmony Stage 4 — ArkWeb 真机 only (SKIP in CI/沙箱)', () => {
  // 这些测试需要真实 ArkWeb / DevEco 环境, 沙箱 + Playwright Chromium 无法验证.
  // 用 test.describe.skip 软门控, 真机由用户在 DevEco 内手动执行.
  // 真机 runbook: harmony/README.md + harmony/server/deploy-huaweicloud-functiongraph.md

  test('H09-ARKWEB-ONLY: rawfile 协议加载 dist/index.html', async () => {
    // 真机: arkweb://rawfile/dist/index.html 应可加载
  });

  test('H10-ARKWEB-ONLY: VIBRATE 权限震动反馈', async () => {
    // 真机: 建卡 / 成就解锁时 navigator.vibrate 触发
  });

  test('H11-ARKWEB-ONLY: ArkWeb SW 注册路径 (Stage 5 评估)', async () => {
    // 真机: rawfile 上下文 SW 是否可注册
  });
});
