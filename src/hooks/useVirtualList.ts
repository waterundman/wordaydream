/**
 * useVirtualList (v0.4.0-harmony Stage 1 D1: 轻量虚拟滚动)
 *
 * 目标: 支撑 WordlistPage 3000 行滚动 60fps, 仅渲染可见区域 + overscan 的 DOM 节点.
 * 不引入 react-window 等依赖, 仅用 React hooks + transform: translateY (compositor 友好).
 *
 * 设计要点:
 * - itemHeight 固定 (WordlistPage 用 44px, 满足 WCAG 2.5.5 AAA 触摸目标).
 * - 用 useState 跟踪 scrollTop + containerHeight, useMemo 计算可见范围 [startIndex, endIndex].
 * - 总高度 = items.length * itemHeight, 用内层 spacer div 撑开滚动条.
 * - 可见项用 position: absolute + transform: translateY(index * itemHeight) 定位,
 *   避免触发 layout (仅 compositor 层 transform).
 * - overscan 默认 5, 向上/向下多渲染 5 项, 避免快速滚动时出现空白.
 *
 * jsdom 兼容: jsdom 无 layout, clientHeight=0. 此时 endIndex = overscan, 仍能渲染
 * 前 overscan 项, 满足单元测试需求 (WordlistPage 测试用 5 词 + overscan=5 → 全渲染).
 * 生产环境 ResizeObserver 不可用时, onScroll 内也会读取 clientHeight 作为 fallback.
 */
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type RefObject, type UIEvent } from 'react';

export interface UseVirtualListOptions<T> {
  /** 全量数据数组 (已过滤/搜索后的). */
  items: T[];
  /** 每项固定高度 (WordlistPage 用 44px, WCAG 2.5.5 AAA). */
  itemHeight: number;
  /** 外层滚动容器的 ref. hook 通过它读取 clientHeight. */
  containerRef: RefObject<HTMLDivElement | null>;
  /** 向上/向下多渲染的项数, 默认 5. */
  overscan?: number;
}

export interface UseVirtualListResult<T> {
  /** 可见范围内的项 (含 overscan), 附带原始 index. */
  visibleItems: Array<{ item: T; index: number }>;
  /** 展开到外层滚动 div 的 props (onScroll + style). */
  containerProps: {
    onScroll: (e: UIEvent<HTMLDivElement>) => void;
    style: CSSProperties;
  };
  /** 内层 spacer div 的 style: height = totalHeight, position: relative. */
  innerStyle: CSSProperties;
  /** 每个可见项的 style: position: absolute + transform: translateY(index * itemHeight). */
  getItemStyle: (index: number) => CSSProperties;
  /** 总高度 = items.length * itemHeight. */
  totalHeight: number;
  /** 当前可见范围的起止 index (含 overscan). */
  startIndex: number;
  endIndex: number;
}

/**
 * 轻量虚拟滚动 hook.
 *
 * @example
 * ```tsx
 * const containerRef = useRef<HTMLDivElement>(null);
 * const { visibleItems, containerProps, innerStyle, getItemStyle } = useVirtualList({
 *   items: filteredWords,
 *   itemHeight: 44,
 *   containerRef,
 *   overscan: 5,
 * });
 *
 * return (
 *   <div ref={containerRef} {...containerProps} className={styles.list}>
 *     <div style={innerStyle}>
 *       {visibleItems.map(({ item, index }) => (
 *         <div key={item.lemma} style={getItemStyle(index)}>
 *           <WordlistRow lemma={item.lemma} ... />
 *         </div>
 *       ))}
 *     </div>
 *   </div>
 * );
 * ```
 */
export function useVirtualList<T>({
  items,
  itemHeight,
  containerRef,
  overscan = 5,
}: UseVirtualListOptions<T>): UseVirtualListResult<T> {
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);

  // 挂载时 + ResizeObserver 不可用时, 读取 container clientHeight.
  // 生产环境: ResizeObserver 监听容器尺寸变化 (响应式布局 / 旋转).
  // jsdom: ResizeObserver 不存在, 跳过; onScroll 内 fallback 读取 clientHeight.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateHeight = () => {
      setContainerHeight(container.clientHeight);
    };

    updateHeight();

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateHeight);
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef]);

  const totalHeight = items.length * itemHeight;

  const startIndex = useMemo(
    () => Math.max(0, Math.floor(scrollTop / itemHeight) - overscan),
    [scrollTop, itemHeight, overscan],
  );

  const endIndex = useMemo(
    () =>
      Math.min(
        items.length,
        Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan,
      ),
    [scrollTop, containerHeight, itemHeight, items.length, overscan],
  );

  const visibleItems = useMemo(
    () =>
      items.slice(startIndex, endIndex).map((item, i) => ({
        item,
        index: startIndex + i,
      })),
    [items, startIndex, endIndex],
  );

  const onScroll = useCallback((e: UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    setScrollTop(target.scrollTop);
    // fallback: onScroll 时也读取 clientHeight, 确保 containerHeight 非 0.
    if (target.clientHeight > 0) {
      setContainerHeight(target.clientHeight);
    }
  }, []);

  const containerProps = {
    onScroll,
    style: {
      height: '100%',
      overflowY: 'auto' as const,
      // 隐藏滚动条但不影响滚动 (可选, 视觉偏好; 不影响功能).
      // WebKit + Firefox.
      scrollbarWidth: 'thin' as const,
    },
  };

  const innerStyle: CSSProperties = {
    height: totalHeight,
    position: 'relative',
  };

  const getItemStyle = useCallback(
    (index: number): CSSProperties => ({
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: itemHeight,
      transform: `translateY(${index * itemHeight}px)`,
      willChange: 'transform',
    }),
    [itemHeight],
  );

  return {
    visibleItems,
    containerProps,
    innerStyle,
    getItemStyle,
    totalHeight,
    startIndex,
    endIndex,
  };
}
