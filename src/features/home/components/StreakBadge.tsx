/**
 * 连续学习天数徽标 (Stage 3: 主页)
 *
 * 设计要点:
 * - 火焰 SVG 内联图标 (no emoji)
 * - 数字 +1 天以暖橙色高亮, 0 天为灰
 * - 不引入额外依赖, 仅订阅 `useStreakStore.currentStreak`
 */
import { useStreakStore } from '../../streak/store/useStreakStore';
import styles from './StreakBadge.module.css';

export function StreakBadge() {
  const streak = useStreakStore((s) => s.currentStreak);
  const isActive = streak > 0;
  return (
    <div
      className={`${styles.badge} ${isActive ? styles.active : styles.empty}`}
      title={isActive ? `连续学习 ${streak} 天` : '尚未开始连续学习'}
      aria-label={isActive ? `连续学习 ${streak} 天` : '尚未开始连续学习'}
    >
      <svg viewBox="0 0 24 24" width="22" height="22" className={styles.flame} data-testid="streak-flame" aria-hidden="true">
        <path
          d="M12 2c-1 4-4 5-4 9a4 4 0 008 0c0-2-1-3-1-4 2 0 3 2 3 4a6 6 0 11-12 0c0-4 4-6 6-9z"
          fill="currentColor"
        />
      </svg>
      <span className={styles.number}>{streak}</span>
    </div>
  );
}
