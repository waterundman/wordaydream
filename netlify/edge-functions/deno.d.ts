/**
 * Minimal Deno global type stub.
 *
 * Edge Functions run on Deno, where `Deno.env.get` is a global. When this
 * code is type-checked with a non-Deno toolchain (vite / tsc), the Deno
 * global is not declared, so we declare only what we need.
 */
declare global {
  // deno-lint-ignore no-namespace
  const Deno: {
    env: {
      get(key: string): string | undefined;
    };
  };
}

export {};
