/**
 * v2.2.0 Stage 4 (D3): LLM 改写 gloss 缓存持久化层
 *
 * 设计目标:
 * - 把 LLM 改写结果持久化到 IndexedDB, 二次访问 < 50ms, 减少 LLM quota 消耗.
 * - TTL 30 天 + LRU 5000 条上限, 避免无限增长.
 * - sourceHash 校验: 字典原文变化时缓存自动失效, 重写一次.
 * - IndexedDB 不可用时 (隐私模式/SSR/老浏览器) 降级到内存 Map, 不抛错.
 *
 * 设计参考: Stage 2 csvStorage.ts (原生 IndexedDB API, 不引入新依赖).
 *
 * key 格式: `${language}::${lemma.toLowerCase()}`
 * sourceHash: djb2 算法, 由 glossAdapter.computeSourceHash 计算 (字典原文稳定序列化后 hash).
 */
import type { Language } from '../../../types';

/* eslint-disable @typescript-eslint/no-magic-numbers */

const DB_NAME = 'wordaydream-gloss-cache';
const STORE_NAME = 'glosses';
const DB_VERSION = 1;
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 天
const MAX_ENTRIES = 5000;

export interface CachedGloss {
  /** 主键: `${language}::${lemma.toLowerCase()}` */
  key: string;
  /** LLM 改写后的中文释义 */
  definitions: string[];
  /** 可选的中文补充解释 */
  explanation?: string;
  /** 写入时间戳 (ms) */
  timestamp: number;
  /** LLM provider 标识 (e.g. 'openai' / 'deepseek') */
  llmProvider: string;
  /** LLM model 标识 (e.g. 'gpt-4o-mini') */
  llmModel: string;
  /** 字典原文 hash, 用于检测字典数据更新 (glossAdapter.computeSourceHash 计算) */
  sourceHash: string;
}

/**
 * 内存降级 Map: IndexedDB 不可用时使用.
 * key -> CachedGloss (含 timestamp, TTL 检查同 IndexedDB 路径).
 */
const memoryFallback = new Map<string, CachedGloss>();

/**
 * IndexedDB 是否已检测为不可用 (一旦失败, 后续直接走内存, 避免重复抛错开销).
 */
let indexedDbUnavailable = false;

/**
 * 打开 IndexedDB. 不可用时抛错 (由调用方 catch 降级到内存).
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
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
  });
}

function makeKey(language: Language, lemma: string): string {
  return `${language}::${lemma.toLowerCase()}`;
}

/**
 * 判断 entry 是否已过期 (TTL 30 天)
 */
function isExpired(entry: CachedGloss, now: number = Date.now()): boolean {
  return now - entry.timestamp > TTL_MS;
}

/**
 * 查询缓存. 命中 + 未过期 + sourceHash 匹配返回 CachedGloss; 否则返回 null.
 *
 * TTL 过期检查: 命中但已过期时, 删除该 entry 并返回 null.
 * sourceHash 校验由调用方 (glossAdapter) 完成, 本函数仅返回缓存原文,
 * 调用方比对 cached.sourceHash === expectedHash 决定是否使用.
 *
 * IndexedDB 不可用时降级到内存 Map.
 */
export async function getCachedGloss(
  language: Language,
  lemma: string,
): Promise<CachedGloss | null> {
  const key = makeKey(language, lemma);
  if (indexedDbUnavailable) {
    const mem = memoryFallback.get(key);
    if (!mem) return null;
    if (isExpired(mem)) {
      memoryFallback.delete(key);
      return null;
    }
    return mem;
  }
  try {
    const db = await openDb();
    const entry = await new Promise<CachedGloss | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => {
        const result = (req.result as CachedGloss | undefined) ?? null;
        // 命中但已过期 → 删除并返回 null
        if (result && isExpired(result)) {
          store.delete(key);
          resolve(null);
          return;
        }
        resolve(result);
      };
      req.onerror = () => reject(req.error ?? new Error('IndexedDB 读取失败'));
      tx.oncomplete = () => {
        db.close();
      };
    });
    return entry;
  } catch {
    // 降级到内存 Map
    indexedDbUnavailable = true;
    const mem = memoryFallback.get(key);
    if (!mem) return null;
    if (isExpired(mem)) {
      memoryFallback.delete(key);
      return null;
    }
    return mem;
  }
}

/**
 * 写入缓存. 同时触发 LRU 淘汰 (超出 MAX_ENTRIES 时删 timestamp 最旧的).
 *
 * IndexedDB 不可用时降级到内存 Map.
 */
