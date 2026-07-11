/**
 * useReadingTimeTracker hook 单元测试 (Contract 28 NEW / D-2)
 *
 * 覆盖:
 * - T01: isReading=false 时不触发 interval, incrementReadingSeconds 不被调用
 * - T02: isReading=true 时每秒调用 incrementReadingSeconds(1) (fake timers)
 * - T03: isReading 从 true 切到 false 时 clearInterval 被调用, 累计停止
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useReadingTimeTracker } from './useReadingTimeTracker';
import { useSettingsStore } from '../features/settings/store/useSettingsStore';

function resetStore(): void {
  useSettingsStore.setState({
    totalSecondsToday: 0,
    lastSessionDate: null,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  resetStore();
});

afterEach(() => {
  vi.useRealTimers();
  resetStore();
});

describe('useReadingTimeTracker', () => {
  it('T01: isReading=false 时不触发 interval, incrementReadingSeconds 不被调用', () => {
    const initial = useSettingsStore.getState().totalSecondsToday;
    const incrementSpy = vi.spyOn(
      useSettingsStore.getState(),
      'incrementReadingSeconds'
    );

    renderHook(() => useReadingTimeTracker(false));

    vi.advanceTimersByTime(5000);

    expect(incrementSpy).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().totalSecondsToday).toBe(initial);
  });

  it('T02: isReading=true 时每秒调用 incrementReadingSeconds(1)', () => {
    renderHook(() => useReadingTimeTracker(true));

    // 进入时 resetTodayIfNewDay 已把 totalSecondsToday 锁定为 0 (新日)
    expect(useSettingsStore.getState().totalSecondsToday).toBe(0);

    vi.advanceTimersByTime(1000);
    expect(useSettingsStore.getState().totalSecondsToday).toBe(1);

    vi.advanceTimersByTime(2000);
    expect(useSettingsStore.getState().totalSecondsToday).toBe(3);

    vi.advanceTimersByTime(4000);
    expect(useSettingsStore.getState().totalSecondsToday).toBe(7);
  });

  it('T03: isReading 从 true 切到 false 时 clearInterval, 累计停止', () => {
    const { rerender } = renderHook(
      ({ reading }: { reading: boolean }) => useReadingTimeTracker(reading),
      { initialProps: { reading: true } }
    );

    vi.advanceTimersByTime(3000);
    expect(useSettingsStore.getState().totalSecondsToday).toBe(3);

    // 路由切换: reading -> false
    rerender({ reading: false });

    vi.advanceTimersByTime(5000);
    // 离开阅读态后, 累计冻结在 3
    expect(useSettingsStore.getState().totalSecondsToday).toBe(3);
  });
});
