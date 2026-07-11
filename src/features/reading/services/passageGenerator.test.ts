/**
 * passageGenerator 单元测试 (v1.2.0 Stage 4 hotfix P1-A + v1.3.0 Stage 2 T05)
 *
 * 覆盖 SPEC 要求 5 个 case:
 * - T01 [critical]: alignedTokens 全部 perfect -> 所有 token.alignmentStatus === 'perfect'
 * - T02 [critical]: alignedTokens 含 1 个 corrected -> 对应 token.alignmentStatus='corrected'
 *                   + originalOffset 写入 (来自 AlignmentResult.originalOffset.start)
 * - T03 [critical]: alignedTokens 含 1 个 fallback -> 同上
 * - T04 [non-critical]: alignedTokens 与 llmTokens 顺序/字段不匹配 ->
 *                     token.alignmentStatus 退化为 'unknown' (容错)
 * - T05 [v1.3.0 Stage 2 critical]: generatePassage 透传 expectedLanguage 到 router
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPassageFromLLM, generatePassage, clearPassageCache } from './passageGenerator';
import type { AlignmentResult } from '../../llm/utils/alignmentValidator';
import * as routerModule from '../../llm/services/router';
import { useSettingsStore } from '../../settings/store/useSettingsStore';

describe('buildPassageFromLLM (Stage 4 hotfix P1-A: alignment status 写入)', () => {
  // 测试用 fixture: 3 个 token, 全部在英文 "Anna walked to the market" 文本中
  const text = 'Anna walked to the market';
  // 偏移: Anna[0..4) walked[5..11) to[12..14) the[15..18) market[19..25)
  const llmTokens = [
    { lemma: 'Anna', surfaceForm: 'Anna', startIndex: 0, endIndex: 4, partOfSpeech: 'noun' },
    { lemma: 'walk', surfaceForm: 'walked', startIndex: 5, endIndex: 11, partOfSpeech: 'verb' },
    { lemma: 'market', surfaceForm: 'market', startIndex: 19, endIndex: 25, partOfSpeech: 'noun' },
  ];

  it('T01: alignedTokens 全部 perfect -> token.alignmentStatus === "perfect"', () => {
    const alignedTokens: AlignmentResult[] = llmTokens.map((t) => ({
      start: t.startIndex,
      end: t.endIndex,
      status: 'perfect',
      originalOffset: { start: t.startIndex, end: t.endIndex },
      surfaceForm: t.surfaceForm,
    }));

    const passage = buildPassageFromLLM('en', 2, text, undefined, llmTokens, alignedTokens);

    expect(passage.tokens).toHaveLength(3);
    expect(passage.tokens[0].alignmentStatus).toBe('perfect');
    expect(passage.tokens[0].originalOffset).toBe(0);
    expect(passage.tokens[1].alignmentStatus).toBe('perfect');
    expect(passage.tokens[1].originalOffset).toBe(0);
    expect(passage.tokens[2].alignmentStatus).toBe('perfect');
    expect(passage.tokens[2].originalOffset).toBe(0);
  });

  it('T02: alignedTokens 含 1 个 corrected -> alignmentStatus + originalOffset 写入', () => {
    // 模拟 LLM 给了 fuzzy 错位 offset, validateToken 校正后 status='corrected',
    // 但 originalOffset.start 记录了 LLM 原始 start (校正前的)
    const alignedTokens: AlignmentResult[] = [
      // Anna perfect
      {
        start: 0,
        end: 4,
        status: 'perfect',
        originalOffset: { start: 0, end: 4 },
        surfaceForm: 'Anna',
      },
      // walked corrected: 原本 LLM 给 [6, 11] = "alked" (漏 w), fuzzy 校正,
      // 校正后 offset 不变 (仍为 LLM 原始), status=corrected, originalOffset.start=6
      {
        start: 6,
        end: 11,
        status: 'corrected',
        originalOffset: { start: 6, end: 11 },
        surfaceForm: 'walked',
      },
      // market perfect
      {
        start: 19,
        end: 25,
        status: 'perfect',
        originalOffset: { start: 19, end: 25 },
        surfaceForm: 'market',
      },
    ];

    // 注意: llmTokens 第二个也要用 corrected 后的 start=6 (validate 已经
    // 校正 payload.tokens), 所以这里 llmTokens[1].startIndex=6
    const llmTokensCorrected = [
      llmTokens[0],
      { lemma: 'walk', surfaceForm: 'walked', startIndex: 6, endIndex: 11, partOfSpeech: 'verb' },
      llmTokens[2],
    ];

    const passage = buildPassageFromLLM(
      'en',
      2,
      text,
      undefined,
      llmTokensCorrected,
      alignedTokens
    );

    expect(passage.tokens[0].alignmentStatus).toBe('perfect');
    expect(passage.tokens[0].originalOffset).toBe(0);

    // 第 2 个: corrected, originalOffset 来自 aligned.originalOffset.start
    expect(passage.tokens[1].alignmentStatus).toBe('corrected');
    expect(passage.tokens[1].originalOffset).toBe(6);
    expect(passage.tokens[1].surfaceForm).toBe('walked');

    expect(passage.tokens[2].alignmentStatus).toBe('perfect');
    expect(passage.tokens[2].originalOffset).toBe(0);
  });

  it('T03: alignedTokens 含 1 个 fallback -> alignmentStatus + originalOffset 写入', () => {
    // 模拟 LLM 给完全错位的 offset, validateToken 走 text.indexOf fallback,
    // 校正后 start 改用 indexOf, originalOffset 记录 LLM 原始 (例如 0, 0)
    const alignedTokens: AlignmentResult[] = [
      {
        start: 0,
        end: 4,
        status: 'perfect',
        originalOffset: { start: 0, end: 4 },
        surfaceForm: 'Anna',
      },
      // walked fallback: LLM 原始给 [0, 4] (完全错), validate 走 indexOf
      // 找到 walked 在 text[5..11), 校正后 start=5, originalOffset.start=0
      {
        start: 5,
        end: 11,
        status: 'fallback',
        originalOffset: { start: 0, end: 4 },
        surfaceForm: 'walked',
      },
      {
        start: 19,
        end: 25,
        status: 'perfect',
        originalOffset: { start: 19, end: 25 },
        surfaceForm: 'market',
      },
    ];

    // llmTokens 第二个用校正后 start=5
    const llmTokensCorrected = [
      llmTokens[0],
      { lemma: 'walk', surfaceForm: 'walked', startIndex: 5, endIndex: 11, partOfSpeech: 'verb' },
      llmTokens[2],
    ];

    const passage = buildPassageFromLLM(
      'en',
      2,
      text,
      undefined,
      llmTokensCorrected,
      alignedTokens
    );

    expect(passage.tokens[0].alignmentStatus).toBe('perfect');
    expect(passage.tokens[1].alignmentStatus).toBe('fallback');
    expect(passage.tokens[1].originalOffset).toBe(0); // LLM 原始 start
    expect(passage.tokens[2].alignmentStatus).toBe('perfect');
  });

  it('T04: alignedTokens 与 llmTokens surfaceForm/startIndex 不匹配 -> "unknown" 容错', () => {
    // 模拟对齐结果数组与 token 数组"错位" (例如数据链路有 bug)
    // 此时 buildPassageFromLLM 应当退化为 'unknown', 不让 passage 构建挂掉
    const alignedTokens: AlignmentResult[] = [
      // 与 llmTokens[0] 字段不匹配: surfaceForm 是 "anna" (小写)
      {
        start: 0,
        end: 4,
        status: 'corrected',
        originalOffset: { start: 0, end: 4 },
        surfaceForm: 'anna',
      },
      // 完全无关
      {
        start: 100,
        end: 106,
        status: 'fallback',
        originalOffset: { start: 0, end: 6 },
        surfaceForm: 'notused',
      },
    ];

    const passage = buildPassageFromLLM('en', 2, text, undefined, llmTokens, alignedTokens);

    expect(passage.tokens).toHaveLength(3);
    // 因为 surfaceForm 不一致, 都退化为 'unknown'
    expect(passage.tokens[0].alignmentStatus).toBe('unknown');
    expect(passage.tokens[0].originalOffset).toBe(0);
    expect(passage.tokens[1].alignmentStatus).toBe('unknown');
    expect(passage.tokens[1].originalOffset).toBe(0);
    expect(passage.tokens[2].alignmentStatus).toBe('unknown');
    expect(passage.tokens[2].originalOffset).toBe(0);
  });
});

describe('generatePassage (v1.3.0 Stage 2 T05 — 透传 expectedLanguage)', () => {
  // 模拟 LLM 成功响应: 含合法德文 passage JSON (满足 extractPassageJson 的 text + tokens 校验)
  const dePassageText = 'Anna ging früh auf. Die Sonne ging hinter den Hügeln auf.';
  const dePassageJson = JSON.stringify({
    language: 'de',
    difficulty: 2,
    title: 'Morgen',
    text: dePassageText,
    tokens: [
      { lemma: 'gehen', surfaceForm: 'ging', startIndex: 5, endIndex: 9, partOfSpeech: 'verb' },
      { lemma: 'früh', surfaceForm: 'früh', startIndex: 10, endIndex: 14, partOfSpeech: 'adv' },
    ],
  });

  beforeEach(() => {
    // 清缓存 + 重置 settings store
    clearPassageCache();
    useSettingsStore.setState((s) => ({
      llm: {
        ...s.llm,
        enabled: true,
        provider: 'openai',
        apiKey: 'test-key',
        baseUrl: '',
        model: 'gpt-4o-mini',
        temperature: 0.5,
        timeout: 30,
        maxRetries: 2,
        streaming: false,
      },
    }));
  });

  afterEach(() => {
    clearPassageCache();
    vi.restoreAllMocks();
  });

  it('T05 [v1.3.0 Stage 2 critical]: generatePassage 透传 expectedLanguage=language 到 generateWithFallback options', async () => {
    // Arrange: spy 替代 generateWithFallback, 返回合法德文 JSON
    // 使用静态 import 拿到的模块实例 (与 passageGenerator 内部 import 同一引用)
    // 注: generateWithFallback 会被 generatePassage 调 1 次 (passage 生成) + N 次
    //     (每个唯一 lemma 的 difficulty 评估, N 由 unique lemmas 数决定).
    //     本 test 只断言首次 (passage 生成) 调用的 options.expectedLanguage 透传.
    const spy = vi
      .spyOn(routerModule, 'generateWithFallback')
      .mockResolvedValue({
        text: dePassageJson,
      });
    spy.mockClear();

    // Act: 调用 generatePassage('de', 2)
    const passage = await generatePassage('de', 2, []);
    expect(passage).toBeDefined();

    // Assert: spy 至少被调用 1 次
    expect(spy).toHaveBeenCalled();
    // 断言: 至少存在 1 次调用, 其 options.expectedLanguage === 'de'
    // (即 generatePassage 把 'de' 透传到了 generateWithFallback 的第二个参数)
    const callsWithExpectedLanguage = spy.mock.calls.filter((call) => {
      const options = call[1] as { expectedLanguage?: string };
      return options.expectedLanguage === 'de';
    });
    expect(callsWithExpectedLanguage.length).toBeGreaterThan(0);
  });
});
