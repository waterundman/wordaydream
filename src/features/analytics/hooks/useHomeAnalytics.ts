/**
 * 主页分析数据 hook (Wordaydream v1.0.0 数据层)
 *
 * 派生来源: useMemoryStore.cards (Map<lexemeGroupId, MemoryCard>)
 *
 * 输出字段 (Stage 1 SPEC E1):
 * - `total`: cards.size, 词条总数
 * - `totalLearned`: cards 中 status !== 'new' 的数量, 排除纯新词
 * - `mastered`: status === 'review' 且 reps >= 2 的数量, 复用 v0.9.0 FSRS 状态语义
 * - `masteryRate`: total > 0 ? mastered / total : 0
 * - `byLevel`: 按 objectiveDifficulty 分桶计数 (key 1..5)
 * - `byStatus`: 各 FSRS 状态计数 (new / learning / review / relearning)
 *
 * 缓存策略:
 * - 用 Zustand selector 订阅 cards 引用变化
 * - cards 内容不变时, useMemo 复用上次派生结果
 *
 * 用法:
 * ```ts
 * const { totalLearned, mastered, masteryRate, byLevel } = useHomeAnalytics();
 * ```
 */
import { useMemo } from 'react';
import { useMemoryStore } from '../../review/store/useMemoryStore';
import type { DifficultyLevel, MemoryCard } from '../../../types';

/** FSRS 状态统计桶 (与 MemoryCard['status'] 保持一致) */
export type StatusBuckets = Record<MemoryCard['status'], number>;

/** 难度等级统计桶 (key = DifficultyLevel 1-5) */
export type LevelBuckets = Record<DifficultyLevel, number>;

export interface HomeAnalytics {
  /** 词条总数 */
  total: number;
  /** 已学习词数 (排除 status === 'new') */
  totalLearned: number;
  /** 已掌握词数 (status === 'review' && reps >= 2) */
  mastered: number;
  /** 掌握率, total=0 时为 0 */
  masteryRate: number;
  /** 各难度等级词数 */
  byLevel: LevelBuckets;
  /** 各 FSRS 状态词数 */
  byStatus: StatusBuckets;
}

const EMPTY_BY_LEVEL: LevelBuckets = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
const EMPTY_BY_STATUS: StatusBuckets = {
  new: 0,
  learning: 0,
  review: 0,
  relearning: 0,
};

const EMPTY_RESULT: HomeAnalytics = {
  total: 0,
  totalLearned: 0,
  mastered: 0,
  masteryRate: 0,
  byLevel: EMPTY_BY_LEVEL,
  byStatus: EMPTY_BY_STATUS,
};

export function useHomeAnalytics(): HomeAnalytics {
  const cards = useMemoryStore((s) => s.cards);

  return useMemo<HomeAnalytics>(() => {
    if (cards.size === 0) {
      return EMPTY_RESULT;
    }

    const byLevel: LevelBuckets = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    const byStatus: StatusBuckets = {
      new: 0,
      learning: 0,
      review: 0,
      relearning: 0,
    };
    let totalLearned = 0;
    let mastered = 0;
    const total = cards.size;

    for (const card of cards.values()) {
      const level = card.objectiveDifficulty;
      if (level >= 1 && level <= 5) {
        byLevel[level as DifficultyLevel] += 1;
      }
      byStatus[card.status] += 1;
      if (card.status !== 'new') {
        totalLearned += 1;
      }
      if (card.status === 'review' && card.reps >= 2) {
        mastered += 1;
      }
    }

    const masteryRate = total > 0 ? mastered / total : 0;

    return {
      total,
      totalLearned,
      mastered,
      masteryRate,
      byLevel,
      byStatus,
    };
  }, [cards]);
}
