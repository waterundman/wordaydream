import { useEffect, useState } from 'react';
import { useMemoryStore } from '../store/useMemoryStore';
import { useReviewSessionStore } from '../store/useReviewSessionStore';
import { subscribe, type MemoryCardsUpdatedPayload } from '../../../domain/events';
import styles from './ReviewPromptBanner.module.css';
import type { Language } from '../../../types';

interface Props {
  language: Language;
  onGenerate: () => void;
}

export function ReviewPromptBanner({ language, onGenerate }: Props) {
  const getDueCards = useMemoryStore((s) => s.getDueCards);
  const startReview = useReviewSessionStore((s) => s.startReview);
  const [dueCount, setDueCount] = useState(0);

  useEffect(() => {
    setDueCount(getDueCards(language).length);
    const unsubscribe = subscribe<MemoryCardsUpdatedPayload>('memory:cards-updated', () => {
      setDueCount(getDueCards(language).length);
    });
    return () => {
      unsubscribe();
    };
  }, [language, getDueCards]);

  // 无复现词时仅显示 1px 提示线，不占垂直空间
  if (dueCount === 0) {
    return (
      <div className={styles.hintLine} aria-label="当前无待复现词汇">
        <button
          type="button"
          className={styles.hintAction}
          onClick={onGenerate}
        >
          积累中 · 换一篇
        </button>
      </div>
    );
  }

  return (
    <div className={styles.banner}>
      <div className={styles.text}>
        <svg
          className={styles.icon}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M23 4v6h-6" />
          <path d="M1 20v-6h6" />
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
        <span>
          今日待复现 <span className={styles.count}>{dueCount}</span> 个已学词汇
        </span>
      </div>
      <button
        className={styles.btn}
        onClick={() => startReview(language)}
      >
        开始复习
      </button>
    </div>
  );
}
