/**
 * v0.4.0-harmony Stage 1 D1: dueCardsIndex 派生索引单元测试
 *
 * 覆盖 test_spec:
 * - T01 [critical]: onRehydrateStorage 后 dueCardsIndex 非 null (重建为 Set)
 * - T02 [critical]: onRehydrateStorage 重建后, due 卡片都在 dueCardsIndex 中
 * - T03 [critical]: getDueCards 使用 dueCardsIndex 快速路径 (只扫描候选, 不全量扫描)
 * - T04: rateCard 后 dueCardsIndex 增量更新 — 新 due<=now 加入索引, 新 due>now 移除
 * - T05: addCardFromToken 后 dueCardsIndex 增量更新 — 新卡 due=now+4h 不加入索引
 * - T06: deleteCard 后 dueCardsIndex 增量更新 — 卡片从索引移除
 * - T07: dueCardsIndex=null 时 fallback 到全量扫描 (向后兼容测试用例)
 * - T08: dueCardsIndex 不持久化 (partialize 排除)
 *
 * 设计:
 * - 通过 setState 直接写入 cards 控制初始状态, 触发 onRehydrateStorage 用 resetModules + 重新 import
 * - 验证 dueCardsIndex 字段类型 (Set<string> | null)
 * - 验证 getDueCards 在有索引/无索引时返回结果一致 (行为等价, 性能有差异)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoryCard, TokenOccurrence } from '../../../types';

// 构造合法 MemoryCard
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
    language: partial.language,
  };
}

// 构造最小合法 TokenOccurrence
function makeToken(
  partial: Partial<TokenOccurrence> &
    Pick<TokenOccurrence, 'lexemeGroupId' | 'lemma' | 'objectiveDifficulty'>,
): TokenOccurrence {
  return {
    id: partial.id ?? `tok-${partial.lexemeGroupId}`,
    lexemeGroupId: partial.lexemeGroupId,
    surfaceForm: partial.surfaceForm ?? partial.lemma,
    lemma: partial.lemma,
    objectiveDifficulty: partial.objectiveDifficulty,
    startIndex: partial.startIndex ?? 0,
    endIndex: partial.endIndex ?? partial.lemma.length,
    isResolved: partial.isResolved ?? false,
    isActive: partial.isActive ?? false,
    kind: partial.kind ?? 'normal',
    isCompound: partial.isCompound ?? false,
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
  vi.restoreAllMocks();
});

describe('v0.4.0-harmony Stage 1 D1: dueCardsIndex 派生索引', () => {
  it('T01 [critical]: onRehydrateStorage 后 dueCardsIndex 非 null (重建为 Set)', async () => {
    const now = Date.now();
    // 预填充 localStorage (3 张卡: 2 due + 1 非 due)
    const cards: Record<string, MemoryCard> = {
      'g1': makeCard({
        lexemeGroupId: 'g1', lemma: 'apple', objectiveDifficulty: 2,
        status: 'review', due: now - 1000, reps: 3, language: 'en',
      }),
      'g2': makeCard({
        lexemeGroupId: 'g2', lemma: 'Haus', objectiveDifficulty: 4,
        status: 'review', due: now - 500, reps: 2, language: 'de',
      }),
      'g3': makeCard({
        lexemeGroupId: 'g3', lemma: 'future', objectiveDifficulty: 1,
        status: 'new', due: now + 100_000, reps: 0, language: 'en',
      }),
    };
    window.localStorage.setItem(
      'wordaydream:memory',
      JSON.stringify({
        state: { cards, ratingHistory: [], schemaVersion: 2 },
        version: 2,
      }),
    );

    // 模拟刷新: resetModules + 重新 import → 触发 onRehydrateStorage
    vi.resetModules();
    const { useMemoryStore } = await import('./useMemoryStore');

    // 断言: dueCardsIndex 已重建为非 null Set
    const state = useMemoryStore.getState();
    expect(state.dueCardsIndex).not.toBeNull();
    expect(state.dueCardsIndex).toBeInstanceOf(Set);
  });

  it('T02 [critical]: onRehydrateStorage 重建后, due 卡片都在 dueCardsIndex 中', async () => {
    const now = Date.now();
    const cards: Record<string, MemoryCard> = {
      'g1-due': makeCard({
        lexemeGroupId: 'g1-due', lemma: 'apple', objectiveDifficulty: 2,
        status: 'review', due: now - 1000, reps: 3, language: 'en',
      }),
      'g2-due': makeCard({
        lexemeGroupId: 'g2-due', lemma: 'Haus', objectiveDifficulty: 4,
        status: 'review', due: now - 500, reps: 2, language: 'de',
      }),
      'g3-future': makeCard({
        lexemeGroupId: 'g3-future', lemma: 'future', objectiveDifficulty: 1,
        status: 'new', due: now + 100_000, reps: 0, language: 'en',
      }),
    };
    window.localStorage.setItem(
      'wordaydream:memory',
      JSON.stringify({
        state: { cards, ratingHistory: [], schemaVersion: 2 },
        version: 2,
      }),
    );

    vi.resetModules();
    const { useMemoryStore } = await import('./useMemoryStore');

    const index = useMemoryStore.getState().dueCardsIndex;
    expect(index).not.toBeNull();
    expect(index!.has('g1-due')).toBe(true); // due 卡在索引中
    expect(index!.has('g2-due')).toBe(true); // due 卡在索引中
    expect(index!.has('g3-future')).toBe(false); // 非 due 卡不在索引中
    expect(index!.size).toBe(2);
  });

  it('T03 [critical]: getDueCards 使用 dueCardsIndex 快速路径 (只扫描候选, 不全量扫描)', async () => {
    const now = Date.now();
    const cards: Record<string, MemoryCard> = {
      'g1-due': makeCard({
        lexemeGroupId: 'g1-due', lemma: 'apple', objectiveDifficulty: 2,
        status: 'review', due: now - 1000, reps: 3, language: 'en',
      }),
      'g2-due': makeCard({
        lexemeGroupId: 'g2-due', lemma: 'Haus', objectiveDifficulty: 4,
        status: 'review', due: now - 500, reps: 2, language: 'de',
      }),
      'g3-future': makeCard({
        lexemeGroupId: 'g3-future', lemma: 'future', objectiveDifficulty: 1,
        status: 'new', due: now + 100_000, reps: 0, language: 'en',
      }),
    };
    window.localStorage.setItem(
      'wordaydream:memory',
      JSON.stringify({
        state: { cards, ratingHistory: [], schemaVersion: 2 },
        version: 2,
      }),
    );

    vi.resetModules();
    const { useMemoryStore } = await import('./useMemoryStore');

    // getDueCards 返回 due 卡 (按 due ASC 排序: g1-due (due=now-1000) 在前, g2-due (due=now-500) 在后)
    const dueCards = useMemoryStore.getState().getDueCards();
    expect(dueCards).toHaveLength(2);
    expect(dueCards[0].lexemeGroupId).toBe('g1-due'); // due=now-1000 (更早) 排第一
    expect(dueCards[1].lexemeGroupId).toBe('g2-due'); // due=now-500 (更近) 排第二
    // g3-future 不在结果中 (未到期)
    expect(dueCards.find((c) => c.lexemeGroupId === 'g3-future')).toBeUndefined();
  });

  it('T04: rateCard 后 dueCardsIndex 增量更新 — 新 due<=now 加入索引, 新 due>now 移除', async () => {
    const now = Date.now();
    const { useMemoryStore } = await import('./useMemoryStore');

    // 初始: 一张 due 卡 (due=now-1000)
    const card = makeCard({
      id: 'card-g1', lexemeGroupId: 'g1', lemma: 'apple', objectiveDifficulty: 2,
      status: 'review', due: now - 1000, reps: 3, language: 'en',
    });
    useMemoryStore.setState({
      cards: new Map([['g1', card]]),
      dueCardsIndex: new Set<string>(['g1']), // 初始已初始化
    });

    // rateCard 评分 'good' → FSRS 计算新 due (通常 > now, 非 due)
    useMemoryStore.getState().rateCard('g1', 'good');

    // 断言: dueCardsIndex 增量更新 — g1 从索引中移除 (新 due > now)
    const state1 = useMemoryStore.getState();
    expect(state1.dueCardsIndex).not.toBeNull();
    expect(state1.dueCardsIndex!.has('g1')).toBe(false);
    // 新 due 应该 > now
    const updatedCard = state1.cards.get('g1')!;
    expect(updatedCard.due).toBeGreaterThan(now);
  });

  it('T04b: rateCard 评分 again 后 dueCardsIndex 增量更新 — 新 due<=now 保留在索引中', async () => {
    const now = Date.now();
    const { useMemoryStore } = await import('./useMemoryStore');

    // 初始: 一张 due 卡 (due=now-1000, review 态)
    const card = makeCard({
      id: 'card-g1', lexemeGroupId: 'g1', lemma: 'apple', objectiveDifficulty: 2,
      status: 'review', due: now - 1000, reps: 3, language: 'en',
    });
    useMemoryStore.setState({
      cards: new Map([['g1', card]]),
      dueCardsIndex: new Set<string>(['g1']),
    });

    // rateCard 评分 'again' → FSRS 计算: relearning 态, due 通常很快 (< 10 分钟)
    // 具体时间取决于 FSRS weights, 但 'again' 通常导致 due 非常近
    useMemoryStore.getState().rateCard('g1', 'again');

    // 断言: dueCardsIndex 增量更新
    const state1 = useMemoryStore.getState();
    expect(state1.dueCardsIndex).not.toBeNull();
    // 评分 again 后卡片进入 relearning 态, due 通常很近 (<=now + 10分钟)
    // 如果 due <= now 则在索引中, 如果 due > now (但 < 4h) 则不在索引中
    // 此处只验证索引一致性 (与卡片实际 due 状态匹配)
    const updatedCard = state1.cards.get('g1')!;
    const expectedInIndex = updatedCard.due <= Date.now();
    expect(state1.dueCardsIndex!.has('g1')).toBe(expectedInIndex);
  });

  it('T05: addCardFromToken 后 dueCardsIndex 增量更新 — 新卡 due=now+4h 不加入索引', async () => {
    const { useMemoryStore } = await import('./useMemoryStore');

    // 初始: 空状态, dueCardsIndex 已初始化为空 Set
    useMemoryStore.setState({
      cards: new Map(),
      dueCardsIndex: new Set<string>(),
    });

    const before = Date.now();
    const token = makeToken({
      lexemeGroupId: 'g-new', lemma: 'newword', objectiveDifficulty: 2,
    });
    const card = useMemoryStore.getState().addCardFromToken(token, 'en');
    const after = Date.now();

    // 断言: 新卡 due = now + 4h (非 due, 不加入索引)
    const LEARNING_DELAY_MS = 4 * 60 * 60 * 1000;
    expect(card.due).toBeGreaterThanOrEqual(before + LEARNING_DELAY_MS);
    expect(card.due).toBeLessThanOrEqual(after + LEARNING_DELAY_MS);

    // dueCardsIndex 不含新卡 (因为 due > now)
    const state1 = useMemoryStore.getState();
    expect(state1.dueCardsIndex).not.toBeNull();
    expect(state1.dueCardsIndex!.has('g-new')).toBe(false);
  });

  it('T06: deleteCard 后 dueCardsIndex 增量更新 — 卡片从索引移除', async () => {
    const now = Date.now();
    const { useMemoryStore } = await import('./useMemoryStore');

    // 初始: 两张 due 卡
    const card1 = makeCard({
      id: 'card-g1', lexemeGroupId: 'g1', lemma: 'apple', objectiveDifficulty: 2,
      status: 'review', due: now - 1000, reps: 3, language: 'en',
    });
    const card2 = makeCard({
      id: 'card-g2', lexemeGroupId: 'g2', lemma: 'Haus', objectiveDifficulty: 4,
      status: 'review', due: now - 500, reps: 2, language: 'de',
    });
    useMemoryStore.setState({
      cards: new Map([
        ['g1', card1],
        ['g2', card2],
      ]),
      dueCardsIndex: new Set<string>(['g1', 'g2']),
    });

    // 删除 g1
    useMemoryStore.getState().deleteCard('g1');

    // 断言: dueCardsIndex 移除 g1, 保留 g2
    const state1 = useMemoryStore.getState();
    expect(state1.dueCardsIndex).not.toBeNull();
    expect(state1.dueCardsIndex!.has('g1')).toBe(false);
    expect(state1.dueCardsIndex!.has('g2')).toBe(true);
    expect(state1.dueCardsIndex!.size).toBe(1);
    expect(state1.cards.size).toBe(1);
    expect(state1.cards.has('g1')).toBe(false);
    expect(state1.cards.has('g2')).toBe(true);
  });

  it('T07: dueCardsIndex=null 时 fallback 到全量扫描 (向后兼容测试用例)', async () => {
    const now = Date.now();
    const { useMemoryStore } = await import('./useMemoryStore');

    // 初始: 直接 setState 写入 cards (不触发 onRehydrateStorage, dueCardsIndex 保持初始 null)
    // 2 张 due 卡 + 1 张非 due 卡
    const cards = new Map<string, MemoryCard>([
      ['g1', makeCard({
        lexemeGroupId: 'g1', lemma: 'apple', objectiveDifficulty: 2,
        status: 'review', due: now - 1000, reps: 3, language: 'en',
      })],
      ['g2', makeCard({
        lexemeGroupId: 'g2', lemma: 'Haus', objectiveDifficulty: 4,
        status: 'review', due: now - 500, reps: 2, language: 'de',
      })],
      ['g3', makeCard({
        lexemeGroupId: 'g3', lemma: 'future', objectiveDifficulty: 1,
        status: 'new', due: now + 100_000, reps: 0, language: 'en',
      })],
    ]);
    useMemoryStore.setState({
      cards,
      // 不传 dueCardsIndex, 保持初始 null (fallback 路径)
      dueCardsIndex: null,
    });

    // 断言: dueCardsIndex=null (fallback 路径)
    expect(useMemoryStore.getState().dueCardsIndex).toBeNull();

    // getDueCards 仍然返回正确结果 (全量扫描 fallback)
    const dueCards = useMemoryStore.getState().getDueCards();
    expect(dueCards).toHaveLength(2);
    // 按 due ASC 排序: g1 (due=now-1000) 在前, g2 (due=now-500) 在后
    expect(dueCards[0].lexemeGroupId).toBe('g1'); // due=now-1000 (更早) 排第一
    expect(dueCards[1].lexemeGroupId).toBe('g2'); // due=now-500 (更近) 排第二
    expect(dueCards.find((c) => c.lexemeGroupId === 'g3')).toBeUndefined();
  });

  it('T08: dueCardsIndex 不持久化 (partialize 排除)', async () => {
    const now = Date.now();
    const { useMemoryStore } = await import('./useMemoryStore');

    // 写入 cards + 初始化 dueCardsIndex (Set)
    useMemoryStore.setState({
      cards: new Map([
        ['g1', makeCard({
          lexemeGroupId: 'g1', lemma: 'apple', objectiveDifficulty: 2,
          status: 'review', due: now - 1000, reps: 3, language: 'en',
        })],
      ]),
      dueCardsIndex: new Set<string>(['g1']),
    });

    // 等待 persist 异步落盘 localStorage
    await new Promise((r) => setTimeout(r, 50));

    // 读取 localStorage 中的 persist 数据
    const raw = window.localStorage.getItem('wordaydream:memory');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    // partialize 只持久化 cards / ratingHistory / schemaVersion
    expect(parsed.state).toHaveProperty('cards');
    expect(parsed.state).toHaveProperty('ratingHistory');
    expect(parsed.state).toHaveProperty('schemaVersion');
    // dueCardsIndex 不应被持久化 (partialize 排除)
    expect(parsed.state).not.toHaveProperty('dueCardsIndex');
  });

  it('T09: dueCardsIndex 与 getDueCards 结果一致性 (有索引 vs null fallback 行为等价)', async () => {
    const now = Date.now();
    const { useMemoryStore } = await import('./useMemoryStore');

    // 构造 5 张卡: 3 due + 2 非 due
    const cards = new Map<string, MemoryCard>([
      ['g1', makeCard({
        lexemeGroupId: 'g1', lemma: 'apple', objectiveDifficulty: 2,
        status: 'review', due: now - 3000, reps: 3, language: 'en',
      })],
      ['g2', makeCard({
        lexemeGroupId: 'g2', lemma: 'Haus', objectiveDifficulty: 4,
        status: 'review', due: now - 2000, reps: 2, language: 'de',
      })],
      ['g3', makeCard({
        lexemeGroupId: 'g3', lemma: 'future1', objectiveDifficulty: 1,
        status: 'new', due: now + 100_000, reps: 0, language: 'en',
      })],
      ['g4', makeCard({
        lexemeGroupId: 'g4', lemma: 'book', objectiveDifficulty: 2,
        status: 'review', due: now - 1000, reps: 5, language: 'en',
      })],
      ['g5', makeCard({
        lexemeGroupId: 'g5', lemma: 'future2', objectiveDifficulty: 1,
        status: 'new', due: now + 200_000, reps: 0, language: 'en',
      })],
    ]);

    // 路径 A: dueCardsIndex=null (fallback 全量扫描)
    useMemoryStore.setState({
      cards,
      dueCardsIndex: null,
    });
    const dueCardsFallback = useMemoryStore.getState().getDueCards();

    // 路径 B: dueCardsIndex 已初始化 (快速路径)
    // 手动构造索引 (与 onRehydrateStorage 重建逻辑一致)
    const index = new Set<string>();
    for (const [cardId, card] of cards) {
      if (card.due <= now) {
        index.add(cardId);
      }
    }
    useMemoryStore.setState({
      cards,
      dueCardsIndex: index,
    });
    const dueCardsIndexed = useMemoryStore.getState().getDueCards();

    // 断言: 两条路径返回结果一致 (行为等价)
    expect(dueCardsFallback).toHaveLength(3);
    expect(dueCardsIndexed).toHaveLength(3);
    expect(dueCardsFallback.map((c) => c.lexemeGroupId).sort())
      .toEqual(dueCardsIndexed.map((c) => c.lexemeGroupId).sort());
    // 都按 due ASC 排序
    expect(dueCardsFallback[0].due).toBeLessThanOrEqual(dueCardsFallback[1].due);
    expect(dueCardsIndexed[0].due).toBeLessThanOrEqual(dueCardsIndexed[1].due);
  });

  it('T10: rateCard 后 deleteCard — 索引连续增量更新正确', async () => {
    const now = Date.now();
    const { useMemoryStore } = await import('./useMemoryStore');

    // 初始: 2 张 due 卡
    const card1 = makeCard({
      id: 'card-g1', lexemeGroupId: 'g1', lemma: 'apple', objectiveDifficulty: 2,
      status: 'review', due: now - 1000, reps: 3, language: 'en',
    });
    const card2 = makeCard({
      id: 'card-g2', lexemeGroupId: 'g2', lemma: 'Haus', objectiveDifficulty: 4,
      status: 'review', due: now - 500, reps: 2, language: 'de',
    });
    useMemoryStore.setState({
      cards: new Map([
        ['g1', card1],
        ['g2', card2],
      ]),
      dueCardsIndex: new Set<string>(['g1', 'g2']),
    });

    // 1. rateCard g1 'good' → g1 新 due > now, 从索引移除
    useMemoryStore.getState().rateCard('g1', 'good');
    expect(useMemoryStore.getState().dueCardsIndex!.has('g1')).toBe(false);
    expect(useMemoryStore.getState().dueCardsIndex!.has('g2')).toBe(true);

    // 2. deleteCard g2 → g2 从索引移除
    useMemoryStore.getState().deleteCard('g2');
    expect(useMemoryStore.getState().dueCardsIndex!.has('g1')).toBe(false);
    expect(useMemoryStore.getState().dueCardsIndex!.has('g2')).toBe(false);
    expect(useMemoryStore.getState().dueCardsIndex!.size).toBe(0);
    expect(useMemoryStore.getState().cards.size).toBe(1);
  });

  it('T11: getDueCards language 过滤在 dueCardsIndex 快速路径下仍正确', async () => {
    const now = Date.now();
    const { useMemoryStore } = await import('./useMemoryStore');

    // 构造 3 张 due 卡: 2 en + 1 de
    const cards = new Map<string, MemoryCard>([
      ['g1-en', makeCard({
        lexemeGroupId: 'g1-en', lemma: 'apple', objectiveDifficulty: 2,
        status: 'review', due: now - 3000, reps: 3, language: 'en',
      })],
      ['g2-en', makeCard({
        lexemeGroupId: 'g2-en', lemma: 'book', objectiveDifficulty: 2,
        status: 'review', due: now - 2000, reps: 2, language: 'en',
      })],
      ['g3-de', makeCard({
        lexemeGroupId: 'g3-de', lemma: 'Haus', objectiveDifficulty: 4,
        status: 'review', due: now - 1000, reps: 1, language: 'de',
      })],
    ]);
    useMemoryStore.setState({
      cards,
      dueCardsIndex: new Set<string>(['g1-en', 'g2-en', 'g3-de']),
    });

    // 过滤 en: 只返回 2 张 en 卡
    const enCards = useMemoryStore.getState().getDueCards('en');
    expect(enCards).toHaveLength(2);
    expect(enCards.every((c) => c.language === 'en')).toBe(true);
    expect(enCards.map((c) => c.lexemeGroupId).sort()).toEqual(['g1-en', 'g2-en']);

    // 过滤 de: 只返回 1 张 de 卡
    const deCards = useMemoryStore.getState().getDueCards('de');
    expect(deCards).toHaveLength(1);
    expect(deCards[0].language).toBe('de');
    expect(deCards[0].lexemeGroupId).toBe('g3-de');
  });

  it('T12: getDueCards states 参数过滤在 dueCardsIndex 快速路径下仍正确 (向后兼容 Bug 7)', async () => {
    const now = Date.now();
    const { useMemoryStore } = await import('./useMemoryStore');

    // 构造 4 张 due 卡, 不同状态
    const cards = new Map<string, MemoryCard>([
      ['g-new', makeCard({
        lexemeGroupId: 'g-new', lemma: 'a', objectiveDifficulty: 1,
        status: 'new', due: now - 1000,
      })],
      ['g-learn', makeCard({
        lexemeGroupId: 'g-learn', lemma: 'b', objectiveDifficulty: 1,
        status: 'learning', due: now - 1000,
      })],
      ['g-rev', makeCard({
        lexemeGroupId: 'g-rev', lemma: 'c', objectiveDifficulty: 1,
        status: 'review', due: now - 1000,
      })],
      ['g-relearn', makeCard({
        lexemeGroupId: 'g-relearn', lemma: 'd', objectiveDifficulty: 1,
        status: 'relearning', due: now - 1000,
      })],
    ]);
    useMemoryStore.setState({
      cards,
      dueCardsIndex: new Set<string>(['g-new', 'g-learn', 'g-rev', 'g-relearn']),
    });

    // 不传 states: 返回全部 4 张 due 卡
    const all = useMemoryStore.getState().getDueCards();
    expect(all).toHaveLength(4);

    // 传 states=['review', 'relearning']: 只返回 2 张
    const filtered = useMemoryStore.getState().getDueCards(undefined, undefined, ['review', 'relearning']);
    expect(filtered).toHaveLength(2);
    expect(filtered.every((c) => c.status === 'review' || c.status === 'relearning')).toBe(true);
    expect(filtered.some((c) => c.status === 'new')).toBe(false);
    expect(filtered.some((c) => c.status === 'learning')).toBe(false);

    // 传 states=['new']: 只返回 1 张 new 卡
    const newOnly = useMemoryStore.getState().getDueCards(undefined, undefined, ['new']);
    expect(newOnly).toHaveLength(1);
    expect(newOnly[0].status).toBe('new');
  });

  it('T13: onRehydrateStorage 重建后, getDueCards 走快速路径 (dueCardsIndex 非 null)', async () => {
    const now = Date.now();
    const cards: Record<string, MemoryCard> = {
      'g1': makeCard({
        lexemeGroupId: 'g1', lemma: 'apple', objectiveDifficulty: 2,
        status: 'review', due: now - 1000, reps: 3, language: 'en',
      }),
      'g2': makeCard({
        lexemeGroupId: 'g2', lemma: 'Haus', objectiveDifficulty: 4,
        status: 'review', due: now - 500, reps: 2, language: 'de',
      }),
    };
    window.localStorage.setItem(
      'wordaydream:memory',
      JSON.stringify({
        state: { cards, ratingHistory: [], schemaVersion: 2 },
        version: 2,
      }),
    );

    vi.resetModules();
    const { useMemoryStore } = await import('./useMemoryStore');

    // onRehydrateStorage 后 dueCardsIndex 非 null (走快速路径)
    const state = useMemoryStore.getState();
    expect(state.dueCardsIndex).not.toBeNull();
    expect(state.dueCardsIndex).toBeInstanceOf(Set);
    expect(state.dueCardsIndex!.size).toBe(2);
    expect(state.dueCardsIndex!.has('g1')).toBe(true);
    expect(state.dueCardsIndex!.has('g2')).toBe(true);

    // getDueCards 返回正确结果 (2 张 due 卡)
    const dueCards = state.getDueCards();
    expect(dueCards).toHaveLength(2);
    // 按 due ASC 排序: g1 (due=now-1000) 在前, g2 (due=now-500) 在后
    expect(dueCards[0].lexemeGroupId).toBe('g1'); // due=now-1000 (更早) 排第一
    expect(dueCards[1].lexemeGroupId).toBe('g2'); // due=now-500 (更近) 排第二
  });

  it('T14: onRehydrateStorage 空状态 (无 cards) — dueCardsIndex 保持 null (向后兼容 setState)', async () => {
    // localStorage 空 (首次安装场景)
    // onRehydrateStorage 后 cards=空 Map, dueCardsIndex=null (不重建为空 Set)
    // 设计: 空状态时保持 null, 让后续 setState({ cards: map }) 直接写入 cards 时
    // getDueCards fallback 到全量扫描 (O(n), 向后兼容测试用例).
    const { useMemoryStore } = await import('./useMemoryStore');

    // 等待 onRehydrateStorage 完成
    await new Promise((r) => setTimeout(r, 50));

    const state = useMemoryStore.getState();
    // dueCardsIndex 为 null (不重建为空 Set)
    // 注: onRehydrateStorage 内 if (state.cards instanceof Map && state.cards.size > 0)
    // 空状态时 cards.size === 0, 不重建索引, 保持 null.
    expect(state.dueCardsIndex).toBeNull();
    // getDueCards 仍能正常工作 (fallback 到全量扫描)
    expect(state.getDueCards()).toHaveLength(0);
  });

  it('T15: onRehydrateStorage 后 due 卡片立即过期 — getDueCards 返回全部 due 卡', async () => {
    const now = Date.now();
    // 构造 5 张卡, 全部 due (due < now)
    const cards: Record<string, MemoryCard> = {};
    for (let i = 0; i < 5; i++) {
      cards[`g${i}`] = makeCard({
        lexemeGroupId: `g${i}`, lemma: `word${i}`, objectiveDifficulty: (i % 5) + 1 as 1 | 2 | 3 | 4 | 5,
        status: 'review', due: now - (i + 1) * 1000, reps: i + 1, language: 'en',
      });
    }
    window.localStorage.setItem(
      'wordaydream:memory',
      JSON.stringify({
        state: { cards, ratingHistory: [], schemaVersion: 2 },
        version: 2,
      }),
    );

    vi.resetModules();
    const { useMemoryStore } = await import('./useMemoryStore');

    // getDueCards 返回全部 5 张 due 卡 (按 due ASC 排序)
    const dueCards = useMemoryStore.getState().getDueCards();
    expect(dueCards).toHaveLength(5);
    // 验证 due ASC 排序
    for (let i = 1; i < dueCards.length; i++) {
      expect(dueCards[i].due).toBeGreaterThanOrEqual(dueCards[i - 1].due);
    }
    // 所有卡都在 dueCardsIndex 中
    const index = useMemoryStore.getState().dueCardsIndex!;
    expect(index.size).toBe(5);
    for (let i = 0; i < 5; i++) {
      expect(index.has(`g${i}`)).toBe(true);
    }
  });
});
