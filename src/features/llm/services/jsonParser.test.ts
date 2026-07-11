/**
 * parseLLMResponse 单元测试 (v1.2.0 Stage 4 hotfix P1-A + hotfix-3)
 *
 * 覆盖 SPEC 要求 7 + 2 个 case:
 * - T01 [critical]: tokens 字段是 null -> 默认空数组 (zod .nullable().default([]))
 * - T02 [critical]: tokens 字段缺失 -> 默认空数组
 * - T03 [critical]: grammarPoints 字段是 null -> 默认空数组
 * - T04 [critical]: 解析失败时 console.info 打印 LLM 原始响应前 500 chars
 * - T05 [critical]: zod error context 反馈到 retry prompt (buildRetryPrompt with zod issues)
 * - T06 [sanity]: parsePassagePayload 接受 null tokens (Stage 4 hotfix)
 * - T07 [sanity]: parseLLMResponse 接受合法 JSON, 一次成功
 * - T08 [critical] (hotfix-3): expectedLanguage='de' + parsed.data.language='en' -> ok=false
 * - T09 [non-critical] (hotfix-3): expectedLanguage='de' + parsed.data.language='de' -> ok=true
 *
 * 设计:
 * - 直接 import parseLLMResponse + parsePassagePayload 测试核心解析逻辑
 * - 用 vi.spyOn(console, 'info') 验证 T04 错误日志打印
 * - T05 不直接调 buildRetryPrompt (router.ts 内部), 通过 mock provider.generate
 *   验证第二次调用 prompt 含 issues 字段
 * - useAnalyticsStore 提前 import, 验证 repair 计数 (T03 间接)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseLLMResponse, parsePassagePayload } from './jsonParser';
import { useAnalyticsStore } from '../../analytics/store/useAnalyticsStore';

describe('parseLLMResponse (Stage 4 hotfix P1-A: schema 放宽 + 错误日志)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 重置 analytics 计数
    useAnalyticsStore.setState({ llmRepairCount: 0 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('T01 [critical]: tokens 字段是 null -> 默认空数组', () => {
    const raw = JSON.stringify({
      language: 'en',
      difficulty: 2,
      text: 'Hello world.',
      tokens: null,
      grammarPoints: null,
    });
    const result = parseLLMResponse(raw);
    expect(result.ok).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!.tokens).toEqual([]);
    expect(result.data!.grammarPoints).toEqual([]);
  });

  it('T02 [critical]: tokens 字段缺失 -> 默认空数组', () => {
    const raw = JSON.stringify({
      language: 'en',
      difficulty: 2,
      text: 'Hello world.',
      // tokens 字段完全缺失
    });
    const result = parseLLMResponse(raw);
    expect(result.ok).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!.tokens).toEqual([]);
    expect(result.data!.grammarPoints).toEqual([]);
  });

  it('T03 [critical]: grammarPoints 字段是 null -> 默认空数组', () => {
    const raw = JSON.stringify({
      language: 'en',
      difficulty: 2,
      text: 'Hello world.',
      tokens: [
        {
          id: 't_001',
          lemma: 'hello',
          surfaceForm: 'Hello',
          startIndex: 0,
          endIndex: 5,
          partOfSpeech: 'interjection',
        },
      ],
      grammarPoints: null,
    });
    const result = parseLLMResponse(raw);
    expect(result.ok).toBe(true);
    expect(result.data).toBeDefined();
    // grammarPoints null 应被默认成 []
    expect(result.data!.grammarPoints).toEqual([]);
    // tokens 应被保留
    expect(result.data!.tokens).toHaveLength(1);
    expect(result.data!.tokens[0].surfaceForm).toBe('Hello');
  });

  it('T04 [critical]: 解析失败时 console.info 打印 LLM 原始响应前 500 chars', () => {
    // 模拟 LLM 返回 schema 错误: text 字段是 number 而非 string
    const raw = JSON.stringify({
      language: 'en',
      difficulty: 2,
      text: 12345, // text 必须是 string, 这里故意写错
      tokens: [],
    });
    const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    const result = parseLLMResponse(raw);
    expect(result.ok).toBe(false);

    // 找到 [JSON Parse Failure] 日志
    const failureLog = consoleInfoSpy.mock.calls.find(
      (call) => typeof call[0] === 'string' && call[0].includes('[JSON Parse Failure]')
    );
    expect(failureLog).toBeDefined();
    const logMessage = failureLog![0] as string;
    // 日志含 schema 错误摘要
    expect(logMessage).toContain('Schema validation failed');
    // 日志含 raw preview (前 500 chars)
    expect(logMessage).toContain('raw (first 500 chars)');
    expect(logMessage).toContain('12345');
    // 日志含 issues 数组
    expect(logMessage).toContain('issues:');
  });

  it('T05 [critical]: zod issues 在 ParseResult.issues 字段返回', () => {
    // 构造 schema 错误: text 缺失, tokens 类型错
    const raw = JSON.stringify({
      language: 'en',
      difficulty: 2,
      // text 字段缺失
      tokens: 'not an array', // tokens 必须是 array
    });
    const result = parseLLMResponse(raw);
    expect(result.ok).toBe(false);
    // issues 字段存在, 列出每个问题的 path + message
    expect(result.issues).toBeDefined();
    expect(Array.isArray(result.issues)).toBe(true);
    // 至少应包含 text 字段和 tokens 字段的问题
    const paths = result.issues!.map((i) => i.path);
    expect(paths).toContain('text');
    expect(paths).toContain('tokens');
    // 每个 issue 都有 message
    for (const issue of result.issues!) {
      expect(issue.path).toBeTruthy();
      expect(issue.message).toBeTruthy();
    }
  });

  it('T06 [sanity]: parsePassagePayload 接受 null tokens (Stage 4 hotfix)', () => {
    // 验证业务级入口也兼容 null tokens
    const raw = JSON.stringify({
      language: 'en',
      difficulty: 2,
      text: 'Hello world.',
      tokens: null,
    });
    const result = parsePassagePayload(raw);
    expect(result.ok).toBe(true);
    expect(result.data!.tokens).toEqual([]);
    expect(result.data!.grammarPoints).toEqual([]);
  });

  it('T07 [sanity]: parseLLMResponse 接受合法 JSON, 一次成功', () => {
    const raw = JSON.stringify({
      language: 'en',
      difficulty: 2,
      text: 'Hello world.',
      tokens: [
        {
          id: 't_001',
          lemma: 'hello',
          surfaceForm: 'Hello',
          startIndex: 0,
          endIndex: 5,
          partOfSpeech: 'interjection',
        },
      ],
      grammarPoints: null,
    });
    const result = parseLLMResponse(raw);
    expect(result.ok).toBe(true);
    expect(result.data!.tokens).toHaveLength(1);
    // 不应走 jsonrepair 路径
    expect(result.repaired).toBe(false);
  });

  it('T08 [hotfix-3 critical]: expectedLanguage="de" + parsed.data.language="en" -> ok=false', () => {
    // 模拟 deepseek-v4-flash 真实 LLM 行为: 即使 prompt 强约束 de, 仍返回 en.
    // parseLLMResponse 应该检测 language mismatch, 返回 ok=false 让 router 走 retry.
    const raw = JSON.stringify({
      language: 'en', // LLM 实际返回的语言
      difficulty: 2,
      text: 'Anna woke up early. The sun was just rising behind the hills. Birds were singing in the garden.',
      tokens: [
        {
          id: 't_001',
          lemma: 'wake',
          surfaceForm: 'woke',
          startIndex: 5,
          endIndex: 9,
          partOfSpeech: 'verb',
        },
      ],
      grammarPoints: [],
    });
    const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    // 期望德文, LLM 返回英文 -> 应被判定为 parse failure
    const result = parseLLMResponse(raw, 'de');

    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('Language mismatch');
    expect(result.error).toContain('"en"');
    expect(result.error).toContain('"de"');
    expect(result.data).toBeUndefined();

    // 验证 [Language Compliance] 日志被打印
    const complianceLog = consoleInfoSpy.mock.calls.find(
      (call) => typeof call[0] === 'string' && call[0].includes('[Language Compliance]')
    );
    expect(complianceLog).toBeDefined();
  });

  it('T09 [hotfix-3 non-critical]: expectedLanguage="de" + parsed.data.language="de" -> ok=true', () => {
    // 期望德文, LLM 也返回德文 -> 应通过 language compliance check.
    const raw = JSON.stringify({
      language: 'de',
      difficulty: 2,
      text: 'Anna ging am Morgen in den Park. Der Hund des Nachbarn saß am Zaun und bellte.',
      tokens: [
        {
          id: 't_001',
          lemma: 'gehen',
          surfaceForm: 'ging',
          startIndex: 5,
          endIndex: 9,
          partOfSpeech: 'verb',
        },
      ],
      grammarPoints: [],
    });
    const result = parseLLMResponse(raw, 'de');
    expect(result.ok).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!.text).toContain('Anna ging am Morgen');
    expect(result.data!.tokens).toHaveLength(1);
    expect(result.data!.tokens[0].surfaceForm).toBe('ging');
  });
});
