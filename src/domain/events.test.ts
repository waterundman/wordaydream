/**
 * events.ts 事件总线测试 (v2.1.0 Stage 2, Contract 63)
 *
 * 覆盖 test_spec:
 * - T7a [unit]: subscribe('reading:completed') + publish → listener 收到 payload
 * - T7b [unit]: subscribe 返回的 unsubscribe 函数调用后不再收到事件
 * - T7c [unit]: publish 无订阅者时 no-op (不抛错)
 * - T7d [unit]: 'memory:cards-updated' 与 'reading:completed' 事件互不干扰
 * - T7e [unit]: listener 抛错不影响其他 listener 和发布方
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  subscribe,
  publish,
  clearAllListeners,
  type ReadingCompletedPayload,
  type MemoryCardsUpdatedPayload,
} from './events';

beforeEach(() => {
  clearAllListeners();
});

afterEach(() => {
  clearAllListeners();
});

describe('events.ts v2.1.0 Stage 2 (Contract 63)', () => {
  describe('T7: reading:completed 事件', () => {
    it('T7a: subscribe + publish → listener 收到 payload', () => {
      const received: ReadingCompletedPayload[] = [];
      subscribe<ReadingCompletedPayload>('reading:completed', (p) => received.push(p));

      const payload: ReadingCompletedPayload = {
        entryId: 'h-1',
        passageId: 'passage-en-2',
        language: 'en',
        difficulty: 2,
      };
      publish('reading:completed', payload);

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual(payload);
    });

    it('T7b: unsubscribe 后不再收到事件', () => {
      const received: ReadingCompletedPayload[] = [];
      const unsubscribe = subscribe<ReadingCompletedPayload>('reading:completed', (p) => received.push(p));

      unsubscribe();
      publish('reading:completed', {
        entryId: 'h-2',
        passageId: 'p-2',
        language: 'de',
        difficulty: 3,
      });

      expect(received).toHaveLength(0);
    });

    it('T7c: publish 无订阅者时 no-op (不抛错)', () => {
      expect(() => {
        publish('reading:completed', {
          entryId: 'h-3',
          passageId: 'p-3',
          language: 'en',
          difficulty: 1,
        });
      }).not.toThrow();
    });

    it('T7d: memory:cards-updated 与 reading:completed 互不干扰', () => {
      const readingReceived: ReadingCompletedPayload[] = [];
      const memoryReceived: MemoryCardsUpdatedPayload[] = [];

      subscribe<ReadingCompletedPayload>('reading:completed', (p) => readingReceived.push(p));
      subscribe<MemoryCardsUpdatedPayload>('memory:cards-updated', (p) => memoryReceived.push(p));

      publish('reading:completed', {
        entryId: 'h-4',
        passageId: 'p-4',
        language: 'en',
        difficulty: 2,
      });
      publish('memory:cards-updated', {
        cards: new Map(),
        isReview: false,
      });

      expect(readingReceived).toHaveLength(1);
      expect(memoryReceived).toHaveLength(1);
    });

    it('T7e: listener 抛错不影响其他 listener 和发布方', () => {
      const goodListener = vi.fn();
      const badListener = vi.fn(() => {
        throw new Error('listener error');
      });

      subscribe<ReadingCompletedPayload>('reading:completed', badListener);
      subscribe<ReadingCompletedPayload>('reading:completed', goodListener);

      expect(() => {
        publish('reading:completed', {
          entryId: 'h-5',
          passageId: 'p-5',
          language: 'en',
          difficulty: 1,
        });
      }).not.toThrow();

      // 两个 listener 都被调用 (bad 抛错不阻断 good)
      expect(badListener).toHaveBeenCalledTimes(1);
      expect(goodListener).toHaveBeenCalledTimes(1);
    });
  });
});
