/**
 * WrongWordsSection "复习错词 (N)" 入口测试 (v1.0.0 Stage 3)
 *
 * 覆盖 test_spec:
 * - T04a [critical]: N>0 → 标题行渲染"复习错词 (N)"按钮, 点击触发
 *   startWrongWordsReview (状态副作用断言: mode 变 reviewing, queue 填充)
 * - T04b [critical]: N=0 (空态) → 按钮不渲染
 *
 * 实现策略: 沿 WrongWordsSection.test.tsx 惯例 — 直接渲染区块组件,
 * setState 预置 stores, 状态副作用断言不 spy 单例.
 * 定向会话的反查依赖 cards Map (键 = lexemeGroupId), 需同时预置卡片实体.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { MemoryCard } from '../../../types';
import { WrongWordsSection } from './WrongWordsSection';
import { useWrongWordsStore, type WrongWordEntry } from '../../review/store/useWrongWordsStore';
import { useReviewSessionStore } from '../../review/store/useReviewSessionStore';
import { useMemoryStore } from '../../review/store/useMemoryStore';
import { useAppModeStore } from '../../../hooks/useAppModeStore';
import { useStreakStore } from '../../streak/store/useStreakStore';

const BASE: WrongWordEntry = {
  cardId: 'lg-x',
  lexemeGroupId: 'lg-x',
  lemma: 'x',
  language: 'en',
  wrongCount: 1,
  lastWrongAt: 0,
  firstWrongAt: 0,
};

function makeCard(id: string, lemma: string, language: 'en' | 'de'): MemoryCard {
  return {
    id,
    lexemeGroupId: id,
    lemma,
    objectiveDifficulty: 2,
    language,
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

beforeEach(() => {
  useWrongWordsStore.setState({ entries: [] });
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
  useAppModeStore.getState().reset();
  useStreakStore.setState({ lastStudyDate: null, currentStreak: 0, longestStreak: 0 });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('WrongWordsSection 复习错词入口 (v1.0.0 Stage 3, T04)', () => {
  it('T04a: N>0 渲染按钮, 点击触发 startWrongWordsReview (mode→reviewing)', () => {
    useMemoryStore.setState({
      cards: new Map([
        ['lg-apple', makeCard('lg-apple', 'apple', 'en')],
        ['lg-banana', makeCard('lg-banana', 'banana', 'de')],
      ]),
      dueCardsIndex: null,
      cardsByLanguageIndex: null,
    });
    useWrongWordsStore.setState({
      entries: [
        { ...BASE, cardId: 'lg-apple', lexemeGroupId: 'lg-apple', lemma: 'apple', language: 'en', lastWrongAt: 1000 },
        { ...BASE, cardId: 'lg-banana', lexemeGroupId: 'lg-banana', lemma: 'banana', language: 'de', lastWrongAt: 9000 },
      ],
    });

    render(<WrongWordsSection />);

    const btn = screen.getByRole('button', { name: '复习错词 (2)' });
    expect(btn).toBeInTheDocument();

    fireEvent.click(btn);

    // 状态副作用断言: 进入定向复习会话
    const s = useReviewSessionStore.getState();
    expect(s.mode).toBe('reviewing');
    expect(s.queue).toHaveLength(2);
    expect(s.startedAt).toBeGreaterThan(0);
  });

  it('T04b: N=0 (空态) 不渲染按钮', () => {
    useWrongWordsStore.setState({ entries: [] });

    render(<WrongWordsSection />);

    expect(screen.queryByRole('button', { name: /复习错词/ })).not.toBeInTheDocument();
    expect(screen.getByText('暂无错词记录，复习中答错的词会自动收录')).toBeInTheDocument();
  });
});
