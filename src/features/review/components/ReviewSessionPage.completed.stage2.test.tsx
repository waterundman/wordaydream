/**
 * ReviewSessionPage completed 段收尾测试 (v0.9.0 Stage 2, SPEC §3.4/§3.6/§5)
 *
 * 覆盖 Stage 2 合约:
 * - T01 [critical]: 刷新态 (queue=[] 且 results 含 wrong) → 错词区块渲染提示行,
 *   含 "错词本" 跳转按钮; 点击 → setMode('wordlist') (断言 appMode store 副作用).
 * - T02 [critical]: 正常完成 (queue 有数据, wrongReviewItems 非空) → 提示行不渲染,
 *   错词列表照旧.
 * - T03 [critical]: 到期前瞻两行点击 → setMode('wordlist'); 键盘 Enter 触发.
 *
 * 实现策略: 跟随 ReviewSessionPage.completed.test.tsx 先例, 通过
 * useReviewSessionStore.setState 构造 mode='completed' + results/queue/cardContexts,
 * 通过 useAppModeStore.getState() 断言 setMode 副作用.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReviewSessionPage } from './ReviewSessionPage';
import { useReviewSessionStore } from '../store/useReviewSessionStore';
import { useAppModeStore } from '../../../hooks/useAppModeStore';
import { useMemoryStore } from '../store/useMemoryStore';
import { useStreakStore } from '../../streak/store/useStreakStore';
import type { MemoryCard, ReviewCardResult } from '../../../types';

const DAY = 86400e3;

function makeCard(lemma: string, language: 'en' | 'de', id: string, due = 0): MemoryCard {
  return {
    id,
    lexemeGroupId: id,
    lemma,
    objectiveDifficulty: 2,
    language,
    firstLearnedAt: 0,
    lastReviewAt: 0,
    due,
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

function makeResult(
  cardId: string,
  grade: 'correct' | 'partial' | 'wrong',
  answeredAt: number,
): ReviewCardResult {
  return {
    cardId,
    rating: 'good',
    evaluation: { grade, feedback: 'test feedback', hint: null },
    answeredAt,
  };
}

/** 构造 completed 态基础状态 (beforeEach 复用) */
function setupCompletedBase(overrides: Partial<ReturnType<typeof useReviewSessionStore.getState>> = {}) {
  useReviewSessionStore.setState({
    mode: 'completed',
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
    ...overrides,
  });
}

beforeEach(() => {
  // 重置各 store 单例, 避免跨测试泄漏
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
  useMemoryStore.setState({
    cards: new Map<string, MemoryCard>(),
    dueCardsIndex: null,
    cardsByLanguageIndex: null,
  });
  useStreakStore.setState({ lastStudyDate: null, currentStreak: 0, longestStreak: 0 });
});

afterEach(() => {
  cleanup();
});

