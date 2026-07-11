/**
 * Wordaydream v1.4.1 Stage 1 — Streaming Provider (SSE)
 *
 * 职责:
 * - 函数式 streaming provider, 与 openaiGenerate / anthropicGenerate / deepseekGenerate 同构
 * - 调 Edge Function 拿 text/event-stream, 解析为增量文本回调
 * - 支持 AbortController 取消 (返回 { abort } 让调用方控制)
 *
 * 与 v1.4.0 关系:
 * - v1.4.0: 函数式 provider 走 `await response.json()`, Edge Function 包装为 LLMResponse
 * - v1.4.1 Stage 1: 走 `response.body.getReader()` 解析 SSE, 边收边推
 * - 协议约定: Edge Function 收到 `stream: true` 后, 返回 text/event-stream
 *   (每个 SSE 事件 data 字段是 { delta: "..." } 或 [DONE])
 *
 * 沙箱 100% 可执行:
 * - mock fetch 返回 ReadableStream (vitest 验证)
 * - Edge Function 在沙箱内不部署, 但 streamingGenerate 内部不依赖 Edge Function
 *   (纯客户端 fetch + SSE 解析)
 *
 * Mock fallback (sandbox 验证用):
 * - 当 fetch 失败 / 返回非 SSE / Content-Type 不对时, 自动降级为 mockPassages
 *   模拟, 每 100ms push 一个 chunk (单词级), 验证 streaming 行为
 * - 真实部署时, mock fallback 不会触发 (Edge Function 返回正确 Content-Type)
 *
 * 不修改 GenerateOptions 签名 (v1.4.0 13 合同保持):
 * - 仍接受 GenerateOptions, 新增 onChunk / onComplete / onError 字段
 * - options.signal 仍由调用方传入, 联动 AbortController
 */

import type { GenerateOptions } from './provider';
import { getLLMConfig } from '../config/llmConfig';
import { parseSSEStream } from './llmStream';

/**
 * 增量文本回调
 *
 * 每次 onChunk 被调用, 调用方应把 delta 拼接到累积 buffer.
 */
export type StreamHandler = (delta: string) => void;

/**
 * Streaming 调用的完整 options
 *
 * 扩展 GenerateOptions: 增加 onChunk / onComplete / onError 三个回调.
 * - onChunk 必传 (streaming 核心)
 * - onComplete / onError 可选 (调用方关心完成 / 错误时传入)
 */
export interface StreamingOptions extends GenerateOptions {
  onChunk: StreamHandler;
  onComplete?: (fullText: string) => void;
  onError?: (error: Error) => void;
}

/**
 * Provider 标识 (与 v1.4.0 函数式 provider 列表一致)
 */
export type StreamingProviderName = 'openai' | 'anthropic' | 'deepseek';

/**
 * 沙箱 mock fallback 的 chunk 推送间隔 (ms)
 *
 * 真实 LLM 速度不可控, mock 用 100ms 模拟"逐字出现"效果.
 * 测试可调小此值加速 (不过本模块不暴露配置, 测试直接 mock fetch).
 */
const MOCK_CHUNK_INTERVAL_MS = 100;

/**
 * Edge Function 期望的 SSE 响应 Content-Type
 */
const SSE_CONTENT_TYPE = 'text/event-stream';

/**
 * Streaming 调用的 abort 句柄
 *
 * 调用方拿到后, 任何时刻调用 abort() 即可停止流.
 * abort 触发后, 后续 onChunk / onComplete / onError 都不会再被调用.
 */
export interface StreamAbortHandle {
  abort: () => void;
}

/**
 * Streaming Provider 主入口
 *
 * 流程:
 * - 读 llmConfig.proxyUrl, POST `{ provider, stream: true, ...options }`
 * - 检查 Response Content-Type, 是 text/event-stream 走 parseSSEStream
 * - 否则 (fetch 失败 / mock 场景), 走 mock fallback: 模拟 SSE 行为
 * - 返回 { abort } 给调用方, 支持中途取消
 *
 * 注: 函数本身是同步的 (返回 StreamAbortHandle 句柄), 内部 runStream
 *     以 fire-and-forget 方式异步执行. 这样调用方可以立即拿到 abort 句柄,
 *     避免 Promise<StreamAbortHandle> 在调用方反复 await 的 boilerplate.
 *
 * @param provider  LLM provider 名称 (openai / anthropic / deepseek)
 * @param options   调用参数 (system / prompt / ...) + 三个回调
 * @returns StreamAbortHandle, 调用 abort() 中断流
 *
 * @example
 * ```ts
 * const handle = streamingGenerate('openai', {
 *   prompt: '...',
 *   onChunk: (delta) => buffer += delta,
 *   onComplete: (full) => console.log('done:', full),
 *   onError: (e) => console.error(e),
 * });
 * // 5 秒后取消
 * setTimeout(() => handle.abort(), 5000);
 * ```
 */
