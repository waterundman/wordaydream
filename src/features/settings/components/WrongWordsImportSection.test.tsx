/**
 * WrongWordsImportSection 测试 (v1.4.0 S2)
 *
 * 覆盖 SPEC v1.4.0 合同 C2.1-C2.4:
 * - T01 [C2.1] 渲染 + hidden file input (accept=".csv,.json") + 触发按钮
 * - T02 [C2.2] CSV 文件导入成功 → store entries 增加 + success 结果行含 imported 数
 * - T03 [C2.3] 含非法行 CSV → 结果行列拒绝明细, 合法部分入库
 * - T04 [C2.3] 不支持文件类型 → error 反馈 + store 不变
 * - T05 [C2.3] 非本产品 JSON (schema 不符) → error 反馈 + store 不变
 * - T06 [C2.4] SettingsPanel 挂载顺序: WrongWordsExportSection 之后紧跟 WrongWordsImportSection
 *   (源码顺序断言: 组件文件内 Export 挂载点先于 Import)
 *
 * file 模拟: 不依赖 jsdom File.text() — 直接注入 { name, text } 形状对象,
 * fireEvent.change(input, { target: { files: [fake] } }) 触发 handleInputChange.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { WrongWordsImportSection } from './WrongWordsImportSection';
import { useWrongWordsStore, type WrongWordEntry } from '../../review/store/useWrongWordsStore';
import { buildCsv } from '../wrongWordsCsvFormat';

const T0 = 1_726_000_000_000;

function makeEntry(cardId: string, overrides: Partial<WrongWordEntry> = {}): WrongWordEntry {
  return {
    cardId,
    lexemeGroupId: `lg-${cardId}`,
    lemma: `lemma-${cardId}`,
    language: 'en',
    wrongCount: 1,
    firstWrongAt: T0,
    lastWrongAt: T0 + 1000,
    ...overrides,
  };
}

/** 不依赖 jsdom File 实现的最小文件形状 */
function fakeFile(name: string, content: string): File {
  return {
    name,
    text: async () => content,
  } as unknown as File;
}

function chooseFile(content: string, name: string): void {
  const input = screen.getByTestId('wrong-words-import-input') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [fakeFile(name, content)] } });
}

describe('WrongWordsImportSection', () => {
  beforeEach(() => {
    useWrongWordsStore.setState({ entries: [] });
  });

  afterEach(() => {
    cleanup();
    useWrongWordsStore.setState({ entries: [] });
  });

  it('T01 [C2.1] 渲染: 标题 + 触发按钮 + hidden file input (accept=".csv,.json")', () => {
    render(<WrongWordsImportSection />);
    expect(screen.getByText('错词导入')).toBeTruthy();
    expect(screen.getByRole('button', { name: /导入错词/ })).toBeTruthy();
    const input = screen.getByTestId('wrong-words-import-input') as HTMLInputElement;
    expect(input.type).toBe('file');
    expect(input.accept).toBe('.csv,.json');
    expect(input.className).toContain('fileInput');
  });

  it('T02 [C2.2] CSV 导入成功 → entries 增加 + success 结果行含 imported 数', async () => {
    const csv = buildCsv([makeEntry('c1'), makeEntry('c2')]);
    render(<WrongWordsImportSection />);
    chooseFile(csv, 'wordaydream-wrong-words-20260914.csv');

    await waitFor(() => {
      expect(screen.getByTestId('wrong-words-import-result')).toBeTruthy();
    });
    expect(screen.getByTestId('wrong-words-import-result').textContent).toContain('导入 2 条');
    expect(useWrongWordsStore.getState().entries.map((e) => e.cardId)).toEqual(['c1', 'c2']);
  });

  it('T03 [C2.3] 含非法行 CSV → 合法部分入库 + 结果行列拒绝明细', async () => {
    const iso = '2024-09-10T12:00:00.000Z';
    const csv = [
      'cardId,lexemeGroupId,lemma,language,wrongCount,firstWrongAt,lastWrongAt',
      'c1,lg1,alpha,en,1,' + iso + ',' + iso,
      'c2,lg2,,en,1,' + iso + ',' + iso, // 空 lemma → rejected
    ].join('\n');
    render(<WrongWordsImportSection />);
    chooseFile(csv, 'partial.csv');

    await waitFor(() => {
      expect(screen.getByTestId('wrong-words-import-result')).toBeTruthy();
    });
    const text = screen.getByTestId('wrong-words-import-result').textContent ?? '';
    expect(text).toContain('导入 1 条');
    expect(text).toContain('拒绝 1 条');
    expect(text).toContain('行 2: lemma 不能为空');
    expect(useWrongWordsStore.getState().entries.map((e) => e.cardId)).toEqual(['c1']);
  });

  it('T04 [C2.3] 不支持文件类型 → error 反馈 + store 不变', async () => {
    render(<WrongWordsImportSection />);
    chooseFile('hello', 'notes.txt');

    await waitFor(() => {
      expect(screen.getByTestId('wrong-words-import-result')).toBeTruthy();
    });
    const text = screen.getByTestId('wrong-words-import-result').textContent ?? '';
    expect(text).toContain('不支持的文件类型');
    expect(useWrongWordsStore.getState().entries).toHaveLength(0);
  });

  it('T05 [C2.3] 非本产品 JSON → error 反馈 + store 不变', async () => {
    render(<WrongWordsImportSection />);
    chooseFile(JSON.stringify({ schema: 'other-app', version: 1, entries: [] }), 'other.json');

    await waitFor(() => {
      expect(screen.getByTestId('wrong-words-import-result')).toBeTruthy();
    });
    const text = screen.getByTestId('wrong-words-import-result').textContent ?? '';
    expect(text).toContain('schema 不符');
    expect(useWrongWordsStore.getState().entries).toHaveLength(0);
  });

  it('T06 [C2.4] SettingsPanel 源码挂载顺序: Export 之后紧跟 Import', () => {
    const source = readFileSync(
      join(__dirname, 'SettingsPanel.tsx'),
      'utf-8',
    );
    const exportIdx = source.indexOf('<WrongWordsExportSection />');
    const importIdx = source.indexOf('<WrongWordsImportSection />');
    expect(exportIdx).toBeGreaterThan(-1);
    expect(importIdx).toBeGreaterThan(exportIdx);
  });
});
