/**
 * DataAdvancedSection (v1.6.4 Stage 1)
 *
 * 折叠层 B (数据与高级) 内的两个内联区块: 配置迁移 + 高级参数.
 * 从 SettingsPanel 抽出以收敛该上帝文件的体积; 渲染结构与标记不变
 * (`#settings-json-attempts` 仍位于 `settings-group-data-advanced` 内).
 *
 * 高级参数区块承载两个此前「有 store 无 UI 入口」的字段
 * (`setJsonMaxAttempts` / `setDifficulty`): SPEC §3 S1 要求不留悬挂态.
 */
import { useRef, useState } from 'react';
import { useSettingsStore } from '../store/useSettingsStore';
import styles from './SettingsPanel.module.css';
import type { DifficultyLevel } from '../../../types';

/** 与 useSettingsStore 的 defaultLLM 一致 (jsonMaxAttempts 兜底值). */
const DEFAULT_JSON_ATTEMPTS = 3;

/** 难度等级 (CEFR A1-C1); 等级 5 (C1) 为自由阅读模式. */
const DIFFICULTY_LEVELS: readonly DifficultyLevel[] = [1, 2, 3, 4, 5];
const CEFR_LABEL: Record<number, string> = { 1: 'A1', 2: 'A2', 3: 'B1', 4: 'B2', 5: 'C1' };

/** 配置迁移: 导出 / 导入设置 JSON (不含 API Key). */
export function SettingsMigrationSection() {
  const exportSettings = useSettingsStore((s) => s.exportSettings);
  const importSettings = useSettingsStore((s) => s.importSettings);
  const [importResult, setImportResult] = useState<{ success: boolean; message: string } | null>(
    null,
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      const ok = importSettings(content);
      setImportResult(
        ok
          ? { success: true, message: '设置导入成功' }
          : { success: false, message: '设置导入失败，请检查文件格式' },
      );
      setTimeout(() => setImportResult(null), 3000);
    };
    reader.readAsText(file);
  };

  return (
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
      <div className={styles.migrationHint}>导出的设置文件不包含 API Key，可安全分享配置。</div>
      {importResult && (
        <div
          className={`${styles.importResult} ${importResult.success ? styles.success : styles.error}`}
        >
          {importResult.message}
        </div>
      )}
    </div>
  );
}

/** 高级参数: LLM JSON 重试次数 + 难度等级. */
export function AdvancedParamsSection() {
  const jsonMaxAttempts = useSettingsStore((s) => s.llm.jsonMaxAttempts);
  const setJsonMaxAttempts = useSettingsStore((s) => s.setJsonMaxAttempts);
  const difficulty = useSettingsStore((s) => s.difficulty);
  const setDifficulty = useSettingsStore((s) => s.setDifficulty);

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>高级参数</div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="settings-json-attempts">
          JSON 解析重试次数 ({jsonMaxAttempts ?? DEFAULT_JSON_ATTEMPTS} 次)
        </label>
        <input
          id="settings-json-attempts"
          type="range"
          min="1"
          max="5"
          step="1"
          value={jsonMaxAttempts ?? DEFAULT_JSON_ATTEMPTS}
          onChange={(e) => setJsonMaxAttempts(Number(e.target.value))}
        />
        <p className={styles.hint}>LLM 返回非法 JSON 时自动重试修复的次数, 越高越稳但越慢。</p>
      </div>

      <div className={styles.field}>
        <span className={styles.label}>难度等级</span>
        <div className={styles.providerGroup}>
          {DIFFICULTY_LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              className={`${styles.providerBtn} ${difficulty === level ? styles.active : ''}`}
              onClick={() => setDifficulty(level)}
              aria-pressed={difficulty === level}
            >
              {CEFR_LABEL[level]}
            </button>
          ))}
        </div>
        <p className={styles.hint}>决定词表与阅读材料的 CEFR 层级; 等级 5 (C1) 进入自由阅读模式。</p>
      </div>
    </div>
  );
}