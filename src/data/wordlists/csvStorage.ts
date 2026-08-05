/**
 * v2.2.0 Stage 2 (D2): CSV 词库 IndexedDB 持久化层
 * v0.3.0-harmony Stage 4 (D3): IndexedDB 索引优化 (by_importedAt 索引 + 游标倒序遍历)
 * v0.4.0-harmony Stage 2 D2: 连接池优化 (getDb 复用 + versionchange 重置) + getAllCsvEntries 游标分页
 *
 * 设计:
 * - 用原生 IndexedDB API (不引入 idb-keyval), 减少依赖
 * - DB_NAME = 'wordaydream-csv-wordlists', STORE_NAME = 'wordlists', DB_VERSION = 2
 * - v2: 创建 by_importedAt 索引, listCsvWordlists 用 idx.openCursor(null, 'prev') 倒序遍历
 * - saveCsvWordlist 生成 id = `${fileName}-${importedAt}`, 存入 IndexedDB, 返回 id
 * - getCsvWordlist 按 id 查询, 不存在返回 null
 * - listCsvWordlists 返回所有已导入 CSV (按 importedAt 降序, 索引游标遍历)
 * - deleteCsvWordlist 按 id 删除
 * - getAllCsvEntries 合并所有 CSV 的 entries 返回
 * - IndexedDB 不可用时 (隐私模式/catch 错误), 函数 reject (由调用方 catch 降级到内存)
 *
 * v0.4.0-harmony Stage 2 D2 优化:
 * - getDb() 连接池: 模块级缓存 dbInstance + dbPromise, 多次调用复用同一个 open 请求
 *   避免每次操作都 indexedDB.open() (连接建立开销 ~10-50ms)
 * - versionchange 事件监听: 其他 tab 要升级 DB 时, 当前连接自动 close + 重置缓存,
 *   下次 getDb 重新 open (标准 IndexedDB 连接池实践)
 * - getAllCsvEntries 游标分页: 用 store.openCursor() 遍历 wordlists,
 *   每页累积 PAGE_SIZE 条 entries 后 flush 到主数组, 避免一次性 getAll 内存峰值
 */
import type { CsvWordlistEntry, CsvImportResult } from './csvLoader';

const DB_NAME = 'wordaydream-csv-wordlists';
const STORE_NAME = 'wordlists';
const DB_VERSION = 2;
const INDEX_BY_IMPORTED_AT = 'by_importedAt';
/**
 * v0.4.0-harmony Stage 2 D2: getAllCsvEntries 游标分页页大小.
 *
 * 每累积 PAGE_SIZE 条 entries 后 flush 到主数组, 避免:
 * - 一次性 getAll 所有 wordlists (内存峰值 = 所有 wordlists + 所有 entries)
 * - 游标遍历下内存峰值 = 当前 wordlist + 累积 entries 数组
 */
const PAGE_SIZE = 100;

export interface StoredCsvWordlist {
  id: string;  // `${fileName}-${importedAt}`
  fileName: string;
  importedAt: number;
  entries: CsvWordlistEntry[];
  entryCount: number;
}

/**
 * v0.4.0-harmony Stage 2 D2: 连接池缓存.
 *
 * - dbInstance: 当前已打开的 IDBDatabase 实例 (null 表示未打开/已被 close)
 * - dbPromise: 正在进行的 open 请求 Promise (null 表示无进行中的请求)
 *
 * 复用策略:
 * - getDb() 优先返回 dbPromise (同一个 open 请求被多次复用, 避免并发 open 竞争)
 * - db 被 close 后 (versionchange 事件), 两个变量都重置为 null, 下次 getDb 重新 open
 */
let dbInstance: IDBDatabase | null = null;
let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * v0.4.0-harmony Stage 2 D2: 打开 IndexedDB (连接池优化), 不可用时抛错 (由调用方 catch 降级)
 *
 * 连接池策略:
 * - 优先返回缓存的 dbPromise (多次调用复用同一个 open 请求, 避免并发 open 竞争)
 * - db 被 close 后 (versionchange 事件触发), 重置 dbInstance = null + dbPromise = null,
 *   下次 getDb 重新 open
 * - versionchange 事件: 其他 tab 要升级 DB 版本时触发, 当前连接应自动 close 让出升级锁
 *
 * onupgradeneeded 升级路径 (R-IDB-1 缓解: 保留已有 store, 仅 createIndex):
 * - v1 (oldVersion < 1): 创建 objectStore 'wordlists' (keyPath='id')
 * - v2 (oldVersion < 2): 创建 by_importedAt 索引 (不删除已有 store/数据)
 */
