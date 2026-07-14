import { create } from 'zustand';

/**
 * 应用级路由模式 (App.tsx 顶层状态机)
 *
 * - 'home': 主页 (默认)
 * - 'reading': 阅读会话页
 * - 'review': 复习会话页 (由 useReviewSessionStore.mode 触发)
 * - 'wordlist': 词表浏览页 (v1.6.0 Stage 2)
 *
 * v1.7.0 Stage 2: 状态由 useState 提升到 zustand store,
 * 以便 useUrlHashSync 与测试通过 getState() 访问.
 * 不持久化 (路由状态为运行时态, 避免刷新后停留在非首页).
 *
 * v2.1.0 Stage 1 (Contract 61): 增加 previousMode + recordPreviousMode + returnToPrevious.
 * 用于修复 "阅读 → 复习 → 阅读" 闭环断裂 (I1): 复习结束后可回到复习前的模式 (如 reading),
 * 而非强制回 home. previousMode 不入 URL hash (运行时态, useUrlHashSync 仅同步 currentMode).
 */
export type AppMode = 'home' | 'reading' | 'review' | 'wordlist';

/** AppMode 合法值集合 (用于 hash 解析校验) */
export const VALID_APP_MODES: ReadonlyArray<AppMode> = [
  'home',
  'reading',
  'review',
  'wordlist',
];

/** 默认 AppMode (初始 / fallback) */
export const DEFAULT_APP_MODE: AppMode = 'home';

interface AppModeState {
  currentMode: AppMode;
  /** v2.1.0: 复习前的来源模式, 用于 returnToPrevious 恢复. null 表示无记录. */
  previousMode: AppMode | null;
  setMode: (mode: AppMode) => void;
  /** v2.1.0: 显式记录当前模式为 previousMode (在进入复习前调用). */
  recordPreviousMode: () => void;
  /** v2.1.0: 回到 previousMode (若存在), 否则回 home. 清空 previousMode. */
  returnToPrevious: () => void;
  reset: () => void;
}

export const useAppModeStore = create<AppModeState>((set, get) => ({
  currentMode: DEFAULT_APP_MODE,
  previousMode: null,
  setMode: (mode) => set({ currentMode: mode }),
  recordPreviousMode: () => set({ previousMode: get().currentMode }),
  returnToPrevious: () => set({
    currentMode: get().previousMode ?? DEFAULT_APP_MODE,
    previousMode: null,
  }),
  reset: () => set({ currentMode: DEFAULT_APP_MODE, previousMode: null }),
}));
