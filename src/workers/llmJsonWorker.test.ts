/**
 * v0.4.0-harmony Stage 4 (D4): LLM JSON Worker async API 测试
 *
 * 覆盖:
 * - T01 [fallback]: Worker 不可用时 parseLLMResponseAsync 走主线程 sync 路径
 * - T02 [worker]: mock Worker 后 postMessage 收到 raw + schemaName, 响应透传
 * - T03 [worker-error]: Worker 内部失败 (ok=false) -> reject
 * - T04 [worker-crash]: Worker onerror 后, 下次调用降级到 fallback
 * - T05 [parity]: Worker 路径与 sync 路径对相同 LLM JSON 返回等价 ParseResult
 * - T06 [schema-routing]: 不同 schemaName (passage/evaluation/gloss) 都能正确路由
 * - T08 [timeout]: 超时后终止故障 Worker，后续调用稳定降级
 *
 * 测试策略:
 * - jsdom 默认无 Worker, T01 直接走 fallback
 * - T02-T04: vi.stubGlobal('Worker', MockWorker) 注入 mock
 * - T05-T06: 用 sync parseLLMResponse 作为 oracle, 比对 worker 路径结果
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseLLMResponse,
} from '../features/llm/services/jsonParser';
import {
  parseLLMResponseAsync,
  _resetLlmJsonWorkerForTesting,
  type WorkerSchemaName,
} from '../features/llm/services/llmJsonWorkerClient';
import { useAnalyticsStore } from '../features/analytics/store/useAnalyticsStore';

/**
 * Mock Worker: 捕获 postMessage 请求, 测试代码主动触发 onmessage 响应
 */
class MockWorker {
  static lastInstance: MockWorker | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  postedMessages: Array<{
    id: number;
    raw: string;
    schemaName: WorkerSchemaName;
    expectedLanguage?: string;
  }> = [];
  terminated = false;

  constructor() {
    MockWorker.lastInstance = this;
  }

  postMessage(msg: unknown): void {
    const req = msg as {
      id: number;
      raw: string;
      schemaName: WorkerSchemaName;
      expectedLanguage?: string;
    };
    this.postedMessages.push(req);
  }

  terminate(): void {
    this.terminated = true;
  }

  /** 测试辅助: 模拟 Worker 返回成功响应 (result 是 ParseResult) */
  simulateResponse(
    id: number,
    result: { ok: boolean; data?: unknown; error?: string; repaired?: boolean },
  ): void {
    if (!this.onmessage) return;
    this.onmessage({
      data: { id, ok: true, result },
    } as MessageEvent);
  }

  /** 测试辅助: 模拟 Worker 内部抛错 (response.ok=false) */
  simulateFailure(id: number, error: string): void {
    if (!this.onmessage) return;
    this.onmessage({
      data: { id, ok: false, error },
    } as MessageEvent);
  }

  /** 测试辅助: 模拟 Worker 整体崩溃 (onerror) */
  simulateCrash(): void {
    if (!this.onerror) return;
    this.onerror(new ErrorEvent('error', { message: 'Worker crashed' }));
  }
}

const PASSAGE_JSON = JSON.stringify({
  text: 'Hello world.',
  tokens: [
    {
      lemma: 'hello',
      surfaceForm: 'Hello',
      startIndex: 0,
      endIndex: 5,
      partOfSpeech: 'greeting',
    },
  ],
  grammarPoints: [],
  language: 'en',
});

beforeEach(() => {
  _resetLlmJsonWorkerForTesting();
  MockWorker.lastInstance = null;
  useAnalyticsStore.setState({ llmRepairCount: 0 });
});

afterEach(() => {
  _resetLlmJsonWorkerForTesting();
  vi.unstubAllGlobals();
  MockWorker.lastInstance = null;
});

