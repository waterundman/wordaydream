/**
 * 上游 SSE → 客户端统一 delta 帧的共用转换器 (v1.6.4)
 *
 * 三家 provider 的流式差异只在「从一条 `data:` 载荷里取出增量文本」这一件事上;
 * 缓冲切帧、`[DONE]` 哨兵、错误帧的语义必须逐字一致, 否则客户端 parseSSEStream
 * 要按 provider 分支, 而它只认 `data: {"delta":"..."}` 这一种格式.
 *
 * 客户端约定 (src/features/llm/services/streamingProvider.ts):
 * - 增量帧: `data: {"delta":"文本"}\n\n`
 * - 结束哨兵: `data: [DONE]\n\n` 后紧跟 close (v1.5.2 fix M6: 不 close 会让客户端读悬挂)
 * - 错误帧: `data: {"error":"..."}\n\n` + 哨兵 + close
 */

/**
 * 从一条 `data:` 载荷取增量文本.
 * 返回 null 表示该帧没有可展示的增量 (ping / 只有 role 的 delta / 非文本块), 调用方跳过.
 * 抛错同样按「跳过该帧」处理, 用于容忍上游偶发非 JSON 心跳包.
 */
export type DeltaExtractor = (payload: string) => string | null;

const encoder = new TextEncoder();

export function createUnifiedSSEStream(
  upstream: ReadableStream<Uint8Array>,
  extract: DeltaExtractor
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder("utf-8");

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.getReader();
      let buffer = "";
      const finish = (): void => {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      };

      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) {
            finish();
            return;
          }
          buffer += decoder.decode(value, { stream: true });
          // SSE 事件以空行分隔; 末段可能是半截帧, 留在 buffer 里等下一次 read
          const events = buffer.split(/\n\n/);
          buffer = events.pop() ?? "";
          for (const eventBlock of events) {
            for (const line of eventBlock.split(/\n/)) {
              // 跳过 `event:` / `id:` / 注释行, 只取 data 载荷
              if (!line.startsWith("data: ")) continue;
              const payload = line.slice(6);
              if (payload === "[DONE]") {
                finish();
                return;
              }
              let delta: string | null = null;
              try {
                delta = extract(payload);
              } catch {
                continue;
              }
              if (delta) {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`)
                );
              }
            }
          }
        }
      } catch (e: unknown) {
        const err = e as { message?: string };
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ error: err.message ?? "stream error" })}\n\n`
          )
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } finally {
        reader.releaseLock();
      }
    },
  });
}

/** 把 ReadableStream 读成文本 (测试与断言用). */
export async function readStreamToString(
  stream: ReadableStream<Uint8Array>
): Promise<string> {
  return await new Response(stream).text();
}
