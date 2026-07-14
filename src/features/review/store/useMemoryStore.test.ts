/**
 * useMemoryStore 持久化往返测试 (T01 + T02)
 *
 * 覆盖 test_spec:
 * - T01 [integration, critical]: cards Map 序列化往返 size 一致
 *   验证: cards 填入 N 个 card → save → 清空 store → rehydrate → cards.size === N
 * - T02 [integration, critical]: cards 序列化往返 card.id/status 完全一致
 *   验证: 逐个 card 断言 id/status/level/due/reps/lapses 与原值 deep-equal
 *
 * 实现策略:
 * - 通过 `setState` 写入测试卡片, 等待 persist 异步落盘 (localStorage)
 * - 用 `vi.resetModules()` + 动态 `import` 模拟"页面刷新后 store 重建",
 *   重建过程会触发 onRehydrateStorage, Map 从 plain object 复原
 * - 对比新 store 中每张卡的 id/status/reps/lapses/due/objectiveDifficulty
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoryCard } from '../../../types';

function makeCard(
  partial: Partial<MemoryCard> &
    Pick<MemoryCard, 'lexemeGroupId' | 'lemma' | 'objectiveDifficulty'>,
): MemoryCard {
  return {
    id: partial.id ?? `card-${partial.lexemeGroupId}`,
    lexemeGroupId: partial.lexemeGroupId,
    lemma: partial.lemma,
    objectiveDifficulty: partial.objectiveDifficulty,
    firstLearnedAt: partial.firstLearnedAt ?? 1_700_000_000_000,
    lastReviewAt: partial.lastReviewAt ?? partial.firstLearnedAt ?? 1_700_000_000_000,
    learningSteps: partial.learningSteps ?? 0,
    due: partial.due ?? 0,
    stability: partial.stability ?? 0,
    difficulty: partial.difficulty ?? 0,
    elapsedDays: partial.elapsedDays ?? 0,
    scheduledDays: partial.scheduledDays ?? 0,
    reps: partial.reps ?? 0,
    lapses: partial.lapses ?? 0,
    status: partial.status ?? 'new',
  };
}

beforeEach(() => {
  // 每个测试前清理 localStorage + 模块缓存, 保证 store 重建
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

describe('useMemoryStore persist round-trip (T01+T02)', () => {
  it('T01: cards Map 序列化往返 size 一致', async () => {
    // 1. 在新 store 实例上写入 5 张 card
    const { useMemoryStore } = await import('./useMemoryStore');
    const map = new Map<string, MemoryCard>();
    for (let i = 0; i < 5; i++) {
      map.set(
        `g${i}`,
        makeCard({
          lexemeGroupId: `g${i}`,
          lemma: `word${i}`,
          objectiveDifficulty: 1,
        }),
      );
    }
    useMemoryStore.setState({ cards: map });

    // 2. 等待 persist 异步写 localStorage (createJSONStorage 是同步写但让 microtask 跑完)
    await new Promise((r) => setTimeout(r, 50));

    // 3. 模拟刷新: resetModules + 重新 import
    vi.resetModules();
    const reloaded = await import('./useMemoryStore');
    const fresh = reloaded.useMemoryStore;

    // 4. 断言 size === 5
    expect(fresh.getState().cards.size).toBe(5);
  });

  it('T02: cards 序列化往返 card.id/status/reps/lapses/due/objectiveDifficulty 完全一致', async () => {
    // 1. 在新 store 实例上写入 3 张不同状态的 card
    const { useMemoryStore } = await import('./useMemoryStore');
    const map = new Map<string, MemoryCard>();
    map.set(
      'g1',
      makeCard({
        id: 'card-g1',
        lexemeGroupId: 'g1',
        lemma: 'apple',
        objectiveDifficulty: 2,
        status: 'review',
        reps: 3,
        lapses: 1,
        due: 1_700_000_000_001,
        stability: 5.5,
        difficulty: 6.0,
      }),
    );
    map.set(
      'g2',
      makeCard({
        id: 'card-g2',
        lexemeGroupId: 'g2',
        lemma: 'bahnhof',
        objectiveDifficulty: 5,
        status: 'learning',
        reps: 1,
        lapses: 0,
        due: 1_700_000_000_002,
        stability: 1.2,
        difficulty: 9.0,
      }),
    );
    map.set(
      'g3',
      makeCard({
        id: 'card-g3',
        lexemeGroupId: 'g3',
        lemma: 'paris',
        objectiveDifficulty: 1,
        status: 'relearning',
        reps: 4,
        lapses: 2,
        due: 1_700_000_000_003,
        stability: 0.8,
        difficulty: 4.0,
      }),
    );

    useMemoryStore.setState({ cards: map });
    await new Promise((r) => setTimeout(r, 50));

    // 2. 模拟刷新
    vi.resetModules();
    const { useMemoryStore: fresh } = await import('./useMemoryStore');

    // 3. 逐个 card 断言关键字段
    const rehydrated = fresh.getState().cards;
    expect(rehydrated.size).toBe(3);

    for (const [id, original] of map.entries()) {
      const got = rehydrated.get(id);
      expect(got, `card ${id} 存在`).toBeDefined();
      expect(got!.id).toBe(original.id);
      expect(got!.status).toBe(original.status);
      expect(got!.reps).toBe(original.reps);
      expect(got!.lapses).toBe(original.lapses);
      expect(got!.due).toBe(original.due);
      expect(got!.lexemeGroupId).toBe(original.lexemeGroupId);
      expect(got!.lemma).toBe(original.lemma);
      expect(got!.objectiveDifficulty).toBe(original.objectiveDifficulty);
    }
  });
});

/**
 * v2.2.2 Stage 2 (Bug 7): getDueCards states 参数过滤
 *
 * 覆盖 test_spec:
 * - T11 [critical]: getDueCards states 参数过滤 — 传 states 只返回指定状态的 due 卡,
 *   不传 states 返回全部 due 卡 (向后兼容).
 */
