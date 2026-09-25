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
 *
 * v1.6.1 Stage 4 (P2-1): 加两道人形守卫 + 清理死类名.
 * - `pointer: coarse` (触摸设备) 不挂载 —— 没有鼠标, 200x200 固定层 + 2 个监听器纯属浪费,
 *   且 `mousemove` 在触摸设备上还会被合成出的 mouse 事件误触发.
 * - `prefers-reduced-motion: reduce` 不挂载 —— 光晕本身是装饰性动效, 用户明确要求减少动效.
 * - 删除 `glow.className = 'cursor-glow'`: 该字符串全仓没有任何 CSS 规则命中, 是死类名;
 *   改为 `aria-hidden="true"` (装饰性元素本就不该暴露给辅助技术) + `data-cursor-glow`
 *   作为可查询标识.
 *
 * 守卫的失败方向: `matchMedia` 不可用时**照旧挂载** (只在明确探测到 coarse / reduced
 * 时才跳过), 避免把"探测能力缺失"误判成"用户不要光晕".
 */
import { useEffect } from 'react';

export function useCursorGlow(enabled: boolean = true) {
  useEffect(() => {
    if (!enabled) return;

    // 人形守卫: 仅在能明确探测到"不是鼠标 + 没有减少动效"时才挂载.
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      if (window.matchMedia('(pointer: coarse)').matches) return;
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    }

    const glow = document.createElement('div');
    // 装饰性元素: 对辅助技术隐藏; data-cursor-glow 供测试 / E2E 定位
    // (替代原先那个没有任何 CSS 规则命中的死类名 'cursor-glow').
    glow.setAttribute('aria-hidden', 'true');
    glow.dataset.cursorGlow = '';
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
      /* v1.6.1 Stage 4 (P2-3) 判定保留: 这个 200x200 光晕是 O(1) 单例, 且 transform 与
         opacity **都**由下面的 mousemove / mouseleave 处理器在运行时真实改写 ——
         两条声明均为真。它是全仓少数几个会随用户输入持续变化的元素。 */
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
