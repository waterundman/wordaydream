/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_OPENAI_API_KEY?: string;
  readonly VITE_OPENAI_BASE_URL?: string;
  readonly VITE_OPENAI_MODEL?: string;
  readonly VITE_ANTHROPIC_API_KEY?: string;
  readonly VITE_ANTHROPIC_BASE_URL?: string;
  readonly VITE_ANTHROPIC_MODEL?: string;
  readonly VITE_DEEPSEEK_API_KEY?: string;
  readonly VITE_DEEPSEEK_BASE_URL?: string;
  readonly VITE_DEEPSEEK_MODEL?: string;
  readonly VITE_KIMI_API_KEY?: string;
  readonly VITE_KIMI_BASE_URL?: string;
  readonly VITE_KIMI_MODEL?: string;
  readonly VITE_QWEN_API_KEY?: string;
  readonly VITE_QWEN_BASE_URL?: string;
  readonly VITE_QWEN_MODEL?: string;
  readonly VITE_MINIMAX_API_KEY?: string;
  readonly VITE_MINIMAX_BASE_URL?: string;
  readonly VITE_MINIMAX_MODEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// v2.2.4 Stage 1 (D1-4): Window 全局类型声明, 替代 useToastStore /
// useReadingSessionStore 中 as unknown as 断言访问.
interface Window {
  __TOAST_STORE__?: typeof import('./store/useToastStore').useToastStore;
  __READING_STORE__?: typeof import('./features/reading/store/useReadingSessionStore').useReadingSessionStore;
}
