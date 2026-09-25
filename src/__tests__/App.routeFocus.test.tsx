/**
 * App 路由焦点管理 (v1.6.1 Stage 4, D4)
 *
 * 覆盖 SPEC §6.1 `App.routeFocus.test.tsx` (3 测试):
 * - T01 [critical]: 键盘交互后切页 → 焦点迁移到新页容器 (读屏可播报)
 * - T02 [critical]: 鼠标交互后切页 → 焦点**不**迁移 (不抢鼠标用户的焦点)
 * - T03 [critical]: 焦点容器是 tabIndex={-1}, aria-label 随 appMode 变化
 *
 * 背景: 原实现切页后完全不管焦点 —— 焦点落回 <body>, 读屏不播报新页面,
 * 键盘用户的下一次 Tab 从文档开头重新开始。
 *
 * 测试策略: 用 useAppModeStore.setState 直接切 mode (模拟"切页完成"这一时刻),
 * 从而把断言聚焦在焦点策略本身, 而不受导航动画/懒加载时序影响。
 * 交互模态用真实的 keydown / pointerdown 事件建立。
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, act, cleanup, waitFor, fireEvent } from '@testing-library/react';
import App from '../App';
import { useAppModeStore } from '../hooks/useAppModeStore';

beforeAll(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
});

function routeContainer(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-route-container]');
}

beforeEach(() => {
  useAppModeStore.setState({ currentMode: 'home', previousMode: null });
  if (typeof window !== 'undefined') window.localStorage.clear();
  // jsdom 的 window.location 与 localStorage 一样是**跨用例共享**的模块级状态。
  // T01 的 setMode('reading') 会经 useUrlHashSync 把 hash 写成 '#/reading'; 若不清理,
  // 后续用例挂载时 useUrlHashSync 的"初始深链接"分支会依据残留 hash 再次
  // setMode('reading'), 于是被渲染的是阅读页, 首页的 hero-cta 永远找不到
  // (表现为 findByTestId 15s 超时, 极易被误读成焦点逻辑有 bug)。
  // 用 replaceState 而非 `location.hash = ''`: 后者会触发 hashchange, 又绕回 store。
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  cleanup();
});

describe('App 路由焦点管理 (v1.6.1 Stage 4 D4)', () => {
  it('T01 [critical]: 键盘交互后切页 → 焦点迁移到新页容器', async () => {
    render(<App />);
    await screen.findByTestId('hero-cta', {}, { timeout: 15_000 });

    // 建立"最近一次交互来自键盘"的模态
    fireEvent.keyDown(window, { key: 'Enter' });

    await act(async () => {
      useAppModeStore.getState().setMode('reading');
    });

    await waitFor(() => {
      const container = routeContainer();
      expect(container).not.toBeNull();
      expect(document.activeElement).toBe(container);
    });
    expect(routeContainer()!.getAttribute('aria-label')).toBe('阅读');
  });

  it('T02 [critical]: 鼠标交互后切页 → 焦点不被抢走', async () => {
    render(<App />);
    await screen.findByTestId('hero-cta', {}, { timeout: 15_000 });

    // 建立"最近一次交互来自指针"的模态
    fireEvent.pointerDown(document.body);

    await act(async () => {
      useAppModeStore.getState().setMode('reading');
    });

    // 给焦点 effect 一个执行窗口, 再确认它确实没有动作
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    // 先钉住"容器确实在" —— 否则若此刻容器被 Suspense 卸载, 下面的
    // `activeElement !== routeContainer()` 会平凡通过 (null !== body), 测试失去判别力。
    const container = routeContainer();
    expect(container, '切页完成后路由容器应已挂载').not.toBeNull();

    expect(
      document.activeElement,
      '鼠标用户切页后不应被强行移动焦点',
    ).not.toBe(container);
  });

  it('T03 [critical]: 容器 tabIndex=-1, aria-label 随 appMode 变化', async () => {
    render(<App />);
    await screen.findByTestId('hero-cta', {}, { timeout: 15_000 });

    expect(routeContainer()!.getAttribute('tabindex')).toBe('-1');
    expect(routeContainer()!.getAttribute('aria-label')).toBe('主页');

    await act(async () => {
      useAppModeStore.getState().setMode('wordlist');
    });

    await waitFor(() => {
      expect(routeContainer()!.getAttribute('aria-label')).toBe('词表');
    });
    // 同一个容器实例被复用 (不是每页新建), tabIndex 保持 -1
    expect(routeContainer()!.getAttribute('tabindex')).toBe('-1');
  });
});
