import type { LLMProvider } from '../../../types';

// v2.1.1 Stage 3 (D3): 收窄为 4 个有实现的 provider, 移除 kimi/qwen/minimax.
// 从 SettingsPanel.tsx 迁出 (v1.1.0 Stage 3): 非组件导出会触发
// react-refresh/only-export-components, 纯数据预设归属配置层 lib.
// 导出供测试 (T18/T19) 验证 keys 集合.
export const PROVIDER_PRESETS: Record<LLMProvider, { defaultBaseUrl: string; defaultModel: string; placeholder: string; label: string }> = {
  mock: { defaultBaseUrl: '', defaultModel: '', placeholder: '模拟模式不需要 API Key', label: '模拟' },
  openai: {
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    placeholder: 'sk-...',
    label: 'OpenAI',
  },
  anthropic: {
    defaultBaseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-3-5-sonnet-20241022',
    placeholder: 'sk-ant-...',
    label: 'Anthropic',
  },
  deepseek: {
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    placeholder: 'sk-...',
    label: 'DeepSeek',
  },
};

// v2.1.1 Stage 3 (D3): 移除所有 kimi/qwen/minimax 条目, 仅保留 7 个有实现的 preset.
// 导出供测试 (T19) 验证不含已废弃 provider.
//
// v1.6.4 Stage 1 (P3 修复): 每条 preset 的 config **不再含 `enabled`** ——
// 预设的语义是 provider / model / temperature 组合, 不是总开关; 应用预设静默改写
// `llm.enabled` 会让「LLM 路由开关」出现第二个写入点. 总开关的唯一交互写入点是
// 常显层「语言模型」区块内的 switch (SettingsPanel.tsx).
export const SETTINGS_PRESETS = [
  {
    id: 'demo',
    name: '演示模式',
    description: '模拟数据，无需 API Key',
    config: { provider: 'mock' as LLMProvider, model: '', temperature: 0.5 },
  },
  {
    id: 'openai-fast',
    name: 'OpenAI 快速',
    description: 'GPT-4o-mini，响应迅速',
    config: { provider: 'openai' as LLMProvider, model: 'gpt-4o-mini', temperature: 0.3 },
  },
  {
    id: 'openai-quality',
    name: 'OpenAI 高质量',
    description: 'GPT-4o，最佳质量',
    config: { provider: 'openai' as LLMProvider, model: 'gpt-4o', temperature: 0.5 },
  },
  {
    id: 'anthropic-fast',
    name: 'Anthropic 快速',
    description: 'Claude 3 Haiku，响应迅速',
    config: { provider: 'anthropic' as LLMProvider, model: 'claude-3-haiku-20240307', temperature: 0.3 },
  },
  {
    id: 'anthropic-quality',
    name: 'Anthropic 高质量',
    description: 'Claude 3.5 Sonnet，最佳平衡',
    config: { provider: 'anthropic' as LLMProvider, model: 'claude-3-5-sonnet-20241022', temperature: 0.5 },
  },
  {
    id: 'deepseek-fast',
    name: 'DeepSeek 快速',
    description: 'deepseek-chat (V3)，响应迅速',
    config: { provider: 'deepseek' as LLMProvider, model: 'deepseek-chat', temperature: 0.3 },
  },
  {
    id: 'deepseek-reasoner',
    name: 'DeepSeek 推理',
    description: 'deepseek-reasoner (R1)，深度思考',
    config: { provider: 'deepseek' as LLMProvider, model: 'deepseek-reasoner', temperature: 0.5 },
  },
];
