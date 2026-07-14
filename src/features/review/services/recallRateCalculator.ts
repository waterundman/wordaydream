/**
 * v1.7.0 Stage 1: pacing 自适应核心.
 *
 * 基于 ratingHistory 计算近 7 天 recall 率, 映射到 pacing 阈值,
 * 替代 v1.6.0 的硬编码 LEARNING_THRESHOLD=30.
 *
 * 设计决策:
 * - D1: recall 率计算窗口 = 7 天
 * - D2: pacing 阈值 3 档 (recall<0.7 -> 15, 0.7-0.85 -> 30, >0.85 -> 45)
 * - D3: recall 数据来源 = ratingHistory rating 平均 (good/easy 视为成功)
 * - D7: 阈值运行时计算, 不持久化
 * - D8: 首次用户默认 pacing 基于难度估算 (diff 1->20, 2->30, 3->40, 4-5->50)
 */

import type { Rating, DifficultyLevel } from '../../../types';

/**
 * ratingHistory 条目类型 (与 useMemoryStore.ratingHistory 内联结构一致).
 * - at: 毫秒时间戳 (Date.now())
 * - rating: 'again' | 'hard' | 'good' | 'easy'
 */
export interface RatingEntry {
  cardId: string;
  rating: Rating;
  at: number;
}

/** recall 率计算窗口: 7 天 (毫秒) */
const RECALL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** ratingHistory 为空 / 近 7 天无数据时的默认 recall 率 (中档, 不走极端) */
const DEFAULT_RECALL_RATE = 0.85;

/**
 * v1.7.0 Stage 1: 计算近 7 天的 recall 率.
 *
 * recall 率 = rating 'good'/'easy' 占比 (视为成功回忆).
 * ratingHistory 为空或近 7 天无数据 -> 返回 0.85 (默认中档, 不走极端).
 *
 * @param ratingHistory - rating 历史记录 (来自 useMemoryStore.ratingHistory)
 * @param now - 当前时间 (测试注入, 默认 new Date())
 * @returns [0, 1] 区间的 recall 率
 */
export function getRecentRecallRate(
  ratingHistory: RatingEntry[],
  now: Date = new Date()
): number {
  const cutoff = now.getTime() - RECALL_WINDOW_MS;
  const recent = ratingHistory.filter((entry) => entry.at >= cutoff);

  if (recent.length === 0) return DEFAULT_RECALL_RATE;

  const successCount = recent.filter(
    (entry) => entry.rating === 'good' || entry.rating === 'easy'
  ).length;

  return successCount / recent.length;
}

/**
 * v1.7.0 Stage 1: 根据 recall 率映射到 pacing 阈值.
 *
 * 阈值含义: learning 词数 >= 此值时, passageGenerator 转入巩固模式.
 *
 * - 首次用户 (hasHistory=false): 基于难度估算
 *   diff 1 -> 20, 2 -> 30, 3 -> 40, 4-5 -> 50
 * - 有历史用户 (hasHistory=true): 基于 recall 率
 *   recall<0.7 -> 15 (低 recall, 降负荷)
 *   0.7<=recall<=0.85 -> 30 (中档, 默认)
 *   recall>0.85 -> 45 (高 recall, 升负荷)
 *
 * @param recallRate - getRecentRecallRate 返回值 [0, 1]
 * @param difficulty - 当前 passage 难度 (1-5), 首次用户时使用
 * @param hasHistory - 是否有 ratingHistory (false=首次用户)
 * @returns pacing 阈值 (learning 词数上限)
 */
export function getAdaptiveLearningThreshold(
  recallRate: number,
  difficulty?: DifficultyLevel,
  hasHistory?: boolean
): number {
  if (!hasHistory) {
    const diff = difficulty ?? 2;
    if (diff === 1) return 20;
    if (diff === 2) return 30;
    if (diff === 3) return 40;
    return 50; // diff 4-5
  }

  if (recallRate < 0.7) return 15;
  if (recallRate <= 0.85) return 30;
  return 45;
}
