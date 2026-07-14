/**
 * v1.7.0 Stage 1: pacing 自适应核心 单元测试.
 *
 * 覆盖:
 * - T01: 7 天内 rating good/easy 占比 = recall 率
 * - T02: ratingHistory 为空 -> 返回 0.85 (默认中档)
 * - T03: recall<0.7 -> 阈值 15
 * - T04: recall 0.7-0.85 -> 阈值 30
 * - T05: recall>0.85 -> 阈值 45
 * - T06: 首次用户 (hasHistory=false) 基于难度估算
 */
import { describe, expect, it } from 'vitest';
import {
  getRecentRecallRate,
  getAdaptiveLearningThreshold,
  type RatingEntry,
} from './recallRateCalculator';

// ========== v1.7.0 Stage 1: pacing 自适应核心 ==========

describe('v1.7.0 Stage 1: pacing 自适应', () => {
  describe('getRecentRecallRate', () => {
    it('T01: 7 天内 rating good/easy 占比 = recall 率', () => {
      const now = new Date('2026-07-12T00:00:00Z');
      const DAY = 24 * 60 * 60 * 1000;
      const history: RatingEntry[] = [
        { cardId: 'c1', rating: 'good', at: now.getTime() - 1 * DAY },
        { cardId: 'c2', rating: 'easy', at: now.getTime() - 2 * DAY },
        { cardId: 'c3', rating: 'again', at: now.getTime() - 3 * DAY },
        { cardId: 'c4', rating: 'hard', at: now.getTime() - 4 * DAY },
      ];
      // 2 good/easy / 4 total = 0.5
      expect(getRecentRecallRate(history, now)).toBe(0.5);
    });

    it('T02: ratingHistory 为空 -> 返回 0.85 (默认中档)', () => {
      expect(getRecentRecallRate([], new Date())).toBe(0.85);
    });

    it('T02b: 近 7 天无数据 (全部超期) -> 返回 0.85 (默认中档)', () => {
      const now = new Date('2026-07-12T00:00:00Z');
      const DAY = 24 * 60 * 60 * 1000;
      const history: RatingEntry[] = [
        { cardId: 'c1', rating: 'good', at: now.getTime() - 8 * DAY },
        { cardId: 'c2', rating: 'easy', at: now.getTime() - 10 * DAY },
      ];
      // 全部超出 7 天窗口 -> 视为无近期数据
      expect(getRecentRecallRate(history, now)).toBe(0.85);
    });
  });

  describe('getAdaptiveLearningThreshold', () => {
    it('T03: recall<0.7 -> 15', () => {
      expect(getAdaptiveLearningThreshold(0.5, 2, true)).toBe(15);
      expect(getAdaptiveLearningThreshold(0.69, 2, true)).toBe(15);
    });

    it('T04: recall 0.7-0.85 -> 30', () => {
      expect(getAdaptiveLearningThreshold(0.7, 2, true)).toBe(30);
      expect(getAdaptiveLearningThreshold(0.85, 2, true)).toBe(30);
      expect(getAdaptiveLearningThreshold(0.78, 2, true)).toBe(30);
    });

    it('T05: recall>0.85 -> 45', () => {
      expect(getAdaptiveLearningThreshold(0.86, 2, true)).toBe(45);
      expect(getAdaptiveLearningThreshold(1.0, 2, true)).toBe(45);
    });

    it('T06: 首次用户 (hasHistory=false) 基于难度估算', () => {
      expect(getAdaptiveLearningThreshold(0.85, 1, false)).toBe(20);
      expect(getAdaptiveLearningThreshold(0.85, 2, false)).toBe(30);
      expect(getAdaptiveLearningThreshold(0.85, 3, false)).toBe(40);
      expect(getAdaptiveLearningThreshold(0.85, 4, false)).toBe(50);
      expect(getAdaptiveLearningThreshold(0.85, 5, false)).toBe(50);
      // 默认 difficulty=2
      expect(getAdaptiveLearningThreshold(0.85, undefined, false)).toBe(30);
    });
  });
});
