/**
 * RatingBar 快捷键角标测试 (v0.8.0-harmony Stage 1, SPEC §3/§5)
 *
 * 覆盖 test_spec:
 * - T05 [non-critical]: RatingBar 渲染 4 个评分按钮, 每个带快捷键角标 (1/2/3/4 文本存在)
 *
 * 设计:
 * - 直接渲染 RatingBar (隔离组件), 通过 useMemoryStore.setState 注入卡片,
 *   使 getRatingPreviews 返回 4 档预览 (非 null) → 4 个按钮均渲染.
 * - 断言文本 '1'/'2'/'3'/'4' 存在于 DOM (角标 span).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { RatingBar } from './RatingBar';
import { useMemoryStore } from '../store/useMemoryStore';
import type { MemoryCard } from '../../../types';

function makeCard(lexemeGroupId = 'lg-test'): MemoryCard {
  return {
    id: `card-test`,
    lexemeGroupId,
    lemma: 'test',
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

beforeEach(() => {
  // 清空 memory store 卡片, 避免跨测试泄漏
  useMemoryStore.setState({ cards: new Map<string, MemoryCard>() });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('RatingBar 快捷键角标 (Stage 1)', () => {
  it('T05: 渲染 4 个评分按钮的快捷键角标 1/2/3/4', () => {
    // 注入卡片使 getRatingPreviews 返回 4 档 (非 null)
    useMemoryStore.setState({ cards: new Map([['lg-test', makeCard('lg-test')]]) });

    const onRate = vi.fn();
    render(<RatingBar cardId="lg-test" onRate={onRate} />);

    // 每个评分按钮的 shortcut 角标文本
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });
});
