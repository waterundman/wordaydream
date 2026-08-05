/**
 * Design v3 装饰分隔线
 *
 * BotanicalDivider: 植物藤蔓 SVG, 滚动进入视口时墨迹绘制 (stroke-dashoffset 动画)
 * TornPaperDivider: 撕纸纹 SVG, 同样墨迹绘制
 *
 * 灵感来自首页 v3 设计稿的内联 SVG, 路径数据完整保留以保真墨迹动画.
 * 尊重 prefers-reduced-motion: useScrollReveal 内部已处理 (立即 visible).
 */
import { useEffect, useRef, type RefObject } from 'react';
import { useScrollReveal } from '../../../hooks/useScrollReveal';
import styles from './Dividers.module.css';

/**
 * 测量 SVG 内所有 path 的总长, 写入 --path-length CSS 变量 + stroke-dasharray/dashoffset,
 * 驱动后续的 ink-draw 动画 (visible 时 dashoffset -> 0).
 */
function useInkDrawPaths(): RefObject<SVGSVGElement | null> {
  const svgRef = useRef<SVGSVGElement | null>(null);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const paths = svg.querySelectorAll<SVGPathElement>('path');
    paths.forEach((p) => {
      let len = 1000;
      try {
        if (p.getTotalLength) len = p.getTotalLength();
      } catch {
        len = 1000;
      }
      p.style.setProperty('--path-length', String(len));
    });
  }, []);
  return svgRef;
}

export function BotanicalDivider() {
  const [ref, isVisible] = useScrollReveal<HTMLDivElement>({ threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
  const svgRef = useInkDrawPaths();

  return (
    <div ref={ref} className={styles.botanicalWrap} aria-hidden="true">
      <svg
        ref={svgRef}
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 480 40"
        fill="none"
        stroke="var(--color-ink)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`${styles.inkSvg} ${isVisible ? styles.visible : ''}`}
        role="presentation"
      >
        <path d="M20 20 C 80 18, 140 22, 200 20 C 260 18, 320 22, 380 20 C 420 19, 450 21, 470 20" />
        <path d="M60 20 C 50 12, 40 8, 30 6 C 38 14, 48 18, 60 20" />
        <path d="M60 20 C 50 28, 40 32, 30 34 C 38 26, 48 22, 60 20" />
        <path d="M110 20 C 100 14, 88 10, 76 8 C 86 16, 98 19, 110 20" />
        <path d="M110 20 C 100 26, 88 30, 76 32 C 86 24, 98 21, 110 20" />
        <path d="M200 20 C 190 10, 175 5, 160 3 C 172 12, 188 18, 200 20" fill="var(--color-accent)" fillOpacity="0.15" stroke="var(--color-accent)" strokeWidth="1.5" />
        <path d="M200 20 C 190 30, 175 35, 160 37 C 172 28, 188 22, 200 20" fill="var(--color-accent)" fillOpacity="0.15" stroke="var(--color-accent)" strokeWidth="1.5" />
        <path d="M290 20 C 300 12, 312 8, 324 6 C 314 14, 302 18, 290 20" />
        <path d="M290 20 C 300 28, 312 32, 324 34 C 314 26, 302 22, 290 20" />
        <path d="M340 20 C 350 14, 362 10, 374 8 C 364 16, 352 19, 340 20" />
        <path d="M340 20 C 350 26, 362 30, 374 32 C 364 24, 352 21, 340 20" />
        <circle cx="155" cy="2" r="2" fill="var(--color-accent)" fillOpacity="0.2" />
        <circle cx="250" cy="20" r="1.5" fill="var(--color-ink)" fillOpacity="0.3" />
        <circle cx="430" cy="20" r="1.5" fill="var(--color-ink)" fillOpacity="0.3" />
      </svg>
    </div>
  );
}

export function TornPaperDivider() {
  const [ref, isVisible] = useScrollReveal<HTMLDivElement>({ threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
  const svgRef = useInkDrawPaths();

  return (
    <div ref={ref} className={styles.tornWrap} aria-hidden="true">
      <svg
        ref={svgRef}
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 480 20"
        fill="none"
        stroke="var(--color-ink)"
        strokeWidth="1.25"
        strokeLinecap="round"
        className={`${styles.inkSvg} ${isVisible ? styles.visible : ''}`}
        role="presentation"
      >
        <path d="M10 10 C 30 8, 50 12, 70 9 C 95 7, 120 11, 145 10 C 170 9, 195 12, 220 10 C 245 8, 270 11, 295 10 C 320 9, 345 12, 370 10 C 395 8, 420 11, 445 10 C 460 9, 470 10, 470 10" />
        <path d="M10 14 C 30 12, 50 15, 70 13 C 95 11, 120 14, 145 13 C 170 12, 195 14, 220 13 C 245 11, 270 14, 295 13 C 320 12, 345 14, 370 13 C 395 11, 420 14, 445 13 C 460 12, 470 13, 470 13" strokeOpacity="0.4" />
      </svg>
    </div>
  );
}
