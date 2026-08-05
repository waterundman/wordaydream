/**
 * v0.4.0-harmony Stage 2 D2: cardsByLanguageIndex 派生索引单元测试
 *
 * 覆盖 test_spec:
 * - T01 [critical]: onRehydrateStorage 后 cardsByLanguageIndex 非 null (重建为 Map)
 * - T02 [critical]: onRehydrateStorage 重建后, 各语言的卡片都在 cardsByLanguageIndex 中
 * - T03 [critical]: getCardsByLanguage 使用 cardsByLanguageIndex 快速路径 (O(1) 候选过滤)
 * - T04: addCardFromToken 后 cardsByLanguageIndex 增量更新 — 新卡加入对应 language set
 * - T05: deleteCard 后 cardsByLanguageIndex 增量更新 — 卡片从对应 language set 移除
 * - T06: cardsByLanguageIndex=null 时 fallback 到全量扫描 (向后兼容测试用例)
 * - T07: cardsByLanguageIndex 不持久化 (partialize 排除)
 * - T08: rateCard 后 cardsByLanguageIndex 同步维护 — language 不变时索引不变
 * - T09 [critical]: cardsByLanguageIndex 与 dueCardsIndex 协同 — 两个索引同步重建/增量更新
 * - T10: getCardsByLanguage 语言不存在时返回空数组 (索引已初始化)
 *
 * 设计:
 * - 通过 setState 直接写入 cards 控制初始状态, 触发 onRehydrateStorage 用 resetModules + 重新 import
 * - 验证 cardsByLanguageIndex 字段类型 (Map<Language, Set<string>> | null)
 * - 验证 getCardsByLanguage 在有索引/无索引时返回结果一致 (行为等价, 性能有差异)
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

describe('v0.4.0-harmony Stage 2 D2: cardsByLanguageIndex 派生索引', () => {
  it('T01 [critical]: onRehydrateStorage 后 cardsByLanguageIndex 非 null (重建为 Map)', async () => {
    const now = Date.now();
    // 预填充 localStorage (3 张卡: 2 en + 1 de)
    const cards: Record<string, MemoryCard> = {
      'g1-en': makeCard({
        lexemeGroupId: 'g1-en', lemma: 'apple', objectiveDifficulty: 2,
        status: 'review', due: now - 1000, reps: 3, language: 'en',
      }),
      'g2-en': makeCard({
        lexemeGroupId: 'g2-en', lemma: 'book', objectiveDifficulty: 2,
        status: 'review', due: now - 500, reps: 2, language: 'en',
      }),
      'g3-de': makeCard({
        lexemeGroupId: 'g3-de', lemma: 'Haus', objectiveDifficulty: 4,
        status: 'review', due: now - 500, reps: 1, language: 'de',
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

    // 断言: cardsByLanguageIndex 已重建为非 null Map
    const state = useMemoryStore.getState();
    expect(state.cardsByLanguageIndex).not.toBeNull();
    expect(state.cardsByLanguageIndex).toBeInstanceOf(Map);
  });

  it('T02 [critical]: onRehydrateStorage 重建后, 各语言的卡片都在 cardsByLanguageIndex 中', async () => {
    const now = Date.now();
    const cards: Record<string, MemoryCard> = {
      'g1-en': makeCard({
        lexemeGroupId: 'g1-en', lemma: 'apple', objectiveDifficulty: 2,
        status: 'review', due: now - 1000, reps: 3, language: 'en',
      }),
      'g2-en': makeCard({
        lexemeGroupId: 'g2-en', lemma: 'book', objectiveDifficulty: 2,
        status: 'review', due: now - 500, reps: 2, language: 'en',
      }),
      'g3-de': makeCard({
        lexemeGroupId: 'g3-de', lemma: 'Haus', objectiveDifficulty: 4,
        status: 'review', due: now - 500, reps: 1, language: 'de',
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

    const index = useMemoryStore.getState().cardsByLanguageIndex;
    expect(index).not.toBeNull();
    // en: 2 张卡
    expect(index!.get('en')).toBeDefined();
    expect(index!.get('en')!.has('g1-en')).toBe(true);
    expect(index!.get('en')!.has('g2-en')).toBe(true);
    expect(index!.get('en')!.size).toBe(2);
    // de: 1 张卡
    expect(index!.get('de')).toBeDefined();
    expect(index!.get('de')!.has('g3-de')).toBe(true);
    expect(index!.get('de')!.size).toBe(1);
  });

  it('T03 [critical]: getCardsByLanguage 使用 cardsByLanguageIndex 快速路径 (O(1) 候选过滤)', async () => {
    const now = Date.now();
    const cards: Record<string, MemoryCard> = {
      'g1-en': makeCard({
        lexemeGroupId: 'g1-en', lemma: 'apple', objectiveDifficulty: 2,
        status: 'review', due: now - 1000, reps: 3, language: 'en',
      }),
      'g2-en': makeCard({
        lexemeGroupId: 'g2-en', lemma: 'book', objectiveDifficulty: 2,
        status: 'review', due: now - 500, reps: 2, language: 'en',
      }),
      'g3-de': makeCard({
        lexemeGroupId: 'g3-de', lemma: 'Haus', objectiveDifficulty: 4,
        status: 'review', due: now - 500, reps: 1, language: 'de',
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

    // getCardsByLanguage('en') 返回 2 张 en 卡
    const enCards = useMemoryStore.getState().getCardsByLanguage('en');
    expect(enCards).toHaveLength(2);
    expect(enCards.every((c) => c.language === 'en')).toBe(true);
    expect(enCards.map((c) => c.lexemeGroupId).sort()).toEqual(['g1-en', 'g2-en']);

    // getCardsByLanguage('de') 返回 1 张 de 卡
    const deCards = useMemoryStore.getState().getCardsByLanguage('de');
    expect(deCards).toHaveLength(1);
    expect(deCards[0].language).toBe('de');
    expect(deCards[0].lexemeGroupId).toBe('g3-de');
  });

  it('T04: addCardFromToken 后 cardsByLanguageIndex 增量更新 — 新卡加入对应 language set', async () => {
    const { useMemoryStore } = await import('./useMemoryStore');

    // 初始: 空状态, cardsByLanguageIndex 已初始化为空 Map
    useMemoryStore.setState({
      cards: new Map(),
      cardsByLanguageIndex: new Map(),
    });

    // 添加 en 卡
    const token1 = makeToken({
      lexemeGroupId: 'g-new-en', lemma: 'newword', objectiveDifficulty: 2,
    });
    useMemoryStore.getState().addCardFromToken(token1, 'en');

    // 断言: en set 含新卡
    const state1 = useMemoryStore.getState();
    expect(state1.cardsByLanguageIndex).not.toBeNull();
    expect(state1.cardsByLanguageIndex!.get('en')?.has('g-new-en')).toBe(true);

    // 添加 de 卡
    const token2 = makeToken({
      lexemeGroupId: 'g-new-de', lemma: 'HausNeu', objectiveDifficulty: 4,
    });
    useMemoryStore.getState().addCardFromToken(token2, 'de');

    // 断言: de set 含新卡
    const state2 = useMemoryStore.getState();
    expect(state2.cardsByLanguageIndex!.get('de')?.has('g-new-de')).toBe(true);
    expect(state2.cardsByLanguageIndex!.get('en')?.has('g-new-en')).toBe(true);
  });

  it('T05: deleteCard 后 cardsByLanguageIndex 增量更新 — 卡片从对应 language set 移除', async () => {
    const { useMemoryStore } = await import('./useMemoryStore');

    // 初始: 2 张 en 卡 + 1 张 de 卡, 索引已初始化
    const en1 = makeCard({
      id: 'card-g1-en', lexemeGroupId: 'g1-en', lemma: 'apple', objectiveDifficulty: 2,
      status: 'review', due: 0, reps: 3, language: 'en',
    });
    const en2 = makeCard({
      id: 'card-g2-en', lexemeGroupId: 'g2-en', lemma: 'book', objectiveDifficulty: 2,
      status: 'review', due: 0, reps: 2, language: 'en',
    });
    const de1 = makeCard({
      id: 'card-g3-de', lexemeGroupId: 'g3-de', lemma: 'Haus', objectiveDifficulty: 4,
      status: 'review', due: 0, reps: 1, language: 'de',
    });
    useMemoryStore.setState({
      cards: new Map([
        ['g1-en', en1],
        ['g2-en', en2],
        ['g3-de', de1],
      ]),
      cardsByLanguageIndex: new Map([
        ['en', new Set<string>(['g1-en', 'g2-en'])],
        ['de', new Set<string>(['g3-de'])],
      ]),
    });

    // 删除 g1-en
    useMemoryStore.getState().deleteCard('g1-en');

    // 断言: en set 移除 g1-en, 保留 g2-en; de set 不变
    const state1 = useMemoryStore.getState();
    expect(state1.cardsByLanguageIndex).not.toBeNull();
    expect(state1.cardsByLanguageIndex!.get('en')?.has('g1-en')).toBe(false);
    expect(state1.cardsByLanguageIndex!.get('en')?.has('g2-en')).toBe(true);
    expect(state1.cardsByLanguageIndex!.get('en')?.size).toBe(1);
    expect(state1.cardsByLanguageIndex!.get('de')?.has('g3-de')).toBe(true);
    expect(state1.cardsByLanguageIndex!.get('de')?.size).toBe(1);
    expect(state1.cards.size).toBe(2);
  });

  it('T06: cardsByLanguageIndex=null 时 fallback 到全量扫描 (向后兼容测试用例)', async () => {
    const { useMemoryStore } = await import('./useMemoryStore');

    // 初始: 直接 setState 写入 cards (不触发 onRehydrateStorage, cardsByLanguageIndex 保持初始 null)
    const cards = new Map<string, MemoryCard>([
      ['g1-en', makeCard({
        lexemeGroupId: 'g1-en', lemma: 'apple', objectiveDifficulty: 2,
        status: 'review', due: 0, reps: 3, language: 'en',
      })],
      ['g2-en', makeCard({
        lexemeGroupId: 'g2-en', lemma: 'book', objectiveDifficulty: 2,
        status: 'review', due: 0, reps: 2, language: 'en',
      })],
      ['g3-de', makeCard({
        lexemeGroupId: 'g3-de', lemma: 'Haus', objectiveDifficulty: 4,
        status: 'review', due: 0, reps: 1, language: 'de',
      })],
    ]);
    useMemoryStore.setState({
      cards,
      // 不传 cardsByLanguageIndex, 保持初始 null (fallback 路径)
      cardsByLanguageIndex: null,
    });

    // 断言: cardsByLanguageIndex=null (fallback 路径)
    expect(useMemoryStore.getState().cardsByLanguageIndex).toBeNull();

    // getCardsByLanguage 仍然返回正确结果 (全量扫描 fallback)
    const enCards = useMemoryStore.getState().getCardsByLanguage('en');
    expect(enCards).toHaveLength(2);
    expect(enCards.every((c) => c.language === 'en')).toBe(true);
    expect(enCards.map((c) => c.lexemeGroupId).sort()).toEqual(['g1-en', 'g2-en']);

    const deCards = useMemoryStore.getState().getCardsByLanguage('de');
    expect(deCards).toHaveLength(1);
    expect(deCards[0].lexemeGroupId).toBe('g3-de');
  });

  it('T07: cardsByLanguageIndex 不持久化 (partialize 排除)', async () => {
    const { useMemoryStore } = await import('./useMemoryStore');

    // 写入 cards + 初始化 cardsByLanguageIndex (Map)
    useMemoryStore.setState({
      cards: new Map([
        ['g1-en', makeCard({
          lexemeGroupId: 'g1-en', lemma: 'apple', objectiveDifficulty: 2,
          status: 'review', due: 0, reps: 3, language: 'en',
        })],
      ]),
      cardsByLanguageIndex: new Map([['en', new Set<string>(['g1-en'])]]),
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
    // cardsByLanguageIndex 不应被持久化 (partialize 排除)
    expect(parsed.state).not.toHaveProperty('cardsByLanguageIndex');
    // dueCardsIndex 也不应被持久化 (Stage 1 D1)
    expect(parsed.state).not.toHaveProperty('dueCardsIndex');
  });

  it('T08: rateCard 后 cardsByLanguageIndex 同步维护 — language 不变时索引不变', async () => {
    const { useMemoryStore } = await import('./useMemoryStore');

    // 初始: 一张 en due 卡 (due=now-1000)
    const now = Date.now();
    const card = makeCard({
      id: 'card-g1', lexemeGroupId: 'g1', lemma: 'apple', objectiveDifficulty: 2,
      status: 'review', due: now - 1000, reps: 3, language: 'en',
    });
    useMemoryStore.setState({
      cards: new Map([['g1', card]]),
      cardsByLanguageIndex: new Map([['en', new Set<string>(['g1'])]]),
      dueCardsIndex: new Set<string>(['g1']),
    });

    // rateCard 评分 'good' → FSRS 计算新 due (通常 > now)
    useMemoryStore.getState().rateCard('g1', 'good');

    // 断言: cardsByLanguageIndex 不变 (language 未变)
    // rateCard 只更新 due/stability/difficulty/reps/status, 不改变 language
    const state1 = useMemoryStore.getState();
    expect(state1.cardsByLanguageIndex).not.toBeNull();
    expect(state1.cardsByLanguageIndex!.get('en')?.has('g1')).toBe(true);
    expect(state1.cardsByLanguageIndex!.get('en')?.size).toBe(1);
  });

  it('T09 [critical]: cardsByLanguageIndex 与 dueCardsIndex 协同 — 两个索引同步重建/增量更新', async () => {
    const now = Date.now();
    const cards: Record<string, MemoryCard> = {
      'g1-en-due': makeCard({
        lexemeGroupId: 'g1-en-due', lemma: 'apple', objectiveDifficulty: 2,
        status: 'review', due: now - 1000, reps: 3, language: 'en',
      }),
      'g2-de-due': makeCard({
        lexemeGroupId: 'g2-de-due', lemma: 'Haus', objectiveDifficulty: 4,
        status: 'review', due: now - 500, reps: 2, language: 'de',
      }),
      'g3-en-future': makeCard({
        lexemeGroupId: 'g3-en-future', lemma: 'future', objectiveDifficulty: 1,
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

    const state = useMemoryStore.getState();
    // 协同断言 1: 两个索引都已重建 (非 null)
    expect(state.dueCardsIndex).not.toBeNull();
    expect(state.cardsByLanguageIndex).not.toBeNull();
    // 协同断言 2: dueCardsIndex 只含 due 卡 (2 张)
    expect(state.dueCardsIndex!.size).toBe(2);
    expect(state.dueCardsIndex!.has('g1-en-due')).toBe(true);
    expect(state.dueCardsIndex!.has('g2-de-due')).toBe(true);
    expect(state.dueCardsIndex!.has('g3-en-future')).toBe(false);
    // 协同断言 3: cardsByLanguageIndex 含全部卡 (3 张, 按 language 分组)
    expect(state.cardsByLanguageIndex!.get('en')?.size).toBe(2); // g1-en-due + g3-en-future
    expect(state.cardsByLanguageIndex!.get('de')?.size).toBe(1); // g2-de-due
    expect(state.cardsByLanguageIndex!.get('en')?.has('g1-en-due')).toBe(true);
    expect(state.cardsByLanguageIndex!.get('en')?.has('g3-en-future')).toBe(true);
    expect(state.cardsByLanguageIndex!.get('de')?.has('g2-de-due')).toBe(true);
  });

  it('T10: getCardsByLanguage 语言不存在时返回空数组 (索引已初始化)', async () => {
    const now = Date.now();
    const cards: Record<string, MemoryCard> = {
      'g1-en': makeCard({
        lexemeGroupId: 'g1-en', lemma: 'apple', objectiveDifficulty: 2,
        status: 'review', due: now - 1000, reps: 3, language: 'en',
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

    // 索引已初始化 (非 null), 但 de 语言无卡片
    const state = useMemoryStore.getState();
    expect(state.cardsByLanguageIndex).not.toBeNull();
    // de set 不存在或为空
    expect(state.cardsByLanguageIndex!.get('de')).toBeUndefined();

    // getCardsByLanguage('de') 返回空数组 (不报错, 不 fallback 到全量扫描)
    const deCards = useMemoryStore.getState().getCardsByLanguage('de');
    expect(deCards).toEqual([]);
  });

  it('T11: onRehydrateStorage 空状态 (无 cards) — cardsByLanguageIndex 保持 null (向后兼容 setState)', async () => {
    // localStorage 空 (首次安装场景)
    // onRehydrateStorage 后 cards=空 Map, cardsByLanguageIndex=null (不重建为空 Map)
    const { useMemoryStore } = await import('./useMemoryStore');

    // 等待 onRehydrateStorage 完成
    await new Promise((r) => setTimeout(r, 50));

    const state = useMemoryStore.getState();
    // cardsByLanguageIndex 为 null (不重建为空 Map)
    expect(state.cardsByLanguageIndex).toBeNull();
    // dueCardsIndex 也为 null (Stage 1 D1 一致)
    expect(state.dueCardsIndex).toBeNull();
    // getCardsByLanguage 仍能正常工作 (fallback 到全量扫描)
    expect(state.getCardsByLanguage('en')).toEqual([]);
    expect(state.getCardsByLanguage('de')).toEqual([]);
  });

  it('T12: resetAll 后 cardsByLanguageIndex 重置为 null (与 dueCardsIndex 一致)', async () => {
    const { useMemoryStore } = await import('./useMemoryStore');

    // 初始: 有卡片, 索引已初始化
    useMemoryStore.setState({
      cards: new Map([
        ['g1-en', makeCard({
          lexemeGroupId: 'g1-en', lemma: 'apple', objectiveDifficulty: 2,
          status: 'review', due: 0, reps: 3, language: 'en',
        })],
      ]),
      cardsByLanguageIndex: new Map([['en', new Set<string>(['g1-en'])]]),
      dueCardsIndex: new Set<string>(['g1-en']),
    });

    // resetAll
    useMemoryStore.getState().resetAll();

    // 断言: 两个索引都重置为 null
    const state = useMemoryStore.getState();
    expect(state.cardsByLanguageIndex).toBeNull();
    expect(state.dueCardsIndex).toBeNull();
    expect(state.cards.size).toBe(0);
  });

  it('T13: getCardsByLanguage 与全量扫描结果一致性 (有索引 vs null fallback 行为等价)', async () => {
    const { useMemoryStore } = await import('./useMemoryStore');

    // 构造 5 张卡: 3 en + 2 de
    const cards = new Map<string, MemoryCard>([
      ['g1-en', makeCard({
        lexemeGroupId: 'g1-en', lemma: 'apple', objectiveDifficulty: 2,
        status: 'review', due: 0, reps: 3, language: 'en',
      })],
      ['g2-en', makeCard({
        lexemeGroupId: 'g2-en', lemma: 'book', objectiveDifficulty: 2,
        status: 'review', due: 0, reps: 2, language: 'en',
      })],
      ['g3-de', makeCard({
        lexemeGroupId: 'g3-de', lemma: 'Haus', objectiveDifficulty: 4,
        status: 'review', due: 0, reps: 1, language: 'de',
      })],
      ['g4-de', makeCard({
        lexemeGroupId: 'g4-de', lemma: 'Laufen', objectiveDifficulty: 3,
        status: 'learning', due: 0, reps: 0, language: 'de',
      })],
      ['g5-en', makeCard({
        lexemeGroupId: 'g5-en', lemma: 'run', objectiveDifficulty: 1,
        status: 'new', due: 0, reps: 0, language: 'en',
      })],
    ]);

    // 路径 A: cardsByLanguageIndex=null (fallback 全量扫描)
    useMemoryStore.setState({
      cards,
      cardsByLanguageIndex: null,
    });
    const enCardsFallback = useMemoryStore.getState().getCardsByLanguage('en');
    const deCardsFallback = useMemoryStore.getState().getCardsByLanguage('de');

    // 路径 B: cardsByLanguageIndex 已初始化 (快速路径)
    // 手动构造索引 (与 onRehydrateStorage 重建逻辑一致)
    const langIndex = new Map<Language, Set<string>>();
    for (const [cardId, card] of cards) {
      if (card.language) {
        const set = langIndex.get(card.language) ?? new Set<string>();
        set.add(cardId);
        langIndex.set(card.language, set);
      }
    }
    useMemoryStore.setState({
      cards,
      cardsByLanguageIndex: langIndex,
    });
    const enCardsIndexed = useMemoryStore.getState().getCardsByLanguage('en');
    const deCardsIndexed = useMemoryStore.getState().getCardsByLanguage('de');

    // 断言: 两条路径返回结果一致 (行为等价)
    expect(enCardsFallback).toHaveLength(3);
    expect(enCardsIndexed).toHaveLength(3);
    expect(enCardsFallback.map((c) => c.lexemeGroupId).sort())
      .toEqual(enCardsIndexed.map((c) => c.lexemeGroupId).sort());

    expect(deCardsFallback).toHaveLength(2);
    expect(deCardsIndexed).toHaveLength(2);
    expect(deCardsFallback.map((c) => c.lexemeGroupId).sort())
      .toEqual(deCardsIndexed.map((c) => c.lexemeGroupId).sort());
  });

  it('T14: addCardFromToken 不传 language 时新卡 language=undefined, 不加入 cardsByLanguageIndex', async () => {
    const { useMemoryStore } = await import('./useMemoryStore');

    // 初始: 空状态, 索引已初始化为空 Map
    useMemoryStore.setState({
      cards: new Map(),
      cardsByLanguageIndex: new Map(),
    });

    // 添加卡 (不传 language) → card.language = undefined
    const token = makeToken({
      lexemeGroupId: 'g-no-lang', lemma: 'nolangword', objectiveDifficulty: 2,
    });
    const card = useMemoryStore.getState().addCardFromToken(token);

    // 断言: 新卡 language = undefined (不加入索引)
    expect(card.language).toBeUndefined();
    const state = useMemoryStore.getState();
    expect(state.cardsByLanguageIndex).not.toBeNull();
    // en / de set 都不含新卡 (language=undefined 不入索引)
    expect(state.cardsByLanguageIndex!.get('en')?.has('g-no-lang')).toBeFalsy();
    expect(state.cardsByLanguageIndex!.get('de')?.has('g-no-lang')).toBeFalsy();
    // 卡片仍存在于 cards 中
    expect(state.cards.has('g-no-lang')).toBe(true);
  });

  it('T15: rateCard → deleteCard 连续操作 — cardsByLanguageIndex 连续增量更新正确', async () => {
    const now = Date.now();
    const { useMemoryStore } = await import('./useMemoryStore');

    // 初始: 2 张 en due 卡
    const card1 = makeCard({
      id: 'card-g1', lexemeGroupId: 'g1', lemma: 'apple', objectiveDifficulty: 2,
      status: 'review', due: now - 1000, reps: 3, language: 'en',
    });
    const card2 = makeCard({
      id: 'card-g2', lexemeGroupId: 'g2', lemma: 'book', objectiveDifficulty: 2,
      status: 'review', due: now - 500, reps: 2, language: 'en',
    });
    useMemoryStore.setState({
      cards: new Map([
        ['g1', card1],
        ['g2', card2],
      ]),
      cardsByLanguageIndex: new Map([['en', new Set<string>(['g1', 'g2'])]]),
      dueCardsIndex: new Set<string>(['g1', 'g2']),
    });

    // 1. rateCard g1 'good' → g1 新 due > now, dueCardsIndex 移除 g1
    //    language 不变 (en), cardsByLanguageIndex 保持 g1 在 en set
    useMemoryStore.getState().rateCard('g1', 'good');
    const state1 = useMemoryStore.getState();
    expect(state1.cardsByLanguageIndex!.get('en')?.has('g1')).toBe(true);
    expect(state1.cardsByLanguageIndex!.get('en')?.has('g2')).toBe(true);
    expect(state1.cardsByLanguageIndex!.get('en')?.size).toBe(2);
    // dueCardsIndex 移除 g1 (新 due > now)
    expect(state1.dueCardsIndex!.has('g1')).toBe(false);
    expect(state1.dueCardsIndex!.has('g2')).toBe(true);

    // 2. deleteCard g2 → g2 从 en set 移除, dueCardsIndex 也移除
    useMemoryStore.getState().deleteCard('g2');
    const state2 = useMemoryStore.getState();
    expect(state2.cardsByLanguageIndex!.get('en')?.has('g1')).toBe(true);
    expect(state2.cardsByLanguageIndex!.get('en')?.has('g2')).toBe(false);
    expect(state2.cardsByLanguageIndex!.get('en')?.size).toBe(1);
    expect(state2.dueCardsIndex!.has('g1')).toBe(false);
    expect(state2.dueCardsIndex!.has('g2')).toBe(false);
    expect(state2.cards.size).toBe(1);
  });
});
