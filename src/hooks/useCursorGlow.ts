/**
 * v0.4.0-harmony Stage 4 (D4): rAF 消除 — 改用 CSS transition 驱动.
 *
 * 旧实现 (v1.5.2) 在每次 mousemove 后用 requestAnimationFrame 持续读取
 * cursorRef.current 并写 `left` / `top`, 主线程常驻 rAF. 现改为:
 * - mousemove 处理器直接写 transform: translate3d(x, y, 0) (GPU 合成层)
 * - 元素本身带 `transition: transform 80ms linear` 做亚帧平滑
 *   (浏览器 compositor 在帧间插值, 仍保持 60fps 视觉, JS 0 开销)
 * - 不再持有任何 rAF handle, 不再监听 visibilitychange
 *
 * 行为对齐:
 * - enabled=false 时跳过挂载 (旧实现也是)
 * - opacity transition 保留 0.3s ease-out (旧实现已有)
 * - 页面隐藏时 CSS transition 自动暂停 (compositor 不再渲染)
 *
 * 合成层友好性: transform 是 compositor 友好属性, 0 layout / 0 paint.
 */
import { useEffect } from 'react';

export function useCursorGlow(enabled: boolean = true) {
  useEffect(() => {
    if (!enabled) return;

    const glow = document.createElement('div');
    glow.className = 'cursor-glow';
    glow.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 200px;
      height: 200px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(45, 90, 77, 0.08) 0%, transparent 70%);
      pointer-events: none;
      z-index: 9999;
      opacity: 0;
      transition: transform 80ms linear, opacity 0.3s ease-out;
      transform: translate3d(-100px, -100px, 0);
      will-change: transform, opacity;
    `;
    document.body.appendChild(glow);

    const handleMouseMove = (e: MouseEvent) => {
      // 直接写 transform (合成层), CSS transition 在帧间插值.
      // translate3d 触发 GPU 合成层, 避免 layout / paint.
      glow.style.transform = `translate3d(${e.clientX - 100}px, ${e.clientY - 100}px, 0)`;
      glow.style.opacity = '1';
    };

    const handleMouseLeave = () => {
      glow.style.opacity = '0';
    };

    window.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseleave', handleMouseLeave);
      document.body.removeChild(glow);
    };
  }, [enabled]);
}
