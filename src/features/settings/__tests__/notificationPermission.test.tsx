/**
 * v0.5.0-harmony Stage 3 — T02 [critical]: 通知权限请求接线
 *
 * 验证 SettingsPanel NotificationsSection:
 * - 开启动作 (false -> true) 触发 requestNotificationPermission 恰 1 次
 *   (fire-and-forget, 不阻塞开关 UI)
 * - granted: 静默, 不显示提示
 * - denied: 显示系统设置引导提示 (data-testid="notification-permission-hint")
 * - 关闭动作不触发权限请求
 * - no-op (Web 无桥) 不显示提示
 *
 * Mock 策略:
 * - vi.mock platform/harmonyBridge (隔离原生桥, 只测接线行为)
 * - detectPlatform 保持真实路径 (模拟 ArkWeb userAgent + window.harmonyBridge,
 *   使 supportsNotifications() = true, 同现有 notifications.test.tsx T04 模式)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../../platform/harmonyBridge', () => ({
  requestNotificationPermission: vi.fn(),
}));

import { requestNotificationPermission } from '../../../platform/harmonyBridge';
import type { HarmonyBridge } from '../../../platform/harmonyBridge';
import { detectPlatform, _resetPlatformCache } from '../../../platform/detect';
import { useSettingsStore } from '../store/useSettingsStore';
import { NotificationsSection } from '../components/SettingsPanel';

type BridgeWindow = Window & { harmonyBridge?: HarmonyBridge };

const mockRequestPermission = vi.mocked(requestNotificationPermission);

const ARKWEB_UA =
  'Mozilla/5.0 (Phone; OpenHarmony 6.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36 ArkWeb/6.0.2';

function enableHarmonyEnvironment(): void {
  Object.defineProperty(navigator, 'userAgent', {
    value: ARKWEB_UA,
    configurable: true,
  });
  (window as BridgeWindow).harmonyBridge = {
    writePreferences: () => Promise.resolve(),
  } as unknown as HarmonyBridge;
}

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  vi.resetModules();
  _resetPlatformCache();
  useSettingsStore.getState().setNotifications({ enabled: false });
});

afterEach(() => {
  cleanup();
  _resetPlatformCache();
  Object.defineProperty(navigator, 'userAgent', {
    value: '',
    configurable: true,
  });
  const w = window as BridgeWindow;
  delete w.harmonyBridge;
});

describe('Stage 3 — T02 [critical]: notification permission wiring', () => {
  it('鸿蒙环境下 NotificationsSection 可见 (detectPlatform 真实路径)', () => {
    enableHarmonyEnvironment();
    expect(detectPlatform().supportsNotifications()).toBe(true);
    render(<NotificationsSection />);
    expect(screen.getByRole('switch', { name: 'Enable review reminders' })).toBeTruthy();
  });

  it('开启动作触发 requestNotificationPermission 恰 1 次; granted 静默无提示', async () => {
    enableHarmonyEnvironment();
    mockRequestPermission.mockResolvedValueOnce({ state: 'granted' });
    render(<NotificationsSection />);

    const toggle = screen.getByRole('switch', { name: 'Enable review reminders' });
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(mockRequestPermission).toHaveBeenCalledTimes(1);
    });
    // granted: 无提示
    await waitFor(() => {
      expect(screen.queryByTestId('notification-permission-hint')).toBeNull();
    });
  });

  it('denied 显示系统设置引导提示 (role=alert)', async () => {
    enableHarmonyEnvironment();
    mockRequestPermission.mockResolvedValueOnce({ state: 'denied' });
    render(<NotificationsSection />);

    fireEvent.click(screen.getByRole('switch', { name: 'Enable review reminders' }));

    await waitFor(() => {
      expect(mockRequestPermission).toHaveBeenCalledTimes(1);
    });
    const hint = await screen.findByTestId('notification-permission-hint');
    expect(hint.getAttribute('role')).toBe('alert');
    expect(hint.textContent).toContain('系统设置');
  });

  it('error 显示重试提示', async () => {
    enableHarmonyEnvironment();
    mockRequestPermission.mockResolvedValueOnce({ state: 'error', reason: 'boom' });
    render(<NotificationsSection />);

    fireEvent.click(screen.getByRole('switch', { name: 'Enable review reminders' }));

    const hint = await screen.findByTestId('notification-permission-hint');
    expect(hint.textContent).toContain('失败');
  });

  it('关闭动作不触发权限请求', async () => {
    enableHarmonyEnvironment();
    useSettingsStore.getState().setNotifications({ enabled: true });
    render(<NotificationsSection />);

    fireEvent.click(screen.getByRole('switch', { name: 'Enable review reminders' }));

    // 关闭: enabled true -> false, 不请求权限
    await new Promise((r) => setTimeout(r, 20));
    expect(mockRequestPermission).not.toHaveBeenCalled();
  });

  it('Web 无桥 no-op (noop:true) 不显示提示', async () => {
    mockRequestPermission.mockResolvedValueOnce({ state: 'granted', noop: true });
    render(<NotificationsSection />);
    expect(screen.queryByRole('switch')).toBeNull();
    expect(mockRequestPermission).not.toHaveBeenCalled();
  });
});
