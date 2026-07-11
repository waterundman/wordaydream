import { useEffect, useState, useRef, useMemo } from 'react';
import { useMemoryStore } from '../store/useMemoryStore';
import { EmptyState } from '../../../components/EmptyState';
import { ExportButton } from './ExportButton';
import styles from './MemoryTray.module.css';
import type { MemoryCard } from '../../../types';

interface MemoryTrayProps {
  onGoReading?: () => void;
}

export function MemoryTray({ onGoReading }: MemoryTrayProps) {
  const cards = useMemoryStore((state) => state.cards);
  const newlyAddedIds = useMemoryStore((state) => state.newlyAdded);
  const clearNewlyAdded = useMemoryStore((state) => state.clearNewlyAdded);
  const [isVisible, setIsVisible] = useState(false);
  const prevLengthRef = useRef(0);

  const newlyAdded: MemoryCard[] = newlyAddedIds
    .map((id) => cards.get(id))
    .filter((c): c is MemoryCard => c !== undefined);
  const totalCount = cards.size;

  // v1.5.3 fix V3-P2-001: 用真实 FSRS 状态计算统计, 替代硬编码 0.7/0.3 假数据.
  // learning: new/learning/relearning 态 (未进入稳定复习)
  // mastered: review 态且 reps >= 2 (至少复习过 2 次, 视为初步掌握)
  const stats = useMemo(() => {
    let learning = 0;
    let mastered = 0;
    for (const card of cards.values()) {
      // v1.5.3 fix V4-P3-001: review && reps < 2 归入 learning, 保证 learning + mastered = totalCount.
      if (card.status === 'new' || card.status === 'learning' || card.status === 'relearning') {
        learning++;
      } else if (card.status === 'review') {
        if (card.reps >= 2) {
          mastered++;
        } else {
          learning++;
        }
      }
    }
    return { learning, mastered };
  }, [cards]);

  useEffect(() => {
    if (newlyAdded.length > 0 && newlyAdded.length > prevLengthRef.current) {
      setIsVisible(true);
      const timer = setTimeout(() => {
        setIsVisible(false);
        setTimeout(clearNewlyAdded, 500);
      }, 5000);
      prevLengthRef.current = newlyAdded.length;
      return () => clearTimeout(timer);
    }
    prevLengthRef.current = newlyAdded.length;
  }, [newlyAdded.length, clearNewlyAdded]);

  const formatDueDate = (due: number) => {
    const now = Date.now();
    const diff = due - now;
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    if (days <= 0) return '今天复习';
    if (days === 1) return '明天复习';
    if (days < 7) return `${days}天后复习`;
    const weeks = Math.floor(days / 7);
    if (weeks < 4) return `${weeks}周后复习`;
    const months = Math.floor(days / 30);
    return `${months}个月后复习`;
  };

  if (totalCount === 0 && newlyAdded.length === 0) {
    return (
      <div className={styles.empty}>
        <EmptyState
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 9h18" />
              <path d="M9 21V9" />
              <circle cx="14" cy="14" r="1" fill="currentColor" stroke="none" />
              <circle cx="18" cy="14" r="1" fill="currentColor" stroke="none" />
            </svg>
          }
          title="记忆库空空如也"
          description="阅读文章时点击标注词汇，答对后它们会进入你的记忆库，等待下次复现。"
          action={
            onGoReading
              ? {
                  label: '去阅读',
                  onClick: onGoReading,
                }
              : undefined
          }
          compact
        />
      </div>
    );
  }

  return (
    <div className={styles.tray}>
      <div className={styles.header}>
        <h3 className={styles.title}>记忆库</h3>
        <span className={styles.count}>{totalCount} 个词汇</span>
        <ExportButton />
      </div>

      <div
        className={`${styles.newCards} ${isVisible ? styles.visible : ''}`}
      >
        {newlyAdded.length > 0 && (
          <>
            <p className={styles.newLabel}>
              新增 {newlyAdded.length} 个词汇
            </p>
            <div className={styles.cardList}>
              {newlyAdded.slice(0, 3).map((card) => (
                <div key={card.id} className={styles.cardItem}>
                  <span className={styles.word}>{card.lemma}</span>
                  <span className={styles.due}>{formatDueDate(card.due)}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div className={styles.stats}>
        <div className={styles.statItem}>
          <span className={styles.statValue}>{totalCount}</span>
          <span className={styles.statLabel}>总数</span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statValue}>{stats.learning}</span>
          <span className={styles.statLabel}>学习中</span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statValue}>{stats.mastered}</span>
          <span className={styles.statLabel}>已掌握</span>
        </div>
      </div>
    </div>
  );
}
