/**
 * v0.4.0-harmony Stage 4 (D4): CSV Worker async API 测试
 *
 * 覆盖:
 * - T01 [fallback]: Worker 不可用时 parseCsvWordlistAsync 走主线程 sync 路径
 * - T02 [worker]: mock Worker 后 parseCsvWordlistAsync 走 Worker 路径, 返回结果等价
 * - T03 [worker-error]: Worker 抛错时 reject, 主线程拿到 error
 * - T04 [worker-crash]: Worker onerror 触发后, 后续调用降级到 fallback
 * - T05 [parity]: Worker 路径与 sync 路径对相同 CSV 返回等价 entries
 *
 * 测试策略:
 * - jsdom 默认无 Worker, T01 直接走 fallback
 * - T02-T04: 用 vi.stubGlobal('Worker', MockWorker) 注入 mock
 *   MockWorker 模拟 postMessage / onmessage / onerror 协议
 * - T05: 同一份 CSV 同时跑 sync + async, deep-equal 比对
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseCsvWordlist,
  parseCsvWordlistAsync,
  _resetCsvWorkerForTesting,
} from '../data/wordlists/csvLoader';

/**
 * Mock Worker: 捕获 postMessage 请求, 测试代码主动触发 onmessage 响应
 *
 * 用法:
 *   const mock = new MockWorker();
 *   mock.simulateResponse(id, result);  // 触发 onmessage
 *   mock.simulateError(message);        // 触发 onerror
 */
class MockWorker {
  static lastInstance: MockWorker | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  postedMessages: Array<{ id: number; csvText: string; fileName?: string }> = [];
  terminated = false;

  constructor() {
    MockWorker.lastInstance = this;
  }

  postMessage(msg: unknown): void {
    const req = msg as { id: number; csvText: string; fileName?: string };
    this.postedMessages.push(req);
  }

  terminate(): void {
    this.terminated = true;
  }

