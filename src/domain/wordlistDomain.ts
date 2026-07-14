/**
 * v2.0.0 Stage 1: 词表领域纯函数层 (canonical source).
 *
 * 本模块为 PURE FUNCTIONS 集合:
 * - 0 import from 'zustand' / 'react' (Contract 53)
 * - 无 store.getState() / set() 调用
 * - 无 React hooks
 *
 * 将原 useWordlistStore 内部的 deriveStatus / makeProgress / syncFromMemoryCards
 * 逻辑提取为纯函数, 供 Stage 2 store 重构复用.
 *
 * WordStatus / WordProgress 在此定义为 canonical source (Stage 2 将由 store re-export).
 */

import type { MemoryCard } from '../types';
import { getRetrievability } from '../features/review/services/schedulerAdapter';

export type WordStatus = 'unseen' | 'learning' | 'mastered';

/** v2: 带语境追踪的单词进度 */
export interface WordProgress {
  status: WordStatus;
  /** 在不同 passage 中答对的次数 (按 passageId 去重, 同一篇只算一次) */
  encounterCount: number;
  /** 最近一次计数的 passageId, 用于去重 */
  lastEncounterPassageId: string | null;
  /** 首次遇到的时间戳 */
  firstEncounteredAt: number;
  /** 最近一次遇到的时间戳 */
  lastEncounteredAt: number;
}

/**
 * v2: 从 MemoryCard + 现有 progress 派生 WordStatus
 * - new → unseen (词表中存在但用户从未学过)
 * - review && reps>=2 && encounterCount>=2 → mastered 候选, 再判衰减:
 *   - 若 getRetrievability(card) < 0.9 → 降级 learning
 * - learning / relearning / review&&reps<2 / encounterCount<2 → learning
 */
export function deriveStatus(progress: WordProgress | undefined, card: MemoryCard): WordStatus {
  const enc = progress?.encounterCount ?? 0;
  if (card.status === 'new') return 'unseen';
  if (card.status === 'review' && card.reps >= 2 && enc >= 2) {
    // v1.6.1 Stage 1: retrievability 衰减判定 — 替代原 30 天窗口硬编码
    if (getRetrievability(card) < 0.9) {
      return 'learning';
    }
    return 'mastered';
  }
  return 'learning';
}

/** 构造一个默认的 WordProgress (用于首次创建, 保留 existing 的 encounter 追踪字段) */
export function makeProgress(status: WordStatus, existing?: WordProgress): WordProgress {
  return {
    status,
    encounterCount: existing?.encounterCount ?? 0,
    lastEncounterPassageId: existing?.lastEncounterPassageId ?? null,
    firstEncounteredAt: existing?.firstEncounteredAt ?? 0,
    lastEncounteredAt: existing?.lastEncounteredAt ?? 0,
  };
}

/**
 * PURE 函数版 syncFromMemoryCards:
 * 接收 cards 与现有 progress, 返回派生后的新 progress (不调用任何 store).
 * - 跳过无 language 的 card
 * - key = `${language}:${card.lemma.toLowerCase()}`
 * - 仅更新 status, 保留 encounter 追踪字段
 */
export function syncFromMemoryCards(
  cards: Map<string, MemoryCard>,
  progress: Record<string, WordProgress>
): Record<string, WordProgress> {
  const newProgress: Record<string, WordProgress> = { ...progress };
  for (const card of cards.values()) {
    const language = card.language;
    if (!language) continue;
    const key = `${language}:${card.lemma.toLowerCase()}`;
    const existing = newProgress[key];
    const status = deriveStatus(existing, card);
    // 保留 encounter 追踪字段, 仅更新 status
    newProgress[key] = makeProgress(status, existing);
  }
  return newProgress;
}
