/**
 * useCursorGlow 人形守卫 (v1.6.1 Stage 4, P2-1)
 *
 * 覆盖 SPEC §6.1 `useCursorGlow.guard.test.ts` (4 测试):
 * - T01 [critical]: `pointer: coarse` (触摸设备) → 不挂载光晕层
 * - T02 [critical]: `prefers-reduced-motion: reduce` → 不挂载光晕层
 * - T03 [critical]: 正常情况下挂载, mousemove 驱动 transform, 卸载时彻底清理
 * - T04 [critical]: 不再挂死类名 'cursor-glow'; 装饰性元素对辅助技术隐藏
 *
 * 背景: 原实现 `useCursorGlow(true)` 在 App 顶层无条件启用 —— 触摸设备会白挂一个
 * 200x200 固定层 + 2 个监听器, 而 `mousemove` 在触摸设备上还会被合成鼠标事件误触发;
 * 且挂载的类名 'cursor-glow' 全仓没有任何 CSS 规则命中 (死类名)。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCursorGlow } from './useCursorGlow';

const GLOW_SELECTOR = '[data-cursor-glow]';

function glowEl(): HTMLElement | null {
  return document.querySelector<HTMLElement>(GLOW_SELECTOR);
}

/** 按查询字符串返回匹配结果, 其余 jsdom 缺失的 matchMedia 字段补空实现。 */
function stubMatchMedia(matches: (query: string) => boolean): () => void {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: matches(query),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
}

let restoreMatchMedia: (() => void) | null = null;

beforeEach(() => {
  restoreMatchMedia = null;
  expect(glowEl(), '前置条件: 测试开始时不应残留光晕层').toBeNull();
});

afterEach(() => {
  restoreMatchMedia?.();
  // 兜底清理, 避免某个失败用例把元素泄漏给下一个用例
  glowEl()?.remove();
});

describe('useCursorGlow 人形守卫 (v1.6.1 Stage 4)', () => {
  it('T01 [critical]: pointer: coarse → 不挂载', () => {
    restoreMatchMedia = stubMatchMedia((q) => q.includes('pointer: coarse'));

    renderHook(() => useCursorGlow(true));

    expect(glowEl(), '触摸设备不应挂载光晕层').toBeNull();
  });

  it('T02 [critical]: prefers-reduced-motion: reduce → 不挂载', () => {
    restoreMatchMedia = stubMatchMedia((q) => q.includes('prefers-reduced-motion'));

    renderHook(() => useCursorGlow(true));

    expect(glowEl(), '用户要求减少动效时不应挂载光晕层').toBeNull();
  });

  it('T03 [critical]: 正常挂载 → mousemove 更新 transform, 卸载时清理元素', () => {
    restoreMatchMedia = stubMatchMedia(() => false);

    const { unmount } = renderHook(() => useCursorGlow(true));

    const glow = glowEl();
    expect(glow, '鼠标设备应挂载光晕层').not.toBeNull();

    // mousemove → 直接写 translate3d (合成层); 中心点偏移 -100px
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 300, clientY: 150 }));
    expect(glow!.style.transform).toBe('translate3d(200px, 50px, 0)');
    expect(glow!.style.opacity).toBe('1');

    // 鼠标离开文档 → 淡出
    document.dispatchEvent(new MouseEvent('mouseleave'));
    expect(glow!.style.opacity).toBe('0');

    unmount();
    expect(glowEl(), '卸载后光晕层应被移除').toBeNull();
  });

  it('T04 [critical]: 不再挂死类名 cursor-glow, 且对辅助技术隐藏', () => {
    restoreMatchMedia = stubMatchMedia(() => false);

    const { unmount } = renderHook(() => useCursorGlow(true));
    const glow = glowEl();

    expect(glow, '前置条件: 光晕层应存在').not.toBeNull();
    // 原实现 `glow.className = 'cursor-glow'` 命不中任何 CSS 规则, 已删除
    expect(glow!.className, '不应再挂上无规则命中的死类名').not.toContain('cursor-glow');
    expect(glow!.className).toBe('');
    // 纯装饰元素应排除在无障碍树之外
    expect(glow!.getAttribute('aria-hidden')).toBe('true');

    unmount();
  });
});
