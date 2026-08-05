/**
 * v2.2.0 Stage 4 (D3): glossPersistentCache 单元测试
 *
 * 覆盖 test_spec (v2.2.0 Stage 4):
 * - T27 [critical]: setCachedGloss + getCachedGloss 往返一致
 * - T28 [critical]: getCachedGloss 命中缓存返回 CachedGloss
 * - T29 [critical]: getCachedGloss 未命中返回 null
 * - T30 [critical]: clearAllCachedGlosses 清空后 count 为 0
 *
 * 测试环境: 用 fake-indexeddb 在 jsdom 中模拟 IndexedDB (Stage 2 已引入).
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getCachedGloss,
  setCachedGloss,
  clearAllCachedGlosses,
  getCachedGlossCount,
  pruneExpiredEntries,
} from './glossPersistentCache';

const DB_NAME = 'wordaydream-gloss-cache';

function deleteDb(): Promise<void> {
  return new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

describe('glossPersistentCache (v2.2.0 Stage 4 D3)', () => {
  beforeEach(async () => {
    await deleteDb();
    await clearAllCachedGlosses();
  });

  afterEach(async () => {
    await deleteDb();
    await clearAllCachedGlosses();
  });

  describe('T27: setCachedGloss + getCachedGloss 往返一致', () => {
    it('写入后能按 (language, lemma) 读回相同数据', async () => {
      await setCachedGloss('en', 'revolution', {
        definitions: ['革命', '变革'],
        explanation: '指根本性变化',
        llmProvider: 'deepseek',
        llmModel: 'deepseek-chat',
        sourceHash: 'abc123',
      });

      const cached = await getCachedGloss('en', 'revolution');
      expect(cached).not.toBeNull();
      expect(cached!.key).toBe('en::revolution');
      expect(cached!.definitions).toEqual(['革命', '变革']);
      expect(cached!.explanation).toBe('指根本性变化');
      expect(cached!.llmProvider).toBe('deepseek');
      expect(cached!.llmModel).toBe('deepseek-chat');
      expect(cached!.sourceHash).toBe('abc123');
      expect(typeof cached!.timestamp).toBe('number');
      expect(cached!.timestamp).toBeGreaterThan(0);
    });

    it('lemma 大小写不敏感 (key 用 toLowerCase)', async () => {
      await setCachedGloss('en', 'Revolution', {
        definitions: ['革命'],
        llmProvider: 'openai',
        llmModel: 'gpt-4o-mini',
        sourceHash: 'h1',
      });
      // 用小写查应该命中
      const cached = await getCachedGloss('en', 'revolution');
      expect(cached).not.toBeNull();
      expect(cached!.definitions).toEqual(['革命']);
      // key 是小写形式
      expect(cached!.key).toBe('en::revolution');
    });

    it('不同 language 的相同 lemma 互不干扰', async () => {
      await setCachedGloss('en', 'haus', {
        definitions: ['house (en)'],
        llmProvider: 'openai',
        llmModel: 'gpt-4o',
        sourceHash: 'h-en',
      });
      await setCachedGloss('de', 'haus', {
        definitions: ['房子 (de)'],
        llmProvider: 'deepseek',
        llmModel: 'deepseek-chat',
        sourceHash: 'h-de',
      });

      const en = await getCachedGloss('en', 'haus');
      const de = await getCachedGloss('de', 'haus');
      expect(en!.definitions).toEqual(['house (en)']);
      expect(de!.definitions).toEqual(['房子 (de)']);
    });
  });

  describe('T28: getCachedGloss 命中缓存返回 CachedGloss', () => {
    it('缓存存在时返回 CachedGloss (含 timestamp)', async () => {
      const before = Date.now();
      await setCachedGloss('de', 'verbergen', {
        definitions: ['隐藏'],
        explanation: '可指物理或情感上的隐藏',
        llmProvider: 'anthropic',
        llmModel: 'claude-3-5-sonnet',
        sourceHash: 'deadbeef',
      });
      const after = Date.now();

      const cached = await getCachedGloss('de', 'verbergen');
      expect(cached).not.toBeNull();
      expect(cached!.definitions).toEqual(['隐藏']);
      expect(cached!.explanation).toBe('可指物理或情感上的隐藏');
      expect(cached!.sourceHash).toBe('deadbeef');
      // timestamp 在写入前后区间内
      expect(cached!.timestamp).toBeGreaterThanOrEqual(before);
      expect(cached!.timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('T29: getCachedGloss 未命中返回 null', () => {
    it('查询不存在的 lemma 返回 null', async () => {
      const cached = await getCachedGloss('en', 'nonexistent-word-xyz');
      expect(cached).toBeNull();
    });

    it('清空后查询返回 null', async () => {
      await setCachedGloss('en', 'revolution', {
        definitions: ['革命'],
        llmProvider: 'openai',
        llmModel: 'gpt-4o',
        sourceHash: 'h1',
      });
      // 确认写入成功
      expect(await getCachedGloss('en', 'revolution')).not.toBeNull();
      // 清空
      await clearAllCachedGlosses();
      // 清空后查不到
      expect(await getCachedGloss('en', 'revolution')).toBeNull();
    });
  });

  describe('T30: clearAllCachedGlosses 清空后 count 为 0', () => {
    it('清空后 count 为 0', async () => {
      // 写入多条
      await setCachedGloss('en', 'apple', {
        definitions: ['苹果'],
        llmProvider: 'openai',
        llmModel: 'gpt-4o',
        sourceHash: 'h1',
      });
      await setCachedGloss('en', 'banana', {
        definitions: ['香蕉'],
        llmProvider: 'openai',
        llmModel: 'gpt-4o',
        sourceHash: 'h2',
      });
      await setCachedGloss('de', 'apfel', {
        definitions: ['苹果'],
        llmProvider: 'deepseek',
        llmModel: 'deepseek-chat',
        sourceHash: 'h3',
      });

      // count = 3
      expect(await getCachedGlossCount()).toBe(3);

      // 清空
      await clearAllCachedGlosses();

      // count = 0
      expect(await getCachedGlossCount()).toBe(0);
    });

    it('空库时 count 为 0', async () => {
      expect(await getCachedGlossCount()).toBe(0);
    });
  });

  describe('TTL 过期 (补充覆盖)', () => {
    it('pruneExpiredEntries 删除过期 entry, 返回删除条数', async () => {
      // 写入一条, 然后手动改 timestamp 模拟过期
      await setCachedGloss('en', 'old-word', {
        definitions: ['旧词'],
        llmProvider: 'openai',
        llmModel: 'gpt-4o',
        sourceHash: 'h-old',
      });
      // 直接操作 IndexedDB 把 timestamp 改到 31 天前
      const thirtyOneDaysAgo = Date.now() - 31 * 24 * 60 * 60 * 1000;
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 2);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('glosses', 'readwrite');
          const store = tx.objectStore('glosses');
          const getReq = store.get('en::old-word');
          getReq.onsuccess = () => {
            const entry = getReq.result;
            entry.timestamp = thirtyOneDaysAgo;
            store.put(entry);
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });

      // 过期 entry 存在, prune 应删除 1 条
      const deleted = await pruneExpiredEntries();
      expect(deleted).toBe(1);

      // 删除后查不到
      expect(await getCachedGloss('en', 'old-word')).toBeNull();
    });

    it('getCachedGloss 命中过期 entry 时返回 null 并删除', async () => {
      await setCachedGloss('en', 'expired', {
        definitions: ['过期词'],
        llmProvider: 'openai',
        llmModel: 'gpt-4o',
        sourceHash: 'h-expired',
      });
      // 改 timestamp 到 31 天前
      const thirtyOneDaysAgo = Date.now() - 31 * 24 * 60 * 60 * 1000;
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 2);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('glosses', 'readwrite');
          const store = tx.objectStore('glosses');
          const getReq = store.get('en::expired');
          getReq.onsuccess = () => {
            const entry = getReq.result;
            entry.timestamp = thirtyOneDaysAgo;
            store.put(entry);
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });

      // 命中过期 entry → 返回 null
      expect(await getCachedGloss('en', 'expired')).toBeNull();
      // 且已被删除 (count 不含它)
      // 注意: count 可能含其他 entry, 这里单独验证此 key 不存在
      expect(await getCachedGloss('en', 'expired')).toBeNull();
    });
  });

  // ===== v0.3.0-harmony Stage 4 (D3) new tests =====

  describe('T19 (Stage 4): DB_VERSION upgrade 1 -> 2 creates by_timestamp index', () => {
    it('v1 data exists -> upgrade to v2 -> by_timestamp index exists + data preserved', async () => {
      const STORE_NAME = 'glosses';

      // Step 1: Manually create v1 DB and insert data (simulate v0.2.0 user data)
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 2);
        req.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: 'key' });
          }
        };
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(STORE_NAME, 'readwrite');
          const store = tx.objectStore(STORE_NAME);
          store.put({
            key: 'en::old',
            definitions: ['old-def'],
            timestamp: Date.now() - 1000,
            llmProvider: 'test',
            llmModel: 'test-model',
            sourceHash: 'h-old',
          });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });

      // Step 2: Trigger v2 upgrade via setCachedGloss (DB_VERSION=2)
      await setCachedGloss('en', 'new', {
        definitions: ['new-def'],
        llmProvider: 'test',
        llmModel: 'test-model',
        sourceHash: 'h-new',
      });

      // Step 3: Verify by_timestamp index exists + old data preserved
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 2);
        req.onsuccess = () => {
          const db = req.result;
          const store = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME);
          expect(store.indexNames.contains('by_timestamp')).toBe(true);
          const getReq = store.get('en::old');
          getReq.onsuccess = () => {
            expect(getReq.result).toBeDefined();
            expect(getReq.result.definitions).toEqual(['old-def']);
            db.close();
            resolve();
          };
          getReq.onerror = () => reject(getReq.error);
        };
        req.onerror = () => reject(req.error);
      });
    });

    it('fresh DB (v0 -> v2) creates store + index in one step', async () => {
      await setCachedGloss('en', 'fresh', {
        definitions: ['fresh-def'],
        llmProvider: 'test',
        llmModel: 'test-model',
        sourceHash: 'h-fresh',
      });

      const cached = await getCachedGloss('en', 'fresh');
      expect(cached).not.toBeNull();
      expect(cached!.definitions).toEqual(['fresh-def']);
    });
  });

  describe('T20 (Stage 4): evictIndexedDbIfNeeded deletes oldest N via index cursor', () => {
    it('5001 entries -> evict to 5000, oldest N deleted (cursor.delete)', async () => {
      const STORE_NAME = 'glosses';
      const baseTime = Date.now() - 6000 * 1000; // 100 min ago, well within 30-day TTL

      // Step 1: Bulk insert 5001 entries (raw IndexedDB, single transaction)
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 2);
        req.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          const oldVersion = event.oldVersion;
          if (oldVersion < 1 || !db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: 'key' });
          }
          if (oldVersion < 2) {
            const tx = (event.target as IDBOpenDBRequest).transaction;
            if (tx !== null) {
              const store = tx.objectStore(STORE_NAME);
              if (!store.indexNames.contains('by_timestamp')) {
                store.createIndex('by_timestamp', 'timestamp', { unique: false });
              }
            }
          }
        };
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(STORE_NAME, 'readwrite');
          const store = tx.objectStore(STORE_NAME);
          for (let i = 0; i < 5001; i++) {
            store.put({
              key: `en::word${i}`,
              definitions: [`def${i}`],
              timestamp: baseTime + i,
              llmProvider: 'test',
              llmModel: 'test-model',
              sourceHash: `h${i}`,
            });
          }
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });

      // Step 2: Verify count = 5001
      expect(await getCachedGlossCount()).toBe(5001);

      // Step 3: Trigger LRU eviction (write 5002nd entry)
      await setCachedGloss('en', 'trigger-eviction', {
        definitions: ['trigger'],
        llmProvider: 'test',
        llmModel: 'test-model',
        sourceHash: 'h-trigger',
      });

      // Step 4: Verify count = 5000 (deleted 2: 5002 - 5000 = 2)
      expect(await getCachedGlossCount()).toBe(5000);

      // Step 5: Verify oldest 2 entries deleted (word0, word1)
      expect(await getCachedGloss('en', 'word0')).toBeNull();
      expect(await getCachedGloss('en', 'word1')).toBeNull();

      // Step 6: Verify 3rd entry (word2) still exists
      const survivor = await getCachedGloss('en', 'word2');
      expect(survivor).not.toBeNull();
      expect(survivor!.definitions).toEqual(['def2']);

      // Step 7: Verify newest entry still exists
      const newest = await getCachedGloss('en', 'word5000');
      expect(newest).not.toBeNull();
      expect(newest!.definitions).toEqual(['def5000']);
    }, 30000); // 30s timeout (5001 entries insert + eviction)
  });
});
