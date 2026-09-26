/**
 * v0.2.0-harmony Stage 3: Web ↔ 鸿蒙 relationalStore 双向同步测试
 *
 * 覆盖 test_spec (9 cases):
 * - T01: useMemoryStore.rateCard 调用 harmonyBridge.upsertCard (16 字段验证)
 * - T02: useMemoryStore.addCardFromToken 调用 harmonyBridge.upsertCard
 * - T03: useMemoryStore.deleteCard 调用 harmonyBridge.deleteCard
 * - T04: onRehydrateStorage 空状态 + harmonyBridge 存在时调用 getAllCards (state 恢复)
 * - T04b: getAllCards 旧数组形态兼容 (parseBridgeRecords 归一)
 * - T04c: 原生推送通道 (__applyNativeCardRestore) 与拉取路径共用恢复实现 (M1)
 * - T05: onRehydrateStorage 已有数据时不调用 getAllCards (避免覆盖)
 * - T06: upsertCard 16 字段序列化无丢失 (deep equal MemoryCardRecordBridge)
 * - T07: MemoryCardStore.getAllCards SQL 含 "ORDER BY due ASC" (源码断言)
 * - T08: getTodayReviewStats 计算逻辑 (dueCount / reviewedCount / totalCount)
 * - T09: rateCard 在 harmonyBridge 抛错时不影响主流程 (fire-and-forget + .catch)
 *
 * Mock 策略:
 * - window.harmonyBridge: vi.fn() 桩, 每个 case 配置不同返回值
 * - localStorage: beforeEach 清空, 保证 store 重建 (vi.resetModules)
 * - 鸿蒙端 .ets 代码: vitest 不能直接运行, T07 通过源码字符串断言, T08 通过 TS 镜像逻辑验证
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { MemoryCard, TokenOccurrence } from '../../../../types';
import type {
  HarmonyBridge,
  MemoryCardRecordBridge,
} from '../../../../platform/harmonyBridge';

type BridgeWindow = Window & { harmonyBridge?: HarmonyBridge };

const PERSIST_KEY = 'wordaydream:memory';

/** 构造全合法 MemoryCard (16 字段), 供各 case 复用. */
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

/** 构造全合法 MemoryCardRecordBridge (16 字段, ArkTS 镜像). */
function makeBridgeCard(
  partial: Partial<MemoryCardRecordBridge> &
    Pick<MemoryCardRecordBridge, 'lexemeGroupId' | 'lemma' | 'objectiveDifficulty'>,
): MemoryCardRecordBridge {
  return {
    id: partial.id ?? `card-${partial.lexemeGroupId}`,
    lexemeGroupId: partial.lexemeGroupId,
    lemma: partial.lemma,
    objectiveDifficulty: partial.objectiveDifficulty,
    language: partial.language ?? '',
    firstLearnedAt: partial.firstLearnedAt ?? 1_700_000_000_000,
    lastReviewAt: partial.lastReviewAt ?? 1_700_000_000_000,
    due: partial.due ?? 0,
    stability: partial.stability ?? 0,
    difficulty: partial.difficulty ?? 0,
    elapsedDays: partial.elapsedDays ?? 0,
    scheduledDays: partial.scheduledDays ?? 0,
    reps: partial.reps ?? 0,
    lapses: partial.lapses ?? 0,
    status: partial.status ?? 'new',
    learningSteps: partial.learningSteps ?? 0,
  };
}

/** 构造最小合法 TokenOccurrence, 供 addCardFromToken 调用. */
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

/**
 * 构造完整 HarmonyBridge 桩, 默认所有方法为 vi.fn() + 安全返回值.
 *
 * getDueCardsCount / getRecentlyReviewedCards / getTodayReviewStats 仅原生侧
 * 内部使用 (Web 无调用方), 已从 interface 移除, 故桩不再实现.
 */
