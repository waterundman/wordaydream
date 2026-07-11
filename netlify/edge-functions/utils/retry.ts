/**
 * Retry + timeout wrapper for provider calls.
 *
 * - retries: number of additional attempts (0 = no retry)
 * - timeoutMs: per-attempt timeout via AbortController
 * - 4xx errors are NOT retried (caller fault); 5xx + network errors are.
 *
 * v1.5.2 fix: signal is now passed to fn() so fetch can be truly aborted.
 */
export async function withRetry<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  retries: number,
  timeoutMs: number
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const result = await fn(controller.signal);
      clearTimeout(timeoutId);
      return result;
    } catch (e: unknown) {
      clearTimeout(timeoutId);
      lastError = e;
      if (attempt === retries) break;
      const status = (e as { status?: number })?.status;
      if (typeof status === "number" && status >= 400 && status < 500) break;
      // exponential backoff: 1s, 2s, 3s ...
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw lastError;
}
