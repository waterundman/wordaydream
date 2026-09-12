/**
 * useShortcutsStore 测试 (v1.0.0 Stage 1)
 *
 * 覆盖 test_spec:
 * - T01: setRatingKey 正常设置 + getRatingKeyMap 派生正确 ('1'→'again' ...)
 * - T02: 评分互斥 — 把 again 设为 hard 当前键 '2' → 拒绝 {ok:false} 且 ratingKeys 不变
 * - T03: 保留键 'S'/'?'/' ' 与多字符 'F1' 全部拒绝 + resetRatingKeys 恢复默认
 * - T04 [critical]: persist — key 存在 + 重新创建 store 实例后 ratingKeys 保留 (rehydrate)
 *
 * 实现策略: 跟随 useWrongWordsStore.test.ts 的 persist 测法 —
 * 用 vi.resetModules() + 动态 import 模拟"刷新后 store 重建".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'wordaydream:shortcut-overrides';

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

describe('useShortcutsStore (Stage 1)', () => {
  describe('T01: setRatingKey 正常设置 + 派生', () => {
    it('T01: 重设 good→"g" 后 ratingKeys 更新且 getRatingKeyMap 派生正确', async () => {
      const { useShortcutsStore, getRatingKeyMap } = await import('./useShortcutsStore');

      const result = useShortcutsStore.getState().setRatingKey('good', 'g');
      expect(result.ok).toBe(true);

      const { ratingKeys } = useShortcutsStore.getState();
      expect(ratingKeys.again).toBe('1');
      expect(ratingKeys.hard).toBe('2');
      expect(ratingKeys.good).toBe('g');
      expect(ratingKeys.easy).toBe('4');

      // 派生: '1'→'again', 'g'→'good'
      const map = getRatingKeyMap();
      expect(map['1']).toBe('again');
      expect(map['2']).toBe('hard');
      expect(map['g']).toBe('good');
      expect(map['4']).toBe('easy');
    });
  });

  describe('T02: 评分互斥', () => {
    it('T02: again 设为 hard 当前键 "2" → 拒绝 {ok:false} 且 ratingKeys 不变', async () => {
      const { useShortcutsStore } = await import('./useShortcutsStore');
      const before = { ...useShortcutsStore.getState().ratingKeys };
      expect(before).toEqual({ again: '1', hard: '2', good: '3', easy: '4' });

      const result = useShortcutsStore.getState().setRatingKey('again', before.hard);
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('hard');

      // 不覆盖旧值
      expect(useShortcutsStore.getState().ratingKeys).toEqual(before);
    });
  });

  describe('T03: 保留键 / 多字符 拒绝 + reset', () => {
    it('T03: 保留键 S/?/空格 与多字符 F1 全部拒绝; resetRatingKeys 恢复默认', async () => {
      const { useShortcutsStore } = await import('./useShortcutsStore');

      for (const bad of ['S', '?', ' ', 'F1']) {
        const r = useShortcutsStore.getState().setRatingKey('again', bad);
        expect(r.ok).toBe(false);
        expect(r.reason).toBeDefined();
      }
      // 全部拒绝后 ratingKeys 仍是默认
      expect(useShortcutsStore.getState().ratingKeys).toEqual({
        again: '1',
        hard: '2',
        good: '3',
        easy: '4',
      });

      // 改一个键再 reset
      useShortcutsStore.getState().setRatingKey('easy', 'z');
      expect(useShortcutsStore.getState().ratingKeys.easy).toBe('z');
      useShortcutsStore.getState().resetRatingKeys();
      expect(useShortcutsStore.getState().ratingKeys).toEqual({
        again: '1',
        hard: '2',
        good: '3',
        easy: '4',
      });
    });
  });

  describe('T04 [critical]: persist 往返', () => {
    it('T04: localStorage key 存在 + 重建实例后 ratingKeys 保留', async () => {
      const { useShortcutsStore } = await import('./useShortcutsStore');

      useShortcutsStore.getState().setRatingKey('easy', '9');
      expect(useShortcutsStore.getState().ratingKeys.easy).toBe('9');

      // 等待 persist 异步落盘
      await new Promise((r) => setTimeout(r, 50));

      // 1) key 存在
      const raw = window.localStorage.getItem(STORAGE_KEY);
      expect(raw).not.toBeNull();

      // 2) 模拟刷新: resetModules + 重新 import → 从 localStorage rehydrate
      vi.resetModules();
      const reloaded = await import('./useShortcutsStore');
      const fresh = reloaded.useShortcutsStore;

      expect(fresh.getState().ratingKeys).toEqual({
        again: '1',
        hard: '2',
        good: '3',
        easy: '9',
      });
    });
  });
});
