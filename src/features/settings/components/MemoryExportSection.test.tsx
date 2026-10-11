/**
 * MemoryExportSection 单测 (v1.6.6)
 *
 * 钉住两件事:
 * - 空记忆库不给死按钮 (不渲染导出入口)
 * - 有卡片时导出入口出现, 且文案里的数量来自 store (不是硬编码)
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryExportSection } from './MemoryExportSection';
import { useMemoryStore } from '../../review/store/useMemoryStore';
import type { MemoryCard } from '../../../types';

function makeCard(lexemeGroupId: string): MemoryCard {
  return {
    id: `card-${lexemeGroupId}`,
    lexemeGroupId,
    lemma: lexemeGroupId,
    objectiveDifficulty: 2,
    language: 'en',
    firstLearnedAt: 0,
    lastReviewAt: 0,
    learningSteps: 0,
    due: 0,
    stability: 0,
    difficulty: 5,
    elapsedDays: 0,
    scheduledDays: 0,
    reps: 1,
    lapses: 0,
    status: 'learning',
  };
}

beforeEach(() => {
  useMemoryStore.setState({ cards: new Map(), dueCardsIndex: null, cardsByLanguageIndex: null });
});

describe('MemoryExportSection', () => {
  it('T01: 空记忆库 → 引导文案, 且不渲染导出按钮', () => {
    render(<MemoryExportSection />);

    expect(screen.getByTestId('memory-export-section')).toBeInTheDocument();
    expect(screen.getByText(/先在阅读页答对一个词/)).toBeInTheDocument();
    expect(screen.queryByLabelText('导出词汇')).toBeNull();
  });

  it('T02: 有 3 张卡 → 导出入口出现, 文案数量取自 store', () => {
    useMemoryStore.setState({
      cards: new Map([
        ['g1', makeCard('g1')],
        ['g2', makeCard('g2')],
        ['g3', makeCard('g3')],
      ]),
    });

    render(<MemoryExportSection />);

    expect(screen.getByText(/全部 3 张 FSRS 卡片/)).toBeInTheDocument();
    expect(screen.getByLabelText('导出词汇')).toBeInTheDocument();
  });
});
