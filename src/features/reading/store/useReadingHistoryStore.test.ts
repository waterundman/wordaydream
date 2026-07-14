/**
 * useReadingHistoryStore.completeEntry 测试
 *
 * 覆盖 test_spec:
 * - T8 [unit, critical]: completeEntry 设置 entry.completedAt 为当前时间戳
 * - T9 [unit, critical]: completeEntry 幂等 — 重复调用不重复标记 / 不更新 completedAt
 *   (基于 entry.completedAt 检查)
 * - T10 [unit]: completeEntry 不存在的 id → no-op (不抛错)
 * - T10b [unit]: 已完成的 entry 再次调用 → no-op (不更新 completedAt)
 *
 * v2.2.4 Stage 2 (D2-1): 移除 'reading:completed' 事件后, 测试改为断言 completedAt
 * 行为 (原先通过 events.subscribe 捕获事件 payload 的断言已删除).
 *
 * 实现策略:
 * - 通过 useReadingHistoryStore.setState 直接 seed history
 * - 调用 completeEntry, 断言 getEntry().completedAt 行为
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useReadingHistoryStore, type HistoryEntry } from './useReadingHistoryStore';
import { clearAllListeners } from '../../../domain/events';
import type { Passage, Language } from '../../../types';

function makePassage(id: string, language: Language, difficulty: number): Passage {
  return {
    id,
    language,
    difficulty: difficulty as 1 | 2 | 3 | 4 | 5,
    text: 'mock text',
    tokens: [],
    lexemeGroups: [],
    grammarPoints: [],
  };
}

function makeEntry(partial: Partial<HistoryEntry> & Pick<HistoryEntry, 'id' | 'passage' | 'language' | 'difficulty'>): HistoryEntry {
  return {
    startedAt: Date.now() - 10_000,
    resolvedCount: 0,
    totalTokenCount: 5,
    ...partial,
  };
}

beforeEach(() => {
  useReadingHistoryStore.setState({ history: [], maxHistory: 50 });
  clearAllListeners();
});

afterEach(() => {
  clearAllListeners();
});

describe('useReadingHistoryStore.completeEntry', () => {
  describe('T8: completeEntry 标记 completedAt', () => {
    it('T8b: 完成后 entry.completedAt 被设置为时间戳', () => {
      const before = Date.now();
      const passage = makePassage('p-2', 'de', 3);
      const entry = makeEntry({
        id: 'h-2',
        passage,
        language: 'de',
        difficulty: 3,
      });
      useReadingHistoryStore.setState({ history: [entry], maxHistory: 50 });

      useReadingHistoryStore.getState().completeEntry('h-2');
      const after = Date.now();

      const updated = useReadingHistoryStore.getState().getEntry('h-2');
      expect(updated).toBeDefined();
      expect(updated!.completedAt).toBeDefined();
      expect(updated!.completedAt!).toBeGreaterThanOrEqual(before);
      expect(updated!.completedAt!).toBeLessThanOrEqual(after);
    });
  });

  describe('T9: completeEntry 幂等性', () => {
    it('T9a: 重复调用同一 entry 只标记一次 (completedAt 不变)', () => {
      const passage = makePassage('p-3', 'en', 1);
      const entry = makeEntry({
        id: 'h-3',
        passage,
        language: 'en',
        difficulty: 1,
      });
      useReadingHistoryStore.setState({ history: [entry], maxHistory: 50 });

      useReadingHistoryStore.getState().completeEntry('h-3');
      const firstCompletedAt = useReadingHistoryStore.getState().getEntry('h-3')!.completedAt;
      expect(firstCompletedAt).toBeDefined();

      useReadingHistoryStore.getState().completeEntry('h-3');
      useReadingHistoryStore.getState().completeEntry('h-3');

      const finalCompletedAt = useReadingHistoryStore.getState().getEntry('h-3')!.completedAt;
      expect(finalCompletedAt).toBe(firstCompletedAt);
    });
  });

  describe('T10: completeEntry 边界场景', () => {
    it('T10a: 不存在的 id → no-op (不抛错, 不修改任何 entry)', () => {
      const passage = makePassage('p-other', 'en', 2);
      const entry = makeEntry({
        id: 'h-existing',
        passage,
        language: 'en',
        difficulty: 2,
      });
      useReadingHistoryStore.setState({ history: [entry], maxHistory: 50 });

      expect(() => {
        useReadingHistoryStore.getState().completeEntry('non-existent-id');
      }).not.toThrow();

      // 已存在的 entry 不受影响, 仍未完成
      const untouched = useReadingHistoryStore.getState().getEntry('h-existing');
      expect(untouched!.completedAt).toBeUndefined();
    });

    it('T10b: 已完成的 entry 再次调用 → no-op (不更新 completedAt)', () => {
      const passage = makePassage('p-4', 'en', 2);
      const originalCompletedAt = Date.now() - 1000;
      const entry = makeEntry({
        id: 'h-4',
        passage,
        language: 'en',
        difficulty: 2,
        completedAt: originalCompletedAt,
      });
      useReadingHistoryStore.setState({ history: [entry], maxHistory: 50 });

      useReadingHistoryStore.getState().completeEntry('h-4');

      // completedAt 不变
      const updated = useReadingHistoryStore.getState().getEntry('h-4');
      expect(updated!.completedAt).toBe(originalCompletedAt);
    });
  });
});

/**
 * v2.1.0 hotfix: persist migrate v1→v2 测试
 *
 * 背景: v1.5.3 fix V3-P3-001 之前 ID 格式为 `history-${Date.now()}` (无 counter 后缀),
 * 同毫秒添加的多条 entry 会产生重复 ID, 触发 React duplicate key 警告.
 * v2.1.0 hotfix bump persist version 1→2, migrate 检测重复 ID 并添加 index 后缀.
 *
 * 覆盖:
 * - T23a [unit, critical]: migrate 检测重复 ID 并添加 -migrated-{index} 后缀使其唯一
 * - T23b [unit]: migrate 不修改唯一 ID
 * - T23c [unit]: migrate 处理空 history 数组
 */
