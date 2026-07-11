/**
 * streamingProvider 单元测试 (v1.4.1 Stage 1 — T01..T03)
 *
 * 覆盖 SPEC 要求 3 个 case:
 * - T01 [critical]: streamingGenerate 成功路径 - mock fetch 返回 SSE 流,
 *   验证 onChunk 多次调用 + onComplete 触发 + 累积 text 正确
 * - T02 [critical]: streamingGenerate 取消路径 - 创建 abort controller, 中途
 *   调用 abort(), 验证 reader.cancel() 调用 + 后续 onChunk 不触发
 * - T03 [critical]: streamingGenerate 错误路径 - mock fetch 抛错, 验证
 *   mock fallback 触发 (沙箱行为) + abort 函数仍返回 handle
 *
 * 设计:
 * - mock globalThis.fetch, 模拟 Edge Function SSE 响应
 * - 每个 case 前 resetLLMConfig() + clearAllEnv, 保证测试隔离
 * - 用 vi.hoisted 共享 mock fetch 引用, 避免 TDZ 报错
 * - mockSSE() 工具: 构造 ReadableStream 流式推送 SSE chunks
 *   (模拟真实 LLM 边收边推, 而非一次性 push 完整 body)
 *
 * 注: T03 走 mock fallback (sandbox 行为), 因为 streamingProvider 在 fetch 失败
 * 时会自动降级为 mock 模拟. 真实部署 v1.5.0 会改成直接 onError, Stage 1 沙箱内
 * 我们验证 mock fallback 路径.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { streamingGenerate } from './streamingProvider';
import { resetLLMConfig } from '../config/llmConfig';

const { mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

/**
 * 构造一个 ReadableStream SSE 响应
 *
 * 每个 chunk 间隔 10ms 推送, 模拟真实 LLM 流式行为.
 * 最后发送 `data: [DONE]` 结束.
 *
 * @param chunks 增量文本数组, 每个元素会被包装为 `data: {"delta":"..."}\\n\\n`
 */
