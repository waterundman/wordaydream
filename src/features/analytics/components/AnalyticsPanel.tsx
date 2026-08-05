import { useState } from 'react';
import { EmptyState } from '../../../components/EmptyState';
import { useHomeAnalytics } from '../hooks/useHomeAnalytics';
import styles from './AnalyticsPanel.module.css';

/**
 * 阅读页侧边栏分析面板
 *
 * "已学词汇" 数字 = useMemoryStore.cards.size (每张卡片对应用户答对过的一个词)
 * 展开后显示各 FSRS 状态分布 (new/learning/review/relearning)
 */
export function AnalyticsPanel() {
  const [isExpanded, setIsExpanded] = useState(false);
  const { total, byStatus, mastered } = useHomeAnalytics();

  // 状态分布条形图数据 (顺序: learning → review → relearning → new)
  const maxCount = Math.max(byStatus.learning, byStatus.review, byStatus.relearning, byStatus.new, 1);
  const distribution = [
    { label: '学', count: byStatus.learning, className: styles.fillLearning },
    { label: '复', count: byStatus.review, className: styles.fillReview },
    { label: '重', count: byStatus.relearning, className: styles.fillRelearning },
    { label: '新', count: byStatus.new, className: styles.fillNew },
  ];

  return (
    <div className={`${styles.panel} ${isExpanded ? styles.expanded : ''}`}>
      <button
        type="button"
        className={styles.panelHeader}
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
        aria-controls="analytics-panel-body"
      >
        <div className={styles.icon}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
        </div>
        <div className={styles.summary}>
          <div className={styles.total}>{total}</div>
          <div className={styles.label}>已学词汇</div>
        </div>
        <div className={styles.chevron}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>
      </button>

      <div
        id="analytics-panel-body"
        className={`${styles.panelBody} ${isExpanded ? styles.bodyExpanded : ''}`}
      >
        {total === 0 ? (
          <div className={styles.emptyBody}>
            <EmptyState
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 3v18h18" />
                  <path d="M7 16l4-4 4 4 5-6" />
                  <circle cx="3" cy="3" r="1" fill="currentColor" stroke="none" />
                </svg>
              }
              title="暂无学习数据"
              description="开始阅读并标注词汇，数据会在这里汇聚成学习轨迹。"
              compact
            />
          </div>
        ) : (
          <div className={styles.section}>
            <div className={styles.metricsGrid}>
              <div className={styles.metric}>
                <div className={styles.metricValue}>{mastered}</div>
                <div className={styles.metricLabel}>已掌握</div>
              </div>
              <div className={styles.metric}>
                <div className={styles.metricValue}>{total - mastered}</div>
                <div className={styles.metricLabel}>学习中</div>
              </div>
            </div>
            <div className={styles.section}>
              <div className={styles.sectionTitle}>状态分布</div>
              <div className={styles.distribution}>
                {distribution.map((item) => (
                  <div className={styles.distributionItem} key={item.label}>
                    <span className={styles.distributionLabel}>{item.label}</span>
                    <div className={styles.distributionBar}>
                      <div
                        className={`${styles.distributionFill} ${item.className}`}
                        style={{
                          transform: `scaleX(${item.count / maxCount})`,
                        }}
                      />
                    </div>
                    <span className={styles.distributionCount}>{item.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
