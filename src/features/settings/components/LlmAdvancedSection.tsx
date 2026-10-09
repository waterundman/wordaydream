/**
 * LlmAdvancedSection (v1.6.4 Stage 1)
 *
 * 折叠层 A: LLM 高级参数 (默认折叠). 从 SettingsPanel 抽出以收敛该上帝文件的行数,
 * 渲染内容与 testid (`settings-group-llm-advanced`) 保持不变; 折叠态内容仍在 DOM 中.
 *
 * 含: 随机性 / 超时 / 重试 / 流式响应 / LLM 路由状态行 / 预设模板.
 *
 * v1.6.4 Stage 1 (P3 修复): `llm.enabled` 的**交互式写入点全仓只有 1 处** ——
 * 常显层「语言模型」区块内的 switch (SettingsPanel.tsx). 本组件因此:
 * - 不再订阅 setEnabled (折叠层不提供第二个开关, 只显示状态行并指回常显层开关);
 * - 预设模板不再写 enabled (预设语义 = provider/model/temperature 组合, 不是开关),
 *   对应地 SETTINGS_PRESETS 的 config 也不再声明 enabled 字段.
 * 这与 SPEC §3 S1 目标 IA 表把「LLM 路由」列在折叠层 A 略有偏离, 是 P3 的显式裁定:
 * 总开关属常显层, 折叠层只放调参项.
 */
import { useSettingsStore } from '../store/useSettingsStore';
import { CollapsibleSection } from '../../../components/CollapsibleSection';
import { SETTINGS_PRESETS } from '../lib/settingsPresets';
import styles from './SettingsPanel.module.css';

export function LlmAdvancedSection() {
  const llm = useSettingsStore((s) => s.llm);
  const setProvider = useSettingsStore((s) => s.setProvider);
  const setModel = useSettingsStore((s) => s.setModel);
  const setTemperature = useSettingsStore((s) => s.setTemperature);
  const setTimeoutValue = useSettingsStore((s) => s.setTimeoutValue);
  const setMaxRetries = useSettingsStore((s) => s.setMaxRetries);
  const setStreaming = useSettingsStore((s) => s.setStreaming);

  // v1.6.4 Stage 1 (P3): 预设只组合 provider / model / temperature, 不动 enabled.
  const handleApplyPreset = (preset: (typeof SETTINGS_PRESETS)[number]) => {
    setProvider(preset.config.provider);
    setModel(preset.config.model);
    setTemperature(preset.config.temperature);
  };

  return (
    <CollapsibleSection
      title="LLM 高级参数"
      description="关闭 LLM 路由后所有 LLM 调用都退回模拟数据; 温度 / 超时 / 重试 / 流式只在真实 provider 下生效, 单 Key 用户保持默认即可。"
      testId="settings-group-llm-advanced"
    >
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

      {/* v1.6.4 Stage 1 (P3): 状态行 (非交互) —— 不再提供第二个 enabled 开关.
          唯一开关在常显层「语言模型」区块内, 这里只回报状态并指回它. */}
      <div className={styles.toggleRow} data-testid="llm-route-status">
        <div>
          <div className={styles.toggleLabel}>
            LLM 路由状态: {llm.enabled ? '已启用' : '已关闭'}
          </div>
          <p className={styles.hint}>
            开关在常显层「语言模型」区块内。关闭后所有 LLM 调用都走 mock 实现。
          </p>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>预设模板</div>
        <div className={styles.presetGrid}>
          {SETTINGS_PRESETS.map((presetOption) => (
            <button
              key={presetOption.id}
              className={`${styles.presetCard} ${llm.provider === presetOption.config.provider && llm.model === presetOption.config.model ? styles.active : ''}`}
              onClick={() => handleApplyPreset(presetOption)}
            >
              <div className={styles.presetName}>{presetOption.name}</div>
              <div className={styles.presetDesc}>{presetOption.description}</div>
            </button>
          ))}
        </div>
      </div>
    </CollapsibleSection>
  );
}