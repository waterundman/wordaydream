/**
 * ReadingSummarySection (v1.4.0 S3b: 轻量阅读摘要)
 *
 * 渲染在 WordlistPage 错词本之后, 数据来自 useReadingHistoryStore.history,
 * 经 summarizeReadingHistory 纯派生 (不改 store, 零迁移风险).
 *
 * 设计:
 * - 仅 history.length > 0 渲染 (新用户/清空后不出现空卡)
 * - 主行: 阅读 X 篇 · 完成 Y 篇 · 解析 Z 词 (Z = 完成条目 resolvedCount 求和)
 * - 次行: 近 7 天完成 N 篇 · en A / de B (完成条目语言分布, other 不展示 —
 *   Language 类型仅 'en'|'de', other 恒 0, 展示徒增噪音)
 * - UI 沿错词本区块风格 (标题 + 数据行, 暖白/深墨, 无 emoji)
 */
import { useMemo } from 'react';
import { useReadingHistoryStore } from '../../reading/store/useReadingHistoryStore';
import { summarizeReadingHistory } from '../../reading/readingSummary';
import styles from './ReadingSummarySection.module.css';

export function ReadingSummarySection() {
  const history = useReadingHistoryStore((s) => s.history);

  const summary = useMemo(() => summarizeReadingHistory(history), [history]);

  if (history.length === 0) {
    return null;
  }

  return (
    <section
      data-testid="reading-summary-section"
      className={styles.section}
      aria-label="阅读摘要"
    >
      <h2 className={styles.title}>阅读摘要</h2>
      <div className={styles.mainRow} data-testid="reading-summary-main">
        阅读 {summary.totalSessions} 篇 · 完成 {summary.completedSessions} 篇 · 解析{' '}
        {summary.completedResolved} 词
      </div>
      <div className={styles.subRow} data-testid="reading-summary-sub">
        近 7 天完成 {summary.last7dSessions} 篇 · en {summary.byLanguage.en} / de{' '}
        {summary.byLanguage.de}
      </div>
    </section>
  );
}
