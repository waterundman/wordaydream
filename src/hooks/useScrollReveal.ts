import { useEffect, useRef, useState, type RefObject } from 'react';

export interface UseScrollRevealOptions {
  threshold?: number;
  rootMargin?: string;
  once?: boolean;
  /**
   * Stage 4 新增: 进入视口后, 延迟 N 毫秒再翻 visible.
   * 用于 4 段叙事错峰入场 (Hero 0 / Today 100 / Progress 200 / Achievement 300).
   * 默认 0, 立即翻 visible.
   */
  delayMs?: number;
  /**
   * Stage 4 新增: 类名前缀, 输出 `${prefix}` (initial) 与 `${prefix}Visible` (visible).
   * 默认 'reveal'. 调用方可直接拼到 className 里.
   */
  classPrefix?: string;
}

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/**
 * Stage 4 增强版滚动揭示 hook.
 *
 * IntersectionObserver 监听元素进入视口, 进入后把 isVisible 翻为 true.
 * 尊重 prefers-reduced-motion: 用户偏好减少动效时, 立即置为 true, 不做 IO 监听与 delay.
 *
 * 返回元组 [ref, isVisible, className]:
 *  - ref: 绑到目标元素
 *  - isVisible: 当前是否已进入 (含 delay 后)
 *  - className: 直接拼到元素 className 的字符串 (initial -> visible 时自动切换)
 *
 * Stage 2 旧 API `[ref, isVisible]` 兼容: 旧调用方解构 2 个元素不受影响 (TS 允许
 * 短元组解构长元组).
 */
export function useScrollReveal<T extends HTMLElement = HTMLElement>(
  options: UseScrollRevealOptions = {},
): [RefObject<T>, boolean, string] {
  const {
    threshold = 0.3,
    rootMargin = '-50px 0px',
    once = true,
    delayMs = 0,
    classPrefix = 'reveal',
  } = options;
  const ref = useRef<T | null>(null);
  const [isVisible, setIsVisible] = useState<boolean>(false);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setIsVisible(true);
      return;
    }

    const el = ref.current;
    if (!el) return;

    if (typeof IntersectionObserver === 'undefined') {
      setIsVisible(true);
      return;
    }

    let delayTimer: ReturnType<typeof setTimeout> | null = null;
    const reveal = () => {
      if (delayMs > 0) {
        delayTimer = setTimeout(() => setIsVisible(true), delayMs);
      } else {
        setIsVisible(true);
      }
    };

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        if (entry.isIntersecting) {
          reveal();
          if (once) {
            observer.unobserve(entry.target);
          }
        } else if (!once) {
          if (delayTimer) {
            clearTimeout(delayTimer);
            delayTimer = null;
          }
          setIsVisible(false);
        }
      },
      { threshold, rootMargin },
    );

    observer.observe(el);

    return () => {
      if (delayTimer) {
        clearTimeout(delayTimer);
      }
      observer.disconnect();
    };
  }, [threshold, rootMargin, once, delayMs]);

  const baseClass = classPrefix;
  const visibleClass = `${classPrefix}Visible`;
  const className = isVisible ? `${baseClass} ${visibleClass}` : baseClass;

  return [ref as RefObject<T>, isVisible, className];
}
