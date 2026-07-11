/**
 * Alignment Validator 集成测试 (Stage 2 — 验证 llmAdapter 集成)
 *
 * 验证:
 * 1. validateAndAlignPassagePayload 接收 PassageJsonPayload 并返回校正后的 payload
 * 2. 与 normalizePassagePayload 串联后, 文本清洗 + offset 重算 + alignment 校正 协同工作
 * 3. console.info('[Alignment]', stats) 被正确输出
 * 4. dropped tokens 被过滤
 * 5. alignmentStats 包含 5 字段 (perfect / corrected / fallback / dropped / total)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  normalizePassagePayload,
  validateAndAlignPassagePayload,
} from '../services/llmAdapter';
import type { PassageJsonPayload } from '../services/jsonParser';

describe('Alignment Validator 集成 (Stage 2)', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    infoSpy.mockRestore();
  });

  it('IT01: validateAndAlignPassagePayload — 完美匹配 tokens 不被修改', () => {
    const payload: PassageJsonPayload = {
      title: 'Sample',
      text: 'Yesterday, I walked to the market and bought fruit.',
      tokens: [
        { lemma: 'walk', surfaceForm: 'walked', startIndex: 13, endIndex: 19, partOfSpeech: 'verb' },
        { lemma: 'market', surfaceForm: 'market', startIndex: 27, endIndex: 33, partOfSpeech: 'noun' },
      ],
    };
    const result = validateAndAlignPassagePayload(payload);
    expect(result.tokens).toEqual(payload.tokens);
    // 找到 [Alignment] 日志
    const alignLog = infoSpy.mock.calls.find((c: unknown[]) => c[0] === '[Alignment]');
    expect(alignLog).toBeDefined();
    const stats = alignLog?.[1] as { perfect: number; corrected: number; fallback: number; dropped: number; total: number };
    expect(stats.perfect).toBe(2);
    expect(stats.corrected).toBe(0);
    expect(stats.fallback).toBe(0);
    expect(stats.dropped).toBe(0);
    expect(stats.total).toBe(2);
  });

  it('IT02: validateAndAlignPassagePayload — 错位 offset 被校正 (fuzzy)', () => {
    const payload: PassageJsonPayload = {
      title: 'Sample',
      // Y(0)e(1)s(2)t(3)e(4)r(5)d(6)a(7)y(8),(9) (10)I(11) (12)w(13)a(14)l(15)k(16)e(17)d(18)
      // (19)t(20)o(21) (22)t(23)h(24)e(25) (26)m(27)a(28)r(29)k(30)e(31)t(32)
      // (33)a(34)n(35)d(36) (37)b(38)o(39)u(40)g(41)h(42)t(43) (44)f(45)r(46)u(47)i(48)t(49).(50)
      text: 'Yesterday, I walked to the market and bought fruit.',
      tokens: [
        // 给错位 offset: text[13..18] = "walke" (5 字符), 与 "walked" (6 字符) Levenshtein = 1
        { lemma: 'walk', surfaceForm: 'walked', startIndex: 13, endIndex: 18, partOfSpeech: 'verb' },
        // 严重错位 + slice 与 surfaceForm 远, 走 fallback
        { lemma: 'fruit', surfaceForm: 'fruit', startIndex: 0, endIndex: 1, partOfSpeech: 'noun' },
      ],
    };
    const result = validateAndAlignPassagePayload(payload);
    // 第一个 token: fuzzy 校正, 保留 offset 但 surfaceForm 替换
    expect(result.tokens[0].startIndex).toBe(13);
    expect(result.tokens[0].endIndex).toBe(18);
    expect(result.tokens[0].surfaceForm).toBe('walked');
    // 第二个 token: fallback 校正, offset 改用 indexOf("fruit")=45
    expect(result.tokens[1].startIndex).toBe(45);
    expect(result.tokens[1].endIndex).toBe(50);
    expect(result.tokens[1].surfaceForm).toBe('fruit');

    const alignLog = infoSpy.mock.calls.find((c: unknown[]) => c[0] === '[Alignment]');
    const stats = alignLog?.[1] as { perfect: number; corrected: number; fallback: number; dropped: number; total: number };
    expect(stats.corrected).toBe(1);
    expect(stats.fallback).toBe(1);
    expect(stats.total).toBe(2);
  });

  it('IT03: validateAndAlignPassagePayload — 完全找不到的 token 被 dropped', () => {
    const payload: PassageJsonPayload = {
      title: 'Sample',
      text: 'Yesterday, I walked to the market and bought fruit.',
      tokens: [
        { lemma: 'walk', surfaceForm: 'walked', startIndex: 13, endIndex: 19, partOfSpeech: 'verb' },
        { lemma: 'xyz', surfaceForm: 'xyzzzz', startIndex: 50, endIndex: 60, partOfSpeech: 'noun' },
      ],
    };
    const result = validateAndAlignPassagePayload(payload);
    // dropped token 不进入结果
    expect(result.tokens).toHaveLength(1);
    expect(result.tokens[0].surfaceForm).toBe('walked');

    const alignLog = infoSpy.mock.calls.find((c: unknown[]) => c[0] === '[Alignment]');
    const stats = alignLog?.[1] as { perfect: number; corrected: number; fallback: number; dropped: number; total: number };
    expect(stats.perfect).toBe(1);
    expect(stats.dropped).toBe(1);
    // total 包含 dropped
    expect(stats.total).toBe(2);
  });

  it('IT04: normalizePassagePayload + validateAndAlignPassagePayload 串联 — LLM 输出含 \\r\\n 后正常', () => {
    // 模拟真实 LLM 输出: text 末尾含 \r\n, 一个 token offset 略错位
    const rawPayload: PassageJsonPayload = {
      title: 'Sample',
      text: 'I walked home.\r\n\r\nIt was late.\r\n',
      tokens: [
        // exact match (因为 normalize 会去掉 \r\n, offset 仍 valid)
        { lemma: 'walk', surfaceForm: 'walked', startIndex: 2, endIndex: 8, partOfSpeech: 'verb' },
        // fuzzy: text 清洗后 "I walked home." 中 "home" 在 [9, 13)
        // 假设 LLM 给 [9, 12) = "hom", Levenshtein("hom","home")=1 -> corrected
        { lemma: 'home', surfaceForm: 'home', startIndex: 9, endIndex: 12, partOfSpeech: 'noun' },
      ],
    };
    // Stage 1 链: normalize
    const normalized = normalizePassagePayload(rawPayload);
    // Stage 2 链: align
    const aligned = validateAndAlignPassagePayload(normalized);

    // normalize 后 text 不再含 \r\n
    expect(normalized.text).not.toContain('\r');
    // 第一个 token: exact match
    expect(aligned.tokens[0].surfaceForm).toBe('walked');
    // 第二个 token: fuzzy 校正 (text 清洗后 [9, 12) = "hom", 校正为 "home" via corrected)
    expect(aligned.tokens[1].surfaceForm).toBe('home');
    expect(aligned.tokens[1].startIndex).toBe(9);
    expect(aligned.tokens[1].endIndex).toBe(12);

    // 验证 console.info 同时包含 [Normalize] 和 [Alignment]
    // [Normalize] 用模板字符串 (整条为 1 个 arg), [Alignment] 用 2 个 args
    const normalizeLog = infoSpy.mock.calls.find((c: unknown[]) =>
      typeof c[0] === 'string' && c[0].startsWith('[Normalize]')
    );
    const alignLog = infoSpy.mock.calls.find((c: unknown[]) => c[0] === '[Alignment]');
    expect(normalizeLog).toBeDefined();
    expect(alignLog).toBeDefined();
  });

  it('IT05: 含 grammarPoints 的 payload 也能跑通 alignment 校验', () => {
    const rawPayload = {
      title: 'Sample',
      text: 'Anna woke up early. The sun was rising.',
      tokens: [
        { lemma: 'wake up', surfaceForm: 'woke', startIndex: 5, endIndex: 9, partOfSpeech: 'verb' },
      ],
      grammarPoints: [
        // exact match
        { id: 'g_001', text: 'was rising', startIndex: 31, endIndex: 41, type: 'past_continuous' },
        // 严重错位 -> fallback
        { id: 'g_002', text: 'Anna', startIndex: 0, endIndex: 0, type: 'name' },
      ],
    } as unknown as PassageJsonPayload;

    const result = validateAndAlignPassagePayload(rawPayload);
    // grammarPoints 也被校正
    const g = (result as unknown as { grammarPoints: Array<{ id: string; startIndex: number; endIndex: number; text: string }> }).grammarPoints;
    expect(g).toBeDefined();
    expect(g[0].text).toBe('was rising');
    // fallback: indexOf("Anna") = 0
    expect(g[1].startIndex).toBe(0);
    expect(g[1].endIndex).toBe(4);

    // stats.total = tokens + grammarPoints = 3
    const alignLog = infoSpy.mock.calls.find((c: unknown[]) => c[0] === '[Alignment]');
    const stats = alignLog?.[1] as { perfect: number; corrected: number; fallback: number; dropped: number; total: number };
    expect(stats.total).toBe(3);
  });
});
