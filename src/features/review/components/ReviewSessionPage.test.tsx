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
 *
 * 实现策略:
 * - 通过 useReviewSessionStore.setState 设置 mode='completed' + results
 * - 通过 useAppModeStore.setState 设置 previousMode
 * - render ReviewSessionPage, 断言 CTA 文本和点击行为
 * - useGlobalShortcuts 在 mode='completed' 时 enabled=false, 不会干扰
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ReviewSessionPage } from './ReviewSessionPage';
import { useReviewSessionStore } from '../store/useReviewSessionStore';
import { useAppModeStore } from '../../../hooks/useAppModeStore';
import type { ReviewCardResult } from '../store/useReviewSessionStore';

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
