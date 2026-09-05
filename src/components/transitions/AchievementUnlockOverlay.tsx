/**
 * AchievementUnlockOverlay — 连续阅读里程碑全屏庆祝层
 *
 * 当 streak 达到里程碑时, 由父组件置 `visible=true` 触发:
 * - 全屏 terracotta 覆盖 (var(--color-flame))
 * - 墨溅底纹 + 火焰徽章 / fleuron 装饰的 ink-draw 逐次入场
 * - 一次性 grain 闪烁, 之后停留 (不自动消失)
 * - Escape 或点击任意位置调用 onDismiss
 *
 * 设计约束 (与 wordaydream-canvas/transition-achievement.html 一致):
 * - 无渐变 / 无 backdrop-filter / 无 hover 形变 / 无无限循环
 * - SVG ink-draw: stroke-dasharray + stroke-dashoffset
 * - 配色 / 缓动 / 层级全部引用 tokens.css 变量
 */
import { useEffect, useRef, useState } from 'react';
import { publicAssetUrl } from '../../platform/publicAssetUrl';
import styles from './AchievementUnlockOverlay.module.css';

interface Props {
  visible: boolean;
  /** The streak number, e.g. 7 */
  streak: number;
  /** The achievement title, e.g. "阅读达人" */
  title: string;
  onDismiss?: () => void;
}

type Phase = 'hidden' | 'entering' | 'visible';

/**
 * 为 SVG 内所有 <path> 设置 ink-draw 初始状态:
 * stroke-dasharray = 全长, stroke-dashoffset = 全长 → 路径不可见, 等待绘制.
 */
function armInkDraw(svg: SVGSVGElement | null): void {
  if (!svg) return;
  const paths = svg.querySelectorAll('path');
  paths.forEach((path) => {
    try {
      const length = path.getTotalLength();
      if (length > 0) {
        path.style.strokeDasharray = String(length);
        path.style.strokeDashoffset = String(length);
      }
    } catch {
      /* getTotalLength 在未渲染路径上可能抛错, 忽略 */
    }
  });
}

/** 将 ink-draw 推进到绘制完成 (offset → 0), 由 CSS transition 负责动画. */
function triggerInkDraw(svg: SVGSVGElement | null): void {
  if (!svg) return;
  svg.querySelectorAll('path').forEach((path) => {
    path.style.strokeDashoffset = '0';
  });
}

