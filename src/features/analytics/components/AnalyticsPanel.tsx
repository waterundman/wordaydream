import { useState } from 'react';
import { EmptyState } from '../../../components/EmptyState';
import styles from './AnalyticsPanel.module.css';

export function AnalyticsPanel() {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div
      className={`${styles.panel} ${isExpanded ? styles.expanded : ''}`}
      onClick={() => setIsExpanded(!isExpanded)}
    >
      <div className={styles.panelHeader}>
        <div className={styles.icon}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
        </div>
        <div className={styles.summary}>
          <div className={styles.total}>0</div>
          <div className={styles.label}>已学词汇</div>
        </div>
        <div className={styles.chevron}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>
      </div>

      <div className={`${styles.panelBody} ${isExpanded ? styles.bodyExpanded : ''}`}>
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
      </div>
    </div>
  );
}
