/**
 * useWrongWordsStore importEntries / removeEntry 测试 (v1.4.0 S1)
 *
 * 覆盖 SPEC v1.4.0 合同 C1.6-C1.7 (store action 层):
 * - importEntries: 新条目入库 + summary 计数; cardId 冲突 skip 保留现有;
 *   空数组 noop (幂等)
 * - removeEntry: 按 cardId 移除; 不存在 cardId 无副作用
 *
 * 实现策略: 跟随 WrongWordsSection.test.tsx 先例 — useWrongWordsStore.setState
 * 直接预置 entries, 调 action 后断言 getState().entries.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  useWrongWordsStore,
  type WrongWordEntry,
} from './useWrongWordsStore';

const T0 = 1_726_000_000_000;

function makeEntry(cardId: string, overrides: Partial<WrongWordEntry> = {}): WrongWordEntry {
  return {
    cardId,
    lexemeGroupId: `lg-${cardId}`,
    lemma: `lemma-${cardId}`,
    language: 'en',
    wrongCount: 1,
    firstWrongAt: T0,
    lastWrongAt: T0 + 1000,
    ...overrides,
  };
}

describe('useWrongWordsStore.importEntries', () => {
  beforeEach(() => {
    useWrongWordsStore.setState({ entries: [] });
  });

  afterEach(() => {
    useWrongWordsStore.setState({ entries: [] });
  });

  it('T01 [C1.6] 新条目入库, summary { imported: N, skipped: 0, evicted: 0 }', () => {
    const incoming = [makeEntry('c1'), makeEntry('c2')];
    const summary = useWrongWordsStore.getState().importEntries(incoming);
    expect(summary).toEqual({ imported: 2, skipped: 0, evicted: 0 });
    const { entries } = useWrongWordsStore.getState();
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.cardId)).toEqual(['c1', 'c2']);
  });

  it('T02 [C1.6] cardId 冲突 → skip 保留现有 (既有 wrongCount 不变)', () => {
    useWrongWordsStore.setState({ entries: [makeEntry('c1', { wrongCount: 5 })] });
    const summary = useWrongWordsStore.getState().importEntries([
      makeEntry('c1', { wrongCount: 99 }),
      makeEntry('c2'),
    ]);
    expect(summary).toEqual({ imported: 1, skipped: 1, evicted: 0 });
    const { entries } = useWrongWordsStore.getState();
    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.cardId === 'c1')?.wrongCount).toBe(5);
  });

  it('T03 重复导入同一备份 → 全 skip (幂等, imported=0)', () => {
    const backup = [makeEntry('c1'), makeEntry('c2')];
    useWrongWordsStore.getState().importEntries(backup);
    const summary = useWrongWordsStore.getState().importEntries(backup);
    expect(summary).toEqual({ imported: 0, skipped: 2, evicted: 0 });
    expect(useWrongWordsStore.getState().entries).toHaveLength(2);
  });

  it('T04 空数组 → imported=0, entries 不变', () => {
    useWrongWordsStore.setState({ entries: [makeEntry('c1')] });
    const summary = useWrongWordsStore.getState().importEntries([]);
    expect(summary).toEqual({ imported: 0, skipped: 0, evicted: 0 });
    expect(useWrongWordsStore.getState().entries).toHaveLength(1);
  });
});

describe('useWrongWordsStore.removeEntry', () => {
  beforeEach(() => {
    useWrongWordsStore.setState({
      entries: [makeEntry('c1'), makeEntry('c2'), makeEntry('c3')],
    });
  });

  afterEach(() => {
    useWrongWordsStore.setState({ entries: [] });
  });

  it('T05 [C1.7] 按 cardId 移除单条', () => {
    useWrongWordsStore.getState().removeEntry('c2');
    const { entries } = useWrongWordsStore.getState();
    expect(entries.map((e) => e.cardId)).toEqual(['c1', 'c3']);
  });

  it('T06 [C1.7] 不存在 cardId → 无副作用', () => {
    const before = useWrongWordsStore.getState().entries;
    useWrongWordsStore.getState().removeEntry('no-such-id');
    expect(useWrongWordsStore.getState().entries).toEqual(before);
  });
});
