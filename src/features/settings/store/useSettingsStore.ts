import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { LLMSettings, LLMProvider, DifficultyLevel } from '../../../types';

/**
 * v0.4.0-harmony Stage 3 (D3): testProviderConnection / resetProviderCache
 * 改为动态 import (函数内 lazy), 断开 useSettingsStore → router → jsonParser/llmConfig
 * 的静态依赖链. 这样 zod / jsonrepair 不再进入首屏 bundle, 仅在用户实际触发
 * (testConnection / 切换 provider / importSettings / resetAll) 时才加载 router chunk.
 *
 * 之前: App.tsx → useSettingsStore → router (static) → jsonParser → zod/jsonrepair (首屏)
 * 现在: App.tsx → useSettingsStore (无 router 静态依赖); router 在调用时按需 import.
 */
async function loadRouter() {
  const mod = await import('../../llm/services/router');
  return { testProviderConnection: mod.testProviderConnection, resetProviderCache: mod.resetProviderCache };
}

/** v1.5.2 Stage 1: 主题类型 (D-3: light / dark / sepia) */
export type Theme = 'light' | 'dark' | 'sepia';

/** v1.5.2 Stage 1: 主题合法值集合 (用于校验 import / 旧 localStorage 数据) */
const VALID_THEMES: ReadonlyArray<Theme> = ['light', 'dark', 'sepia'];
const DEFAULT_THEME: Theme = 'light';

function normalizeTheme(value: unknown): Theme {
  return VALID_THEMES.includes(value as Theme) ? (value as Theme) : DEFAULT_THEME;
}

/** v0.1.0-harmony Stage 7: 复习提醒通知设置 (鸿蒙端 notificationManager). */
export interface NotificationSettings {
  /** 是否启用复习到期提醒. */
  enabled: boolean;
  /** 允许通知的开始小时 (0-23), 默认 8 (08:00). */
  startHour: number;
  /** 允许通知的结束小时 (0-23), 默认 22 (22:00). */
  endHour: number;
}

/** Stage 7: 通知默认配置. Web 端持久化但不生效 (SettingsPanel 隐藏). */
const DEFAULT_NOTIFICATIONS: NotificationSettings = {
  enabled: true,
  startHour: 8,
  endHour: 22,
};

function normalizeNotifications(value: unknown): NotificationSettings {
  if (value === null || typeof value !== 'object') {
    return { ...DEFAULT_NOTIFICATIONS };
  }
  const raw = value as Record<string, unknown>;
  const enabled: boolean =
    typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_NOTIFICATIONS.enabled;
  const startHour: number =
    typeof raw.startHour === 'number' && raw.startHour >= 0 && raw.startHour <= 23
      ? Math.floor(raw.startHour)
      : DEFAULT_NOTIFICATIONS.startHour;
  const endHour: number =
    typeof raw.endHour === 'number' && raw.endHour >= 0 && raw.endHour <= 23
      ? Math.floor(raw.endHour)
      : DEFAULT_NOTIFICATIONS.endHour;
  return { enabled, startHour, endHour };
}

interface SettingsState {
  llm: LLMSettings;
  /** 当前难度等级 (Stage 4: 难度建议接入) */
  difficulty: DifficultyLevel;
  /** v1.5.2 Stage 1: 当前主题 (light / dark / sepia) */
  theme: Theme;
  settingsOpen: boolean;
  isTesting: boolean;
  testResult: { ok: boolean; error?: string; at: number } | null;
  /** v1.5.2 Stage 2: 今日累计阅读秒数 (Contract 28 NEW / D-2) */
  totalSecondsToday: number;
  /** v1.5.2 Stage 2: 最近一次阅读会话的 ISO 日期 yyyy-mm-dd (跨日重置锚点) */
  lastSessionDate: string | null;
  /** v1.8.0 Stage 1: 优化后的 FSRS weights (undefined = 用默认, Contract 39) */
  fsrsWeights?: number[];
  /** v1.8.0 Stage 1: 优化前备份 (用于回滚, Contract 39) */
  fsrsWeightsBackup?: number[];
  /** v0.1.0-harmony Stage 7: 复习提醒通知设置 (鸿蒙端 notificationManager). */
  notifications: NotificationSettings;

