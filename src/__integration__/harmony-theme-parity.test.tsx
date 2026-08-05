/**
 * Wordaydream Harmony Stage 4 — T06 三套主题切换对等测试
 *
 * 测试对象: light / dark / sepia 三主题在模拟 ArkWeb 内的功能对等
 *
 * 测试策略 (与 FEATURE_PARITY_CHECKLIST.md §4.2 对齐):
 * - 静态扫描 tokens.css, 验证三套主题色板定义完整
 * - useSettingsStore.setTheme(theme) 切换 + 持久化 (localStorage version 8)
 * - ThemeProvider 组件渲染时把 theme 写入 document.documentElement.dataset.theme
 * - 三主题下的关键色变量值差异验证 (paper / ink / accent / 状态色)
 * - 阅读区可读性约束: light (#faf8f5 + #1c1917) / dark / sepia 各自的 paper + ink 对比
 *
 * 0 emoji (项目硬约束)
 * 0 改动: 不修改任何源文件, 仅新增测试; Web 端 vitest 656/656 基线不破坏
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';

import { useSettingsStore, type Theme } from '../features/settings/store/useSettingsStore';
import { ThemeProvider } from '../components/ThemeProvider';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TOKENS_PATH = resolve(__dirname, '../styles/tokens.css');

// ======================== 工具 ========================

/**
 * 读取 tokens.css 源码 (静态扫描三主题色板).
 */
function readTokensSource(): string {
  return readFileSync(TOKENS_PATH, 'utf-8');
}

/**
 * 清空 localStorage / documentElement dataset, 隔离测试.
 */
function resetEnvironment(): void {
  if (typeof window !== 'undefined') {
    window.localStorage.clear();
    window.sessionStorage.clear();
  }
  if (typeof document !== 'undefined') {
    delete document.documentElement.dataset.theme;
  }
}

/**
 * 包装 ThemeProvider + children, 用于渲染测试.
 */
function renderWithThemeProvider(theme: Theme, children: ReactNode) {
  useSettingsStore.getState().setTheme(theme);
  return render(<ThemeProvider>{children}</ThemeProvider>);
}

// ======================== 测试隔离 ========================

beforeEach(() => {
  resetEnvironment();
  // 重置 settings store 到默认 (light)
  useSettingsStore.getState().resetAll();
});

afterEach(() => {
  resetEnvironment();
  useSettingsStore.getState().resetAll();
  vi.restoreAllMocks();
});

// ======================== T06.1: tokens.css 三套主题色板定义 ========================

