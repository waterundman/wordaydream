/**
 * 成就列表 Modal (Stage 4)
 *
 * 设计要点:
 * - 全部 13 个成就按 category (starter / progress / explore / hidden) 分组
 * - hidden 分类在未解锁时显示为 "?" + 占位描述, 解锁后展示真实 title
 * - ESC 关闭 + 点击 overlay 关闭, 阻止冒泡避免误关
 * - 图标全部内联 SVG, 不引入额外资源
 * - 遵守 prefers-reduced-motion: 关闭淡入/上滑动画
 */
import { useEffect, type ReactNode } from 'react';
import { useAchievementStore } from '../store/useAchievementStore';
import { ALL_ACHIEVEMENTS } from '../services/achievementEngine';
import type { Achievement, AchievementCategory } from '../types';
import styles from './AchievementListModal.module.css';

interface AchievementListModalProps {
  open: boolean;
  onClose: () => void;
}

const ICONS: Record<string, ReactNode> = {
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
    <path
      d="M12 2l3 7h7l-6 4 2 7-6-4-6 4 2-7-6-4h7z"
      fill="currentColor"
    />
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

const CATEGORY_LABELS: Record<AchievementCategory, string> = {
  starter: '入门',
  progress: '进度',
  explore: '探索',
  hidden: '隐藏',
};

const CATEGORY_ORDER: readonly AchievementCategory[] = [
  'starter',
  'progress',
  'explore',
  'hidden',
] as const;

export function AchievementListModal({ open, onClose }: AchievementListModalProps) {
  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [open, onClose]);

  if (!open) return null;

  const achievements = useAchievementStore.getState().achievements;
  const map = new Map<string, Achievement>(achievements.map((a) => [a.id, a]));
  const grouped = CATEGORY_ORDER.map((cat) => ({
    cat,
    label: CATEGORY_LABELS[cat],
    items: ALL_ACHIEVEMENTS.filter((a) => a.category === cat).map(
      (a) => map.get(a.id) || a,
    ),
  }));

  return (
    <div
      className={styles.overlay}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="成就列表"
    >
      <div
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
      >
        <header className={styles.header}>
          <h2 className={styles.title}>成就</h2>
          <button
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="关闭"
            type="button"
          >
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path
                d="M6 6l12 12M18 6L6 18"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>
        <div className={styles.body}>
          {grouped.map((g) => (
            <section key={g.cat} className={styles.group}>
              <h3 className={styles.groupTitle}>{g.label}</h3>
              <ul className={styles.list}>
                {g.items.map((a) => {
                  const isHidden = a.category === 'hidden' && !a.unlocked;
                  return (
                    <li key={a.id} className={styles.item}>
                      <div
                        className={`${styles.icon} ${
                          a.unlocked ? styles.unlocked : styles.locked
                        }`}
                        aria-hidden="true"
                      >
                        <svg
                          viewBox="0 0 24 24"
                          width="20"
                          height="20"
                        >
                          {ICONS[a.iconKey] || ICONS.hidden}
                        </svg>
                      </div>
                      <div className={styles.info}>
                        <div className={styles.itemTitle}>
                          {isHidden ? '?' : a.title}
                        </div>
                        <div className={styles.itemDesc}>
                          {isHidden
                            ? '完成隐藏条件后揭晓'
                            : a.description}
                        </div>
                        {a.unlocked && a.unlockedAt != null && (
                          <div className={styles.unlockedAt}>
                            {new Date(a.unlockedAt).toLocaleDateString(
                              'zh-CN',
                            )}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