describe('useReadingHistoryStore migrate v1→v2 (v2.1.0 hotfix)', () => {
  // 直接调用 persist 选项中的 migrate 函数, 避免 rehydrate 时机不确定性
  const getMigrate = () => useReadingHistoryStore.persist.getOptions().migrate as
    (persistedState: unknown, version: number) => unknown;

  it('T23a: migrate 检测重复 ID 并添加 -migrated-{index} 后缀', () => {
    const passage1 = makePassage('p-dup-1', 'en', 1);
    const passage2 = makePassage('p-dup-2', 'en', 2);
    const oldPersisted = {
      history: [
        makeEntry({ id: 'history-1783520220912', passage: passage1, language: 'en', difficulty: 1 }),
        makeEntry({ id: 'history-1783520220912', passage: passage2, language: 'en', difficulty: 2 }),
      ],
      maxHistory: 50,
    };
    const result = getMigrate()(oldPersisted, 1) as { history: HistoryEntry[] };
    expect(result.history).toHaveLength(2);
    expect(result.history[0].id).not.toBe(result.history[1].id);
    expect(result.history[0].id).toBe('history-1783520220912');
    expect(result.history[1].id).toBe('history-1783520220912-migrated-1');
  });

  it('T23b: migrate 不修改唯一 ID', () => {
    const passage = makePassage('p-unique', 'en', 1);
    const oldPersisted = {
      history: [
        makeEntry({ id: 'history-unique-1', passage, language: 'en', difficulty: 1 }),
      ],
      maxHistory: 50,
    };
    const result = getMigrate()(oldPersisted, 1) as { history: HistoryEntry[] };
    expect(result.history).toHaveLength(1);
    expect(result.history[0].id).toBe('history-unique-1');
  });

  it('T23c: migrate 处理空 history 数组', () => {
    const oldPersisted = { history: [], maxHistory: 50 };
    const result = getMigrate()(oldPersisted, 1) as { history: HistoryEntry[] };
    expect(result.history).toHaveLength(0);
  });
});
