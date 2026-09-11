import { useEffect, useCallback } from 'react';
import type { Rating } from '../../../types';

interface ShortcutHandlers {
  onEscape?: () => void;
  onRate?: (rating: Rating) => void;
}

interface UseGlobalShortcutsOptions {
  enabled?: boolean;
  ratingEnabled?: boolean;
  handlers: ShortcutHandlers;
}

const RATING_KEY_MAP: Record<string, Rating> = {
  '1': 'again',
  '2': 'hard',
  '3': 'good',
  '4': 'easy',
};

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
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return;

      if (isEditableTarget(e.target)) return;

      if (e.key === 'Escape') {
        handlers.onEscape?.();
        return;
      }

      if (ratingEnabled && RATING_KEY_MAP[e.key]) {
        handlers.onRate?.(RATING_KEY_MAP[e.key]);
      }
    },
    [enabled, ratingEnabled, handlers]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}