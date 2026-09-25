/**
 * WordlistPage JSON 导出 × 例句字段测试 — v1.6.2 Stage 3
 *
 * 覆盖 SPEC §6.1 的 2 项：
 *   T01 导出的 JSON **包含** example / exampleTranslation / exampleSource
 *   T02 无例句的词条**不产生**这些键（不是空串, 而是根本不存在）
 *
 * 为什么本轮导出"零代码改动"仍要写测试：
 *   `handleExport` 是 `JSON.stringify(wordlist)` 整体序列化 —— 新字段**自动**随导出，
 *   这是"设计上如此"，但**没有任何东西拦得住**以后有人把导出改成手挑字段的白名单。
 *   这两条断言把"新字段随导出"钉成契约, 而不是巧合。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WordlistPage } from './WordlistPage';
import { useSettingsStore } from '../settings/store/useSettingsStore';
import { useReadingSessionStore } from '../reading/store/useReadingSessionStore';
import { useWordlistStore } from './store/useWordlistStore';

vi.mock('../../data/wordlists', () => {
  const mockWordlist = {
    language: 'en' as const,
    level: 'A2',
    difficulty: 2 as const,
    version: '2.0.0',
    total: 2,
    words: [
      {
        lemma: 'hope',
        pos: 'verb',
        translation: '希望',
        cefr: 'A2',
        example: 'I hope so.',
        exampleTranslation: '我希望如此。',
        exampleSource: 'tatoeba:42',
      },
      { lemma: 'have', pos: 'verb', translation: '有', cefr: 'A2' },
    ],
  };
  return {
    loadWordlist: vi.fn(async () => mockWordlist),
    getCachedWordlist: vi.fn(() => mockWordlist),
    clearWordlistCache: vi.fn(),
    preloadWordlist: vi.fn(),
  };
});

/** 截获 handleExport 产生的 Blob 文本 */
function captureExportedJson(): { get: () => Promise<string> } {
  let blob: Blob | null = null;
  const createSpy = vi.spyOn(URL, 'createObjectURL').mockImplementation((b: Blob | MediaSource) => {
    blob = b as Blob;
    return 'blob:mock';
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  // 点击由调用方触发；这里返回读取器
  return {
    get: async () => {
      expect(createSpy).toBeDefined();
      await waitFor(() => expect(blob).not.toBe(null));
      return await (blob as unknown as Blob).text();
    },
  };
}

beforeEach(() => {
  useSettingsStore.setState({ difficulty: 2 });
  useReadingSessionStore.setState({
    lastConfig: { language: 'en' as const, difficulty: 2 as const },
  });
  useWordlistStore.setState({ progress: {} });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('WordlistPage JSON 导出 × 例句字段 (v1.6.2)', () => {
  it('T01: 导出的 JSON 含 example / exampleTranslation / exampleSource', async () => {
    render(<WordlistPage onGoHome={() => {}} />);
    await waitFor(() => expect(screen.getByText('hope')).toBeInTheDocument());

    const captured = captureExportedJson();
    fireEvent.click(screen.getByLabelText('导出词表 JSON'));

    const parsed = JSON.parse(await captured.get());
    const hope = parsed.words.find((w: { lemma: string }) => w.lemma === 'hope');
    expect(hope.example).toBe('I hope so.');
    expect(hope.exampleTranslation).toBe('我希望如此。');
    expect(hope.exampleSource).toBe('tatoeba:42');
  });

  it('T02: 无例句的词条不产生例句键 (键不存在, 不是空串)', async () => {
    render(<WordlistPage onGoHome={() => {}} />);
    await waitFor(() => expect(screen.getByText('have')).toBeInTheDocument());

    const captured = captureExportedJson();
    fireEvent.click(screen.getByLabelText('导出词表 JSON'));

    const parsed = JSON.parse(await captured.get());
    const have = parsed.words.find((w: { lemma: string }) => w.lemma === 'have');
    expect('example' in have).toBe(false);
    expect('exampleTranslation' in have).toBe(false);
    expect('exampleSource' in have).toBe(false);
  });
});
