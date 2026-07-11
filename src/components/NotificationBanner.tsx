/**
 * NotificationBanner (v1.2.0)
 *
 * 全局顶部 sticky banner, 用于展示持久性系统通知 (如 LLM fallback).
 *
 * 数据流:
 *   useToastStore.notifications['llm-fallback'] = message
 *     -> <NotificationBanner /> 渲染对应条目
 *     -> 用户点击 X 调用 dismissNotification(key) 关闭
 *
 * 设计原则:
 * - 与 ToastContainer (短提示) 区分: notifications 不自动消失, 需用户主动 dismiss
 * - 暖色背景 (amber 调), 沿用项目 tokens.css 色板 (暖白 #faf8f5 + 深墨 #1c1917, 强调 #92400e)
 * - prefers-reduced-motion 兼容: 无 slide-in 动画 (CSS module 内已处理)
 * - 移动端响应式: max-width 100%, padding 0.75rem 1rem
 * - 单一职责: 仅展示 + dismiss, 不发起新通知 (由 router / 其他模块调用 useToastStore.showNotification)
 */

import { useToastStore } from '../store/useToastStore';
import styles from './NotificationBanner.module.css';

/** 关注的通知 key: LLM fallback (与 router.ts 中 LLM_FALLBACK_NOTIFICATION_KEY 保持一致) */
export const LLM_FALLBACK_KEY = 'llm-fallback';

export function NotificationBanner() {
  // selector 拆细: notifications + dismiss, 避免整 store 重渲染
  const message = useToastStore((s) => s.notifications[LLM_FALLBACK_KEY]);
  const dismiss = useToastStore((s) => s.dismissNotification);

  // 无通知 -> 不渲染任何 DOM (T03 验证点)
  if (!message) return null;

  return (
    <div className={styles.banner} role="status" aria-live="polite" data-testid="notification-banner">
      <span className={styles.icon} aria-hidden="true">
        <svg viewBox="0 0 20 20" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M8.485 3.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 3.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z"
            clipRule="evenodd"
          />
        </svg>
      </span>
      <span className={styles.message} data-testid="notification-banner-message">
        {message}
      </span>
      <button
        type="button"
        className={styles.close}
        onClick={() => dismiss(LLM_FALLBACK_KEY)}
        aria-label="关闭通知"
        data-testid="notification-banner-close"
      >
        ×
      </button>
    </div>
  );
}

export default NotificationBanner;
