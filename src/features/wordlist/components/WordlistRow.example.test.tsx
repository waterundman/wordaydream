/**
 * WordlistRow 例句消费测试 — v1.6.2 Stage 3
 *
 * 覆盖 SPEC §6.1 的 4 项：
 *   T01 有例句 + 有译文 → 展开时渲染例句与译文
 *   T02 无例句 → **不渲染例句区**（存在才渲染；旧词表/CSV 词表零影响）
 *   T03 异常数据：只有 example 无 exampleTranslation → **也不渲染**（不显示半截内容）
 *   T04 props 省略（完全按 v1.6.1 的调用方式传参）→ 行为与现状完全一致
 *
 * 反向断言（T02/T03/T04）是重点：只测「有例句时会显示」等于没测，
 * 真正会回归风险的是「没有例句时**多显示了东西**」。
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { WordlistRow } from './WordlistRow';

function renderRow(overrides: Record<string, unknown> = {}) {
  const onToggle = vi.fn();
  const props = {
    lemma: 'hope',
    pos: 'verb',
    translation: '希望',
    status: 'unseen' as const,
    isExpanded: true,
    onToggle,
    language: 'en' as const,
    ...overrides,
  };
  const utils = render(<WordlistRow {...props} />);
  return { ...utils, onToggle };
}

describe('WordlistRow 例句区 (v1.6.2 Stage 3)', () => {
  it('T01: 有例句且展开 → 同时渲染例句与中文译文', () => {
    renderRow({ example: 'I hope so.', exampleTranslation: '我希望如此。' });
    expect(screen.getByText('我希望如此。')).toBeInTheDocument();
    expect(screen.getByText('I hope so.')).toBeInTheDocument();
    // 释义仍在
    expect(screen.getByText('希望')).toBeInTheDocument();
  });

  it('T02: 无例句字段 → 展开时只显示释义, 例句区不存在', () => {
    const { container } = renderRow();
    expect(screen.getByText('希望')).toBeInTheDocument();
    // 结构断言: 例句区的 <p> 一个都不该出现 (释义是 <div>, 不会误判)
    expect(container.querySelectorAll('p')).toHaveLength(0);
  });

  it('T03: 异常数据 (只有 example 无 exampleTranslation) → 不渲染例句区', () => {
    const { container } = renderRow({ example: 'I hope so.' });
    expect(container.querySelectorAll('p')).toHaveLength(0);
    expect(screen.queryByText('I hope so.')).toBe(null);
  });

  it('T04: 未展开时即使有例句也不渲染; 且不传新 props 时行为与现状一致', () => {
    // 同一用例里会先后渲染多棵树, 故所有查询都用 within(container) 限定作用域
    const { container, rerender } = render(
      <WordlistRow
        lemma="hope"
        pos="verb"
        translation="希望"
        example="I hope so."
        exampleTranslation="我希望如此。"
        status="unseen"
        isExpanded={false}
        onToggle={() => {}}
        language="en"
      />
    );
    expect(container.querySelectorAll('p')).toHaveLength(0);
    expect(within(container).queryByText('希望')).toBe(null);

    // 展开后出现
    rerender(
      <WordlistRow
        lemma="hope"
        pos="verb"
        translation="希望"
        example="I hope so."
        exampleTranslation="我希望如此。"
        status="unseen"
        isExpanded
        onToggle={() => {}}
        language="en"
      />
    );
    expect(within(container).getByText('我希望如此。')).toBeInTheDocument();

    // 完全省略新 props (v1.6.1 调用方式) → 与 T02 一致: 只有释义, 无 <p>
    const legacy = renderRow({ isExpanded: true });
    expect(legacy.container.querySelectorAll('p')).toHaveLength(0);
    expect(within(legacy.container).getByText('希望')).toBeInTheDocument();
  });

  it('T05 [回归]: 例句区的存在不影响整行的点击展开交互', () => {
    const { onToggle } = renderRow({ example: 'I hope so.', exampleTranslation: '我希望如此。' });
    fireEvent.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalledWith('hope');
  });
});
