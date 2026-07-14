/**
 * 今日推荐卡片 (Stage 3: 主页)
 *
 * 主 CTA, 展示 "今日学习单元" 的元信息, 点击后切到阅读页:
 * - 语言/难度: 优先取 `useReadingSessionStore.lastConfig`, 否则默认 en / L2
 * - "已完成" 状态由 HomePage 根据阅读会话进度派生
 *
 * 不依赖任何 LLM / 网络调用, 全部数据在本地 store 同步读取。
 */
import { useReadingSessionStore } from '../../reading/store/useReadingSessionStore';
import styles from './TodayCard.module.css';

export interface SessionStatus {
  newWordsDone: number;
  newWordsTarget: number;
  reviewsDone: number;
  reviewsTarget: number;
  dueCount: number;
}

interface TodayCardProps {
  onStart: () => void;
  sessionStatus: SessionStatus;
  newWordsCount?: number;
  /**
   * Stage 4 滚动揭示 className (来自 useScrollReveal). 可选, 透传到根元素.
   * 形如 'reveal' (initial) 或 'reveal revealVisible' (visible).
   */
  revealClassName?: string;
}

function resolveCopy(s: SessionStatus): { copy: string; isCompleted: boolean } {
  if (s.dueCount > 0) {
    return { copy: `今日待复习 ${s.dueCount} 词`, isCompleted: false };
  }
  if (s.newWordsDone < s.newWordsTarget) {
    return { copy: `今日新学 ${s.newWordsDone} 词, 目标 ${s.newWordsTarget}`, isCompleted: false };
  }
  if (s.reviewsTarget > 0 && s.reviewsDone < s.reviewsTarget) {
    return { copy: `今日已复习 ${s.reviewsDone} 词`, isCompleted: false };
  }
  if (
    s.newWordsDone >= s.newWordsTarget &&
    (s.reviewsTarget === 0 || s.reviewsDone >= s.reviewsTarget) &&
    s.dueCount === 0
  ) {
    return { copy: '今日学习已完成。点击继续阅读更多内容。', isCompleted: true };
  }
  return { copy: '今天从一次阅读开始。每个词都在它出现的语境里。', isCompleted: false };
}

export function TodayCard({
  onStart,
  sessionStatus,
  newWordsCount = 8,
  revealClassName,
}: TodayCardProps) {
  const lastConfig = useReadingSessionStore((s) => s.lastConfig);
  const language = lastConfig?.language ?? 'en';
  const difficulty = lastConfig?.difficulty ?? 2;
  const langLabel = language === 'en' ? '英语' : '德语';
  const minutes = 8;
  const rootClass = revealClassName
    ? `${styles.card} ${revealClassName}`
    : styles.card;
  const { copy, isCompleted } = resolveCopy(sessionStatus);
  return (
    <div className={rootClass}>
      <div className={styles.header}>
        <div className={styles.eyebrow}>今日推荐</div>
        <div className={styles.title}>
          {langLabel} · L{difficulty}
        </div>
      </div>
      <div className={styles.body}>
        <div className={styles.meta}>
          <span className={styles.metaItem}>约 {minutes} 分钟</span>
          <span className={styles.dot}>·</span>
          <span className={styles.metaItem}>新词 {newWordsCount}</span>
        </div>
        <p className={styles.copy}>{copy}</p>
      </div>
      <button className={styles.cta} onClick={onStart} type="button">
        {isCompleted ? '继续阅读' : '开始阅读'}
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          className={styles.arrow}
          aria-hidden="true"
        >
          <path
            d="M5 12h14M13 5l7 7-7 7"
            stroke="currentColor"
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
