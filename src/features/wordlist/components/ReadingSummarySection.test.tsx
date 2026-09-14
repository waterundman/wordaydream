/**
 * ReadingSummarySection 测试 (v1.4.0 S3b)
 *
 * 覆盖 SPEC v1.4.0 合同 C3.4:
 * - T01 [C3.4] history 空 → 不渲染 (queryByTestId null)
 * - T02 [C3.4] 有数据 → 主行 (阅读/完成/解析) + 次行 (近 7 天/语言分布) 文案正确
 *
 * 实现策略: useReadingHistoryStore.setState 直接预置 history (该 store 的
 * partialize 仅影响持久化, setState 写运行态即可被组件订阅到).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ReadingSummarySection } from './ReadingSummarySection';
import { useReadingHistoryStore, type HistoryEntry } from '../../reading/store/useReadingHistoryStore';
import type { Passage } from '../../types';

const NOW = Date.now();

function makeEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: 'h1',
    passage: { tokens: [] } as unknown as Passage,
    language: 'en',
    difficulty: 2,
    startedAt: NOW - 86_400_000,
    resolvedCount: 5,
    totalTokenCount: 20,
    completedAt: NOW - 3_600_000,
    ...overrides,
  };
}

beforeEach(() => {
  useReadingHistoryStore.setState({ history: [] });
});

afterEach(() => {
  cleanup();
  useReadingHistoryStore.setState({ history: [] });
});

describe('ReadingSummarySection', () => {
  it('T01 [C3.4] history 空 → 不渲染', () => {
    const { container } = render(<ReadingSummarySection />);
    expect(container.querySelector('[data-testid="reading-summary-section"]')).toBeNull();
  });

  it('T02 [C3.4] 有数据显示主行/次行: 完成 2 篇 · 解析 12 词 / 近 7 天 1 篇 · en 1 / de 1', () => {
    useReadingHistoryStore.setState({
      history: [
        // 近 7 天完成, en
        makeEntry({ id: 'h1', language: 'en', resolvedCount: 8, completedAt: NOW - 3_600_000 }),
        // 8 天前完成, de (近 7 天外)
        makeEntry({
          id: 'h2',
          language: 'de',
          resolvedCount: 4,
          completedAt: NOW - 8 * 86_400_000,
        }),
        // 进行中 (不进完成数/语言分布)
        makeEntry({ id: 'h3', language: 'en', resolvedCount: 2, completedAt: undefined }),
      ],
    });
    render(<ReadingSummarySection />);

    const main = screen.getByTestId('reading-summary-main');
    expect(main.textContent).toContain('阅读 3 篇');
    expect(main.textContent).toContain('完成 2 篇');
    expect(main.textContent).toContain('解析 12 词'); // 完成条目 8 + 4

    const sub = screen.getByTestId('reading-summary-sub');
    expect(sub.textContent).toContain('近 7 天完成 1 篇');
    expect(sub.textContent).toContain('en 1 / de 1');
  });
});
