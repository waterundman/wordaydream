/**
 * Wordaydream v1.4.1 Stage 2: 离线模式状态机 (Zustand store)
 *
 * 职责:
 * - 镜像 navigator.onLine 状态
 * - 监听 window 'online' / 'offline' 事件, 自动更新 isOffline
 * - 记录 lastOnlineAt / lastOfflineAt 时间戳
 * - 缓存当前 provider, 离线 fallback 决策依据
 * - 持久化到 localStorage ('wordaydream-offline-mode')
 * - 派发持久 banner (useToastStore.showNotification 'offline-mode')
 * - 保存 'beforeinstallprompt' 事件给 InstallPromptButton 使用
 *
 * 设计原则:
 * - 0 副作用导入: 不在 module 顶层调 useToastStore.getState() 或注册 window listener
 * - init() 方法手动触发, 由 main.tsx 在应用启动时调用
 * - init() 返回 cleanup 函数, 用于测试环境 unmount / 路由切换
 * - 0 emoji (与项目硬约束一致)
 * - tokens.css 复用: 状态值 isOffline 与 css var 无关, 只用色板引用在 UI 层
 *
 * 保留的 v1.4.1 Stage 1 + v1.4.0 13 合同:
 * - 0 改动 useSettingsStore / useToastStore
 * - 0 改动 router.ts 的 settings → providerFn 流程
 * - Settings 面板不变, 仅 router 入口处多一次 isOffline 检查
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { useToastStore } from '../../../store/useToastStore';

/** v1.4.1 Stage 2: 持久通知 key (offline mode banner) */
export const OFFLINE_MODE_NOTIFICATION_KEY = 'offline-mode';

/** v1.4.1 Stage 2: 离线模式 banner 提示文案 */
export const OFFLINE_MODE_NOTIFICATION_MESSAGE = '当前处于离线模式, 已自动切换到预存文本';

type CachedProvider = 'openai' | 'anthropic' | 'deepseek' | 'mock' | null;

interface OfflineModeState {
  /** navigator.onLine 镜像 */
  isOffline: boolean;
  /** 最近一次回到 online 的 timestamp, 初始为 null */
  lastOnlineAt: number | null;
  /** 最近一次进入 offline 的 timestamp, 初始为 null */
  lastOfflineAt: number | null;
  /** 离线时正在使用的 provider, 用于 fallback 决策追溯 */
  cachedProvider: CachedProvider;
  /**
   * 'beforeinstallprompt' 事件句柄 (浏览器原生 BeforeInstallPromptEvent).
   * 用 unknown 类型避免引入 DOM lib 的 lib.dom.d.ts 强依赖, 调用方按规范使用.
   */
  installPromptEvent: unknown;
  /** 切换 offline 状态, 同步 lastOnlineAt / lastOfflineAt, 派发 banner */
  setOffline: (offline: boolean) => void;
  /** 记录当前 provider, 供离线时回放 */
  recordProviderWhenOffline: (provider: string) => void;
  /** 保存 install prompt event (由 main.tsx 监听 beforeinstallprompt 注入) */
  setInstallPromptEvent: (event: unknown) => void;
  /**
   * 初始化: 注册 window 'online' / 'offline' 事件监听,
   * 把 navigator.onLine 镜像到 store. 返回 cleanup 函数 (测试 / 卸载用).
   */
  init: () => () => void;
  /** 重置为初始状态, 同时 dismiss 'offline-mode' banner */
  reset: () => void;
}

const initialState: Pick<
  OfflineModeState,
  'isOffline' | 'lastOnlineAt' | 'lastOfflineAt' | 'cachedProvider' | 'installPromptEvent'
> = {
  isOffline: false,
  lastOnlineAt: null,
  lastOfflineAt: null,
  cachedProvider: null,
  installPromptEvent: null,
};

const ALLOWED_PROVIDERS: ReadonlySet<CachedProvider> = new Set([
  'openai',
  'anthropic',
  'deepseek',
  'mock',
  null,
]);

function normalizeProvider(provider: string): CachedProvider {
  if (ALLOWED_PROVIDERS.has(provider as CachedProvider)) {
    return provider as CachedProvider;
  }
  return null;
}

export const useOfflineModeStore = create<OfflineModeState>()(
  persist(
    (set, get) => ({
      ...initialState,

      setOffline: (offline) => {
        const prev = get().isOffline;
        if (prev === offline) return;
        const now = Date.now();
        if (offline) {
          set({ isOffline: true, lastOfflineAt: now });
          try {
            useToastStore
              .getState()
              .showNotification(OFFLINE_MODE_NOTIFICATION_KEY, OFFLINE_MODE_NOTIFICATION_MESSAGE);
          } catch {
            // 通知派发失败不应阻塞主流程
          }
        } else {
          set({ isOffline: false, lastOnlineAt: now });
          try {
            useToastStore.getState().dismissNotification(OFFLINE_MODE_NOTIFICATION_KEY);
          } catch {
            // 通知 dismiss 失败不应阻塞主流程
          }
        }
      },

      recordProviderWhenOffline: (provider) => {
        const normalized = normalizeProvider(provider);
        set({ cachedProvider: normalized });
      },

      setInstallPromptEvent: (event) => {
        set({ installPromptEvent: event });
      },

      init: () => {
        if (typeof window === 'undefined') {
          return () => undefined;
        }
        // 初始镜像 navigator.onLine
        const initialOnline = window.navigator.onLine !== false;
        if (initialOnline !== get().isOffline) {
          // 初始化阶段不派发 banner (避免冷启动误报)
          set({ isOffline: !initialOnline });
        }

        const handleOnline = () => get().setOffline(false);
        const handleOffline = () => get().setOffline(true);

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
          window.removeEventListener('online', handleOnline);
          window.removeEventListener('offline', handleOffline);
        };
      },

      reset: () => {
        set({ ...initialState });
        try {
          useToastStore.getState().dismissNotification(OFFLINE_MODE_NOTIFICATION_KEY);
        } catch {
          // 静默忽略 dismiss 失败
        }
      },
    }),
    {
      name: 'wordaydream-offline-mode',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // 只持久化离线相关字段, 不持久化 installPromptEvent (DOM 事件不能序列化)
      partialize: (state) => ({
        isOffline: state.isOffline,
        lastOnlineAt: state.lastOnlineAt,
        lastOfflineAt: state.lastOfflineAt,
        cachedProvider: state.cachedProvider,
      }),
      // v1.5.2 fix L3: 占位 migrate, 未来 schema bump 需补真实迁移逻辑.
      migrate: (persistedState) => persistedState,
    },
  ),
);
