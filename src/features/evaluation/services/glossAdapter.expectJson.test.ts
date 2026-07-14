/**
 * v2.1.1 Stage 2: rewriteToChinese expectJson 值验证 (T15)
 *
 * 覆盖 SPEC Stage 2 合约:
 * - T15 [critical]: rewriteToChinese 使用 expectJson: 'gloss'
 *
 * 设计:
 * - vi.mock('../../llm/services/router') 拦截 generateWithFallback
 * - vi.mock('../../dictionary/services/wiktextractAdapter') 返回可控 dictionary entry
 * - 设置 useSettingsStore LLM enabled
 * - 调 getGloss (内部调 rewriteToChinese), 验证 generateWithFallback
 *   被调用时含 expectJson: 'gloss'
 *
 * 注意: rewriteToChinese 是 glossAdapter.ts 内部私有函数, 通过 getGloss
 * 间接触发. getGloss -> entryToGlossPayload -> rewriteToChinese.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// 拦截 router 模块
vi.mock('../../llm/services/router', () => ({
  generateWithFallback: vi.fn(),
  resetProviderCache: vi.fn(),
}));

// 拦截 dictionary adapter, 返回可控 entry
vi.mock('../../dictionary/services/wiktextractAdapter', () => ({
  getDictionaryAdapter: vi.fn(() => ({
    fetchEntry: vi.fn().mockResolvedValue({
      lemma: 'revolution',
      language: 'en',
      partOfSpeech: 'noun',
      definitions: ['revolution', 'overthrow'],
      examples: ['The industrial revolution transformed society.'],
      etymology: 'from Latin revolutio',
      source: 'wiktextract',
    }),
    clearCache: vi.fn(),
  })),
}));

import { generateWithFallback } from '../../llm/services/router';
import { getGloss } from './glossAdapter';
import { useSettingsStore } from '../../settings/store/useSettingsStore';
import type { TokenOccurrence } from '../../../types';

const makeToken = (overrides: Partial<TokenOccurrence> = {}): TokenOccurrence => ({
  id: 'tok-1',
  lexemeGroupId: 'lex-1',
  surfaceForm: 'revolution',
  lemma: 'revolution',
  objectiveDifficulty: 3,
  startIndex: 0,
  endIndex: 10,
  isResolved: false,
  isActive: false,
  kind: 'normal',
  isCompound: false,
  ...overrides,
});

describe('v2.1.1 Stage 2: rewriteToChinese 使用 expectJson: "gloss" (T15)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(generateWithFallback).mockReset();
    useSettingsStore.setState((s) => ({
      ...s,
      llm: {
        ...s.llm,
        provider: 'deepseek',
        enabled: true,
        apiKey: 'test-key',
        baseUrl: 'https://test.api.deepseek.com/v1',
        model: 'deepseek-chat',
        temperature: 0.5,
        timeout: 5,
        maxRetries: 2,
        streaming: false,
        jsonMaxAttempts: 2,
      },
    }));
  });

  it('T15 [critical]: rewriteToChinese (via getGloss) 使用 expectJson: "gloss"', async () => {
    // mock generateWithFallback 返回 gloss 格式响应
    vi.mocked(generateWithFallback).mockResolvedValue({
      text: JSON.stringify({
        definitions: ['革命', '变革'],
        explanation: '指根本性变化',
      }),
      parsed: {
        definitions: ['革命', '变革'],
        explanation: '指根本性变化',
      },
      fallbackToMock: false,
    });

    const token = makeToken();
    const result = await getGloss(token, 'en');

    // 验证 generateWithFallback 被调用时传入了 expectJson: 'gloss'
    expect(generateWithFallback).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ expectJson: 'gloss' })
    );
    // 验证返回了 LLM 改写结果
    expect(result.definitions).toEqual(['革命', '变革']);
    expect(result.sourceLabel).toContain('AI 改写');
  });
});
