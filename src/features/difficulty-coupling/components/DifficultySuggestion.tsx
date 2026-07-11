/**
 * 难度建议软提示 (Stage 1 数据层升级)
 *
 * 设计原则 (Stage 1 SPEC E4):
 * - 不弹窗, inline 显示, 不打断阅读流程
 * - 仅在数据充分 (byLevel[settings.difficulty] >= 30) 且方向明确 (升级/降级) 时才显示
 * - "应用" 即调用 useSettingsStore.setDifficulty, "稍后" 即记录 dismissAt (24h 内不再提示)
 * - 数据来源: useHomeAnalytics() 替代了 v0.9.0 的 useAnalyticsStore 占位 getter
 *   (getMasteryRate / getTotalLearned / getDifficultyStats 等)
 */
import { useEffect, useState } from 'react';
import { useSettingsStore } from '../../settings/store/useSettingsStore';
import { useHomeAnalytics } from '../../analytics/hooks/useHomeAnalytics';
import { suggests } from '../services/difficultyAdvisor';
import type { DifficultyStats } from '../services/difficultyAdvisor';
import styles from './DifficultySuggestion.module.css';

const DISMISS_KEY = 'wordaydream:difficulty-suggestion-dismissed';
const ONE_DAY = 86400000;
/** 数据充分性阈值: 至少 30 词, 与 difficultyAdvisor 内置阈值一致 */
const MIN_TOTAL_AT_LEVEL = 30;

export function DifficultySuggestion() {
  const difficulty = useSettingsStore((s) => s.difficulty);
  const setDifficulty = useSettingsStore((s) => s.setDifficulty);
  const { byLevel, masteryRate } = useHomeAnalytics();

  const totalAtLevel = byLevel[difficulty];

  const [dismissedAt, setDismissedAt] = useState<number | null>(() => {
    if (typeof window === 'undefined') return null;
    const v = localStorage.getItem(DISMISS_KEY);
    return v ? Number(v) : null;
  });

  useEffect(() => {
    if (dismissedAt && Date.now() - dismissedAt < ONE_DAY) return;
    if (typeof window === 'undefined') return;
    const v = localStorage.getItem(DISMISS_KEY);
    if (v && Date.now() - Number(v) < ONE_DAY) {
      setDismissedAt(Number(v));
    }
  }, [dismissedAt]);

  // 数据不足: 阈值不满足, 不打扰
  if (totalAtLevel < MIN_TOTAL_AT_LEVEL) return null;
  if (dismissedAt && Date.now() - dismissedAt < ONE_DAY) return null;

  // 构造 stats 并请求方向建议
  // - masteredAtLevel: 用 byLevel[difficulty] * masteryRate 作为粗略估算
  //   (Stage 1 hook 未暴露 per-level mastered, 后续阶段可扩展)
  // - errorRate: Stage 1 暂无错误率数据, 默认 0
  const stats: DifficultyStats = {
    totalAtLevel,
    masteredAtLevel: Math.round(totalAtLevel * masteryRate),
    errorRate: 0,
    avgDifficulty: difficulty,
  };
  const suggested = suggests(difficulty, stats);
  if (!suggested || suggested === difficulty) return null;

  const isUp = suggested > difficulty;
  const label = isUp ? '基于你的表现, 建议升级' : '内容偏难, 建议降级';

  const handleApply = () => {
    setDifficulty(suggested);
    localStorage.removeItem(DISMISS_KEY);
    setDismissedAt(null);
  };

  const handleDismiss = () => {
    const t = Date.now();
    localStorage.setItem(DISMISS_KEY, String(t));
    setDismissedAt(t);
  };

  return (
    <div className={styles.suggestion} role="status" aria-live="polite">
      <div className={styles.icon} aria-hidden="true">
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          {isUp ? (
            <path d="M7 17L17 7M9 7h8v8" strokeLinecap="round" />
          ) : (
            <path d="M17 7L7 17M15 17H7V9" strokeLinecap="round" />
          )}
        </svg>
      </div>
      <div className={styles.body}>
        <div className={styles.title}>{label}</div>
        <div className={styles.detail}>
          从 L{difficulty} 调整到 L{suggested}
        </div>
      </div>
      <div className={styles.actions}>
        <button
          className={styles.applyBtn}
          onClick={handleApply}
          type="button"
        >
          应用
        </button>
        <button
          className={styles.dismissBtn}
          onClick={handleDismiss}
          type="button"
        >
          稍后
        </button>
      </div>
    </div>
  );
}
