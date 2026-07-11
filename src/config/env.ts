/**
 * 从 Vite 环境变量 (import.meta.env.VITE_*) 读取 LLM 配置
 * 仅作为 fallback, 优先使用 SettingsPanel 中填入的 localStorage 配置
 *
 * 命名约定: VITE_<PROVIDER>_API_KEY / VITE_<PROVIDER>_BASE_URL / VITE_<PROVIDER>_MODEL
 * provider 不区分大小写, 在内部统一转大写
 */
export interface EnvLLMConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export function readEnvLLMConfig(provider: string): EnvLLMConfig | null {
  const tag = provider.toUpperCase();
  const apiKey = import.meta.env[`VITE_${tag}_API_KEY`] as string | undefined;
  const baseUrl = import.meta.env[`VITE_${tag}_BASE_URL`] as string | undefined;
  const model = import.meta.env[`VITE_${tag}_MODEL`] as string | undefined;

  if (!apiKey) return null;

  return {
    apiKey,
    baseUrl: baseUrl || '',
    model: model || '',
  };
}
