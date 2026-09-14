/**
 * summarizeReadingHistory 测试 (v1.4.0 S3b)
 *
 * 覆盖 SPEC v1.4.0 合同 C3.3:
 * - T01 空历史 → 全零
 * - T02 [C3.3] 混合完成/未完成: totalSessions/completedSessions/
 *   totalResolved/completedResolved 区分正确
 * - T03 [C3.3] 7d 窗口边界 (now 注入): completedAt >= now-7d 计入, 更早不计
 * - T04 [C3.3] 语言分组: en/de 计数, undefined → other
 */
import { describe, expect, it } from 'vitest';
import type { HistoryEntry } from './store/useReadingHistoryStore';
import type { Passage, TokenOccurrence } from '../types';
import { summarizeReadingHistory, summarizeReadingSession } from './readingSummary';

function makeEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: 'h1',
    passage: { tokens: [] } as unknown as Passage,
    language: 'en',
    difficulty: 2,
    startedAt: 1000,
    resolvedCount: 5,
    totalTokenCount: 20,
    ...overrides,
  };
}

const NOW = 1_000_000_000_000;

describe('summarizeReadingHistory', () => {
  it('T01 空历史 → 全零', () => {
    const s = summarizeReadingHistory([], NOW);
    expect(s).toEqual({
      totalSessions: 0,
      completedSessions: 0,
      totalResolved: 0,
      completedResolved: 0,
      last7dSessions: 0,
      byLanguage: { en: 0, de: 0, other: 0 },
    });
  });

  it('T02 [C3.3] 混合完成/未完成: 计数与 resolved 求和区分正确', () => {
    const history = [
      makeEntry({ id: 'h1', completedAt: NOW - 1000, resolvedCount: 8, language: 'en' }),
      makeEntry({ id: 'h2', resolvedCount: 3, language: 'de' }), // 未完成
      makeEntry({ id: 'h3', completedAt: NOW - 2000, resolvedCount: 4, language: 'en' }),
    ];
    const s = summarizeReadingHistory(history, NOW);
    expect(s.totalSessions).toBe(3);
    expect(s.completedSessions).toBe(2);
    expect(s.totalResolved).toBe(15); // 8 + 3 + 4
    expect(s.completedResolved).toBe(12); // 8 + 4
    expect(s.byLanguage).toEqual({ en: 2, de: 0, other: 0 });
  });

  it('T03 [C3.3] 7d 窗口: completedAt >= now-7d 计入, 更早不计 (边界注入)', () => {
    const history = [
      makeEntry({ id: 'in-boundary', completedAt: NOW - 7 * 86_400_000 }), // 恰好边界 → 计入
      makeEntry({ id: 'inside', completedAt: NOW - 3 * 86_400_000 }), // 内部
      makeEntry({ id: 'outside', completedAt: NOW - 8 * 86_400_000 }), // 外部
    ];
    const s = summarizeReadingHistory(history, NOW);
    expect(s.completedSessions).toBe(3);
    expect(s.last7dSessions).toBe(2);
  });

  it('T04 [C3.3] 语言分组: undefined language → other', () => {
    const history = [
      makeEntry({ id: 'h1', completedAt: NOW, language: 'en' }),
      makeEntry({ id: 'h2', completedAt: NOW, language: 'de' }),
      makeEntry({ id: 'h3', completedAt: NOW, language: undefined as never }),
    ];
    const s = summarizeReadingHistory(history, NOW);
    expect(s.byLanguage).toEqual({ en: 1, de: 1, other: 1 });
  });
});

/**
 * summarizeReadingSession (v1.5.0 S1)
 *
 * 覆盖 SPEC v1.5.0 合同 C1.1-C1.3:
 * - T05 [C1.1] 混合 token (normal 对/错/未答 + review) → 四计数正确
 * - T06 [C1.2] 链接词形 (同 lexemeGroupId 多 occurrence) 只计一次;
 *   review 无 cardId → lexemeGroupId 兜底 distinct
 * - T07 [C1.3] 空 tokens → 全零
 */
function makeToken(overrides: Partial<TokenOccurrence> & { id: string }): TokenOccurrence {
  return {
    lexemeGroupId: overrides.id,
    surfaceForm: 'form',
    lemma: 'lemma',
    objectiveDifficulty: 2,
    startIndex: 0,
    endIndex: 4,
    isResolved: false,
    isActive: false,
    kind: 'normal',
    isCompound: false,
    ...overrides,
  } as TokenOccurrence;
}

describe('summarizeReadingSession', () => {
  it('T05 [C1.1] 混合 token: 对/错(partial 归答错)/未答/review 四计数正确', () => {
    const tokens = [
      makeToken({ id: 't1', lexemeGroupId: 'g1', isResolved: true, resolvedGrade: 'correct' }),
      makeToken({ id: 't2', lexemeGroupId: 'g2', isResolved: true, resolvedGrade: 'wrong' }),
      makeToken({ id: 't3', lexemeGroupId: 'g3', isResolved: true, resolvedGrade: 'partial' }), // 归答错侧
      makeToken({ id: 't4', lexemeGroupId: 'g4' }), // 未答
      makeToken({ id: 't5', lexemeGroupId: 'g5', kind: 'review', cardId: 'card-5', isResolved: true, resolvedGrade: 'correct' }),
    ];
    const s = summarizeReadingSession(tokens);
    expect(s).toEqual({
      totalWords: 4, // g1-g4 (review g5 不计)
      correctWords: 1, // g1
      wrongWords: 2, // g2 + g3 (partial)
      reviewWords: 1, // card-5
    });
  });

  it('T06 [C1.2] 链接词形只计一次 + review 无 cardId 按 lexemeGroupId 兜底', () => {
    const tokens = [
      // 同组多 occurrence (markOccurrenceResolved 组级 resolve, grade 一致)
      makeToken({ id: 'a1', lexemeGroupId: 'g-shared', isResolved: true, resolvedGrade: 'correct' }),
      makeToken({ id: 'a2', lexemeGroupId: 'g-shared', isResolved: true, resolvedGrade: 'correct' }),
      // review 无 cardId (手造数据防御) → lexemeGroupId 兜底
      makeToken({ id: 'r1', lexemeGroupId: 'g-review', kind: 'review' }),
      makeToken({ id: 'r2', lexemeGroupId: 'g-review', kind: 'review' }),
    ];
    const s = summarizeReadingSession(tokens);
    expect(s.totalWords).toBe(1);
    expect(s.correctWords).toBe(1);
    expect(s.wrongWords).toBe(0);
    expect(s.reviewWords).toBe(1); // 兜底后 distinct
  });

  it('T07 [C1.3] 空 tokens → 全零', () => {
    expect(summarizeReadingSession([])).toEqual({
      totalWords: 0,
      correctWords: 0,
      wrongWords: 0,
      reviewWords: 0,
    });
  });
});
