/**
 * ReadingCompleteOverlay — 阅读完成全屏总结层
 *
 * 当一次阅读会话结束时, 由父组件置 `visible=true` 触发:
 * - 深墨色全屏覆盖 (var(--color-ink)) + 纸质纹理
 * - 进度环 (SVG circle, r=82, circumference≈515.22) ink-draw 绘制
 * - fleuron 装饰 (位于标题上方, 含圆点) ink-draw
 * - "阅读完成" 标题 + 副标题 (今日数据摘要) 淡入
 * - 嫩枝分隔线 (含浆果) ink-draw
 * - 停留不消失, Escape 或点击关闭
 *
 * 设计约束 (与 wordaydream-canvas/transition-reading-complete.html 一致):
 * - 无渐变 / 无 backdrop-filter / 无 hover 形变 / 无无限循环
 * - SVG ink-draw: stroke-dasharray + stroke-dashoffset
 * - 配色 / 缓动 / 层级全部引用 tokens.css 变量
 * - 动画时序由 JS 计时器控制 (非 CSS delay)
 */
import { memo, useEffect, useRef, useState } from 'react';
import styles from './ReadingCompleteOverlay.module.css';

interface Props {
  visible: boolean;
  stats: {
    minutesRead: number;
    articlesRead: number;
  };
  onDismiss?: () => void;
}

type Phase = 'hidden' | 'entering' | 'visible';

const RING_RADIUS = 82;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS; // ≈ 515.22

