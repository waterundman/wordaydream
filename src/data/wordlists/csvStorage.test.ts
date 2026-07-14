/**
 * v2.2.0 Stage 2 (D2): CSV IndexedDB 持久化层 单元测试
 *
 * 覆盖 test_spec:
 * - T15: saveCsvWordlist + getCsvWordlist 往返一致
 * - T16: listCsvWordlists 返回所有已导入 CSV
 * - T17: deleteCsvWordlist 删除后 list 不含该 id
 *
 * 测试环境: 用 fake-indexeddb 在 jsdom 中模拟 IndexedDB
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  saveCsvWordlist,
  getCsvWordlist,
  listCsvWordlists,
  deleteCsvWordlist,
  getAllCsvEntries,
} from './csvStorage';
import type { CsvImportResult } from './csvLoader';

function makeImportResult(
  fileName: string,
  importedAt: number,
  entries: Array<{
    lemma: string;
    pos: string;
    translation: string;
    cefr: 'A1' | 'A2' | 'B1' | 'B2';
    priority?: 1 | 2 | 3;
  }>,
): CsvImportResult {
  return {
    success: true,
    entries,
    errors: [],
    fileName,
    importedAt,
  };
}

describe('csvStorage', () => {
  beforeEach(() => {
    // 清空 fake-indexeddb 数据 (每个 test 隔离)
    return new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase('wordaydream-csv-wordlists');
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  });

  afterEach(() => {
    return new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase('wordaydream-csv-wordlists');
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  });

  describe('T15: saveCsvWordlist + getCsvWordlist 往返一致', () => {
    it('保存后能按 id 读回相同数据', async () => {
      const importedAt = 1700000000000;
      const result = makeImportResult('test.csv', importedAt, [
        { lemma: 'apple', pos: 'noun', translation: '苹果', cefr: 'A1', priority: 1 },
        { lemma: 'run', pos: 'verb', translation: '跑', cefr: 'A2', priority: 2 },
      ]);

      const id = await saveCsvWordlist(result);
      expect(id).toBe(`test.csv-${importedAt}`);

      const stored = await getCsvWordlist(id);
      expect(stored).not.toBeNull();
      expect(stored!.id).toBe(id);
      expect(stored!.fileName).toBe('test.csv');
      expect(stored!.importedAt).toBe(importedAt);
      expect(stored!.entryCount).toBe(2);
      expect(stored!.entries).toEqual(result.entries);
    });

    it('查询不存在的 id 返回 null', async () => {
      const stored = await getCsvWordlist('nonexistent-123');
      expect(stored).toBeNull();
    });
  });

  describe('T16: listCsvWordlists 返回所有已导入 CSV', () => {
    it('返回所有已导入 CSV (按 importedAt 降序)', async () => {
      const result1 = makeImportResult('a.csv', 1700000000000, [
        { lemma: 'apple', pos: 'noun', translation: '苹果', cefr: 'A1' },
      ]);
      const result2 = makeImportResult('b.csv', 1700000001000, [
        { lemma: 'run', pos: 'verb', translation: '跑', cefr: 'A2' },
      ]);
      const result3 = makeImportResult('c.csv', 1700000002000, [
        { lemma: 'book', pos: 'noun', translation: '书', cefr: 'A1' },
      ]);

      await saveCsvWordlist(result1);
      await saveCsvWordlist(result2);
      await saveCsvWordlist(result3);

      const lists = await listCsvWordlists();
      expect(lists).toHaveLength(3);

      // 按 importedAt 降序 (新的在前)
      expect(lists[0].fileName).toBe('c.csv');
      expect(lists[1].fileName).toBe('b.csv');
      expect(lists[2].fileName).toBe('a.csv');
    });

    it('无数据时返回空数组', async () => {
      const lists = await listCsvWordlists();
      expect(lists).toEqual([]);
    });
  });

  describe('T17: deleteCsvWordlist 删除后 list 不含该 id', () => {
    it('删除后 list 不含该 id', async () => {
      const result1 = makeImportResult('keep.csv', 1700000000000, [
        { lemma: 'apple', pos: 'noun', translation: '苹果', cefr: 'A1' },
      ]);
      const result2 = makeImportResult('delete.csv', 1700000001000, [
        { lemma: 'run', pos: 'verb', translation: '跑', cefr: 'A2' },
      ]);

      const id1 = await saveCsvWordlist(result1);
      const id2 = await saveCsvWordlist(result2);

      let lists = await listCsvWordlists();
      expect(lists).toHaveLength(2);

      await deleteCsvWordlist(id2);

      lists = await listCsvWordlists();
      expect(lists).toHaveLength(1);
      expect(lists[0].id).toBe(id1);
      expect(lists.find((l) => l.id === id2)).toBeUndefined();
    });

    it('getAllCsvEntries 合并所有 CSV 的 entries', async () => {
      const result1 = makeImportResult('a.csv', 1700000000000, [
        { lemma: 'apple', pos: 'noun', translation: '苹果', cefr: 'A1' },
        { lemma: 'pear', pos: 'noun', translation: '梨', cefr: 'A1' },
      ]);
      const result2 = makeImportResult('b.csv', 1700000001000, [
        { lemma: 'run', pos: 'verb', translation: '跑', cefr: 'A2' },
      ]);

      await saveCsvWordlist(result1);
      await saveCsvWordlist(result2);

      const allEntries = await getAllCsvEntries();
      expect(allEntries).toHaveLength(3);
      expect(allEntries.map((e) => e.lemma)).toEqual(
        expect.arrayContaining(['apple', 'pear', 'run']),
      );
    });
  });
});
