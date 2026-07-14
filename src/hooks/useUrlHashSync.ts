import { useEffect, useRef } from 'react';
import { useAppModeStore, VALID_APP_MODES, type AppMode } from './useAppModeStore';

/**
 * v1.7.0 Stage 2: URL hash 同步 AppMode 状态机.
 *
 * 设计 (D4 / D5 / D6):
 * - currentMode 变化 → window.location.hash = `#/${mode}` (D5 格式)
 * - hashchange 事件 → setMode(解析后的 mode)
 * - 防循环: lastSyncedRef 记录上次同步值, mode→hash→mode 链路第二次被 ref 拦截
 * - 初始加载: 从 hash 读取 mode (深链接), 若有效则 setMode
 * - 无效 hash → 不 setMode, 保持当前 (默认 home)
 * - 浏览器后退 → hashchange 触发 setMode, 恢复上一状态 (D6)
 *
 * 约束:
 * - 不引入 react-router-dom, 仅加 hash 同步层
 * - 支持 prefers-reduced-motion: 本 hook 纯数据同步, 无动画; 页面过渡由 PageTransition 处理
 *
 * 实现说明:
 * - 3 个独立 useEffect, 依赖数组最小化, 避免重复绑定
 * - hashchange handler 内用 getState() 读最新 currentMode, 避免闭包陈旧值
 */
export function useUrlHashSync(): void {
  const currentMode = useAppModeStore((s) => s.currentMode);
  const lastSyncedRef = useRef<string | null>(null);

  // 1. 初始加载: 从 hash 读取 mode (深链接). 仅首次渲染后执行一次.
  useEffect(() => {
    const mode = parseHash(window.location.hash);
    if (mode !== null && mode !== useAppModeStore.getState().currentMode) {
      lastSyncedRef.current = mode;
      useAppModeStore.getState().setMode(mode);
    }
    // 仅初始挂载执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2. currentMode 变化 → 更新 hash. 防循环: ref 匹配时跳过.
  useEffect(() => {
    if (lastSyncedRef.current === currentMode) return;
    lastSyncedRef.current = currentMode;
    const nextHash = modeToHash(currentMode);
    if (window.location.hash !== nextHash) {
      window.location.hash = nextHash;
    }
  }, [currentMode]);

  // 3. hashchange → setMode. 防循环: 解析 mode 与 currentMode 相同时跳过.
  useEffect(() => {
    const handleHashChange = (): void => {
      const mode = parseHash(window.location.hash);
      if (mode === null) return; // 无效 hash, fallback 保持当前
      const current = useAppModeStore.getState().currentMode;
      if (mode === current) return; // 防循环
      lastSyncedRef.current = mode;
      useAppModeStore.getState().setMode(mode);
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);
}

/**
 * 解析 hash 为 AppMode. 格式: `#/${mode}`.
 * @returns 有效 AppMode 或 null (无效/空 hash)
 */
function parseHash(hash: string): AppMode | null {
  const match = hash.match(/^#\/(\w+)$/);
  const mode = match?.[1];
  if (
    mode !== undefined &&
    (VALID_APP_MODES as ReadonlyArray<string>).includes(mode)
  ) {
    return mode as AppMode;
  }
  return null;
}

function modeToHash(mode: AppMode): string {
  return `#/${mode}`;
}
