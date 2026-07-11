/**
 * 进度圆环 (Stage 3: 主页)
 *
 * 圆环 + 中心数字, 表示今日已学 / 应学比例。
 *
 * v1.5.1 Stage 3 新增:
 * - 可选 `label` prop: 渲染在 SVG 外部下方, 默认隐藏
 * - 调用方注入 "今日完成 X/Y 词" 之类的人类可读说明
 */
import styles from './ProgressRing.module.css';

interface ProgressRingProps {
  completed: number;
  total: number;
  label?: string;
  /**
   * Stage 4 滚动揭示 className (来自 useScrollReveal). 可选, 透传到根元素.
   * 形如 'reveal' (initial) 或 'reveal revealVisible' (visible).
   */
  revealClassName?: string;
}

export function ProgressRing({ completed, total, label, revealClassName }: ProgressRingProps) {
  const radius = 56;
  const circumference = 2 * Math.PI * radius;
  const pct = total > 0 ? Math.min(1, completed / total) : 0;
  const dashOffset = circumference * (1 - pct);
  const rootClass = revealClassName
    ? `${styles.wrap} ${revealClassName}`
    : styles.wrap;

  return (
    <div className={rootClass} aria-label={`今日进度 ${completed} / ${total}`}>
      <svg
        viewBox="0 0 140 140"
        width="140"
        height="140"
        className={styles.ring}
        role="img"
      >
        <circle
          cx="70"
          cy="70"
          r={radius}
          stroke="var(--color-border, #e8e4dc)"
          strokeWidth="8"
          fill="none"
        />
        <circle
          cx="70"
          cy="70"
          r={radius}
          stroke="var(--color-flame, #e07a3b)"
          strokeWidth="8"
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          transform="rotate(-90 70 70)"
          className={styles.progress}
        />
        <text x="70" y="78" textAnchor="middle" className={styles.value}>
          {completed}
        </text>
        <text x="70" y="95" textAnchor="middle" className={styles.sublabel}>
          / {total}
        </text>
      </svg>
      {label ? <p className={styles.label}>{label}</p> : null}
    </div>
  );
}
