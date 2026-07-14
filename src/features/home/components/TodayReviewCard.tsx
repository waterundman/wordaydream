/**
 * v2.0.0 Stage 3: 今日复习卡片 (Contract 58).
 *
 * 显示 dueCards.length, 点击触发复习.
 * dueCards.length === 0 时不渲染.
 * 0 emoji, SVG 图标, 沿用 v1.8.0 配色.
 */
import styles from './TodayReviewCard.module.css';

interface TodayReviewCardProps {
  dueCount: number;
  onStartReview: () => void;
  revealClassName?: string;
}

export function TodayReviewCard({ dueCount, onStartReview, revealClassName }: TodayReviewCardProps) {
  if (dueCount === 0) return null;

  const rootClass = revealClassName
    ? `${styles.card} ${revealClassName}`
    : styles.card;

  return (
    <div className={rootClass} role="status" aria-label={`${dueCount} 个词待复习`}>
      <svg
        viewBox="0 0 24 24"
        width="20"
        height="20"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className={styles.icon}
      >
        <path d="M3 12a9 9 0 1 0 9-9" />
        <path d="M3 4v5h5" />
      </svg>
      <span className={styles.text}>
        {dueCount} 个词待复习
      </span>
      <button
        className={styles.btn}
        onClick={onStartReview}
        type="button"
      >
        开始复习
      </button>
    </div>
  );
}