function getDb(): Promise<IDBDatabase> {
  // 连接池: 复用正在进行或已完成的 open 请求
  if (dbPromise !== null) {
    return dbPromise;
  }

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB 不可用'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 打开失败'));
    request.onsuccess = () => {
      const db = request.result;
      // v0.4.0-harmony Stage 2 D2: 注册 versionchange 事件监听器
      // 其他 tab 要升级 DB 版本时触发, 当前连接应自动 close 让出升级锁
      // 重置缓存后, 下次 getDb 重新 open (新版本)
      db.addEventListener('versionchange', () => {
        db.close();
        dbInstance = null;
        dbPromise = null;
      });
      dbInstance = db;
      resolve(db);
    };
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      const oldVersion = event.oldVersion;
      // v1: 创建 store (保留现有逻辑, 兼容 oldVersion < 1 + 防御性检查)
      if (oldVersion < 1 || !db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
      // v2: 创建 by_importedAt 索引 (R-IDB-1 缓解: 不删除已有 store)
      if (oldVersion < 2) {
        const tx = (event.target as IDBOpenDBRequest).transaction;
        if (tx !== null) {
          const store = tx.objectStore(STORE_NAME);
          if (!store.indexNames.contains(INDEX_BY_IMPORTED_AT)) {
            store.createIndex(INDEX_BY_IMPORTED_AT, 'importedAt', { unique: false });
          }
        }
      }
    };
  });

  // open 失败时重置缓存, 让下次 getDb 重新尝试 (避免缓存 rejected promise)
  dbPromise.catch(() => {
    dbInstance = null;
    dbPromise = null;
  });

  return dbPromise;
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
  // v0.4.0-harmony Stage 2 D2: 用 getDb() 连接池复用 db 连接 (不再每次 openDb)
  const db = await getDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(stored);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 写入失败'));
    // v0.4.0-harmony Stage 2 D2: 不再 db.close() — 连接池复用, versionchange 时自动 close
  });
  return id;
}

/**
 * 按 id 查询 CSV 词库, 不存在返回 null
 */
export async function getCsvWordlist(id: string): Promise<StoredCsvWordlist | null> {
  // v0.4.0-harmony Stage 2 D2: 用 getDb() 连接池复用 db 连接
  const db = await getDb();
  return new Promise<StoredCsvWordlist | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(id);
    req.onsuccess = () => {
      // v0.4.0-harmony Stage 2 D2: 不再 db.close() — 连接池复用
      resolve((req.result as StoredCsvWordlist | undefined) ?? null);
    };
    req.onerror = () => {
      reject(req.error ?? new Error('IndexedDB 读取失败'));
    };
  });
}

/**
 * 返回所有已导入 CSV (按 importedAt 降序)
 *
 * v0.3.0 Stage 4 优化: 用 idx.openCursor(null, 'prev') 倒序遍历 by_importedAt 索引,
 * 替代 store.getAll() + 内存 sort (减少大数据量内存开销).
 *
 * v0.4.0-harmony Stage 2 D2: 用 getDb() 连接池复用 db 连接
 */
export async function listCsvWordlists(): Promise<StoredCsvWordlist[]> {
  const db = await getDb();
  return new Promise<StoredCsvWordlist[]>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const idx = store.index(INDEX_BY_IMPORTED_AT);
    const list: StoredCsvWordlist[] = [];
    // 'prev' 方向: 按 importedAt 降序 (新的在前)
    const req = idx.openCursor(null, 'prev');
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        list.push(cursor.value as StoredCsvWordlist);
        cursor.continue();
      } else {
        // v0.4.0-harmony Stage 2 D2: 不再 db.close() — 连接池复用
        resolve(list);
      }
    };
    req.onerror = () => {
      reject(req.error ?? new Error('IndexedDB 读取失败'));
    };
  });
}

/**
 * 按 id 删除 CSV 词库
 */
export async function deleteCsvWordlist(id: string): Promise<void> {
  // v0.4.0-harmony Stage 2 D2: 用 getDb() 连接池复用 db 连接
  const db = await getDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 删除失败'));
    // v0.4.0-harmony Stage 2 D2: 不再 db.close() — 连接池复用
  });
}

/**
 * 合并所有 CSV 的 entries 返回
 *
 * v0.4.0-harmony Stage 2 D2: 游标分页累积优化
 *
 * 优化前: listCsvWordlists() (内部游标遍历所有 wordlists) + flatMap(entries)
 *   - 内存峰值: 所有 wordlists 数组 + 所有 entries 数组 (双重分配)
 *   - 1000+ wordlists 时 flatMap 创建大中间数组, 内存峰值高
 *
 * 优化后: store.openCursor() 遍历 wordlists, 每页累积 PAGE_SIZE 条 entries 后 flush
 *   - 内存峰值: 当前 wordlist + 累积 entries 数组 (单一分配)
 *   - 游标遍历下 wordlists 不再全部加载到内存 (避免中间 listCsvWordlists 数组)
 *
 * 对外签名不变: 仍返回 Promise<CsvWordlistEntry[]> (全部 entries)
 */
export async function getAllCsvEntries(): Promise<CsvWordlistEntry[]> {
  const db = await getDb();
  return new Promise<CsvWordlistEntry[]>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const allEntries: CsvWordlistEntry[] = [];
    // 当前页累积 buffer: 遍历游标时逐条 extend, 达到 PAGE_SIZE 后 flush 到主数组
    // 避免: ① 一次性 getAll 所有 wordlists (内存峰值高)
    //       ② 游标遍历时每条 entry 都 push 主数组 (频繁扩容, GC 压力大)
    let page: CsvWordlistEntry[] = [];
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        const list = cursor.value as StoredCsvWordlist;
        // 当前 wordlist 的 entries 加入当前页累积 buffer
        page.push(...list.entries);
        // 每页累积到 PAGE_SIZE 后 flush 到主数组 (减少主数组 push 次数 + GC 压力)
        while (page.length >= PAGE_SIZE) {
          allEntries.push(...page.splice(0, PAGE_SIZE));
        }
        cursor.continue();
      } else {
        // 游标遍历结束: flush 剩余 entries (不足 PAGE_SIZE 的尾部)
        if (page.length > 0) {
          allEntries.push(...page);
        }
        resolve(allEntries);
      }
    };
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 读取失败'));
  });
}
