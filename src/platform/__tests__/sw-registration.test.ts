/**
 * T05: registerServiceWorker 鸿蒙降级测试 (v0.1.0-harmony Stage 2)
 *
 * 验证: supportsServiceWorker=false 时不调用 import('virtual:pwa-register').
 *
 * Mock 策略:
 * - vi.mock('../detect') → detectPlatform 返回 supportsServiceWorker=false
 * - vi.mock('virtual:pwa-register') → 提供 registerSW spy
 * - 调用 registerServiceWorker(), 断言 registerSW spy 未被调用
 *
 * registerServiceWorker 内部短路顺序:
 *   supportsServiceWorker() → 'serviceWorker' in navigator → import.meta.env.PROD
 * supportsServiceWorker=false 时第一个守卫即返回, 后续检查不执行.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const registerSWMock = vi.fn();

// Mock virtual:pwa-register (vitest 不加载 vite-plugin-pwa, 需手动提供)
vi.mock('virtual:pwa-register', () => ({
  registerSW: registerSWMock,
}));

// Mock detectPlatform: 鸿蒙环境, supportsServiceWorker=false
vi.mock('../detect', () => ({
  detectPlatform: () => ({
    isHarmonyOS: () => true,
    supportsServiceWorker: () => false,
    supportsSpeechSynthesis: () => false,
    supportsInstallPrompt: () => false,
    getNativeBridge: () => null,
  }),
}));

import { registerServiceWorker } from '../swRegistration';

describe('T05 [critical]: registerServiceWorker 鸿蒙降级', () => {
  afterEach(() => {
    registerSWMock.mockClear();
  });

  it('supportsServiceWorker=false → 不调用 registerSW', async () => {
    await registerServiceWorker();
    expect(registerSWMock).not.toHaveBeenCalled();
  });

  it('supportsServiceWorker=false → registerServiceWorker 不抛错', async () => {
    await expect(registerServiceWorker()).resolves.toBeUndefined();
  });
});
