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
import type { Passage } from '../types';
import { summarizeReadingHistory } from './readingSummary';

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
