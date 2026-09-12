import { useEffect, useCallback } from 'react';
import type { Rating } from '../../../types';
import { useShortcutsStore } from '../../shortcuts/store/useShortcutsStore';

interface ShortcutHandlers {
  onEscape?: () => void;
  onRate?: (rating: Rating) => void;
}

interface UseGlobalShortcutsOptions {
  enabled?: boolean;
  ratingEnabled?: boolean;
  handlers: ShortcutHandlers;
}

/**
 * 判断键盘事件目标是否为"可编辑/输入"元素。
 * 若是, 全局快捷键 (评分键等) 应让位, 让数字等字符正常落入输入内容。
 *
 * 覆盖:
 * - INPUT / TEXTAREA / SELECT (原生表单输入控件)
 * - contenteditable 元素及其可编辑后代 (isContentEditable 在 contenteditable
 *   子树内任何元素上都返回 true)
 *
 * 纯函数, 便于单测 (见 useGlobalShortcuts.test.ts)。
 * 注意: 当焦点在 body / 无焦点元素时 e.target 是 window / document,
 * 不属于 HTMLElement, 视为"非可编辑" → 评分键照常生效。
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  if (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  ) {
    return true;
  }
  // contenteditable: 优先用 isContentEditable (浏览器中自身/继承均覆盖),
  // 再用 closest 兜底 jsdom 未实现"可编辑祖先继承"的情况 (含嵌套富文本后代).
  if (target.isContentEditable || target.closest('[contenteditable="true"]')) {
    return true;
  }
  return false;
}

export function useGlobalShortcuts({
  enabled = true,
  ratingEnabled = false,
  handlers,
}: UseGlobalShortcutsOptions) {
  // 订阅评分键位 (改键后运行中即时生效): 从 store 派生 '1'→'again' 映射。
  // 订阅 ratingKeys 整体, 保证任一评级改键都触发重渲染 + handleKeyDown 重建。
  const ratingKeys = useShortcutsStore((s) => s.ratingKeys);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return;

      if (isEditableTarget(e.target)) return;

      if (e.key === 'Escape') {
        handlers.onEscape?.();
        return;
      }

      if (ratingEnabled) {
        // ratingKeys 形如 {again:'1',...} (评级→按键), 需反查为 按键→评级。
        // 订阅式: 改键后 ratingKeys 变化即重建此映射, 运行中即时生效。
        const keyToRating: Record<string, Rating> = {
          [ratingKeys.again]: 'again',
          [ratingKeys.hard]: 'hard',
          [ratingKeys.good]: 'good',
          [ratingKeys.easy]: 'easy',
        };
        const rating = keyToRating[e.key];
        if (rating) {
          handlers.onRate?.(rating);
        }
      }
    },
    [enabled, ratingEnabled, handlers, ratingKeys]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}