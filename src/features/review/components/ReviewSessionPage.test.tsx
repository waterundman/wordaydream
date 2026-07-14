/**
 * ReviewSessionPage 测试 (v2.1.0 Stage 1, Contract 62)
 *
 * 覆盖 test_spec:
 * - T3 [integration, critical]: previousMode='reading' → ReviewCompletedView 渲染双 CTA
 *   ("继续阅读" + "返回主页")
 * - T4 [integration, critical]: previousMode='home' → ReviewCompletedView 渲染单按钮
 *   ("返回主舞台")
 * - T5 [integration, critical]: previousMode=null → ReviewCompletedView 渲染单按钮
 *   ("返回主舞台")
 * - T6 [integration, critical]: 点击 "继续阅读" → exitReview (returnToPrevious → reading);
 *   点击 "返回主页" → exitReview + setMode('home')
 * - T13: statsLine 用 useMemo 显示正确的统计数字 (不重复 filter)
 * - T14: 计时器实时更新 (setInterval 驱动)
 *
 * 实现策略:
 * - 通过 useReviewSessionStore.setState 设置 mode='completed' + results
 * - 通过 useAppModeStore.setState 设置 previousMode
 * - render ReviewSessionPage, 断言 CTA 文本和点击行为
 * - useGlobalShortcuts 在 mode='completed' 时 enabled=false, 不会干扰
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { ReviewSessionPage } from './ReviewSessionPage';
import { useReviewSessionStore } from '../store/useReviewSessionStore';
import { useAppModeStore } from '../../../hooks/useAppModeStore';
import type { ReviewCardResult } from '../store/useReviewSessionStore';
import type { MemoryCard } from '../../../types';

/**
 * 构造一条复习结果 (用于 ReviewCompletedView stats 渲染)
 */
function makeResult(grade: 'correct' | 'partial' | 'wrong' = 'correct'): ReviewCardResult {
  return {
    cardId: `card-${grade}`,
    rating: 'good',
    evaluation: {
      grade,
      feedback: 'test feedback',
      hint: null,
    },
    answeredAt: Date.now(),
  };
}

beforeEach(() => {
  // 重置两个 store, 避免单例状态跨测试泄漏
  useAppModeStore.getState().reset();
  useReviewSessionStore.setState({
    mode: 'idle',
    language: 'en',
    queue: [],
    currentIndex: 0,
    userAnswer: '',
    evaluation: null,
    isEvaluating: false,
    isPaused: false,
    showRatingBar: false,
    results: [],
    startedAt: 0,
    cardContexts: {},
  });
});

afterEach(() => {
  cleanup();
});

describe('ReviewCompletedView 双 CTA (v2.1.0 Contract 62)', () => {
  function setupCompleted(results: ReviewCardResult[] = [makeResult('correct')]) {
    useReviewSessionStore.setState({
      mode: 'completed',
      results,
      queue: [],
      currentIndex: 0,
      userAnswer: '',
      evaluation: null,
      isEvaluating: false,
      isPaused: false,
      showRatingBar: false,
      startedAt: Date.now() - 60_000,
    });
  }

  describe('T3: previousMode=reading → 双 CTA', () => {
    it('T3a: 渲染 "继续阅读" 和 "返回主页" 两个按钮', () => {
      setupCompleted();
      useAppModeStore.setState({
        currentMode: 'review',
        previousMode: 'reading',
      });

      render(<ReviewSessionPage />);

      expect(screen.getByText('继续阅读')).toBeInTheDocument();
      expect(screen.getByText('返回主页')).toBeInTheDocument();
      // 不应出现单按钮文案
      expect(screen.queryByText('返回主舞台')).not.toBeInTheDocument();
    });

    it('T3b: "继续阅读" 为主按钮 (primary class), "返回主页" 为次按钮', () => {
      setupCompleted();
      useAppModeStore.setState({
        currentMode: 'review',
        previousMode: 'reading',
      });

      render(<ReviewSessionPage />);

      const continueBtn = screen.getByText('继续阅读').closest('button');
      const homeBtn = screen.getByText('返回主页').closest('button');

      expect(continueBtn).not.toBeNull();
      expect(homeBtn).not.toBeNull();
      // 主按钮含 primary class (CSS module hash, 检查 class 含 primary)
      expect(continueBtn?.className).toMatch(/primary/);
      // 次按钮不含 primary
      expect(homeBtn?.className).not.toMatch(/primary/);
    });
  });

  describe('T4: previousMode=home → 单按钮', () => {
    it('T4a: 仅渲染 "返回主舞台" 单按钮', () => {
      setupCompleted();
      useAppModeStore.setState({
        currentMode: 'review',
        previousMode: 'home',
      });

      render(<ReviewSessionPage />);

      expect(screen.getByText('返回主舞台')).toBeInTheDocument();
      // 不应出现双 CTA
      expect(screen.queryByText('继续阅读')).not.toBeInTheDocument();
      expect(screen.queryByText('返回主页')).not.toBeInTheDocument();
    });
  });

  describe('T5: previousMode=null → 单按钮', () => {
    it('T5a: 仅渲染 "返回主舞台" 单按钮 (persist 恢复场景)', () => {
      setupCompleted();
      // previousMode=null (初始状态, 模拟 persist 恢复后无记录)
      useAppModeStore.setState({
        currentMode: 'review',
        previousMode: null,
      });

      render(<ReviewSessionPage />);

      expect(screen.getByText('返回主舞台')).toBeInTheDocument();
      expect(screen.queryByText('继续阅读')).not.toBeInTheDocument();
      expect(screen.queryByText('返回主页')).not.toBeInTheDocument();
    });
  });

  describe('T6: CTA 点击行为', () => {
    it('T6a: 点击 "继续阅读" → exitReview (returnToPrevious → currentMode=reading)', () => {
      setupCompleted();
      useAppModeStore.setState({
        currentMode: 'review',
        previousMode: 'reading',
      });

      render(<ReviewSessionPage />);

      fireEvent.click(screen.getByText('继续阅读'));

      // exitReview 把 review store mode 改为 idle
      expect(useReviewSessionStore.getState().mode).toBe('idle');
      // returnToPrevious 把 currentMode 改为 reading, previousMode 清空
      expect(useAppModeStore.getState().currentMode).toBe('reading');
      expect(useAppModeStore.getState().previousMode).toBeNull();
    });

    it('T6b: 点击 "返回主页" → exitReview + setMode(home)', () => {
      setupCompleted();
      useAppModeStore.setState({
        currentMode: 'review',
        previousMode: 'reading',
      });

      render(<ReviewSessionPage />);

      fireEvent.click(screen.getByText('返回主页'));

      // exitReview 把 review store mode 改为 idle
      expect(useReviewSessionStore.getState().mode).toBe('idle');
      // onExit 回调: exitReview (returnToPrevious → reading) + setMode('home') 覆盖
      expect(useAppModeStore.getState().currentMode).toBe('home');
      // previousMode 被 returnToPrevious 清空
      expect(useAppModeStore.getState().previousMode).toBeNull();
    });

    it('T6c: 点击 "返回主舞台" (单按钮) → exitReview + setMode(home)', () => {
      setupCompleted();
      useAppModeStore.setState({
        currentMode: 'review',
        previousMode: null,
      });

      render(<ReviewSessionPage />);

      fireEvent.click(screen.getByText('返回主舞台'));

      expect(useReviewSessionStore.getState().mode).toBe('idle');
      // previousMode=null → returnToPrevious 回 home; setMode('home') 也是 home
      expect(useAppModeStore.getState().currentMode).toBe('home');
      expect(useAppModeStore.getState().previousMode).toBeNull();
    });
  });
});

