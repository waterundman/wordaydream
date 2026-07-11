/**
 * DifficultySuggestion 组件测试 (T06)
 *
 * 覆盖 test_spec:
 * - T06: byLevel[3] >= 30 时 DifficultySuggestion 渲染
 *
 * 设计:
 * - mock `useHomeAnalytics` 注入 byLevel[3] = 35 满足 >= 30 阈值
 * - mock `difficultyAdvisor.suggests` 返回 4 (升级), 让组件进入渲染分支
 * - mock useSettingsStore 让 difficulty = 3 与 byLevel 下标一致
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DifficultySuggestion } from './DifficultySuggestion';
import { useSettingsStore } from '../../settings/store/useSettingsStore';
import type { DifficultyLevel } from '../../../types';

vi.mock('../services/difficultyAdvisor', async () => {
  const actual = await vi.importActual<typeof import('../services/difficultyAdvisor')>(
    '../services/difficultyAdvisor',
  );
  return {
    ...actual,
    suggests: vi.fn(() => 4 as DifficultyLevel),
  };
});

vi.mock('../../analytics/hooks/useHomeAnalytics', () => ({
  useHomeAnalytics: () => ({
    total: 35,
    totalLearned: 35,
    mastered: 35,
    masteryRate: 1.0,
    byLevel: { 1: 0, 2: 0, 3: 35, 4: 0, 5: 0 } as Record<DifficultyLevel, number>,
    byStatus: { new: 0, learning: 0, review: 35, relearning: 0 },
  }),
}));

beforeEach(() => {
  useSettingsStore.setState({ difficulty: 3 });
});

describe('DifficultySuggestion', () => {
  it('T06: byLevel[3] >= 30 时组件渲染 (存在 role="status" 元素)', () => {
    render(<DifficultySuggestion />);

    // 组件根元素带 role="status" aria-live="polite"
    const el = screen.getByRole('status');
    expect(el).toBeInTheDocument();
  });
});
