/**
 * ReadingSessionPage 难度解锁 UI 测试 (v1.6.0 SPEC §11.1)
 *
 * 覆盖 SPEC §11.1 `ReadingSessionPage.unlock.test.tsx` (2 测试):
 * - T01 [critical]: 未解锁等级 → 按钮 disabled + aria-label 后缀 "(未解锁)" + 提示 title
 * - T02 [critical]: 全部解锁 → 5 个难度按钮均可点击, 无 "(未解锁)" 后缀
 *
 * 接线链路: useWordlistStore.isLevelUnlocked(language, level)
 *   → unlockedLevels (useMemo)
 *   → CEFR_LABELS 难度按钮 (disabled / aria-label / title / 锁图标)
 *
 * 实现策略: patch useWordlistStore 的 isLevelUnlocked / getLevelTotal,
 *   patch loadSession 避免真实 LLM 生成.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ReadingSessionPage } from './ReadingSessionPage';
import { useReadingSessionStore } from './store/useReadingSessionStore';
import { useReadingHistoryStore } from './store/useReadingHistoryStore';
import { useMemoryStore } from '../review/store/useMemoryStore';
import { useWordlistStore } from '../wordlist/store/useWordlistStore';
import { clearAllListeners } from '../../domain/events';
import type { DifficultyLevel, Language } from '../../types';

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
    activeOccurrenceId: null,
    hoveredGroupId: null,
    activeGrammarPointId: null,
    hoveredGrammarTypeId: null,
    isLoading: false,
    lastConfig: null,
    currentHistoryId: null,
    loadSession: vi.fn().mockResolvedValue(undefined),
  });
  useReadingHistoryStore.setState({ history: [], maxHistory: 50 });
  useMemoryStore.setState({ cards: new Map() });
  useWordlistStore.setState({
    progress: {},
    linearMode: true,
    schemaVersion: 2,
    getLevelTotal: vi.fn().mockResolvedValue(0),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  clearAllListeners();
  cleanup();
});

describe('ReadingSessionPage — 难度解锁 UI (v1.6.0 SPEC §11.1)', () => {
  it('T01 [critical]: 仅 A1 解锁 → A2/B1/B2/C1 disabled + "(未解锁)" + 提示 title', () => {
    // 仅难度 1 解锁, 其余锁定
    useWordlistStore.setState({
      isLevelUnlocked: vi.fn(
        (_language: Language, difficulty: DifficultyLevel) => difficulty <= 1
      ),
    });

    render(<ReadingSessionPage />);

    // A1 可点击
    const a1 = screen.getByRole('button', { name: 'A1' });
    expect(a1).not.toBeDisabled();

    // 其余 4 个锁定: disabled + aria-label 后缀
    for (const cefr of ['A2', 'B1', 'B2', 'C1']) {
      const btn = screen.getByRole('button', { name: `${cefr} (未解锁)` });
      expect(btn).toBeDisabled();
    }

    // 提示文案: 完成上一级 80% 掌握可解锁
    expect(
      screen.getByRole('button', { name: 'A2 (未解锁)' }).getAttribute('title')
    ).toBe('完成 A1 80% 掌握可解锁');

    // 锁定按钮渲染数量 = 4
    expect(document.querySelectorAll('button[aria-label$="(未解锁)"]').length).toBe(4);
  });

  it('T02 [critical]: 全部解锁 → 5 个难度按钮均可点击, 无 "(未解锁)"', () => {
    useWordlistStore.setState({
      isLevelUnlocked: vi.fn().mockReturnValue(true),
    });

    render(<ReadingSessionPage />);

    for (const cefr of ['A1', 'A2', 'B1', 'B2', 'C1']) {
      const btn = screen.getByRole('button', { name: cefr });
      expect(btn).not.toBeDisabled();
    }

    // 无任何锁定标记
    expect(document.querySelectorAll('button[aria-label$="(未解锁)"]').length).toBe(0);
  });
});
