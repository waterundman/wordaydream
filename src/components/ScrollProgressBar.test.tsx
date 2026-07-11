/**
 * ScrollProgressBar 单元测试 (v1.5.2 Stage 3 — Contract 29 NEW / D-1)
 *
 * 覆盖 SPEC 要求 2 个 case:
 * - T01 [critical]: 默认渲染 -> progressbar 元素存在, aria-valuenow=0
 * - T02 [critical]: 模拟滚动到底部 -> aria-valuenow=100
 *
 * 测试策略:
 * - jsdom 默认 scrollHeight = clientHeight (max = 0), useEffect 内 compute() 走
 *   max<=0 分支, progress 保持 0, 符合 T01 期望.
 * - T02 在 useEffect 执行后用 Object.defineProperty 重写 scrollHeight, 触发 scroll
 *   事件, 然后 rAF 跑完 setState 生效.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ScrollProgressBar } from './ScrollProgressBar';

describe('ScrollProgressBar (Stage 3)', () => {
  let originalScrollHeight: number;

  beforeEach(() => {
    originalScrollHeight = document.documentElement.scrollHeight;
  });

  afterEach(() => {
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      configurable: true,
      get: () => originalScrollHeight,
    });
    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      get: () => 0,
    });
  });

  it('T01 [critical]: 默认渲染 -> progressbar 存在且 aria-valuenow=0', () => {
    render(<ScrollProgressBar />);
    const bar = screen.getByRole('progressbar', { name: 'Lesefortschritt' });
    expect(bar).toBeInTheDocument();
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(bar).toHaveAttribute('aria-valuenow', '0');
  });

  it('T02 [critical]: 模拟滚动到底部 -> aria-valuenow=100', async () => {
    // jsdom 默认 clientHeight=0, 这里覆盖让 max=100, scrollY=100 -> 100%
    Object.defineProperty(document.documentElement, 'clientHeight', {
      configurable: true,
      get: () => 0,
    });
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      configurable: true,
      get: () => 100,
    });
    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      get: () => 100,
    });

    render(<ScrollProgressBar />);

    await act(async () => {
      window.dispatchEvent(new Event('scroll'));
      // rAF 走完一次
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });

    const bar = screen.getByRole('progressbar', { name: 'Lesefortschritt' });
    expect(bar).toHaveAttribute('aria-valuenow', '100');
  });
});