  setProvider: (provider: LLMProvider) => void;
  setModel: (model: string) => void;
  setTemperature: (temp: number) => void;
  setEnabled: (enabled: boolean) => void;
  setTimeoutValue: (timeout: number) => void;
  setMaxRetries: (retries: number) => void;
  setStreaming: (streaming: boolean) => void;
  /** v1.2.0: 设置 JSON 解析重试次数 (clamp 1-5) */
  setJsonMaxAttempts: (attempts: number) => void;
  /** Stage 4: 修改当前难度等级 (clamp 1-5) */
  setDifficulty: (level: DifficultyLevel) => void;
  /** v1.5.2 Stage 1: 切换主题 (light / dark / sepia) */
  setTheme: (theme: Theme) => void;
  /** v1.5.2 Stage 2: 累计今日阅读秒数 (delta 通常为 1, 来自 setInterval) */
  incrementReadingSeconds: (delta: number) => void;
  /** v1.5.2 Stage 2: 跨日重置: 当 today 与 lastSessionDate 不一致时, 清零 totalSecondsToday */
  resetTodayIfNewDay: (today: string) => void;
  /** v0.1.0-harmony Stage 7: 更新通知设置 (partial merge). */
  setNotifications: (updates: Partial<NotificationSettings>) => void;
  openSettings: () => void;
  closeSettings: () => void;
  testConnection: () => Promise<{ ok: boolean; error?: string }>;
  resetAll: () => void;
  exportSettings: () => string;
  importSettings: (json: string) => boolean;
}

/** v1.2.0: JSON 解析最大尝试次数的合法范围 */
const MIN_JSON_ATTEMPTS = 1;
const MAX_JSON_ATTEMPTS = 5;
const DEFAULT_JSON_ATTEMPTS = 3;