/** 为 SVG 内所有 <path> 设置 ink-draw 初始状态. */
function armInkDraw(svg: SVGSVGElement | null): void {
  if (!svg) return;
  svg.querySelectorAll('path').forEach((path) => {
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

/** 将 ink-draw 推进到绘制完成 (offset → 0). */
function triggerInkDraw(svg: SVGSVGElement | null): void {
  if (!svg) return;
  svg.querySelectorAll('path').forEach((path) => {
    path.style.strokeDashoffset = '0';
  });
}

export const ReadingCompleteOverlay = memo(function ReadingCompleteOverlay({
  visible,
  stats,
  onDismiss,
}: Props) {
  const [phase, setPhase] = useState<Phase>('hidden');
  const [ringDrawn, setRingDrawn] = useState(false);
  const [fleuronVisible, setFleuronVisible] = useState(false);
  const [titleVisible, setTitleVisible] = useState(false);
  const [subtitleVisible, setSubtitleVisible] = useState(false);
  const [sprigVisible, setSprigVisible] = useState(false);

  const ringRef = useRef<SVGCircleElement>(null);
  const fleuronRef = useRef<SVGSVGElement>(null);
  const sprigRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!visible) {
      setPhase('hidden');
      setRingDrawn(false);
      setFleuronVisible(false);
      setTitleVisible(false);
      setSubtitleVisible(false);
      setSprigVisible(false);
      armRing(ringRef.current);
      armInkDraw(fleuronRef.current);
      armInkDraw(sprigRef.current);
      return;
    }

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReduced) {
      setPhase('visible');
      setRingDrawn(true);
      setFleuronVisible(true);
      setTitleVisible(true);
      setSubtitleVisible(true);
      setSprigVisible(true);
      triggerRing(ringRef.current);
      triggerInkDraw(fleuronRef.current);
      triggerInkDraw(sprigRef.current);
      return;
    }

    armRing(ringRef.current);
    armInkDraw(fleuronRef.current);
    armInkDraw(sprigRef.current);
    setPhase('entering');

    // 时序对齐设计稿:
    // ring ink-draw 500ms / 1000ms
    // fleuron ink-draw 800ms / 500ms (含 circle fade)
    // title 1200ms / 400ms
    // sprig 1000ms / 600ms
    // subtitle 1400ms / 300ms
    const timers: ReturnType<typeof setTimeout>[] = [];
    timers.push(setTimeout(() => triggerRing(ringRef.current), 500));
    timers.push(setTimeout(() => setRingDrawn(true), 500));
    timers.push(setTimeout(() => triggerInkDraw(fleuronRef.current), 800));
    timers.push(setTimeout(() => setFleuronVisible(true), 900));
    timers.push(setTimeout(() => triggerInkDraw(sprigRef.current), 1000));
    timers.push(setTimeout(() => setSprigVisible(true), 1100));
    timers.push(setTimeout(() => setTitleVisible(true), 1200));
    timers.push(setTimeout(() => setSubtitleVisible(true), 1400));
    timers.push(setTimeout(() => setPhase('visible'), 1800));

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

  const isActive = phase !== 'hidden';

  return (
    <div
      className={`${styles.overlay} ${isActive ? styles.visible : ''}`}
      role="dialog"
      aria-modal="true"
      aria-hidden={!isActive}
      aria-label="阅读完成"
      onClick={() => onDismiss?.()}
    >
      <div className={styles.paperTexture} aria-hidden="true" />

      <div className={styles.content}>
        {/* 进度环 — ink-draw */}
        <div className={styles.ringWrap}>
          <svg
            className={styles.ring}
            viewBox="0 0 180 180"
            fill="none"
            aria-hidden="true"
          >
            {/* 背景圆 (淡) */}
            <circle
              cx="90"
              cy="90"
              r={RING_RADIUS}
              stroke="rgba(250, 248, 245, 0.1)"
              strokeWidth={1.5}
              fill="none"
            />
            {/* 进度圆 — ink-draw */}
            <circle
              ref={ringRef}
              className={`${styles.ringProgress} ${ringDrawn ? styles.visible : ''}`}
              cx="90"
              cy="90"
              r={RING_RADIUS}
              stroke="var(--color-accent)"
              strokeWidth={4}
              fill="none"
              strokeLinecap="round"
              transform="rotate(-90 90 90)"
            />
          </svg>
        </div>

        {/* fleuron (位于标题上方, 含圆点) — ink-draw */}
        <svg
          ref={fleuronRef}
          className={`${styles.fleuron} ${fleuronVisible ? styles.visible : ''}`}
          viewBox="0 0 40 40"
          fill="none"
          stroke="var(--color-paper)"
          strokeWidth={1}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M20 4 C 18 10, 14 14, 8 16 C 14 18, 18 22, 20 28 C 22 22, 26 18, 32 16 C 26 14, 22 10, 20 4 Z" />
          <path d="M10 32 C 14 30, 17 32, 20 34 C 23 32, 26 30, 30 32" />
          <circle
            className={fleuronVisible ? styles.visible : ''}
            cx="20"
            cy="16"
            r="1.5"
            fill="var(--color-paper)"
            stroke="none"
          />
        </svg>

        {/* 标题 */}
        <h1 className={`${styles.title} ${titleVisible ? styles.visible : ''}`}>
          阅读完成
        </h1>

        {/* 副标题 — 今日数据摘要 */}
        <p className={`${styles.subtitle} ${subtitleVisible ? styles.visible : ''}`}>
          今日阅读 {stats.minutesRead} 分钟 · {stats.articlesRead} 篇文章
        </p>

        {/* 嫩枝分隔线 (含浆果) — ink-draw */}
        <svg
          ref={sprigRef}
          className={`${styles.sprig} ${sprigVisible ? styles.visible : ''}`}
          viewBox="0 0 480 40"
          fill="none"
          stroke="var(--color-paper)"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {/* 中心茎 */}
          <path d="M20 20 C 80 18, 140 22, 200 20 C 260 18, 320 22, 380 20 C 420 19, 450 21, 470 20" />
          {/* 左侧分支叶子 */}
          <path d="M60 20 C 50 12, 40 8, 30 6 C 38 14, 48 18, 60 20" />
          <path d="M60 20 C 50 28, 40 32, 30 34 C 38 26, 48 22, 60 20" />
          {/* 中段叶子 */}
          <path d="M150 20 C 145 14, 138 10, 130 8 C 135 15, 142 18, 150 20" />
          <path d="M150 20 C 145 26, 138 30, 130 32 C 135 25, 142 22, 150 20" />
          <path d="M250 20 C 255 14, 262 10, 270 8 C 265 15, 258 18, 250 20" />
          <path d="M250 20 C 255 26, 262 30, 270 32 C 265 25, 258 22, 250 20" />
          {/* 右侧分支叶子 */}
          <path d="M390 20 C 400 12, 410 8, 420 6 C 412 14, 402 18, 390 20" />
          <path d="M390 20 C 400 28, 410 32, 420 34 C 412 26, 402 22, 390 20" />
          {/* 浆果 */}
          <circle cx="155" cy="2" r="2" fill="var(--color-paper)" fillOpacity={0.35} stroke="none" />
          <circle cx="250" cy="20" r="1.5" fill="var(--color-paper)" fillOpacity={0.45} stroke="none" />
          <circle cx="430" cy="20" r="1.5" fill="var(--color-paper)" fillOpacity={0.45} stroke="none" />
        </svg>
      </div>
    </div>
  );
});

/** 为进度环 <circle> 设置 ink-draw 初始状态. */
function armRing(circle: SVGCircleElement | null): void {
  if (!circle) return;
  circle.style.strokeDasharray = String(RING_CIRCUMFERENCE);
  circle.style.strokeDashoffset = String(RING_CIRCUMFERENCE);
}

/** 将进度环 ink-draw 推进到绘制完成. */
function triggerRing(circle: SVGCircleElement | null): void {
  if (!circle) return;
  circle.style.strokeDashoffset = '0';
}
