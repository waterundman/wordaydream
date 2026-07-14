import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { LLMSettings, LLMProvider, DifficultyLevel } from '../../../types';
import { testProviderConnection, resetProviderCache } from '../../llm/services/router';

/** v1.5.2 Stage 1: 主题类型 (D-3: light / dark / sepia) */
export type Theme = 'light' | 'dark' | 'sepia';

/** v1.5.2 Stage 1: 主题合法值集合 (用于校验 import / 旧 localStorage 数据) */
const VALID_THEMES: ReadonlyArray<Theme> = ['light', 'dark', 'sepia'];
const DEFAULT_THEME: Theme = 'light';

function normalizeTheme(value: unknown): Theme {
  return VALID_THEMES.includes(value as Theme) ? (value as Theme) : DEFAULT_THEME;
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

      setProvider: (provider) => {
        set((s) => ({ llm: { ...s.llm, provider } }));
        resetProviderCache();
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

      openSettings: () => set({ settingsOpen: true }),
      closeSettings: () => set({ settingsOpen: false }),

      testConnection: async () => {
        set({ isTesting: true });
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
        });
        resetProviderCache();
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

          resetProviderCache();
          return true;
        } catch {
          return false;
        }
      },
    }),
    {
      name: 'wordaydream:settings',
      // v2.1.1 Stage 4 (D2): bump version 6 → 7, 配合 LLMSettings.apiKey/baseUrl 移除迁移
      version: 7,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        llm: state.llm,
        difficulty: state.difficulty,
        theme: state.theme,
        totalSecondsToday: state.totalSecondsToday,
        lastSessionDate: state.lastSessionDate,
        fsrsWeights: state.fsrsWeights,
        fsrsWeightsBackup: state.fsrsWeightsBackup,
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
          };
        }
        return base as Partial<SettingsState>;
      },
    }
  )
);
