/**
 * 成就 store (Zustand + persist)
 *
 * 状态:
 * - `achievements`: 全部 13 个成就的当前快照 (含 unlocked / unlockedAt)
 * - `newUnlocks`: 本次会话内新解锁的成就队列, 用于 toast 提示
 *
 * 持久化策略:
 * - 使用 Zustand 官方 `persist` 中间件 + `partialize` 仅持久化 `achievements`
 * - `newUnlocks` 不持久化, 页面刷新后自动清空 (符合"新解锁 toast 不跨会话"语义)
 * - `onRehydrateStorage`: 持久化的 achievements 为空数组时自动注入 `ALL_ACHIEVEMENTS` 默认列表
 *
 * v0.4.0-harmony Stage 4 (D4): checkAndUnlock 内部 evaluate + set 包装到
 * scheduleIdleTask, 让成就评估在浏览器空闲时段执行, 不阻塞用户交互主线.
 * - 函数签名保持 (ctx) => void 不变, 调用方无感知
 * - 测试需要 await setTimeout(0) 让 idle task 落地后再断言副作用
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Achievement, AchievementContext, AchievementUnlock } from '../types';
import { ALL_ACHIEVEMENTS, evaluate } from '../services/achievementEngine';
import { scheduleIdleTask } from '../../../platform/scheduleIdleTask';

interface AchievementState {
  achievements: Achievement[];
  newUnlocks: AchievementUnlock[];

  /**
   * 评估 context 并把新解锁的成就合并入 `achievements` 和 `newUnlocks`。
   * 内部基于 `evaluate` 的去重逻辑, 重复调用不会产生重复解锁事件。
   */
  checkAndUnlock: (ctx: AchievementContext) => void;

  /**
   * 从 `newUnlocks` 队列中移除指定 id 的 toast,
   * UI 在 toast 关闭 / 动画结束时调用。
   */
  dismissToast: (id: string) => void;

  /** 重置为初始状态 (清空所有解锁, 恢复默认列表) */
  reset: () => void;
}

const SCHEMA_VERSION = 1;

/**
 * 初始 achievements 列表
 *
 * 用 ALL_ACHIEVEMENTS 的浅拷贝作为默认状态, 避免后续引擎改动时
 * 反向影响已持久化的旧数据。
 */
const initialAchievements: Achievement[] = ALL_ACHIEVEMENTS.map((a) => ({ ...a }));

export const useAchievementStore = create<AchievementState>()(
  persist(
    (set, get) => ({
      achievements: initialAchievements,
      newUnlocks: [],

      checkAndUnlock: (ctx: AchievementContext) => {
        // v0.4.0-harmony Stage 4 (D4): evaluate + set 整体调度到 idle 时段执行,
        // 避免成就引擎在用户操作 (loadSession / nextCard / recordReview) 的关键路径
        // 上同步阻塞主线程. 函数签名保持 (ctx) => void 不变, 调用方无感知.
        // 副作用 (achievements 更新 / newUnlocks 入队 / persist 落盘) 在 idle
        // 回调内同步完成, 不存在部分写入的中间态.
        scheduleIdleTask(() => {
          const unlocks = evaluate(ctx, get().achievements);
          if (unlocks.length === 0) return;
          const unlockedIds = new Set(unlocks.map((u) => u.achievement.id));
          set((state) => ({
            achievements: state.achievements.map((a) =>
              unlockedIds.has(a.id)
                ? { ...a, unlocked: true, unlockedAt: Date.now() }
                : a,
            ),
            newUnlocks: [...state.newUnlocks, ...unlocks],
          }));
        });
      },

      dismissToast: (id: string) => {
        set((state) => ({
          newUnlocks: state.newUnlocks.filter((u) => u.achievement.id !== id),
        }));
      },

      reset: () => set({ achievements: initialAchievements, newUnlocks: [] }),
    }),
    {
      name: 'wordaydream:achievements',
      version: SCHEMA_VERSION,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ achievements: state.achievements }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // 首次加载 / reset 后持久化数据为 [] -> 注入 ALL_ACHIEVEMENTS 初始列表
        if (!Array.isArray(state.achievements) || state.achievements.length === 0) {
          state.achievements = initialAchievements;
        }
      },
    },
  ),
);
