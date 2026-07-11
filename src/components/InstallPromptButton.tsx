/**
 * InstallPromptButton (v1.4.1 Stage 2)
 *
 * Settings 面板内按钮, 用于触发 PWA install 流程.
 * 数据流:
 *   window 'beforeinstallprompt' 事件
 *     -> useOfflineModeStore.setInstallPromptEvent(event)
 *     -> <InstallPromptButton /> 渲染 "安装 App" 按钮
 *     -> 用户点击 -> event.prompt() -> 用户确认 -> 'appinstalled' 事件
 *     -> setInstallPromptEvent(null), 按钮自动消失
 *
 * 设计原则:
 * - 仅在 installPromptEvent 存在时渲染 (浏览器判定可安装时才出现)
 * - 复用 tokens.css 色板 (var(--color-accent) 绿)
 * - 0 emoji, 用 SVG download icon
 * - prefers-reduced-motion: 复用 var(--transition-fast) 框架 (由 tokens.css 全局禁用)
 *
 * 测试覆盖:
 * - sandbox 不验证浏览器行为, 仅 TypeScript 编译 + 单元测试
 * - v1.5.2 fix M10: 暂无对应单元测试文件; 若需补测, 请创建
 *   InstallPromptButton.test.tsx 覆盖 mount/click/dismiss 行为.
 */

import { useState } from 'react';
import { useOfflineModeStore } from '../features/llm/store/offlineMode';
import styles from './InstallPromptButton.module.css';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt(): Promise<void>;
}

function isBeforeInstallPromptEvent(value: unknown): value is BeforeInstallPromptEvent {
  if (!value || typeof value !== 'object') return false;
  const e = value as { prompt?: unknown; userChoice?: unknown };
  return typeof e.prompt === 'function' && typeof e.userChoice === 'object';
}

export function InstallPromptButton() {
  const event = useOfflineModeStore((s) => s.installPromptEvent);
  const clearEvent = useOfflineModeStore((s) => s.setInstallPromptEvent);
  const [installing, setInstalling] = useState(false);

  // 没有可用的 install prompt -> 不渲染
  if (!isBeforeInstallPromptEvent(event)) return null;

  const handleInstall = async () => {
    if (installing) return;
    setInstalling(true);
    try {
      await event.prompt();
      const choice = await event.userChoice;
      // 无论用户接受还是拒绝, 都清理事件 (浏览器只触发一次 beforeinstallprompt)
      clearEvent(null);
      // 静默记录, 后续可以接 telemetry
      void choice.outcome;
    } catch {
      // 静默忽略 prompt 失败 (e.g. 用户取消系统对话框)
      clearEvent(null);
    } finally {
      setInstalling(false);
    }
  };

  return (
    <button
      type="button"
      className={styles.button}
      onClick={handleInstall}
      disabled={installing}
      aria-label="安装应用到主屏幕"
      data-testid="install-prompt-button"
    >
      <span className={styles.icon} aria-hidden="true">
        <svg viewBox="0 0 20 20" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z"
            clipRule="evenodd"
          />
        </svg>
      </span>
      <span className={styles.label}>{installing ? '正在准备安装...' : '安装到主屏幕'}</span>
    </button>
  );
}

export default InstallPromptButton;
