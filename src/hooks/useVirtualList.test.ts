/**
 * useVirtualList hook 单元测试 (v0.4.0-harmony Stage 1 D1)
 *
 * 覆盖 test_spec:
 * - T01: 初始渲染 (scrollTop=0) — visibleItems 从 index 0 开始, 含 overscan 项
 * - T02: 滚动 scrollTop=440 (10 项) — startIndex 跳到 5, visibleItems 含 [5, 10+overscan)
 * - T03: overscan=0 时 — visibleItems 严格等于可见范围, 不多渲染
 * - T04: totalHeight = items.length * itemHeight
 * - T05: getItemStyle(index) — position: absolute + transform: translateY(index * itemHeight)
 * - T06: items 为空数组 — visibleItems=[], totalHeight=0, startIndex=0
 * - T07: 滚动到末尾 — endIndex 不越界 (<= items.length)
 * - T08: containerProps.onScroll 触发后 — visibleItems 范围更新
 * - T09: 默认 overscan=5 (不传 overscan 参数)
 * - T10: containerProps.style 含 overflowY: auto + height: 100%
 *
 * jsdom 兼容:
 * - ResizeObserver 不存在 → useEffect 内 early return, 不报错.
 * - container.clientHeight 通过 Object.defineProperty mock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVirtualList } from './useVirtualList';

// 测试用 item 类型
interface Item {
  id: string;
}

function makeItems(count: number): Item[] {
  return Array.from({ length: count }, (_, i) => ({ id: `item-${i}` }));
}

/**
 * 工具: 创建一个 ref + 模拟 container 的 clientHeight + scrollTop.
 *
 * useVirtualList 通过 containerRef.current.clientHeight 读取容器高度,
 * 通过 onScroll 事件 currentTarget.scrollTop 读取滚动位置.
 *
 * jsdom 默认 clientHeight=0 + scrollTop=0, 用 Object.defineProperty mock.
 */
function createContainerMock(initialClientHeight: number = 0): {
  ref: React.MutableRefObject<HTMLDivElement | null>;
  setClientHeight: (h: number) => void;
  setScrollTop: (top: number) => void;
  el: HTMLDivElement;
} {
  const el = document.createElement('div');
  let mockClientHeight = initialClientHeight;
  let mockScrollTop = 0;
  Object.defineProperty(el, 'clientHeight', {
    configurable: true,
    get(): number {
      return mockClientHeight;
    },
    set(v: number) {
      mockClientHeight = v;
    },
  });
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get(): number {
      return mockScrollTop;
    },
    set(v: number) {
      mockScrollTop = v;
    },
  });
  return {
    ref: { current: el },
    setClientHeight: (h: number) => {
      mockClientHeight = h;
    },
    setScrollTop: (top: number) => {
      mockScrollTop = top;
    },
    el,
  };
}

/** 触发 onScroll 回调: 模拟用户滚动. */
function fireScroll(
  onScroll: (e: { currentTarget: HTMLElement }) => void,
  el: HTMLElement,
): void {
  onScroll({ currentTarget: el });
}

