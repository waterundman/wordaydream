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
import type { MemoryCard } from '../../../types';
import * as routerModule from '../../llm/services/router';
import * as promptsModule from '../../llm/config/prompts';
import { useSettingsStore } from '../../settings/store/useSettingsStore';
import { useWordlistStore } from '../../wordlist/store/useWordlistStore';
import { useMemoryStore } from '../../review/store/useMemoryStore';
import { getCachedWordlist, clearWordlistCache } from '../../../data/wordlists';

function makeCard(
  partial: Partial<MemoryCard> &
    Pick<MemoryCard, 'lexemeGroupId' | 'lemma' | 'objectiveDifficulty'>,
): MemoryCard {
  return {
    id: partial.id ?? `card-${partial.lexemeGroupId}`,
    lexemeGroupId: partial.lexemeGroupId,
    lemma: partial.lemma,
    objectiveDifficulty: partial.objectiveDifficulty,
    firstLearnedAt: partial.firstLearnedAt ?? Date.now(),
    lastReviewAt: partial.lastReviewAt ?? Date.now(),
    learningSteps: partial.learningSteps ?? 0,
    due: partial.due ?? 0,
    stability: partial.stability ?? 0,
    difficulty: partial.difficulty ?? 0,
    elapsedDays: partial.elapsedDays ?? 0,
    scheduledDays: partial.scheduledDays ?? 0,
    reps: partial.reps ?? 0,
    lapses: partial.lapses ?? 0,
    status: partial.status ?? 'new',
    language: partial.language,
  };
}

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

