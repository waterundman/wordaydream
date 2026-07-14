/**
 * v2.2.0 Stage 2 (D2): CSV 词库 IndexedDB 持久化层
 *
 * 设计:
 * - 用原生 IndexedDB API (不引入 idb-keyval), 减少依赖
 * - DB_NAME = 'wordaydream-csv-wordlists', STORE_NAME = 'wordlists', DB_VERSION = 1
 * - saveCsvWordlist 生成 id = `${fileName}-${importedAt}`, 存入 IndexedDB, 返回 id
 * - getCsvWordlist 按 id 查询, 不存在返回 null
 * - listCsvWordlists 返回所有已导入 CSV (按 importedAt 降序)
 * - deleteCsvWordlist 按 id 删除
 * - getAllCsvEntries 合并所有 CSV 的 entries 返回
 * - IndexedDB 不可用时 (隐私模式/catch 错误), 函数 reject (由调用方 catch 降级到内存)
 */
import type { CsvWordlistEntry, CsvImportResult } from './csvLoader';

const DB_NAME = 'wordaydream-csv-wordlists';
const STORE_NAME = 'wordlists';
const DB_VERSION = 1;

export interface StoredCsvWordlist {
  id: string;  // `${fileName}-${importedAt}`
  fileName: string;
  importedAt: number;
  entries: CsvWordlistEntry[];
  entryCount: number;
}

/**
 * 打开 IndexedDB, 不可用时抛错 (由调用方 catch 降级)
 */
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB 不可用'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 打开失败'));
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
}

/**
 * 保存 CSV 导入结果到 IndexedDB
 * @returns id = `${fileName}-${importedAt}`
 */
export async function saveCsvWordlist(result: CsvImportResult): Promise<string> {
  const id = `${result.fileName}-${result.importedAt}`;
  const stored: StoredCsvWordlist = {
    id,
    fileName: result.fileName,
    importedAt: result.importedAt,
    entries: result.entries,
    entryCount: result.entries.length,
  };
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(stored);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 写入失败'));
    tx.oncomplete = () => {
      db.close();
    };
  });
  return id;
}

/**
 * 按 id 查询 CSV 词库, 不存在返回 null
 */
export async function getCsvWordlist(id: string): Promise<StoredCsvWordlist | null> {
  const db = await openDb();
  return new Promise<StoredCsvWordlist | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(id);
    req.onsuccess = () => {
      db.close();
      resolve((req.result as StoredCsvWordlist | undefined) ?? null);
    };
    req.onerror = () => {
      db.close();
      reject(req.error ?? new Error('IndexedDB 读取失败'));
    };
  });
}

/**
 * 返回所有已导入 CSV (按 importedAt 降序)
 */
export async function listCsvWordlists(): Promise<StoredCsvWordlist[]> {
  const db = await openDb();
  return new Promise<StoredCsvWordlist[]>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => {
      db.close();
      const list = (req.result as StoredCsvWordlist[]) ?? [];
      // 按 importedAt 降序 (新的在前)
      list.sort((a, b) => b.importedAt - a.importedAt);
      resolve(list);
    };
    req.onerror = () => {
      db.close();
      reject(req.error ?? new Error('IndexedDB 读取失败'));
    };
  });
}

/**
 * 按 id 删除 CSV 词库
 */
export async function deleteCsvWordlist(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 删除失败'));
    tx.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * 合并所有 CSV 的 entries 返回
 */
export async function getAllCsvEntries(): Promise<CsvWordlistEntry[]> {
  const lists = await listCsvWordlists();
  return lists.flatMap((list) => list.entries);
}
