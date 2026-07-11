/**
 * Minimal Netlify Edge Function context type stub.
 *
 * Replaces `import type { Context } from "https://edge.netlify.com"`
 * so this code can be type-checked in the standard Node/TypeScript
 * toolchain (vite, tsc) without pulling in Deno's URL-based resolver.
 *
 * Only the fields we actually use are declared.
 */
export interface Context {
  /** Request IP address, as resolved by Netlify edge. */
  ip?: string;
  /** Geo information (we do not use this, but keep the field for compatibility). */
  geo?: unknown;
  /** Account / site metadata. */
  account?: unknown;
  /** Site metadata. */
  site?: unknown;
}
