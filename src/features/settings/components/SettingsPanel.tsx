import { useState, useEffect, useRef } from 'react';
import { useSettingsStore } from '../store/useSettingsStore';
import { InstallPromptButton } from '../../../components/InstallPromptButton';
import { ThemeSwitcher } from '../../../components/ThemeSwitcher';
import styles from './SettingsPanel.module.css';
import type { LLMProvider } from '../../../types';

const PROVIDER_PRESETS: Record<LLMProvider, { defaultBaseUrl: string; defaultModel: string; placeholder: string; label: string }> = {
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
  kimi: {
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
    placeholder: 'sk-...',
    label: 'Kimi (月之暗面)',
  },
  qwen: {
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-turbo',
    placeholder: 'sk-...',
    label: 'Qwen (通义千问)',
  },
  minimax: {
    defaultBaseUrl: 'https://api.minimaxi.com/v1',
    defaultModel: 'MiniMax-Text-01',
    placeholder: 'sk-...',
    label: 'MiniMax',
  },
};

const SETTINGS_PRESETS = [
  {
    id: 'demo',
    name: '演示模式',
    description: '模拟数据，无需 API Key',
    config: { provider: 'mock' as LLMProvider, model: '', temperature: 0.5, enabled: false },
  },
  {
    id: 'openai-fast',
    name: 'OpenAI 快速',
    description: 'GPT-4o-mini，响应迅速',
    config: { provider: 'openai' as LLMProvider, model: 'gpt-4o-mini', temperature: 0.3, enabled: true },
  },
  {
    id: 'openai-quality',
    name: 'OpenAI 高质量',
    description: 'GPT-4o，最佳质量',
    config: { provider: 'openai' as LLMProvider, model: 'gpt-4o', temperature: 0.5, enabled: true },
  },
  {
    id: 'anthropic-fast',
    name: 'Anthropic 快速',
    description: 'Claude 3 Haiku，响应迅速',
    config: { provider: 'anthropic' as LLMProvider, model: 'claude-3-haiku-20240307', temperature: 0.3, enabled: true },
  },
  {
    id: 'anthropic-quality',
    name: 'Anthropic 高质量',
    description: 'Claude 3.5 Sonnet，最佳平衡',
    config: { provider: 'anthropic' as LLMProvider, model: 'claude-3-5-sonnet-20241022', temperature: 0.5, enabled: true },
  },
  {
    id: 'deepseek-fast',
    name: 'DeepSeek 快速',
    description: 'deepseek-chat (V3)，响应迅速',
    config: { provider: 'deepseek' as LLMProvider, model: 'deepseek-chat', temperature: 0.3, enabled: true },
  },
  {
    id: 'deepseek-reasoner',
    name: 'DeepSeek 推理',
    description: 'deepseek-reasoner (R1)，深度思考',
    config: { provider: 'deepseek' as LLMProvider, model: 'deepseek-reasoner', temperature: 0.5, enabled: true },
  },
  {
    id: 'kimi-fast',
    name: 'Kimi 快速',
    description: 'moonshot-v1-8k，短文快速',
    config: { provider: 'kimi' as LLMProvider, model: 'moonshot-v1-8k', temperature: 0.3, enabled: true },
  },
  {
    id: 'kimi-long',
    name: 'Kimi 长文',
    description: 'moonshot-v1-128k，长文阅读',
    config: { provider: 'kimi' as LLMProvider, model: 'moonshot-v1-128k', temperature: 0.5, enabled: true },
  },
  {
    id: 'qwen-fast',
    name: 'Qwen 快速',
    description: 'qwen-turbo，性价比高',
    config: { provider: 'qwen' as LLMProvider, model: 'qwen-turbo', temperature: 0.3, enabled: true },
  },
  {
    id: 'qwen-quality',
    name: 'Qwen 高质量',
    description: 'qwen-max，最佳质量',
    config: { provider: 'qwen' as LLMProvider, model: 'qwen-max', temperature: 0.5, enabled: true },
  },
  {
    id: 'minimax-text',
    name: 'MiniMax 文本',
    description: 'MiniMax-Text-01，旗舰模型',
    config: { provider: 'minimax' as LLMProvider, model: 'MiniMax-Text-01', temperature: 0.5, enabled: true },
  },
  {
    id: 'minimax-vl',
    name: 'MiniMax 多模态',
    description: 'MiniMax-VL-01，支持图像',
    config: { provider: 'minimax' as LLMProvider, model: 'MiniMax-VL-01', temperature: 0.5, enabled: true },
  },
];

