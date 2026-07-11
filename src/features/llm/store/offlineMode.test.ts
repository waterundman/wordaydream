/**
 * useOfflineModeStore 单元测试 (v1.4.1 Stage 2 — T01..T05)
 *
 * 覆盖 SPEC 要求 5 个 case:
 * - T01: 初始状态 - isOffline=false, lastOnlineAt=null, lastOfflineAt=null, cachedProvider=null
 * - T02: setOffline(true) - isOffline=true, lastOfflineAt 设置, 派发 'offline-mode' banner
 * - T03: setOffline(false) - isOffline=false, lastOnlineAt 设置, dismiss banner
 * - T04: recordProviderWhenOffline - 记录当前 provider (支持 normalize 非法值)
 * - T05: reset - 清空所有状态 + dismiss banner
 *
 * 设计:
 * - 使用真实 useOfflineModeStore, 验证状态机 + persist 行为
 * - 直接调 store.getState() 而不渲染组件 (性能 + 隔离)
 * - useToastStore 在每个 case 前后清空, 避免持久化 banner 跨 case 泄漏
 * - 用 vi.spyOn 跟踪 showNotification / dismissNotification 调用
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useOfflineModeStore,
  OFFLINE_MODE_NOTIFICATION_KEY,
  OFFLINE_MODE_NOTIFICATION_MESSAGE,
} from './offlineMode';
import { useToastStore } from '../../../store/useToastStore';

beforeEach(() => {
  if (typeof window !== 'undefined') {
    window.localStorage.clear();
  }
  useToastStore.setState({ notifications: {} });
  useOfflineModeStore.setState({
    isOffline: false,
    lastOnlineAt: null,
    lastOfflineAt: null,
    cachedProvider: null,
    installPromptEvent: null,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useOfflineModeStore (Stage 2 T01..T05)', () => {
  it('T01: 初始状态 - isOffline=false, lastOnlineAt=null, lastOfflineAt=null, cachedProvider=null', () => {
    const s = useOfflineModeStore.getState();
    expect(s.isOffline).toBe(false);
    expect(s.lastOnlineAt).toBeNull();
    expect(s.lastOfflineAt).toBeNull();
    expect(s.cachedProvider).toBeNull();
  });

  it('T02: setOffline(true) - isOffline=true, lastOfflineAt 设置, 派发 offline-mode banner', () => {
    const showSpy = vi.spyOn(useToastStore.getState(), 'showNotification');
    const before = Date.now();
    useOfflineModeStore.getState().setOffline(true);
    const after = Date.now();

    const s = useOfflineModeStore.getState();
    expect(s.isOffline).toBe(true);
    expect(s.lastOfflineAt).not.toBeNull();
    expect(s.lastOfflineAt!).toBeGreaterThanOrEqual(before);
    expect(s.lastOfflineAt!).toBeLessThanOrEqual(after);
    expect(showSpy).toHaveBeenCalledWith(
      OFFLINE_MODE_NOTIFICATION_KEY,
      OFFLINE_MODE_NOTIFICATION_MESSAGE,
    );
  });

  it('T03: setOffline(false) - isOffline=false, lastOnlineAt 设置, dismiss offline-mode banner', () => {
    // 先制造一个已离线的状态
    useOfflineModeStore.setState({ isOffline: true, lastOfflineAt: 1000 });
    useToastStore
      .getState()
      .showNotification(OFFLINE_MODE_NOTIFICATION_KEY, OFFLINE_MODE_NOTIFICATION_MESSAGE);

    const dismissSpy = vi.spyOn(useToastStore.getState(), 'dismissNotification');
    const before = Date.now();
    useOfflineModeStore.getState().setOffline(false);
    const after = Date.now();

    const s = useOfflineModeStore.getState();
    expect(s.isOffline).toBe(false);
    expect(s.lastOnlineAt).not.toBeNull();
    expect(s.lastOnlineAt!).toBeGreaterThanOrEqual(before);
    expect(s.lastOnlineAt!).toBeLessThanOrEqual(after);
    expect(dismissSpy).toHaveBeenCalledWith(OFFLINE_MODE_NOTIFICATION_KEY);
  });

  it('T04: recordProviderWhenOffline - 记录 provider, 非法值 normalize 到 null', () => {
    useOfflineModeStore.getState().recordProviderWhenOffline('openai');
    expect(useOfflineModeStore.getState().cachedProvider).toBe('openai');

    useOfflineModeStore.getState().recordProviderWhenOffline('deepseek');
    expect(useOfflineModeStore.getState().cachedProvider).toBe('deepseek');

    // 非法 provider 归一为 null (避免注入无效字符串污染 store)
    useOfflineModeStore.getState().recordProviderWhenOffline('unknown-provider');
    expect(useOfflineModeStore.getState().cachedProvider).toBeNull();
  });

  it('T05: reset - 清空所有状态, dismiss offline-mode banner', () => {
    useOfflineModeStore.setState({
      isOffline: true,
      lastOfflineAt: 1234,
      lastOnlineAt: 5678,
      cachedProvider: 'openai',
    });
    useToastStore
      .getState()
      .showNotification(OFFLINE_MODE_NOTIFICATION_KEY, OFFLINE_MODE_NOTIFICATION_MESSAGE);

    const dismissSpy = vi.spyOn(useToastStore.getState(), 'dismissNotification');
    useOfflineModeStore.getState().reset();

    const s = useOfflineModeStore.getState();
    expect(s.isOffline).toBe(false);
    expect(s.lastOnlineAt).toBeNull();
    expect(s.lastOfflineAt).toBeNull();
    expect(s.cachedProvider).toBeNull();
    expect(dismissSpy).toHaveBeenCalledWith(OFFLINE_MODE_NOTIFICATION_KEY);
  });
});
