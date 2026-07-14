import { useState, useRef, useEffect, useCallback } from 'react';
import { useSettingsStore } from '../store/useSettingsStore';
import { useWordlistStore } from '../../wordlist/store/useWordlistStore';
import { InstallPromptButton } from '../../../components/InstallPromptButton';
import { ThemeSwitcher } from '../../../components/ThemeSwitcher';
import styles from './SettingsPanel.module.css';
import type { LLMProvider } from '../../../types';
import { useMemoryStore } from '../../review/store/useMemoryStore';
import { useToastStore } from '../../../store/useToastStore';
import {
  isOptimizationAvailable,
  optimizeFsrsWeights,
  OptimizationUnavailableError,
} from '../../review/services/fsrsOptimizer';
import {
  setFsrsWeights as setFsrsWeightsInScheduler,
  resetFsrsWeights as resetFsrsWeightsInScheduler,
} from '../../review/services/schedulerAdapter';
import {
  listCsvWordlists,
  deleteCsvWordlist,
  getAllCsvEntries,
} from '../../../data/wordlists/csvStorage';
import {
  getCachedGlossCount,
  clearAllCachedGlosses,
} from '../../dictionary/services/glossPersistentCache';

// v2.1.1 Stage 3 (D3): 收窄为 4 个有实现的 provider, 移除 kimi/qwen/minimax.
// export 出来供测试 (T18/T19) 验证 keys 集合.
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
// export 出来供测试 (T19) 验证不含已废弃 provider.
export const SETTINGS_PRESETS = [
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
];

/**
 * v1.8.0 Stage 3 / v2.2.0 Stage 3: FSRS 参数优化 UI 区域.
 *
 * 功能状态:
 * - 可用 (v2.2.0 Stage 3, @open-spaced-repetition/binding): isOptimizationAvailable() = true,
 *   按钮可点击 + 进度条 + 成功 toast (含 loss) + 优化历史
 * - 不可用 (binding 未加载): 按钮禁用 + 显示通用不可用提示
 *
 * UI 行为:
 * - ratingHistory < 30 条时按钮禁用 + 显示数据不足提示 (isAvailable=true 时)
 * - 优化成功: 保存 weights + backup, 注入 scheduler, 显示 success toast (含 loss),
 *   追加优化历史记录 (持久化到 localStorage)
 * - 优化失败 (OptimizationUnavailableError): 显示 error toast
 * - 优化失败 (其他错误如 NotEnoughData): 显示 error toast + 通用错误信息
 * - 回滚: 清除 weights + backup, 重置 scheduler, 显示 success toast
 * - 进度条仅在 isOptimizing 时显示
 * - 回滚按钮仅在 hasBackup 时显示
 * - 优化历史显示最近 5 次 (timestamp + loss + weights hash 前 8 字符)
 * - toast 使用全局 useToastStore (非本地 state)
 */
const FSRS_OPTIMIZATION_HISTORY_KEY = 'wordaydream:fsrs-optimization-history';
const FSRS_OPTIMIZATION_HISTORY_MAX = 5;

interface OptimizationRecord {
  timestamp: number;
  loss: number;
  weightsHash: string;
}

function hashWeights(weights: number[]): string {
  let h = 5381;
  for (const w of weights) {
    h = ((h * 33) ^ Math.round(w * 1_000_000)) >>> 0;
  }
  return h.toString(16).padStart(8, '0').slice(0, 8);
}

