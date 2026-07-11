/**
 * 难度顾问 (Difficulty Advisor)
 *
 * 阶段 1 数据层: 根据用户在当前难度等级的统计,
 * 给出"升级 / 降级 / 不变"建议。
 *
 * 设计原则:
 * - 纯函数, 不引用 store, 不修改 state
 * - 数据不足时返回 null (调用方据此判断是否提示)
 * - 仅当两个条件都满足 (累计 + 掌握率/错误率) 时才给出方向,
 *   避免样本不足导致误判
 */
import type { DifficultyLevel } from '../../../types';

/**
 * 用户在当前难度等级下的统计快照
 *
 * 由调用方从 reading / memory store 派生:
 * - `totalAtLevel`: 在该等级学习过的累计词数
 * - `masteredAtLevel`: 其中已掌握的词数 (FSRS 复习状态 >= review)
 * - `errorRate`: 该等级答题错误率 (0-1, 答错/总题数)
 * - `avgDifficulty`: 平均客观难度 (保留字段, 后续阶段可能用于 LLM 混合判断)
 */
export interface DifficultyStats {
  /** 在当前等级的累计词数 */
  totalAtLevel: number;
  /** 在当前等级已掌握的词数 */
  masteredAtLevel: number;
  /** 错误率 0-1 */
  errorRate: number;
  /** 平均难度 (unused but reserved) */
  avgDifficulty: number;
}

/**
 * 给出难度调整建议
 *
 * 返回值:
 * - `null`: 数据不足或不满足任一条件, 保持当前难度
 * - `currentLevel + 1` (若 < 5): 建议升级
 * - `currentLevel - 1` (若 > 1): 建议降级
 *
 * 判定顺序: 先升级 (条件 1) 再降级 (条件 2),
 * 但两者阈值互斥, 同一份 stats 不会同时满足。
 */
export function suggests(
  currentLevel: DifficultyLevel,
  stats: DifficultyStats,
): DifficultyLevel | null {
  // 数据不足: 累计不足 30 个词时不给建议, 避免早期抖动
  if (stats.totalAtLevel < 30) return null;

  // 条件 1: 累计 >= 50 且 掌握率 >= 80% -> 升级
  if (stats.totalAtLevel >= 50) {
    const masteryRate = stats.masteredAtLevel / stats.totalAtLevel;
    if (masteryRate >= 0.8 && currentLevel < 5) {
      return (currentLevel + 1) as DifficultyLevel;
    }
  }

  // 条件 2: 错误率 >= 40% 且 累计 >= 30 -> 降级
  if (stats.errorRate >= 0.4 && currentLevel > 1) {
    return (currentLevel - 1) as DifficultyLevel;
  }

  return null;
}
