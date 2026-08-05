/**
 * v0.1.0-harmony Stage 3: useMemoryStore.rateCard ↔ window.harmonyBridge 集成测试
 *
 * 覆盖 test_spec:
 * - T02 [critical]: window.harmonyBridge === undefined 时 rateCard 不抛错、不阻塞
 * - T03 [critical]: window.harmonyBridge 存在时 rateCard 后调用 registerReminder 一次 (mock)
 * - T04 [critical]: registerReminder 抛错时 rateCard 不传播 (try/catch + .catch)
 *
 * Mock 策略:
 * - T02: window.harmonyBridge = undefined (jsdom 默认 Web 环境), 调用 rateCard 断言不抛错
 * - T03: window.harmonyBridge = { registerReminder: vi.fn().mockResolvedValue(undefined) },
 *   调用 rateCard 断言 registerReminder 被调用 1 次, 参数含 { dueAt, cardId }
 * - T04: window.harmonyBridge = { registerReminder: vi.fn().mockRejectedValue(new Error()) },
 *   调用 rateCard 断言不抛错、卡片状态正常更新
 *
 * T01 (TS interface 类型检查) 由 tsc --noEmit 覆盖, 不在此文件测试.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoryCard } from '../../../types';
import type { HarmonyBridge } from '../../../platform/harmonyBridge';

type BridgeWindow = Window & { harmonyBridge?: HarmonyBridge };

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

const ORIGINAL_BRIDGE: HarmonyBridge | undefined = (window as BridgeWindow).harmonyBridge;

beforeEach(() => {
  // 每个测试前清理 localStorage + 模块缓存, 保证 store 重建
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

describe('v0.1.0-harmony Stage 3: rateCard ↔ harmonyBridge integration', () => {
  it('T02 [critical]: window.harmonyBridge === undefined 时 rateCard 不抛错、不阻塞', async () => {
    const { useMemoryStore } = await import('./useMemoryStore');
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

    // 确认 Web 环境: window.harmonyBridge === undefined
    expect((window as BridgeWindow).harmonyBridge).toBeUndefined();

    // rateCard 同步调用不抛错
    expect(() => useMemoryStore.getState().rateCard('g1', 'good')).not.toThrow();

    // 等待 microtask 跑完 (fire-and-forget promise 链)
    await new Promise((r) => setTimeout(r, 10));

    // 卡片状态已更新 (rateCard 主流程未阻塞, FSRS 调度正常)
    const updated = useMemoryStore.getState().cards.get('g1');
    expect(updated).toBeDefined();
    expect(updated!.reps).toBe(card.reps + 1);
    // due 应为 future timestamp (FSRS 调度后)
    expect(updated!.due).toBeGreaterThan(Date.now() - 60_000);
  });

  it('T03 [critical]: window.harmonyBridge 存在时 rateCard 后调用 registerReminder 一次', async () => {
    const registerReminder = vi.fn().mockResolvedValue(undefined);
    const bridgeStub: HarmonyBridge = {
      getDueCardsCount: () => Promise.resolve(0),
      registerReminder,
      readPreferences: () => Promise.resolve(null),
      writePreferences: () => Promise.resolve(undefined),
      triggerHapticFeedback: () => {},
    };
    (window as BridgeWindow).harmonyBridge = bridgeStub;

    const { useMemoryStore } = await import('./useMemoryStore');
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

    useMemoryStore.getState().rateCard('g1', 'good');

    // 等待 microtask 跑完 (让 fire-and-forget promise settle)
    await new Promise((r) => setTimeout(r, 10));

    // registerReminder 被调用恰好 1 次
    expect(registerReminder).toHaveBeenCalledTimes(1);

    // 参数为 { dueAt: number, cardId: string }
    // cardId 为 rateCard 的参数 (Map key = lexemeGroupId), 非卡片 id 字段
    const payload = registerReminder.mock.calls[0][0];
    expect(typeof payload.dueAt).toBe('number');
    expect(payload.cardId).toBe('g1');

    // dueAt 应等于更新后卡片的 due 时间 (FSRS 调度后的下次复习时间)
    const updatedCard = useMemoryStore.getState().cards.get('g1');
    expect(updatedCard).toBeDefined();
    expect(payload.dueAt).toBe(updatedCard!.due);
  });

  it('T04 [critical]: registerReminder 抛错时 rateCard 不传播 (try/catch)', async () => {
    const registerReminder = vi.fn().mockRejectedValue(new Error('JSBridge failure'));
    const bridgeStub: HarmonyBridge = {
      getDueCardsCount: () => Promise.resolve(0),
      registerReminder,
      readPreferences: () => Promise.resolve(null),
      writePreferences: () => Promise.resolve(undefined),
      triggerHapticFeedback: () => {},
    };
    (window as BridgeWindow).harmonyBridge = bridgeStub;

    const { useMemoryStore } = await import('./useMemoryStore');
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

    // rateCard 同步调用不抛错 (registerReminder 的 rejection 被 .catch 兜底)
    expect(() => useMemoryStore.getState().rateCard('g1', 'good')).not.toThrow();

    // 等待 microtask 跑完 (含 rejected promise 的 .catch 处理)
    await new Promise((r) => setTimeout(r, 10));

    // 卡片状态已更新 (rateCard 主流程未受 registerReminder 失败影响)
    const updated = useMemoryStore.getState().cards.get('g1');
    expect(updated).toBeDefined();
    expect(updated!.reps).toBe(card.reps + 1);

    // registerReminder 确实被调用了 (且确实 rejected, 但不传播)
    expect(registerReminder).toHaveBeenCalledTimes(1);
    // 确认 mock 确实 reject 了
    await expect(registerReminder.mock.results[0].value).rejects.toThrow('JSBridge failure');
  });
});