export function SettingsPanel() {
  const {
    llm,
    isTesting,
    testResult,
    setProvider,
    setApiKey,
    setBaseUrl,
    setModel,
    setTemperature,
    setEnabled,
    setTimeoutValue,
    setMaxRetries,
    setStreaming,
    testConnection,
    resetAll,
    exportSettings,
    importSettings,
  } = useSettingsStore();

  const [apiKeyDraft, setApiKeyDraft] = useState(llm.apiKey);
  const [importResult, setImportResult] = useState<{ success: boolean; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setApiKeyDraft(llm.apiKey);
  }, [llm.apiKey]);

  const handleProviderChange = (provider: LLMProvider) => {
    setProvider(provider);
    const preset = PROVIDER_PRESETS[provider];
    if (preset.defaultBaseUrl) setBaseUrl(preset.defaultBaseUrl);
    if (preset.defaultModel) setModel(preset.defaultModel);
  };

  const handleSave = () => {
    setApiKey(apiKeyDraft);
  };

  const handleApplyPreset = (preset: typeof SETTINGS_PRESETS[0]) => {
    setProvider(preset.config.provider);
    setModel(preset.config.model);
    setTemperature(preset.config.temperature);
    setEnabled(preset.config.enabled);
    const providerPreset = PROVIDER_PRESETS[preset.config.provider];
    if (providerPreset.defaultBaseUrl) {
      setBaseUrl(providerPreset.defaultBaseUrl);
    }
  };

  const handleExport = () => {
    const json = exportSettings();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wordaydream-settings-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      const result = importSettings(content);
      if (result) {
        setImportResult({ success: true, message: '设置导入成功' });
      } else {
        setImportResult({ success: false, message: '设置导入失败，请检查文件格式' });
      }
      setTimeout(() => setImportResult(null), 3000);
    };
    reader.readAsText(file);
  };

  const preset = PROVIDER_PRESETS[llm.provider];
  const isMock = llm.provider === 'mock';
  const currentBaseUrl = llm.baseUrl || preset.defaultBaseUrl;
  const currentModel = llm.model || preset.defaultModel;

  return (
    <div className={styles.backdrop} onClick={(e) => e.target === e.currentTarget && useSettingsStore.getState().closeSettings()}>
      <div className={styles.panel} role="dialog" aria-label="设置">
        <div className={styles.header}>
          <div>
            <h2 className={styles.title}>设置</h2>
            <p className={styles.subtitle}>配置 LLM 以启用真实的语境化学习</p>
          </div>
          <button
            className={styles.closeBtn}
            onClick={() => useSettingsStore.getState().closeSettings()}
            aria-label="关闭"
          >
            ×
          </button>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionTitle}>语言模型提供商</div>
          <div className={styles.providerGroupLabel}>海外 / 国际</div>
          <div className={styles.providerGroup}>
            {(['mock', 'openai', 'anthropic'] as LLMProvider[]).map((p) => (
              <button
                key={p}
                className={`${styles.providerBtn} ${llm.provider === p ? styles.active : ''}`}
                onClick={() => handleProviderChange(p)}
              >
                {PROVIDER_PRESETS[p].label}
              </button>
            ))}
          </div>
          <div className={styles.providerGroupLabel}>国内 / 中文</div>
          <div className={`${styles.providerGroup} ${styles.four}`}>
            {(['deepseek', 'kimi', 'qwen', 'minimax'] as LLMProvider[]).map((p) => (
              <button
                key={p}
                className={`${styles.providerBtn} ${llm.provider === p ? styles.active : ''}`}
                onClick={() => handleProviderChange(p)}
              >
                {PROVIDER_PRESETS[p].label}
              </button>
            ))}
          </div>
          <p className={styles.hint} style={{ marginTop: 'var(--space-2)' }}>
            {isMock
              ? '模拟模式：内置示例数据，无需 API Key，适合演示和调试。'
              : '真实模式：填入你的 API Key 后，文本生成、判题和补救将调用真实 LLM。国内 provider 走 OpenAI 兼容协议。'}
          </p>
        </div>

        {!isMock && (
          <>
            <div className={styles.section}>
              <div className={styles.sectionTitle}>连接配置</div>

              <div className={styles.field} style={{ marginBottom: 'var(--space-3)' }}>
                <label className={styles.label}>API 密钥</label>
                <input
                  className={styles.input}
                  type="password"
                  value={apiKeyDraft}
                  onChange={(e) => setApiKeyDraft(e.target.value)}
                  onBlur={handleSave}
                  placeholder={preset.placeholder}
                  autoComplete="off"
                />
                <p className={styles.hint}>保存在浏览器 localStorage，不会上传到任何服务器。</p>
              </div>

              <div className={styles.row}>
                <div className={styles.field}>
                  <label className={styles.label}>基础 URL</label>
                  <input
                    className={styles.input}
                    type="text"
                    value={currentBaseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder={preset.defaultBaseUrl}
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>模型</label>
                  <input
                    className={styles.input}
                    type="text"
                    value={currentModel}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder={preset.defaultModel}
                  />
                </div>
              </div>

              <div className={styles.field}>
                <label className={styles.label}>随机性 ({llm.temperature.toFixed(2)})</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={llm.temperature}
                  onChange={(e) => setTemperature(Number(e.target.value))}
                />
              </div>

              <div className={styles.row}>
                <div className={styles.field}>
                  <label className={styles.label}>超时时间 ({llm.timeout} 秒)</label>
                  <input
                    type="range"
                    min="10"
                    max="120"
                    step="5"
                    value={llm.timeout}
                    onChange={(e) => setTimeoutValue(Number(e.target.value))}
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>最大重试次数 ({llm.maxRetries} 次)</label>
                  <input
                    type="range"
                    min="0"
                    max="5"
                    step="1"
                    value={llm.maxRetries}
                    onChange={(e) => setMaxRetries(Number(e.target.value))}
                  />
                </div>
              </div>

              <div className={styles.section}>
                <div className={styles.toggleRow}>
                  <div>
                    <div className={styles.toggleLabel}>启用流式响应</div>
                    <p className={styles.hint}>启用后以流式方式接收 LLM 响应，体验更流畅。</p>
                  </div>
                  <button
                    className={`${styles.toggle} ${llm.streaming ? styles.on : ''}`}
                    onClick={() => setStreaming(!llm.streaming)}
                    aria-label="启用流式响应"
                  />
                </div>
              </div>
            </div>

            <div className={styles.section}>
              <div className={styles.testRow}>
                <button
                  className={styles.testBtn}
                  onClick={() => testConnection()}
                  disabled={isTesting}
                >
                  {isTesting ? '测试中…' : '测试连接'}
                </button>
                {testResult && (
                  <span className={`${styles.testResult} ${testResult.ok ? styles.ok : styles.fail}`}>
                    {testResult.ok ? '连接成功' : `连接失败：${testResult.error}`}
                  </span>
                )}
              </div>
            </div>
          </>
        )}

        <div className={styles.section}>
          <div className={styles.toggleRow}>
            <div>
              <div className={styles.toggleLabel}>启用 LLM 路由</div>
              <p className={styles.hint}>关闭后所有 LLM 调用都走 mock 实现。</p>
            </div>
            <button
              className={`${styles.toggle} ${llm.enabled ? styles.on : ''}`}
              onClick={() => setEnabled(!llm.enabled)}
              aria-label="启用 LLM 路由"
            />
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionTitle}>预设模板</div>
          <div className={styles.presetGrid}>
            {SETTINGS_PRESETS.map((preset) => (
              <button
                key={preset.id}
                className={`${styles.presetCard} ${llm.provider === preset.config.provider && llm.model === preset.config.model ? styles.active : ''}`}
                onClick={() => handleApplyPreset(preset)}
              >
                <div className={styles.presetName}>{preset.name}</div>
                <div className={styles.presetDesc}>{preset.description}</div>
              </button>
            ))}
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionTitle}>配置迁移</div>
          <div className={styles.migrationRow}>
            <button className={styles.migrationBtn} onClick={handleExport}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              导出设置
            </button>
            <button className={styles.migrationBtn} onClick={() => fileInputRef.current?.click()}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              导入设置
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleFileImport}
              className={styles.fileInput}
            />
          </div>
          <div className={styles.migrationHint}>
            导出的设置文件不包含 API Key，可安全分享配置。
          </div>
          {importResult && (
            <div className={`${styles.importResult} ${importResult.success ? styles.success : styles.error}`}>
              {importResult.message}
            </div>
          )}
        </div>

        <div className={styles.actions}>
          <button className={styles.resetBtn} onClick={resetAll}>
            恢复默认
          </button>
          <button
            className={styles.saveBtn}
            onClick={() => {
              handleSave();
              useSettingsStore.getState().closeSettings();
            }}
          >
            保存
          </button>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionTitle}>外观主题</div>
          <p className={styles.hint} style={{ marginBottom: 'var(--space-3)' }}>
            选择明亮 / 暗色 / 羊皮纸 三种主题。偏好会保存到本地, 跨刷新保留。
          </p>
          <ThemeSwitcher />
        </div>

        {/* v1.4.1 Stage 2: PWA install 入口 (浏览器判定可安装时才出现) */}
        <div className={styles.section} data-testid="install-prompt-section">
          <div className={styles.sectionTitle}>应用安装</div>
          <div className={styles.migrationHint} style={{ marginBottom: 'var(--space-3)' }}>
            将 Wordaydream 安装到设备主屏幕, 离线时仍可使用。
          </div>
          <InstallPromptButton />
        </div>
      </div>
    </div>
  );
}
