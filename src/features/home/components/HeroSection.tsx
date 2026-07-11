/**
 * 主页 Hero 区域 (Stage 2 方案 A: Hero-First)
 *
 * 设计:
 * - 大字号 serif 标题 (clamp 2.5rem -> 4rem)
 * - 双行 tagline: 主标 + 副标
 * - 大 CTA 按钮 (min-height 56px, ink 色)
 * - 渐变背景 paper-warm -> paper
 * - 入场动画: fade-in + slide-up 8px, 200ms ease-out-quart
 * - prefers-reduced-motion: transform: none, 0.01ms
 *
 * 0 emoji 硬约束.
 */
import { useScrollReveal } from '../../../hooks/useScrollReveal';
import { useSettingsStore } from '../../settings/store/useSettingsStore';
import styles from './HeroSection.module.css';

interface HeroSectionProps {
  onStart: () => void;
}

export function HeroSection({ onStart }: HeroSectionProps) {
  const [ref, isVisible] = useScrollReveal<HTMLDivElement>({
    threshold: 0.2,
    rootMargin: '0px',
  });

  // v1.5.2 Stage 2 (Contract 28 NEW / D-2): 今日阅读时长, 单位分钟
  const totalSecondsToday = useSettingsStore((s) => s.totalSecondsToday);
  const minutesReadToday = Math.floor(totalSecondsToday / 60);

  const heroClass = isVisible
    ? `${styles.hero} ${styles.heroVisible}`
    : styles.hero;

  return (
    <div
      ref={ref}
      className={heroClass}
      data-testid="hero-section"
    >
      <div className={styles.eyebrow}>今日阅读</div>
      <h1 className={styles.title}>在语境中学习词汇</h1>
      <p className={styles.tagline}>每个词都在它出现的语境里</p>
      <p className={styles.copy}>
        从一次阅读开始, 把生词放在它出现的句子中理解。
      </p>
      <p
        className={styles.readingTime}
        data-testid="hero-reading-time"
        aria-label={`Heute bereits ${minutesReadToday} Minuten gelesen`}
      >
        Heute bereits {minutesReadToday} Min. gelesen
      </p>
      <button
        className={styles.cta}
        onClick={onStart}
        type="button"
        data-testid="hero-cta"
      >
        开始今日阅读
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          className={styles.ctaArrow}
          aria-hidden="true"
        >
          <path
            d="M5 12h14M13 5l7 7-7 7"
            stroke="currentColor"
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
