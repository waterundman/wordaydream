/**
 * useWrongWordsStore 测试 (v0.9.0 Stage 1)
 *
 * 覆盖 test_spec:
 * - T01 [critical]: recordWrong 新卡入账; 同卡再错 wrongCount=2, lastWrongAt 更新,
 *   firstWrongAt 不变, 无重复条目
 * - T02 [critical]: 预置 501 条 → 总数 500 且 lastWrongAt 最小(最旧)被淘汰
 * - T06 [critical]: persist — key 存在 + 重新创建 store 实例后数据可用 (rehydrate)
 *
 * 实现策略: 跟随 useMemoryStore.test.ts 的 persist 测法 —
 * 用 vi.resetModules() + 动态 import 模拟"刷新后 store 重建".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoryCard } from '../../../types';

function makeCard(
  id: string,
  lemma: string,
  language: 'en' | 'de',
  lexemeGroupId = id,
): MemoryCard {
  return {
    id,
    lexemeGroupId,
    lemma,
    objectiveDifficulty: 2,
    language,
    firstLearnedAt: 0,
    lastReviewAt: 0,
    due: 0,
    stability: 1,
    difficulty: 1,
    elapsedDays: 0,
    scheduledDays: 1,
    reps: 0,
    lapses: 0,
    status: 'review',
    learningSteps: 0,
  };
}

beforeEach(() => {
  if (typeof window !== 'undefined') {
    window.localStorage.clear();
  }
  vi.resetModules();
});

afterEach(() => {
  if (typeof window !== 'undefined') {
    window.localStorage.clear();
  }
  vi.resetModules();
});

describe('useWrongWordsStore (Stage 1)', () => {
  describe('T01 [critical]: recordWrong upsert 语义', () => {
    it('T01: 新卡入账; 同卡再错 wrongCount=2, lastWrongAt 更新, firstWrongAt 不变, 无重复', async () => {
      const { useWrongWordsStore } = await import('./useWrongWordsStore');

      const card = makeCard('lg-apple', 'apple', 'en');
      const firstAt = 1000;
      const secondAt = 5000;

      useWrongWordsStore.getState().recordWrong(card, firstAt);
      useWrongWordsStore.getState().recordWrong(card, secondAt);

      const entries = useWrongWordsStore.getState().entries;
      expect(entries).toHaveLength(1);

      const e = entries[0];
      expect(e.cardId).toBe('lg-apple');
      expect(e.lexemeGroupId).toBe('lg-apple');
      expect(e.lemma).toBe('apple');
      expect(e.language).toBe('en');
      expect(e.wrongCount).toBe(2);
      expect(e.firstWrongAt).toBe(firstAt); // 首次答错时间不变
      expect(e.lastWrongAt).toBe(secondAt); // 最近答错时间更新
    });
  });

  describe('T02 [critical]: 容量上限 500 + FIFO 淘汰', () => {
    it('T02: 预置 501 条 → 总数 500 且 lastWrongAt 最小(最旧)被淘汰', async () => {
      const { useWrongWordsStore, MAX_WRONG_WORDS } = await import('./useWrongWordsStore');
      expect(MAX_WRONG_WORDS).toBe(500);

      // 第 1 条最旧 (lastWrongAt=1), 后续依次递增; 第 501 条最新 (lastWrongAt=501)
      for (let i = 0; i < 501; i++) {
        const card = makeCard(`lg-${i}`, `word${i}`, i % 2 === 0 ? 'en' : 'de');
        useWrongWordsStore.getState().recordWrong(card, i + 1);
      }

      const entries = useWrongWordsStore.getState().entries;
      expect(entries).toHaveLength(500);

      // 最旧的一条 (lg-0, lastWrongAt=1) 应被淘汰
      expect(entries.find((e) => e.cardId === 'lg-0')).toBeUndefined();
      // 最新一条 (lg-500) 应保留
      expect(entries.find((e) => e.cardId === 'lg-500')).toBeDefined();
      // 中间一条仍保留
      expect(entries.find((e) => e.cardId === 'lg-250')).toBeDefined();
    });
  });

  describe('T06 [critical]: persist 往返', () => {
    it('T06: localStorage key 存在 + 重建实例后数据可用', async () => {
      const { useWrongWordsStore } = await import('./useWrongWordsStore');

      useWrongWordsStore.getState().recordWrong(makeCard('lg-apple', 'apple', 'en'), 1000);
      useWrongWordsStore.getState().recordWrong(makeCard('lg-banana', 'banana', 'de'), 2000);

      // 等待 persist 异步落盘
      await new Promise((r) => setTimeout(r, 50));

      // 1) key 存在
      const raw = window.localStorage.getItem('wordaydream:wrong-words');
      expect(raw).not.toBeNull();

      // 2) 模拟刷新: resetModules + 重新 import → onRehydrateStorage 从 localStorage 重建
      vi.resetModules();
      const reloaded = await import('./useWrongWordsStore');
      const fresh = reloaded.useWrongWordsStore;

      const entries = fresh.getState().entries;
      expect(entries).toHaveLength(2);
      expect(entries.map((e) => e.lemma).sort()).toEqual(['apple', 'banana']);
    });
  });
});
