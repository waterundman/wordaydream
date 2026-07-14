/**
 * v2.2.0 Stage 1 (D4): Mock passage source 标签 + 难度路由测试.
 *
 * 覆盖 test_spec:
 * - T01 [critical]: Passage.source 类型断言 ('llm' | 'mock' | 'mixed' | undefined)
 * - T02 [critical]: getMockPassage('en', 2) 返回 source: 'mock'
 * - T03 [critical]: getMockPassage('de', 3) 返回 source: 'mock'
 * - T04 [critical]: getMockPassage('en', 5) (C1) 返回 B2 数据 + source: 'mock'
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Passage } from '../types';
import {
  getMockPassage,
  clearMockPassageCache,
  mockEnglishPassage,
  mockEnglishPassageB1,
  mockEnglishPassageB2,
  mockGermanPassageA2,
  mockGermanPassage,
  mockGermanPassageB2,
} from './passages';

describe('v2.2.0 Stage 1 (D4): Mock passage source 标签', () => {
  beforeEach(() => {
    clearMockPassageCache();
  });

  it('T01 [critical]: Passage.source 类型支持 "llm" | "mock" | "mixed" | undefined', () => {
    // 类型层面验证: 以下赋值不应产生 TypeScript 错误
    const p1: Passage = { ...mockEnglishPassage, source: 'llm' };
    const p2: Passage = { ...mockEnglishPassage, source: 'mock' };
    const p3: Passage = { ...mockEnglishPassage, source: 'mixed' };
    const p4: Passage = { ...mockEnglishPassage, source: undefined };

    expect(p1.source).toBe('llm');
    expect(p2.source).toBe('mock');
    expect(p3.source).toBe('mixed');
    expect(p4.source).toBeUndefined();
  });

  it('T02 [critical]: getMockPassage("en", 2) 返回 source: "mock"', () => {
    const passage = getMockPassage('en', 2);
    expect(passage.source).toBe('mock');
    expect(passage.language).toBe('en');
    expect(passage.difficulty).toBe(2);
    // 验证返回的是 A2 mock (mockEnglishPassage)
    expect(passage.id).toBe(mockEnglishPassage.id);
  });

  it('T03 [critical]: getMockPassage("de", 3) 返回 source: "mock"', () => {
    const passage = getMockPassage('de', 3);
    expect(passage.source).toBe('mock');
    expect(passage.language).toBe('de');
    expect(passage.difficulty).toBe(3);
    // 验证返回的是 B1 mock (mockGermanPassage, difficulty 3)
    expect(passage.id).toBe(mockGermanPassage.id);
  });

  it('T04 [critical]: getMockPassage("en", 5) (C1) 返回 B2 数据 + source: "mock"', () => {
    const passage = getMockPassage('en', 5);
    expect(passage.source).toBe('mock');
    expect(passage.language).toBe('en');
    // difficulty 应被覆写为请求的 5 (C1)
    expect(passage.difficulty).toBe(5);
    // 基础 mock 是 B2 (mockEnglishPassageB2), 但 difficulty 被设为 5
    expect(passage.id).toBe(mockEnglishPassageB2.id);
    // tokens 应来自 B2 mock, 但经过难度过滤 (保留 difficulty 4-5 的 tokens)
    expect(passage.tokens.length).toBeGreaterThan(0);
    // 所有保留的 token 的 objectiveDifficulty 应在 [4, 5] 范围内 (±1 过滤: difficulty=5, 范围 4-5)
    for (const tok of passage.tokens) {
      expect(tok.objectiveDifficulty).toBeGreaterThanOrEqual(4);
      expect(tok.objectiveDifficulty).toBeLessThanOrEqual(5);
    }
  });

  it('扩展: 所有导出的 mock passage 都有 source: "mock"', () => {
    const allMocks = [
      mockEnglishPassage,
      mockEnglishPassageB1,
      mockEnglishPassageB2,
      mockGermanPassageA2,
      mockGermanPassage,
      mockGermanPassageB2,
    ];
    for (const m of allMocks) {
      expect(m.source).toBe('mock');
    }
  });

  it('扩展: getMockPassage 返回新对象 (调用方可安全 mutation)', () => {
    const p1 = getMockPassage('en', 2);
    p1.tokens[0].isResolved = true;
    const p2 = getMockPassage('en', 2);
    // 缓存命中, 但返回新对象, p1 的 mutation 不影响 p2
    expect(p2.tokens[0].isResolved).toBe(false);
  });

  it('扩展: getMockPassage("de", 4) 返回 B2 mock + source: "mock"', () => {
    const passage = getMockPassage('de', 4);
    expect(passage.source).toBe('mock');
    expect(passage.difficulty).toBe(4);
    expect(passage.id).toBe(mockGermanPassageB2.id);
  });
});
