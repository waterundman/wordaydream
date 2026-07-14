/**
 * v2.1.1 Stage 2: 新增 schema + parseLLMResponse 泛型化测试 (T07-T11)
 *
 * 覆盖 SPEC Stage 2 合约:
 * - T07 [critical]: EvaluationPayloadSchema 验证 {grade, feedback, hint} 通过
 * - T08 [critical]: DifficultyPayloadSchema 验证 {morphological, abstractness, frequencyPercentile} 通过
 * - T09 [critical]: GlossPayloadSchema 验证 {definitions, explanation} 通过
 * - T10 [critical]: parseLLMResponse 向后兼容旧签名 (raw, expectedLanguage)
 * - T11 [critical]: parseLLMResponse 新签名接受 options.schema 参数
 *
 * 设计:
 * - T07-T09: 直接 import 新 schema, 调 safeParse 验证合法/非法输入
 * - T10: 调 parseLLMResponse(raw, 'en') 旧签名, 验证 language compliance check 仍生效
 * - T11: 调 parseLLMResponse(raw, { schema: EvaluationPayloadSchema }) 新签名, 验证非 passage schema 跳过 language check
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseLLMResponse,
  EvaluationPayloadSchema,
  DifficultyPayloadSchema,
  GlossPayloadSchema,
} from './jsonParser';
import { useAnalyticsStore } from '../../analytics/store/useAnalyticsStore';

describe('v2.1.1 Stage 2: 新增 schema 验证 + parseLLMResponse 泛型化 (T07-T11)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAnalyticsStore.setState({ llmRepairCount: 0 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('T07 [critical]: EvaluationPayloadSchema 验证 {grade, feedback, hint} 通过', () => {
    // 合法: 含所有字段
    const valid = { grade: 'correct', feedback: 'Well done!', hint: 'Keep practicing.' };
    expect(EvaluationPayloadSchema.safeParse(valid).success).toBe(true);
    // 合法: 缺少 hint (optional)
    expect(EvaluationPayloadSchema.safeParse({ grade: 'partial', feedback: 'Almost.' }).success).toBe(true);
    // 非法: grade 不是合法枚举值
    expect(EvaluationPayloadSchema.safeParse({ grade: 'invalid', feedback: 'x' }).success).toBe(false);
    // 非法: 缺少 feedback
    expect(EvaluationPayloadSchema.safeParse({ grade: 'correct' }).success).toBe(false);
  });

  it('T08 [critical]: DifficultyPayloadSchema 验证 {morphological, abstractness, frequencyPercentile} 通过', () => {
    // 合法: 三维度都在范围内
    const valid = { morphological: 3, abstractness: 4, frequencyPercentile: 60 };
    expect(DifficultyPayloadSchema.safeParse(valid).success).toBe(true);
    // 合法: reasoning 可选
    expect(
      DifficultyPayloadSchema.safeParse({
        morphological: 1,
        abstractness: 1,
        frequencyPercentile: 1,
        reasoning: 'easy',
      }).success
    ).toBe(true);
    // 非法: morphological 超范围 (>5)
    expect(
      DifficultyPayloadSchema.safeParse({ morphological: 6, abstractness: 1, frequencyPercentile: 1 }).success
    ).toBe(false);
    // 非法: frequencyPercentile 超范围 (>100)
    expect(
      DifficultyPayloadSchema.safeParse({ morphological: 1, abstractness: 1, frequencyPercentile: 101 }).success
    ).toBe(false);
  });

  it('T09 [critical]: GlossPayloadSchema 验证 {definitions, explanation} 通过', () => {
    // 合法: 含 definitions + explanation
    const valid = { definitions: ['革命', '变革'], explanation: '指根本性变化' };
    expect(GlossPayloadSchema.safeParse(valid).success).toBe(true);
    // 合法: explanation 可选
    expect(GlossPayloadSchema.safeParse({ definitions: ['革命'] }).success).toBe(true);
    // 非法: 空 definitions (min(1))
    expect(GlossPayloadSchema.safeParse({ definitions: [] }).success).toBe(false);
    // 非法: 缺少 definitions
    expect(GlossPayloadSchema.safeParse({ explanation: 'test' }).success).toBe(false);
  });

  it('T10 [critical]: parseLLMResponse 向后兼容旧签名 (raw, expectedLanguage)', () => {
    const raw = JSON.stringify({ text: 'hello', tokens: [], language: 'en' });
    // 旧签名: 第二参数是 Language 字符串
    const result = parseLLMResponse(raw, 'en');
    expect(result.ok).toBe(true);
    expect(result.data?.text).toBe('hello');
    // language mismatch 仍触发失败 (passage schema 做 language 校验)
    const resultDe = parseLLMResponse(raw, 'de');
    expect(resultDe.ok).toBe(false);
    expect(resultDe.error).toContain('Language mismatch');
  });

  it('T11 [critical]: parseLLMResponse 新签名接受 options.schema 参数', () => {
    const raw = JSON.stringify({ grade: 'correct', feedback: 'Well done!' });
    // 新签名: 第二参数是 options 对象, 传入 EvaluationPayloadSchema
    const result = parseLLMResponse(raw, { schema: EvaluationPayloadSchema });
    expect(result.ok).toBe(true);
    expect(result.data?.grade).toBe('correct');
    expect(result.data?.feedback).toBe('Well done!');
    // 非 passage schema 不做 language 校验 (evaluation 响应没有 language 字段)
    // 即使传了 expectedLanguage 也不触发 language mismatch
    const resultWithLang = parseLLMResponse(raw, {
      schema: EvaluationPayloadSchema,
      expectedLanguage: 'de',
    });
    expect(resultWithLang.ok).toBe(true);
    expect(resultWithLang.data?.grade).toBe('correct');
  });
});