function makeBridgeStub(overrides?: Partial<HarmonyBridge>): HarmonyBridge {
  return {
    registerReminder: vi.fn().mockResolvedValue(undefined),
    readPreferences: vi.fn().mockResolvedValue(null),
    writePreferences: vi.fn().mockResolvedValue(undefined),
    triggerHapticFeedback: vi.fn(),
    notifyWebReady: vi.fn(),
    notifyWebContentReady: vi.fn(),
    upsertCard: vi.fn().mockResolvedValue(undefined),
    deleteCard: vi.fn().mockResolvedValue(undefined),
    // v1.6.0 D1: 复杂返回值以 JSON 字符串跨桥 (API 22 基本类型契约)
    getAllCards: vi.fn().mockResolvedValue('[]'),
    speak: vi.fn().mockResolvedValue(''),
    stopSpeech: vi.fn(),
    isSpeechSupported: vi.fn().mockResolvedValue(true),
    getSpeechEngines: vi.fn().mockResolvedValue('[]'),
    ...overrides,
  };
}

/** 写入 localStorage 模拟 zustand persist 数据格式. */
function seedLocalStorage(cards: Record<string, MemoryCard>): void {
  window.localStorage.setItem(
    PERSIST_KEY,
    JSON.stringify({
      state: {
        cards,
        ratingHistory: [],
        schemaVersion: 2,
      },
      version: 2,
    }),
  );
}

const ORIGINAL_BRIDGE: HarmonyBridge | undefined = (window as BridgeWindow).harmonyBridge;

beforeEach(() => {
  if (typeof window !== 'undefined') {
    window.localStorage.clear();
  }
  vi.resetModules();
  // 默认 Web 环境: window.harmonyBridge === undefined
  delete (window as BridgeWindow).harmonyBridge;
});

afterEach(() => {
  if (typeof window !== 'undefined') {
    window.localStorage.clear();
  }
  vi.resetModules();
  // 恢复 window.harmonyBridge 原始状态
  const w = window as BridgeWindow;
  if (ORIGINAL_BRIDGE === undefined) {
    delete w.harmonyBridge;
  } else {
    w.harmonyBridge = ORIGINAL_BRIDGE;
  }
});

