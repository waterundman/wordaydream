/**
 * v2.2.0 Stage 4 (D3): glossAdapter 缓存集成测试 (T31)
 *
 * 覆盖 test_spec:
 * - T31 [critical]: glossAdapter.entryToGlossPayload 缓存命中时跳过 LLM
 *
 * 设计:
 * - vi.mock('../../llm/services/router') 拦截 generateWithFallback, 计数调用次数
 * - vi.mock('../../dictionary/services/wiktextractAdapter') 返回可控 dictionary entry
 * - 不 mock glossPersistentCache: 用真实实现 + fake-indexeddb 验证端到端缓存行为
 * - 第一次调 getGloss: cache miss → LLM 被调用 → 结果写入缓存
 * - 第二次调 getGloss: cache hit (sourceHash 匹配) → LLM 不被调用 → 返回缓存结果
 *
 * 注意: rewriteToChinese / entryToGlossPayload 是 glossAdapter.ts 内部私有函数,
 * 通过 getGloss 间接触发. getGloss -> entryToGlossPayload -> (cache check) -> rewriteToChinese.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 拦截 router 模块 (与 glossAdapter.expectJson.test.ts 同模式)
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
import { clearAllCachedGlosses, getCachedGlossCount } from '../../dictionary/services/glossPersistentCache';
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

function deleteDb(): Promise<void> {
  return new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('wordaydream-gloss-cache');
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

describe('v2.2.0 Stage 4 (D3): glossAdapter 缓存命中跳过 LLM (T31)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(generateWithFallback).mockReset();
    await deleteDb();
    await clearAllCachedGlosses();
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

  afterEach(async () => {
    await deleteDb();
    await clearAllCachedGlosses();
  });

  it('T31 [critical]: 缓存命中时跳过 LLM (第一次 miss → LLM, 第二次 hit → 跳过)', async () => {
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

    // 第一次调用: cache miss → LLM 被调用
    const result1 = await getGloss(token, 'en');
    expect(result1.definitions).toEqual(['革命', '变革']);
    expect(result1.sourceLabel).toContain('AI 改写');
    expect(generateWithFallback).toHaveBeenCalledTimes(1);

    // 验证缓存已写入
    const countAfterFirst = await getCachedGlossCount();
    expect(countAfterFirst).toBe(1);

    // 第二次调用: cache hit (sourceHash 匹配) → LLM 不被再次调用
    const result2 = await getGloss(token, 'en');
    expect(result2.definitions).toEqual(['革命', '变革']);
    expect(result2.sourceLabel).toContain('AI 改写');
    // LLM 调用次数仍为 1 (第二次走缓存, 跳过 LLM)
    expect(generateWithFallback).toHaveBeenCalledTimes(1);

    // 验证两次返回的 llmExplanation 一致 (缓存命中还原首次结果)
    expect(result2.llmExplanation).toBe(result1.llmExplanation);
  });

  it('T31 补充: 字典原文变化 (sourceHash 不匹配) 时缓存失效, 重新调 LLM', async () => {
    // 第一次写入缓存
    vi.mocked(generateWithFallback).mockResolvedValue({
      text: JSON.stringify({
        definitions: ['革命'],
        explanation: '原始释义',
      }),
      parsed: { definitions: ['革命'], explanation: '原始释义' },
      fallbackToMock: false,
    });
    await getGloss(makeToken(), 'en');
    expect(generateWithFallback).toHaveBeenCalledTimes(1);

    // 模拟字典数据更新: 修改 fetchEntry 返回的 definitions
    const { getDictionaryAdapter } = await import('../../dictionary/services/wiktextractAdapter');
    vi.mocked(getDictionaryAdapter).mockReturnValueOnce({
      fetchEntry: vi.fn().mockResolvedValue({
        lemma: 'revolution',
        language: 'en',
        partOfSpeech: 'noun',
        definitions: ['revolution', 'overthrow', 'NEW-DEFINITION'], // 字典数据变化
        examples: ['The industrial revolution transformed society.'],
        etymology: 'from Latin revolutio',
        source: 'wiktextract',
      }),
      clearCache: vi.fn(),
    } as unknown as ReturnType<typeof getDictionaryAdapter>);

    // 第二次调用: sourceHash 不匹配 → 缓存失效 → 重新调 LLM
    vi.mocked(generateWithFallback).mockResolvedValueOnce({
      text: JSON.stringify({
        definitions: ['革命', '颠覆'],
        explanation: '更新后释义',
      }),
      parsed: { definitions: ['革命', '颠覆'], explanation: '更新后释义' },
      fallbackToMock: false,
    });
    const result2 = await getGloss(makeToken(), 'en');
    // LLM 被再次调用 (sourceHash 不匹配触发重新改写)
    expect(generateWithFallback).toHaveBeenCalledTimes(2);
    expect(result2.definitions).toEqual(['革命', '颠覆']);
  });
});
