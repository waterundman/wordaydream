/**
 * v1.6.4 — 三家 provider 的流式通道单测
 *
 * 背景: edge function 的 stream 分支此前只对 openai 实现, anthropic / deepseek 返回
 * 501, 而设置面板的流式开关不按 provider 门控 —— 用户选这两家并开流式即报错.
 * 本文件既锁住「三家都能出统一 delta 帧」, 也锁住 utils/sse.ts 的帧语义
 * (缓冲切帧 / 非文本事件跳过 / [DONE] 收尾 / 错误帧), 因为客户端 parseSSEStream
 * 只认 `data: {"delta":"..."}` 一种格式.
 *
 * 0 网络: 上游一律用 ReadableStream 造 SSE 字节流.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { openaiStreamProvider } from "./openai.ts";
import { anthropicStreamProvider } from "./anthropic.ts";
import { deepseekStreamProvider } from "./deepseek.ts";

const encoder = new TextEncoder();

/** 用给定片段构造上游 SSE 响应 (每片单独 enqueue, 以便测试跨 read 的半帧拼接). */
function sseResponse(chunks: string[], status = 200): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(stream, { status });
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<string> {
  return await new Response(stream).text();
}

/** 从统一输出流里抽出 delta 文本序列 (忽略 [DONE]). */
function deltas(text: string): string[] {
  return text
    .split("\n\n")
    .map((frame) => frame.replace(/^data: /, "").trim())
    .filter((p) => p.length > 0 && p !== "[DONE]")
    .map((p) => (JSON.parse(p) as { delta?: string }).delta ?? "");
}

const baseArgs = { apiKey: "k", prompt: "hi" };

describe("v1.6.4 流式 provider", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("openai: 跳过 role-only 帧, 增量按序输出并以 [DONE] 收尾", async () => {
    const vi_fn = vi.fn().mockResolvedValue(
      sseResponse([
        'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"Word"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"day"}}]}\n\n',
        "data: [DONE]\n\n",
      ])
    );
    vi.stubGlobal("fetch", vi_fn);

    const out = await drain(await openaiStreamProvider(baseArgs));
    expect(deltas(out)).toEqual(["Word", "day"]);
    expect(out.endsWith("data: [DONE]\n\n")).toBe(true);
    // 请求体必须带 stream: true
    const sent = JSON.parse(
      (vi_fn.mock.calls[0][1] as { body: string }).body
    ) as Record<string, unknown>;
    expect(sent.stream).toBe(true);
  });

  it("anthropic: 只取 content_block_delta 的 delta.text, 忽略 ping 与生命周期事件", async () => {
    const vi_fn = vi.fn().mockResolvedValue(
      sseResponse([
        'event: message_start\ndata: {"type":"message_start","message":{"id":"m1"}}\n\n',
        'event: content_block_start\ndata: {"type":"content_block_start","index":0}\n\n',
        'event: ping\ndata: {"type": "ping"}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"革"}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"命"}}\n\n',
        'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ])
    );
    vi.stubGlobal("fetch", vi_fn);

    const out = await drain(await anthropicStreamProvider(baseArgs));
    expect(deltas(out)).toEqual(["革", "命"]);
    expect(out.endsWith("data: [DONE]\n\n")).toBe(true);
    const headers = (vi_fn.mock.calls[0][1] as { headers: Record<string, string> })
      .headers;
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers["x-api-key"]).toBe("k");
  });

  it("deepseek: OpenAI 兼容增量 + 上游 [DONE] 后不重复发帧", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([
          'data: {"choices":[{"delta":{"role":"assistant","content":""}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"To"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"be"}}]}\n\n',
          "data: [DONE]\n\n",
        ])
      )
    );
    const out = await drain(await deepseekStreamProvider(baseArgs));
    expect(deltas(out)).toEqual(["To", "be"]);
    expect((out.match(/\[DONE\]/g) ?? []).length).toBe(1);
  });

  it("半帧跨 read 到达时仍能拼出完整增量 (buffer 语义)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([
          'data: {"choices":[{"delta":{"con',
          'tent":"split"}}]}\n\ndata: [DONE]\n\n',
        ])
      )
    );
    const out = await drain(await openaiStreamProvider(baseArgs));
    expect(deltas(out)).toEqual(["split"]);
  });

  it("上游非 2xx 抛出带 provider code 与 status 的错误", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response('{"type":"error"}', { status: 429 }))
    );
    await expect(anthropicStreamProvider(baseArgs)).rejects.toMatchObject({
      status: 429,
      code: "ANTHROPIC_ERROR",
    });
  });
});
