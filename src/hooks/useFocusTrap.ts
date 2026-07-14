/**
 * useFocusTrap (v2.2.4 Stage 3, D5)
 *
 * 模态弹窗 focus trap hook: 在 isActive 时 focus 第一个可交互元素,
 * Tab/Shift+Tab 在容器内循环, 防止焦点逃逸到弹窗背后的页面.
 *
 * 参考 GrammarPanel.tsx 中已有的 focus trap 实现, 提取为可复用 hook.
 * ESC 键关闭由各组件自行处理 (关闭回调不同, 不在此 hook 内统一).
 *
 * 用法:
 *   const ref = useRef<HTMLDivElement>(null);
 *   useFocusTrap(ref, isOpen);
 *   return <div ref={ref} role="dialog" aria-modal="true">...</div>;
 */
import { useEffect } from 'react';

export function useFocusTrap(
  ref: React.RefObject<HTMLElement | null>,
  isActive: boolean,
): void {
  useEffect(() => {
    if (!isActive) return;
    const container = ref.current;
    if (!container) return;

    const focusable = Array.from(
      container.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => el.offsetParent !== null);

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };

    container.addEventListener('keydown', onKeyDown);
    first?.focus();

    return () => container.removeEventListener('keydown', onKeyDown);
  }, [ref, isActive]);
}