const defaultLLM: LLMSettings = {
  provider: 'mock',
  model: '',
  temperature: 0.5,
  enabled: true,
  timeout: 30,
  maxRetries: 2,
  streaming: false,
  jsonMaxAttempts: DEFAULT_JSON_ATTEMPTS,
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      llm: defaultLLM,
      difficulty: 2,
      theme: DEFAULT_THEME,
      settingsOpen: false,
      isTesting: false,
      testResult: null,
      totalSecondsToday: 0,
      lastSessionDate: null,
      fsrsWeights: undefined,
      fsrsWeightsBackup: undefined,
      notifications: { ...DEFAULT_NOTIFICATIONS },

      setProvider: (provider) => {
        set((s) => ({ llm: { ...s.llm, provider } }));
        // v0.4.0-harmony Stage 3 (D3): 动态 import router, 不阻塞首屏.
        void loadRouter().then((m) => m.resetProviderCache());
      },
      setModel: (model) => set((s) => ({ llm: { ...s.llm, model } })),
      setTemperature: (temperature) => set((s) => ({ llm: { ...s.llm, temperature } })),
      setEnabled: (enabled) => set((s) => ({ llm: { ...s.llm, enabled } })),
      setTimeoutValue: (timeout) => set((s) => ({ llm: { ...s.llm, timeout } })),
      setMaxRetries: (maxRetries) => set((s) => ({ llm: { ...s.llm, maxRetries } })),
      setStreaming: (streaming) => set((s) => ({ llm: { ...s.llm, streaming } })),
      setJsonMaxAttempts: (attempts) => {
        const clamped = Math.max(
          MIN_JSON_ATTEMPTS,
          Math.min(MAX_JSON_ATTEMPTS, Math.floor(attempts) || DEFAULT_JSON_ATTEMPTS)
        );
        set((s) => ({ llm: { ...s.llm, jsonMaxAttempts: clamped } }));
      },
      setDifficulty: (level) => {
        const clamped = Math.max(1, Math.min(5, level)) as DifficultyLevel;
        set({ difficulty: clamped });
      },
      setTheme: (theme) => {
        set({ theme: normalizeTheme(theme) });
      },
      incrementReadingSeconds: (delta) => {
        const safeDelta = Math.max(0, Math.floor(delta) || 0);
        set((s) => ({ totalSecondsToday: s.totalSecondsToday + safeDelta }));
      },
      resetTodayIfNewDay: (today) => {
        if (!today) return;
        if (get().lastSessionDate !== today) {
          set({ totalSecondsToday: 0, lastSessionDate: today });
        }
      },

      setNotifications: (updates) => {
        set((s) => ({
          notifications: normalizeNotifications({ ...s.notifications, ...updates }),
        }));
      },

      openSettings: () => set({ settingsOpen: true }),
      closeSettings: () => set({ settingsOpen: false }),

      testConnection: async () => {
        set({ isTesting: true });
        // v0.4.0-harmony Stage 3 (D3): 动态 import router, 不阻塞首屏.
        const { testProviderConnection } = await loadRouter();
        const result = await testProviderConnection(get().llm);
        set({ isTesting: false, testResult: { ...result, at: Date.now() } });
        return result;
      },

      resetAll: () => {
        set({
          llm: defaultLLM,
          difficulty: 2,
          theme: DEFAULT_THEME,
          testResult: null,
          totalSecondsToday: 0,
          lastSessionDate: null,
          fsrsWeights: undefined,
          fsrsWeightsBackup: undefined,
          notifications: { ...DEFAULT_NOTIFICATIONS },
        });
        // v0.4.0-harmony Stage 3 (D3): 动态 import router, 不阻塞首屏.
        void loadRouter().then((m) => m.resetProviderCache());
      },

      exportSettings: () => {
        const { llm } = get();
        const exportData = {
          version: 1,
          timestamp: Date.now(),
          llm: {
            provider: llm.provider,
            model: llm.model,
            temperature: llm.temperature,
            enabled: llm.enabled,
          },
        };
        return JSON.stringify(exportData, null, 2);
      },

      importSettings: (json: string) => {
        try {
          const data = JSON.parse(json);
          if (data.version !== 1) {
            return false;
          }
          if (!data.llm) {
            return false;
          }

          const { llm } = data;
          // v2.1.1 Stage 3 (D3): 校验列表收窄为 4 个值, 拒绝 kimi/qwen/minimax
          if (!['mock', 'openai', 'anthropic', 'deepseek'].includes(llm.provider)) {
            return false;
          }

          set({
            llm: {
              ...defaultLLM,
              provider: llm.provider,
              model: llm.model || '',
              temperature: typeof llm.temperature === 'number' ? llm.temperature : 0.5,
              enabled: llm.enabled !== undefined ? llm.enabled : true,
            },
            testResult: null,
          });

          // v0.4.0-harmony Stage 3 (D3): 动态 import router, 不阻塞首屏.
          void loadRouter().then((m) => m.resetProviderCache());
          return true;
        } catch {
          return false;
        }
      },
    }),
    {
      name: 'wordaydream:settings',
      // v0.1.0-harmony Stage 7: bump version 7 → 8, 配合 notifications 字段注入迁移
      version: 8,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        llm: state.llm,
        difficulty: state.difficulty,
        theme: state.theme,
        totalSecondsToday: state.totalSecondsToday,
        lastSessionDate: state.lastSessionDate,
        fsrsWeights: state.fsrsWeights,
        fsrsWeightsBackup: state.fsrsWeightsBackup,
        notifications: state.notifications,
      }),
      migrate: (persistedState, fromVersion) => {
        const base = (persistedState ?? {}) as Record<string, unknown>;
        // v1/v2 -> v3: 旧 localStorage 没有 theme 字段, 默认 light
        if (fromVersion < 3) {
          return {
            ...base,
            llm: base.llm,
            difficulty: base.difficulty ?? 2,
            theme: normalizeTheme(base.theme),
          };
        }
        // v3 -> v4 (Contract 28 NEW / D-2): 注入阅读时长统计字段, 透传 theme / llm / difficulty
        if (fromVersion < 4) {
          return {
            ...base,
            llm: base.llm,
            difficulty: base.difficulty ?? 2,
            theme: normalizeTheme(base.theme),
            totalSecondsToday:
              typeof base.totalSecondsToday === 'number'
                ? base.totalSecondsToday
                : 0,
            lastSessionDate:
              typeof base.lastSessionDate === 'string'
                ? base.lastSessionDate
                : null,
          };
        }
        // v4 -> v5 (Contract 39): 注入 FSRS weights 字段, undefined = 用默认
        if (fromVersion < 5) {
          return {
            ...base,
            llm: base.llm,
            difficulty: base.difficulty ?? 2,
            theme: normalizeTheme(base.theme),
            totalSecondsToday:
              typeof base.totalSecondsToday === 'number'
                ? base.totalSecondsToday
                : 0,
            lastSessionDate:
              typeof base.lastSessionDate === 'string'
                ? base.lastSessionDate
                : null,
            fsrsWeights: Array.isArray(base.fsrsWeights)
              ? (base.fsrsWeights as number[])
              : undefined,
            fsrsWeightsBackup: Array.isArray(base.fsrsWeightsBackup)
              ? (base.fsrsWeightsBackup as number[])
              : undefined,
          };
        }
        // v5 -> v6 (v2.1.1 Stage 3 / D3): 收窄 LLMProvider 类型,
        // 旧 provider kimi/qwen/minimax → mock + enabled=false (避免 LLM 路由误判).
        if (fromVersion < 6) {
          const llm = (base.llm ?? {}) as Record<string, unknown>;
          const oldProvider = llm.provider;
          const deprecatedProviders = ['kimi', 'qwen', 'minimax'];
          if (typeof oldProvider === 'string' && deprecatedProviders.includes(oldProvider)) {
            return {
              ...base,
              llm: { ...llm, provider: 'mock', enabled: false },
              difficulty: base.difficulty ?? 2,
              theme: normalizeTheme(base.theme),
              totalSecondsToday:
                typeof base.totalSecondsToday === 'number' ? base.totalSecondsToday : 0,
              lastSessionDate:
                typeof base.lastSessionDate === 'string' ? base.lastSessionDate : null,
              fsrsWeights: Array.isArray(base.fsrsWeights)
                ? (base.fsrsWeights as number[])
                : undefined,
              fsrsWeightsBackup: Array.isArray(base.fsrsWeightsBackup)
                ? (base.fsrsWeightsBackup as number[])
                : undefined,
            };
          }
          return {
            ...base,
            llm,
            difficulty: base.difficulty ?? 2,
            theme: normalizeTheme(base.theme),
            totalSecondsToday:
              typeof base.totalSecondsToday === 'number' ? base.totalSecondsToday : 0,
            lastSessionDate:
              typeof base.lastSessionDate === 'string' ? base.lastSessionDate : null,
            fsrsWeights: Array.isArray(base.fsrsWeights)
              ? (base.fsrsWeights as number[])
              : undefined,
            fsrsWeightsBackup: Array.isArray(base.fsrsWeightsBackup)
              ? (base.fsrsWeightsBackup as number[])
              : undefined,
          };
        }
        // v6 -> v7 (v2.1.1 Stage 4 / D2): 移除 LLMSettings.apiKey/baseUrl 字段.
        // v1.3.0 proxy 架构迁移后这两个字段已无意义, 清理旧持久化数据.
        if (fromVersion < 7) {
          const llm = (base.llm ?? {}) as Record<string, unknown>;
          // 删除旧的 apiKey/baseUrl 字段 (如果存在)
          delete llm.apiKey;
          delete llm.baseUrl;
          return {
            ...base,
            llm,
            difficulty: base.difficulty ?? 2,
            theme: normalizeTheme(base.theme),
            totalSecondsToday:
              typeof base.totalSecondsToday === 'number' ? base.totalSecondsToday : 0,
            lastSessionDate:
              typeof base.lastSessionDate === 'string' ? base.lastSessionDate : null,
            fsrsWeights: Array.isArray(base.fsrsWeights)
              ? (base.fsrsWeights as number[])
              : undefined,
            fsrsWeightsBackup: Array.isArray(base.fsrsWeightsBackup)
              ? (base.fsrsWeightsBackup as number[])
              : undefined,
            notifications: normalizeNotifications(base.notifications),
          };
        }
        // v7 -> v8 (v0.1.0-harmony Stage 7): 注入 notifications 默认值.
        // 旧持久化数据 (v7) 无 notifications 字段, 注入默认 { enabled:true, startHour:8, endHour:22 };
        // 若已有 (向前兼容), 用 normalizeNotifications 校验并兜底. 其他字段透传.
        if (fromVersion < 8) {
          return {
            ...base,
            llm: base.llm,
            difficulty: base.difficulty ?? 2,
            theme: normalizeTheme(base.theme),
            totalSecondsToday:
              typeof base.totalSecondsToday === 'number' ? base.totalSecondsToday : 0,
            lastSessionDate:
              typeof base.lastSessionDate === 'string' ? base.lastSessionDate : null,
            fsrsWeights: Array.isArray(base.fsrsWeights)
              ? (base.fsrsWeights as number[])
              : undefined,
            fsrsWeightsBackup: Array.isArray(base.fsrsWeightsBackup)
              ? (base.fsrsWeightsBackup as number[])
              : undefined,
            notifications: normalizeNotifications(base.notifications),
          };
        }
        return base as Partial<SettingsState>;
      },
    }
  )
);
