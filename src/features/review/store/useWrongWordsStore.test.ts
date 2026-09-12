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
import {
  sortEntriesBy,
  filterEntriesBy,
  type WrongWordEntry,
} from './useWrongWordsStore';

function makeEntry(
  cardId: string,
  lemma: string,
  language: 'en' | 'de' | undefined,
  lastWrongAt: number,
  wrongCount = 1,
): WrongWordEntry {
  return {
    cardId,
    lexemeGroupId: cardId,
    lemma,
    language,
    wrongCount,
    lastWrongAt,
    firstWrongAt: lastWrongAt - 1000,
  };
}

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

describe('useWrongWordsStore (v1.1.0 Stage 1: 错词本派生函数)', () => {
  describe('S-T01 [critical]: sortEntriesBy 三模式 + 同分稳定性 + 不改原数组', () => {
    it('S-T01a: recent=lastWrongAt 倒序 / oldest=firstWrongAt 升序 / mostWrong=wrongCount 倒序', () => {
      const entries: WrongWordEntry[] = [
        makeEntry('a', 'apple', 'en', 3000, 1), // firstWrongAt 2000
        makeEntry('b', 'banana', 'de', 1000, 3), // firstWrongAt 0
        makeEntry('c', 'cherry', 'en', 2000, 2), // firstWrongAt 1000
      ];

      // recent: lastWrongAt 倒序 → a(3000), c(2000), b(1000)
      expect(sortEntriesBy({ entries }, 'recent').map((e) => e.cardId))
        .toEqual(['a', 'c', 'b']);
      // oldest: firstWrongAt 升序 → b(0), c(1000), a(2000)
      expect(sortEntriesBy({ entries }, 'oldest').map((e) => e.cardId))
        .toEqual(['b', 'c', 'a']);
      // mostWrong: wrongCount 倒序 → b(3), c(2), a(1)
      expect(sortEntriesBy({ entries }, 'mostWrong').map((e) => e.cardId))
        .toEqual(['b', 'c', 'a']);
    });

    it('S-T01b: mostWrong 同分按 lastWrongAt 倒序 (稳定)', () => {
      const entries: WrongWordEntry[] = [
        makeEntry('t1', 'w1', 'en', 100, 2),
        makeEntry('t2', 'w2', 'de', 300, 2),
        makeEntry('t3', 'w3', 'en', 200, 2),
      ];

      expect(sortEntriesBy({ entries }, 'mostWrong').map((e) => e.cardId))
        .toEqual(['t2', 't3', 't1']);
    });

    it('S-T01c: 返回副本, 不修改原数组', () => {
      const entries: WrongWordEntry[] = [
        makeEntry('a', 'apple', 'en', 3000, 1),
        makeEntry('b', 'banana', 'de', 1000, 3),
      ];
      const before = entries.map((e) => e.cardId);

      const sorted = sortEntriesBy({ entries }, 'mostWrong');

      expect(sorted).not.toBe(entries);
      expect(entries.map((e) => e.cardId)).toEqual(before); // 原数组次序不变
    });
  });

  describe('S-T02 [critical]: filterEntriesBy language/timeRange 过滤', () => {
    const NOW = 1_000_000_000;
    const DAY = 86_400_000;

    function presetEntries(): WrongWordEntry[] {
      return [
        makeEntry('en-1d', 'recent-en', 'en', NOW - 1 * DAY),
        makeEntry('de-20d', 'mid-de', 'de', NOW - 20 * DAY),
        makeEntry('nolang-3d', 'legacy', undefined, NOW - 3 * DAY), // language undefined
        makeEntry('en-edge7', 'edge7', 'en', NOW - 7 * DAY), // 恰好 7d 边界 (严格小于 → 不在 7d 内)
        makeEntry('en-edge30', 'edge30', 'en', NOW - 30 * DAY), // 恰好 30d 边界 (>= 30d → 归 older)
        makeEntry('de-40d', 'old-de', 'de', NOW - 40 * DAY),
      ];
    }

    it('S-T02a: language 过滤 — undefined 条目只在 all 出现, 不出现在 en/de 筛选', () => {
      const state = { entries: presetEntries() };

      // all (含未传): 不过滤
      expect(filterEntriesBy(state, { language: 'all', now: NOW })).toHaveLength(6);
      expect(filterEntriesBy(state, { now: NOW })).toHaveLength(6);

      // en: undefined 条目被排除
      expect(filterEntriesBy(state, { language: 'en', now: NOW }).map((e) => e.cardId))
        .toEqual(['en-1d', 'en-edge7', 'en-edge30']);

      // de: undefined 条目被排除
      expect(filterEntriesBy(state, { language: 'de', now: NOW }).map((e) => e.cardId))
        .toEqual(['de-20d', 'de-40d']);
    });

    it('S-T02b: timeRange 边界 — 严格小于 7d/30d, older 为 >= 30d', () => {
      const state = { entries: presetEntries() };

      // 7d: age < 7d → 边界条目 (恰好 7d) 不在内
      expect(filterEntriesBy(state, { timeRange: '7d', now: NOW }).map((e) => e.cardId))
        .toEqual(['en-1d', 'nolang-3d']);

      // 30d: age < 30d → 边界条目 (恰好 30d) 不在内; 7d 边界条目 (age=7d) 在内
      expect(filterEntriesBy(state, { timeRange: '30d', now: NOW }).map((e) => e.cardId))
        .toEqual(['en-1d', 'de-20d', 'nolang-3d', 'en-edge7']);

      // older: age >= 30d → 两个边界/更旧条目
      expect(filterEntriesBy(state, { timeRange: 'older', now: NOW }).map((e) => e.cardId))
        .toEqual(['en-edge30', 'de-40d']);
    });

    it('S-T02c: language + timeRange 组合过滤', () => {
      const state = { entries: presetEntries() };

      expect(
        filterEntriesBy(state, { language: 'en', timeRange: 'older', now: NOW })
          .map((e) => e.cardId)
      ).toEqual(['en-edge30']);
    });

    it('S-T02d: 不改原数组', () => {
      const entries = presetEntries();
      const before = entries.map((e) => e.cardId);

      const filtered = filterEntriesBy({ entries }, { language: 'en', now: NOW });

      expect(filtered).not.toBe(entries);
      expect(entries.map((e) => e.cardId)).toEqual(before);
    });
  });
});
