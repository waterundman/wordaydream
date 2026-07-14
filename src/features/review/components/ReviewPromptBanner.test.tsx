/**
 * ReviewPromptBanner 测试 (v2.1.0 Stage 3, Contract 65)
 *
 * 覆盖 test_spec:
 * - T12 [unit]: ReviewPromptBanner 不再调用 setInterval (改用 subscribe)
 * - T13 [unit]: subscribe('memory:cards-updated') + publish → dueCount 更新
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { ReviewPromptBanner } from './ReviewPromptBanner';
import { useMemoryStore } from '../store/useMemoryStore';
import { publish, clearAllListeners } from '../../../domain/events';
import type { MemoryCard } from '../../../types';

describe('ReviewPromptBanner v2.1.0 Stage 3 (Contract 65)', () => {
  let originalGetDueCards: ReturnType<typeof useMemoryStore.getState>['getDueCards'];

  beforeEach(() => {
    clearAllListeners();
    originalGetDueCards = useMemoryStore.getState().getDueCards;
  });

  afterEach(() => {
    cleanup();
    clearAllListeners();
    useMemoryStore.setState({ getDueCards: originalGetDueCards } as never);
  });

  it('T12: does not use setInterval', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    render(<ReviewPromptBanner language="en" onGenerate={() => {}} />);
    expect(setIntervalSpy).not.toHaveBeenCalled();
    setIntervalSpy.mockRestore();
  });

  it('T13: subscribe memory:cards-updated → publish triggers dueCount update', () => {
    let mockDueCards: MemoryCard[] = [];
    const mockGetDueCards = vi.fn(() => mockDueCards);
    useMemoryStore.setState({ getDueCards: mockGetDueCards } as never);

    render(<ReviewPromptBanner language="en" onGenerate={() => {}} />);

    // dueCount=0 → hintLine shown, banner not shown
    expect(screen.getByText('积累中 · 换一篇')).toBeInTheDocument();
    expect(screen.queryByText('开始复习')).not.toBeInTheDocument();

    // Change mock return value (function reference unchanged → useEffect not re-triggered)
    mockDueCards = [{ id: '1' } as MemoryCard, { id: '2' } as MemoryCard];

    // Publish event → subscriber calls getDueCards → returns 2 → setDueCount(2)
    // act() ensures React processes the state update before assertions
    act(() => {
      publish('memory:cards-updated', { cards: new Map(), isReview: false });
    });

    // dueCount=2 → banner shown with count
    expect(screen.getByText('开始复习')).toBeInTheDocument();
    expect(screen.queryByText('积累中 · 换一篇')).not.toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });
});
