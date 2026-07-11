/**
 * v1.5.2 Stage 1: ThemeSwitcher (D-3)
 *
 * 三按钮主题切换 UI (light / dark / sepia), 用于设置面板.
 * - 0 emoji: 用 inline SVG 图标 + 纯文字标签, 不依赖 emoji 字体.
 * - 当前主题按钮高亮 (aria-pressed=true + active 样式).
 * - 点击调用 useSettingsStore.setTheme(theme), 触发 ThemeProvider 写 data-theme 属性.
 * - 跨刷新保留: 沿用 useSettingsStore 的 persist middleware.
 * - 移动端响应: 三按钮在窄屏自动堆叠 (CSS module 处理).
 */
import type { CSSProperties } from 'react';
import { useSettingsStore, type Theme } from '../features/settings/store/useSettingsStore';
import styles from './ThemeSwitcher.module.css';

interface ThemeOption {
  value: Theme;
  label: string;
  description: string;
  swatch: string;
}

const THEME_OPTIONS: ReadonlyArray<ThemeOption> = [
  {
    value: 'light',
    label: '明亮',
    description: '默认主题, 温暖纸张背景',
    swatch: 'linear-gradient(135deg, #faf8f5 50%, #1c1917 50%)',
  },
  {
    value: 'dark',
    label: '暗色',
    description: '暖调暗色, 夜晚阅读',
    swatch: 'linear-gradient(135deg, #1c1917 50%, #faf8f5 50%)',
  },
  {
    value: 'sepia',
    label: '羊皮',
    description: '米黄暖色, 护眼阅读',
    swatch: 'linear-gradient(135deg, #f4ecd8 50%, #5b4636 50%)',
  },
];

export function ThemeSwitcher() {
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);

  return (
    <div
      className={styles.themeSwitcher}
      role="radiogroup"
      aria-label="主题切换"
    >
      {THEME_OPTIONS.map((option) => {
        const isActive = theme === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            aria-pressed={isActive}
            aria-label={`${option.label} 主题 - ${option.description}`}
            className={`${styles.themeBtn} ${isActive ? styles.active : ''}`}
            onClick={() => setTheme(option.value)}
            style={{ '--swatch': option.swatch } as CSSProperties}
          >
            <span
              className={styles.themeSwatch}
              aria-hidden="true"
            />
            <span className={styles.themeBody}>
              <span className={styles.themeLabel}>{option.label}</span>
              <span className={styles.themeDescription}>{option.description}</span>
            </span>
            <span
              className={styles.themeCheck}
              aria-hidden="true"
            >
              {isActive ? (
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="3 8 7 12 13 4" />
                </svg>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