// === v1.6.0 Stage 3.5-4 + 3.5-B: pacing + 困难词排序 ===
describe('generatePassage (v1.6.0 Stage 3.5-4 + 3.5-B: pacing + 困难词排序)', () => {
  const enPassageJson = JSON.stringify({
    language: 'en',
    difficulty: 1,
    text: 'The cat sat on the mat.',
    tokens: [
      { lemma: 'cat', surfaceForm: 'cat', startIndex: 4, endIndex: 7, partOfSpeech: 'noun' },
      { lemma: 'sit', surfaceForm: 'sat', startIndex: 8, endIndex: 11, partOfSpeech: 'verb' },
    ],
  });

  beforeEach(() => {
    if (typeof window !== 'undefined') window.localStorage.clear();
    clearPassageCache();
    clearWordlistCache();
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
    clearWordlistCache();
    vi.restoreAllMocks();
    useWordlistStore.getState().resetAll();
    useMemoryStore.getState().resetAll();
    if (typeof window !== 'undefined') window.localStorage.clear();
  });

  it('巩固模式: learning 词 >= 30 时, targetWords 取 learning 词 (非 unlearned), optionalWords 为空', async () => {
    await useWordlistStore.getState().getLevelTotal('en', 1);
    const wordlist = getCachedWordlist('en', 1);
    expect(wordlist).not.toBeNull();
    if (!wordlist) return;

    // 标记 35 个词为 learning (>= LEARNING_THRESHOLD=30)
    for (let i = 0; i < 35; i++) {
      useWordlistStore.getState().markWordLearning('en', wordlist.words[i].lemma);
    }

    vi.spyOn(routerModule, 'generateWithFallback').mockResolvedValue({ text: enPassageJson });
    const buildPromptSpy = vi.spyOn(promptsModule, 'buildPassagePrompt');

    await generatePassage('en', 1, []);

    expect(buildPromptSpy).toHaveBeenCalled();
    const constraint = buildPromptSpy.mock.calls[0][3] as
      | { targetWords: string[]; optionalWords: string[] }
      | undefined;
    expect(constraint).toBeDefined();
    expect(constraint!.targetWords).toHaveLength(8);
    expect(constraint!.optionalWords).toHaveLength(0);
    // words[0] 是 learning 词, 应在 targetWords 中
    expect(constraint!.targetWords).toContain(wordlist.words[0].lemma);
    // words[50] 是 unlearned, 不应在 targetWords 中 (巩固模式不引入新词)
    expect(constraint!.targetWords).not.toContain(wordlist.words[50].lemma);
  });

  it('巩固模式: 按 lapses 降序排, 高 lapses 词优先作 target', async () => {
    await useWordlistStore.getState().getLevelTotal('en', 1);
    const wordlist = getCachedWordlist('en', 1);
    expect(wordlist).not.toBeNull();
    if (!wordlist) return;

    for (let i = 0; i < 35; i++) {
      useWordlistStore.getState().markWordLearning('en', wordlist.words[i].lemma);
    }

    // 前 8 个词 lapses=5 (高), 后 27 个 lapses=0
    const cards = new Map<string, MemoryCard>();
    for (let i = 0; i < 35; i++) {
      const lemma = wordlist.words[i].lemma;
      cards.set(
        `g-${lemma}`,
        makeCard({
          lexemeGroupId: `g-${lemma}`,
          lemma,
          objectiveDifficulty: 1,
          language: 'en',
          status: 'learning',
          lapses: i < 8 ? 5 : 0,
        }),
      );
    }
    useMemoryStore.setState({ cards });

    vi.spyOn(routerModule, 'generateWithFallback').mockResolvedValue({ text: enPassageJson });
    const buildPromptSpy = vi.spyOn(promptsModule, 'buildPassagePrompt');

    await generatePassage('en', 1, []);

    const constraint = buildPromptSpy.mock.calls[0][3] as
      | { targetWords: string[]; optionalWords: string[] }
      | undefined;
    expect(constraint).toBeDefined();
    // 前 8 个 (高 lapses=5) 应全部在 targetWords 中
    for (let i = 0; i < 8; i++) {
      expect(constraint!.targetWords).toContain(wordlist.words[i].lemma);
    }
  });

  it('正常模式: learning 词 < 30 时, targetWords 取 unlearned, optionalWords 取 learning', async () => {
    await useWordlistStore.getState().getLevelTotal('en', 1);
    const wordlist = getCachedWordlist('en', 1);
    expect(wordlist).not.toBeNull();
    if (!wordlist) return;

    // 只标记 5 个词为 learning (< LEARNING_THRESHOLD=30)
    for (let i = 0; i < 5; i++) {
      useWordlistStore.getState().markWordLearning('en', wordlist.words[i].lemma);
    }

    vi.spyOn(routerModule, 'generateWithFallback').mockResolvedValue({ text: enPassageJson });
    const buildPromptSpy = vi.spyOn(promptsModule, 'buildPassagePrompt');

    await generatePassage('en', 1, []);

    const constraint = buildPromptSpy.mock.calls[0][3] as
      | { targetWords: string[]; optionalWords: string[] }
      | undefined;
    expect(constraint).toBeDefined();
    expect(constraint!.targetWords).toHaveLength(8);
    // targetWords 应为 unlearned 词 (不包含 learning 词)
    expect(constraint!.targetWords).not.toContain(wordlist.words[0].lemma);
    // optionalWords 应包含 learning 词
    expect(constraint!.optionalWords).toContain(wordlist.words[0].lemma);
  });

  it('T07 [v1.7.0 Stage 1]: passageGenerator 使用自适应阈值 (低 recall -> 阈值 15, 20 词触发巩固)', async () => {
    await useWordlistStore.getState().getLevelTotal('en', 1);
    const wordlist = getCachedWordlist('en', 1);
    expect(wordlist).not.toBeNull();
    if (!wordlist) return;

    // 设置低 recall 率 ratingHistory: 2 个 'again' -> recall=0.0 -> 阈值=15
    // hasHistory=true (ratingHistory 非空), 所以走 recall 率分支
    const now = Date.now();
    useMemoryStore.setState({
      ratingHistory: [
        { cardId: 'c1', rating: 'again', at: now },
        { cardId: 'c2', rating: 'again', at: now },
      ],
    });

    // 标记 20 个词为 learning
    // 20 >= 15 (adaptive 阈值) -> 巩固模式
    // 20 < 30 (旧 LEARNING_THRESHOLD 常量) -> 正常模式 (证明使用了 adaptive)
    for (let i = 0; i < 20; i++) {
      useWordlistStore.getState().markWordLearning('en', wordlist.words[i].lemma);
    }

    vi.spyOn(routerModule, 'generateWithFallback').mockResolvedValue({ text: enPassageJson });
    const buildPromptSpy = vi.spyOn(promptsModule, 'buildPassagePrompt');

    await generatePassage('en', 1, []);

    expect(buildPromptSpy).toHaveBeenCalled();
    const constraint = buildPromptSpy.mock.calls[0][3] as
      | { targetWords: string[]; optionalWords: string[] }
      | undefined;
    expect(constraint).toBeDefined();
    // 巩固模式: optionalWords 为空, targetWords 取 learning 词 (非 unlearned)
    expect(constraint!.optionalWords).toHaveLength(0);
    expect(constraint!.targetWords).toContain(wordlist.words[0].lemma);
  });
});

