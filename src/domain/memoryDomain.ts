/**
 * v2.0.0 Stage 1: 记忆卡片领域纯函数层.
 *
 * 本模块为 PURE FUNCTIONS 集合, 包装 schedulerAdapter:
 * - 0 import from 'zustand' / 'react' (Contract 54)
 * - 无 store.getState() / set() 调用
 * - 允许 import schedulerAdapter (SPEC 明确允许)
 *
 * 为上层 (store / UI) 提供与 scheduler 解耦的稳定领域入口,
 * Stage 2 store 重构后将调用本模块而非直接调用 schedulerAdapter.
 */

import {
  createInitialMemoryCard,
  scheduleNextReview,
  getRetrievability,
} from '../features/review/services/schedulerAdapter';
import type { MemoryCard, TokenOccurrence, Rating, Language, ReviewUpdate } from '../types';

/**
 * 从 TokenOccurrence 创建初始 MemoryCard.
 * 包装 createInitialMemoryCard, 用 token 的 lexemeGroupId / lemma / objectiveDifficulty.
 */
export function createMemoryCardFromToken(token: TokenOccurrence, language?: Language): MemoryCard {
  return createInitialMemoryCard(
    token.lexemeGroupId,
    token.lemma,
    token.objectiveDifficulty,
    language
  );
}

/**
 * 对卡片进行一次复习评分, 返回更新后的 ReviewUpdate.
 * 包装 scheduleNextReview.
 */
export function scheduleCardReview(card: MemoryCard, rating: Rating, now: Date = new Date()): ReviewUpdate {
  return scheduleNextReview(card, rating, now);
}

/**
 * 获取卡片当前的 retrievability (回忆概率 [0,1]).
 * 包装 getRetrievability.
 */
export function getCardRetrievability(card: MemoryCard, now: Date = new Date()): number {
  return getRetrievability(card, now);
}