describe('v2.2.2 Stage 2 (Bug 7): getDueCards states 参数过滤 (T11)', () => {
  it('T11: getDueCards states 参数过滤 — 只返回指定状态的 due 卡', async () => {
    const { useMemoryStore } = await import('./useMemoryStore');
    const map = new Map<string, MemoryCard>();
    // 4 张卡, 全部 due=0 (过期), 不同状态
    map.set('g-new', makeCard({
      lexemeGroupId: 'g-new', lemma: 'a', objectiveDifficulty: 1, status: 'new', due: 0,
    }));
    map.set('g-learn', makeCard({
      lexemeGroupId: 'g-learn', lemma: 'b', objectiveDifficulty: 1, status: 'learning', due: 0,
    }));
    map.set('g-rev', makeCard({
      lexemeGroupId: 'g-rev', lemma: 'c', objectiveDifficulty: 1, status: 'review', due: 0,
    }));
    map.set('g-relearn', makeCard({
      lexemeGroupId: 'g-relearn', lemma: 'd', objectiveDifficulty: 1, status: 'relearning', due: 0,
    }));
    useMemoryStore.setState({ cards: map });

    // 不传 states: 返回全部 4 张 due 卡 (向后兼容)
    const all = useMemoryStore.getState().getDueCards();
    expect(all).toHaveLength(4);

    // 传 states=['review','relearning']: 只返回 2 张
    const filtered = useMemoryStore
      .getState()
      .getDueCards(undefined, undefined, ['review', 'relearning']);
    expect(filtered).toHaveLength(2);
    expect(filtered.every((c) => c.status === 'review' || c.status === 'relearning')).toBe(true);
    expect(filtered.some((c) => c.status === 'new')).toBe(false);
    expect(filtered.some((c) => c.status === 'learning')).toBe(false);

    // 传 states=['new']: 只返回 1 张 new 卡
    const newOnly = useMemoryStore.getState().getDueCards(undefined, undefined, ['new']);
    expect(newOnly).toHaveLength(1);
    expect(newOnly[0].status).toBe('new');
  });
});
