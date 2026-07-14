/**
 * repairTruncatedJson 单元测试 (v2.1.1 Stage 1: D8 截断 JSON 修复层)
 *
 * 覆盖 SPEC Stage 1 要求 6 个 case:
 * - T01 [critical]: 完整 JSON 原样返回 (JSON.parse 成功)
 * - T02 [critical]: 截断的 JSON 数组找到最后一个深度0的 ] 截断
 * - T03 [critical]: 截断的 JSON 对象找到最后一个深度0的 } 截断
 * - T04 [critical]: 字符串内的括号不误判深度 (inString 状态跟踪)
 * - T05 [critical]: 完全无法修复的输入返回原字符串 (不抛错)
 * - T06 [critical]: parseLLMResponse 内部调用 repairTruncatedJson (在 jsonrepair 之前)
 *
 * 设计:
 * - 直接 import repairTruncatedJson + parseLLMResponse 测试核心解析逻辑
 * - T06 验证集成: 截断的 passage 响应经 repairTruncatedJson 修复后走 zod 校验
 * - useAnalyticsStore 提前 import, 重置 repair 计数避免跨用例污染
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseLLMResponse, repairTruncatedJson } from './jsonParser';
import { useAnalyticsStore } from '../../analytics/store/useAnalyticsStore';

describe('repairTruncatedJson (v2.1.1 Stage 1: D8 截断 JSON 修复层)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 重置 analytics 计数, 避免跨用例污染
    useAnalyticsStore.setState({ llmRepairCount: 0 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('T01: 完整 JSON 原样返回', () => {
    const raw = '{"a": 1, "b": [2, 3]}';
    expect(repairTruncatedJson(raw)).toBe(raw);
  });

  it('T02: 截断的 JSON 数组找到最后一个深度0的 ] 截断', () => {
    // 完整应该是 [{"a":1},{"b":2},{"c":3}]，截断在 "c" 中间
    const truncated = '[{"a":1},{"b":2},{"c":3';
    const repaired = repairTruncatedJson(truncated);
    // 期望返回到最后一个深度0的位置，即 [{"a":1},{"b":2}]
    expect(repaired).toBe('[{"a":1},{"b":2}]');
    expect(() => JSON.parse(repaired)).not.toThrow();
  });

  it('T03: 截断的 JSON 对象找到最后一个深度0的 } 截断', () => {
    // 完整应该是 {"items":[{"x":1},{"y":2}],"meta":{"z":3}}，截断在 "z" 中间
    const truncated = '{"items":[{"x":1},{"y":2}],"meta":{"z":3';
    const repaired = repairTruncatedJson(truncated);
    // 期望返回到最后一个深度0的位置，即 {"items":[{"x":1},{"y":2}]}
    expect(repaired).toBe('{"items":[{"x":1},{"y":2}]}');
    expect(() => JSON.parse(repaired)).not.toThrow();
  });

  it('T04: 字符串内的括号不误判深度', () => {
    // 字符串内的 { } [ ] 不影响深度计算
    const truncated = '{"text":"hello {world} [foo]","next":"bar';
    const repaired = repairTruncatedJson(truncated);
    // 第一个深度0的 } 出现在 "}" 之后 (字符串内的不算)
    // 实际整个对象从未闭合，第一个 } 之前字符串内 { 已经抵消了
    // 但字符串内 { } 不增加 depth, 所以扫描时 depth 一直是 1 直到第一个 } (闭合对象)
    // 但第一个 } 在字符串内，所以不应该闭合
    // 期望: 没有有效闭合点，返回原字符串
    expect(repaired).toBe(truncated);
  });

  it('T05: 完全无法修复的输入返回原字符串', () => {
    // 不是 JSON，没有闭合括号
    const invalid = 'this is not json at all';
    expect(repairTruncatedJson(invalid)).toBe(invalid);

    // 空字符串
    expect(repairTruncatedJson('')).toBe('');

    // 只有开始括号
    expect(repairTruncatedJson('{')).toBe('{');
    expect(repairTruncatedJson('[')).toBe('[');
  });

  it('T06: parseLLMResponse 内部调用 repairTruncatedJson 在 jsonrepair 之前', () => {
    // 截断的 passage 响应
    const truncatedPassage =
      '{"text":"hello world","tokens":[{"lemma":"hello","surfaceForm":"hello","startIndex":0,"endIndex":5,"partOfSpeech":"word"},{"lemma":"world","surfaceForm":"wor';
    const result = parseLLMResponse(truncatedPassage);
    // 期望 repairTruncatedJson 截断到第一个完整对象，parseLLMResponse 走 zod 校验
    // tokens 数组被截断, 修复后应保留 [{"lemma":"hello",...}] (第一个完整 token)
    expect(result.ok).toBe(true);
    expect(result.data?.text).toBe('hello world');
    expect(result.data?.tokens.length).toBe(1);
    expect(result.data?.tokens[0].surfaceForm).toBe('hello');
    expect(result.repaired).toBe(true);
  });
});
