/**
 * v2.0.0 Stage 2: 事件总线 — 消除 useMemoryStore → useWordlistStore 循环依赖.
 *
 * useMemoryStore 发布 'memory:cards-updated' 事件, useWordlistStore 订阅.
 * 同步分发 (不 fire-and-forget), 确保订阅方在同一 tick 处理.
 * 0 新依赖 (纯 Set<Listener> 实现).
 *
 * v2.1.0 Stage 2 (Contract 63): 扩展 'reading:completed' 事件.
 * useReadingHistoryStore.completeEntry 在阅读完成时发布,
 * payload 包含 entryId / passageId / language / difficulty,
 * 供订阅方 (如 ReviewPromptBanner, TodayCard) 响应阅读完成.
 */

export interface MemoryCardsUpdatedPayload {
  cards: Map<string, import('../types').MemoryCard>;
  isReview: boolean;
}

/**
 * v2.1.0 Stage 2 (Contract 63): 'reading:completed' 事件 payload.
 * 由 useReadingHistoryStore.completeEntry 发布.
 * - entryId: 历史 entry 的唯一 ID
 * - passageId: 完成阅读的 Passage ID (来自 HistoryEntry.passage.id)
 * - language / difficulty: 会话配置 (供订阅方按语言/难度过滤)
 */
export interface ReadingCompletedPayload {
  entryId: string;
  passageId: string;
  language: import('../types').Language;
  difficulty: import('../types').DifficultyLevel;
}

type EventName = 'memory:cards-updated' | 'reading:completed';
type Listener<T> = (payload: T) => void;

const listeners: Map<EventName, Set<Listener<unknown>>> = new Map();

/** 订阅事件. 返回取消订阅函数. */
export function subscribe<T>(event: EventName, listener: Listener<T>): () => void {
  if (!listeners.has(event)) {
    listeners.set(event, new Set());
  }
  const set = listeners.get(event)!;
  set.add(listener as Listener<unknown>);
  return () => {
    set.delete(listener as Listener<unknown>);
  };
}

/** 发布事件 (同步分发, 不 fire-and-forget). */
export function publish<T>(event: EventName, payload: T): void {
  const set = listeners.get(event);
  if (!set) return;
  for (const listener of set) {
    try {
      (listener as Listener<T>)(payload);
    } catch (err) {
      // 事件回调错误不影响发布方 (useMemoryStore 写入)
      console.error(`[events] listener error for "${event}":`, err);
    }
  }
}

/** 清除所有监听器 (仅测试用). */
export function clearAllListeners(): void {
  listeners.clear();
}
