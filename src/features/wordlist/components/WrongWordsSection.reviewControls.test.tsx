/**
 * WrongWordsSection 复习控件 + 列表筛选测试 (v1.1.0 Stage 2)
 *
 * 覆盖 test_spec:
 * - T01 [critical]: 控件联动 — 选 mostWrong+10 → 按钮文案 "复习错词 (10 · 最常错)",
 *   点击触发 startWrongWordsReview ({ sort: 'mostWrong', limit: 10 })
 *   (状态副作用断言: mode reviewing + queue 长度 1 — 预置 3 条错词但仅 1 张卡存在,
 *   已删卡在反查时丢弃)
 * - T02: 语言筛选 — 预置 en + de + language undefined 条目, 选 'en' → 列表只见 en 条目
 * - T03: 筛选后复习按钮 N 不变 (恒为全量有效条目数)
 * - T06: 空错词本 — 控件组不渲染 (按钮/排序 select/数量 select 均无)
 *
 * 实现策略: 沿 WrongWordsSection.reviewEntry.test.tsx 惯例 — 直接渲染区块组件,
 * setState 预置 stores, 状态副作用断言不 spy 单例.
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

describe('WrongWordsSection 复习控件 (v1.1.0 Stage 2)', () => {
  it('T01: 选 mostWrong+10 → 文案联动, 点击传 {sort,limit} (queue=1, 已删卡丢弃)', () => {
    // 预置 3 条错词 (wrongCount 2/3/1), 但 cards Map 仅含 wrongCount=3 那张卡:
    // mostWrong 排序后该卡居首, limit=10 截断不影响, 另两条反查不到 (已删) → queue 长度 1.
    useMemoryStore.setState({
      cards: new Map([['lg-top', makeCard('lg-top', 'top', 'en')]]),
      dueCardsIndex: null,
      cardsByLanguageIndex: null,
    });
    useWrongWordsStore.setState({
      entries: [
        { ...BASE, cardId: 'lg-mid', lexemeGroupId: 'lg-mid', lemma: 'mid', language: 'de', wrongCount: 2, lastWrongAt: 5000, firstWrongAt: 1000 },
        { ...BASE, cardId: 'lg-top', lexemeGroupId: 'lg-top', lemma: 'top', language: 'en', wrongCount: 3, lastWrongAt: 9000, firstWrongAt: 2000 },
        { ...BASE, cardId: 'lg-low', lexemeGroupId: 'lg-low', lemma: 'low', language: 'en', wrongCount: 1, lastWrongAt: 3000, firstWrongAt: 3000 },
      ],
    });

    render(<WrongWordsSection />);

    const sortSelect = screen.getByLabelText('错词排序');
    const limitSelect = screen.getByLabelText('复习数量');
    expect(sortSelect).toBeInTheDocument();
    expect(limitSelect).toBeInTheDocument();

    fireEvent.change(sortSelect, { target: { value: 'mostWrong' } });
    fireEvent.change(limitSelect, { target: { value: '10' } });

    // 文案联动: 有限数量 → "复习错词 (limit · 排序名)"
    const btn = screen.getByRole('button', { name: '复习错词 (10 · 最常错)' });
    expect(btn).toBeInTheDocument();

    fireEvent.click(btn);

    const s = useReviewSessionStore.getState();
    expect(s.mode).toBe('reviewing');
    expect(s.queue).toHaveLength(1);
    expect(s.queue[0].id).toBe('lg-top');
    expect(s.startedAt).toBeGreaterThan(0);
  });

  it('T02: 语言筛选选 en → 列表只见 en 条目 (undefined 条目消失)', () => {
    useWrongWordsStore.setState({
      entries: [
        { ...BASE, cardId: 'c-en', lexemeGroupId: 'c-en', lemma: 'apple', language: 'en', lastWrongAt: 3000 },
        { ...BASE, cardId: 'c-de', lexemeGroupId: 'c-de', lemma: 'Banane', language: 'de', lastWrongAt: 2000 },
        { ...BASE, cardId: 'c-old', lexemeGroupId: 'c-old', lemma: 'legacy', language: undefined, lastWrongAt: 1000 },
      ],
    });

    render(<WrongWordsSection />);

    // 预置态: 3 条全部可见
    expect(screen.getAllByTestId('wrong-word-item')).toHaveLength(3);
    expect(screen.getByText('legacy')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('错词语言筛选'), { target: { value: 'en' } });

    const items = screen.getAllByTestId('wrong-word-item');
    expect(items).toHaveLength(1);
    expect(screen.getByText('apple')).toBeInTheDocument();
    expect(screen.queryByText('Banane')).not.toBeInTheDocument();
    expect(screen.queryByText('legacy')).not.toBeInTheDocument();
  });

  it('T03: 筛选后复习按钮 N 不变 (恒为全量有效条目数)', () => {
    useWrongWordsStore.setState({
      entries: [
        { ...BASE, cardId: 'c-en', lexemeGroupId: 'c-en', lemma: 'apple', language: 'en', lastWrongAt: 3000 },
        { ...BASE, cardId: 'c-de', lexemeGroupId: 'c-de', lemma: 'Banane', language: 'de', lastWrongAt: 2000 },
        { ...BASE, cardId: 'c-old', lexemeGroupId: 'c-old', lemma: 'legacy', language: undefined, lastWrongAt: 1000 },
      ],
    });

    render(<WrongWordsSection />);

    expect(screen.getByRole('button', { name: '复习错词 (3)' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('错词语言筛选'), { target: { value: 'en' } });

    // 列表只剩 1 条, 但按钮 N 恒为全量 3
    expect(screen.getAllByTestId('wrong-word-item')).toHaveLength(1);
    expect(screen.getByRole('button', { name: '复习错词 (3)' })).toBeInTheDocument();
    expect(screen.getByTestId('wrong-words-count')).toHaveTextContent('3');
  });

  it('T06: 空错词本 → 控件组不渲染 (按钮/排序 select/数量 select 均无)', () => {
    useWrongWordsStore.setState({ entries: [] });

    render(<WrongWordsSection />);

    expect(screen.queryByRole('button', { name: /复习错词/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('错词排序')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('复习数量')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('错词语言筛选')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('错词时间筛选')).not.toBeInTheDocument();
    expect(screen.getByText('暂无错词记录，复习中答错的词会自动收录')).toBeInTheDocument();
  });
});
