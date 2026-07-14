/**
 * v2.2.0 Stage 2 (D2): WordlistPage CSV 导入 UI 测试
 *
 * 覆盖 test_spec:
 * - T18: WordlistPage 渲染 "导入 CSV" 按钮
 *
 * 设计:
 * - mock `data/wordlists` 模块返回受控词表数据
 * - mock `data/wordlists/csvStorage` 模块返回空列表 (避免 IndexedDB 依赖)
 * - @testing-library/react + vitest
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WordlistPage } from './WordlistPage';
import { useSettingsStore } from '../settings/store/useSettingsStore';
import { useReadingSessionStore } from '../reading/store/useReadingSessionStore';
import { useWordlistStore } from './store/useWordlistStore';

vi.mock('../../data/wordlists', () => {
  const mockWordlist = {
    language: 'en' as const,
    level: 'A2',
    difficulty: 2 as const,
    version: '1.0.0',
    total: 5,
    words: [
      { lemma: 'have', pos: 'verb', translation: '有', cefr: 'A2' },
      { lemma: 'be', pos: 'verb', translation: '是', cefr: 'A2' },
      { lemma: 'go', pos: 'verb', translation: '去', cefr: 'A2' },
      { lemma: 'see', pos: 'verb', translation: '看见', cefr: 'A2' },
      { lemma: 'find', pos: 'verb', translation: '找到', cefr: 'A2' },
    ],
  };
  return {
    loadWordlist: vi.fn(async () => mockWordlist),
    getCachedWordlist: vi.fn(() => mockWordlist),
    clearWordlistCache: vi.fn(),
    preloadWordlist: vi.fn(),
  };
});

vi.mock('../../data/wordlists/csvStorage', () => ({
  saveCsvWordlist: vi.fn(async () => 'mock-id'),
  getCsvWordlist: vi.fn(async () => null),
  listCsvWordlists: vi.fn(async () => []),
  deleteCsvWordlist: vi.fn(async () => undefined),
  getAllCsvEntries: vi.fn(async () => []),
}));

beforeEach(() => {
  useSettingsStore.setState({ difficulty: 2 });
  useReadingSessionStore.setState({
    lastConfig: { language: 'en' as const, difficulty: 2 as const },
  });
  useWordlistStore.setState({ progress: {} });
});

describe('WordlistPage CSV 导入 (v2.2.0 Stage 2)', () => {
  it('T18: 渲染 "导入 CSV" 按钮', () => {
    render(<WordlistPage onGoHome={() => {}} />);

    const importBtn = screen.getByRole('button', { name: '导入 CSV 词库' });
    expect(importBtn).toBeInTheDocument();
  });

  it('渲染 "下载模板" 按钮', () => {
    render(<WordlistPage onGoHome={() => {}} />);

    const templateBtn = screen.getByRole('button', { name: '下载 CSV 模板' });
    expect(templateBtn).toBeInTheDocument();
  });

  it('渲染 "我的词库" 区域', () => {
    render(<WordlistPage onGoHome={() => {}} />);

    const myWordlistsSection = screen.getByTestId('my-csv-wordlists');
    expect(myWordlistsSection).toBeInTheDocument();
  });

  it('渲染隐藏的 CSV file input', () => {
    const { container } = render(<WordlistPage onGoHome={() => {}} />);

    const fileInput = container.querySelector(
      'input[type="file"][accept=".csv"]',
    ) as HTMLInputElement | null;
    expect(fileInput).not.toBeNull();
    expect(fileInput).toBeInTheDocument();
  });
});
