/**
 * v1.3.0 Stage 1 — llm-proxy edge function tests (T01-T06)
 *
 * Edge Function runs on Deno runtime; vitest runs on Node. We mock
 * `Deno.env.get` and `globalThis.fetch` so the handler can be imported
 * and exercised in the Node test environment.
 *
 * Cases:
 *   T01: CORS preflight (OPTIONS) returns 204 + headers
 *   T02: GET method returns 405
 *   T03: Invalid JSON body returns 400
 *   T04: Missing provider returns 400
 *   T05: Missing API key returns 500 + MISSING_API_KEY
 *   T06: OpenAI success returns 200 + parsed text/model
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type DenoShape = { env: { get: (k: string) => string | undefined } };

const setEnv = (kv: Record<string, string | undefined>) => {
  (globalThis as unknown as { Deno: DenoShape }).Deno = {
    env: { get: (k: string) => kv[k] },
  };
};

const importHandler = async () => {
  // Re-import the module each test so config.path is read fresh
  // and module-level state (if any) is recreated.
  const mod = await import("./llm-proxy.ts");
  return mod.default;
};

describe("llm-proxy edge function", () => {
  const originalFetch = globalThis.fetch;
  const originalDeno = (globalThis as unknown as { Deno?: DenoShape }).Deno;

  beforeEach(() => {
    setEnv({ OPENAI_API_KEY: "test-key" });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    (globalThis as unknown as { Deno?: DenoShape }).Deno = originalDeno;
    vi.restoreAllMocks();
  });

  it("T01: CORS preflight returns 204 with headers", async () => {
    const handler = await importHandler();
    const req = new Request("http://localhost/.netlify/edge-functions/llm-proxy", {
      method: "OPTIONS",
    });
    const ctx = { ip: "127.0.0.1" } as unknown as Parameters<typeof handler>[1];
    const res = await handler(req, ctx);
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("T02: GET method returns 405", async () => {
    const handler = await importHandler();
    const req = new Request("http://localhost/.netlify/edge-functions/llm-proxy", {
      method: "GET",
    });
    const ctx = { ip: "127.0.0.1" } as unknown as Parameters<typeof handler>[1];
    const res = await handler(req, ctx);
    expect(res.status).toBe(405);
  });

  it("T03: Invalid JSON body returns 400", async () => {
    const handler = await importHandler();
    const req = new Request("http://localhost/.netlify/edge-functions/llm-proxy", {
      method: "POST",
      body: "invalid",
    });
    const ctx = { ip: "127.0.0.1" } as unknown as Parameters<typeof handler>[1];
    const res = await handler(req, ctx);
    expect(res.status).toBe(400);
  });

  it("T04: Missing provider returns 400", async () => {
    const handler = await importHandler();
    const req = new Request("http://localhost/.netlify/edge-functions/llm-proxy", {
      method: "POST",
      body: JSON.stringify({ prompt: "test" }),
    });
    const ctx = { ip: "127.0.0.1" } as unknown as Parameters<typeof handler>[1];
    const res = await handler(req, ctx);
    expect(res.status).toBe(400);
  });

  it("T05: Missing API key returns 500 with MISSING_API_KEY", async () => {
    setEnv({}); // no OPENAI_API_KEY
    const handler = await importHandler();
    const req = new Request("http://localhost/.netlify/edge-functions/llm-proxy", {
      method: "POST",
      body: JSON.stringify({ provider: "openai", prompt: "test" }),
    });
    const ctx = { ip: "127.0.0.1" } as unknown as Parameters<typeof handler>[1];
    const res = await handler(req, ctx);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("MISSING_API_KEY");
  });

  it("T06: OpenAI success returns 200 with text and model", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "Hello world" } }],
        model: "gpt-4o-mini",
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const handler = await importHandler();
    const req = new Request("http://localhost/.netlify/edge-functions/llm-proxy", {
      method: "POST",
      body: JSON.stringify({ provider: "openai", prompt: "test" }),
    });
    const ctx = { ip: "127.0.0.1" } as unknown as Parameters<typeof handler>[1];
    const res = await handler(req, ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      text: string;
      model: string;
      language: string;
    };
    expect(body.text).toBe("Hello world");
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.language).toBe("en");
  });
});