// === v1.6.0 Stage 3.6-C: 复习编排 pacing — dueCards 超载强制巩固 ===
describe('generatePassage (v1.6.0 Stage 3.6-C: 复习编排 pacing — dueCards 超载强制巩固)', () => {
  const enPassageJson = JSON.stringify({
    language: 'en',
    difficulty: 1,
    text: 'The cat sat on the mat.',
    tokens: [
      { lemma: 'cat', surfaceForm: 'cat', startIndex: 4, endIndex: 7, partOfSpeech: 'noun' },
      { lemma: 'sit', surfaceForm: 'sat', startIndex: 8, endIndex: 11, partOfSpeech: 'verb' },
    ],
  });

  beforeEach(() => {
    if (typeof window !== 'undefined') window.localStorage.clear();
    clearPassageCache();
    clearWordlistCache();
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
    clearWordlistCache();
    vi.restoreAllMocks();
    useWordlistStore.getState().resetAll();
    useMemoryStore.getState().resetAll();
    if (typeof window !== 'undefined') window.localStorage.clear();
  });

  /**
   * 辅助: 创建 N 个 review 状态的 due 卡片 (past due), lemma 形如 revword1..revwordN.
   * language='en' 确保精确匹配, due=0 确保被 getDueCards 收录.
   */
  function makeReviewDueCards(count: number): Map<string, MemoryCard> {
    const cards = new Map<string, MemoryCard>();
    for (let i = 0; i < count; i++) {
      const lemma = `revword${i + 1}`;
      cards.set(
        `g-${lemma}`,
        makeCard({
          lexemeGroupId: `g-${lemma}`,
          lemma,
          objectiveDifficulty: 1,
          language: 'en',
          status: 'review',
          due: 0,
          reps: 3,
          lapses: 1,
        }),
      );
    }
    return cards;
  }

  it('T13: pacing — dueCards (review) > 20 时强制巩固模式, targetWords 取 dueCards lemma 非未学词', async () => {
    await useWordlistStore.getState().getLevelTotal('en', 1);
    const wordlist = getCachedWordlist('en', 1);
    expect(wordlist).not.toBeNull();
    if (!wordlist) return;

    // 21 个 review 状态 due 卡片 (> REVIEW_OVERLOAD_THRESHOLD=20)
    useMemoryStore.setState({ cards: makeReviewDueCards(21) });

    vi.spyOn(routerModule, 'generateWithFallback').mockResolvedValue({ text: enPassageJson });
    const buildPromptSpy = vi.spyOn(promptsModule, 'buildPassagePrompt');

    await generatePassage('en', 1, []);

    expect(buildPromptSpy).toHaveBeenCalled();
    const constraint = buildPromptSpy.mock.calls[0][3] as
      | { targetWords: string[]; optionalWords: string[] }
      | undefined;
    expect(constraint).toBeDefined();
    expect(constraint!.targetWords).toHaveLength(8);
    expect(constraint!.optionalWords).toHaveLength(0);
    // targetWords 应为 dueCards 的 lemma (revword1, revword2, ...), 不是 wordlist 未学词
    expect(constraint!.targetWords).toContain('revword1');
    expect(constraint!.targetWords).toContain('revword2');
    // wordlist.words[50] 是未学词, 不应在 targetWords 中 (强制巩固模式不引入新词)
    expect(constraint!.targetWords).not.toContain(wordlist.words[50].lemma);
  });

  it('T14: pacing 巩固模式 — targetWords = dueCards.slice(0, 8).map(c => c.lemma)', async () => {
    await useWordlistStore.getState().getLevelTotal('en', 1);

    // 25 个 review 状态 due 卡片, 取前 8 个的 lemma
    useMemoryStore.setState({ cards: makeReviewDueCards(25) });

    vi.spyOn(routerModule, 'generateWithFallback').mockResolvedValue({ text: enPassageJson });
    const buildPromptSpy = vi.spyOn(promptsModule, 'buildPassagePrompt');

    await generatePassage('en', 1, []);

    const constraint = buildPromptSpy.mock.calls[0][3] as
      | { targetWords: string[]; optionalWords: string[] }
      | undefined;
    expect(constraint).toBeDefined();
    // targetWords 应恰好为前 8 个 dueCards 的 lemma (getDueCards 按 due 升序, 稳定排序保持插入序)
    expect(constraint!.targetWords).toEqual([
      'revword1', 'revword2', 'revword3', 'revword4',
      'revword5', 'revword6', 'revword7', 'revword8',
    ]);
  });

  it('T15: REVIEW_OVERLOAD_THRESHOLD 边界 — dueCards === 20 时不触发强制 (严格大于)', async () => {
    await useWordlistStore.getState().getLevelTotal('en', 1);
    const wordlist = getCachedWordlist('en', 1);
    expect(wordlist).not.toBeNull();
    if (!wordlist) return;

    // 20 个 review 状态 due 卡片 (=== REVIEW_OVERLOAD_THRESHOLD, 不 > 20)
    useMemoryStore.setState({ cards: makeReviewDueCards(20) });

    vi.spyOn(routerModule, 'generateWithFallback').mockResolvedValue({ text: enPassageJson });
    const buildPromptSpy = vi.spyOn(promptsModule, 'buildPassagePrompt');

    await generatePassage('en', 1, []);

    const constraint = buildPromptSpy.mock.calls[0][3] as
      | { targetWords: string[]; optionalWords: string[] }
      | undefined;
    expect(constraint).toBeDefined();
    // 边界值 20 不触发 review-overload, 走正常模式: targetWords = unlearned
    expect(constraint!.targetWords).toHaveLength(8);
    // targetWords 不应包含 review 卡片的 lemma (正常模式取 unlearned, 非 dueCards)
    expect(constraint!.targetWords).not.toContain('revword1');
    expect(constraint!.targetWords).not.toContain('revword20');
  });
});

