import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { useMemoryStore } from '../store/useMemoryStore';
import { isEditableTarget } from '../../reading/hooks/useGlobalShortcuts';
import styles from './RatingBar.module.css';
import type { Rating } from '../../../types';

interface Props {
  cardId: string;
  onRate: (rating: Rating) => void;
}

const SHORT_LABEL: Record<Rating, string> = {
  again: '重来',
  hard: '困难',
  good: '良好',
  easy: '简单',
};

const RATING_ORDER: Rating[] = ['again', 'hard', 'good', 'easy'];
const SHORTCUT_KEY: Record<Rating, string> = {
  again: '1',
  hard: '2',
  good: '3',
  easy: '4',
};

function formatInterval(dueMs: number, now: number = Date.now()): string {
  const diff = Math.max(0, dueMs - now);
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return '< 1 分钟';
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} 天`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} 月`;
  return `${Math.round(months / 12)} 年`;
}

export function RatingBar({ cardId, onRate }: Props) {
  const getRatingPreviews = useMemoryStore((s) => s.getRatingPreviews);
  const previews = useMemo(() => getRatingPreviews(cardId), [cardId, getRatingPreviews]);
  const [focusedIndex, setFocusedIndex] = useState(2);
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    setFocusedIndex(2);
  }, [cardId]);

  useEffect(() => {
    btnRefs.current[focusedIndex]?.focus();
  }, [focusedIndex]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // 1-4 评分键已统一由会话作用域的 useGlobalShortcuts 处理,
      // 这里仅负责评分栏内部的焦点导航 (←/→ 移动, Enter/Space 评分当前聚焦项),
      // 避免在 window 上重复监听导致 completeReview 被触发两次.
      // 可编辑目标 (输入框等) 内忽略导航键, 交还浏览器默认行为.
      if (isEditableTarget(e.target)) return;

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setFocusedIndex((prev) => Math.max(0, prev - 1));
        return;
      }

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setFocusedIndex((prev) => Math.min(RATING_ORDER.length - 1, prev + 1));
        return;
      }

      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onRate(RATING_ORDER[focusedIndex]);
        return;
      }
    },
    [focusedIndex, onRate]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // v1.5.3 fix V4-P3-008: getRatingPreviews 可能返回 null (卡片不存在).
  if (!previews) return null;

  return (
    <div>
      <p className={styles.title}>这次记忆得如何？选择后会重新安排下次复现时间。</p>
      <div className={styles.bar} role="group" aria-label="评分">
        {RATING_ORDER.map((rating, index) => {
          const preview = previews[rating];
          if (!preview) return null;
          const isFocused = index === focusedIndex;
          return (
            <button
              key={rating}
              ref={(el) => { btnRefs.current[index] = el; }}
              className={`${styles.btn} ${isFocused ? styles.focused : ''}`}
              onClick={() => onRate(rating)}
              onMouseEnter={() => setFocusedIndex(index)}
              tabIndex={isFocused ? 0 : -1}
              aria-label={`${SHORT_LABEL[rating]} - ${formatInterval(preview.nextReviewAt)}`}
            >
              <span className={`${styles.label} ${styles[rating]}`}>{SHORT_LABEL[rating]}</span>
              <span className={styles.preview}>{formatInterval(preview.nextReviewAt)}</span>
              <span className={styles.shortcut}>{SHORTCUT_KEY[rating]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
