import { useEffect, useRef } from 'react';
import { useSettingsStore } from '../features/settings/store/useSettingsStore';

/**
 * 阅读时长追踪 hook (Contract 28 NEW / D-2)
 *
 * 设计:
 * - 仅在 isReading=true 时累计秒数
 * - 离开阅读态时清空 interval
 * - 跨日重置 (调用 store 的 resetTodayIfNewDay, 用 ISO 日期 yyyy-mm-dd)
 * - 与 setInterval(1000ms) 对齐, 卸载/路由切换自动 cleanup
 * - 0 动画: 纯数据累加, 不受 prefers-reduced-motion 影响
 *
 * 实现说明:
 * - Wordaydream 使用内部 appMode 状态机 (home / reading / review), 不引入 react-router-dom
 * - 由 App.tsx 把 appMode === 'reading' 传入 isReading 参数
 * - 保持 0 new dependencies 硬约束
 */
export function useReadingTimeTracker(isReading: boolean): void {
  const incrementReadingSeconds = useSettingsStore(
    (s) => s.incrementReadingSeconds
  );
  const resetTodayIfNewDay = useSettingsStore(
    (s) => s.resetTodayIfNewDay
  );

  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isReading) {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    resetTodayIfNewDay(today);

    intervalRef.current = window.setInterval(() => {
      incrementReadingSeconds(1);
    }, 1000);

    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isReading, incrementReadingSeconds, resetTodayIfNewDay]);
}
