/**
 * useStreakStore 持久化测试 (T04)
 *
 * 覆盖 test_spec:
 * - T04 [integration, critical]: useStreakStore 刷新后 currentStreak 保留
 *   验证: setState currentStreak=5 → save → 重新创建 store → currentStreak === 5
 *
 * 实现策略:
 * - 直接 setState 写入 currentStreak=5
 * - 等待 persist 异步落盘
 * - vi.resetModules() + 动态 import 重建 store
 * - 断言 currentStreak === 5
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('useStreakStore persist (T04)', () => {
  it('T04: currentStreak 刷新后保留 (=== 5)', async () => {
    // 1. 创建 store, 写入 currentStreak=5
    const { useStreakStore } = await import('./useStreakStore');
    useStreakStore.setState({
      currentStreak: 5,
      longestStreak: 7,
      lastStudyDate: '2026-07-09',
    });

    // 2. 等待 persist 写 localStorage
    await new Promise((r) => setTimeout(r, 50));

    // 3. 模拟刷新
    vi.resetModules();
    const { useStreakStore: fresh } = await import('./useStreakStore');

    // 4. 断言 currentStreak === 5
    expect(fresh.getState().currentStreak).toBe(5);
    expect(fresh.getState().longestStreak).toBe(7);
    expect(fresh.getState().lastStudyDate).toBe('2026-07-09');
  });
});
