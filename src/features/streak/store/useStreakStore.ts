/**
 * 连续学习天数 store (Zustand + persist)
 *
 * 阶段 2 触发层: 与 `useAchievementStore.checkAndUnlock` 配合, 在每次
 * 阅读会话开始时 (`loadSession`) 调用 `recordDay()`, 累计 `currentStreak`
 * 并暴露给成就引擎作为 `ctx.streak`。
 *
 * 持久化策略 (与项目其他 store 一致):
 * - 使用自定义 `lib/persistenceMiddleware` (load-only)
 * - 启动时从 localStorage 读取 `wordaydream:streak`
 * - 状态全部为简单原始值, 无需 serialize / deserialize
 *
 * 日期算法说明:
 * - `today()` 返回本地时区的 `YYYY-MM-DD`
 * - `daysBetween(a, b)` 通过 `Date(y, m-1, d)` 构造本地时间, 然后
 *   用毫秒差除以 86400000 取整, 自动忽略时分秒, 避免 DST 边界误差
 *   (用 `Math.round` 处理 ±1 小时偏差)
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface StreakState {
  lastStudyDate: string | null;
  currentStreak: number;
  longestStreak: number;
  recordDay: () => void;
  reset: () => void;
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  const da = new Date(ay, am - 1, ad);
  const db = new Date(by, bm - 1, bd);
  return Math.round((db.getTime() - da.getTime()) / 86400000);
}

export const useStreakStore = create<StreakState>()(
  persist(
    (set, get) => ({
      lastStudyDate: null,
      currentStreak: 0,
      longestStreak: 0,
      recordDay: () => {
        const t = today();
        const { lastStudyDate, currentStreak, longestStreak } = get();
        if (lastStudyDate === t) return;
        if (lastStudyDate && daysBetween(lastStudyDate, t) === 1) {
          const newCurrent = currentStreak + 1;
          set({
            lastStudyDate: t,
            currentStreak: newCurrent,
            longestStreak: Math.max(longestStreak, newCurrent),
          });
        } else {
          set({
            lastStudyDate: t,
            currentStreak: 1,
            longestStreak: Math.max(longestStreak, 1),
          });
        }
      },
      reset: () => set({ lastStudyDate: null, currentStreak: 0, longestStreak: 0 }),
    }),
    {
      name: 'wordaydream:streak',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // v1.5.2 fix L3: 占位 migrate, 未来 schema bump 需补真实迁移逻辑.
      migrate: (persistedState) => persistedState,
    },
  ),
);
