import type { LLMResponse, LLMProvider, Language } from '../../../types';

export interface GenerateOptions {
  system?: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  expectJson?: boolean;
  signal?: AbortSignal;
  timeout?: number;
  maxRetries?: number;
  /**
   * v1.2.0 hotfix-3 (Stage 4 P1 最后加固): 期望 LLM 输出的目标语言.
   * 仅在 expectJson=true 路径下生效, parseLLMResponse 会校验 parsed.data.language
   * 是否等于 expectedLanguage, 不一致视为 parse failure, 走 retry → mock fallback.
   *
   * 缺省: undefined (向后兼容, 不做语言校验).
   */
  expectedLanguage?: Language;
}

export interface LLMProviderClient {
  readonly id: LLMProvider;
  generate(options: GenerateOptions): Promise<LLMResponse>;
  testConnection(): Promise<{ ok: boolean; error?: string }>;
}
