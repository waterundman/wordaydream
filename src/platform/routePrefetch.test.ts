/**
 * 路由 chunk 预取 (v1.6.1 Stage 4, P2-2)
 *
 * 覆盖 SPEC §6.1 `routePrefetch.test.ts` (3 测试):
 * - T01 [critical]: 空闲预取会按序调用对应 loader (串行), 且受 limit 限制
 * - T02 [critical]: 命中缓存 (已在途/已完成) 不重复 import
 * - T03 [critical]: 预取失败静默降级 (不抛出), 并允许后续重试
 *
 * 另外覆盖两条安全栅栏:
 * - saveData (省流量) 时不预取
 * - 意图预取 (pointerover / focusin 到 [data-prefetch-route]) 立即拉取
 *
 * v1.6.1 Stage 5 追加 (T07-T09): `createRouteComponent` 的三条语义 ——
 * 已预取同步渲染不闪 fallback / 未预取仍挂起 / 失败抛给 ErrorBoundary。
 *
 * 测试策略: 直接用 `createRoutePrefetcher` 注入假 loader —— 无需 mock 模块,
 * 也就能精确断言"调用了几次"。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Component, Suspense, createElement, type ReactNode } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import {
  createRouteComponent,
  createRoutePrefetcher,
  installIntentPrefetch,
  preloadRoute,
  ROUTE_LOADERS,
} from './routePrefetch';
import type { AppMode } from '../hooks/useAppModeStore';

/** 构造一个记录调用次数的假 loader 表。 */
function fakeLoaders(overrides: Partial<Record<AppMode, () => Promise<unknown>>> = {}) {
  const calls: AppMode[] = [];
  const base = {} as Record<AppMode, () => Promise<unknown>>;
  for (const mode of ['home', 'reading', 'review', 'wordlist', 'course'] as AppMode[]) {
    base[mode] = () => {
      calls.push(mode);
      return Promise.resolve({ default: () => null });
    };
  }
  Object.assign(base, overrides);
  return { loaders: base, calls };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('routePrefetch (v1.6.1 Stage 4)', () => {
  it('T01 [critical]: 空闲预取串行调用 loader, 且受 limit 限制', async () => {
    const { loaders, calls } = fakeLoaders();
    const prefetcher = createRoutePrefetcher(loaders, { isDisabled: () => false });

    prefetcher.schedulePrefetch(['reading', 'wordlist', 'course', 'review'], 3);

    // scheduleIdleTask 在无 requestIdleCallback 时降级为 setTimeout(0); 串行链需要多轮微任务
    await vi.waitFor(() => {
      expect(calls).toEqual(['reading', 'wordlist', 'course']);
    });
    // limit=3 → 第 4 个目标不预取
    expect(calls).not.toContain('review');
  });

  it('T02 [critical]: 命中缓存不重复 import (第二次调用 loader 仍只执行一次)', async () => {
    const { loaders, calls } = fakeLoaders();
    const prefetcher = createRoutePrefetcher(loaders, { isDisabled: () => false });

    await prefetcher.prefetchRoute('reading');
    await prefetcher.prefetchRoute('reading');
    // 并发调用同样应共享同一个在途 Promise
    await Promise.all([prefetcher.prefetchRoute('reading'), prefetcher.prefetchRoute('reading')]);

    expect(calls).toEqual(['reading']);
    expect(prefetcher.size()).toBe(1);
  });

  it('T03 [critical]: 预取失败静默降级 (不抛出), 且允许后续重试', async () => {
    let attempt = 0;
    const { loaders, calls } = fakeLoaders({
      reading: () => {
        attempt += 1;
        calls.push('reading');
        return attempt === 1 ? Promise.reject(new Error('chunk 404')) : Promise.resolve({});
      },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const prefetcher = createRoutePrefetcher(loaders, { isDisabled: () => false });

    // 首次失败: 必须 resolve (调用方不应看到 rejection)
    await expect(prefetcher.prefetchRoute('reading')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    // 失败后从在途表移除 → 允许重试
    expect(prefetcher.size()).toBe(0);

    await prefetcher.prefetchRoute('reading');
    expect(calls).toEqual(['reading', 'reading']);
  });

  it('T04: saveData (省流量) 时完全不做空闲预取', async () => {
    const { loaders, calls } = fakeLoaders();
    const prefetcher = createRoutePrefetcher(loaders, { isDisabled: () => true });

    prefetcher.schedulePrefetch(['reading', 'wordlist', 'course']);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls, '省流量模式不应发起任何预取').toEqual([]);
  });

  it('T05: 意图预取 —— hover / 键盘聚焦到 [data-prefetch-route] 元素时拉取对应 chunk', async () => {
    const { loaders, calls } = fakeLoaders();
    const prefetcher = createRoutePrefetcher(loaders, { isDisabled: () => false });

    const button = document.createElement('button');
    button.setAttribute('data-prefetch-route', 'wordlist');
    const inner = document.createElement('span');
    button.appendChild(inner);
    document.body.appendChild(button);

    const uninstall = installIntentPrefetch(prefetcher);
    try {
      // 指针悬停: 事件目标常是内层元素 → 依赖 closest() 向上找
      inner.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
      await vi.waitFor(() => expect(calls).toEqual(['wordlist']));

      // 键盘聚焦走 focusin
      button.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      await vi.waitFor(() => expect(prefetcher.size()).toBe(1));
      expect(calls, '已预取的路由不应被 focusin 重复拉取').toEqual(['wordlist']);
    } finally {
      uninstall();
      button.remove();
    }
  });

  it('T06: ROUTE_LOADERS 覆盖全部 5 个 AppMode (单层包裹后 lazy 与预取共用同一说明符)', () => {
    expect(Object.keys(ROUTE_LOADERS).sort()).toEqual(
      ['course', 'home', 'reading', 'review', 'wordlist'].sort(),
    );
    for (const loader of Object.values(ROUTE_LOADERS)) {
      expect(typeof loader).toBe('function');
    }
  });
});

/**
 * v1.6.1 Stage 5: `createRouteComponent` —— 预取感知的懒加载路由组件。
 *
 * 为什么必须有这三条 (根因见 routePrefetch.ts 的 createRouteComponent 注释):
 * `React.lazy` 首次渲染**必定挂起一次**, 即便模块已在注册表里 —— 它首次渲染时才调
 * 工厂, 拿到的是崭新的 import() promise。e2e T17 探针实测: chunk 已预取时
 * LoadingFallback 仍出现 1 次、可见约 54ms。
 *
 * 注意 jsdom 与真实浏览器的差别: 浏览器里 React 会在挂起后把控制权交回事件循环,
 * 因此 fallback 一定被提交; jsdom + `act` 有可能在一轮里就把重试跑完。
 * 所以 T07 断言的是**同步性** (render() 同步返回后就已经是真实内容), 浏览器侧的
 * "是否真的闪过" 由 e2e T17 的探针度量。
 */
describe('createRouteComponent (v1.6.1 Stage 5)', () => {
  afterEach(() => cleanup());

  const fallback = createElement('div', { 'data-testid': 'fb' }, '加载中');

  it('T07 [critical]: 模块已预取 → 首渲染同步完成, 不出现 fallback', async () => {
    const Warm = () => createElement('div', { 'data-testid': 'page' }, 'ok');
    const loader = () => Promise.resolve({ default: Warm });
    const Route = createRouteComponent(loader);

    await preloadRoute(loader); // 模拟"空闲/意图预取已完成"

    render(createElement(Suspense, { fallback }, createElement(Route)));

    // 判别性断言: 已就绪的模块必须**同步**渲染。若换回 React.lazy, 首次渲染会挂起,
    // 此处拿到的就是 fallback → 本断言失败。
    expect(screen.queryByTestId('fb'), '已预取的路由不应闪 fallback').toBeNull();
    expect(screen.getByTestId('page')).toBeInTheDocument();
  });

  it('T08 [critical]: 未预取 → 首渲染挂起, 模块落定后渲染真实内容 (Suspense 语义不变)', async () => {
    let settle: ((m: { default: () => ReturnType<typeof createElement> }) => void) | undefined;
    const Cold = () => createElement('div', { 'data-testid': 'page' }, 'cold');
    const loader = () =>
      new Promise<{ default: () => ReturnType<typeof createElement> }>((resolve) => {
        settle = resolve;
      });
    const Route = createRouteComponent(loader);

    render(createElement(Suspense, { fallback }, createElement(Route)));

    // 模块未落定 → 渲染 fallback (与 React.lazy 同构)
    expect(screen.getByTestId('fb')).toBeInTheDocument();

    await act(async () => {
      settle?.({ default: Cold });
    });

    expect(screen.getByTestId('page')).toBeInTheDocument();
    expect(screen.queryByTestId('fb')).toBeNull();
  });

  it('T09 [critical]: 加载失败 → 抛错交给 ErrorBoundary, 不无限挂起', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const boom = new Error('chunk down');
    const loader = () => Promise.reject(boom);
    const Route = createRouteComponent(loader);

    class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
      state = { failed: false };
      static getDerivedStateFromError(): { failed: boolean } {
        return { failed: true };
      }
      render(): ReactNode {
        return this.state.failed
          ? createElement('div', { 'data-testid': 'boundary' }, 'failed')
          : this.props.children;
      }
    }

    render(
      createElement(
        Boundary,
        null,
        createElement(Suspense, { fallback }, createElement(Route)),
      ),
    );

    // 若实现把失败吞掉或永久挂起, 这里会超时 —— 而不是落到 ErrorBoundary
    expect(await screen.findByTestId('boundary')).toBeInTheDocument();
    consoleError.mockRestore();
  });
});
