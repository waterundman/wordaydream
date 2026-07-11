import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type ToastType = 'success' | 'error' | 'warning';

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
}

interface ToastStore {
  toasts: Toast[];
  /**
   * v1.2.0: 持久通知字典 (key -> message).
   * 与 toasts (短提示) 不同, notifications 不自动消失,
   * 需用户主动 dismiss, 适用于"LLM fallback 通知"等需要持续可见的提示.
   * NotificationBanner 组件订阅本字段.
   */
  notifications: Record<string, string>;
  addToast: (type: ToastType, message: string) => void;
  removeToast: (id: string) => void;
  /**
   * v1.2.0: 派发一条持久通知. 同一 key 会覆盖之前的消息.
   * 典型 key: 'llm-fallback'.
   */
  showNotification: (key: string, message: string) => void;
  /** v1.2.0: 关闭 (dismiss) 一条持久通知 */
  dismissNotification: (key: string) => void;
}

// v1.5.3 fix V2-P3-003: 用 timer Map 追踪每个 toast 的自动消失 timer,
// removeToast 时 clearTimeout 避免累积, 测试环境避免跨测试泄漏.
const toastTimers = new Map<string, ReturnType<typeof setTimeout>>();

export const useToastStore = create<ToastStore>()(
  persist(
    (set) => ({
      toasts: [],
      notifications: {},
      addToast: (type, message) => {
        const id = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        set((state) => ({ toasts: [...state.toasts, { id, type, message }] }));
        const timer = setTimeout(() => {
          set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
          toastTimers.delete(id);
        }, 3000);
        toastTimers.set(id, timer);
      },
      removeToast: (id) => {
        // v1.5.3 fix V2-P3-003: 清除 pending timer 避免泄漏.
        const timer = toastTimers.get(id);
        if (timer) {
          clearTimeout(timer);
          toastTimers.delete(id);
        }
        set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
      },
      showNotification: (key, message) =>
        set((state) => ({
          notifications: { ...state.notifications, [key]: message },
        })),
      dismissNotification: (key) =>
        set((state) => {
          if (!(key in state.notifications)) return state;
          const next = { ...state.notifications };
          delete next[key];
          return { notifications: next };
        }),
    }),
    {
      name: 'wordaydream:toast',
      version: 2,
      storage: createJSONStorage(() => localStorage),
      partialize: () => ({}),
      // v1.5.2 fix L3: 占位 migrate, 未来 schema bump 需补真实迁移逻辑.
      migrate: (persistedState) => persistedState,
    },
  ),
);

// 暴露到 window 方便 E2E 测试 (dev/test only, 不影响生产 bundle 行为)
if (typeof window !== 'undefined' && import.meta.env?.DEV) {
  (window as unknown as { __TOAST_STORE__: typeof useToastStore }).__TOAST_STORE__ = useToastStore;
}
