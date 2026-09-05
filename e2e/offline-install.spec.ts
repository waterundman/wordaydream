/**
 * Wordaydream v2.4.0: 离线 + PWA install prompt E2E (重写)
 *
 * v2.4.0 fix: 重写整个 spec, 修复以下问题:
 * - 选择器与源码脱节: start-reading / settings-button / settings-panel /
 *   reading-session / generate-button / streaming-text / interactive-passage
 *   在源码中均不存在, 改用真实 data-testid + aria-label + 文本匹配.
 * - localStorage key 错误: 'wordaydream-settings' (连字符) 改为
 *   'wordaydream:settings' (冒号, 与 useSettingsStore 持久化 key 一致).
 * - mock LLM proxy 路径: 同时拦截 /api/llm-proxy (vite dev + 生产) 和
 *   /.netlify/edge-functions/llm-proxy (兼容旧路径), 与 harmony.spec.ts 对齐.
 *
 * 4 场景 (保留 v1.5.0 测试意图, 选择器全部校对):
 * - T01: 离线 banner 出现 + LLM proxy 不被调用 (router 短路到 mock)
 * - T02: PWA install prompt 捕获 + InstallPromptButton 在 SettingsPanel 内显示
 *        (v2.4.0 fix: SettingsPanel 仅在阅读页渲染, 路径改为 hero-cta -> 阅读页 -> 设置)
 * - T03: Service Worker 注册 (production build / preview 模式)
 * - T04: 生成文本 + passage 渲染 (v2.4.0 fix: provider=mock 时 router 本地短路,
 *        断言 demo 语料渲染 + proxy 0 调用, 原断言 mock proxy payload 'garden' 永远失败)
 *
 * 0 emoji (项目硬约束)
 */

import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const SHOTS_DIR = 'debug_shots_v151';

/**
 * mock LLM proxy 响应: 一个最小的有效 Passage JSON payload.
 * 与 e2e/harmony.spec.ts 的 MOCK_LLM_PASSAGE_RESPONSE 对齐.
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
 * 同时拦截字典查询, 返回空对象避免网络错误.
 * 与 e2e/harmony.spec.ts 的 mockLlmProxyAndDictionary 对齐.
 */
