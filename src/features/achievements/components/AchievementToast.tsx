/**
 * 成就解锁 Toast
 *
 * 阶段 2 触发层: 订阅 `useAchievementStore.newUnlocks`, 当有新解锁时
 * 浮出右上角提示, 4 秒后自动调用 `dismissToast` 关闭。
 *
 * 设计要点:
 * - 一次只显示队列头 (first), 其余用右上角徽标 +N 提示
 * - 入场动画 0.4s slideInRight, 兼容 prefers-reduced-motion
 * - 图标使用内联 SVG (no emoji), 13 个 iconKey 对应 12 种几何图形
 * - 角色 `role="status"` + `aria-live="polite"` 让屏幕阅读器自然播报
 */
import { useEffect, type ReactNode } from 'react';
import { useAchievementStore } from '../store/useAchievementStore';
import styles from './AchievementToast.module.css';

const AUTO_DISMISS_MS = 4000;

export function AchievementToast() {
  const newUnlocks = useAchievementStore((s) => s.newUnlocks);
  const dismissToast = useAchievementStore((s) => s.dismissToast);

  useEffect(() => {
    if (newUnlocks.length === 0) return;
    const first = newUnlocks[0];
    const timer = setTimeout(() => dismissToast(first.achievement.id), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [newUnlocks, dismissToast]);

  if (newUnlocks.length === 0) return null;
  const first = newUnlocks[0];
  const remaining = newUnlocks.length - 1;

  return (
    <div className={styles.toastContainer} role="status" aria-live="polite">
      <div className={styles.toast}>
        <div className={styles.iconWrap}>
          <AchievementIcon iconKey={first.achievement.iconKey} />
        </div>
        <div className={styles.body}>
          <div className={styles.title}>成就解锁</div>
          <div className={styles.name}>{first.achievement.title}</div>
          <div className={styles.desc}>{first.achievement.description}</div>
        </div>
        {remaining > 0 && <div className={styles.badge}>+{remaining}</div>}
      </div>
    </div>
  );
}

/**
 * 内联 SVG 图标 (no emoji, 与精装书暖色风格一致)
 *
 * 12 个几何图形对应 ALL_ACHIEVEMENTS 中的 iconKey, 未匹配时回退到 hidden。
 * 全部使用 currentColor, 由父容器控制颜色 (暖金/暖橙主题)。
 */
const ICONS: Record<string, ReactNode> = {
  sailboat: <path d="M3 18l2 2h14l2-2H3zm9-14v10l-7-2 7-8z" />,
  flame: <path d="M12 2c-1 4-4 5-4 9a4 4 0 008 0c0-2-1-3-1-4 2 0 3 2 3 4a6 6 0 11-12 0c0-4 4-6 6-9z" />,
  'flame-strong': (
    <path d="M12 1c-1 5-5 6-5 11a5 5 0 0010 0c0-3-1-4-1-5 2 0 4 2 4 5a7 7 0 11-14 0c0-5 5-7 6-11z" />
  ),
  star: <path d="M12 2l3 7h7l-6 4 2 7-6-4-6 4 2-7-6-4h7z" />,
  'badge-50': <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />,
  'badge-500': (
    <polygon points="12,3 21,12 12,21 3,12" fill="none" stroke="currentColor" strokeWidth="2" />
  ),
  calendar: (
    <rect x="3" y="5" width="18" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
  ),
  'calendar-strong': <rect x="2" y="4" width="20" height="18" rx="2" fill="currentColor" />,
  hands: <path d="M5 11l4 4 4-4-4-4-4 4zm10 0l-4 4-4-4 4-4 4 4z" />,
  mountain: <path d="M3 20l6-12 4 8 2-4 6 8H3z" />,
  puzzle: <path d="M4 4h7v3a2 2 0 104 0V4h7v7h-3a2 2 0 100 4v7H4v-7h3a2 2 0 100-4H4V4z" />,
  hidden: (
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="3 2" />
  ),
};

function AchievementIcon({ iconKey }: { iconKey: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="28"
      height="28"
      fill="currentColor"
      className={styles.icon}
      aria-hidden="true"
    >
      {ICONS[iconKey] ?? ICONS.hidden}
    </svg>
  );
}
