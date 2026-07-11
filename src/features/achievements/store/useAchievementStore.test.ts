/**
 * useAchievementStore 持久化测试 (T03)
 *
 * 覆盖 test_spec:
 * - T03 [integration, critical]: useAchievementStore.newUnlocks 刷新后为空
 *   验证: 触发 checkAndUnlock 制造 newUnlocks → 模拟刷新 (重新创建 store)
 *         → newUnlocks === []
 *
 * 实现策略:
 * - 通过 checkAndUnlock 触发至少一个成就解锁 (用 first_session / totalSessions=1)
 * - 等待 persist 异步落盘
 * - vi.resetModules() + 动态 import 重建 store
 *   → 新 store 走 onRehydrateStorage, 只加载 achievements,
 *     newUnlocks 是初始值 []
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AchievementContext } from '../types';

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

describe('useAchievementStore persist (T03)', () => {
  it('T03: newUnlocks 刷新后为空 (volatile)', async () => {
    // 1. 创建 store, 触发 first_session (session_count=1)
    const { useAchievementStore } = await import('./useAchievementStore');
    const ctx: AchievementContext = {
      streak: 0,
      totalWords: 0,
      totalSessions: 1,
      languages: ['en'],
      masteredByLevel: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      completedCompounds: 0,
      lastSessionPerfect: false,
    };
    useAchievementStore.getState().checkAndUnlock(ctx);

    // 2. 断言 newUnlocks 至少有 1 个 (first_session)
    const before = useAchievementStore.getState().newUnlocks;
    expect(before.length).toBeGreaterThan(0);
    expect(before.some((u) => u.achievement.id === 'first_session')).toBe(true);

    // 3. 等待 persist 写 localStorage
    await new Promise((r) => setTimeout(r, 50));

    // 4. 确认 localStorage 中没有 newUnlocks 字段 (volatile 验证)
    const raw = window.localStorage.getItem('wordaydream:achievements');
    expect(raw).toBeDefined();
    const parsed = JSON.parse(raw!);
    expect(parsed.state.newUnlocks).toBeUndefined();

    // 5. 模拟刷新: resetModules + 重新 import
    vi.resetModules();
    const { useAchievementStore: fresh } = await import('./useAchievementStore');

    // 6. 断言 newUnlocks === [] (刷新后清空)
    expect(fresh.getState().newUnlocks).toEqual([]);

    // 7. 顺便验证 achievements 中已解锁的 first_session 仍然保留
    const freshAchievements = fresh.getState().achievements;
    const firstSession = freshAchievements.find((a) => a.id === 'first_session');
    expect(firstSession?.unlocked).toBe(true);
  });
});
