/**
 * 主页 Hero Card (Design v3)
 *
 * 设计稿对齐:
 * - 居中 fleuron 装饰 + Newsreader 标题 + 手绘下划线 SVG + 首字下沉段落 + pill CTA
 * - 右侧 140px 进度环 (ProgressRing 组件)
 * - 桌面 flex-row, 移动 stack column
 * - 入场动画: fleuron/heading/underline/dropcap/cta 错峰 fadeUp 0.1s 间隔
 * - prefers-reduced-motion: 立即显示
 *
 * 0 emoji 硬约束.
 */
import { useScrollReveal } from '../../../hooks/useScrollReveal';
import { publicAssetUrl } from '../../../platform/publicAssetUrl';
import { ProgressRing } from './ProgressRing';
import styles from './HeroSection.module.css';

interface HeroSectionProps {
  onStart: () => void;
  progressCompleted: number;
  progressTotal: number;
}

export function HeroSection({
  onStart,
  progressCompleted,
  progressTotal,
}: HeroSectionProps) {
  const [ref, isVisible] = useScrollReveal<HTMLDivElement>({
    threshold: 0.2,
    rootMargin: '0px',
  });

  const heroClass = isVisible
    ? `${styles.hero} ${styles.heroVisible}`
    : styles.hero;

  return (
    <section
      ref={ref}
      className={heroClass}
      data-testid="hero-section"
    >
      <div className={styles.fleuronWrap}>
        <img
          src={publicAssetUrl('assets/svg/ornament-fleuron.svg')}
          width="24"
          height="24"
          alt=""
          aria-hidden="true"
          className={styles.fleuron}
        />
      </div>
      <div className={styles.body}>
        <div className={styles.textContent}>
          <h2 className={styles.heading}>在语境中学习词汇</h2>
          <img
            src={publicAssetUrl('assets/svg/underline-handdrawn.svg')}
            width="200"
            height="6"
            alt=""
            aria-hidden="true"
            className={styles.underline}
          />
          <p className={styles.dropcap}>每个词都在它的语境里</p>
          <button
            className={styles.cta}
            onClick={onStart}
            type="button"
            data-testid="hero-cta"
            data-prefetch-route="reading"
          >
            开始阅读
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
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
        <div className={styles.ringWrap}>
          <ProgressRing
            completed={progressCompleted}
            total={progressTotal}
          />
        </div>
      </div>
    </section>
  );
}