describe('[T06.1] tokens.css 三套主题色板定义完整 (静态扫描)', () => {
  let source: string;

  beforeEach(() => {
    source = readTokensSource();
  });

  it('light 主题 (:root 默认) 定义 --color-paper / --color-ink / --color-accent', () => {
    // light 主题是 :root 默认值, 不需要 data-theme 属性
    expect(source).toMatch(/--color-paper:\s*#faf9f5/);
    expect(source).toMatch(/--color-ink:\s*#1b1b19/);
    expect(source).toMatch(/--color-accent:\s*#d97757/);
  });

  it('dark 主题 (:root[data-theme="dark"]) 定义 paper 深色 + ink 浅色', () => {
    expect(source).toMatch(/:root\[data-theme='dark'\]/);
    // dark 主题内 paper 为深色 (#1c1917), ink 为浅色 (#faf8f5)
    expect(source).toMatch(/--color-paper:\s*#1c1917/);
    expect(source).toMatch(/--color-ink:\s*#faf8f5/);
  });

  it('sepia 主题 (:root[data-theme="sepia"]) 定义 paper 暖米色 + ink 深棕', () => {
    expect(source).toMatch(/:root\[data-theme='sepia'\]/);
    // sepia 主题 paper 为暖米色 (#f4ecd8), ink 为深棕 (#5b4636)
    expect(source).toMatch(/--color-paper:\s*#f4ecd8/);
    expect(source).toMatch(/--color-ink:\s*#5b4636/);
  });

  it('三主题都定义 12 个状态色变量 (danger / warning / success / error)', () => {
    // 状态色变量清单 (v2.2.4 Stage 3)
    const statusColorVars = [
      '--color-danger',
      '--color-danger-hover',
      '--color-danger-text',
      '--color-warning-bg',
      '--color-warning-border',
      '--color-warning-text',
      '--color-warning-accent',
      '--color-success-bg',
      '--color-success-text',
      '--color-error-strong',
      '--color-error-bg',
      '--color-error-border',
    ];

    // 每个状态色变量在 tokens.css 中至少出现 3 次 (light + dark + sepia)
    for (const varName of statusColorVars) {
      const regex = new RegExp(
        `${varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*[^;]+;`
      );
      const matches = source.match(new RegExp(regex, 'g'));
      expect(
        matches && matches.length >= 3,
        `${varName} 应在 light / dark / sepia 三主题中各定义一次, 实际 ${matches?.length ?? 0} 次`
      ).toBe(true);
    }
  });

  it('主题过渡 CSS 变量 --theme-transition 定义 (200ms ease)', () => {
    expect(source).toMatch(/--theme-transition:\s*background-color\s+200ms\s+ease/);
  });

  it('prefers-reduced-motion 媒体查询禁用 --theme-transition', () => {
    expect(source).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    // reduced-motion 下 theme-transition 应被设为 none
    expect(source).toMatch(/--theme-transition:\s*none/);
  });
});

// ======================== T06.2: useSettingsStore.setTheme 切换 + 持久化 ========================

describe('[T06.2] useSettingsStore.setTheme 切换主题 + localStorage 持久化 (version 8)', () => {
  it('setTheme("dark") 切换 theme 字段 + localStorage 持久化', () => {
    useSettingsStore.getState().setTheme('dark');
    expect(useSettingsStore.getState().theme).toBe('dark');

    // 验证 localStorage 持久化 (key = wordaydream:settings)
    const raw = window.localStorage.getItem('wordaydream:settings');
    expect(raw, 'localStorage[wordaydream:settings] 应被写入').not.toBeNull();
    const persisted = JSON.parse(raw!);
    expect(persisted.state.theme).toBe('dark');
    expect(persisted.version).toBe(8);
  });

  it('setTheme("sepia") 切换 theme 字段 + localStorage 持久化', () => {
    useSettingsStore.getState().setTheme('sepia');
    expect(useSettingsStore.getState().theme).toBe('sepia');

    const raw = window.localStorage.getItem('wordaydream:settings');
    expect(raw).not.toBeNull();
    const persisted = JSON.parse(raw!);
    expect(persisted.state.theme).toBe('sepia');
  });

  it('setTheme("light") 切换 theme 字段 + localStorage 持久化', () => {
    // 先切到 dark, 再切回 light
    useSettingsStore.getState().setTheme('dark');
    useSettingsStore.getState().setTheme('light');
    expect(useSettingsStore.getState().theme).toBe('light');

    const raw = window.localStorage.getItem('wordaydream:settings');
    expect(raw).not.toBeNull();
    const persisted = JSON.parse(raw!);
    expect(persisted.state.theme).toBe('light');
  });

  it('setTheme 非法值回退到 light (normalizeTheme)', () => {
    // 非法 theme 值应被 normalizeTheme 校正为 light
    useSettingsStore.getState().setTheme('invalid-theme' as Theme);
    expect(useSettingsStore.getState().theme).toBe('light');
  });

  it('resetAll() 把 theme 重置为 light', () => {
    useSettingsStore.getState().setTheme('dark');
    expect(useSettingsStore.getState().theme).toBe('dark');

    useSettingsStore.getState().resetAll();
    expect(useSettingsStore.getState().theme).toBe('light');
  });

  it('theme 字段在 partialize 持久化范围内 (跨 reload 可恢复)', async () => {
    useSettingsStore.getState().setTheme('sepia');

    // 模拟 reload: resetAll 会把默认值写入 localStorage, 需先保存再还原
    const saved = window.localStorage.getItem('wordaydream:settings');
    useSettingsStore.getState().resetAll();
    expect(useSettingsStore.getState().theme).toBe('light');
    // 还原 resetAll 覆盖的 localStorage
    if (saved !== null) {
      window.localStorage.setItem('wordaydream:settings', saved);
    }

    // 重新水合
    await useSettingsStore.persist.rehydrate();

    // 验证 theme 恢复
    expect(useSettingsStore.getState().theme).toBe('sepia');
  });
});

// ======================== T06.3: ThemeProvider 把 theme 写入 documentElement ========================

describe('[T06.3] ThemeProvider 把 theme 写入 document.documentElement.dataset.theme', () => {
  it('theme="dark" 时 documentElement.dataset.theme === "dark"', () => {
    renderWithThemeProvider('dark', <div>test</div>);
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('theme="sepia" 时 documentElement.dataset.theme === "sepia"', () => {
    renderWithThemeProvider('sepia', <div>test</div>);
    expect(document.documentElement.dataset.theme).toBe('sepia');
  });

  it('theme="light" 时 documentElement.dataset.theme === "light"', () => {
    renderWithThemeProvider('light', <div>test</div>);
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('切换 theme 时 documentElement.dataset.theme 实时更新', () => {
    const { rerender } = renderWithThemeProvider('light', <div>test</div>);
    expect(document.documentElement.dataset.theme).toBe('light');

    // 切换到 dark
    useSettingsStore.getState().setTheme('dark');
    rerender(<ThemeProvider><div>test</div></ThemeProvider>);
    expect(document.documentElement.dataset.theme).toBe('dark');

    // 切换到 sepia
    useSettingsStore.getState().setTheme('sepia');
    rerender(<ThemeProvider><div>test</div></ThemeProvider>);
    expect(document.documentElement.dataset.theme).toBe('sepia');
  });

  it('ThemeProvider 不阻塞 children 渲染 (透明 wrapper)', () => {
    const { getByText } = renderWithThemeProvider('light', <div>child-content</div>);
    expect(getByText('child-content')).toBeInTheDocument();
  });

  it('卸载 ThemeProvider 不清除 documentElement.dataset.theme (避免闪烁, 由下一个 ThemeProvider 重设)', () => {
    const { unmount } = renderWithThemeProvider('dark', <div>test</div>);
    expect(document.documentElement.dataset.theme).toBe('dark');
    // 卸载后 dataset.theme 仍保留 (ThemeProvider 不在 cleanup 主动清, 避免主题闪烁)
    unmount();
    // 不强制断言值, 仅验证不抛错; 实际项目里 ThemeProvider 是 App 顶层, 不会卸载
    expect(document.documentElement.dataset.theme).toBeDefined();
  });
});

// ======================== T06.4: 三主题关键色变量值差异验证 ========================

describe('[T06.4] 三主题关键色变量值差异 (静态扫描 tokens.css)', () => {
  let source: string;

  beforeAll(() => {
    source = readTokensSource();
  });

  /**
   * 从 tokens.css 提取指定主题块内的 CSS 变量值.
   * light 主题变量在 :root { ... } 块中 (不含 data-theme).
   * dark / sepia 主题变量在 :root[data-theme='xxx'] { ... } 块中.
   */
  function extractThemeVar(theme: 'light' | 'dark' | 'sepia', varName: string): string | null {
    // 构造正则: light 用 :root { 段; dark/sepia 用 :root[data-theme='xxx'] { 段
    const blockStart =
      theme === 'light'
        ? /:root\s*\{/
        : new RegExp(`:root\\[data-theme='${theme}'\\]\\s*\\{`);
    const startMatch = source.match(blockStart);
    if (!startMatch || startMatch.index === undefined) return null;
    const startIdx = startMatch.index + startMatch[0].length;
    // 找匹配的闭合大括号 (简单计数, tokens.css 无嵌套)
    let depth = 1;
    let endIdx = startIdx;
    for (let i = startIdx; i < source.length; i++) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') {
        depth--;
        if (depth === 0) {
          endIdx = i;
          break;
        }
      }
    }
    const block = source.slice(startIdx, endIdx);
    const varRegex = new RegExp(
      `${varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*([^;]+);`
    );
    const m = block.match(varRegex);
    return m ? m[1].trim() : null;
  }

  it('light 主题: paper=#faf9f5, ink=#1b1b19 (暖白纸 + 深墨)', () => {
    expect(extractThemeVar('light', '--color-paper')).toBe('#faf9f5');
    expect(extractThemeVar('light', '--color-ink')).toBe('#1b1b19');
  });

  it('dark 主题: paper=#1c1917, ink=#faf8f5 (深底 + 浅字)', () => {
    expect(extractThemeVar('dark', '--color-paper')).toBe('#1c1917');
    expect(extractThemeVar('dark', '--color-ink')).toBe('#faf8f5');
  });

  it('sepia 主题: paper=#f4ecd8, ink=#5b4636 (暖米 + 深棕)', () => {
    expect(extractThemeVar('sepia', '--color-paper')).toBe('#f4ecd8');
    expect(extractThemeVar('sepia', '--color-ink')).toBe('#5b4636');
  });

  it('三主题 accent 色保持一致 (#d97757 terracotta, 品牌色不随主题变)', () => {
    // accent 在 :root 定义一次, dark / sepia 块不覆盖 --color-accent
    expect(extractThemeVar('light', '--color-accent')).toBe('#d97757');
    // dark / sepia 不重新定义 --color-accent (继承 :root)
    expect(extractThemeVar('dark', '--color-accent')).toBeNull();
    expect(extractThemeVar('sepia', '--color-accent')).toBeNull();
  });

  it('三主题 paper 色互不相同 (light ≠ dark ≠ sepia)', () => {
    const lightPaper = extractThemeVar('light', '--color-paper');
    const darkPaper = extractThemeVar('dark', '--color-paper');
    const sepiaPaper = extractThemeVar('sepia', '--color-paper');
    expect(lightPaper).not.toBe(darkPaper);
    expect(lightPaper).not.toBe(sepiaPaper);
    expect(darkPaper).not.toBe(sepiaPaper);
  });

  it('三主题 ink 色互不相同 (light ≠ dark ≠ sepia)', () => {
    const lightInk = extractThemeVar('light', '--color-ink');
    const darkInk = extractThemeVar('dark', '--color-ink');
    const sepiaInk = extractThemeVar('sepia', '--color-ink');
    expect(lightInk).not.toBe(darkInk);
    expect(lightInk).not.toBe(sepiaInk);
    expect(darkInk).not.toBe(sepiaInk);
  });

  it('三主题 danger 状态色对比 (dark 反色, light/sepia 同调)', () => {
    const lightDanger = extractThemeVar('light', '--color-danger');
    const darkDanger = extractThemeVar('dark', '--color-danger');
    const sepiaDanger = extractThemeVar('sepia', '--color-danger');
    expect(lightDanger).toBe('#c45c4a');
    expect(darkDanger).toBe('#e0705f'); // dark 提亮
    expect(sepiaDanger).toBe('#c45c4a'); // sepia 与 light 同
    expect(darkDanger).not.toBe(lightDanger);
  });
});

// ======================== T06.5: 阅读区可读性约束 (三主题 paper + ink 对比) ========================

describe('[T06.5] 三主题阅读区可读性 (paper + ink 反差足够)', () => {
  /**
   * 把 #rrggbb 转为 [r, g, b].
   */
  function hexToRgb(hex: string): [number, number, number] {
    const m = hex.match(/^#([0-9a-f]{6})$/i);
    if (!m) throw new Error(`invalid hex: ${hex}`);
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  /**
   * 相对亮度 (WCAG 2.x).
   * https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
   */
  function relativeLuminance([r, g, b]: [number, number, number]): number {
    const toLinear = (c: number) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  }

  /**
   * WCAG 对比度 (1-21).
   */
  function contrastRatio(hex1: string, hex2: string): number {
    const l1 = relativeLuminance(hexToRgb(hex1));
    const l2 = relativeLuminance(hexToRgb(hex2));
    const [lighter, darker] = l1 > l2 ? [l1, l2] : [l2, l1];
    return (lighter + 0.05) / (darker + 0.05);
  }

  it('light 主题: paper #faf9f5 + ink #1b1b19 对比度 >= 7 (WCAG AAA 正常文字)', () => {
    const ratio = contrastRatio('#faf9f5', '#1b1b19');
    expect(ratio).toBeGreaterThanOrEqual(7);
  });

  it('dark 主题: paper #1c1917 + ink #faf8f5 对比度 >= 7 (WCAG AAA 正常文字)', () => {
    const ratio = contrastRatio('#1c1917', '#faf8f5');
    expect(ratio).toBeGreaterThanOrEqual(7);
  });

  it('sepia 主题: paper #f4ecd8 + ink #5b4636 对比度 >= 7 (WCAG AAA 正常文字)', () => {
    const ratio = contrastRatio('#f4ecd8', '#5b4636');
    expect(ratio).toBeGreaterThanOrEqual(7);
  });

  it('三主题 paper + ink 对比度汇总: light/dark >= 16, sepia >= 7 (WCAG AAA)', () => {
    // accent 是品牌色 #d97757, 在 light/sepia 主题下与 paper 对比度 ~2.6-3.0,
    // 不满足 WCAG AA 4.5 (正常文字), 但 accent 用于按钮背景 + 大字 / UI 组件,
    // 不是阅读区文字色. 阅读区可读性由 paper + ink 决定, 这里汇总验证.
    const lightRatio = contrastRatio('#faf9f5', '#1b1b19');
    const darkRatio = contrastRatio('#1c1917', '#faf8f5');
    const sepiaRatio = contrastRatio('#f4ecd8', '#5b4636');

    // light / dark 是极高对比 (>= 16), sepia 是 AAA 通过 (>= 7)
    expect(lightRatio).toBeGreaterThanOrEqual(16);
    expect(darkRatio).toBeGreaterThanOrEqual(16);
    expect(sepiaRatio).toBeGreaterThanOrEqual(7);
    expect(sepiaRatio).toBeLessThan(lightRatio); // sepia 对比度低于 light, 但仍达 AAA
  });
});

// ======================== T06.6: 持久化 + 迁移 (version 8) ========================

describe('[T06.6] theme 持久化迁移 (version 8, 与 v0.1.0-harmony Stage 7 对齐)', () => {
  it('持久化 state 含 version: 8 + state.theme 字段', () => {
    useSettingsStore.getState().setTheme('dark');
    const raw = window.localStorage.getItem('wordaydream:settings');
    expect(raw).not.toBeNull();
    const persisted = JSON.parse(raw!);
    expect(persisted.version).toBe(8);
    expect(persisted.state).toHaveProperty('theme');
  });

  it('旧 version (< 3) 持久化数据 migrate 时注入 theme 字段 (回退 light)', async () => {
    // 模拟旧版 localStorage (version 1, 无 theme 字段)
    window.localStorage.setItem(
      'wordaydream:settings',
      JSON.stringify({
        state: { llm: { provider: 'mock' }, difficulty: 2 },
        version: 1,
      })
    );

    // rehydrate 触发 migrate
    await useSettingsStore.persist.rehydrate();

    // migrate v1 -> v8 应注入 theme: 'light' (默认)
    expect(useSettingsStore.getState().theme).toBe('light');
  });

  it('migrate 不破坏已存在的 theme 字段 (v3+ 透传)', async () => {
    // 模拟 v3 持久化数据 (已有 theme: 'sepia')
    window.localStorage.setItem(
      'wordaydream:settings',
      JSON.stringify({
        state: { llm: { provider: 'mock' }, difficulty: 2, theme: 'sepia' },
        version: 3,
      })
    );

    await useSettingsStore.persist.rehydrate();

    // theme 字段应被透传, 不被覆盖为 light
    expect(useSettingsStore.getState().theme).toBe('sepia');
  });
});

// ======================== T06.7: 模拟 ArkWeb 完整主题切换流程 ========================

describe('[T06.7] 模拟 ArkWeb 完整主题切换流程 (用户视角)', () => {
  it('用户在 SettingsPanel 切换 dark → sepia → light, 三次切换 + 持久化 + DOM 属性同步', () => {
    // 初始: light (默认)
    renderWithThemeProvider('light', <div>app</div>);
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(useSettingsStore.getState().theme).toBe('light');

    // 1. 切换到 dark
    useSettingsStore.getState().setTheme('dark');
    expect(useSettingsStore.getState().theme).toBe('dark');
    const darkPersisted = JSON.parse(window.localStorage.getItem('wordaydream:settings')!);
    expect(darkPersisted.state.theme).toBe('dark');

    // 2. 切换到 sepia
    useSettingsStore.getState().setTheme('sepia');
    expect(useSettingsStore.getState().theme).toBe('sepia');
    const sepiaPersisted = JSON.parse(window.localStorage.getItem('wordaydream:settings')!);
    expect(sepiaPersisted.state.theme).toBe('sepia');

    // 3. 切换回 light
    useSettingsStore.getState().setTheme('light');
    expect(useSettingsStore.getState().theme).toBe('light');
    const lightPersisted = JSON.parse(window.localStorage.getItem('wordaydream:settings')!);
    expect(lightPersisted.state.theme).toBe('light');
  });

  it('跨 reload 后 theme 恢复 + ThemeProvider 重新应用 data-theme', async () => {
    // 1. 用户选 dark, 持久化
    useSettingsStore.getState().setTheme('dark');
    expect(window.localStorage.getItem('wordaydream:settings')).not.toBeNull();

    // 2. 模拟 reload: resetAll 会把默认值写入 localStorage, 需先保存再还原
    const saved = window.localStorage.getItem('wordaydream:settings');
    useSettingsStore.getState().resetAll();
    delete document.documentElement.dataset.theme;
    expect(useSettingsStore.getState().theme).toBe('light');
    expect(document.documentElement.dataset.theme).toBeUndefined();
    // 还原 resetAll 覆盖的 localStorage
    if (saved !== null) {
      window.localStorage.setItem('wordaydream:settings', saved);
    }

    // 3. rehydrate 从 localStorage 恢复 theme
    await useSettingsStore.persist.rehydrate();
    expect(useSettingsStore.getState().theme).toBe('dark');

    // 4. ThemeProvider 重新挂载, 应用 data-theme
    render(<ThemeProvider><div>app</div></ThemeProvider>);
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
