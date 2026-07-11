/**
 * In-memory rate limiter for llm-proxy edge function.
 *
 * NOTE: Edge runtime has ephemeral memory, so this is best-effort.
 * For production, swap to a Deno KV / Netlify Blobs backed counter.
 *
 * Returns a 429 Response when the IP exceeded its quota, or null when allowed.
 */
const requestCounts = new Map<string, { count: number; resetTime: number }>();

export function checkRateLimit(ip: string, limit: number): Response | null {
  const now = Date.now();
  const record = requestCounts.get(ip);

  if (!record || record.resetTime < now) {
    requestCounts.set(ip, { count: 1, resetTime: now + 60000 });
    return null;
  }

  if (record.count >= limit) {
    return new Response(
      JSON.stringify({ error: "Rate limit exceeded", code: "RATE_LIMIT" }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Retry-After": "60",
        },
      }
    );
  }

  record.count += 1;
  return null;
}

/** Test-only reset hook. */
export function _resetRateLimit(): void {
  requestCounts.clear();
}
