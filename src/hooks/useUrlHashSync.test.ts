/**
 * v1.7.0 Stage 2: URL hash 同步 AppMode 状态机 单元测试
 *
 * 覆盖:
 * - T08: currentMode 变化 → window.location.hash 更新为 #/{mode}
 * - T09: hashchange 事件 → setMode(解析后的 mode)
 * - T10: 防循环 (mode→hash→mode 不振荡)
 * - T11: 初始加载从 hash 读取 mode (深链接)
 * - T12: 无效 hash → fallback 到默认 mode
 * - T13: 浏览器后退 → 恢复上一状态
 *
 * jsdom 环境: 手动 dispatch HashChangeEvent 模拟浏览器 hashchange.
 * 防循环验证: useAppModeStore.subscribe 计数 state 变化
 * (setMode 内部触发 setState -> listener; spy store.setState 无效因闭包绑定).
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUrlHashSync } from './useUrlHashSync';
import { useAppModeStore } from './useAppModeStore';

describe('v1.7.0 Stage 2: URL hash 同步', () => {
  beforeEach(() => {
    window.location.hash = '';
    useAppModeStore.setState({ currentMode: 'home' });
  });

  afterEach(() => {
    window.location.hash = '';
    useAppModeStore.setState({ currentMode: 'home' });
  });

  it('T08: currentMode 变化 → window.location.hash 更新为 #/{mode}', () => {
    renderHook(() => useUrlHashSync());
    act(() => {
      useAppModeStore.getState().setMode('reading');
    });
    expect(window.location.hash).toBe('#/reading');
  });

  it('T09: hashchange 事件 → setMode(解析后的 mode)', () => {
    renderHook(() => useUrlHashSync());
    act(() => {
      window.location.hash = '#/review';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(useAppModeStore.getState().currentMode).toBe('review');
  });

  it('T10: 防循环 (mode→hash→mode 不振荡)', () => {
    renderHook(() => useUrlHashSync());
    // 用 zustand subscribe 计数 state 变化 (setMode 内部触发 setState -> listener).
    // 注: vi.spyOn(useAppModeStore, 'setState') 无效, 因 zustand v5 setMode 闭包
    // 捕获原始 setState 引用, spy 修改 store.setState 属性不拦截闭包内 set.
    // subscribe 监听全局 state 变化, setMode 必触发 listener, 可靠反映调用次数.
    let stateChangeCount = 0;
    const unsubscribe = useAppModeStore.subscribe(() => {
      stateChangeCount++;
    });
    act(() => {
      useAppModeStore.getState().setMode('reading');
    });
    expect(window.location.hash).toBe('#/reading');
    const countAfterSetMode = stateChangeCount;
    // 模拟 setMode 间接触发的 hashchange 事件
    act(() => {
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    // 防循环: hashchange handler 检查 mode === currentMode, 相同则 return,
    // 不再调用 setMode, stateChangeCount 不增加
    expect(stateChangeCount).toBe(countAfterSetMode);
    unsubscribe();
  });

  it('T11: 初始加载从 hash 读取 mode (深链接)', () => {
    window.location.hash = '#/wordlist';
    renderHook(() => useUrlHashSync());
    expect(useAppModeStore.getState().currentMode).toBe('wordlist');
  });

  it('T12: 无效 hash → fallback 到默认 mode', () => {
    window.location.hash = '#/invalidmode';
    renderHook(() => useUrlHashSync());
    // 无效 mode 不改变, 保持默认 home
    expect(useAppModeStore.getState().currentMode).toBe('home');
  });

  it('T13: 浏览器后退 → 恢复上一状态', () => {
    renderHook(() => useUrlHashSync());
    act(() => {
      useAppModeStore.getState().setMode('reading');
    });
    expect(window.location.hash).toBe('#/reading');
    act(() => {
      useAppModeStore.getState().setMode('review');
    });
    expect(window.location.hash).toBe('#/review');
    // 模拟浏览器后退 (history.back 触发 hashchange, hash 回到上一值)
    act(() => {
      window.location.hash = '#/reading';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(useAppModeStore.getState().currentMode).toBe('reading');
  });
});
