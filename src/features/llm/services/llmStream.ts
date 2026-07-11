/**
 * Wordaydream v1.4.1 Stage 1 — LLM SSE Stream Parser
 *
 * 职责:
 * - 解析 OpenAI / Anthropic / DeepSeek 通用 SSE (text/event-stream) 响应
 * - 输出 { delta, done, error? } 增量块给 onChunk 回调
 * - 支持 AbortSignal 中断, reader.cancel() 释放底层 ReadableStream
 *
 * SSE 协议约定 (与 OpenAI / DeepSeek / Anthropic 兼容):
 * - 事件用 `\n\n` 分隔 (一个空行结束当前事件)
 * - 每行格式: `field: value` (e.g. `data: {"delta":"Hello"}`)
 * - 流结束标识: `data: [DONE]` (OpenAI / DeepSeek 用法)
 * - 多行 data 字段会用 `\n` 拼接 (本实现只关心 data 字段, 其它字段忽略)
 *
 * 沙箱 100% 可执行:
 * - 不依赖 Deno / Netlify Edge, 纯浏览器 ReadableStream
 * - vitest 用 `new Response(sse, { headers })` 构造 mock SSE
 * - jsdom 提供 Response / ReadableStream 实现 (node 18+ 自带 web streams)
 *
 * 与 v1.4.0 关系:
 * - v1.4.0 函数式 provider (openaiGenerate / anthropicGenerate / deepseekGenerate) 走
 *   `await response.json()` 一次拿完整响应 (Edge Function 转 JSON 包装)
 * - v1.4.1 Stage 1: streamingGenerate 调用 Edge Function 拿到 text/event-stream,
 *   本模块负责逐 chunk 解析, 维持 provider 函数式 (与 v1.4.0 同构)
 *
 * 不修改 GenerateOptions 签名 (v1.4.0 13 合同保持):
 * - options.signal 仍由调用方传入, 联动 AbortController
 * - 返回 LLMStreamChunk 给 onChunk 回调, 不污染 LLMResponse
 */

/**
 * 单个 SSE 事件解析后的增量块
 *
 * - delta: 本次增量文本 (空字符串代表纯元数据, 调用方应忽略)
 * - done:  流是否结束 (收到 `data: [DONE]` 后为 true, 调用方应停止累积)
 * - error: 解析 / 网络错误信息 (done=true 时附带, 调用方应 fallback)
 */
export interface LLMStreamChunk {
  /** 增量文本 (空字符串代表无 delta, 仅元数据) */
  delta: string;
  /** 流是否结束 */
  done: boolean;
  /** 错误信息 (done=true 时附带, 触发调用方 fallback) */
  error?: string;
}

/**
 * onChunk 回调签名
 *
 * 调用方 (streamingProvider) 在每个 SSE 事件解析后调用,
 * 不返回 Promise (同步处理, 累积 buffer / 触发 UI 渲染).
 */
export type LLMStreamHandler = (chunk: LLMStreamChunk) => void;

/**
 * SSE 流结束哨兵 (OpenAI / DeepSeek 约定)
 *
 * Anthropic 不发 `[DONE]`, 改用 `event: message_stop`. 本实现统一按
 * `data: [DONE]` 处理 (Anthropic Edge Function 适配层会把 message_stop
 * 翻译为 `data: [DONE]`, 保持客户端协议一致).
 */
const SSE_DONE_MARKER = '[DONE]';

/**
 * 解析 Response body 为 SSE 增量块
 *
 * 协议约定:
 * - Response Content-Type 必须是 text/event-stream
 * - 流结束: `data: [DONE]` 或 reader.done (网络中断)
 * - 错误: JSON.parse 失败 / reader.read 抛错
 *
 * @param response  Edge Function 返回的 Response (body 必须是 ReadableStream)
 * @param onChunk   每解析一个事件调用一次, 同步回调
 * @param signal    AbortSignal (可选), 触发后调用 reader.cancel() 释放底层流
 *
 * @example
 * ```ts
 * const response = await fetch(proxyUrl, { ... });
 * await parseSSEStream(response, (chunk) => {
 *   if (chunk.error) console.error(chunk.error);
 *   else if (chunk.done) console.log('stream done');
 *   else buffer += chunk.delta;
 * });
 * ```
 */