describe('v0.4.0-harmony Stage 4: parseLLMResponseAsync (LLM JSON Worker)', () => {
  it('T01 [fallback]: Worker 不可用时走主线程 sync 路径, 返回等价结果', async () => {
    // jsdom 默认无 Worker, getLlmJsonWorker() 返回 null -> fallback
    const asyncResult = await parseLLMResponseAsync(PASSAGE_JSON, 'passage');
    const syncResult = parseLLMResponse(PASSAGE_JSON);

    expect(asyncResult.ok).toBe(true);
    expect(asyncResult.data).toBeDefined();
    // 比对核心字段 (data 是 object, deep-equal)
    expect(asyncResult.data).toEqual(syncResult.data);
    expect(asyncResult.repaired).toBe(syncResult.repaired);
  });

  it('T02 [worker]: mock Worker 后 postMessage 收到 raw + schemaName', async () => {
    vi.stubGlobal('Worker', MockWorker);

    const promise = parseLLMResponseAsync(PASSAGE_JSON, 'passage', 'en');
    const mock = MockWorker.lastInstance;
    expect(mock).not.toBeNull();

    // 验证 Worker 收到 postMessage
    expect(mock!.postedMessages).toHaveLength(1);
    const posted = mock!.postedMessages[0];
    expect(posted.raw).toBe(PASSAGE_JSON);
    expect(posted.schemaName).toBe('passage');
    expect(posted.expectedLanguage).toBe('en');
    expect(typeof posted.id).toBe('number');

    // 模拟 Worker 返回成功结果
    mock!.simulateResponse(posted.id, {
      ok: true,
      data: { text: 'Hello world.', tokens: [], language: 'en' },
      repaired: false,
    });

    const result = await promise;
    expect(result.ok).toBe(true);
    expect(result.data).toBeDefined();
    expect((result.data as { text: string }).text).toBe('Hello world.');
  });

  it('T03 [worker-error]: Worker 内部失败 (ok=false) -> reject', async () => {
    vi.stubGlobal('Worker', MockWorker);

    const promise = parseLLMResponseAsync(PASSAGE_JSON, 'passage');

    const rejectSpy = vi.fn();
    promise.catch(rejectSpy);

    const mock = MockWorker.lastInstance;
    const posted = mock!.postedMessages[0];
    mock!.simulateFailure(posted.id, 'zod schema mismatch');

    await new Promise((r) => setTimeout(r, 0));

    expect(rejectSpy).toHaveBeenCalledTimes(1);
    const err = rejectSpy.mock.calls[0][0];
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain('zod schema mismatch');
  });

  it('T04 [worker-crash]: Worker onerror 后, 下次调用降级到 fallback', async () => {
    vi.stubGlobal('Worker', MockWorker);

    // 第一次调用: 触发 Worker 创建, 然后崩溃
    const promise1 = parseLLMResponseAsync(PASSAGE_JSON, 'passage');
    const mock1 = MockWorker.lastInstance;
    expect(mock1).not.toBeNull();

    const rejectSpy1 = vi.fn();
    promise1.catch(rejectSpy1);
    mock1!.simulateCrash();
    await new Promise((r) => setTimeout(r, 0));
    expect(rejectSpy1).toHaveBeenCalled();

    // 第二次调用: Worker 已被标记 unsupported, 应 fallback 到主线程 sync 路径
    const result2 = await parseLLMResponseAsync(PASSAGE_JSON, 'passage');
    expect(result2.ok).toBe(true);
    expect(result2.data).toBeDefined();
  });

  it('T05 [parity]: Worker 路径与 sync 路径对相同 JSON 返回等价 ParseResult', async () => {
    vi.stubGlobal('Worker', MockWorker);

    const promise = parseLLMResponseAsync(PASSAGE_JSON, 'passage');
    const mock = MockWorker.lastInstance;
    const posted = mock!.postedMessages[0];

    // 用 sync parseLLMResponse 作为 oracle, 模拟 Worker 内部跑相同逻辑
    const syncResult = parseLLMResponse(posted.raw);
    mock!.simulateResponse(posted.id, {
      ok: syncResult.ok,
      data: syncResult.data,
      error: syncResult.error,
      repaired: syncResult.repaired,
    });

    const asyncResult = await promise;
    expect(asyncResult.ok).toBe(syncResult.ok);
    expect(asyncResult.data).toEqual(syncResult.data);
    expect(asyncResult.repaired).toBe(syncResult.repaired);
  });

  it('T06 [schema-routing]: 不同 schemaName 都能正确路由到 Worker', async () => {
    vi.stubGlobal('Worker', MockWorker);

    const glossJson = JSON.stringify({
      definitions: ['苹果'],
      explanation: '水果',
    });

    // gloss schema
    const promise = parseLLMResponseAsync(glossJson, 'gloss');
    const mock = MockWorker.lastInstance;
    const posted = mock!.postedMessages[0];

    expect(posted.schemaName).toBe('gloss');

    // 模拟 Worker 返回成功结果
    mock!.simulateResponse(posted.id, {
      ok: true,
      data: { definitions: ['苹果'], explanation: '水果' },
      repaired: false,
    });

    const result = await promise;
    expect(result.ok).toBe(true);
    expect((result.data as { definitions: string[] }).definitions).toEqual(['苹果']);
  });

  it('T07 [repaired-analytics]: Worker 路径 repaired=true 时主线程代为埋点', async () => {
    vi.stubGlobal('Worker', MockWorker);

    const initialCount = useAnalyticsStore.getState().llmRepairCount;
    expect(initialCount).toBe(0);

    const promise = parseLLMResponseAsync(PASSAGE_JSON, 'passage');
    const mock = MockWorker.lastInstance;
    const posted = mock!.postedMessages[0];

    // 模拟 Worker 返回 repaired=true 的成功结果
    mock!.simulateResponse(posted.id, {
      ok: true,
      data: { text: 'Hello world.', tokens: [], language: 'en' },
      repaired: true,
    });

    await promise;

    // 主线程 onmessage 内代为埋点
    const afterCount = useAnalyticsStore.getState().llmRepairCount;
    expect(afterCount).toBe(1);
  });

  it('T08 [timeout]: 超时后终止 Worker，并让后续调用降级', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('Worker', MockWorker);

    const promise = parseLLMResponseAsync(PASSAGE_JSON, 'passage');
    const rejection = expect(promise).rejects.toThrow('LLM JSON worker timeout (60s)');
    const mock = MockWorker.lastInstance;
    await vi.advanceTimersByTimeAsync(60000);
    await rejection;

    expect(mock?.terminated).toBe(true);
    const fallback = await parseLLMResponseAsync(PASSAGE_JSON, 'passage');
    expect(fallback.ok).toBe(true);
    expect(MockWorker.lastInstance).toBe(mock);
    vi.useRealTimers();
  });
});
