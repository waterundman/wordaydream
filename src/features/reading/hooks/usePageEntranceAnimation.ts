import { useState, useEffect, useMemo } from 'react';

interface UsePageEntranceAnimationOptions {
  staggerDelay?: number;
  animationDuration?: number;
  offset?: number;
  enabled?: boolean;
}

interface PageEntranceAnimationResult {
  getStyle: (index: number) => React.CSSProperties;
  isAnimating: boolean;
}

export function usePageEntranceAnimation({
  staggerDelay = 80,
  animationDuration = 500,
  offset = 20,
  enabled = true,
}: UsePageEntranceAnimationOptions = {}): PageEntranceAnimationResult {
  const [isAnimating, setIsAnimating] = useState(true);
  const [startTime, setStartTime] = useState<number | null>(null);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleChange = () => {
      if (mediaQuery.matches) {
        setIsAnimating(false);
        setStartTime(null);
      }
    };

    if (mediaQuery.matches) {
      setIsAnimating(false);
      setStartTime(null);
    } else if (enabled) {
      setStartTime(Date.now());
      const timer = setTimeout(() => {
        setIsAnimating(false);
      }, animationDuration + staggerDelay * 10);
      return () => clearTimeout(timer);
    }

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [enabled, animationDuration, staggerDelay]);

  const getStyle = useMemo(
    () => (index: number): React.CSSProperties => {
      if (!enabled || !startTime) {
        return {};
      }

      const delay = index * staggerDelay;

      return {
        opacity: 0,
        transform: `translateY(${offset}px)`,
        animation: `pageEntrance ${animationDuration}ms var(--ease-out-expo) ${delay}ms forwards`,
      };
    },
    [enabled, staggerDelay, animationDuration, offset, startTime]
  );

  return { getStyle, isAnimating };
}

declare module 'react' {
  interface CSSProperties {
    animation?: string;
  }
}