// === v2.2.2 Stage 2 (Bug 5): recentTitles LRU 黑名单 ===
import { getRecentTitles, clearRecentTitles } from './passageGenerator';

describe('v2.2.2 Stage 2 (Bug 5): recentTitles LRU 黑名单', () => {
  const enPassageJson = (title: string) => JSON.stringify({
    language: 'en',
    difficulty: 1,
    title,
    text: 'The cat sat on the mat.',
    tokens: [
      { lemma: 'cat', surfaceForm: 'cat', startIndex: 4, endIndex: 7, partOfSpeech: 'noun' },
      { lemma: 'sit', surfaceForm: 'sat', startIndex: 8, endIndex: 11, partOfSpeech: 'verb' },
    ],
  });

  beforeEach(() => {
    if (typeof window !== 'undefined') window.localStorage.clear();
    clearPassageCache();
    clearRecentTitles();
    clearWordlistCache();
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
    clearRecentTitles();
    clearWordlistCache();
    vi.restoreAllMocks();
    useWordlistStore.getState().resetAll();
    useMemoryStore.getState().resetAll();
    if (typeof window !== 'undefined') window.localStorage.clear();
  });

  it('T09: getRecentTitles 返回最近 5 个标题 (LRU), 超容量丢弃最旧', async () => {
    // 用计数器 mock: 每次 generateWithFallback 调用返回不同 title 的 passage JSON.
    // generatePassage 内部会调用多次 (passage + difficulty eval + grammar),
    // 但 pushRecentTitle 仅在 passage 成功后调用一次 (用 passage 的 title).
    let callCounter = 0;
    vi.spyOn(routerModule, 'generateWithFallback').mockImplementation(() => {
      callCounter++;
      return Promise.resolve({ text: enPassageJson(`Title ${callCounter}`) });
    });

    // 调用 generatePassage 6 次 (forceRefresh=true 跳过缓存读取)
    // 每次返回的 passage.title 即为 pushRecentTitle 推入的标题
    const pushedTitles: string[] = [];
    for (let i = 0; i < 6; i++) {
      const passage = await generatePassage('en', 1, [], undefined, true);
      pushedTitles.push(passage.title ?? '');
    }

    // recentTitles 容量 5, 第 1 个标题应被淘汰, 保留最后 5 个
    const recent = getRecentTitles();
    expect(recent).toHaveLength(5);
    // recentTitles 应等于 pushedTitles 的最后 5 个 (顺序一致)
    expect(recent).toEqual(pushedTitles.slice(1));
  });

  it('T09b: getRecentTitles 初始为空数组', () => {
    clearRecentTitles();
    expect(getRecentTitles()).toEqual([]);
  });

  it('T09c: 重复标题触发 LRU 去重 (不重复占位)', async () => {
    // 所有调用返回相同 title, 多次 generatePassage 后 recentTitles 只含 1 个标题
    vi.spyOn(routerModule, 'generateWithFallback').mockImplementation(() => {
      return Promise.resolve({ text: enPassageJson('Same Title') });
    });

    await generatePassage('en', 1, [], undefined, true);
    await generatePassage('en', 1, [], undefined, true);
    await generatePassage('en', 1, [], undefined, true);

    const recent = getRecentTitles();
    // LRU 去重: 3 次推入相同标题, 只保留 1 个 (移到末尾, 不重复占位)
    expect(recent).toEqual(['Same Title']);
  });
});

