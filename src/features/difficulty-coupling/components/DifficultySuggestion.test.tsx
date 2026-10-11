/**
 * DifficultySuggestion 组件测试
 *
 * 覆盖:
 * - T06: byLevel[3] >= 30 时 DifficultySuggestion 渲染 (存在 role="status" 元素)
 * - T07 [critical]: 组件把该等级的真实 errorRate 交给顾问 (v1.6.6 红队修复:
 *   此前 errorRate 恒为 0, 顾问的降级分支按构造永不成立)
 * - T08 [critical]: 高错误率 + 低掌握率时确实给出「建议降级」
 *
 * 设计:
 * - mock `useHomeAnalytics` 用可变对象 (vi.hoisted) 注入按等级的量与错误率
 * - `suggests` 用真实实现 (仅包一层 spy 以便断言入参), 不再 mock 返回值 ——
 *   否则「分支是否可达」这件事根本没被测到
 * - mock useSettingsStore 让 difficulty = 3 与 byLevel 下标一致
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { DifficultySuggestion } from './DifficultySuggestion';
import { useSettingsStore } from '../../settings/store/useSettingsStore';
import type { DifficultyLevel } from '../../../types';
import type { DifficultyStats } from '../services/difficultyAdvisor';

const { mockAnalytics, holders } = vi.hoisted(() => {
  const analytics = {
    total: 35,
    totalLearned: 35,
    mastered: 35,
    masteryRate: 1.0,
    byLevel: { 1: 0, 2: 0, 3: 35, 4: 0, 5: 0 } as Record<DifficultyLevel, number>,
    byLevelErrorRate: { 1: 0, 2: 0, 3: 0.5, 4: 0, 5: 0 } as Record<DifficultyLevel, number>,
    byStatus: { new: 0, learning: 0, review: 35, relearning: 0 },
  };
  return { mockAnalytics: analytics, holders: { suggests: null as null | ((...args: unknown[]) => unknown) } };
});

vi.mock('../services/difficultyAdvisor', async () => {
  const actual = await vi.importActual<typeof import('../services/difficultyAdvisor')>(
    '../services/difficultyAdvisor',
  );
  const spy = vi.fn(actual.suggests);
  holders.suggests = spy as unknown as (...args: unknown[]) => unknown;
  return { ...actual, suggests: spy };
});

vi.mock('../../analytics/hooks/useHomeAnalytics', () => ({
  useHomeAnalytics: () => mockAnalytics,
}));

beforeEach(() => {
  cleanup();
  localStorage.clear();
  useSettingsStore.setState({ difficulty: 3 });
  mockAnalytics.masteryRate = 1.0;
  mockAnalytics.byLevel = { 1: 0, 2: 0, 3: 35, 4: 0, 5: 0 };
  mockAnalytics.byLevelErrorRate = { 1: 0, 2: 0, 3: 0.5, 4: 0, 5: 0 };
  (holders.suggests as { mockClear?: () => void })?.mockClear?.();
});

describe('DifficultySuggestion', () => {
  it('T06: byLevel[3] >= 30 时组件渲染 (存在 role="status" 元素)', () => {
    render(<DifficultySuggestion />);

    // 组件根元素带 role="status" aria-live="polite"
    const el = screen.getByRole('status');
    expect(el).toBeInTheDocument();
  });

  it('T07 [critical]: 交给顾问的 errorRate 是该等级的真实值, 不再是硬编码 0', () => {
    render(<DifficultySuggestion />);

    const spy = holders.suggests as unknown as { mock: { calls: Array<[number, DifficultyStats]> } };
    expect(spy.mock.calls.length, '顾问应被调用').toBeGreaterThan(0);
    const [, stats] = spy.mock.calls[0];
    expect(stats.errorRate).toBe(0.5);
    expect(stats.totalAtLevel).toBe(35);
  });

  it('T08 [critical]: 高错误率 + 低掌握率 → 给出「内容偏难, 建议降级」', () => {
    // 35 词未达「升级」的 50 词门槛, 但错误率 0.5 >= 0.4 → 应建议降到 2
    mockAnalytics.masteryRate = 0.2;

    render(<DifficultySuggestion />);

    expect(screen.getByText('内容偏难, 建议降级')).toBeInTheDocument();
  });

  it('T09: 错误率为 0 且未达升级门槛时不打扰', () => {
    mockAnalytics.masteryRate = 0.2;
    mockAnalytics.byLevelErrorRate = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

    render(<DifficultySuggestion />);

    expect(screen.queryByRole('status')).toBeNull();
  });
});
