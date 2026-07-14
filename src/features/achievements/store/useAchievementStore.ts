/**
 * 成就 store (Zustand + persist)
 *
 * 状态:
 * - `achievements`: 全部 13 个成就的当前快照 (含 unlocked / unlockedAt)
 * - `newUnlocks`: 本次会话内新解锁的成就队列, 用于 toast 提示
 *
 * 持久化策略 (与项目现有 useMemoryStore / useSettingsStore 保持一致):
 * - 使用自定义 `lib/persistenceMiddleware` (load-only):
 *   - 启动时从 localStorage 读取 `wordaydream:achievements`
 *   - `serialize` 仅写入 `achievements`; `newUnlocks` 不写入
 *   - 页面刷新后 `newUnlocks` 自动清空 (符合"新解锁 toast 不跨会话"语义)
 *   - 持久化的 achievements 为空数组时, 自动注入 `ALL_ACHIEVEMENTS` 默认列表
 *
 * 注意: 该 middleware 不支持官方 Zustand 的 `partialize` / `onRehydrateStorage`,
 * 本 store 已用 `serialize` / `deserialize` 实现等价的字段筛选与首次注入行为。
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Achievement, AchievementContext, AchievementUnlock } from '../types';
import { ALL_ACHIEVEMENTS, evaluate } from '../services/achievementEngine';

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