export function AchievementUnlockOverlay({ visible, streak, title, onDismiss }: Props) {
  const [phase, setPhase] = useState<Phase>('hidden');
  const [inkVisible, setInkVisible] = useState(false);
  const [fleuronCircleVisible, setFleuronCircleVisible] = useState(false);
  const [titleVisible, setTitleVisible] = useState(false);
  const [subtitleVisible, setSubtitleVisible] = useState(false);
  const [grainShimmer, setGrainShimmer] = useState(false);

  const badgeRef = useRef<SVGSVGElement>(null);
  const fleuronRef = useRef<SVGSVGElement>(null);

  // 入场序列 (或重置回隐藏态).
  useEffect(() => {
    if (!visible) {
      setPhase('hidden');
      setInkVisible(false);
      setFleuronCircleVisible(false);
      setTitleVisible(false);
      setSubtitleVisible(false);
      setGrainShimmer(false);
      // 重新上膛 ink-draw, 以便下次入场再画一次
      armInkDraw(badgeRef.current);
      armInkDraw(fleuronRef.current);
      return;
    }

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReduced) {
      // 降级: 一切立即可见, 不放 grain 闪烁
      setPhase('visible');
      setInkVisible(true);
      setFleuronCircleVisible(true);
      setTitleVisible(true);
      setSubtitleVisible(true);
      triggerInkDraw(badgeRef.current);
      triggerInkDraw(fleuronRef.current);
      return;
    }

    // 上膛 ink-draw 路径 (dash = 全长, 不可见)
    armInkDraw(badgeRef.current);
    armInkDraw(fleuronRef.current);
    // 0ms: overlay 淡入 + 缩放. useEffect 在首帧绘制后执行,
    // 此时初始态 (opacity 0 / scale 0.85) 已提交, 切到 .visible 会触发 transition.
    setPhase('entering');

    const timers: ReturnType<typeof setTimeout>[] = [];
    timers.push(setTimeout(() => setInkVisible(true), 200)); // 200ms: 墨溅
    timers.push(setTimeout(() => triggerInkDraw(badgeRef.current), 400)); // 400ms: 火焰徽章
    timers.push(setTimeout(() => triggerInkDraw(fleuronRef.current), 700)); // 700ms: fleuron 路径
    timers.push(setTimeout(() => setFleuronCircleVisible(true), 700)); // 700ms: fleuron 圆点
    timers.push(setTimeout(() => setTitleVisible(true), 900)); // 900ms: 标题
    timers.push(setTimeout(() => setSubtitleVisible(true), 1100)); // 1100ms: 副标题
    timers.push(
      setTimeout(() => {
        setGrainShimmer(true); // 1300ms: 一次性 grain 闪烁
        setPhase('visible');
      }, 1300),
    );

    return () => {
      timers.forEach((t) => clearTimeout(t));
    };
  }, [visible]);

  // Escape 关闭
  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss?.();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [visible, onDismiss]);

  const handleDismiss = () => {
    onDismiss?.();
  };

  const isActive = phase !== 'hidden';

  return (
    <div
      className={`${styles.overlay} ${isActive ? styles.visible : ''}`}
      role="dialog"
      aria-modal="true"
      aria-hidden={!isActive}
      aria-label={`成就解锁：连续 ${streak} 天，${title}`}
      onClick={handleDismiss}
    >
      {/* 墨溅底纹 (位于徽章之后) */}
      <img
        src={publicAssetUrl('assets/img/ink-splash-terracotta.jpg')}
        className={`${styles.inkSplash} ${inkVisible ? styles.visible : ''}`}
        alt=""
        aria-hidden="true"
      />

      <div className={styles.content}>
        {/* 火焰徽章 — ink-draw */}
        <svg
          ref={badgeRef}
          className={styles.badge}
          viewBox="0 0 64 64"
          fill="none"
          stroke="var(--color-paper)"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {/* 火焰外轮廓 */}
          <path d="M32 8 C 28 16, 22 20, 20 28 C 18 36, 22 44, 28 48 C 24 44, 26 36, 30 32 C 28 38, 32 42, 34 38 C 38 32, 36 24, 40 20 C 42 26, 46 30, 44 38 C 46 44, 42 50, 36 52 C 42 50, 48 44, 48 34 C 48 22, 38 14, 32 8 Z" />
          {/* 内部火舌阴影 (两条曲线合并为单 path) */}
          <path d="M30 24 C 28 28, 30 32, 32 30 M34 28 C 36 32, 34 36, 36 34" strokeOpacity={0.3} />
          {/* 底座 */}
          <path d="M24 52 C 28 56, 36 56, 40 52" strokeOpacity={0.5} />
        </svg>

        {/* fleuron 装饰 — ink-draw */}
        <svg
          ref={fleuronRef}
          className={styles.fleuron}
          viewBox="0 0 40 40"
          fill="none"
          stroke="var(--color-paper)"
          strokeWidth={1}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M20 4 C 18 10, 14 14, 8 16 C 14 18, 18 22, 20 28 C 22 22, 26 18, 32 16 C 26 14, 22 10, 20 4 Z" />
          <circle
            className={fleuronCircleVisible ? styles.visible : ''}
            cx="20"
            cy="16"
            r="1.5"
            fill="var(--color-paper)"
            stroke="none"
          />
          <path d="M10 32 C 14 30, 17 32, 20 34 C 23 32, 26 30, 30 32" />
        </svg>

        <h1 className={`${styles.title} ${titleVisible ? styles.visible : ''}`}>
          连续 {streak} 天
        </h1>
        <p className={`${styles.subtitle} ${subtitleVisible ? styles.visible : ''}`}>{title}</p>
      </div>

      {/* 一次性 grain 闪烁 (feTurbulence 噪点 + 墨色矩阵) */}
      <svg
        className={`${styles.grain} ${grainShimmer ? styles.visible : ''}`}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <filter id="grain-filter">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
            <feColorMatrix
              type="matrix"
              values="0 0 0 0 0.106 0 0 0 0 0.106 0 0 0 0 0.098 0 0 0 0.04 0"
            />
          </filter>
        </defs>
        <rect width="100" height="100" filter="url(#grain-filter)" />
      </svg>
    </div>
  );
}
