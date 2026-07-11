/**
 * v1.5.2 Stage 3: ScrollProgressBar (Contract 29 NEW / D-1)
 *
 * 顶部 3px 阅读进度条, 自包含组件, 由 App.tsx 在 ThemeProvider 内挂载一次.
 *
 * 设计要点:
 * - 0 props: 不需要任何 input, 完全自管生命周期 + 计算.
 * - rAF + 16ms throttle: 60fps 滚动时最多每帧一次 setState, 避免 React 抖动.
 * - 卸载清理: removeEventListener + cancelAnimationFrame, 路由切换无泄漏.
 * - SSR / 0 window 兼容: 全部 DOM 访问放在 useEffect 内.
 * - a11y: role="progressbar" + aria-valuenow (Math.round 整数) + aria-label 德语 "Lesefortschritt".
 * - 0 emoji, 0 icon dependency.
 */
import { useEffect, useState } from 'react';
import styles from './ScrollProgressBar.module.css';

export function ScrollProgressBar() {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    let rafId: number | null = null;
    let lastUpdate = 0;

    const compute = () => {
      const scrollTop = window.scrollY || document.documentElement.scrollTop || 0;
      const scrollHeight = document.documentElement.scrollHeight;
      const clientHeight = document.documentElement.clientHeight;
      const max = scrollHeight - clientHeight;
      const pct = max <= 0 ? 0 : Math.min(100, Math.max(0, (scrollTop / max) * 100));
      setProgress(pct);
    };

    const onScroll = () => {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (now - lastUpdate < 16) {
        if (rafId !== null) return;
        rafId = window.requestAnimationFrame(() => {
          rafId = null;
          lastUpdate = typeof performance !== 'undefined' ? performance.now() : Date.now();
          compute();
        });
        return;
      }
      lastUpdate = now;
      compute();
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    compute();

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      }
    };
  }, []);

  return (
    <div
      className={styles.bar}
      role="progressbar"
      aria-label="Lesefortschritt"
      aria-valuenow={Math.round(progress)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={styles.fill} style={{ width: `${progress}%` }} />
    </div>
  );
}
