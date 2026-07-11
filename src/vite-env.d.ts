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
