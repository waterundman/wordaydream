import { useLayoutEffect, useState, useRef } from 'react';

export interface PanelPosition {
  /** 垂直方向：popover 在 anchor 下方还是上方 */
  vertical: 'bottom' | 'top';
  /** 水平方向：popover 在 anchor 左侧、居中还是右侧 */
  horizontal: 'center' | 'left' | 'right';
  /** popover 相对 anchor 左侧的偏移 (px)，用于精调 */
  offsetX: number;
}

export interface UsePanelPositionOptions {
  /** 与视口边界的最小安全距离 (px) */
  margin?: number;
  /** popover 估算宽度 (px) */
  width?: number;
  /** popover 估算高度 (px) */
  height?: number;
}

const DEFAULT_OPTIONS: Required<UsePanelPositionOptions> = {
  margin: 12,
  width: 320,
  height: 240,
};

/**
 * 智能定位 popover:
 * - 默认在 anchor 下方居中
 * - 水平方向靠近视口左/右边缘时，自动靠左/靠右对齐，避免越界
 * - 垂直方向靠近视口底部时，自动上翻到 anchor 上方
 */
export function usePanelPosition(
  anchorRef: React.RefObject<HTMLElement | null>,
  active: boolean,
  options: UsePanelPositionOptions = {},
): PanelPosition {
  const { margin, width, height } = { ...DEFAULT_OPTIONS, ...options };
  const [position, setPosition] = useState<PanelPosition>({
    vertical: 'bottom',
    horizontal: 'center',
    offsetX: 0,
  });
  const lastUpdateRef = useRef(0);

  useLayoutEffect(() => {
    if (!active) return;
    const anchor = anchorRef.current;
    if (!anchor) return;

    const compute = () => {
      const rect = anchor.getBoundingClientRect();
      const viewportW = window.innerWidth;
      const viewportH = window.innerHeight;

      // 垂直: 默认 bottom, 空间不足时上翻
      const spaceBelow = viewportH - rect.bottom - margin;
      const spaceAbove = rect.top - margin;
      const vertical: PanelPosition['vertical'] =
        spaceBelow < height && spaceAbove > spaceBelow ? 'top' : 'bottom';

      // 水平: 估算居中位置后的 left/right, 选择不越界
      const centerLeft = rect.left + rect.width / 2 - width / 2;
      const centerRight = centerLeft + width;

      let horizontal: PanelPosition['horizontal'] = 'center';
      let offsetX = 0;

      if (centerLeft < margin) {
        // 靠左边缘: 改为左对齐 anchor
        horizontal = 'left';
        offsetX = margin - rect.left;
      } else if (centerRight > viewportW - margin) {
        // 靠右边缘: 改为右对齐 anchor
        horizontal = 'right';
        offsetX = viewportW - margin - rect.right;
      }

      setPosition((prev) =>
        prev.vertical === vertical &&
        prev.horizontal === horizontal &&
        prev.offsetX === offsetX
          ? prev
          : { vertical, horizontal, offsetX },
      );
      lastUpdateRef.current = Date.now();
    };

    compute();

    // v1.5.2 fix L7: resize/scroll 共用 80ms 节流, 避免高频事件触发 compute.
    // (原 onResize 已有节流, scroll listener 缺失, 拖拽/滚动时高频 setState.)
    const onThrottledUpdate = () => {
      if (Date.now() - lastUpdateRef.current < 80) return;
      compute();
    };
    window.addEventListener('resize', onThrottledUpdate);
    window.addEventListener('scroll', onThrottledUpdate, true);
    return () => {
      window.removeEventListener('resize', onThrottledUpdate);
      window.removeEventListener('scroll', onThrottledUpdate, true);
    };
  }, [active, anchorRef, margin, width, height]);

  return position;
}
