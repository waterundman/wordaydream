/**
 * v2.2.0 Stage 1 (D4): passageGenerator source 标签测试.
 *
 * 覆盖 test_spec:
 * - T05 [critical]: generatePassage LLM 路径返回 source: 'llm'
 * - T06 [critical]: generatePassage mock fallback 路径返回 source: 'mock'
 *
 * Mock 策略:
 * - T05: mock generateWithFallback 返回合法 passage JSON + mock detectGrammarPoints 返回 []
 *   (safeEvaluateDifficulty 内部 try-catch 会 fallback 到 mock, 无需额外 mock)
 * - T06: 设置 llm.enabled=false (或 provider='mock') 直接走 getMockPassage fallback
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generatePassage, clearPassageCache } from './passageGenerator';
import * as routerModule from '../../llm/services/router';
import * as grammarDetectorModule from '../../grammar/services/grammarDetector';
import { useSettingsStore } from '../../settings/store/useSettingsStore';
import { useWordlistStore } from '../../wordlist/store/useWordlistStore';
import { useMemoryStore } from '../../review/store/useMemoryStore';
import { clearWordlistCache } from '../../../data/wordlists';

// 合法英文 passage JSON (offsets 已验证)
const enPassageText = 'The cat sat on the mat.';
const enPassageJson = JSON.stringify({
  language: 'en',
  difficulty: 2,
  text: enPassageText,
  tokens: [
    { lemma: 'cat', surfaceForm: 'cat', startIndex: 4, endIndex: 7, partOfSpeech: 'noun' },
    { lemma: 'sat', surfaceForm: 'sat', startIndex: 8, endIndex: 11, partOfSpeech: 'verb' },
  ],
});

describe('v2.2.0 Stage 1 (D4): passageGenerator source 标签', () => {
  beforeEach(() => {
    if (typeof window !== 'undefined') window.localStorage.clear();
    clearPassageCache();
    clearWordlistCache();
    useSettingsStore.setState((s) => ({
      llm: {
        ...s.llm,
        enabled: true,
        provider: 'openai',
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

  it('T05 [critical]: generatePassage LLM 路径返回 source: "llm"', async () => {
    // Mock generateWithFallback 返回合法 passage JSON
    vi.spyOn(routerModule, 'generateWithFallback').mockResolvedValue({
      text: enPassageJson,
    });
    // Mock detectGrammarPoints 避免真实 LLM 调用 (generatePassage 无 try-catch 包裹此调用)
    vi.spyOn(grammarDetectorModule, 'detectGrammarPoints').mockResolvedValue([]);

    const passage = await generatePassage('en', 2, []);

    // LLM 路径成功, source 应为 'llm'
    expect(passage.source).toBe('llm');
    expect(passage.text).toBe(enPassageText);
    expect(passage.tokens.length).toBeGreaterThan(0);
    // generateWithFallback 至少被调用 1 次 (passage 生成)
    expect(routerModule.generateWithFallback).toHaveBeenCalled();
  });

  it('T06 [critical]: generatePassage mock fallback 路径返回 source: "mock"', async () => {
    // 设置 LLM 禁用, 直接走 getMockPassage fallback
    useSettingsStore.setState((s) => ({
      llm: {
        ...s.llm,
        enabled: false,
        provider: 'mock',
      },
    }));
    // 设置 spy 以验证 LLM 路径未被调用 (afterEach restoreAllMocks 会清除 T05 的 spy)
    const spy = vi.spyOn(routerModule, 'generateWithFallback').mockResolvedValue({
      text: enPassageJson,
    });

    const passage = await generatePassage('en', 2, []);

    // mock fallback 路径, source 应为 'mock'
    expect(passage.source).toBe('mock');
    // 不应调用 generateWithFallback (LLM 路径被跳过)
    expect(spy).not.toHaveBeenCalled();
  });

  it('扩展: LLM enabled 但 provider="mock" 也走 fallback (source: "mock")', async () => {
    // enabled=true 但 provider='mock' → 条件 `llm.enabled && llm.provider !== 'mock'` 为 false
    useSettingsStore.setState((s) => ({
      llm: {
        ...s.llm,
        enabled: true,
        provider: 'mock',
      },
    }));
    const spy = vi.spyOn(routerModule, 'generateWithFallback').mockResolvedValue({
      text: enPassageJson,
    });

    const passage = await generatePassage('en', 2, []);

    expect(passage.source).toBe('mock');
    expect(spy).not.toHaveBeenCalled();
  });
});
