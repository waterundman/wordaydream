/**
 * WrongWordsSection 组件测试 (v0.9.0 Stage 1)
 *
 * 覆盖 test_spec:
 * - T04 [critical]: 渲染 2 条目按 lastWrongAt 倒序 (断言 DOM 顺序) + 标题计数=2
 * - T05 [critical]: 空态文案渲染; 构造 lemma 缺失条目 → "已删除"降级渲染
 *
 * 实现策略: 直接渲染 WrongWordsSection, 通过 useWrongWordsStore.setState 预置 entries.
 * 不渲染整个 WordlistPage (副作用多: loadWordlist / IndexedDB / 虚拟滚动),
 * 仅测错词本区块本身 — 遵循 v0.8.0 教训: 用状态副作用断言, 不 spy 单例.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
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

function setEntries(entries: WrongWordEntry[]) {
  useWrongWordsStore.setState({ entries });
}

beforeEach(() => {
  useWrongWordsStore.setState({ entries: [] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('WrongWordsSection (Stage 1)', () => {
  describe('T04 [critical]: 2 条目按 lastWrongAt 倒序 + 计数=2', () => {
    it('T04: 渲染顺序与 lastWrongAt 倒序一致, 标题计数=2', () => {
      setEntries([
        { ...BASE, cardId: 'lg-old', lexemeGroupId: 'lg-old', lemma: 'oldword', language: 'en', lastWrongAt: 1000 },
        { ...BASE, cardId: 'lg-new', lexemeGroupId: 'lg-new', lemma: 'newword', language: 'de', lastWrongAt: 9000 },
      ]);

      render(<WrongWordsSection />);

      // 计数=2
      expect(screen.getByTestId('wrong-words-count').textContent).toBe('2');

      // DOM 顺序: newword (lastWrongAt 9000) 在前, oldword (1000) 在后
      const items = screen.getAllByTestId('wrong-word-item');
      expect(items).toHaveLength(2);
      expect(within(items[0]).getByText('newword')).toBeInTheDocument();
      expect(within(items[1]).getByText('oldword')).toBeInTheDocument();

      // 语言标记存在
      expect(screen.getByText('en')).toBeInTheDocument();
      expect(screen.getByText('de')).toBeInTheDocument();
      // wrongCount 文案 (两条各 "错 1 次")
      expect(screen.getAllByText('错 1 次')).toHaveLength(2);
    });
  });

  describe('T05 [critical]: 空态 + lemma 缺失降级', () => {
    it('T05a: 无条目 → 空态文案', () => {
      setEntries([]);
      render(<WrongWordsSection />);
      expect(screen.getByText('暂无错词记录，复习中答错的词会自动收录')).toBeInTheDocument();
      expect(screen.queryByTestId('wrong-word-item')).not.toBeInTheDocument();
      expect(screen.getByTestId('wrong-words-count').textContent).toBe('0');
    });

    it('T05b: lemma 缺失 → "词条已删除"降级', () => {
      setEntries([
        { ...BASE, cardId: 'lg-deleted', lexemeGroupId: 'lg-deleted', lemma: '', language: 'en', lastWrongAt: 5000 },
        { ...BASE, cardId: 'lg-ok', lexemeGroupId: 'lg-ok', lemma: 'alive', language: 'de', lastWrongAt: 9000 },
      ]);
      render(<WrongWordsSection />);

      expect(screen.getByText('词条已删除')).toBeInTheDocument();
      expect(screen.getByText('alive')).toBeInTheDocument();
    });
  });
});