  /** 测试辅助: 模拟 Worker 返回成功响应 */
  simulateResponse(id: number, result: unknown): void {
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

const CSV_FIXTURE = [
  'lemma,pos,translation,cefr,priority,topic,semanticConflicts',
  'apple,noun,苹果,A1,1,food,pear|orange',
  'run,verb,跑,A2,2,action,',
].join('\n');

beforeEach(() => {
  _resetCsvWorkerForTesting();
  MockWorker.lastInstance = null;
});

afterEach(() => {
  _resetCsvWorkerForTesting();
  vi.unstubAllGlobals();
  MockWorker.lastInstance = null;
});

describe('v0.4.0-harmony Stage 4: parseCsvWordlistAsync (CSV Worker)', () => {
  it('T01 [fallback]: Worker 不可用时走主线程 sync 路径, 返回等价结果', async () => {
    // jsdom 默认无 Worker, getCsvWorker() 返回 null -> fallback 到 parseCsvWordlist
    const asyncResult = await parseCsvWordlistAsync(CSV_FIXTURE, 'fixture.csv');
    const syncResult = parseCsvWordlist(CSV_FIXTURE, 'fixture.csv');

    expect(asyncResult.success).toBe(true);
    expect(asyncResult.entries).toEqual(syncResult.entries);
    expect(asyncResult.errors).toEqual(syncResult.errors);
    expect(asyncResult.fileName).toBe('fixture.csv');
    expect(asyncResult.entries).toHaveLength(2);
    expect(asyncResult.entries[0].lemma).toBe('apple');
    expect(asyncResult.entries[0].semanticConflicts).toEqual(['pear', 'orange']);
  });

  it('T02 [worker]: mock Worker 后 postMessage 收到请求, 响应结果透传', async () => {
    vi.stubGlobal('Worker', MockWorker);

    // 不 await, 先拿到 promise 再模拟 Worker 响应
    const promise = parseCsvWordlistAsync(CSV_FIXTURE, 'via-worker.csv');
    const mock = MockWorker.lastInstance;
    expect(mock).not.toBeNull();

    // 验证 Worker 收到 postMessage
    expect(mock!.postedMessages).toHaveLength(1);
    const posted = mock!.postedMessages[0];
    expect(posted.csvText).toBe(CSV_FIXTURE);
    expect(posted.fileName).toBe('via-worker.csv');
    expect(typeof posted.id).toBe('number');

    // 模拟 Worker 返回结果 (用一个等价的 CsvImportResult)
    const fakeResult = {
      success: true,
      entries: [
        { lemma: 'mocked', pos: 'noun', translation: '模拟', cefr: 'A1', priority: 1 },
      ],
      errors: [],
      fileName: 'via-worker.csv',
      importedAt: 12345,
    };
    mock!.simulateResponse(posted.id, fakeResult);

    const result = await promise;
    expect(result.success).toBe(true);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].lemma).toBe('mocked');
    expect(result.fileName).toBe('via-worker.csv');
  });

  it('T03 [worker-error]: Worker 内部失败 (ok=false) -> reject 带 error message', async () => {
    vi.stubGlobal('Worker', MockWorker);

    const promise = parseCsvWordlistAsync(CSV_FIXTURE, 'fail.csv');

    // 捕获 reject
    const rejectSpy = vi.fn();
    promise.catch(rejectSpy);

    const mock = MockWorker.lastInstance;
    const posted = mock!.postedMessages[0];
    mock!.simulateFailure(posted.id, 'papaparse internal error');

    // 等微任务落地
    await new Promise((r) => setTimeout(r, 0));

    expect(rejectSpy).toHaveBeenCalledTimes(1);
    const err = rejectSpy.mock.calls[0][0];
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain('papaparse internal error');
  });

  it('T04 [worker-crash]: Worker onerror 后, 下次调用降级到 fallback', async () => {
    vi.stubGlobal('Worker', MockWorker);

    // 第一次调用: 触发 Worker 创建, 然后让它崩溃
    const promise1 = parseCsvWordlistAsync(CSV_FIXTURE, 'crash.csv');
    const mock1 = MockWorker.lastInstance;
    expect(mock1).not.toBeNull();

    // 模拟 Worker 崩溃 -> 当前 promise 应 reject
    const rejectSpy1 = vi.fn();
    promise1.catch(rejectSpy1);
    mock1!.simulateCrash();
    await new Promise((r) => setTimeout(r, 0));
    expect(rejectSpy1).toHaveBeenCalled();

    // 第二次调用: Worker 已被标记 unsupported, 应 fallback 到主线程 sync 路径
    // (注意: 第二次调用不会创建新 Worker, MockWorker.lastInstance 仍是 mock1)
    const result2 = await parseCsvWordlistAsync(CSV_FIXTURE, 'after-crash.csv');
    expect(result2.success).toBe(true);
    expect(result2.entries).toHaveLength(2);
    expect(result2.fileName).toBe('after-crash.csv');
  });

  it('T05 [parity]: Worker 路径与 sync 路径对相同 CSV 返回等价 entries', async () => {
    vi.stubGlobal('Worker', MockWorker);

    const promise = parseCsvWordlistAsync(CSV_FIXTURE, 'parity.csv');
    const mock = MockWorker.lastInstance;
    const posted = mock!.postedMessages[0];

    // 让 Worker 内部跑真实解析逻辑 (用主线程的 parseCsvWordlist 模拟 worker 内解析)
    const workerSideResult = parseCsvWordlist(posted.csvText, posted.fileName);
    mock!.simulateResponse(posted.id, workerSideResult);

    const asyncResult = await promise;
    const syncResult = parseCsvWordlist(CSV_FIXTURE, 'parity.csv');

    expect(asyncResult.entries).toEqual(syncResult.entries);
    expect(asyncResult.errors).toEqual(syncResult.errors);
    expect(asyncResult.success).toBe(syncResult.success);
  });
});