function loadOptimizationHistory(): OptimizationRecord[] {
  try {
    const raw = localStorage.getItem(FSRS_OPTIMIZATION_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(-FSRS_OPTIMIZATION_HISTORY_MAX) : [];
  } catch {
    return [];
  }
}

function saveOptimizationHistory(records: OptimizationRecord[]): void {
  try {
    localStorage.setItem(
      FSRS_OPTIMIZATION_HISTORY_KEY,
      JSON.stringify(records.slice(-FSRS_OPTIMIZATION_HISTORY_MAX)),
    );
  } catch {
    // localStorage 不可用时静默失败
  }
}

export function FsrsOptimizationSection() {
  const fsrsWeights = useSettingsStore((s) => s.fsrsWeights);
  const fsrsWeightsBackup = useSettingsStore((s) => s.fsrsWeightsBackup);
  const ratingHistory = useMemoryStore((s) => s.ratingHistory);
  const addToast = useToastStore((s) => s.addToast);

  const [isOptimizing, setIsOptimizing] = useState(false);
  const [progress, setProgress] = useState(0);
  // v2.2.0 hotfix: isOptimizationAvailable() 现为 async (动态加载 binding).
  // 初始 false, useEffect 异步检测后更新状态 (避免同步 import binding 导致白屏).
  const [isAvailable, setIsAvailable] = useState(false);
  // v2.2.0 Stage 3: 优化历史 (持久化到 localStorage)
  const [history, setHistory] = useState<OptimizationRecord[]>([]);

  useEffect(() => {
    setHistory(loadOptimizationHistory());
  }, []);

  useEffect(() => {
    let cancelled = false;
    isOptimizationAvailable().then((available) => {
      if (!cancelled) setIsAvailable(available);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const hasEnoughHistory = ratingHistory.length >= 30;
  const hasBackup = fsrsWeightsBackup !== undefined;

  const handleOptimize = async () => {
    if (!isAvailable || !hasEnoughHistory || isOptimizing) return;
    setIsOptimizing(true);
    setProgress(0);
    try {
      const { weights, backup, loss } = await optimizeFsrsWeights(ratingHistory, (p) =>
        setProgress(Math.min(100, Math.max(0, p * 100))),
      );
      useSettingsStore.setState({ fsrsWeights: weights, fsrsWeightsBackup: backup });
      setFsrsWeightsInScheduler(weights);
      addToast('success', `FSRS 参数优化完成 (loss: ${loss.toFixed(2)})`);

      // v2.2.0 Stage 3: 追加优化历史记录 (最多 5 条, 超出移除最旧)
      const record: OptimizationRecord = {
        timestamp: Date.now(),
        loss,
        weightsHash: hashWeights(weights),
      };
      setHistory((prev) => {
        const next = [...prev, record].slice(-FSRS_OPTIMIZATION_HISTORY_MAX);
        saveOptimizationHistory(next);
        return next;
      });
    } catch (e) {
      if (e instanceof OptimizationUnavailableError) {
        addToast('error', 'FSRS 参数优化不可用: 优化器未正确加载, 请确保已安装 @open-spaced-repetition/binding');
      } else {
        addToast('error', `优化失败: ${(e as Error).message}`);
      }
    } finally {
      setIsOptimizing(false);
      setProgress(0);
    }
  };

  const handleRollback = () => {
    if (!hasBackup || isOptimizing) return;
    useSettingsStore.setState({ fsrsWeights: undefined, fsrsWeightsBackup: undefined });
    resetFsrsWeightsInScheduler();
    addToast('success', '已恢复默认 FSRS 参数');
  };

  return (
    <div className={styles.section} data-testid="fsrs-optimization-section">
      <div className={styles.sectionTitle}>FSRS 参数优化</div>

      {!isAvailable && (
        <div className={styles.fsrsUnavailable}>
          FSRS 参数优化不可用, 请确保已安装 @open-spaced-repetition/binding
        </div>
      )}

      <div className={styles.fsrsRow}>
        <button
          type="button"
          onClick={handleOptimize}
          disabled={!isAvailable || !hasEnoughHistory || isOptimizing}
          className={styles.fsrsButton}
        >
          {isOptimizing ? '优化中...' : '优化 FSRS 参数'}
        </button>

        {hasBackup && (
          <button
            type="button"
            onClick={handleRollback}
            disabled={isOptimizing}
            className={styles.fsrsRollback}
          >
            恢复默认参数
          </button>
        )}
      </div>

      {isAvailable && !hasEnoughHistory && (
        <div className={styles.fsrsInsufficient}>
          需要至少 30 条 review 记录 (当前 {ratingHistory.length} 条)
        </div>
      )}

      {isOptimizing && (
        <div className={styles.fsrsProgress}>
          <progress value={progress} max={100} />
          <span>{Math.round(progress)}%</span>
        </div>
      )}

      {fsrsWeights && (
        <div className={styles.fsrsStatus}>
          已应用优化参数 (权重数量: {fsrsWeights.length})
        </div>
      )}

      {history.length > 0 && (
        <div className={styles.fsrsHistory} data-testid="fsrs-optimization-history">
          <div className={styles.fsrsHistoryTitle}>优化历史</div>
          <ul className={styles.fsrsHistoryList}>
            {history.map((rec, idx) => (
              <li key={`${rec.timestamp}-${idx}`} className={styles.fsrsHistoryItem}>
                <span className={styles.fsrsHistoryTime}>
                  {new Date(rec.timestamp).toLocaleString()}
                </span>
                <span className={styles.fsrsHistoryLoss}>loss: {rec.loss.toFixed(2)}</span>
                <span className={styles.fsrsHistoryHash}>{rec.weightsHash}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * v2.2.0 Stage 2 (D2): CSV 词库管理区域.
 *
 * 功能:
 * - 显示已导入 CSV 总数
 * - "清空所有 CSV 词库" 按钮 (带确认弹窗)
 * - "导出所有 CSV" 按钮 (合并所有 CSV 为单个 JSON 下载)
 *
 * UI: 暖白 + 深墨 + 无 emoji + SVG icon
 */
export function CsvWordlistManagementSection() {
  const [csvCount, setCsvCount] = useState(0);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  const refreshCount = useCallback(async () => {
    try {
      const lists = await listCsvWordlists();
      setCsvCount(lists.length);
    } catch {
      // IndexedDB 不可用, 显示 0
      setCsvCount(0);
    }
  }, []);

  useEffect(() => {
    refreshCount();
  }, [refreshCount]);

  const handleClearAll = async () => {
    setIsClearing(true);
    try {
      const lists = await listCsvWordlists();
      for (const list of lists) {
        await deleteCsvWordlist(list.id);
      }
      await refreshCount();
      setShowClearConfirm(false);
    } catch {
      // 静默失败 (IndexedDB 不可用)
    } finally {
      setIsClearing(false);
    }
  };

  const handleExportAll = async () => {
    try {
      const lists = await listCsvWordlists();
      const entries = await getAllCsvEntries();
      const payload = {
        exportedAt: Date.now(),
        totalLists: lists.length,
        totalEntries: entries.length,
        lists: lists.map((l) => ({
          id: l.id,
          fileName: l.fileName,
          importedAt: l.importedAt,
          entryCount: l.entryCount,
        })),
        entries,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `wordaydream-csv-export-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // 静默失败 (IndexedDB 不可用)
    }
  };

  return (
    <div className={styles.section} data-testid="csv-wordlist-management-section">
      <div className={styles.sectionTitle}>词库管理</div>
      <div className={styles.migrationHint} style={{ marginBottom: 'var(--space-3)' }}>
        已导入 {csvCount} 个自定义 CSV 词库
      </div>

      {showClearConfirm && (
        <div
          style={{
            marginBottom: 'var(--space-3)',
            padding: 'var(--space-3)',
            border: '1px solid #fca5a5',
            borderRadius: 'var(--radius-sm, 0.25rem)',
            background: '#fef2f2',
            fontSize: 'var(--text-sm, 0.875rem)',
            color: '#b91c1c',
          }}
        >
          <p style={{ margin: '0 0 var(--space-2) 0' }}>
            确认清空所有 CSV 词库? 此操作不可撤销.
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button
              type="button"
              onClick={handleClearAll}
              disabled={isClearing}
              style={{
                padding: 'var(--space-1) var(--space-3)',
                fontSize: 'var(--text-sm, 0.875rem)',
                color: '#ffffff',
                background: '#b91c1c',
                border: 'none',
                borderRadius: 'var(--radius-sm, 0.25rem)',
                cursor: isClearing ? 'not-allowed' : 'pointer',
              }}
            >
              {isClearing ? '清空中...' : '确认清空'}
            </button>
            <button
              type="button"
              onClick={() => setShowClearConfirm(false)}
              disabled={isClearing}
              style={{
                padding: 'var(--space-1) var(--space-3)',
                fontSize: 'var(--text-sm, 0.875rem)',
                color: 'var(--color-text-secondary, #4a4540)',
                background: 'none',
                border: '1px solid var(--color-border, #e8e4dc)',
                borderRadius: 'var(--radius-sm, 0.25rem)',
                cursor: 'pointer',
              }}
            >
              取消
            </button>
          </div>
        </div>
      )}

      <div className={styles.migrationRow}>
        <button
          className={styles.migrationBtn}
          onClick={handleExportAll}
          type="button"
          disabled={csvCount === 0}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          导出所有 CSV
        </button>
        <button
          className={styles.migrationBtn}
          onClick={() => setShowClearConfirm(true)}
          type="button"
          disabled={csvCount === 0}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
          清空所有 CSV 词库
        </button>
      </div>
    </div>
  );
}

/**
 * v2.2.0 Stage 4 (D3): AI 释义缓存管理区域.
 *
 * 功能:
 * - 显示缓存条数 (getCachedGlossCount 异步加载)
 * - "清空缓存" 按钮 (调 clearAllCachedGlosses, 带确认弹窗)
 * - "缓存信息" 文字: 解释缓存用途 + 30 天自动过期
 *
 * UI: 暖白 + 深墨 + 无 emoji, 复用 .section / .sectionTitle / .migrationRow 样式.
 */
export function GlossCacheSection() {
  const [cacheCount, setCacheCount] = useState(0);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const addToast = useToastStore((s) => s.addToast);

  const refreshCount = useCallback(async () => {
    try {
      const count = await getCachedGlossCount();
      setCacheCount(count);
    } catch {
      // IndexedDB 不可用, 显示 0
      setCacheCount(0);
    }
  }, []);

  useEffect(() => {
    refreshCount();
  }, [refreshCount]);

  const handleClearAll = async () => {
    setIsClearing(true);
    try {
      await clearAllCachedGlosses();
      await refreshCount();
      setShowClearConfirm(false);
      addToast('success', 'AI 释义缓存已清空');
    } catch {
      addToast('error', '清空缓存失败');
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <div className={styles.section} data-testid="gloss-cache-section">
      <div className={styles.sectionTitle}>AI 释义缓存</div>
      <div className={styles.glossCacheInfo}>
        缓存 LLM 改写的释义, 加速二次访问. 30 天自动过期.
      </div>
      <div className={styles.glossCacheCount}>
        当前缓存 {cacheCount} 条
      </div>

      {showClearConfirm && (
        <div
          style={{
            marginBottom: 'var(--space-3)',
            padding: 'var(--space-3)',
            border: '1px solid #fca5a5',
            borderRadius: 'var(--radius-sm, 0.25rem)',
            background: '#fef2f2',
            fontSize: 'var(--text-sm, 0.875rem)',
            color: '#b91c1c',
          }}
        >
          <p style={{ margin: '0 0 var(--space-2) 0' }}>
            确认清空所有 AI 释义缓存? 下次查询将重新调用 LLM. 此操作不可撤销.
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button
              type="button"
              onClick={handleClearAll}
              disabled={isClearing}
              style={{
                padding: 'var(--space-1) var(--space-3)',
                fontSize: 'var(--text-sm, 0.875rem)',
                color: '#ffffff',
                background: '#b91c1c',
                border: 'none',
                borderRadius: 'var(--radius-sm, 0.25rem)',
                cursor: isClearing ? 'not-allowed' : 'pointer',
              }}
            >
              {isClearing ? '清空中...' : '确认清空'}
            </button>
            <button
              type="button"
              onClick={() => setShowClearConfirm(false)}
              disabled={isClearing}
              style={{
                padding: 'var(--space-1) var(--space-3)',
                fontSize: 'var(--text-sm, 0.875rem)',
                color: 'var(--color-text-secondary, #4a4540)',
                background: 'none',
                border: '1px solid var(--color-border, #e8e4dc)',
                borderRadius: 'var(--radius-sm, 0.25rem)',
                cursor: 'pointer',
              }}
            >
              取消
            </button>
          </div>
        </div>
      )}

      <div className={styles.migrationRow}>
        <button
          className={styles.migrationBtn}
          onClick={() => setShowClearConfirm(true)}
          type="button"
          disabled={cacheCount === 0 || isClearing}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
          清空缓存
        </button>
      </div>
    </div>
  );
}

export function SettingsPanel() {
  const {
    llm,
    isTesting,
    testResult,
    setProvider,
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

  // v1.6.0: 课程模式 (闯关 / 自由)
  const linearMode = useWordlistStore((s) => s.linearMode);
  const setLinearMode = useWordlistStore((s) => s.setLinearMode);

  const [importResult, setImportResult] = useState<{ success: boolean; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleProviderChange = (provider: LLMProvider) => {
    setProvider(provider);
    const preset = PROVIDER_PRESETS[provider];
    if (preset.defaultModel) setModel(preset.defaultModel);
  };

  const handleApplyPreset = (preset: typeof SETTINGS_PRESETS[0]) => {
    setProvider(preset.config.provider);
    setModel(preset.config.model);
    setTemperature(preset.config.temperature);
    setEnabled(preset.config.enabled);
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
          {/* v2.2.0 Stage 1 (D4): LLM 状态指示器 */}
          <div
            data-testid="llm-status-indicator"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              padding: 'var(--space-2) var(--space-3)',
              marginBottom: 'var(--space-3)',
              borderRadius: 'var(--radius-sm)',
              background: llm.enabled && llm.provider !== 'mock' ? '#f0fdf4' : '#f5f5f4',
              color: llm.enabled && llm.provider !== 'mock' ? '#15803d' : '#78716c',
              fontSize: 'var(--text-sm)',
            }}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              {llm.enabled && llm.provider !== 'mock' ? (
                <circle cx="12" cy="12" r="9" />
              ) : (
                <circle cx="12" cy="12" r="9" />
              )}
              {llm.enabled && llm.provider !== 'mock' ? (
                <path d="M9 12l2 2 4-4" />
              ) : (
                <path d="M8 12h8" />
              )}
            </svg>
            <span>
              {llm.enabled && llm.provider !== 'mock'
                ? `LLM 已启用 (${llm.provider})`
                : '演示模式 (LLM 未启用)'}
            </span>
          </div>
          <div className={styles.providerGroup}>
            {(['mock', 'openai', 'anthropic', 'deepseek'] as LLMProvider[]).map((p) => (
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
              : '真实模式：填入你的 API Key 后，文本生成、判题和补救将调用真实 LLM。'}
          </p>
        </div>

        {!isMock && (
          <>
            <div className={styles.section}>
              <div className={styles.sectionTitle}>连接配置</div>

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

        {/* v1.6.0: 课程模式 (闯关 / 自由) */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>课程模式</div>
          <div className={styles.providerGroup}>
            <button
              className={`${styles.providerBtn} ${linearMode ? styles.active : ''}`}
              onClick={() => setLinearMode(true)}
            >
              闯关模式
            </button>
            <button
              className={`${styles.providerBtn} ${!linearMode ? styles.active : ''}`}
              onClick={() => setLinearMode(false)}
            >
              自由模式
            </button>
          </div>
          <p className={styles.hint} style={{ marginTop: 'var(--space-2)' }}>
            {linearMode
              ? '闯关模式: 完成当前等级 80% 掌握才能解锁下一级'
              : '自由模式: 任意等级自由切换, 仅追踪词表覆盖率'}
          </p>
        </div>

        <FsrsOptimizationSection />

        {/* v2.2.0 Stage 2 (D2): CSV 词库管理 */}
        <CsvWordlistManagementSection />

        {/* v2.2.0 Stage 4 (D3): AI 释义缓存 */}
        <GlossCacheSection />

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
            onClick={() => useSettingsStore.getState().closeSettings()}
          >
            完成
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
