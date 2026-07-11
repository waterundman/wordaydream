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

export function useGlobalShortcuts({
  enabled = true,
  ratingEnabled = false,
  handlers,
}: UseGlobalShortcutsOptions) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return;

      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);
      if (isInput) return;

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