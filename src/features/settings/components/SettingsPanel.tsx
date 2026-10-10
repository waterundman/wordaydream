import { useState, useEffect, useCallback, useRef } from 'react';
import { useFocusTrap } from '../../../hooks/useFocusTrap';
import { useSettingsStore } from '../store/useSettingsStore';
import { useWordlistStore } from '../../wordlist/store/useWordlistStore';
import { ShortcutsSection } from './ShortcutsSection';
import { WrongWordsExportSection } from './WrongWordsExportSection';
import { WrongWordsImportSection } from './WrongWordsImportSection';
import { LlmAdvancedSection } from './LlmAdvancedSection';
import {
  AdvancedParamsSection,
  SettingsMigrationSection,
} from './DataAdvancedSection';
import { InstallPromptButton } from '../../../components/InstallPromptButton';
import { ThemeSwitcher } from '../../../components/ThemeSwitcher';
import { CollapsibleSection } from '../../../components/CollapsibleSection';
import styles from './SettingsPanel.module.css';
import type { LLMProvider } from '../../../types';
import { useMemoryStore } from '../../review/store/useMemoryStore';
import { useToastStore } from '../../../store/useToastStore';
import { useOfflineModeStore } from '../../llm/store/offlineMode';
import { readEnvLLMConfig } from '../../../config/env';
import { detectPlatform } from '../../../platform/detect';
import { requestNotificationPermission } from '../../../platform/harmonyBridge';
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
import { PROVIDER_PRESETS } from '../lib/settingsPresets';

// v1.1.0 Stage 3: 非组件导出 (PROVIDER_PRESETS / SETTINGS_PRESETS) 迁出本文件,
// 避免 react-refresh/only-export-components.

/**
 * FSRS 参数优化 UI 区域 (v2.2.0 Stage 3: @open-spaced-repetition/binding).
 *
 * 为什么 history 存 localStorage 而非 store: 优化历史只是展示用审计信息,
 * 不进 persist 白名单可避免与 fsrsWeights 的迁移逻辑耦合.
 *
 * 行为: ratingHistory < 30 条时按钮禁用; 成功后保存 weights + backup 并注入
 * scheduler, 失败按 OptimizationUnavailableError / 其他错误分别 toast.
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
        addToast('error', 'FSRS 参数优化不可用: 当前构建未包含优化器 (浏览器版不打包 @open-spaced-repetition/binding)');
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
          浏览器版构建未打包 FSRS 参数优化器 (@open-spaced-repetition/binding)，此功能当前不可用；复习继续使用默认参数，学习记录不受影响。
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
        <div className={styles.confirmDialog}>
          <p className={styles.confirmDialogText}>
            确认清空所有 CSV 词库? 此操作不可撤销.
          </p>
          <div className={styles.confirmDialogActions}>
            <button
              type="button"
              onClick={handleClearAll}
              disabled={isClearing}
              className={`${styles.confirmBtn} ${styles.confirmBtnDanger}`}
            >
              {isClearing ? '清空中...' : '确认清空'}
            </button>
            <button
              type="button"
              onClick={() => setShowClearConfirm(false)}
              disabled={isClearing}
              className={`${styles.confirmBtn} ${styles.confirmBtnCancel}`}
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
        <div className={styles.confirmDialog}>
          <p className={styles.confirmDialogText}>
            确认清空所有 AI 释义缓存? 下次查询将重新调用 LLM. 此操作不可撤销.
          </p>
          <div className={styles.confirmDialogActions}>
            <button
              type="button"
              onClick={handleClearAll}
              disabled={isClearing}
              className={`${styles.confirmBtn} ${styles.confirmBtnDanger}`}
            >
              {isClearing ? '清空中...' : '确认清空'}
            </button>
            <button
              type="button"
              onClick={() => setShowClearConfirm(false)}
              disabled={isClearing}
              className={`${styles.confirmBtn} ${styles.confirmBtnCancel}`}
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

/**
 * v0.1.0-harmony Stage 7: 复习提醒通知设置区域.
 *
 * 功能:
 * - 仅在 detectPlatform().supportsNotifications()=true (鸿蒙端) 时渲染, Web 端返回 null
 * - "Enable review reminders" 开关 (.toggle)
 * - "Start time" / "End time" 小时选择器 (0-23, .select)
 * - 时间窗校验: startHour < endHour, 不满足时显示 warning
 * - 通过 setNotifications 更新 store, 同时 writePreferences 持久化到鸿蒙端 (fire-and-forget)
 *
 * UI: 复用 .section / .sectionTitle / .toggleRow / .toggle / .field / .label / .select / .hint.
 */
