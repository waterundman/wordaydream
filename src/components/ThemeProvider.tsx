/**
 * v1.5.2 Stage 1: ThemeProvider (D-3)
 *
 * 监听 useSettingsStore.theme 字段, 把当前主题写入 <html data-theme="..."> 属性,
 * 配合 src/styles/tokens.css 中 :root[data-theme='dark'] / :root[data-theme='sepia']
 * 的 CSS variable 重写实现 light / dark / sepia 三主题切换.
 *
 * 设计要点:
 * - 0 props breaking change: 接受任意 children, 透明 wrapper.
 * - 0 emoji, 0 icon dependency: 全部主题由 CSS 控制, 组件层只负责写属性.
 * - SSR / 0 window 兼容: 仅在 effect 内访问 document, 不会在 SSR 阶段崩.
 * - 默认 'light' 与 v1.5.1 视觉完全一致 (0 breaking change).
 */
import { useEffect, type ReactNode } from 'react';
import { useSettingsStore } from '../features/settings/store/useSettingsStore';

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const theme = useSettingsStore((s) => s.theme);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return <>{children}</>;
}