export async function parseSSEStream(
  response: Response,
  onChunk: LLMStreamHandler,
  signal?: AbortSignal
): Promise<void> {
  // 防御: body 不存在 (e.g. HEAD 请求) — 直接抛错
  if (!response.body) {
    onChunk({ delta: '', done: true, error: 'Response body is null' });
    return;
  }

  const reader = response.body.getReader();
  // TextDecoder 'stream' option is part of Node's WebStreams / Encoding Standard
  // but not in lib.dom.d.ts TextDecoderOptions — cast through unknown.
  const decoder = new TextDecoder('utf-8', { stream: true } as TextDecoderOptions);
  // buffer 累积跨 chunk 的不完整行 (SSE 行尾是 \n, 事件间用 \n\n 隔开)
  let buffer = '';
  // signal 已被触发, 不再处理后续 chunk
  let aborted = false;

  // signal 联动: 中断时取消 reader
  const onAbort = () => {
    aborted = true;
    reader.cancel().catch(() => {
      // cancel 失败不应抛出 (reader 已 closed)
    });
  };
  if (signal) {
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  }

  try {
    while (true) {
      // 已被 signal 取消, 跳出循环
      if (aborted) {
        onChunk({ delta: '', done: true, error: 'aborted' });
        return;
      }

      const { value, done } = await reader.read();
      if (done) {
        // 流自然结束 (网络 EOF), 解析 buffer 中残余数据
        if (buffer.trim().length > 0) {
          const tailResult = processEventBlock(buffer, onChunk);
          // v1.5.3 fix V4-P2-004: error 时 processEventBlock 已调 onChunk, 不再二次调用.
          if (tailResult === 'error') return;
        }
        onChunk({ delta: '', done: true });
        return;
      }

      buffer += decoder.decode(value, { stream: true });

      // 按 \n\n 切分完整事件, 剩余部分保留在 buffer
      const events = buffer.split(/\n\n/);
      // 最后一段可能是不完整事件, 留到下一轮
      buffer = events.pop() ?? '';

      for (const eventBlock of events) {
        if (eventBlock.trim().length === 0) continue;
        const result = processEventBlock(eventBlock, onChunk);
        if (result === 'done') {
          // 收到 [DONE], 显式结束 (不读后续 chunk)
          onChunk({ delta: '', done: true });
          return;
        }
        // v1.5.3 fix V4-P2-004: error 时 processEventBlock 已调 onChunk({ done, error }), 直接返回.
        if (result === 'error') return;
      }
    }
  } catch (error) {
    // 网络中断 / reader 抛错
    const msg = error instanceof Error ? error.message : 'Stream read error';
    onChunk({ delta: '', done: true, error: msg });
  } finally {
    if (signal) {
      signal.removeEventListener('abort', onAbort);
    }
    // 释放 reader (jsdom 中 reader.releaseLock 存在, 浏览器也支持)
    try {
      reader.releaseLock();
    } catch {
      // 释放失败不应抛错 (reader 已 closed)
    }
  }
}

/**
 * v1.5.3 fix V4-P2-004: processEventBlock 返回值改为三态枚举.
 *
 * 之前返回 boolean (true = 停止), 但错误路径和 [DONE] 路径都返回 true,
 * 导致 parseSSEStream 主循环在 error 后会再次调用 onChunk({ done: true }),
 * 触发 streamingProvider 的 finalize.complete() 杀死 mock fallback.
 *
 * - 'continue': 正常处理, 继续读取
 * - 'done': 收到 [DONE] 哨兵, 调用方应调 onChunk({ done: true }) 后停止
 * - 'error': 解析错误, 已调 onChunk({ done: true, error }), 调用方应直接停止 (不再调 onChunk)
 */
type ProcessResult = 'continue' | 'done' | 'error';

/**
 * 解析单个 SSE 事件块 (一或多个 `field: value` 行)
 *
 * 约定:
 * - 关心 data 字段, 其它字段 (event / id / retry) 忽略
 * - data: [DONE] → 返回 'done' (调用方停止)
 * - data: <json> → JSON.parse, 提取 delta 字段
 * - JSON.parse 失败 → onChunk({ done: true, error: '...' }), 返回 'error'
 */
function processEventBlock(eventBlock: string, onChunk: LLMStreamHandler): ProcessResult {
  const lines = eventBlock.split(/\n/);
  const dataLines: string[] = [];

  for (const line of lines) {
    // SSE 注释行 (以 : 开头) 直接跳过
    if (line.startsWith(':')) continue;
    if (line.startsWith('data:')) {
      // 去掉 "data:" 前缀 + 紧跟的单个空格 (SSE 规范)
      const data = line.startsWith('data: ') ? line.slice(6) : line.slice(5);
      dataLines.push(data);
    }
    // 其它字段 (event: / id: / retry:) 忽略
  }

  if (dataLines.length === 0) return 'continue';

  const payload = dataLines.join('\n');
  if (payload === SSE_DONE_MARKER) {
    return 'done';
  }

  try {
    const parsed = JSON.parse(payload) as { delta?: unknown; text?: unknown };
    // OpenAI / DeepSeek: { choices: [{ delta: { content: "..." } }] }
    // Anthropic: { delta: { text: "..." } } 或 { type: "content_block_delta", delta: { text: "..." } }
    // 通用约定: { delta: "..." } (本 Edge Function 适配层用此格式)
    let delta = '';
    if (typeof parsed.delta === 'string') {
      delta = parsed.delta;
    } else if (typeof parsed.text === 'string') {
      delta = parsed.text;
    } else if (parsed.delta && typeof parsed.delta === 'object') {
      // 嵌套 delta 对象 (Anthropic 风格)
      const nested = parsed.delta as { text?: unknown };
      if (typeof nested.text === 'string') {
        delta = nested.text;
      }
    }
    if (delta.length > 0) {
      onChunk({ delta, done: false });
    }
  } catch (error) {
    // JSON 解析失败: 视为 fatal, 触发 fallback.
    // v1.5.3 fix V4-P2-004: 返回 'error' 而非 true, 避免主循环二次调用 onChunk({ done: true }).
    const msg = error instanceof Error ? error.message : 'JSON parse error';
    onChunk({ delta: '', done: true, error: `SSE parse error: ${msg}` });
    return 'error';
  }
  return 'continue';
}
