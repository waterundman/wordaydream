/**
 * Alignment Validator 单元测试 (Stage 2 — T01..T08)
 *
 * 覆盖 SPEC 要求 8 个 case:
 * - T01 [critical]: exact match -> perfect
 * - T02 [critical]: case-insensitive match -> corrected
 * - T03 [critical]: fuzzy match (Levenshtein <= 2) -> corrected
 * - T04 [critical]: first index search -> fallback
 * - T05 [critical]: 完全不在 text 中 -> dropped
 * - T06 [non-critical]: 中文 Unicode 边界 (BMP 字符)
 * - T07 [critical]: summarizeAlignment 正确汇总
 * - T08 [critical]: 空 text 边界 case -> dropped
 */
import { describe, expect, it } from 'vitest';
import {
  summarizeAlignment,
  validateToken,
  type AlignmentResult,
} from './alignmentValidator';

describe('validateToken (Stage 2)', () => {
  const text = 'Yesterday, I walked to the market';

  it('T01: exact match -> perfect', () => {
    // "walked" 在 text[13..19), 完全匹配
    const r = validateToken({ startIndex: 13, endIndex: 19, surfaceForm: 'walked' }, text);
    expect(r.status).toBe('perfect');
    expect(r.start).toBe(13);
    expect(r.end).toBe(19);
    expect(r.surfaceForm).toBe('walked');
    expect(r.originalOffset).toEqual({ start: 13, end: 19 });
  });

  it('T02: case-insensitive match -> corrected', () => {
    // text[0..9] = "Yesterday", LLM 给的 surfaceForm 是 "yesterday" (全小写)
    const r = validateToken({ startIndex: 0, endIndex: 9, surfaceForm: 'yesterday' }, text);
    expect(r.status).toBe('corrected');
    // 用 surfaceForm 原 case 替换
    expect(r.surfaceForm).toBe('yesterday');
    expect(r.start).toBe(0);
    expect(r.end).toBe(9);
  });

  it('T03: fuzzy match (Levenshtein <= 2) -> corrected', () => {
    // text[13..19] = "walked", 假设 LLM 给 [12..18] -> slice = "walke",
    // Levenshtein("walke", "walked") = 1 (append 'd'), 落在 fuzzy 阈值内
    const r = validateToken({ startIndex: 12, endIndex: 18, surfaceForm: 'walked' }, text);
    expect(r.status).toBe('corrected');
    // 校正后保留原 offset
    expect(r.start).toBe(12);
    expect(r.end).toBe(18);
    expect(r.surfaceForm).toBe('walked');
  });

  it('T04: first index search -> fallback', () => {
    // 偏移完全错位, 切片不等于 surfaceForm, fuzzy 也不在阈值,
    // 但 surfaceForm 在 text 其它位置
    // text = "Yesterday, I walked to the market"
    // 给错位 offset [1, 8] = "esterday", 与 "Yesterday" 差 1 (前缀差)
    // 但 fuzzy 阈值刚好 1, 应走 fuzzy; 改用更明显的错位
    // 改: 给 offset [10, 16] = "I walk" (含空格), 与 "walked" 差 2 (空格代e + 少ed)
    // 走 fuzzy 路径. 用更大错位确保走 fallback:
    // offset [10, 20] = "I walked ", 包含空格, 与 "walked" 差 2 (空格 + 末尾空格) -> 还是 fuzzy
    // 改用完全错误 offset: [0, 7] = "Yesterd", 与 "walked" 完全无关
    // Levenshtein("Yesterd", "walked") = 6 -> 超出阈值
    const r = validateToken({ startIndex: 0, endIndex: 7, surfaceForm: 'walked' }, text);
    // 切片 = "Yesterd", 与 "walked" 差太远
    // exact? "Yesterd" === "walked" ? no
    // case insensitive lower? "yesterd" === "walked" ? no
    // fuzzy? |7-6|=1, Levenshtein("Yesterd","walked")=6 > 2 -> no
    // indexOf("walked") = 13 >= 0 -> fallback
    expect(r.status).toBe('fallback');
    expect(r.start).toBe(13);
    expect(r.end).toBe(19);
    expect(r.surfaceForm).toBe('walked');
  });

  it('T05: 完全不在 text -> dropped', () => {
    const r = validateToken({ startIndex: 50, endIndex: 60, surfaceForm: 'xyzzzz' }, text);
    expect(r.status).toBe('dropped');
    expect(r.start).toBe(0);
    expect(r.end).toBe(0);
  });

  it('T06: 中文 Unicode 边界 (BMP 字符)', () => {
    const cn = '今天天气很好, 我去公园散步';
    // "我" 在 cn 中位置 9 (BMP code unit)
    // cn: 今=0,天=1,天=2,气=3,很=4,好=5,,=6,空格=7,我=8 -> 注: 实际是
    // 让我们数: "今天天气很好, 我去公园散步" 长度 14
    // 今(0) 天(1) 天(2) 气(3) 很(4) 好(5) ,(6)  (7) 我(8) 去(9) 公(10) 园(11) 散(12) 步(13)
    // "我" 在 [8, 9) 完美匹配
    const r = validateToken({ startIndex: 8, endIndex: 9, surfaceForm: '我' }, cn);
    expect(r.status).toBe('perfect');

    // 再测一个多字: "公园" 在 [10, 12)
    const r2 = validateToken({ startIndex: 10, endIndex: 12, surfaceForm: '公园' }, cn);
    expect(r2.status).toBe('perfect');

    // case-insensitive 中文无大小写, 但算法仍兼容: 大小写差异对中文不触发
    // 改测 fuzzy 中文边界: '今'(1 char) -> '公园'(2 char) 距离 = 2 (substitute '今'->'公', insert '园')
    // 落在 MAX_FUZZY_DISTANCE (2) 阈值内 -> 走 fuzzy (corrected)
    const r3 = validateToken({ startIndex: 0, endIndex: 1, surfaceForm: '公园' }, cn);
    expect(r3.status).toBe('corrected');
    expect(r3.surfaceForm).toBe('公园');

    // 改测 first index fallback: 给空 range (end <= start), inRange true 但 sliced 为空,
    // 跳过 exact/case/fuzzy, 走词边界正则 (v2.2.2 Bug 6: 需词边界匹配, CJK 词需被非字母字符环绕)
    const cn2 = '今天 阳光 公园 散步';
    const r5 = validateToken({ startIndex: 5, endIndex: 5, surfaceForm: '公园' }, cn2);
    expect(r5.status).toBe('fallback');
    expect(r5.start).toBe(cn2.indexOf('公园'));
    expect(r5.end).toBe(cn2.indexOf('公园') + 2);
  });

  it('T07: summarizeAlignment 正确汇总', () => {
    const results: AlignmentResult[] = [
      { start: 0, end: 1, status: 'perfect', originalOffset: { start: 0, end: 1 }, surfaceForm: 'a' },
      { start: 2, end: 3, status: 'perfect', originalOffset: { start: 2, end: 3 }, surfaceForm: 'b' },
      { start: 4, end: 5, status: 'corrected', originalOffset: { start: 4, end: 5 }, surfaceForm: 'c' },
      { start: 6, end: 7, status: 'fallback', originalOffset: { start: 6, end: 7 }, surfaceForm: 'd' },
      { start: 0, end: 0, status: 'dropped', originalOffset: { start: 99, end: 99 }, surfaceForm: 'z' },
    ];
    const stats = summarizeAlignment(results);
    expect(stats).toEqual({
      perfect: 2,
      corrected: 1,
      fallback: 1,
      dropped: 1,
      total: 5,
    });

    // 空数组
    expect(summarizeAlignment([])).toEqual({
      perfect: 0,
      corrected: 0,
      fallback: 0,
      dropped: 0,
      total: 0,
    });
  });

  it('T08: 空 text 边界 case -> dropped', () => {
    // text 为空时, 任何 slice 都是空串, 走 indexOf 应为 -1, 最终 dropped
    const r = validateToken({ startIndex: 0, endIndex: 5, surfaceForm: 'hello' }, '');
    expect(r.status).toBe('dropped');
    expect(r.start).toBe(0);
    expect(r.end).toBe(0);
  });
});