describe('ReviewCompletedView 消歧提示 (Stage 2)', () => {
  describe('T01 [critical]: 刷新态 → 提示行 + wordlist 跳转', () => {
    it('T01: queue=[] 且 results 含 wrong → 提示行渲染, 点击 "错词本" 触发 setMode(wordlist)', async () => {
      const now = Date.now();
      // 关键: queue 为空 (刷新态), wrong 条目的 cardId 在 queue 中反查失败
      // → wrongReviewItems 为空, 但 hasWrong=true → 应渲染刷新态提示行.
      setupCompletedBase({
        language: 'en',
        results: [makeResult('lg-apple', 'wrong', now - 1000)],
        queue: [],
      });

      const user = userEvent.setup();
      render(<ReviewSessionPage />);

      // 提示行渲染 (含 "刷新后本次错词明细不可用")
      expect(screen.getByText(/刷新后本次错词明细不可用/)).toBeInTheDocument();
      // "错词本" 可点击元素存在
      const link = screen.getByRole('button', { name: '错词本' });
      expect(link).toBeInTheDocument();

      // 初始 appMode 非 wordlist
      expect(useAppModeStore.getState().currentMode).not.toBe('wordlist');

      await user.click(link);

      // 断言副作用: setMode('wordlist') 被调用
      expect(useAppModeStore.getState().currentMode).toBe('wordlist');
    });
  });

  describe('T02 [critical]: 正常完成 → 提示行不渲染, 错词列表照旧', () => {
    it('T02: queue 有数据 wrongReviewItems 非空 → 提示行不渲染, 列表渲染 wrong lemma', () => {
      const now = Date.now();
      setupCompletedBase({
        language: 'en',
        results: [
          makeResult('lg-apple', 'wrong', now - 2000),
          makeResult('lg-banana', 'wrong', now - 1000),
          makeResult('lg-cherry', 'correct', now - 3000),
        ],
        queue: [
          makeCard('apple', 'en', 'lg-apple'),
          makeCard('banana', 'en', 'lg-banana'),
          makeCard('cherry', 'en', 'lg-cherry'),
        ],
        cardContexts: {
          'lg-apple': 'apple context sentence',
          'lg-banana': 'banana context sentence',
        },
      });

      render(<ReviewSessionPage />);

      // 刷新态提示行不应出现
      expect(screen.queryByText(/刷新后本次错词明细不可用/)).not.toBeInTheDocument();
      // 错词列表照旧: 两个 wrong 的 lemma 出现
      expect(screen.getByText('apple')).toBeInTheDocument();
      expect(screen.getByText('banana')).toBeInTheDocument();
      // correct 的 lemma 不出现
      expect(screen.queryByText('cherry')).not.toBeInTheDocument();
    });
  });
});

describe('ReviewCompletedView 到期前瞻跳转 (Stage 2)', () => {
  describe('T03 [critical]: 点击 / 键盘 Enter → setMode(wordlist)', () => {
    function setupDueForecast() {
      // 用真实 Date.now() 构造相对 due 分布 (mount 时 useMemo 内部 Date.now() 与之相差毫秒级,
      // 不影响累计口径计数). 避免 fake timers 与 userEvent 死锁.
      const now = Date.now();
      const cards = new Map<string, MemoryCard>([
        ['lg-past1', makeCard('past1', 'en', 'lg-past1', now - 1000)],
        ['lg-past2', makeCard('past2', 'en', 'lg-past2', now - 5000)],
        ['lg-inday', makeCard('inday', 'en', 'lg-inday', now + 12 * 3600e3)],
        ['lg-day3', makeCard('day3', 'en', 'lg-day3', now + 3 * DAY)],
        ['lg-day10', makeCard('day10', 'en', 'lg-day10', now + 10 * DAY)],
      ]);
      useMemoryStore.setState({ cards, dueCardsIndex: null, cardsByLanguageIndex: null });
      setupCompletedBase();
    }

    it('T03a: 点击 "明天到期" 按钮 → setMode(wordlist)', async () => {
      setupDueForecast();
      const user = userEvent.setup();
      render(<ReviewSessionPage />);

      const tomorrowBtn = screen.getByRole('button', { name: /明天到期/ });
      expect(useAppModeStore.getState().currentMode).not.toBe('wordlist');
      await user.click(tomorrowBtn);
      expect(useAppModeStore.getState().currentMode).toBe('wordlist');
    });

    it('T03b: 键盘 Enter 聚焦 "未来 7 天到期" 按钮 → setMode(wordlist)', async () => {
      setupDueForecast();
      const user = userEvent.setup();
      render(<ReviewSessionPage />);

      const weekBtn = screen.getByRole('button', { name: /未来 7 天到期/ });
      weekBtn.focus();
      expect(useAppModeStore.getState().currentMode).not.toBe('wordlist');
      await user.keyboard('{Enter}');
      expect(useAppModeStore.getState().currentMode).toBe('wordlist');
    });
  });
});
