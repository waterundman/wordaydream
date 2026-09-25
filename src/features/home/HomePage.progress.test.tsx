/**
 * HomePage 进度环接线测试 (v1.6.0 SPEC §11.1)
 *
 * 覆盖 SPEC §11.1 `HomePage.progress.test.tsx` (2 测试):
 * - T01 [critical]: 闯关模式 → ProgressRing aria-label 反映 getMasteredCount / getLevelTotal
 * - T02 [critical]: 自由模式 (难度 5) → isFreeMode 分支固定 0 / 1
 *
 * 接线链路: HomePage (masteredCount / levelTotal)
 *   → HeroSection (progressCompleted / progressTotal)
 *   → ProgressRing (completed / total)
 *   → 根元素 aria-label={`今日进度 ${completed} / ${total}`}
 *
 * 实现策略: 直接 patch useWordlistStore 的 getLevelTotal / getMasteredCount / checkCourseCompletion
 * (zustand state 为普通对象, setState 覆盖即可), 从而以确定性数值验证接线, 不依赖真实词表规模.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { HomePage } from './HomePage';
import { useWordlistStore } from '../wordlist/store/useWordlistStore';
import { useReadingSessionStore } from '../reading/store/useReadingSessionStore';
import { useSettingsStore } from '../settings/store/useSettingsStore';

const RING_SELECTOR = '[aria-label^="今日进度"]';

function ringLabel(): string | null {
  const el = document.querySelector(RING_SELECTOR);
  return el ? el.getAttribute('aria-label') : null;
}

beforeAll(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    });
  }
});

beforeEach(() => {
  if (typeof window !== 'undefined') window.localStorage.clear();

  useReadingSessionStore.setState({
    session: null,
    lastConfig: { language: 'en', difficulty: 1 },
    currentHistoryId: null,
  });

  useWordlistStore.setState({
    progress: {},
    linearMode: true,
    getLevelTotal: vi.fn().mockResolvedValue(20),
    getMasteredCount: vi.fn().mockReturnValue(7),
    checkCourseCompletion: vi.fn().mockReturnValue(false),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe('HomePage — ProgressRing 接线 (v1.6.0 SPEC §11.1)', () => {
  it('T01 [critical]: 闯关模式 → 进度环显示 masteredCount / levelTotal', async () => {
    useSettingsStore.setState({ difficulty: 1 });

    render(
      <HomePage onStartReading={() => {}} onOpenSettings={() => {}} onViewWordlist={() => {}} />
    );

    // levelTotal 由 useEffect 异步 resolve (20) → 等待环更新到 7 / 20
    await waitFor(() => {
      expect(ringLabel()).toBe('今日进度 7 / 20');
    });
  });

  it('T02 [critical]: 自由模式 (难度 5) → isFreeMode 分支固定 0 / 1', async () => {
    useSettingsStore.setState({ difficulty: 5 });

    render(
      <HomePage onStartReading={() => {}} onOpenSettings={() => {}} onViewWordlist={() => {}} />
    );

    await waitFor(() => {
      expect(ringLabel()).toBe('今日进度 0 / 1');
    });
  });
});