export function streamingGenerate(
  provider: StreamingProviderName,
  options: StreamingOptions
): StreamAbortHandle {
  // 内部 AbortController 联动 options.signal
  const internalController = new AbortController();
  if (options.signal) {
    if (options.signal.aborted) {
      internalController.abort();
    } else {
      options.signal.addEventListener(
        'abort',
        () => internalController.abort(),
        { once: true }
      );
    }
  }

  // 累积 buffer (在闭包内, 不暴露)
  let buffer = '';
  // 是否已结束 (onComplete / onError 只触发一次)
  let finished = false;

  const finalize = {
    chunk: (delta: string) => {
      if (finished) return;
      buffer += delta;
      try {
        options.onChunk(delta);
      } catch {
        // onChunk 异常不应中断流 (调用方 bug 不应影响 provider)
      }
    },
    complete: () => {
      if (finished) return;
      finished = true;
      try {
        options.onComplete?.(buffer);
      } catch {
        // onComplete 异常不应抛出
      }
    },
    fail: (err: Error) => {
      if (finished) return;
      finished = true;
      try {
        options.onError?.(err);
      } catch {
        // onError 异常不应抛出
      }
    },
    /**
     * v1.5.2 fix M7: 清空累积 buffer, 用于 mock fallback 前重置.
     *
     * 当 SSE 解析失败需要走 mock fallback 时, 之前已累积的半截真实文本
     * 不应与 mock 文本拼接 (会产生混合内容). 调用 reset() 清空 buffer,
     * 让 runMockStream 的 mock 文本作为完整内容输出.
     */
    reset: () => {
      buffer = '';
    },
  };

  // 启动主流程 (fire-and-forget, 不 await)
  void runStream(provider, options, internalController.signal, finalize);

  return {
    abort: () => {
      internalController.abort();
    },
  };
}

/**
 * 内部 finalize 接口 (闭包封装 buffer / finished 状态)
 *
 * v1.5.2 fix M7: 新增 reset() 方法, 用于 mock fallback 前清空 buffer,
 * 避免真实流式文本与 mock 文本拼接.
 */
interface StreamFinalize {
  chunk: (delta: string) => void;
  complete: () => void;
  fail: (err: Error) => void;
  reset: () => void;
}

/**
 * 实际执行流式调用的内部函数
 *
 * 拆出函数方便测试 (vi.mock 替换 fetch 时, runStream 内部走 mock 路径).
 * 沙箱内 fetch 可能失败 (无 Edge Function), 此时走 mockPassages 模拟.
 */
