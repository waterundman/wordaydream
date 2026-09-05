/**
 * v2.2.0 Stage 2 (D2): WordlistPage CSV 导入 UI 测试
 *
 * 覆盖 test_spec:
 * - T18: WordlistPage 渲染 "导入 CSV" 按钮
 * - T11: WordlistPage CSV 预览使用 CSS module class (无 inline color style)
 * - T12: WordlistPage 词库列表使用 CSS module class
 *
 * 设计:
 * - mock `data/wordlists` 模块返回受控词表数据
 * - mock `data/wordlists/csvStorage` 模块返回空列表 (避免 IndexedDB 依赖)
 * - @testing-library/react + vitest
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WordlistPage } from './WordlistPage';
import { useSettingsStore } from '../settings/store/useSettingsStore';
import { useReadingSessionStore } from '../reading/store/useReadingSessionStore';
import { useWordlistStore } from './store/useWordlistStore';
import { listCsvWordlists } from '../../data/wordlists/csvStorage';
import type { StoredCsvWordlist } from '../../data/wordlists/csvStorage';
import { parseCsvWordlistAsync } from '../../data/wordlists/csvLoader';

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

vi.mock('../../data/wordlists/csvLoader', async () => {
  const actual = await vi.importActual<typeof import('../../data/wordlists/csvLoader')>(
    '../../data/wordlists/csvLoader',
  );
  return {
    ...actual,
    parseCsvWordlistAsync: vi.fn(actual.parseCsvWordlistAsync),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  useSettingsStore.setState({ difficulty: 2 });
  useReadingSessionStore.setState({
    lastConfig: { language: 'en' as const, difficulty: 2 as const },
  });
  useWordlistStore.setState({ progress: {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
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

/**
 * v2.2.3 Stage 3 (D3-1): WordlistPage inline style 清理测试
 *
 * 覆盖 test_spec:
 * - T11: CSV 预览区使用 CSS module class, 无 inline style (颜色硬编码已移除)
 * - T12: 词库列表项使用 CSS module class, 无 inline style
 *
 * 设计:
 * - T11: mock FileReader 触发文件上传 → 等待预览渲染 → 检查无 [style] 属性元素
 * - T12: mock listCsvWordlists 返回测试数据 → 检查词库列表项无 [style] 属性
 */
describe('WordlistPage inline style 清理 (v2.2.3 Stage 3 D3-1)', () => {
  it('T11: CSV 预览区使用 CSS module class, 无 inline style', async () => {
    // mock FileReader: 上传后同步触发 onload 返回测试 CSV
    vi.stubGlobal('FileReader', class {
      onload: ((e: { target: { result: string } }) => void) | null = null;
      onerror: (() => void) | null = null;
      readAsText(_file: File) {
        setTimeout(() => {
          this.onload?.({ target: { result: 'lemma,pos,translation,cefr\nhave,verb,有,A2\nbe,verb,是,A2' } });
        }, 0);
      }
    });

    const { container } = render(<WordlistPage onGoHome={() => {}} />);

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: { files: [new File(['test'], 'test.csv')] },
    });

    await waitFor(() => {
      expect(screen.getByTestId('csv-import-preview')).toBeInTheDocument();
    });
    expect(parseCsvWordlistAsync).toHaveBeenCalledWith(
      expect.stringContaining('lemma,pos,translation,cefr'),
      'test.csv',
    );

    // 验证预览区内所有元素无 inline style 属性
    const preview = screen.getByTestId('csv-import-preview');
    const elementsWithStyle = preview.querySelectorAll('[style]');
    expect(elementsWithStyle).toHaveLength(0);
  });

  it('CSV Worker 解析期间禁用重复选择，并在完成后恢复', async () => {
    let resolveParse: ((result: Awaited<ReturnType<typeof parseCsvWordlistAsync>>) => void) | null = null;
    vi.mocked(parseCsvWordlistAsync).mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveParse = resolve;
      }),
    );
    vi.stubGlobal('FileReader', class {
      onload: ((e: { target: { result: string } }) => void) | null = null;
      onerror: (() => void) | null = null;
      readAsText(_file: File) {
        this.onload?.({ target: { result: 'lemma,pos,translation,cefr\nhave,verb,有,A2' } });
      }
    });

    const { container } = render(<WordlistPage onGoHome={() => {}} />);
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: { files: [new File(['test'], 'worker.csv')] },
    });

    const importButton = screen.getByRole('button', { name: '导入 CSV 词库' });
    expect(importButton).toBeDisabled();
    expect(importButton).toHaveAttribute('aria-busy', 'true');

    resolveParse?.({
      success: true,
      entries: [{ lemma: 'have', pos: 'verb', translation: '有', cefr: 'A2' }],
      errors: [],
      fileName: 'worker.csv',
      importedAt: Date.now(),
    });

    await waitFor(() => {
      expect(screen.getByTestId('csv-import-preview')).toBeInTheDocument();
      expect(importButton).not.toBeDisabled();
    });
  });

  it('CSV Worker 失败时展示可恢复的错误信息', async () => {
    vi.mocked(parseCsvWordlistAsync).mockRejectedValueOnce(new Error('worker unavailable'));
    vi.stubGlobal('FileReader', class {
      onload: ((e: { target: { result: string } }) => void) | null = null;
      onerror: (() => void) | null = null;
      readAsText(_file: File) {
        this.onload?.({ target: { result: 'lemma,pos,translation,cefr' } });
      }
    });

    const { container } = render(<WordlistPage onGoHome={() => {}} />);
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: { files: [new File(['test'], 'broken.csv')] },
    });

    expect(await screen.findByText('CSV 解析失败: worker unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '导入 CSV 词库' })).not.toBeDisabled();
  });

  it('T12: 词库列表项使用 CSS module class, 无 inline style', async () => {
    const mockWordlists: StoredCsvWordlist[] = [
      {
        id: 'test-1',
        fileName: 'test-words.csv',
        importedAt: Date.now(),
        entries: [
          { lemma: 'test', pos: 'noun', translation: '测试', cefr: 'A2', priority: 2 },
        ],
        entryCount: 1,
      },
    ];
    vi.mocked(listCsvWordlists).mockResolvedValueOnce(mockWordlists);

    render(<WordlistPage onGoHome={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText('test-words.csv')).toBeInTheDocument();
    });

    // 验证词库列表区域无 inline style 属性元素
    const myWordlists = screen.getByTestId('my-csv-wordlists');
    const elementsWithStyle = myWordlists.querySelectorAll('[style]');
    expect(elementsWithStyle).toHaveLength(0);
  });
});
