/**
 * v2.2.0 Stage 2 (D2): CSV IndexedDB 持久化层 单元测试
 * v0.3.0-harmony Stage 4 (D3): IndexedDB 索引优化 测试 (T17/T18 Stage 4)
 *
 * 覆盖 test_spec:
 * - T15: saveCsvWordlist + getCsvWordlist 往返一致
 * - T16: listCsvWordlists 返回所有已导入 CSV
 * - T17: deleteCsvWordlist 删除后 list 不含该 id
 * - T17 (Stage 4): DB_VERSION 升级 1 -> 2 时创建 by_importedAt 索引 (不删除已有数据)
 * - T18 (Stage 4): listCsvWordlists 用索引游标倒序遍历 (不再 getAll + sort)
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

  // ===== v0.3.0-harmony Stage 4 (D3) 新增测试 =====

  describe('T17 (Stage 4): DB_VERSION 升级 1 -> 2 时创建 by_importedAt 索引 (不删除已有数据)', () => {
    it('v1 数据存在时, 升级到 v2 后 by_importedAt 索引存在 + 数据未删除', async () => {
      const DB_NAME = 'wordaydream-csv-wordlists';
      const STORE_NAME = 'wordlists';

      // Step 1: 手动创建 v1 数据库并插入数据 (模拟 v0.2.0 用户已有数据)
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          }
        };
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(STORE_NAME, 'readwrite');
          const store = tx.objectStore(STORE_NAME);
          store.put({
            id: 'old.csv-1700000000000',
            fileName: 'old.csv',
            importedAt: 1700000000000,
            entries: [],
            entryCount: 0,
          });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });

      // Step 2: 通过 saveCsvWordlist 触发 v2 升级 (DB_VERSION=2)
      await saveCsvWordlist(
        makeImportResult('new.csv', 1700000001000, [
          { lemma: 'new', pos: 'noun', translation: '新', cefr: 'A1' },
        ]),
      );

      // Step 3: 验证 by_importedAt 索引存在 + 旧数据未删除
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 2);
        req.onsuccess = () => {
          const db = req.result;
          const store = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME);
          // 索引存在
          expect(store.indexNames.contains('by_importedAt')).toBe(true);
          // 旧数据未删除
          const getReq = store.get('old.csv-1700000000000');
          getReq.onsuccess = () => {
            expect(getReq.result).toBeDefined();
            expect(getReq.result.fileName).toBe('old.csv');
            expect(getReq.result.importedAt).toBe(1700000000000);
            db.close();
            resolve();
          };
          getReq.onerror = () => reject(getReq.error);
        };
        req.onerror = () => reject(req.error);
      });
    });

    it('全新数据库 (v0 -> v2) 一次性创建 store + 索引', async () => {
      // 直接调用 saveCsvWordlist (DB_VERSION=2, 从 v0 升级)
      await saveCsvWordlist(
        makeImportResult('fresh.csv', 1700000000000, [
          { lemma: 'fresh', pos: 'noun', translation: '新鲜', cefr: 'A1' },
        ]),
      );

      // 验证 listCsvWordlists 正常工作 (索引可用)
      const lists = await listCsvWordlists();
      expect(lists).toHaveLength(1);
      expect(lists[0].fileName).toBe('fresh.csv');
    });
  });

  describe('T18 (Stage 4): listCsvWordlists 用索引游标倒序遍历 (不再 getAll + sort)', () => {
    it('用 by_importedAt 索引游标倒序遍历 (importedAt DESC)', async () => {
      // 插入多条记录, 时间戳非顺序
      const timestamps = [1000, 3000, 100, 2000, 500];
      for (const ts of timestamps) {
        await saveCsvWordlist(
          makeImportResult(`file${ts}.csv`, ts, [
            { lemma: `word${ts}`, pos: 'noun', translation: `翻译${ts}`, cefr: 'A1' },
          ]),
        );
      }

      const lists = await listCsvWordlists();
      expect(lists).toHaveLength(5);

      // 验证严格降序 (importedAt DESC)
      for (let i = 0; i < lists.length - 1; i++) {
        expect(lists[i].importedAt).toBeGreaterThanOrEqual(lists[i + 1].importedAt);
      }
      // 验证确切顺序
      expect(lists.map((l) => l.importedAt)).toEqual([3000, 2000, 1000, 500, 100]);
    });

    it('相同 importedAt 时稳定遍历 (不报错, 返回全部)', async () => {
      // 插入多条相同时间戳的记录
      const ts = 1700000000000;
      await saveCsvWordlist(
        makeImportResult('a.csv', ts, [
          { lemma: 'a', pos: 'noun', translation: 'A', cefr: 'A1' },
        ]),
      );
      await saveCsvWordlist(
        makeImportResult('b.csv', ts, [
          { lemma: 'b', pos: 'noun', translation: 'B', cefr: 'A1' },
        ]),
      );
      await saveCsvWordlist(
        makeImportResult('c.csv', ts, [
          { lemma: 'c', pos: 'noun', translation: 'C', cefr: 'A1' },
        ]),
      );

      const lists = await listCsvWordlists();
      expect(lists).toHaveLength(3);
      // 所有 importedAt 相同
      expect(lists.every((l) => l.importedAt === ts)).toBe(true);
    });

    it('单条记录游标遍历正常', async () => {
      await saveCsvWordlist(
        makeImportResult('solo.csv', 9999, [
          { lemma: 'solo', pos: 'noun', translation: '单独', cefr: 'A1' },
        ]),
      );

      const lists = await listCsvWordlists();
      expect(lists).toHaveLength(1);
      expect(lists[0].fileName).toBe('solo.csv');
      expect(lists[0].importedAt).toBe(9999);
    });
  });
});