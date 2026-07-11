/**
 * 成就墙 (Stage 3: 主页)
 *
 * 显示至多 4 个最近解锁 + 2 个待解锁预览, 末尾 "查看全部 (x/y)" 链接。
 * 不渲染 hidden 类, 隐藏成就只在 "全部" 模态中显示。
 */
import type { ReactNode } from 'react';
import { useAchievementStore } from '../../achievements/store/useAchievementStore';
import styles from './AchievementWall.module.css';

interface AchievementWallProps {
  onOpenAll: () => void;
  /**
   * Stage 4 滚动揭示 className (来自 useScrollReveal). 可选, 透传到根元素.
   * 形如 'reveal' (initial) 或 'reveal revealVisible' (visible).
   */
  revealClassName?: string;
}

/**
 * 内联 SVG 图标 (no emoji), 与 AchievementToast 保持一致。
 * 使用 ReactNode 而非 JSX.Element 以兼容 React 19 / verbatimModuleSyntax。
 */
const iconPath: Record<string, ReactNode> = {
  sailboat: (
    <path
      d="M3 18l2 2h14l2-2H3zm9-14v10l-7-2 7-8z"
      fill="currentColor"
    />
  ),
  flame: (
    <path
      d="M12 2c-1 4-4 5-4 9a4 4 0 008 0c0-2-1-3-1-4 2 0 3 2 3 4a6 6 0 11-12 0c0-4 4-6 6-9z"
      fill="currentColor"
    />
  ),
  'flame-strong': (
    <path
      d="M12 1c-1 5-5 6-5 11a5 5 0 0010 0c0-3-1-4-1-5 2 0 4 2 4 5a7 7 0 11-14 0c0-5 5-7 6-11z"
      fill="currentColor"
    />
  ),
  star: (
    <path d="M12 2l3 7h7l-6 4 2 7-6-4-6 4 2-7-6-4h7z" fill="currentColor" />
  ),
  'badge-50': (
    <circle
      cx="12"
      cy="12"
      r="9"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    />
  ),
  'badge-500': (
    <polygon
      points="12,3 21,12 12,21 3,12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    />
  ),
  calendar: (
    <rect
      x="3"
      y="5"
      width="18"
      height="16"
      rx="2"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    />
  ),
  'calendar-strong': (
    <rect x="2" y="4" width="20" height="18" rx="2" fill="currentColor" />
  ),
  hands: (
    <path
      d="M5 11l4 4 4-4-4-4-4 4zm10 0l-4 4-4-4 4-4 4 4z"
      fill="currentColor"
    />
  ),
  mountain: (
    <path d="M3 20l6-12 4 8 2-4 6 8H3z" fill="currentColor" />
  ),
  puzzle: (
    <path
      d="M4 4h7v3a2 2 0 104 0V4h7v7h-3a2 2 0 100 4v7H4v-7h3a2 2 0 100-4H4V4z"
      fill="currentColor"
    />
  ),
  hidden: (
    <circle
      cx="12"
      cy="12"
      r="9"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeDasharray="3 2"
    />
  ),
};

export function AchievementWall({ onOpenAll, revealClassName }: AchievementWallProps) {
  const achievements = useAchievementStore((s) => s.achievements);
  const unlocked = achievements
    .filter((a) => a.unlocked && a.category !== 'hidden')
    .slice(0, 4);
  const locked = achievements
    .filter((a) => !a.unlocked && a.category !== 'hidden')
    .slice(0, 2);

  const totalUnlocked = achievements.filter((a) => a.unlocked).length;
  const total = achievements.length;
  const rootClass = revealClassName
    ? `${styles.wall} ${revealClassName}`
    : styles.wall;

  return (
    <section className={rootClass} aria-label="成就">
      <header className={styles.header}>
        <h2 className={styles.title}>成就</h2>
        <button
          className={styles.allLink}
          onClick={onOpenAll}
          type="button"
        >
          查看全部 ({totalUnlocked}/{total})
        </button>
      </header>
      <div className={styles.grid}>
        {unlocked.length === 0 && locked.length === 0 && (
          <div className={styles.empty}>完成第一次阅读解锁成就</div>
        )}
        {unlocked.map((a) => (
          <div key={a.id} className={styles.tile} title={a.description}>
            <div className={`${styles.icon} ${styles.unlocked}`}>
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                {iconPath[a.iconKey] || iconPath.hidden}
              </svg>
            </div>
            <div className={styles.tileName}>{a.title}</div>
          </div>
        ))}
        {locked.map((a) => (
          <div key={a.id} className={styles.tile} title={a.description}>
            <div className={`${styles.icon} ${styles.locked}`}>
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                {iconPath[a.iconKey] || iconPath.hidden}
              </svg>
            </div>
            <div className={styles.tileName}>{a.title}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
