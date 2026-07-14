/**
 * TodayCard 测试 (v2.1.0 Stage 3, Contract 66)
 *
 * 覆盖 test_spec:
 * - T14 [unit]: dueCount>0 → "今日待复习 N 词"
 * - T15 [unit]: 全部达成 → "今日学习已完成"
 * - T16 [unit]: newWordsDone<target → "今日新学 N 词, 目标 M"
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { TodayCard, type SessionStatus } from './TodayCard';

afterEach(() => {
  cleanup();
});

describe('TodayCard v2.1.0 Stage 3 (Contract 66)', () => {
  it('T14: dueCount>0 时显示 "今日待复习 N 词"', () => {
    const status: SessionStatus = {
      newWordsDone: 0,
      newWordsTarget: 10,
      reviewsDone: 0,
      reviewsTarget: 0,
      dueCount: 5,
    };
    render(<TodayCard onStart={() => {}} sessionStatus={status} />);
    expect(screen.getByText('今日待复习 5 词')).toBeInTheDocument();
  });

  it('T15: 全部达成时显示 "今日学习已完成"', () => {
    const status: SessionStatus = {
      newWordsDone: 10,
      newWordsTarget: 10,
      reviewsDone: 5,
      reviewsTarget: 5,
      dueCount: 0,
    };
    render(<TodayCard onStart={() => {}} sessionStatus={status} />);
    expect(screen.getByText('今日学习已完成。点击继续阅读更多内容。')).toBeInTheDocument();
  });

  it('T16: newWordsDone<target 时显示进度文案', () => {
    const status: SessionStatus = {
      newWordsDone: 3,
      newWordsTarget: 10,
      reviewsDone: 0,
      reviewsTarget: 0,
      dueCount: 0,
    };
    render(<TodayCard onStart={() => {}} sessionStatus={status} />);
    expect(screen.getByText('今日新学 3 词, 目标 10')).toBeInTheDocument();
  });
});
