/**
 * OfflineBanner (v1.4.1 Stage 2)
 *
 * 全局顶部 sticky banner, 用于展示"当前处于离线模式"提示.
 * 数据流:
 *   navigator.onLine === false
 *     -> useOfflineModeStore.isOffline = true
 *     -> useToastStore.showNotification('offline-mode', message)
 *     -> <OfflineBanner /> 渲染对应条目
 *     -> 用户点击 X 调用 useToastStore.dismissNotification(key) 关闭
 *
 * 与 NotificationBanner 的关系:
 * - 共享 useToastStore.notifications 字典, 复用 'offline-mode' key
 * - 视觉风格与 NotificationBanner 一致 (暖白底 + 强调色), 但用 red 系表达"离线"
 * - prefers-reduced-motion 兼容: 复用 NotificationBanner.module.css 模式 (0 动画)
 * - 移动端响应式: 1rem padding, 100% max-width
 *
 * 0 emoji 硬约束: 全程用 SVG icon 表达语义.
 */

import { useToastStore } from '../store/useToastStore';
import { useOfflineModeStore, OFFLINE_MODE_NOTIFICATION_KEY } from '../features/llm/store/offlineMode';
import styles from './NotificationBanner.module.css';

/** v1.4.1 Stage 2: 关注的通知 key (offline mode) */
export { OFFLINE_MODE_NOTIFICATION_KEY };

export function OfflineBanner() {
  const message = useToastStore((s) => s.notifications[OFFLINE_MODE_NOTIFICATION_KEY]);
  const isOffline = useOfflineModeStore((s) => s.isOffline);
  const dismiss = useToastStore((s) => s.dismissNotification);

  // 无通知 + 非 offline -> 不渲染 (与 NotificationBanner 行为一致)
  if (!message || !isOffline) return null;

  return (
    <div
      className={styles.banner}
      role="status"
      aria-live="polite"
      data-testid="offline-banner"
      style={{
        backgroundColor: 'var(--color-wrong-bg, #f5e6e6)',
        borderBottom: '1px solid var(--color-wrong, #8b3a3a)',
        borderLeft: '3px solid var(--color-wrong, #8b3a3a)',
      }}
    >
      <span className={styles.icon} aria-hidden="true">
        <svg viewBox="0 0 20 20" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M3.707 2.293a1 1 0 00-1.414 1.414l6.921 6.922c.05.062.105.118.165.171l6.91 6.91a1 1 0 001.415-1.414l-6.92-6.92a1.005 1.005 0 00-.166-.171L3.707 2.293zM10 4a1 1 0 011 1v4a1 1 0 11-2 0V5a1 1 0 011-1zm0 9a1 1 0 100 2 1 1 0 000-2z"
            clipRule="evenodd"
          />
        </svg>
      </span>
      <span className={styles.message} data-testid="offline-banner-message">
        {message}
      </span>
      <button
        type="button"
        className={styles.close}
        onClick={() => dismiss(OFFLINE_MODE_NOTIFICATION_KEY)}
        aria-label="关闭离线提示"
        data-testid="offline-banner-close"
      >
        ×
      </button>
    </div>
  );
}

export default OfflineBanner;
