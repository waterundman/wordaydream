import { useState } from 'react';
import { useReadingHistoryStore } from '../store/useReadingHistoryStore';
import { EmptyState } from '../../../components/EmptyState';
import styles from './ReadingHistoryPanel.module.css';
import type { HistoryEntry } from '../store/useReadingHistoryStore';

interface ReadingHistoryPanelProps {
  onReRead: (entry: HistoryEntry) => void;
}

export function ReadingHistoryPanel({ onReRead }: ReadingHistoryPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const history = useReadingHistoryStore((state) => state.history);
  const removeEntry = useReadingHistoryStore((state) => state.removeEntry);

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (days === 0) return '今天';
    if (days === 1) return '昨天';
    if (days < 7) return `${days}天前`;
    return `${date.getMonth() + 1}/${date.getDate()}`;
  };

  const getLanguageLabel = (language: string) => {
    return language === 'en' ? '英语' : '德语';
  };

  const getDifficultyLabel = (level: number) => `L${level}`;

  const getProgress = (resolved: number, total: number) => {
    return total > 0 ? Math.round((resolved / total) * 100) : 0;
  };

  if (history.length === 0) {
    return (
      <div className={styles.panel}>
        <EmptyState
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
          }
          title="暂无阅读历史"
          description="阅读文章后，记录会保存在这里，方便你随时回顾。"
          compact
        />
      </div>
    );
  }

  return (
    <div className={`${styles.panel} ${isExpanded ? styles.expanded : ''}`}>
      <button
        type="button"
        className={styles.panelHeader}
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
      >
        <div className={styles.icon}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
        </div>
        <div className={styles.summary}>
          <div className={styles.total}>{history.length}</div>
          <div className={styles.label}>阅读历史</div>
        </div>
        <div className={styles.chevron}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>
      </button>

      <div className={`${styles.panelBody} ${isExpanded ? styles.bodyExpanded : ''}`}>
        <div className={styles.historyList}>
          {history.map((entry) => (
            <div key={entry.id} className={styles.historyItem}>
              <div className={styles.historyInfo}>
                <div className={styles.historyTitle}>
                  {entry.passage.title || '无标题文章'}
                </div>
                <div className={styles.historyMeta}>
                  <span className={styles.metaItem}>{getLanguageLabel(entry.language)}</span>
                  <span className={styles.metaItem}>{getDifficultyLabel(entry.difficulty)}</span>
                  <span className={styles.metaItem}>{formatDate(entry.startedAt)}</span>
                </div>
                <div className={styles.progressBar}>
                  <div
                    className={styles.progressFill}
                    style={{ width: `${getProgress(entry.resolvedCount, entry.totalTokenCount)}%` }}
                  />
                </div>
                <div className={styles.progressText}>
                  {entry.resolvedCount}/{entry.totalTokenCount} 已解析
                </div>
              </div>
              <div className={styles.historyActions}>
                <button
                  className={styles.actionButton}
                  onClick={(e) => {
                    e.stopPropagation();
                    onReRead(entry);
                  }}
                  aria-label="重新阅读"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    <path d="M21 3v5h-5" />
                  </svg>
                </button>
                <button
                  className={styles.actionButton}
                  onClick={(e) => {
                    e.stopPropagation();
                    removeEntry(entry.id);
                  }}
                  aria-label="删除记录"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M3 6h18" />
                    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}