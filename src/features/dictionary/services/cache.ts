/**
 * 简单 LRU (Least Recently Used) 缓存
 *
 * 用途: 缓存 wiktextract 查询结果, 避免重复网络请求.
 * - 容量上限: 默认 100 条, 可在构造时指定
 * - 命中行为: get() 时把命中项移到尾部, 标记为最近使用
 * - 淘汰策略: 超过 capacity 时, 删除最久未使用的头部项
 * - 线程安全: 否 (单线程 JS 环境足够)
 *
 * 约束 (项目设计总结第七节): 缓存策略要合理, 避免内存泄漏.
 * 这里通过 capacity 硬性限制, 保证最大内存占用有界.
 */

export interface CacheOptions {
  /** 最大条目数, 默认 100 */
  capacity?: number;
  /** 可选: 条目过期时间 (毫秒), 默认不过期 */
  ttlMs?: number;
}

interface CacheNode<V> {
  key: string;
  value: V;
  expiresAt: number | null;
}

/* eslint-disable @typescript-eslint/no-magic-numbers */

export class LRUCache<V> {
  private readonly capacity: number;
  private readonly ttlMs: number | null;
  /** 头部 = 最久未使用, 尾部 = 最近使用 */
  private readonly store: Map<string, CacheNode<V>>;

  constructor(options: CacheOptions = {}) {
    this.capacity = Math.max(1, options.capacity ?? 100);
    this.ttlMs = options.ttlMs ?? null;
    this.store = new Map();
  }

  /**
   * 获取缓存项 (命中会更新 LRU 顺序)
   * @returns 命中且未过期返回 value, 否则返回 undefined
   */
  get(key: string): V | undefined {
    const node = this.store.get(key);
    if (!node) return undefined;
    if (node.expiresAt !== null && Date.now() > node.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    // 标记为最近使用: 删除再插入, 保持 Map 顺序
    this.store.delete(key);
    this.store.set(key, node);
    return node.value;
  }

  /**
   * 写入缓存项
   * - 容量已满时, 淘汰最久未使用的项
   */
  set(key: string, value: V): void {
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.capacity) {
      // Map 迭代顺序 = 插入顺序, 第一个 key 即最久未使用
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) {
        this.store.delete(oldest);
      }
    }
    const expiresAt = this.ttlMs !== null ? Date.now() + this.ttlMs : null;
    this.store.set(key, { key, value, expiresAt });
  }

  /** 当前条目数 */
  get size(): number {
    return this.store.size;
  }

  /** 清空全部缓存 */
  clear(): void {
    this.store.clear();
  }

  /** 是否存在某个 key (不更新 LRU 顺序) */
  has(key: string): boolean {
    const node = this.store.get(key);
    if (!node) return false;
    if (node.expiresAt !== null && Date.now() > node.expiresAt) {
      this.store.delete(key);
      return false;
    }
    return true;
  }
}
