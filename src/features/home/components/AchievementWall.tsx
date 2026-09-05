/**
 * 成就墙 (Design v3 — 2x2 / 4cols 徽章卡)
 *
 * 设计稿对齐:
 * - 标题含 fleuron 装饰 (Newsreader display)
 * - 2 cols mobile / 4 cols >=640px
 * - 徽章卡: rounded-xl + border + 微阴影, 48px icon + 名称
 * - locked: opacity 0.4 + grayscale
 * - stagger 入场动画 (通过 :global(.revealVisible) 驱动)
 */
import type { ReactNode } from 'react';
import { useAchievementStore } from '../../achievements/store/useAchievementStore';
import { publicAssetUrl } from '../../../platform/publicAssetUrl';
import styles from './AchievementWall.module.css';

interface AchievementWallProps {
  onOpenAll: () => void;
  revealClassName?: string;
}

const iconPath: Record<string, ReactNode> = {
  sailboat: (
    <path d="M3 18l2 2h14l2-2H3zm9-14v10l-7-2 7-8z" fill="currentColor" />
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
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
  ),
  'badge-500': (
    <polygon points="12,3 21,12 12,21 3,12" fill="none" stroke="currentColor" strokeWidth="2" />
  ),
  calendar: (
    <rect x="3" y="5" width="18" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
  ),
  'calendar-strong': (
    <rect x="2" y="4" width="20" height="18" rx="2" fill="currentColor" />
  ),
  hands: (
    <path d="M5 11l4 4 4-4-4-4-4 4zm10 0l-4 4-4-4 4-4 4 4z" fill="currentColor" />
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
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="3 2" />
  ),
};

export function AchievementWall({ onOpenAll, revealClassName }: AchievementWallProps) {
  const achievements = useAchievementStore((s) => s.achievements);
  const unlocked = achievements
    .filter((a) => a.unlocked && a.category !== 'hidden')
    .slice(0, 4);
  const locked = achievements
    .filter((a) => !a.unlocked && a.category !== 'hidden')
    .slice(0, 4 - unlocked.length);

  const totalUnlocked = achievements.filter((a) => a.unlocked).length;
  const total = achievements.length;
  const rootClass = revealClassName
    ? `${styles.wall} ${revealClassName}`
    : styles.wall;

  return (
    <section className={rootClass} aria-label="成就">
      <header className={styles.header}>
        <h2 className={styles.title}>
          <img
            src={publicAssetUrl('assets/svg/ornament-fleuron.svg')}
            width="20"
            height="20"
            alt=""
            aria-hidden="true"
          />
          成就
        </h2>
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
            <div className={styles.iconWrap}>
              <svg viewBox="0 0 24 24" width="40" height="40" aria-hidden="true">
                {iconPath[a.iconKey] || iconPath.hidden}
              </svg>
            </div>
            <span className={styles.tileName}>{a.title}</span>
          </div>
        ))}
        {locked.map((a) => (
          <div key={a.id} className={`${styles.tile} ${styles.locked}`} title={a.description}>
            <div className={styles.iconWrap}>
              <svg viewBox="0 0 24 24" width="40" height="40" aria-hidden="true">
                {iconPath[a.iconKey] || iconPath.hidden}
              </svg>
            </div>
            <span className={styles.tileName}>{a.title}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