/**
 * v2.2.3 Stage 3 (D3-2): ReviewSessionPage 性能优化测试
 *
 * 覆盖 test_spec:
 * - T13: statsLine 用 useMemo 显示正确的统计数字 (不重复 filter)
 * - T14: 计时器实时更新 (setInterval 驱动, useState + useEffect)
 *
 * 设计:
 * - 构造 MemoryCard queue + ReviewCardResult[] 设置 reviewing 模式
 * - T13: 渲染后断言 statsLine 显示 correct/partial/wrong 数字
 * - T14: vi.useFakeTimers + setSystemTime 控制 Date.now, advanceTimersByTime 驱动 interval
 */

function makeCard(lemma = 'test'): MemoryCard {
  return {
    id: `card-${lemma}`,
    lexemeGroupId: `lg-${lemma}`,
    lemma,
    objectiveDifficulty: 2,
    language: 'en',
    firstLearnedAt: 0,
    lastReviewAt: 0,
    due: 0,
    stability: 1,
    difficulty: 1,
    elapsedDays: 0,
    scheduledDays: 1,
    reps: 0,
    lapses: 0,
    status: 'review',
    learningSteps: 0,
  };
}

describe('ReviewSessionPage 性能优化 (v2.2.3 Stage 3 D3-2)', () => {
  function setupReviewing(
    results: ReviewCardResult[] = [],
    startedAt = 0,
  ) {
    useReviewSessionStore.setState({
      mode: 'reviewing',
      language: 'en',
      queue: [makeCard()],
      currentIndex: 0,
      userAnswer: '',
      evaluation: null,
      isEvaluating: false,
      isPaused: false,
      showRatingBar: false,
      results,
      startedAt,
      cardContexts: {},
    });
  }

  it('T13: statsLine 用 useMemo 显示正确的统计数字 (不重复 filter)', () => {
    const results: ReviewCardResult[] = [
      makeResult('correct'),
      makeResult('correct'),
      makeResult('partial'),
      makeResult('wrong'),
    ];
    setupReviewing(results, 0);

    render(<ReviewSessionPage />);

    // 答对 2, 部分 1, 错误 1
    expect(screen.getByText(/答对/).textContent).toMatch(/2/);
    expect(screen.getByText(/部分/).textContent).toMatch(/1/);
    expect(screen.getByText(/错误/).textContent).toMatch(/1/);
  });

  it('T14: 计时器实时更新 (setInterval 驱动)', () => {
    vi.useFakeTimers();
    const now = new Date('2024-01-01T00:00:00Z').getTime();
    vi.setSystemTime(now);

    // startedAt = now - 5s, 初始 elapsed 应为 5 秒
    setupReviewing([], now - 5_000);

    render(<ReviewSessionPage />);

    // 初始显示 "5 秒"
    expect(screen.getByText(/用时/).textContent).toMatch(/5 秒/);

    // 推进 3 秒 (触发 3 次 interval 回调)
    act(() => {
      vi.advanceTimersByTime(3_000);
    });

    // 5 + 3 = 8 秒
    expect(screen.getByText(/用时/).textContent).toMatch(/8 秒/);

    vi.useRealTimers();
  });
});