// === v2.2.3 Stage 1 (D1-2): wordlist 补偿 — passage tokens < 8 时从 wordlist 补齐 ===
describe('generatePassage (v2.2.3 Stage 1 D1-2: wordlist 补偿)', () => {
  // 构造 passage: 只 1 个 token ("cat"), text 含 7 个 A1 wordlist 词 (be/have/do/go/get/make/know).
  // A1 词表前 7 个词按序为 be, have, do, go, get, make, know, 均出现在 text 中,
  // 故补偿能找到 7 个匹配 → 总 token 数 = 1 + 7 = 8.
  // 偏移参考 (0-based): be[2,4) have[13,17) cat[20,23) do[27,29) go[36,38) get[46,49) make[56,60) know[69,73)
  const passageText = 'I be here. I have a cat. I do it. I go now. I get it. I make food. I know.';
  const passageJson = JSON.stringify({
    language: 'en',
    difficulty: 1,
    text: passageText,
    tokens: [
      { lemma: 'cat', surfaceForm: 'cat', startIndex: 20, endIndex: 23, partOfSpeech: 'noun' },
    ],
  });

  beforeEach(() => {
    if (typeof window !== 'undefined') window.localStorage.clear();
    clearPassageCache();
    clearRecentTitles();
    clearWordlistCache();
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
    clearRecentTitles();
    clearWordlistCache();
    vi.restoreAllMocks();
    useWordlistStore.getState().resetAll();
    useMemoryStore.getState().resetAll();
    if (typeof window !== 'undefined') window.localStorage.clear();
  });

  it('T05: alignedTokens < 8 时从 wordlist 补齐到 >= 8', async () => {
    // 加载 A1 词表 (80 词), 确保 getCachedWordlist + getUnlearnedWordsSync 可用
    await useWordlistStore.getState().getLevelTotal('en', 1);
    const wordlist = getCachedWordlist('en', 1);
    expect(wordlist).not.toBeNull();
    if (!wordlist) return;

    // mock LLM 返回只含 1 个 token 的 passage
    vi.spyOn(routerModule, 'generateWithFallback').mockResolvedValue({ text: passageJson });

    const passage = await generatePassage('en', 1, [], undefined, true);

    // 补偿后应 >= 8 个 token
    expect(passage.tokens.length).toBeGreaterThanOrEqual(8);
    // source 仍为 'llm' (补偿不改变 source)
    expect(passage.source).toBe('llm');
    // 原始 "cat" token 仍在
    expect(passage.tokens.some((t) => t.lemma === 'cat')).toBe(true);
    // 补偿的 token 用 kind='normal' (非 'review')
    const supplementTokens = passage.tokens.filter((t) => t.id.startsWith('supplement-'));
    expect(supplementTokens.length).toBeGreaterThan(0);
    for (const t of supplementTokens) {
      expect(t.kind).toBe('normal');
    }
  });

  it('T06: 补偿的 token 在 text 中找到匹配位置 (startIndex/endIndex 正确)', async () => {
    await useWordlistStore.getState().getLevelTotal('en', 1);
    const wordlist = getCachedWordlist('en', 1);
    expect(wordlist).not.toBeNull();
    if (!wordlist) return;

    vi.spyOn(routerModule, 'generateWithFallback').mockResolvedValue({ text: passageJson });

    const passage = await generatePassage('en', 1, [], undefined, true);

    // 找到补偿的 "have" token (A1 词表第 2 个词)
    const haveToken = passage.tokens.find((t) => t.lemma === 'have');
    expect(haveToken).toBeDefined();
    if (haveToken) {
      expect(passage.text.substring(haveToken.startIndex, haveToken.endIndex)).toBe('have');
    }

    // 验证所有 token (原始 + 补偿) 的 startIndex/endIndex 与 surfaceForm 一致
    for (const token of passage.tokens) {
      const slice = passage.text.substring(token.startIndex, token.endIndex);
      expect(slice).toBe(token.surfaceForm);
    }

    // 验证补偿 token 的 id 格式
    const supplementTokens = passage.tokens.filter((t) => t.id.startsWith('supplement-'));
    for (const t of supplementTokens) {
      expect(t.id).toMatch(/^supplement-[a-z]+-\d+$/);
      expect(t.lexemeGroupId).toMatch(/^lex-/);
      expect(t.isCompound).toBe(false);
      expect(t.isResolved).toBe(false);
      expect(t.isActive).toBe(false);
    }
  });
});