async function mockLlmProxyAndDictionary(page: Page): Promise<void> {
  // LLM proxy 主路由 (vite dev server /api/llm-proxy + 生产路径)
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

  // 兼容旧 .netlify 路径 (部分环境仍用此路径)
  await page.route('**/.netlify/edge-functions/llm-proxy', async (route) => {
    const body = route.request().postDataJSON() as { stream?: boolean } | null;
    if (body?.stream) {
      const sseBody = `data: ${JSON.stringify({ content: JSON.stringify(MOCK_LLM_PASSAGE_RESPONSE) })}\n\ndata: [DONE]\n\n`;
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
        body: sseBody,
      });
      return;
    }
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

test.describe('Wordaydream v2.4.0 PWA + offline E2E', () => {
  test.beforeEach(async ({ page }) => {
    await mkdir(SHOTS_DIR, { recursive: true });
    await mockLlmProxyAndDictionary(page);
    // v2.4.0 CI fix: 模拟 reduced-motion. webkit 下 hero-cta 的呼吸/发光持续动画
    // 导致 Playwright "waiting for element to be stable" 30s 超时 (CI 4 浏览器矩阵
    // 失败的直接原因); app 支持 prefers-reduced-motion 降级, 测试统一走该路径.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    // 清空 localStorage, 隔离测试
    await page.addInitScript(() => {
      try {
        window.localStorage.clear();
        window.sessionStorage.clear();
      } catch {
        // ignore
      }
    });
  });

  test('T01 [v1.5.0]: 离线模式 banner 出现 + router 短路 (不发 LLM proxy 请求)', async ({
    page,
    context,
  }, testInfo) => {
    // 统计 LLM proxy 调用次数 (离线模式下应为 0, router 短路到 mock)
    let llmProxyCallCount = 0;
    await page.route('**/api/llm-proxy', (route) => {
      llmProxyCallCount += 1;
      return route.fulfill({ status: 500, body: 'unexpected call in offline mode' });
    });
    await page.route('**/.netlify/edge-functions/llm-proxy', (route) => {
      llmProxyCallCount += 1;
      return route.fulfill({ status: 500, body: 'unexpected call in offline mode' });
    });

    await page.goto('/');
    await page.waitForSelector('[data-testid="hero-section"]', { state: 'visible', timeout: 15_000 });

    // 设置 offline
    await context.setOffline(true);
    await page.evaluate(() => {
      window.dispatchEvent(new Event('offline'));
    });

    // 验证 offline banner 出现 (OfflineBanner.tsx data-testid="offline-banner")
    const offlineBanner = page.locator('[data-testid="offline-banner"]');
    await offlineBanner.waitFor({ state: 'visible', timeout: 5_000 });
    await expect(offlineBanner).toBeVisible();

    // 验证 settings provider 未被改为 mock (持久化 key 是 wordaydream:settings, 冒号)
    const settingsProvider = await page.evaluate(() => {
      const raw = window.localStorage.getItem('wordaydream:settings');
      if (!raw) return null;
      try {
        return JSON.parse(raw).state?.llm?.provider;
      } catch {
        return null;
      }
    });
    // 默认 provider 可能是 undefined (未配置) 或用户设置的值, 不应为 'mock'
    expect(settingsProvider).not.toBe('mock');

    // 等待 1s 让任何潜在 LLM 调用完成
    await page.waitForTimeout(1_000);

    // 离线模式下, router 应短路到 mock, 不应触发任何 LLM proxy 请求
    expect(llmProxyCallCount).toBe(0);

    await page.screenshot({
      path: join(SHOTS_DIR, `T01-offline-banner-${testInfo.project.name}.png`),
      fullPage: true,
    });
  });

  test('T02 [v1.5.0]: PWA install prompt 捕获 + InstallPromptButton 显示', async ({
    page,
  }, testInfo) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="hero-section"]', { state: 'visible', timeout: 15_000 });

    // 模拟 beforeinstallprompt 事件 (app 在 main.tsx 挂载时注册监听, 任意页面派发均可捕获)
    await page.evaluate(() => {
      const event = new Event('beforeinstallprompt');
      const augmented = event as Event & {
        prompt: () => Promise<void>;
        userChoice: Promise<{ outcome: string }>;
      };
      augmented.prompt = async () => {};
      augmented.userChoice = Promise.resolve({ outcome: 'accepted' });
      window.dispatchEvent(event);
    });

    // v2.4.0 fix: SettingsPanel 仅在阅读页 (ReadingSessionPage) 渲染,
    // home 模式下 onOpenSettings 只写 settingsOpen 状态, 无消费者.
    // 正确路径: hero-cta 进入阅读页 -> 点阅读页的设置按钮.
    await page.locator('[data-testid="hero-cta"]').click();

    // 等待阅读页挂载 (此时 [aria-label="设置"] 只剩 ReadingSessionPage 一个匹配)
    const generateBtn = page.locator('button', { hasText: '生成新文本' });
    await generateBtn.waitFor({ state: 'visible', timeout: 15_000 });

    const settingsButton = page.locator('[aria-label="设置"]').first();
    await settingsButton.waitFor({ state: 'visible', timeout: 5_000 });
    await settingsButton.click();

    // SettingsPanel 挂载 (role="dialog" + aria-modal="true")
    const dialog = page.locator('[role="dialog"][aria-modal="true"]');
    await dialog.waitFor({ state: 'visible', timeout: 5_000 });

    // 验证 InstallPromptButton 显示 (InstallPromptButton.tsx data-testid="install-prompt-button")
    const installButton = page.locator('[data-testid="install-prompt-button"]');
    await installButton.waitFor({ state: 'visible', timeout: 5_000 });
    await expect(installButton).toBeVisible();

    await page.screenshot({
      path: join(SHOTS_DIR, `T02-install-prompt-${testInfo.project.name}.png`),
      fullPage: true,
    });
  });

  test('T03 [v1.5.0]: Service Worker 注册 (production build / preview 模式)', async ({
    page,
  }, testInfo) => {
    // dev 模式下 SW 不注册 (vite-plugin-pwa devOptions.enabled=false), 跳过
    const USE_DEV = process.env.E2E_USE_DEV === 'true';
    test.skip(USE_DEV, 'SW registration requires production build (preview mode)');

    await page.goto('/');
    await page.waitForSelector('[data-testid="hero-section"]', { state: 'visible', timeout: 15_000 });

    // production 模式下, navigator.serviceWorker.ready 应非 null
    const swRegistered = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return false;
      try {
        const reg = await navigator.serviceWorker.ready;
        return reg !== null && reg.active !== null;
      } catch {
        return false;
      }
    });
    expect(swRegistered).toBe(true);

    // 验证 SW scope + state
    if (swRegistered) {
      const swInfo = await page.evaluate(async () => {
        const reg = await navigator.serviceWorker.ready;
        return {
          scope: reg.scope,
          active: reg.active ? reg.active.state : null,
          scriptURL: reg.active ? reg.active.scriptURL : null,
        };
      });
      expect(swInfo.active).toBe('activated');
      expect(swInfo.scriptURL).toContain('/sw.js');
    }

    await page.screenshot({
      path: join(SHOTS_DIR, `T03-sw-registration-${testInfo.project.name}.png`),
      fullPage: true,
    });
  });

  test('T04 [v1.5.0]: 生成文本 + passage 渲染 (mock provider 本地短路, 验证渲染链路)', async ({
    page,
  }, testInfo) => {
    // v2.4.0 fix: CI/webServer 注入 VITE_LLM_PROVIDER=mock, router.ts 在 provider==='mock'
    // 时直接走本地 MockLLMProvider (短路), 根本不发起 /api/llm-proxy 请求.
    // 原 spec 假设请求会发到 proxy 并断言 mock payload 文本 'garden', 永远失败.
    // 新断言: passage 渲染 demo 语料 ('The Quiet Revolution') + proxy 调用数为 0.
    let llmProxyCallCount = 0;
    await page.route('**/api/llm-proxy', (route) => {
      llmProxyCallCount += 1;
      return route.fulfill({ status: 500, body: 'unexpected call with mock provider' });
    });
    await page.route('**/.netlify/edge-functions/llm-proxy', (route) => {
      llmProxyCallCount += 1;
      return route.fulfill({ status: 500, body: 'unexpected call with mock provider' });
    });

    await page.goto('/');
    await page.waitForSelector('[data-testid="hero-section"]', { state: 'visible', timeout: 15_000 });

    // 点击 hero CTA 进入阅读页 (HeroSection.tsx data-testid="hero-cta")
    await page.locator('[data-testid="hero-cta"]').click();

    // 等待 "生成新文本" 按钮出现
    const generateBtn = page.locator('button', { hasText: '生成新文本' });
    await generateBtn.waitFor({ state: 'visible', timeout: 15_000 });
    // v2.4.0 CI fix: mobile-chrome (393px 视口) 下按钮位于滚动容器视口外且
    // scrollIntoView 滚不动 (v0.4.0 移动布局), Playwright click (含 force) 的
    // 视口命中检查失败. dispatchEvent 直接派发 DOM click 绕过 —— 本测试验证
    // mock 短路渲染链路, 非视觉可达性.
    await generateBtn.dispatchEvent('click');

    // 等待 passage 渲染 (passage-source-badge 或 passage-token)
    const passageIndicator = page.locator(
      '[data-testid="passage-source-badge"], [data-testid="passage-token"]',
    );
    await passageIndicator.first().waitFor({ state: 'visible', timeout: 30_000 });
    await expect(passageIndicator.first()).toBeVisible();

    // 验证 passage 内容为 mock provider 的本地 demo 语料 (router 短路, 非 proxy payload)
    const body = page.locator('body');
    await expect(body).toContainText('revolution', { ignoreCase: true });

    // mock provider 短路: 全程不应有任何 LLM proxy 请求
    expect(llmProxyCallCount).toBe(0);

    await page.screenshot({
      path: join(SHOTS_DIR, `T04-streaming-typing-${testInfo.project.name}.png`),
      fullPage: true,
    });
  });
});
