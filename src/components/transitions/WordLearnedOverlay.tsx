/**
 * WordLearnedOverlay — 单词掌握全屏反馈层
 *
 * 当用户在阅读中完全掌握一个单词时, 由父组件置 `visible=true` 触发:
 * - 居中卡片 (纸质底 + 暖色边框 + 纸质纹理)
 * - 赤陶土装饰条淡入
 * - 书本徽章 (含 terracotta wash) ink-draw 逐笔入场
 * - 单词以 display 大字 accent 色淡入
 * - 下划线 ink-draw
 * - "已掌握" 标签收尾
 * - 停留不消失, Escape 或点击关闭
 *
 * 设计约束 (与 wordaydream-canvas/transition-word-learned.html 一致):
 * - 无渐变 / 无 backdrop-filter / 无 hover 形变 / 无无限循环
 * - SVG ink-draw: stroke-dasharray + stroke-dashoffset
 * - 配色 / 缓动 / 层级全部引用 tokens.css 变量
 * - 动画时序由 JS 计时器控制 (非 CSS delay)
 */
import { memo, useEffect, useRef, useState } from 'react';
import styles from './WordLearnedOverlay.module.css';

interface Props {
  /** The word that was learned, e.g. "ephemeral" */
  word: string;
  visible: boolean;
  onDismiss?: () => void;
}

type Phase = 'hidden' | 'entering' | 'visible';

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

export const WordLearnedOverlay = memo(function WordLearnedOverlay({
  word,
  visible,
  onDismiss,
}: Props) {
  const [phase, setPhase] = useState<Phase>('hidden');
  const [accentBarVisible, setAccentBarVisible] = useState(false);
  const [badgeFillVisible, setBadgeFillVisible] = useState(false);
  const [wordVisible, setWordVisible] = useState(false);
  const [underlineVisible, setUnderlineVisible] = useState(false);
  const [labelVisible, setLabelVisible] = useState(false);

  const badgeRef = useRef<SVGSVGElement>(null);
  const underlineRef = useRef<SVGPathElement>(null);

  useEffect(() => {
    if (!visible) {
      setPhase('hidden');
      setAccentBarVisible(false);
      setBadgeFillVisible(false);
      setWordVisible(false);
      setUnderlineVisible(false);
      setLabelVisible(false);
      armInkDraw(badgeRef.current);
      armUnderline(underlineRef.current);
      return;
    }

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReduced) {
      setPhase('visible');
      setAccentBarVisible(true);
      setBadgeFillVisible(true);
      setWordVisible(true);
      setUnderlineVisible(true);
      setLabelVisible(true);
      triggerInkDraw(badgeRef.current);
      triggerUnderline(underlineRef.current);
      return;
    }

    armInkDraw(badgeRef.current);
    armUnderline(underlineRef.current);
    setPhase('entering');

    // 时序对齐设计稿:
    // accentBar 200ms / 300ms
    // badge ink-draw 300ms / 600ms, badge-fill fade 300ms / 600ms
    // word 500ms / 400ms
    // underline ink-draw 700ms / 500ms
    // label 800ms / 300ms
    const timers: ReturnType<typeof setTimeout>[] = [];
    timers.push(setTimeout(() => setAccentBarVisible(true), 200));
    timers.push(setTimeout(() => triggerInkDraw(badgeRef.current), 300));
    timers.push(setTimeout(() => setBadgeFillVisible(true), 300));
    timers.push(setTimeout(() => setWordVisible(true), 500));
    timers.push(setTimeout(() => triggerUnderline(underlineRef.current), 700));
    timers.push(setTimeout(() => setUnderlineVisible(true), 700));
    timers.push(setTimeout(() => setLabelVisible(true), 800));
    timers.push(setTimeout(() => setPhase('visible'), 1200));

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
      aria-label={`已掌握单词 ${word}`}
      onClick={() => onDismiss?.()}
    >
      <div className={styles.card}>
        {/* 纸质纹理 */}
        <div className={styles.paperTexture} aria-hidden="true" />

        <div className={styles.content}>
          {/* 赤陶土装饰条 */}
          <div
            className={`${styles.accentBar} ${accentBarVisible ? styles.visible : ''}`}
            aria-hidden="true"
          />

          {/* 书本徽章 — ink-draw + terracotta wash */}
          <svg
            ref={badgeRef}
            className={styles.badge}
            viewBox="0 0 48 48"
            fill="none"
            stroke="var(--color-text-body)"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            {/* terracotta wash (填充) */}
            <path
              className={`${styles.badgeFill} ${badgeFillVisible ? styles.visible : ''}`}
              d="M24 12 C 20 10, 14 10, 8 11 L 8 38 C 14 37, 20 37, 24 39 L 24 12 Z M24 12 C 28 10, 34 10, 40 11 L 40 38 C 34 37, 28 37, 24 39 L 24 12 Z"
              fill="var(--color-accent)"
              fillOpacity={0.12}
              stroke="none"
            />
            {/* 书本左页 */}
            <path d="M24 12 C 20 10, 14 10, 8 11 L 8 38 C 14 37, 20 37, 24 39" />
            {/* 书本右页 */}
            <path d="M24 12 C 28 10, 34 10, 40 11 L 40 38 C 34 37, 28 37, 24 39" />
            {/* 书脊 */}
            <path d="M24 12 L 24 39" strokeOpacity={0.4} />
            {/* 页面线条 — 左 */}
            <path d="M12 18 L 20 17" strokeOpacity={0.4} />
            <path d="M12 23 L 20 22" strokeOpacity={0.4} />
            <path d="M12 28 L 20 27" strokeOpacity={0.4} />
            {/* 页面线条 — 右 */}
            <path d="M28 17 L 36 18" strokeOpacity={0.4} />
            <path d="M28 22 L 36 23" strokeOpacity={0.4} />
            <path d="M28 27 L 36 28" strokeOpacity={0.4} />
            {/* 书签飘带 */}
            <path d="M32 11 L 32 20 L 30 18 L 28 20 L 28 11" strokeOpacity={0.6} />
          </svg>

          {/* 单词 */}
          <h2 className={`${styles.word} ${wordVisible ? styles.visible : ''}`}>
            {word}
          </h2>

          {/* 下划线 — ink-draw */}
          <svg
            className={styles.underlineSvg}
            viewBox="0 0 200 6"
            fill="none"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path
              ref={underlineRef}
              className={`${styles.underline} ${underlineVisible ? styles.visible : ''}`}
              d="M 4 3 C 50 1, 100 5, 196 3"
              strokeLinecap="round"
              fill="none"
            />
          </svg>

          {/* 已掌握标签 */}
          <p className={`${styles.label} ${labelVisible ? styles.visible : ''}`}>
            已掌握
          </p>
        </div>
      </div>
    </div>
  );
});

/** 为下划线 <path> 设置 ink-draw 初始状态. */
function armUnderline(path: SVGPathElement | null): void {
  if (!path) return;
  try {
    const length = path.getTotalLength();
    if (length > 0) {
      path.style.strokeDasharray = String(length);
      path.style.strokeDashoffset = String(length);
    }
  } catch {
    /* 忽略 */
  }
}

/** 将下划线 ink-draw 推进到绘制完成. */
function triggerUnderline(path: SVGPathElement | null): void {
  if (!path) return;
  path.style.strokeDashoffset = '0';
}