describe('v0.2.0-harmony Stage 3: Web ↔ 鸿蒙 relationalStore sync', () => {
  it('T01 [critical]: rateCard 调用 harmonyBridge.upsertCard (16 字段验证)', async () => {
    const stub = makeBridgeStub();
    (window as BridgeWindow).harmonyBridge = stub;

    const { useMemoryStore } = await import('../useMemoryStore');
    const card = makeCard({
      id: 'card-g1',
      lexemeGroupId: 'g1',
      lemma: 'apple',
      objectiveDifficulty: 2,
      status: 'review',
      due: 0,
      reps: 2,
      language: 'en',
    });
    useMemoryStore.setState({ cards: new Map([['g1', card]]) });

    useMemoryStore.getState().rateCard('g1', 'good');
    // 等待 microtask 跑完 (fire-and-forget promise 链)
    await new Promise((r) => setTimeout(r, 10));

    expect(stub.upsertCard).toHaveBeenCalledTimes(1);

    // 验证 16 字段类型 + 关键值
    const arg = stub.upsertCard.mock.calls[0][0] as MemoryCardRecordBridge;
    expect(typeof arg.id).toBe('string');
    expect(typeof arg.lexemeGroupId).toBe('string');
    expect(typeof arg.lemma).toBe('string');
    expect(typeof arg.objectiveDifficulty).toBe('number');
    expect(typeof arg.language).toBe('string');
    expect(typeof arg.firstLearnedAt).toBe('number');
    expect(typeof arg.lastReviewAt).toBe('number');
    expect(typeof arg.due).toBe('number');
    expect(typeof arg.stability).toBe('number');
    expect(typeof arg.difficulty).toBe('number');
    expect(typeof arg.elapsedDays).toBe('number');
    expect(typeof arg.scheduledDays).toBe('number');
    expect(typeof arg.reps).toBe('number');
    expect(typeof arg.lapses).toBe('number');
    expect(typeof arg.status).toBe('string');
    expect(typeof arg.learningSteps).toBe('number');

    // 关键值
    expect(arg.id).toBe(card.id);
    expect(arg.lexemeGroupId).toBe('g1');
    expect(arg.lemma).toBe('apple');
    expect(arg.objectiveDifficulty).toBe(2);
    expect(arg.language).toBe('en');
    expect(arg.reps).toBe(card.reps + 1);
    expect(arg.status).toBe('review');
  });

  it('T02 [critical]: addCardFromToken 调用 harmonyBridge.upsertCard', async () => {
    const stub = makeBridgeStub();
    (window as BridgeWindow).harmonyBridge = stub;

    const { useMemoryStore } = await import('../useMemoryStore');
    const token = makeToken({
      lexemeGroupId: 'g2',
      lemma: 'Haus',
      objectiveDifficulty: 3,
    });

    const card = useMemoryStore.getState().addCardFromToken(token, 'de');
    await new Promise((r) => setTimeout(r, 10));

    expect(stub.upsertCard).toHaveBeenCalledTimes(1);
    const arg = stub.upsertCard.mock.calls[0][0] as MemoryCardRecordBridge;
    expect(arg.id).toBe(card.id);
    expect(arg.lexemeGroupId).toBe('g2');
    expect(arg.lemma).toBe('Haus');
    expect(arg.objectiveDifficulty).toBe(3);
    expect(arg.language).toBe('de');
    expect(arg.status).toBe('new');
  });

  it('T03 [critical]: deleteCard 调用 harmonyBridge.deleteCard', async () => {
    const stub = makeBridgeStub();
    (window as BridgeWindow).harmonyBridge = stub;

    const { useMemoryStore } = await import('../useMemoryStore');
    const card = makeCard({
      id: 'card-g1',
      lexemeGroupId: 'g1',
      lemma: 'apple',
      objectiveDifficulty: 2,
    });
    useMemoryStore.setState({ cards: new Map([['g1', card]]) });

    useMemoryStore.getState().deleteCard('g1');
    await new Promise((r) => setTimeout(r, 10));

    expect(stub.deleteCard).toHaveBeenCalledTimes(1);
    expect(stub.deleteCard.mock.calls[0][0]).toBe('g1');
    // state 已清空
    expect(useMemoryStore.getState().cards.size).toBe(0);
  });

  it('T04 [critical]: onRehydrateStorage 空状态 + harmonyBridge → 调用 getAllCards 恢复', async () => {
    const bridgeCards: MemoryCardRecordBridge[] = [
      makeBridgeCard({
        id: 'card-g1',
        lexemeGroupId: 'g1',
        lemma: 'apple',
        objectiveDifficulty: 2,
        due: 1_000,
        language: 'en',
        status: 'review',
        reps: 5,
      }),
      makeBridgeCard({
        id: 'card-g2',
        lexemeGroupId: 'g2',
        lemma: 'Haus',
        objectiveDifficulty: 4,
        due: 500,
        language: 'de',
        status: 'learning',
      }),
    ];
    const stub = makeBridgeStub({
      // v1.6.0 D1: 原生侧返回 JSON 字符串
      getAllCards: vi.fn().mockResolvedValue(JSON.stringify(bridgeCards)),
    });
    (window as BridgeWindow).harmonyBridge = stub;
    // localStorage 已在 beforeEach 清空

    const { useMemoryStore } = await import('../useMemoryStore');
    // 等待 fire-and-forget 链路 settle (onRehydrateStorage → getAllCards → setState)
    await new Promise((r) => setTimeout(r, 50));

    expect(stub.getAllCards).toHaveBeenCalledTimes(1);
    const cards = useMemoryStore.getState().cards;
    expect(cards.size).toBe(2);
    // due ASC 排序 (bridgeCards 已是 due ASC: 1000, 500 -> 但 Map 保留插入顺序,
    // 我们按 lexemeGroupId 索引, 不强制顺序, 这里只验证恢复)
    const c1 = cards.get('g1');
    expect(c1).toBeDefined();
    expect(c1!.lemma).toBe('apple');
    expect(c1!.language).toBe('en');
    expect(c1!.reps).toBe(5);
    const c2 = cards.get('g2');
    expect(c2).toBeDefined();
    expect(c2!.lemma).toBe('Haus');
    expect(c2!.language).toBe('de');
    expect(c2!.status).toBe('learning');
  });

  it('T04b [critical]: getAllCards 旧数组形态仍兼容 (parseBridgeRecords 归一)', async () => {
    const bridgeCards: MemoryCardRecordBridge[] = [
      makeBridgeCard({ lexemeGroupId: 'g1', lemma: 'apple', objectiveDifficulty: 2 }),
    ];
    const stub = makeBridgeStub({
      getAllCards: vi.fn().mockResolvedValue(bridgeCards as unknown as string),
    });
    (window as BridgeWindow).harmonyBridge = stub;

    const { useMemoryStore } = await import('../useMemoryStore');
    await new Promise((r) => setTimeout(r, 50));

    const cards = useMemoryStore.getState().cards;
    expect(cards.size).toBe(1);
    expect(cards.get('g1')?.lemma).toBe('apple');
  });

  it('T04c [critical]: 原生推送通道与拉取路径共用恢复实现 (M1)', async () => {
    const bridgeCards: MemoryCardRecordBridge[] = [
      makeBridgeCard({ lexemeGroupId: 'g1', lemma: 'apple', objectiveDifficulty: 2 }),
      makeBridgeCard({ lexemeGroupId: 'g2', lemma: 'Haus', objectiveDifficulty: 4, language: 'de' }),
    ];
    const stub = makeBridgeStub();
    (window as BridgeWindow).harmonyBridge = stub;

    const { useMemoryStore } = await import('../useMemoryStore');
    await new Promise((r) => setTimeout(r, 50));

    // 推送接收器由 useMemoryStore 模块加载时挂载
    expect(typeof window.__applyNativeCardRestore).toBe('function');
    window.__applyNativeCardRestore!(JSON.stringify(bridgeCards));

    const cards = useMemoryStore.getState().cards;
    expect(cards.size).toBe(2);
    expect(cards.get('g2')?.language).toBe('de');

    // store 非空时推送不覆盖用户数据
    window.__applyNativeCardRestore!(
      JSON.stringify([
        makeBridgeCard({ lexemeGroupId: 'g9', lemma: 'nothing', objectiveDifficulty: 1 }),
      ])
    );
    expect(useMemoryStore.getState().cards.size).toBe(2);
    expect(useMemoryStore.getState().cards.has('g9')).toBe(false);
  });

  it('T05 [critical]: onRehydrateStorage 已有数据时不调用 getAllCards (避免覆盖)', async () => {
    // 预填充 localStorage (模拟已有数据)
    const existingCard = makeCard({
      id: 'card-g1',
      lexemeGroupId: 'g1',
      lemma: 'apple',
      objectiveDifficulty: 2,
    });
    seedLocalStorage({ g1: existingCard });

    const stub = makeBridgeStub();
    (window as BridgeWindow).harmonyBridge = stub;

    const { useMemoryStore } = await import('../useMemoryStore');
    await new Promise((r) => setTimeout(r, 50));

    // 已有数据 → 不调用 getAllCards (避免覆盖用户最近写入)
    expect(stub.getAllCards).not.toHaveBeenCalled();

    // 现有卡片保留
    const cards = useMemoryStore.getState().cards;
    expect(cards.size).toBe(1);
    expect(cards.get('g1')?.lemma).toBe('apple');
  });

  it('T06 [critical]: upsertCard 16 字段序列化无丢失 (deep equal MemoryCardRecordBridge)', async () => {
    const stub = makeBridgeStub();
    (window as BridgeWindow).harmonyBridge = stub;

    const { useMemoryStore } = await import('../useMemoryStore');
    const card = makeCard({
      id: 'card-g1',
      lexemeGroupId: 'g1',
      lemma: 'Haus',
      objectiveDifficulty: 4,
      language: 'de',
      firstLearnedAt: 1_700_000_000_000,
      lastReviewAt: 1_700_010_000_000,
      due: 1_700_020_000_000,
      stability: 2.5,
      difficulty: 4.2,
      elapsedDays: 1,
      scheduledDays: 3,
      reps: 5,
      lapses: 1,
      status: 'review',
      learningSteps: 0,
    });
    useMemoryStore.setState({ cards: new Map([['g1', card]]) });

    useMemoryStore.getState().rateCard('g1', 'good');
    await new Promise((r) => setTimeout(r, 10));

    expect(stub.upsertCard).toHaveBeenCalledTimes(1);
    const arg = stub.upsertCard.mock.calls[0][0] as MemoryCardRecordBridge;

    // 16 字段逐一验证 (rateCard 会改变 reps/due/stability/difficulty/lastReviewAt/elapsedDays/scheduledDays/status)
    expect(arg.id).toBe(card.id);
    expect(arg.lexemeGroupId).toBe(card.lexemeGroupId);
    expect(arg.lemma).toBe(card.lemma);
    expect(arg.objectiveDifficulty).toBe(card.objectiveDifficulty);
    expect(arg.language).toBe(card.language); // 'de'
    expect(arg.firstLearnedAt).toBe(card.firstLearnedAt);
    expect(arg.lastReviewAt).toBeGreaterThanOrEqual(card.lastReviewAt);
    expect(arg.due).toBeGreaterThan(0);
    expect(typeof arg.stability).toBe('number');
    expect(typeof arg.difficulty).toBe('number');
    expect(typeof arg.elapsedDays).toBe('number');
    expect(typeof arg.scheduledDays).toBe('number');
    expect(arg.reps).toBe(card.reps + 1);
    expect(arg.lapses).toBe(card.lapses);
    expect(['new', 'learning', 'review', 'relearning']).toContain(arg.status);
    expect(typeof arg.learningSteps).toBe('number');

    // 16 个键全部存在 (无字段丢失)
    const keys = Object.keys(arg).sort();
    expect(keys).toEqual(
      [
        'difficulty',
        'due',
        'elapsedDays',
        'firstLearnedAt',
        'id',
        'lapses',
        'language',
        'lastReviewAt',
        'learningSteps',
        'lemma',
        'lexemeGroupId',
        'objectiveDifficulty',
        'reps',
        'scheduledDays',
        'stability',
        'status',
      ].sort(),
    );
    expect(keys.length).toBe(16);
  });

  it('T07 [critical]: MemoryCardStore.getAllCards SQL 含 "ORDER BY due ASC" (源码断言)', () => {
    // vitest 不能直接运行 ArkTS .ets, 改为读源码字符串断言 SQL 模式.
    // SPEC 明确允许此策略: "改测 TS mirror ... 验证 SQL 查询字符串包含 ORDER BY due ASC"
    const etsPath = resolve(
      process.cwd(),
      'harmony/entry/src/main/ets/data/MemoryCardStore.ets',
    );
    expect(existsSync(etsPath)).toBe(true);
    const content = readFileSync(etsPath, 'utf-8');

    // 验证 getAllCards 方法体内 SQL 含 ORDER BY ... ASC 模式
    // 源码使用模板字面量 `ORDER BY ${COLUMN_DUE} ASC`
    expect(content).toMatch(/getAllCards[\s\S]*?ORDER BY[\s\S]*?ASC/);
    // 更精确: 验证使用 COLUMN_DUE 常量 (避免硬编码)
    expect(content).toMatch(/ORDER BY\s+\$\{COLUMN_DUE\}\s+ASC/);

    // 顺带验证 getRecentlyReviewedCards 使用 lastReviewAt DESC
    expect(content).toMatch(
      /getRecentlyReviewedCards[\s\S]*?ORDER BY\s+\$\{COLUMN_LAST_REVIEW_AT\}\s+DESC/,
    );
  });

  it('T08 [critical]: getTodayReviewStats 计算逻辑 (dueCount / reviewedCount / totalCount)', () => {
    // 鸿蒙端 .ets 无法直接测, 此处 TS 镜像其 SQL 逻辑:
    //   dueCount     = COUNT WHERE due <= now
    //   reviewedCount = COUNT WHERE lastReviewAt >= todayStart
    //   totalCount   = COUNT(*)
    // todayStart = new Date(now).setHours(0,0,0,0) (本地午夜)

    const now = new Date('2026-07-27T15:30:00').getTime();
    const todayStart = new Date(now).setHours(0, 0, 0, 0);

    // 验证 todayStart 是本地午夜
    const todayStartDate = new Date(todayStart);
    expect(todayStartDate.getHours()).toBe(0);
    expect(todayStartDate.getMinutes()).toBe(0);
    expect(todayStartDate.getSeconds()).toBe(0);
    expect(todayStartDate.getMilliseconds()).toBe(0);

    // Mock 6 条记录, 覆盖各分支:
    // - c1: due<=now + reviewed today (今日已复习 + 待复习)
    // - c2: due>now  + reviewed yesterday (未到期 + 昨天复习)
    // - c3: due<=now + lastReviewAt=0 (待复习 + 从未复习)
    // - c4: due>now  + reviewed today (未到期 + 今日已复习)
    // - c5: due<=now + reviewed today (第二张待复习 + 今日复习)
    // - c6: due>now  + reviewed 2 days ago (未到期 + 历史复习)
    const records: MemoryCardRecordBridge[] = [
      makeBridgeCard({
        id: 'c1',
        lexemeGroupId: 'g1',
        lemma: 'a',
        objectiveDifficulty: 1,
        due: now - 1000,
        lastReviewAt: now - 60_000,
      }),
      makeBridgeCard({
        id: 'c2',
        lexemeGroupId: 'g2',
        lemma: 'b',
        objectiveDifficulty: 1,
        due: now + 1000,
        lastReviewAt: now - 90_000_000, // 昨天
      }),
      makeBridgeCard({
        id: 'c3',
        lexemeGroupId: 'g3',
        lemma: 'c',
        objectiveDifficulty: 1,
        due: now - 2000,
        lastReviewAt: 0,
      }),
      makeBridgeCard({
        id: 'c4',
        lexemeGroupId: 'g4',
        lemma: 'd',
        objectiveDifficulty: 1,
        due: now + 2000,
        lastReviewAt: now - 30_000,
      }),
      makeBridgeCard({
        id: 'c5',
        lexemeGroupId: 'g5',
        lemma: 'e',
        objectiveDifficulty: 1,
        due: now - 500,
        lastReviewAt: now - 10_000,
      }),
      makeBridgeCard({
        id: 'c6',
        lexemeGroupId: 'g6',
        lemma: 'f',
        objectiveDifficulty: 1,
        due: now + 5000,
        lastReviewAt: now - 200_000_000, // 2 天前
      }),
    ];

    // 镜像 SQL 逻辑
    const dueCount = records.filter((r) => r.due <= now).length;
    const reviewedCount = records.filter(
      (r) => r.lastReviewAt >= todayStart,
    ).length;
    const totalCount = records.length;

    expect(dueCount).toBe(3); // c1, c3, c5
    expect(reviewedCount).toBe(3); // c1, c4, c5
    expect(totalCount).toBe(6);

    // 验证跨桥载荷形状 (原生侧 JSON.stringify(stats), Web 侧 JSON.parse)
    const raw: string = JSON.stringify({ dueCount, reviewedCount, totalCount });
    expect(JSON.parse(raw)).toEqual({ dueCount: 3, reviewedCount: 3, totalCount: 6 });

    // 边界: todayStart 与 now 的关系 — todayStart <= now < todayStart + 86400000
    expect(todayStart).toBeLessThanOrEqual(now);
    expect(now - todayStart).toBeLessThan(86_400_000);
  });

  it('T09: rateCard 在 harmonyBridge.upsertCard 抛错时不影响主流程 (fire-and-forget)', async () => {
    // critical=false: 此 case 守护 fire-and-forget + .catch silent skip 容错路径
    const stub = makeBridgeStub({
      upsertCard: vi.fn().mockRejectedValue(new Error('JSBridge upsert failure')),
    });
    (window as BridgeWindow).harmonyBridge = stub;

    const { useMemoryStore } = await import('../useMemoryStore');
    const card = makeCard({
      id: 'card-g1',
      lexemeGroupId: 'g1',
      lemma: 'apple',
      objectiveDifficulty: 2,
      status: 'review',
      due: 0,
      reps: 2,
    });
    useMemoryStore.setState({ cards: new Map([['g1', card]]) });

    // rateCard 同步调用不抛错 (upsertCard 的 rejection 被 .catch 兜底)
    expect(() => useMemoryStore.getState().rateCard('g1', 'good')).not.toThrow();

    // 等待 microtask 跑完 (含 rejected promise 的 .catch 处理)
    await new Promise((r) => setTimeout(r, 10));

    // upsertCard 确实被调用了 (且确实 rejected, 但不传播)
    expect(stub.upsertCard).toHaveBeenCalledTimes(1);
    await expect(stub.upsertCard.mock.results[0].value).rejects.toThrow(
      'JSBridge upsert failure',
    );

    // 卡片状态已更新 (rateCard 主流程未受 upsertCard 失败影响)
    const updated = useMemoryStore.getState().cards.get('g1');
    expect(updated).toBeDefined();
    expect(updated!.reps).toBe(card.reps + 1);
    expect(updated!.due).toBeGreaterThan(0);
  });
});
