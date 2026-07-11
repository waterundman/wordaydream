/**
 * CORS preflight + header utilities for llm-proxy edge function.
 *
 * Returns a 204 Response for OPTIONS preflight requests, or null when
 * the request is not a preflight (so the caller can continue).
 */
export function handleCors(request: Request): Response | null {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
      },
    });
  }
  return null;
}

/**
 * Standard JSON response headers used by the proxy.
 */
export const JSON_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};
