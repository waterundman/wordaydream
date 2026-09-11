/**
 * ReviewSessionPage completed 段深化测试 (v0.8.0-harmony Stage 2, SPEC §3/§5)
 *
 * 覆盖 test_spec:
 * - T01 [critical]: results 含 2 wrong + 1 correct → 错词区块渲染 2 项
 *   (两个 wrong 的 lemma 出现, correct 的 lemma 不出现)
 * - T02 [critical]: 全对 results → 错词区块不渲染 (区块标题为 null)
 * - T03 [critical]: 到期前瞻 — 用可控 now (fake timers) + 明确 due 分布的 cards,
 *   断言"明天"与"7 天"数字与累计口径一致
 * - T04 [non-critical]: streak 数字渲染 (mock useStreakStore.currentStreak)
 *
 * 实现策略 (跟随 ReviewSessionPage.test.tsx / .rating.test.tsx 先例):
 * - 通过 useReviewSessionStore.setState 构造 mode='completed' + results/queue/cardContexts
 * - T03 直接喂 useMemoryStore 真实卡片 (dueCardsIndex=null → 全量扫描), 用 fake timers
 *   锁定 Date.now(), 验证 getDueCards 在累计口径下的真实计数, 而非 mock 返回值
 * - T04 直接 setState useStreakStore.currentStreak 后断言渲染文本
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
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
  // 清空 memory store (dueCardsIndex=null 走全量扫描, 行为可控)
  useMemoryStore.setState({
    cards: new Map<string, MemoryCard>(),
    dueCardsIndex: null,
    cardsByLanguageIndex: null,
  });
  useStreakStore.setState({ lastStudyDate: null, currentStreak: 0, longestStreak: 0 });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ReviewCompletedView 错词回顾 (Stage 2)', () => {
  describe('T01 [critical]: 2 wrong + 1 correct → 渲染 2 项', () => {
    it('T01: 错词区块含两个 wrong lemma, 不含 correct lemma', () => {
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

      // 区块标题渲染
      expect(screen.getByText('本次错词回顾')).toBeInTheDocument();
      // 两个 wrong 的 lemma 出现 (exact text match 命中小标题 span)
      expect(screen.getByText('apple')).toBeInTheDocument();
      expect(screen.getByText('banana')).toBeInTheDocument();
      // correct 的 lemma 不应出现在任何位置 (completed 视图不渲染 lemma, 仅计数)
      expect(screen.queryByText('cherry')).not.toBeInTheDocument();
    });
  });

  describe('T02 [critical]: 全对 → 错词区块不渲染', () => {
    it('T02: results 全 correct 时区块标题为 null', () => {
      setupCompletedBase({
        language: 'en',
        results: [
          makeResult('lg-cherry', 'correct', Date.now() - 1000),
          makeResult('lg-grape', 'correct', Date.now() - 2000),
        ],
        queue: [
          makeCard('cherry', 'en', 'lg-cherry'),
          makeCard('grape', 'en', 'lg-grape'),
        ],
      });

      render(<ReviewSessionPage />);

      expect(screen.queryByText('本次错词回顾')).not.toBeInTheDocument();
      // correct 的 lemma 也不应出现
      expect(screen.queryByText('cherry')).not.toBeInTheDocument();
      expect(screen.queryByText('grape')).not.toBeInTheDocument();
    });
  });
});

describe('ReviewCompletedView 到期前瞻 (Stage 2)', () => {
  describe('T03 [critical]: 累计口径 — 明天 N / 7 天 M', () => {
    it('T03: 可控 cards + now → 明天到期 3 张, 未来 7 天到期 4 张', () => {
      vi.useFakeTimers();
      const now0 = new Date('2024-06-01T12:00:00Z').getTime();
      vi.setSystemTime(now0);

      // due 分布 (相对 now0):
      //  - past1 / past2: 已过期 (due <= now0)        → 计入明天 & 7天
      //  - inDay:        now0 + 12h (<= now0+1d)       → 计入明天 & 7天
      //  - day3:         now0 + 3d   (<= now0+7d)       → 仅计入 7天 (不计入明天)
      //  - day10:        now0 + 10d  (> now0+7d)        → 均不计入
      const cards = new Map<string, MemoryCard>([
        ['lg-past1', makeCard('past1', 'en', 'lg-past1', now0 - 1000)],
        ['lg-past2', makeCard('past2', 'en', 'lg-past2', now0 - 5000)],
        ['lg-inday', makeCard('inday', 'en', 'lg-inday', now0 + 12 * 3600e3)],
        ['lg-day3', makeCard('day3', 'en', 'lg-day3', now0 + 3 * DAY)],
        ['lg-day10', makeCard('day10', 'en', 'lg-day10', now0 + 10 * DAY)],
      ]);
      useMemoryStore.setState({ cards, dueCardsIndex: null, cardsByLanguageIndex: null });

      setupCompletedBase(); // queue 空, 不触发错词区块; 仅渲染到期前瞻

      render(<ReviewSessionPage />);

      // 明天 = due <= now0+1d 的数量 = 3 (past1, past2, inday)
      const tomorrowText = screen.getByText(/明天到期/).textContent ?? '';
      expect(tomorrowText).toMatch(/3/);
      // 7 天 = due <= now0+7d 的数量 = 4 (past1, past2, inday, day3)
      const weekText = screen.getByText(/未来 7 天到期/).textContent ?? '';
      expect(weekText).toMatch(/4/);
    });
  });
});

describe('ReviewCompletedView streak 展示 (Stage 2)', () => {
  describe('T04 [non-critical]: 连击天数渲染', () => {
    it('T04: currentStreak=5 → 渲染 "连续学习 5 天"', () => {
      useStreakStore.setState({ currentStreak: 5 });
      setupCompletedBase({
        results: [makeResult('lg-apple', 'wrong', Date.now() - 1000)],
        queue: [makeCard('apple', 'en', 'lg-apple')],
      });

      render(<ReviewSessionPage />);

      const streakText = screen.getByText(/连续学习/).textContent ?? '';
      expect(streakText).toMatch(/5/);
      expect(streakText).toMatch(/天/);
    });
  });
});
