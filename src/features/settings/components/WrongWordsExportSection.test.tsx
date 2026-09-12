/**
 * WrongWordsExportSection 测试 (v1.1.0 Stage 2)
 *
 * 覆盖 test_spec:
 * - T04 [critical]: CSV 导出 — 含逗号/双引号 lemma 的条目按 RFC 4180 转义,
 *   表头/行序 (recent) 正确, 文件名 wordaydream-wrong-words-YYYYMMDD.csv
 * - T05: JSON 导出 — { schema, version, exportedAt, entries } 结构断言
 * - T06: 空错词本 — 两个导出按钮均 disabled
 *
 * 下载 mock: jsdom 无真实下载, 断言 URL.createObjectURL 收到的 Blob 内容
 * (blob.text() 异步 await) + a.download 属性 (spy HTMLAnchorElement.prototype.click).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { WrongWordsExportSection } from './WrongWordsExportSection';
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

let capturedBlob: Blob | null = null;
let capturedFileName = '';
let createObjectURLMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  useWrongWordsStore.setState({ entries: [] });
  capturedBlob = null;
  capturedFileName = '';
  createObjectURLMock = vi.fn((blob: Blob) => {
    capturedBlob = blob;
    return 'blob:mock-url';
  });
  URL.createObjectURL = createObjectURLMock as unknown as typeof URL.createObjectURL;
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(
    function mockClick(this: HTMLAnchorElement) {
      capturedFileName = this.download;
    },
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('WrongWordsExportSection (v1.1.0 Stage 2)', () => {
  it('T04: CSV 导出 — RFC 4180 转义 + 表头 + recent 行序 + YYYYMMDD 文件名', async () => {
    useWrongWordsStore.setState({
      entries: [
        // 旧条目 (lastWrongAt 较小) → recent 排序在第二行
        {
          ...BASE,
          cardId: 'id,with"quote',
          lexemeGroupId: 'lg-1',
          lemma: 'a,b"c',
          language: 'de',
          wrongCount: 1,
          firstWrongAt: Date.UTC(2026, 0, 1, 0, 0, 0),
          lastWrongAt: Date.UTC(2026, 0, 2, 0, 0, 0),
        },
        // 最近条目 → 第一行
        {
          ...BASE,
          cardId: 'lg-2',
          lexemeGroupId: 'lg-2',
          lemma: 'plain',
          language: undefined,
          wrongCount: 5,
          firstWrongAt: Date.UTC(2026, 0, 10, 0, 0, 0),
          lastWrongAt: Date.UTC(2026, 0, 20, 0, 0, 0),
        },
      ],
    });

    render(<WrongWordsExportSection />);

    fireEvent.click(screen.getByRole('button', { name: '导出 CSV' }));

    expect(createObjectURLMock).toHaveBeenCalledTimes(1);
    expect(capturedBlob).not.toBeNull();
    const text = await (capturedBlob as Blob).text();
    const lines = text.split('\n');

    // 表头
    expect(lines[0]).toBe('cardId,lexemeGroupId,lemma,language,wrongCount,firstWrongAt,lastWrongAt');
    // 行序 = recent (lastWrongAt 倒序): lg-2 在前
    expect(lines[1]).toBe(
      `lg-2,lg-2,plain,,5,${new Date(Date.UTC(2026, 0, 10, 0, 0, 0)).toISOString()},${new Date(Date.UTC(2026, 0, 20, 0, 0, 0)).toISOString()}`
    );
    // RFC 4180: 含逗号/双引号 → 整体双引号包裹 + 内部 " 翻倍; language 空值 → 空串
    expect(lines[2]).toBe(
      `"id,with""quote",lg-1,"a,b""c",de,1,${new Date(Date.UTC(2026, 0, 1, 0, 0, 0)).toISOString()},${new Date(Date.UTC(2026, 0, 2, 0, 0, 0)).toISOString()}`
    );

    // 文件名: 本地日期 YYYYMMDD
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    expect(capturedFileName).toBe(`wordaydream-wrong-words-${stamp}.csv`);
  });

  it('T05: JSON 导出 — schema/version/exportedAt/entries 结构断言', async () => {
    const entries: WrongWordEntry[] = [
      { ...BASE, cardId: 'lg-1', lexemeGroupId: 'lg-1', lemma: 'apple', language: 'en', wrongCount: 2, firstWrongAt: 1000, lastWrongAt: 9000 },
      { ...BASE, cardId: 'lg-2', lexemeGroupId: 'lg-2', lemma: 'Banane', language: 'de', wrongCount: 1, firstWrongAt: 2000, lastWrongAt: 5000 },
    ];
    useWrongWordsStore.setState({ entries });

    render(<WrongWordsExportSection />);

    fireEvent.click(screen.getByRole('button', { name: '导出 JSON' }));

    expect(capturedBlob).not.toBeNull();
    const text = await (capturedBlob as Blob).text();
    const payload = JSON.parse(text) as {
      schema: string;
      version: number;
      exportedAt: string;
      entries: WrongWordEntry[];
    };

    expect(payload.schema).toBe('wordaydream-wrong-words');
    expect(payload.version).toBe(1);
    expect(payload.exportedAt).toBe(new Date(payload.exportedAt).toISOString());
    expect(payload.entries).toEqual(entries);

    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    expect(capturedFileName).toBe(`wordaydream-wrong-words-${stamp}.json`);
  });

  it('T06: 空错词本 — 两按钮 disabled', () => {
    useWrongWordsStore.setState({ entries: [] });

    render(<WrongWordsExportSection />);

    expect(screen.getByRole('button', { name: '导出 CSV' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '导出 JSON' })).toBeDisabled();
    expect(createObjectURLMock).not.toHaveBeenCalled();
  });
});
