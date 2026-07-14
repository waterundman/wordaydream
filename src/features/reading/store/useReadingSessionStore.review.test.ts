/**
 * v2.2.2 Stage 1 (Bug 6): buildReviewTokens 词边界匹配单元测试.
 *
 * 覆盖 test_spec:
 * - T04 [critical]: "go" 不匹配 "good" 的子串 (词边界正则阻止子串误匹配)
 * - T05 [critical]: "go" 匹配独立的 "go" (前后为空格/标点)
 * - T06 [critical]: "go" 匹配句首 "Go" (大小写不敏感)
 */
import { describe, expect, it } from 'vitest';
import { buildReviewTokens } from './useReadingSessionStore';
import type { Passage, DifficultyLevel } from '../../../types';

function makePassage(text: string, tokens: Passage['tokens'] = []): Passage {
  return {
    id: 'test-passage-review',
    language: 'en',
    difficulty: 2 as DifficultyLevel,
    text,
    tokens,
    lexemeGroups: [],
    grammarPoints: [],
  };
}

function makeDueCard(
  overrides: Partial<{ lexemeGroupId: string; lemma: string; id: string; objectiveDifficulty: DifficultyLevel }> = {},
) {
  return {
    lexemeGroupId: overrides.lexemeGroupId ?? 'grp-go',
    lemma: overrides.lemma ?? 'go',
    id: overrides.id ?? 'card-go',
    objectiveDifficulty: overrides.objectiveDifficulty ?? (1 as DifficultyLevel),
  };
}

describe('buildReviewTokens v2.2.2 Bug 6: 词边界匹配', () => {
  it('T04: "go" 不匹配 "good" 的子串', () => {
    // "good" 包含 "go" 子串, 但词边界正则不应匹配
    const passage = makePassage('This is a good day.');
    const result = buildReviewTokens(passage, [makeDueCard({ lemma: 'go' })]);
    expect(result).toHaveLength(0);
  });

  it('T04b: "go" 不匹配 "going" / "ago" / "ago" 的子串', () => {
    const passage = makePassage('I was going a long time ago.');
    const result = buildReviewTokens(passage, [makeDueCard({ lemma: 'go' })]);
    // "going" 中 "go" 前面是空格但后面是 "i" (字母) -> 不匹配
    // "ago" 中 "go" 前面是 "a" (字母) -> 不匹配
    expect(result).toHaveLength(0);
  });

  it('T05: "go" 匹配独立的 "go" (前后为空格)', () => {
    const passage = makePassage('I will go home.');
    // "go" 在 index 7: I(0) (1)w(2)i(3)l(4)l(5) (6)g(7)o(8) (9)h(10)...
    const result = buildReviewTokens(passage, [makeDueCard({ lemma: 'go' })]);
    expect(result).toHaveLength(1);
    expect(result[0].startIndex).toBe(7);
    expect(result[0].endIndex).toBe(9);
    expect(result[0].surfaceForm).toBe('go');
    expect(result[0].kind).toBe('review');
    expect(result[0].isReview).toBe(true);
  });

  it('T06: "go" 匹配句首 "Go" (大小写不敏感)', () => {
    const passage = makePassage('Go now!');
    // "Go" 在 index 0: G(0)o(1) (2)n(3)o(4)w(5)!(6)
    const result = buildReviewTokens(passage, [makeDueCard({ lemma: 'go' })]);
    expect(result).toHaveLength(1);
    expect(result[0].startIndex).toBe(0);
    expect(result[0].endIndex).toBe(2);
    // surfaceForm 保留原文大小写
    expect(result[0].surfaceForm).toBe('Go');
  });

  it('T06b: 同一段文本中 "go" 匹配独立词但不匹配 "good" 子串', () => {
    const passage = makePassage('Go to the good store.');
    // G(0)o(1) (2)t(3)o(4) (5)t(6)h(7)e(8) (9)g(10)o(11)o(12)d(13) (14)...
    // "Go" at 0: 前无字符, 后跟空格 -> 匹配
    // "go" in "good" at 10: 前空格, 后跟 "o" (字母) -> 不匹配
    const result = buildReviewTokens(passage, [makeDueCard({ lemma: 'go' })]);
    expect(result).toHaveLength(1);
    expect(result[0].startIndex).toBe(0);
    expect(result[0].surfaceForm).toBe('Go');
  });

  it('T06c: 德语变音符词边界 (ü/ö/ä 作为字母边界)', () => {
    // "über" 作为独立词 (后跟句号), 验证变音符词能正确匹配且不被当作子串
    const passage = makePassage('Das ist über.');
    // "über" 在 index 8: D(0)a(1)s(2) (3)i(4)s(5)t(6) (7)ü(8)b(9)e(10)r(11).(12)
    const result = buildReviewTokens(passage, [makeDueCard({ lemma: 'über' })]);
    expect(result).toHaveLength(1);
    expect(result[0].surfaceForm).toBe('über');
    expect(result[0].startIndex).toBe(8);
  });
});
