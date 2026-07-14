import type { LLMResponse, LLMProvider, Language } from '../../../types';

/**
 * v2.1.1 Stage 2 (D1): expectJson 类型化.
 *
 * 取值:
 * - 'passage': 使用 PassagePayloadSchema 校验 (text/tokens/grammarPoints/language)
 * - 'evaluation': 使用 EvaluationPayloadSchema 校验 (grade/feedback/hint)
 * - 'difficulty': 使用 DifficultyPayloadSchema 校验 (morphological/abstractness/frequencyPercentile)
 * - 'gloss': 使用 GlossPayloadSchema 校验 (definitions/explanation)
 * - 'generic': 使用宽松校验 (任意 JSON object, 不做 schema 严格校验)
 * - false: 不走 JSON 解析路径 (走 retryWithBackoff 网络重试)
 * - true: 向后兼容别名, 等价于 'passage' (router 内部映射)
 *
 * 旧代码 (router.test.ts / prompts.ts / passageGenerator.ts) 仍可传 true / false,
 * router.getSchemaForExpectJson 把 true 映射为 'passage'.
 */
export type ExpectJson =
  | 'passage'
  | 'evaluation'
  | 'difficulty'
  | 'gloss'
  | 'generic'
  | false
  | true;

export interface GenerateOptions {
  system?: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  /**
   * v2.1.1 Stage 2: expectJson 类型化为 ExpectJson.
   * 旧代码传 true/false 仍兼容 (true 等价 'passage', false 等价不走 JSON 路径).
   */
  expectJson?: ExpectJson;
  signal?: AbortSignal;
  timeout?: number;
  maxRetries?: number;
  /**
   * v1.2.0 hotfix-3 (Stage 4 P1 最后加固): 期望 LLM 输出的目标语言.
   * 仅在 expectJson=true 路径下生效, parseLLMResponse 会校验 parsed.data.language
   * 是否等于 expectedLanguage, 不一致视为 parse failure, 走 retry → mock fallback.
   *
   * v2.1.1 Stage 2: language check 仅在 PassagePayloadSchema 时执行,
   * evaluation/difficulty/gloss 响应没有 language 字段, 即使传了 expectedLanguage 也不触发.
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
