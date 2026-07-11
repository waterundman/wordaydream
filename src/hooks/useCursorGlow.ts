import { useEffect, useRef } from 'react';

interface CursorGlowState {
  x: number;
  y: number;
  isVisible: boolean;
}

export function useCursorGlow(enabled: boolean = true) {
  const cursorRef = useRef<CursorGlowState>({ x: 0, y: 0, isVisible: false });
  const animationRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!enabled) return;

    const glow = document.createElement('div');
    glow.className = 'cursor-glow';
    glow.style.cssText = `
      position: fixed;
      width: 200px;
      height: 200px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(45, 90, 77, 0.08) 0%, transparent 70%);
      pointer-events: none;
      z-index: 9999;
      opacity: 0;
      transition: opacity 0.3s ease-out;
      transform: translate(-50%, -50%);
    `;
    document.body.appendChild(glow);

    const handleMouseMove = (e: MouseEvent) => {
      cursorRef.current.x = e.clientX;
      cursorRef.current.y = e.clientY;
      cursorRef.current.isVisible = true;
    };

    const handleMouseLeave = () => {
      cursorRef.current.isVisible = false;
    };

    const animate = () => {
      const { x, y, isVisible } = cursorRef.current;
      glow.style.left = `${x}px`;
      glow.style.top = `${y}px`;
      glow.style.opacity = isVisible ? '1' : '0';
      animationRef.current = requestAnimationFrame(animate);
    };

    // v1.5.2 fix L1: 页面隐藏时暂停 rAF, 可见时恢复, 避免 background tab 持续渲染.
    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (animationRef.current) {
          cancelAnimationFrame(animationRef.current);
          animationRef.current = undefined;
        }
      } else if (animationRef.current === undefined) {
        animationRef.current = requestAnimationFrame(animate);
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseleave', handleMouseLeave);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    animationRef.current = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseleave', handleMouseLeave);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      document.body.removeChild(glow);
    };
  }, [enabled]);
}