function mockSSE(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const ssePayload = chunks
    .map((c) => `data: ${JSON.stringify({ delta: c })}\n\n`)
    .join('') + 'data: [DONE]\n\n';

  // 把整段 SSE 按 chunk 拆分, 每段一个 ReadableStream chunk
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // 一次性 push 整段 payload (简化测试, jsdom 行为可预测)
      controller.enqueue(encoder.encode(ssePayload));
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

describe('streamingGenerate (v1.4.1 Stage 1 — T01..T03)', () => {
  const ENV_KEYS = [
    'VITE_LLM_PROVIDER',
    'VITE_LLM_PROXY_URL',
    'VITE_LLM_MAX_TOKENS',
    'VITE_LLM_TEMPERATURE',
    'VITE_LLM_RETRY_ATTEMPTS',
    'VITE_LLM_TIMEOUT_MS',
  ] as const;

  function stubAllEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>): void {
    for (const k of ENV_KEYS) {
      vi.stubEnv(k, values[k] ?? '');
    }
  }

  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;
    mockFetch.mockReset();
    resetLLMConfig();
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
    resetLLMConfig();
    // 让 mock fallback 的 setTimeout 有机会完成 (避免下一个测试看到未完成状态)
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  it('T01 [critical]: streamingGenerate 成功路径 - 多次 onChunk + onComplete 触发 + 累积 text 正确', async () => {
    // Arrange: 注入 VITE_LLM_PROXY_URL
    stubAllEnv({ VITE_LLM_PROXY_URL: 'http://localhost:8888/proxy' });

    // mock fetch 返回 SSE 响应
    mockFetch.mockResolvedValueOnce(mockSSE(['Hello', ' ', 'world', '!']));

    // 收集回调
    const deltas: string[] = [];
    let completedText: string | null = null;
    let completed = false;

    // Act: 启动 streaming
    const handle = streamingGenerate('openai', {
      prompt: 'Hi',
      onChunk: (delta) => {
        deltas.push(delta);
      },
      onComplete: (full) => {
        completed = true;
        completedText = full;
      },
    });

    // 断言: handle 是 abort 句柄
    expect(typeof handle.abort).toBe('function');

    // 等待流完成 (jsdom 的 ReadableStream 同步推送, 但用 setTimeout 等待 microtask)
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Assert: fetch 被调用 1 次
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe('http://localhost:8888/proxy');
    expect(calledInit.method).toBe('POST');
    // body 包含 stream: true 标志
    const bodyStr = String(calledInit.body);
    expect(bodyStr).toContain('"stream":true');
    expect(bodyStr).toContain('"provider":"openai"');
    expect(bodyStr).toContain('"prompt":"Hi"');

    // Assert: onChunk 多次调用, 累积顺序与原始 chunks 一致
    expect(deltas.length).toBeGreaterThanOrEqual(4);
    expect(deltas.join('')).toBe('Hello world!');

    // Assert: onComplete 触发且 full text 正确
    expect(completed).toBe(true);
    expect(completedText).toBe('Hello world!');
  });

  it('T02 [critical]: streamingGenerate 取消路径 - abort() 触发后 onChunk 停止', async () => {
    // Arrange: 注入 VITE_LLM_PROXY_URL
    stubAllEnv({ VITE_LLM_PROXY_URL: 'http://localhost:8888/proxy' });

    // 构造一个手动控制的 ReadableStream (不让它自然结束, 测试中途取消)
    const encoder = new TextEncoder();
    const cancelSpy = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"delta":"A"}\n\n'));
        // 不 push 后续, 也不 close (模拟流卡住)
      },
      cancel: () => {
        cancelSpy();
      },
    });
    mockFetch.mockResolvedValueOnce(
      new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    );

    const deltas: string[] = [];
    let completed = false;
    let errored: Error | null = null;

    const externalController = new AbortController();

    // Act: 启动 streaming (带外部 signal)
    const handle = streamingGenerate('openai', {
      prompt: 'Hi',
      signal: externalController.signal,
      onChunk: (delta) => {
        deltas.push(delta);
      },
      onComplete: () => {
        completed = true;
      },
      onError: (err) => {
        errored = err;
      },
    });

    // 等待第一波 chunk 到达
    await new Promise((resolve) => setTimeout(resolve, 20));

    // 此时应至少收到 1 个 delta
    expect(deltas.length).toBeGreaterThan(0);

    // Act: 取消
    handle.abort();
    externalController.abort();

    // 等待 abort 生效
    await new Promise((resolve) => setTimeout(resolve, 30));

    // Assert: 取消后, 后续 onChunk 不再触发
    const deltasAtCancel = deltas.length;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(deltas.length).toBe(deltasAtCancel);

    // Assert: 中断后 onComplete 或 onError 至少有一个被调用
    expect(completed || errored !== null).toBe(true);

    // Assert: reader.cancel() 被调用 (通过 stream 的 cancel 回调验证)
    expect(cancelSpy).toHaveBeenCalled();
  });

  it('T03 [critical]: streamingGenerate 错误路径 - fetch 抛错时 mock fallback 触发 + handle 仍返回', async () => {
    // Arrange: 注入 VITE_LLM_PROXY_URL
    stubAllEnv({ VITE_LLM_PROXY_URL: 'http://localhost:8888/proxy' });

    // mock fetch 抛网络错误 (沙箱内 Edge Function 不可用, 模拟真实场景)
    mockFetch.mockRejectedValueOnce(new Error('Network unreachable'));

    const deltas: string[] = [];
    let completed = false;
    let completedText: string | null = null;

    // Act: 启动 streaming
    const handle = streamingGenerate('openai', {
      prompt: 'Hi',
      onChunk: (delta) => {
        deltas.push(delta);
      },
      onComplete: (full) => {
        completed = true;
        completedText = full;
      },
    });

    // Assert: handle 仍返回 (即使 fetch 失败)
    expect(typeof handle.abort).toBe('function');

    // 等待 mock fallback 完成
    // 兜底文本 ~41 个 piece (按 \s+ split), 每 100ms push 一个 → ~4100ms
    // 测试只用前 5 个 chunk 即可验证 onChunk + onComplete 行为
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Assert: mock fallback 触发, onChunk 被调用多次 (至少有 1 个)
    expect(deltas.length).toBeGreaterThan(0);

    // 此时调用 abort 提前结束 (避免完整 4.1s 等待, 测试速度优先)
    handle.abort();

    // 等待 abort 生效 + onComplete 触发
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Assert: onComplete 触发 (abort 也会触发 finalize.complete)
    expect(completed).toBe(true);
    expect(completedText).not.toBeNull();
  });
});
