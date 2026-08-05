import { useEffect, memo, useRef, useState } from 'react';
import styles from './InkWipeTransition.module.css';

interface Props {
  /**
   * 触发过渡. 每次从 false → true 会播放一次完整的两阶段动画:
   * 1. cover: overlay 从左向右覆盖全屏 (width 0→100%, ~400ms)
   * 2. reveal: overlay 从左向右揭开 (width 100%→0, ~600ms), 同时绘制 sprig + 浆果
   *
   * 父组件应在 cover 阶段切换内容 (onCovered 回调),
   * 这样新页面在 overlay 下方渲染, 用户看不到闪烁.
   */
  active: boolean;
  /** overlay 覆盖完成时调用 — 父组件应在此切换页面内容. */
  onCovered?: () => void;
  /** 整个过渡完成时调用. */
  onComplete?: () => void;
  children: React.ReactNode;
}

type Phase = 'idle' | 'covering' | 'revealing';

export const InkWipeTransition = memo(function InkWipeTransition({
  active,
  onCovered,
  onComplete,
  children,
}: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>('idle');

  useEffect(() => {
    if (!active) {
      setPhase('idle');
      return;
    }

    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // 降级: 跳过动画, 直接完成
    if (reduceMotion) {
      onCovered?.();
      const t = window.setTimeout(() => onComplete?.(), 50);
      return () => window.clearTimeout(t);
    }

    // 阶段 1: cover — overlay 从左向右覆盖全屏
    setPhase('covering');

    const timers: ReturnType<typeof setTimeout>[] = [];

    // cover 动画 ~400ms 后, 通知父组件切换内容
    timers.push(
      window.setTimeout(() => {
        onCovered?.();
        // 阶段 2: reveal — 切换到揭开状态, 触发 sprig 绘制 + overlay 收缩
        setPhase('revealing');
      }, 400),
    );

    // 上膛 sprig path 长度 (在 revealing 开始前设置)
    const overlay = overlayRef.current;
    if (overlay) {
      const paths = overlay.querySelectorAll<SVGPathElement>('path');
      paths.forEach((p) => {
        const len = p.getTotalLength();
        p.style.setProperty('--sprig-length', String(len));
        p.style.strokeDasharray = String(len);
        p.style.strokeDashoffset = String(len);
      });

      // revealing 阶段开始时触发 sprig 绘制
      timers.push(
        window.setTimeout(() => {
          paths.forEach((p) => {
            p.style.strokeDashoffset = '0';
          });
        }, 450),
      );
    }

    // 整个过渡完成 (~1900ms)
    timers.push(
      window.setTimeout(() => {
        setPhase('idle');
        onComplete?.();
      }, 1900),
    );

    return () => {
      timers.forEach((t) => clearTimeout(t));
    };
  }, [active, onCovered, onComplete]);

  const overlayClass =
    phase === 'covering'
      ? `${styles.overlay} ${styles.covering}`
      : phase === 'revealing'
        ? `${styles.overlay} ${styles.revealing}`
        : styles.overlay;

  return (
    <div className={styles.container}>
      <div className={styles.content}>{children}</div>
      <div ref={overlayRef} className={overlayClass}>
        <div className={styles.texture} />
        <svg
          className={styles.sprig}
          viewBox="0 0 480 40"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          stroke="var(--color-paper)"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {/* Center stem */}
          <path d="M20 20 C 80 18, 140 22, 200 20 C 260 18, 320 22, 380 20 C 420 19, 450 21, 470 20" />
          {/* Left branch leaves */}
          <path d="M60 20 C 50 12, 40 8, 30 6 C 38 14, 48 18, 60 20" />
          <path d="M60 20 C 50 28, 40 32, 30 34 C 38 26, 48 22, 60 20" />
          <path d="M110 20 C 100 14, 88 10, 76 8 C 86 16, 98 19, 110 20" />
          <path d="M110 20 C 100 26, 88 30, 76 32 C 86 24, 98 21, 110 20" />
          {/* Center accent leaf */}
          <path d="M200 20 C 190 10, 175 5, 160 3 C 172 12, 188 18, 200 20" />
          <path d="M200 20 C 190 30, 175 35, 160 37 C 172 28, 188 22, 200 20" />
          {/* Right branch leaves */}
          <path d="M290 20 C 300 12, 312 8, 324 6 C 314 14, 302 18, 290 20" />
          <path d="M290 20 C 300 28, 312 32, 324 34 C 314 26, 302 22, 290 20" />
          <path d="M340 20 C 350 14, 362 10, 374 8 C 364 16, 352 19, 340 20" />
          <path d="M340 20 C 350 26, 362 30, 374 32 C 364 24, 352 21, 340 20" />
          {/* Small berries */}
          <circle className={styles.sprigBerry} cx="155" cy="2" r="2" fill="var(--color-paper)" fillOpacity={0.35} stroke="none" />
          <circle className={styles.sprigBerry} cx="250" cy="20" r="1.5" fill="var(--color-paper)" fillOpacity={0.45} stroke="none" />
          <circle className={styles.sprigBerry} cx="430" cy="20" r="1.5" fill="var(--color-paper)" fillOpacity={0.45} stroke="none" />
        </svg>
      </div>
    </div>
  );
});
