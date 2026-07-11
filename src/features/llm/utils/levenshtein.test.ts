/**
 * Levenshtein 距离单元测试 (Stage 2 — L01..L07)
 *
 * 覆盖 SPEC 要求 7 个边界 case:
 * - L01: 相同字符串 -> 0
 * - L02: 空字符串 -> 另一字符串长度
 * - L03: "kitten" -> "sitting" -> 3 (标准例子)
 * - L04: 单字符差 "abc" -> "abd" -> 1
 * - L05: 完全替换 "abc" -> "def" -> 3
 * - L06: 大小写差异 "Hello" -> "hello" -> 1
 * - L07: Unicode 边界 "ä" -> "a" -> 1 (单 code unit diff)
 */
import { describe, expect, it } from 'vitest';
import { levenshtein } from './levenshtein';

describe('levenshtein (Stage 2)', () => {
  it('L01: 相同字符串 -> 0', () => {
    expect(levenshtein('', '')).toBe(0);
    expect(levenshtein('a', 'a')).toBe(0);
    expect(levenshtein('hello', 'hello')).toBe(0);
    expect(levenshtein('今天天气很好', '今天天气很好')).toBe(0);
  });

  it('L02: 空字符串 -> 另一字符串长度', () => {
    expect(levenshtein('', 'a')).toBe(1);
    expect(levenshtein('a', '')).toBe(1);
    expect(levenshtein('', 'hello')).toBe(5);
    expect(levenshtein('hello', '')).toBe(5);
    expect(levenshtein('', '中文')).toBe(2);
  });

  it('L03: kitten -> sitting -> 3 (Wikipedia 标准例子)', () => {
    // k -> s (substitute), e -> i (substitute), append g
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('sitting', 'kitten')).toBe(3);
  });

  it('L04: 单字符差 abc -> abd -> 1', () => {
    // 仅 c -> d 一次 substitute
    expect(levenshtein('abc', 'abd')).toBe(1);
    expect(levenshtein('cat', 'bat')).toBe(1); // c -> b
    expect(levenshtein('cat', 'cats')).toBe(1); // append s
    expect(levenshtein('cats', 'cat')).toBe(1); // delete s
  });

  it('L05: 完全替换 abc -> def -> 3', () => {
    // a -> d, b -> e, c -> f (3 substitutes)
    expect(levenshtein('abc', 'def')).toBe(3);
    expect(levenshtein('xxx', 'yyy')).toBe(3);
  });

  it('L06: 大小写差异 Hello -> hello -> 1', () => {
    // H -> h (1 substitute)
    expect(levenshtein('Hello', 'hello')).toBe(1);
    expect(levenshtein('hello', 'Hello')).toBe(1);
  });

  it('L07: Unicode 边界 "ä" -> "a" -> 1 (单 code unit diff)', () => {
    // 'ä' (U+00E4) -> 'a' (U+0061) 是单 code unit substitute
    // 注: 我们按 code unit 算, 不按 grapheme; 这是与 String.indexOf 一致的约定
    expect(levenshtein('ä', 'a')).toBe(1);
    expect(levenshtein('ä', 'ä')).toBe(0);
    // 'Müller' (6 char) -> 'Muller' (6 char): 仅 ü -> u 1 次 substitute
    expect(levenshtein('Müller', 'Muller')).toBe(1);
    // 'Bär' (3) -> 'Bar' (3): 仅 ä -> a 1 次 substitute
    expect(levenshtein('Bär', 'Bar')).toBe(1);
  });
});