export async function setCachedGloss(
  language: Language,
  lemma: string,
  gloss: Omit<CachedGloss, 'key' | 'timestamp'>,
): Promise<void> {
  const key = makeKey(language, lemma);
  const entry: CachedGloss = {
    ...gloss,
    key,
    timestamp: Date.now(),
  };
  if (indexedDbUnavailable) {
    memoryFallback.set(key, entry);
    await evictMemoryIfNeeded();
    return;
  }
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(entry);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 写入失败'));
    });
    // LRU 淘汰: 写入后异步检查并删除超量旧 entry
    await evictIndexedDbIfNeeded();
  } catch {
    // 降级到内存 Map
    indexedDbUnavailable = true;
    memoryFallback.set(key, entry);
    await evictMemoryIfNeeded();
  }
}

/**
 * 清空所有缓存.
 *
 * IndexedDB 不可用时清空内存 Map.
 */
export async function clearAllCachedGlosses(): Promise<void> {
  memoryFallback.clear();
  if (indexedDbUnavailable) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.clear();
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 清空失败'));
    });
  } catch {
    indexedDbUnavailable = true;
  }
}

/**
 * 返回当前缓存条数.
 *
 * IndexedDB 不可用时返回内存 Map 大小.
 */
export async function getCachedGlossCount(): Promise<number> {
  if (indexedDbUnavailable) {
    return memoryFallback.size;
  }
  try {
    const db = await openDb();
    return await new Promise<number>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.count();
      req.onsuccess = () => {
        db.close();
        resolve(req.result ?? 0);
      };
      req.onerror = () => {
        db.close();
        reject(req.error ?? new Error('IndexedDB count 失败'));
      };
    });
  } catch {
    indexedDbUnavailable = true;
    return memoryFallback.size;
  }
}

/**
 * 删除所有过期 entry, 返回删除条数.
 * 供定时清理任务或用户主动调用.
 *
 * IndexedDB 不可用时操作内存 Map.
 */
export async function pruneExpiredEntries(): Promise<number> {
  const now = Date.now();
  if (indexedDbUnavailable) {
    let deleted = 0;
    for (const [k, v] of memoryFallback) {
      if (isExpired(v, now)) {
        memoryFallback.delete(k);
        deleted++;
      }
    }
    return deleted;
  }
  try {
    const db = await openDb();
    return await new Promise<number>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      let deleted = 0;
      req.onsuccess = () => {
        const all = (req.result as CachedGloss[]) ?? [];
        for (const entry of all) {
          if (isExpired(entry, now)) {
            store.delete(entry.key);
            deleted++;
          }
        }
      };
      tx.oncomplete = () => {
        db.close();
        resolve(deleted);
      };
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB prune 失败'));
    });
  } catch {
    indexedDbUnavailable = true;
    let deleted = 0;
    for (const [k, v] of memoryFallback) {
      if (isExpired(v, now)) {
        memoryFallback.delete(k);
        deleted++;
      }
    }
    return deleted;
  }
}

/**
 * LRU 淘汰: 内存 Map 超 MAX_ENTRIES 时删 timestamp 最旧的.
 */
async function evictMemoryIfNeeded(): Promise<void> {
  while (memoryFallback.size > MAX_ENTRIES) {
    let oldestKey: string | null = null;
    let oldestTs = Infinity;
    for (const [k, v] of memoryFallback) {
      if (v.timestamp < oldestTs) {
        oldestTs = v.timestamp;
        oldestKey = k;
      }
    }
    if (oldestKey === null) break;
    memoryFallback.delete(oldestKey);
  }
}

/**
 * LRU 淘汰: IndexedDB 超 MAX_ENTRIES 时删 timestamp 最旧的 (逐条删到上限以内).
 */
async function evictIndexedDbIfNeeded(): Promise<void> {
  try {
    const count = await getCachedGlossCount();
    if (count <= MAX_ENTRIES) return;
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const all = (req.result as CachedGloss[]) ?? [];
        // 按 timestamp 升序, 删除最旧的 (count - MAX_ENTRIES) 条
        all.sort((a, b) => a.timestamp - b.timestamp);
        const toDelete = all.slice(0, Math.max(0, all.length - MAX_ENTRIES));
        for (const entry of toDelete) {
          store.delete(entry.key);
        }
      };
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB LRU 淘汰失败'));
    });
  } catch {
    // 淘汰失败不影响主流程 (写入已完成)
  }
}