export function NotificationsSection() {
  // supportsNotifications 在 Web 端 false (渲染 null), 鸿蒙端 true (渲染开关 + 时间窗).
  // 在 hooks 之后 early return, 避免 hooks 顺序不一致.
  const supportsNotifications = detectPlatform().supportsNotifications();
  const notifications = useSettingsStore((s) => s.notifications);
  const setNotifications = useSettingsStore((s) => s.setNotifications);
  // Stage 3 v0.5.0-harmony: 首次开启时触发原生通知权限请求; denied/error 时引导用户.
  const [permissionHint, setPermissionHint] = useState<string | null>(null);

  if (!supportsNotifications) {
    return null;
  }

  const handleToggle = () => {
    const next = { enabled: !notifications.enabled };
    setNotifications(next);
    persistNotifications({ ...notifications, ...next });
    // Stage 3: 开启动作 (false -> true) 时请求系统通知授权 (fire-and-forget);
    // 三态结果中 granted 静默, denied / error 显示引导提示. 无桥 no-op 不提示.
    if (next.enabled) {
      setPermissionHint(null);
      void requestNotificationPermission()
        .then((res) => {
          if (res.noop === true) {
            return;
          }
          if (res.state === 'denied') {
            setPermissionHint('通知权限被拒绝, 请在系统设置中开启后重试.');
          } else if (res.state === 'error') {
            setPermissionHint('通知权限请求失败, 请稍后重试.');
          }
        })
        .catch(() => {
          // fire-and-forget: 失败静默, 不阻塞开关 UI.
        });
    } else {
      setPermissionHint(null);
    }
  };

  const handleStartChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const startHour = Number(e.target.value);
    setNotifications({ startHour });
    persistNotifications({ ...notifications, startHour });
  };

  const handleEndChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const endHour = Number(e.target.value);
    setNotifications({ endHour });
    persistNotifications({ ...notifications, endHour });
  };

  const hourOptions = Array.from({ length: 24 }, (_, h) => h);
  const formatHour = (h: number) => `${h.toString().padStart(2, '0')}:00`;
  const invalidWindow = notifications.startHour >= notifications.endHour;

  return (
    <div className={styles.section} data-testid="notifications-section" data-settings-level="top">
      <div className={styles.sectionTitle}>复习提醒</div>
      <div className={styles.toggleRow}>
        <div>
          <div className={styles.toggleLabel}>Enable review reminders</div>
          <p className={styles.hint}>词汇到期时发送本地通知提醒复习.</p>
        </div>
        <button
          type="button"
          className={`${styles.toggle} ${notifications.enabled ? styles.on : ''}`}
          onClick={handleToggle}
          aria-label="Enable review reminders"
          role="switch"
          aria-checked={notifications.enabled}
        />
      </div>

      {permissionHint !== null && (
        <p className={styles.hint} data-testid="notification-permission-hint" role="alert">
          {permissionHint}
        </p>
      )}

      <div className={styles.row}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="notifications-start-hour">Start time</label>
          <select
            id="notifications-start-hour"
            className={styles.select}
            value={notifications.startHour}
            onChange={handleStartChange}
            disabled={!notifications.enabled}
          >
            {hourOptions.map((h) => (
              <option key={h} value={h}>{formatHour(h)}</option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="notifications-end-hour">End time</label>
          <select
            id="notifications-end-hour"
            className={styles.select}
            value={notifications.endHour}
            onChange={handleEndChange}
            disabled={!notifications.enabled}
          >
            {hourOptions.map((h) => (
              <option key={h} value={h}>{formatHour(h)}</option>
            ))}
          </select>
        </div>
      </div>

      {invalidWindow && (
        <div
          className={styles.hint}
          style={{ color: 'var(--color-danger, #c0392b)' }}
          data-testid="notifications-window-warning"
        >
          开始时间必须早于结束时间.
        </div>
      )}
    </div>
  );
}

/** Stage 7: 将通知配置同步到鸿蒙端 preferences (fire-and-forget, 失败静默). */
function persistNotifications(notifications: {
  enabled: boolean;
  startHour: number;
  endHour: number;
}): void {
  try {
    void window.harmonyBridge
      ?.writePreferences('notifications_config', JSON.stringify(notifications))
      ?.catch(() => {
        // silent skip — JSBridge 异步失败不阻塞 UI
      });
  } catch {
    // silent skip — Web 端无 harmonyBridge
  }
}

// v1.6.4 Stage 1: 三层 IA — 常显层 (data-settings-level="top": 语言模型 / 外观主题 /
// 课程模式 / 复习提醒) + 折叠层 A (LLM 高级) + 折叠层 B (数据与高级) + 语境化 (应用安装,
// 整段条件渲染). 折叠层用 CollapsibleSection (<details>): 折叠态内容仍在 DOM, 既有断言不受影响.
export function SettingsPanel() {
  // 折叠层的调参控件 (temperature / timeout / maxRetries / streaming / 预设模板 /
  // JSON 重试 / 难度) 由各自兄弟组件订阅自己的 setter, 本文件只保留常显层用到的.
  // `enabled` 是例外: LLM 总开关语义属常显层, 因此 setEnabled 留在此处,
  // 且全仓只有这一处交互式写入 (见下方 switch).
  const {
    llm,
    isTesting,
    testResult,
    setProvider,
    setModel,
    setEnabled,
    testConnection,
    resetAll,
  } = useSettingsStore();

  // v1.6.0: 课程模式 (闯关 / 自由)
  const linearMode = useWordlistStore((s) => s.linearMode);
  const setLinearMode = useWordlistStore((s) => s.setLinearMode);

  // 鸿蒙端 / 未捕获 beforeinstallprompt 时不渲染 wrapper (修「空块」缺陷).
  const installPromptEvent = useOfflineModeStore((s) => s.installPromptEvent);
  const showInstallSection =
    detectPlatform().supportsInstallPrompt() && installPromptEvent !== null;

  // v2.2.4 Stage 3 (D5): ESC 键关闭设置弹窗
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        useSettingsStore.getState().closeSettings();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleProviderChange = (provider: LLMProvider) => {
    setProvider(provider);
    const preset = PROVIDER_PRESETS[provider];
    if (preset.defaultModel) setModel(preset.defaultModel);
  };

  const preset = PROVIDER_PRESETS[llm.provider];
  const isMock = llm.provider === 'mock';
  const currentModel = llm.model || preset.defaultModel;
  // v1.6.4 Stage 1: Key 归属说明 (真实 provider 的 Key 由代理服务端持有).
  const apiKeyHint = isMock
    ? '模拟模式不需要 API Key。'
    : readEnvLLMConfig(llm.provider) !== null
      ? '构建时已通过 VITE_* 环境变量注入 Key。'
      : 'Key 由代理服务端持有, 客户端无需填写; 用下方「测试连接」验证服务端是否已配置。';

  // v1.6.4 探测修复: 面板此前无焦点陷阱, Tab 会穿到遮罩后面的页面内容
  // (AchievementListModal / GraduationModal / KeyboardShortcutsHelp 都有).
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, true);

  return (
    <div className={styles.backdrop} onClick={(e) => e.target === e.currentTarget && useSettingsStore.getState().closeSettings()}>
      <div className={styles.panel} ref={panelRef} role="dialog" aria-modal="true" aria-label="设置">
        <div className={styles.header}>
          <div>
            <h2 className={styles.title}>设置</h2>
            <p className={styles.subtitle}>配置 LLM 以启用真实的语境化学习</p>
          </div>
          <button
            className={styles.closeBtn}
            onClick={() => useSettingsStore.getState().closeSettings()}
            aria-label="关闭设置"
            type="button"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        {/* ===== 常显层 (data-settings-level="top"): 语言模型 四合一 ===== */}
        <div className={styles.section} data-settings-level="top">
          <div className={styles.sectionTitle}>语言模型</div>
          {/* v2.2.0 Stage 1 (D4): LLM 状态指示器 */}
          <div
            data-testid="llm-status-indicator"
            className={`${styles.llmStatusIndicator} ${llm.enabled && llm.provider !== 'mock' ? styles.llmStatusActive : styles.llmStatusInactive}`}
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

          {/* v1.6.4 Stage 1 (P3): llm.enabled 的**唯一**交互式写入点 (常显层).
              折叠层 A 只保留状态行 + 指回本开关的说明; 预设模板不再写 enabled. */}
          <div className={styles.toggleRow}>
            <div>
              <div className={styles.toggleLabel}>启用 LLM 路由</div>
              <p className={styles.hint}>
                关闭后所有 LLM 调用都走 mock 实现。提供商选「模拟」时无论开关如何都走 mock;
                温度 / 超时 / 重试 / 流式在折叠层「LLM 高级参数」内调整。
              </p>
            </div>
            <button
              type="button"
              className={`${styles.toggle} ${llm.enabled ? styles.on : ''}`}
              onClick={() => setEnabled(!llm.enabled)}
              aria-label="启用 LLM 路由"
              role="switch"
              aria-checked={llm.enabled}
            />
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

          <div className={styles.field}>
            <label className={styles.label} htmlFor="settings-llm-model">模型</label>
            <input
              id="settings-llm-model"
              className={styles.input}
              type="text"
              value={currentModel}
              disabled={isMock}
              onChange={(e) => setModel(e.target.value)}
              placeholder={isMock ? '模拟模式使用内置示例数据' : preset.defaultModel}
            />
          </div>

          <div className={styles.field}>
            <span className={styles.label}>API Key</span>
            <p className={styles.hint}>{apiKeyHint}</p>
          </div>

          <p className={styles.hint} style={{ marginTop: 'var(--space-2)' }}>
            {isMock
              ? '模拟模式：内置示例数据，无需 API Key，适合演示和调试。'
              : '真实模式：文本生成、判题和补救将调用真实 LLM。'}
          </p>

          <div className={styles.testRow}>
            <button
              className={styles.testBtn}
              onClick={() => testConnection()}
              disabled={isTesting || isMock}
            >
              {isTesting ? '测试中…' : '测试连接'}
            </button>
            {!isMock && testResult && (
              <span className={`${styles.testResult} ${testResult.ok ? styles.ok : styles.fail}`}>
                {testResult.ok ? '连接成功' : `连接失败：${testResult.error}`}
              </span>
            )}
          </div>
        </div>

        <div className={styles.section} data-settings-level="top">
          <div className={styles.sectionTitle}>外观主题</div>
          <p className={styles.hint} style={{ marginBottom: 'var(--space-3)' }}>
            选择明亮 / 暗色 / 羊皮纸 三种主题。偏好会保存到本地, 跨刷新保留。
          </p>
          <ThemeSwitcher />
        </div>

        <div className={styles.section} data-settings-level="top">
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

        {/* 复习提醒 (仅鸿蒙端渲染, Web 端返回 null) */}
        <NotificationsSection />

        {/* ===== 折叠层 A: LLM 高级参数 (默认折叠, 内容见 LlmAdvancedSection) ===== */}
        <LlmAdvancedSection />

        {/* ===== 折叠层 B: 数据与高级 (默认折叠) ===== */}
        <CollapsibleSection
          title="数据与高级"
          description="清空类操作不可撤销; 导入设置会覆盖当前 LLM 配置; 快捷键、错词备份与词表文件也在这里。"
          testId="settings-group-data-advanced"
        >
          {/* 数据管理 (FSRS / AI 释义缓存 / CSV 词库) + 错词导入导出 + 快捷键 */}
          <FsrsOptimizationSection />
          <GlossCacheSection />
          <CsvWordlistManagementSection />
          <WrongWordsExportSection />
          <WrongWordsImportSection />
          <ShortcutsSection />

          <SettingsMigrationSection />
          <AdvancedParamsSection />
        </CollapsibleSection>

        {/* ===== 语境化: PWA 安装入口 (整段条件渲染, 鸿蒙端 / 未捕获安装事件时不渲染) ===== */}
        {showInstallSection && (
          <div className={styles.section} data-testid="install-prompt-section">
            <div className={styles.sectionTitle}>应用安装</div>
            <div className={styles.migrationHint} style={{ marginBottom: 'var(--space-3)' }}>
              将 Wordaydream 安装到设备主屏幕, 离线时仍可使用。
            </div>
            <InstallPromptButton />
          </div>
        )}

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
      </div>
    </div>
  );
}