describe('useVirtualList (v0.4.0-harmony Stage 1 D1)', () => {
  beforeEach(() => {
    // jsdom 无 ResizeObserver, 确保 undefined (useEffect 内 early return)
    if (typeof global.ResizeObserver !== 'undefined') {
      delete (global as { ResizeObserver?: unknown }).ResizeObserver;
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('T01: 初始渲染 — visibleItems 从 index 0 开始, 含 overscan 项', () => {
    const items = makeItems(100);
    const { ref, setClientHeight } = createContainerMock(0);
    setClientHeight(440); // 10 项可见 (10 * 44 = 440)

    const { result } = renderHook(() =>
      useVirtualList({
        items,
        itemHeight: 44,
        containerRef: ref,
        overscan: 5,
      }),
    );

    // 初始 scrollTop=0, containerHeight=440 (effect 读取 clientHeight=440 后 setState)
    // startIndex = Math.max(0, Math.floor(0 / 44) - 5) = Math.max(0, -5) = 0
    expect(result.current.startIndex).toBe(0);
    // endIndex = Math.min(100, Math.ceil((0 + 440) / 44) + 5) = Math.min(100, 10 + 5) = 15
    expect(result.current.endIndex).toBe(15);
    // visibleItems = items.slice(0, 15) — 15 项
    expect(result.current.visibleItems).toHaveLength(15);
    expect(result.current.visibleItems[0]).toEqual({ item: items[0], index: 0 });
    expect(result.current.visibleItems[14]).toEqual({ item: items[14], index: 14 });
    // totalHeight = 100 * 44 = 4400
    expect(result.current.totalHeight).toBe(4400);
  });

  it('T02: 滚动 scrollTop=440 (10 项) — startIndex 跳到 5, visibleItems 含 [5, 10+overscan)', () => {
    const items = makeItems(100);
    const { ref, setClientHeight, setScrollTop, el } = createContainerMock(440);
    setClientHeight(440);

    const { result } = renderHook(() =>
      useVirtualList({
        items,
        itemHeight: 44,
        containerRef: ref,
        overscan: 5,
      }),
    );

    // 模拟用户滚动到 scrollTop=440 (第 10 项位置)
    setScrollTop(440);
    act(() => {
      fireScroll(result.current.containerProps.onScroll, el);
    });

    // startIndex = Math.max(0, Math.floor(440 / 44) - 5) = Math.max(0, 10 - 5) = 5
    expect(result.current.startIndex).toBe(5);
    // endIndex = Math.min(100, Math.ceil((440 + 440) / 44) + 5) = Math.min(100, 20 + 5) = 25
    expect(result.current.endIndex).toBe(25);
    // visibleItems = items.slice(5, 25) — 20 项
    expect(result.current.visibleItems).toHaveLength(20);
    expect(result.current.visibleItems[0]).toEqual({ item: items[5], index: 5 });
    expect(result.current.visibleItems[19]).toEqual({ item: items[24], index: 24 });
  });

  it('T03: overscan=0 时 — visibleItems 严格等于可见范围, 不多渲染', () => {
    const items = makeItems(100);
    const { ref, setClientHeight, setScrollTop, el } = createContainerMock(440);
    setClientHeight(440);

    const { result } = renderHook(() =>
      useVirtualList({
        items,
        itemHeight: 44,
        containerRef: ref,
        overscan: 0,
      }),
    );

    // 初始 scrollTop=0, overscan=0
    // startIndex = Math.max(0, 0 - 0) = 0
    // endIndex = Math.min(100, Math.ceil((0 + 440) / 44) + 0) = Math.min(100, 10) = 10
    expect(result.current.startIndex).toBe(0);
    expect(result.current.endIndex).toBe(10);
    expect(result.current.visibleItems).toHaveLength(10);
    expect(result.current.visibleItems[0]).toEqual({ item: items[0], index: 0 });
    expect(result.current.visibleItems[9]).toEqual({ item: items[9], index: 9 });

    // 滚动到 scrollTop=220 (第 5 项位置)
    setScrollTop(220);
    act(() => {
      fireScroll(result.current.containerProps.onScroll, el);
    });

    // startIndex = Math.max(0, Math.floor(220 / 44) - 0) = Math.max(0, 5) = 5
    // endIndex = Math.min(100, Math.ceil((220 + 440) / 44) + 0) = Math.min(100, 15) = 15
    expect(result.current.startIndex).toBe(5);
    expect(result.current.endIndex).toBe(15);
    expect(result.current.visibleItems).toHaveLength(10);
    expect(result.current.visibleItems[0]).toEqual({ item: items[5], index: 5 });
    expect(result.current.visibleItems[9]).toEqual({ item: items[14], index: 14 });
  });

  it('T04: totalHeight = items.length * itemHeight', () => {
    const items = makeItems(50);
    const { ref } = createContainerMock(440);

    const { result } = renderHook(() =>
      useVirtualList({
        items,
        itemHeight: 44,
        containerRef: ref,
        overscan: 5,
      }),
    );

    expect(result.current.totalHeight).toBe(50 * 44);
    expect(result.current.totalHeight).toBe(2200);
  });

  it('T05: getItemStyle(index) — position: absolute + transform: translateY(index * itemHeight)', () => {
    const items = makeItems(10);
    const { ref } = createContainerMock(440);

    const { result } = renderHook(() =>
      useVirtualList({
        items,
        itemHeight: 44,
        containerRef: ref,
        overscan: 5,
      }),
    );

    const style0 = result.current.getItemStyle(0);
    expect(style0.position).toBe('absolute');
    expect(style0.height).toBe(44);
    expect(style0.transform).toBe('translateY(0px)');

    const style5 = result.current.getItemStyle(5);
    expect(style5.position).toBe('absolute');
    expect(style5.height).toBe(44);
    expect(style5.transform).toBe('translateY(220px)');

    const style9 = result.current.getItemStyle(9);
    expect(style9.position).toBe('absolute');
    expect(style9.height).toBe(44);
    expect(style9.transform).toBe('translateY(396px)');

    // 内层 spacer div 的 innerStyle: height = totalHeight, position: relative
    expect(result.current.innerStyle.height).toBe(10 * 44);
    expect(result.current.innerStyle.position).toBe('relative');
  });

  it('T06: items 为空数组 — visibleItems=[], totalHeight=0, startIndex=0', () => {
    const items: Item[] = [];
    const { ref } = createContainerMock(440);

    const { result } = renderHook(() =>
      useVirtualList({
        items,
        itemHeight: 44,
        containerRef: ref,
        overscan: 5,
      }),
    );

    expect(result.current.visibleItems).toEqual([]);
    expect(result.current.totalHeight).toBe(0);
    expect(result.current.startIndex).toBe(0);
    // endIndex = Math.min(0, Math.ceil((0 + 440) / 44) + 5) = 0
    expect(result.current.endIndex).toBe(0);
  });

  it('T07: 滚动到末尾 — startIndex/endIndex 不越界 (endIndex <= items.length)', () => {
    const items = makeItems(30);
    const { ref, setClientHeight, setScrollTop, el } = createContainerMock(440);
    setClientHeight(440);

    const { result } = renderHook(() =>
      useVirtualList({
        items,
        itemHeight: 44,
        containerRef: ref,
        overscan: 5,
      }),
    );

    // 滚动到末尾 (scrollTop = 30 * 44 - 440 = 880)
    setScrollTop(880);
    act(() => {
      fireScroll(result.current.containerProps.onScroll, el);
    });

    // startIndex = Math.max(0, Math.floor(880 / 44) - 5) = Math.max(0, 20 - 5) = 15
    expect(result.current.startIndex).toBe(15);
    // endIndex = Math.min(30, Math.ceil((880 + 440) / 44) + 5) = Math.min(30, 30 + 5) = 30
    expect(result.current.endIndex).toBe(30);
    expect(result.current.visibleItems).toHaveLength(15); // 30 - 15
    expect(result.current.visibleItems[0]).toEqual({ item: items[15], index: 15 });
    expect(result.current.visibleItems[14]).toEqual({ item: items[29], index: 29 });
    // 不越界
    expect(result.current.endIndex).toBeLessThanOrEqual(items.length);
  });

  it('T08: containerProps.onScroll 更新 scrollTop + containerHeight (fallback 读取 clientHeight)', () => {
    const items = makeItems(100);
    const { ref, setClientHeight, setScrollTop, el } = createContainerMock(440);
    setClientHeight(440);

    const { result } = renderHook(() =>
      useVirtualList({
        items,
        itemHeight: 44,
        containerRef: ref,
        overscan: 5,
      }),
    );

    // 初始验证: containerHeight=440 (effect 读取)
    // startIndex = 0, endIndex = 15
    expect(result.current.startIndex).toBe(0);
    expect(result.current.endIndex).toBe(15);

    // 模拟滚动: scrollTop=132, clientHeight=440
    setScrollTop(132);
    act(() => {
      fireScroll(result.current.containerProps.onScroll, el);
    });

    // startIndex = Math.max(0, Math.floor(132 / 44) - 5) = Math.max(0, 3 - 5) = 0
    expect(result.current.startIndex).toBe(0);
    // endIndex = Math.min(100, Math.ceil((132 + 440) / 44) + 5) = Math.min(100, 13 + 5) = 18
    expect(result.current.endIndex).toBe(18);
    expect(result.current.visibleItems).toHaveLength(18);
    expect(result.current.visibleItems[0]).toEqual({ item: items[0], index: 0 });
    expect(result.current.visibleItems[17]).toEqual({ item: items[17], index: 17 });
  });

  it('T09: 默认 overscan=5 (不传 overscan 参数)', () => {
    const items = makeItems(100);
    const { ref, setClientHeight, setScrollTop, el } = createContainerMock(440);
    setClientHeight(440);

    const { result } = renderHook(() =>
      useVirtualList({
        items,
        itemHeight: 44,
        containerRef: ref,
        // 不传 overscan, 用默认值 5
      }),
    );

    // 默认 overscan=5
    expect(result.current.startIndex).toBe(0); // Math.max(0, 0 - 5) = 0
    expect(result.current.endIndex).toBe(15); // Math.min(100, 10 + 5) = 15

    // 滚动后验证 overscan=5 生效
    setScrollTop(440);
    act(() => {
      fireScroll(result.current.containerProps.onScroll, el);
    });

    expect(result.current.startIndex).toBe(5);
    expect(result.current.endIndex).toBe(25);
  });

  it('T10: containerProps.style 含 overflowY: auto + height: 100%', () => {
    const items = makeItems(10);
    const { ref } = createContainerMock(440);

    const { result } = renderHook(() =>
      useVirtualList({
        items,
        itemHeight: 44,
        containerRef: ref,
        overscan: 5,
      }),
    );

    const style = result.current.containerProps.style;
    expect(style.overflowY).toBe('auto');
    expect(style.height).toBe('100%');
    expect(typeof result.current.containerProps.onScroll).toBe('function');
  });

  it('T11: items 变化 — visibleItems 跟随新 items 重新计算 (useMemo 依赖 items)', () => {
    const items1 = makeItems(20);
    const { ref, setClientHeight } = createContainerMock(440);
    setClientHeight(440);

    const { result, rerender } = renderHook(
      ({ items }: { items: Item[] }) =>
        useVirtualList({
          items,
          itemHeight: 44,
          containerRef: ref,
          overscan: 5,
        }),
      { initialProps: { items: items1 } },
    );

    // 初始: 20 项, startIndex=0, endIndex=15 (10 可见 + 5 overscan)
    expect(result.current.startIndex).toBe(0);
    expect(result.current.endIndex).toBe(15);
    expect(result.current.visibleItems).toHaveLength(15);
    expect(result.current.totalHeight).toBe(20 * 44);

    // 切换到 5 项 (少于 overscan+可见)
    const items2 = makeItems(5);
    rerender({ items: items2 });

    // startIndex=0, endIndex=Math.min(5, 15)=5, visibleItems=5 项
    expect(result.current.startIndex).toBe(0);
    expect(result.current.endIndex).toBe(5);
    expect(result.current.visibleItems).toHaveLength(5);
    expect(result.current.totalHeight).toBe(5 * 44);
    expect(result.current.visibleItems[0]).toEqual({ item: items2[0], index: 0 });
    expect(result.current.visibleItems[4]).toEqual({ item: items2[4], index: 4 });
  });
});