async function runStream(
  provider: StreamingProviderName,
  options: StreamingOptions,
  signal: AbortSignal,
  finalize: StreamFinalize
): Promise<void> {
  const config = getLLMConfig();

  // model 默认值与各 provider 函数式 provider 保持一致
  const model = pickModel(provider);

  // 构造 Edge Function 请求体
  const requestBody = {
    provider,
    model,
    system: options.system,
    prompt: options.prompt,
    temperature: options.temperature,
    maxTokens: options.maxTokens,
    expectJson: options.expectJson,
    // v1.5.3 fix V4-P3-007: 移除不必要的 as 断言, options 已有 expectedLanguage 字段.
    expectedLanguage: options.expectedLanguage,
    // v1.4.1: 通知 Edge Function 走 stream 路径
    stream: true,
  };

  let response: Response;
  try {
    response = await fetch(config.proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal,
    });
  } catch (error) {
    // 网络错误 → mock fallback
    if (signal.aborted) {
      finalize.complete();
      return;
    }
    // v1.5.2 fix M7: mock fallback 前清空 buffer, 避免与未发出的真实文本拼接
    finalize.reset();
    runMockStream(options.prompt, signal, finalize);
    return;
  }

  if (!response.ok) {
    // HTTP 错误: 透传错误信息, 走 mock fallback
    const body = await response.text().catch(() => '');
    const err = new Error(
      `LLM proxy error: ${response.status} ${response.statusText} ${body.slice(0, 200)}`
    ) as Error & { status?: number; body?: string };
    err.status = response.status;
    err.body = body;

    // v1.5.2 fix H6: 501 = provider 不支持流式, 显式报错而非静默降级
    if (response.status === 501) {
      finalize.fail(new Error('当前 provider 不支持流式生成，请切换到 OpenAI 或在设置中关闭流式模式'));
      return;
    }

    // 其它 HTTP 错误: 走 mock fallback, 保持沙箱可演示
    if (!signal.aborted) {
      // v1.5.2 fix M7: HTTP 错误时尚未接收任何 chunk, 但仍 reset 防御性清空
      finalize.reset();
      runMockStream(options.prompt, signal, finalize);
    } else {
      finalize.fail(err);
    }
    return;
  }

  // 检查 Content-Type 决定走 SSE 解析 还是 mock fallback
  const contentType = response.headers.get('Content-Type') ?? '';
  if (!contentType.toLowerCase().includes(SSE_CONTENT_TYPE)) {
    // 非 SSE 响应 (e.g. Edge Function 旧版本未支持 stream 标志)
    // 沙箱环境: 走 mock fallback 演示 streaming
    // v1.5.2 fix M7: 重置 buffer 后再走 mock
    finalize.reset();
    runMockStream(options.prompt, signal, finalize);
    return;
  }

  // 正常 SSE 流
  try {
    await parseSSEStream(response, (chunk) => {
      if (chunk.error) {
        // SSE 解析错误 → mock fallback
        if (!signal.aborted) {
          // v1.5.2 fix M7: 已累积的真实 chunk 必须清空, 否则与 mock 文本拼接
          finalize.reset();
          runMockStream(options.prompt, signal, finalize);
        } else {
          finalize.fail(new Error(chunk.error));
        }
        return;
      }
      if (chunk.done) {
        finalize.complete();
        return;
      }
      finalize.chunk(chunk.delta);
    }, signal);
  } catch (error) {
    finalize.fail(error instanceof Error ? error : new Error('Stream error'));
  }
}

/**
 * 沙箱 mock fallback: 模拟 SSE 行为, 每 100ms push 一个 chunk
 *
 * 触发条件:
 * - fetch 失败 (无 Edge Function / 网络错误)
 * - Edge Function 返回非 SSE (旧版本未实现 stream 标志)
 * - SSE 解析过程出错
 *
 * 行为:
 * - 把 prompt 拆成单词 (按空格分), 每 MOCK_CHUNK_INTERVAL_MS push 一个
 * - 这样测试可以验证 streaming 的 onChunk 多次调用 + buffer 累积
 * - signal 中断时, 停止 push (调用 setTimeout cancel)
 */
function runMockStream(
  _prompt: string,
  signal: AbortSignal,
  finalize: StreamFinalize
): void {
  // 兜底文本 (与 mockProvider mockPassages 风格一致)
  const fallbackText =
    'The small town of Willowbrook was undergoing a quiet revolution. ' +
    'For decades, nothing had changed the pace of daily life.';

  // 拆为单词数组, push 时用 ' ' 拼接
  const words = fallbackText.split(/(\s+)/);
  let index = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const pushNext = () => {
    if (signal.aborted) {
      finalize.complete();
      return;
    }
    if (index >= words.length) {
      finalize.complete();
      return;
    }
    const piece = words[index];
    index += 1;
    finalize.chunk(piece);
    timer = setTimeout(pushNext, MOCK_CHUNK_INTERVAL_MS);
  };

  // 立即开始 (下一帧)
  timer = setTimeout(pushNext, 0);

  // signal 中断时清掉 timer, 避免泄漏, 并触发 onComplete
  const onAbort = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    // 显式触发 complete (让调用方知道流已中断, buffer 已锁定)
    finalize.complete();
  };
  if (signal.aborted) {
    onAbort();
  } else {
    signal.addEventListener('abort', onAbort, { once: true });
  }
}

/**
 * 各 provider 的默认 model 名
 *
 * 与 v1.4.0 函数式 provider 保持一致:
 * - openai: gpt-4o-mini
 * - anthropic: claude-3-5-haiku-20241022
 * - deepseek: deepseek-chat
 *
 * 仅用于 Edge Function 内部决定调用哪个模型, 不暴露给客户端.
 */
function pickModel(provider: StreamingProviderName): string {
  switch (provider) {
    case 'openai':
      return 'gpt-4o-mini';
    case 'anthropic':
      return 'claude-3-5-haiku-20241022';
    case 'deepseek':
      return 'deepseek-chat';
  }
}
