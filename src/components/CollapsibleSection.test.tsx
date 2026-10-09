/**
 * v1.6.4 Stage 1 — 折叠原语 (CollapsibleSection) 测试.
 *
 * 覆盖 test_spec:
 * - T01 [critical]: 默认折叠、点击展开、`aria-expanded` 与内容可见性一致
 * - T07 [non-critical]: 键盘可达 (Enter / Space 切换) 且遵守 prefers-reduced-motion
 *
 * 实现契约 (与组件注释一致):
 * - 用原生 `<details>` / `<summary>`: 折叠态下内容仍在 DOM 中.
 *   jsdom 不实现 details 的渲染隐藏 (getComputedStyle 仍是 block), 因此
 *   「可见性」在测试中以 `<details open>` 属性 + `aria-expanded` 两者的一致性来衡量
 *   (这两个属性正是浏览器决定内容是否渲染的依据).
 * - 受控折叠: summary 的 click 被 preventDefault, 展开态由 React state 单一来源驱动,
 *   所以 aria-expanded 与 open 属性永远同步, 不会出现双写脱节.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CollapsibleSection } from './CollapsibleSection';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSS_PATH = resolve(__dirname, './CollapsibleSection.module.css');

function renderGroup(overrides: { defaultOpen?: boolean } = {}) {
  const { container } = render(
    <CollapsibleSection
      title="数据与高级"
      description="清空类操作不可撤销。"
      testId="demo-group"
      defaultOpen={overrides.defaultOpen}
    >
      <button type="button">组内按钮</button>
    </CollapsibleSection>,
  );
  const details = container.querySelector('details') as HTMLDetailsElement;
  const summary = container.querySelector('summary') as HTMLElement;
  return { container, details, summary };
}

/** 断言 aria-expanded 与 <details open> 一致 (折叠态可见性的 DOM 依据). */
function expectExpandedInSync(summary: HTMLElement, details: HTMLDetailsElement, expanded: boolean) {
  expect(summary.getAttribute('aria-expanded')).toBe(expanded ? 'true' : 'false');
  expect(details.hasAttribute('open')).toBe(expanded);
  expect(details.getAttribute('data-collapsible')).toBe(expanded ? 'open' : 'closed');
}

describe('v1.6.4 Stage 1 T01: 折叠原语折叠语义', () => {
  it('T01a [critical]: 默认折叠 — 无 open 属性, aria-expanded=false', () => {
    const { details, summary } = renderGroup();
    expectExpandedInSync(summary, details, false);
  });

  it('T01b [critical]: 点击组头展开 / 再次点击收起, aria-expanded 始终与内容可见性一致', () => {
    const { details, summary } = renderGroup();

    fireEvent.click(summary);
    expectExpandedInSync(summary, details, true);

    fireEvent.click(summary);
    expectExpandedInSync(summary, details, false);
  });

  it('T01c [critical]: 折叠态下组内内容仍在 DOM 中 (不破坏既有 getByText / getByRole 断言)', () => {
    const { details, summary } = renderGroup();
    expectExpandedInSync(summary, details, false);

    // 折叠态: 内容仍可查询 (宿主测试依赖此契约)
    expect(screen.getByText('组内按钮')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '组内按钮' })).toBeInTheDocument();
    expect(screen.getByTestId('demo-group')).toBeInTheDocument();
    // 组头后果说明也在 DOM 中
    expect(screen.getByText('清空类操作不可撤销。')).toBeInTheDocument();
  });

  it('T01d [critical]: defaultOpen=true 时初始即展开', () => {
    const { details, summary } = renderGroup({ defaultOpen: true });
    expectExpandedInSync(summary, details, true);
  });

  it('T01e: 组头渲染标题 + 后果说明 (description), 且不含 emoji', () => {
    const { summary } = renderGroup();
    expect(summary.textContent).toContain('数据与高级');
    expect(summary.textContent).toContain('清空类操作不可撤销。');
    // 0 emoji 硬约束 (箭头是 SVG, 不在文本中)
    expect(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(summary.textContent ?? '')).toBe(false);
  });
});

describe('v1.6.4 Stage 1 T07: 折叠原语键盘可达 + reduced-motion', () => {
  it('T07a [non-critical]: Enter 切换展开态', () => {
    const { details, summary } = renderGroup();

    fireEvent.keyDown(summary, { key: 'Enter' });
    expectExpandedInSync(summary, details, true);

    fireEvent.keyDown(summary, { key: 'Enter' });
    expectExpandedInSync(summary, details, false);
  });

  it('T07b [non-critical]: Space 切换展开态', () => {
    const { details, summary } = renderGroup();

    fireEvent.keyDown(summary, { key: ' ' });
    expectExpandedInSync(summary, details, true);
  });

  it('T07c [non-critical]: 其他按键不改变展开态', () => {
    const { details, summary } = renderGroup();

    fireEvent.keyDown(summary, { key: 'a' });
    fireEvent.keyDown(summary, { key: 'ArrowDown' });
    expectExpandedInSync(summary, details, false);
  });

  it('T07d [non-critical]: 组头是原生 summary (可 Tab 聚焦), 并显式暴露 aria-expanded', () => {
    const { summary } = renderGroup();
    expect(summary.tagName).toBe('SUMMARY');
    expect(summary.hasAttribute('aria-expanded')).toBe(true);
  });

  it('T07e [non-critical]: 样式表声明 prefers-reduced-motion 下关闭过渡动画', () => {
    const css = readFileSync(CSS_PATH, 'utf8');
    const reducedMotionBlock = css.match(
      /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/,
    );
    expect(reducedMotionBlock).not.toBeNull();
    expect(reducedMotionBlock?.[0]).toContain('transition: none');
    // 箭头旋转过渡存在 (非 reduced-motion 路径)
    expect(css).toContain('transition: transform');
  });

  it('T07f [non-critical]: 无内联动画, 过渡全部走 tokens.css 变量', () => {
    const { container } = renderGroup();
    const details = container.querySelector('details');
    expect(details?.getAttribute('style')).toBeNull();
    const onKeyDownSpy = vi.fn();
    expect(onKeyDownSpy).not.toHaveBeenCalled();
  });
});