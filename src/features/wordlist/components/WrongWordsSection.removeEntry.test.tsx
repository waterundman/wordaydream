/**
 * WrongWordsSection 单条删除测试 (v1.4.0 S3a)
 *
 * 覆盖 SPEC v1.4.0 合同 C3.1-C3.2:
 * - T01 [C3.1] 行内删除按钮 → removeEntry → 行消失 + 总数 -1
 * - T02 [C3.1] 删除按钮 aria-label 含词条 (无障碍)
 * - T03 [C3.2] 删除最后一条 → 空态文案回归
 *
 * 实现策略: 沿 WrongWordsSection.test.tsx 先例 — useWrongWordsStore.setState
 * 预置 entries, fireEvent.click 触发, store 状态 + DOM 双断言.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { WrongWordsSection } from './WrongWordsSection';
import { useWrongWordsStore, type WrongWordEntry } from '../../review/store/useWrongWordsStore';

const BASE: WrongWordEntry = {
  cardId: 'lg-x',
  lexemeGroupId: 'lg-x',
  lemma: 'x',
  language: 'en',
  wrongCount: 1,
  lastWrongAt: 0,
  firstWrongAt: 0,
};

beforeEach(() => {
  useWrongWordsStore.setState({ entries: [] });
});

afterEach(() => {
  cleanup();
  useWrongWordsStore.setState({ entries: [] });
});

describe('WrongWordsSection 单条删除 (v1.4.0 S3a)', () => {
  it('T01 [C3.1] 点删除按钮 → 该行消失 + 总数 -1 + store 移除', () => {
    useWrongWordsStore.setState({
      entries: [
        { ...BASE, cardId: 'lg-a', lexemeGroupId: 'lg-a', lemma: 'artisans', lastWrongAt: 9000 },
        { ...BASE, cardId: 'lg-b', lexemeGroupId: 'lg-b', lemma: 'haus', language: 'de', lastWrongAt: 1000 },
      ],
    });
    render(<WrongWordsSection />);
    expect(screen.getAllByTestId('wrong-word-item')).toHaveLength(2);

    const items = screen.getAllByTestId('wrong-word-item');
    // 第一行 = artisans (lastWrongAt 倒序), 点其行内删除按钮
    fireEvent.click(within(items[0]).getByTestId('wrong-word-remove'));

    // store 已移除
    expect(useWrongWordsStore.getState().entries.map((e) => e.cardId)).toEqual(['lg-b']);
    // 列表 reactive 更新: 行消失 + 总数 -1
    const remaining = screen.getAllByTestId('wrong-word-item');
    expect(remaining).toHaveLength(1);
    expect(within(remaining[0]).getByText('haus')).toBeInTheDocument();
    expect(screen.getByTestId('wrong-words-count').textContent).toBe('1');
  });

  it('T02 [C3.1] 删除按钮 aria-label 含词条原文', () => {
    useWrongWordsStore.setState({
      entries: [{ ...BASE, cardId: 'lg-a', lexemeGroupId: 'lg-a', lemma: 'artisans' }],
    });
    render(<WrongWordsSection />);
    expect(
      screen.getByRole('button', { name: '删除错词 artisans' }),
    ).toBeTruthy();
  });

  it('T03 [C3.2] 删除最后一条 → 空态文案回归', () => {
    useWrongWordsStore.setState({
      entries: [{ ...BASE, cardId: 'lg-a', lexemeGroupId: 'lg-a', lemma: 'artisans' }],
    });
    render(<WrongWordsSection />);
    fireEvent.click(screen.getByTestId('wrong-word-remove'));

    expect(useWrongWordsStore.getState().entries).toHaveLength(0);
    expect(
      screen.getByText('暂无错词记录，复习中答错的词会自动收录'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('wrong-word-item')).not.toBeInTheDocument();
    expect(screen.getByTestId('wrong-words-count').textContent).toBe('0');
  });
});
