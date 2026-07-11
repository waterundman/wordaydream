import { useEffect, useRef } from 'react';

interface BreathingConfig {
  duration?: number;
  intensity?: number;
  delay?: number;
}

export function useBreathingEffect(
  enabled: boolean = true,
  config: BreathingConfig = {}
) {
  const { duration = 4000, intensity = 0.02, delay = 0 } = config;
  const animationRef = useRef<number | undefined>(undefined);
  const startTimeRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!enabled) return;

    const elements = document.querySelectorAll('[data-breathing]');

    const animate = (timestamp: number) => {
      if (!startTimeRef.current) {
        startTimeRef.current = timestamp;
      }

      const elapsed = timestamp - startTimeRef.current;

      elements.forEach((el, index) => {
        const elementDelay = delay + index * 200;
        if (elapsed < elementDelay) return;

        const adjustedElapsed = elapsed - elementDelay;
        const progress = (adjustedElapsed % duration) / duration;
        const breathe = Math.sin(progress * Math.PI * 2) * intensity;

        (el as HTMLElement).style.transform = `scale(${1 + breathe})`;
        (el as HTMLElement).style.opacity = `${1 - breathe * 2}`;
      });

      animationRef.current = requestAnimationFrame(animate);
    };

    // v1.5.2 fix L1: 页面隐藏时暂停 rAF (避免 background tab 持续动画消耗 CPU).
    // 恢复可见时, 重置 startTime 让动画从当前帧重新开始 (避免 elapsed 跳跃).
    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (animationRef.current) {
          cancelAnimationFrame(animationRef.current);
          animationRef.current = undefined;
        }
      } else if (animationRef.current === undefined) {
        startTimeRef.current = undefined;
        animationRef.current = requestAnimationFrame(animate);
      }
    };

    animationRef.current = requestAnimationFrame(animate);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      startTimeRef.current = undefined;
      elements.forEach((el) => {
        (el as HTMLElement).style.transform = '';
        (el as HTMLElement).style.opacity = '';
      });
    };
  }, [enabled, duration, intensity, delay]);
}