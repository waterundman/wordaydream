import { useEffect, useRef, useMemo } from 'react';
import {
  useReviewSessionStore,
  resolveContextSentence,
} from '../store/useReviewSessionStore';
import { RatingBar } from './RatingBar';
import { EmptyState } from '../../../components/EmptyState';
import { useGlobalShortcuts } from '../../reading/hooks/useGlobalShortcuts';
import styles from './ReviewSessionPage.module.css';
import cardStyles from './ReviewCard.module.css';
import type { Rating } from '../../../types';

export function ReviewSessionPage() {
  const {
    mode,
    language,
    queue,
    currentIndex,
    userAnswer,
    evaluation,
    isEvaluating,
    isPaused,
    showRatingBar,
    results,
    startedAt,
    cardContexts,
    setUserAnswer,
    submitAnswer,
    completeReview,
    nextCard,
    pauseReview,
    resumeReview,
    exitReview,
  } = useReviewSessionStore();

  useGlobalShortcuts({
    enabled: mode === 'reviewing',
    ratingEnabled: false,
    handlers: {
      onEscape: () => exitReview(),
    },
  });

  // v1.5.3 fix V3-P2-004: nextCard 延迟跳转的 setTimeout cleanup.
  // 之前 setTimeout(() => nextCard(), 50) 无 cleanup, 组件卸载后仍会触发,
  // 导致 React 卸载后 setState 警告 + 已退出会话的 currentIndex 被错误更新.
  const nextCardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (nextCardTimerRef.current !== null) {
        clearTimeout(nextCardTimerRef.current);
      }
    };
  }, []);

  // 兜底: 如果 mode === 'reviewing' 但队列为空, 退出
  useEffect(() => {
    if (mode === 'reviewing' && queue.length === 0) {
      exitReview();
    }
  }, [mode, queue.length, exitReview]);

  if (mode === 'idle') {
    return (
      <div className={styles.page}>
        <EmptyState
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <path d="M8 21h8" />
              <path d="M12 17v4" />
              <circle cx="9" cy="10" r="1" fill="currentColor" stroke="none" />
              <circle cx="15" cy="10" r="1" fill="currentColor" stroke="none" />
            </svg>
          }
          title="暂无可复习卡片"
          description="阅读文章并标注词汇，答对后它们会进入记忆库，待到复习周期时便可开始复习。"
          compact
        />
      </div>
    );
  }

  if (mode === 'completed') {
    return <ReviewCompletedView onExit={exitReview} />;
  }

  const card = queue[currentIndex];
  if (!card) {
    return null;
  }

  const recordedContext = cardContexts[card.id];
  const contextSentence = resolveContextSentence(card, language, recordedContext);
  const progressCurrent = Math.min(currentIndex + 1, queue.length);
  const progressTotal = queue.length;
  const progressPercent = progressTotal > 0
    ? Math.round((progressCurrent / progressTotal) * 100)
    : 0;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>复习模式</h1>
          <span className={styles.subtitle}>
            {language === 'de' ? '德语' : '英语'} · {queue.length} 个待复习词
          </span>
        </div>
        <div className={styles.headerRight}>
          {isPaused ? (
            <button
              className={`${styles.actionBtn} ${styles.primary}`}
              onClick={resumeReview}
              aria-label="继续复习"
            >
              继续
            </button>
          ) : (
            <button
              className={styles.actionBtn}
              onClick={pauseReview}
              aria-label="暂停复习"
            >
              暂停
            </button>
          )}
          <button
            className={`${styles.actionBtn} ${styles.exitBtn}`}
            onClick={exitReview}
            aria-label="退出复习"
          >
            退出
          </button>
        </div>
      </header>

      <div className={styles.progressBar} role="progressbar"
        aria-valuenow={progressPercent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="复习进度"
      >
        <div
          className={styles.progressFill}
          style={{ width: `${progressPercent}%` }}
        />
        <span className={styles.progressText}>
          {progressCurrent} / {progressTotal}
        </span>
      </div>

      {isPaused ? (
        <ReviewPausedView onResume={resumeReview} onExit={exitReview} />
      ) : (
        <ReviewCard
          cardId={card.lexemeGroupId}
          lemma={card.lemma}
          language={language}
          objectiveDifficulty={card.objectiveDifficulty}
          contextSentence={contextSentence}
          userAnswer={userAnswer}
          evaluation={evaluation}
          isEvaluating={isEvaluating}
          showRatingBar={showRatingBar}
          onAnswerChange={setUserAnswer}
          onSubmit={() => submitAnswer()}
          onRate={(rating: Rating) => {
            completeReview(rating);
            // v1.5.3 fix V4-P3-002: 设置新 timer 前先清旧 timer, 避免覆盖后泄漏.
            if (nextCardTimerRef.current !== null) {
              clearTimeout(nextCardTimerRef.current);
            }
            nextCardTimerRef.current = setTimeout(() => {
              nextCardTimerRef.current = null;
              nextCard();
            }, 50);
          }}
          onSkip={nextCard}
        />
      )}

      <footer className={styles.footer}>
        <div className={styles.statsLine}>
          <span className={styles.statItem}>
            答对 <strong>{results.filter((r) => r.evaluation?.grade === 'correct').length}</strong>
          </span>
          <span className={styles.statItem}>
            部分 <strong>{results.filter((r) => r.evaluation?.grade === 'partial').length}</strong>
          </span>
          <span className={styles.statItem}>
            错误 <strong>{results.filter((r) => r.evaluation?.grade === 'wrong').length}</strong>
          </span>
          {startedAt > 0 && (
            <span className={styles.statItem}>
              用时 <strong>{formatElapsed(Date.now() - startedAt)}</strong>
            </span>
          )}
        </div>
      </footer>
    </div>
  );
}

interface ReviewCardProps {
  cardId: string;
  lemma: string;
  language: 'en' | 'de';
  objectiveDifficulty: number;
  contextSentence: string;
  userAnswer: string;
  evaluation: import('../../../types').AnswerEvaluation | null;
  isEvaluating: boolean;
  showRatingBar: boolean;
  onAnswerChange: (answer: string) => void;
  onSubmit: () => void;
  onRate: (rating: Rating) => void;
  onSkip: () => void;
}

function ReviewCard({
  cardId,
  lemma,
  language,
  objectiveDifficulty,
  contextSentence,
  userAnswer,
  evaluation,
  isEvaluating,
  showRatingBar,
  onAnswerChange,
  onSubmit,
  onRate,
  onSkip,
}: ReviewCardProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [lemma]);

  const gradeClass = evaluation
    ? evaluation.grade === 'correct'
      ? cardStyles.gradeCorrect
      : evaluation.grade === 'partial'
      ? cardStyles.gradePartial
      : cardStyles.gradeWrong
    : '';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userAnswer.trim() || isEvaluating || evaluation) return;
    onSubmit();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!userAnswer.trim() || isEvaluating || evaluation) return;
      onSubmit();
    }
  };

  return (
    <article className={`${cardStyles.card} ${gradeClass}`}>
      <div className={cardStyles.cardHeader}>
        <div className={cardStyles.lemmaBlock}>
          <span className={cardStyles.lemmaLang}>
            {language === 'de' ? '德语' : '英语'}
          </span>
          <h2 className={cardStyles.lemma}>{lemma}</h2>
        </div>
        <div className={cardStyles.meta}>
          <span className={cardStyles.difficultyBadge}>
            Lv.{objectiveDifficulty}
          </span>
        </div>
      </div>

      <div className={cardStyles.contextBlock}>
        <p className={cardStyles.contextLabel}>上下文</p>
        <blockquote className={cardStyles.contextSentence}>
          {contextSentence}
        </blockquote>
      </div>

      <form className={cardStyles.form} onSubmit={handleSubmit}>
        <label className={cardStyles.inputLabel} htmlFor="review-answer">
          请输入中文释义
        </label>
        <div className={cardStyles.inputRow}>
          <input
            id="review-answer"
            ref={inputRef}
            type="text"
            value={userAnswer}
            onChange={(e) => onAnswerChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="例如: 革命、破旧的..."
            className={cardStyles.input}
            disabled={isEvaluating || !!evaluation}
            autoComplete="off"
            spellCheck={false}
            aria-label="中文释义输入"
          />
          <button
            type="submit"
            className={cardStyles.submitBtn}
            disabled={!userAnswer.trim() || isEvaluating || !!evaluation}
          >
            {isEvaluating ? '判题中...' : '确认'}
          </button>
        </div>

        {evaluation && (
          <div className={`${cardStyles.feedback} ${cardStyles[evaluation.grade]}`}>
            <p className={cardStyles.feedbackText}>{evaluation.feedback}</p>
            {evaluation.hint && evaluation.grade !== 'correct' && (
              <p className={cardStyles.hint}>{evaluation.hint}</p>
            )}
          </div>
        )}
      </form>

      {showRatingBar && evaluation && (
        <div className={cardStyles.ratingBlock}>
          <RatingBar
            cardId={cardId}
            onRate={onRate}
          />
        </div>
      )}

      {evaluation && (
        <div className={cardStyles.cardActions}>
          <button
            type="button"
            className={cardStyles.skipBtn}
            onClick={onSkip}
            aria-label="跳过到下一张"
          >
            下一张 →
          </button>
        </div>
      )}
    </article>
  );
}

function ReviewPausedView({ onResume, onExit }: { onResume: () => void; onExit: () => void }) {
  return (
    <div className={styles.pausedOverlay} role="dialog" aria-label="复习已暂停">
      <div className={styles.pausedCard}>
        <p className={styles.pausedTitle}>已暂停</p>
        <p className={styles.pausedHint}>按 Esc 或点击"继续"恢复复习</p>
        <div className={styles.pausedActions}>
          <button
            type="button"
            className={`${styles.actionBtn} ${styles.primary}`}
            onClick={onResume}
          >
            继续
          </button>
          <button
            type="button"
            className={`${styles.actionBtn} ${styles.exitBtn}`}
            onClick={onExit}
          >
            退出
          </button>
        </div>
      </div>
    </div>
  );
}

function ReviewCompletedView({ onExit }: { onExit: () => void }) {
  const results = useReviewSessionStore((s) => s.results);

  // v1.5.3 fix V4-P3-004: 从订阅的 results 派生 stats, 不再调 getState().getStats().
  // 之前 getState() 非响应式 + getStats() 每次返回新对象, 导致 useMemo 永远失效.
  const summary = useMemo(() => {
    const stats = { total: 0, correct: 0, partial: 0, wrong: 0, again: 0, hard: 0, good: 0, easy: 0, accuracy: 0 };
    for (const r of results) {
      if (r.evaluation) {
        if (r.evaluation.grade === 'correct') stats.correct++;
        else if (r.evaluation.grade === 'partial') stats.partial++;
        else stats.wrong++;
      }
      if (r.rating) {
        stats[r.rating]++;
      }
    }
    stats.total = results.length;
    stats.accuracy = stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0;
    return stats;
  }, [results]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>复习完成</h1>
          <span className={styles.subtitle}>所有待复习词已处理</span>
        </div>
      </header>

      <main className={styles.completedMain}>
        <div className={styles.completedHero}>
          <p className={styles.completedNumber}>{summary.total}</p>
          <p className={styles.completedNumberLabel}>本次复习词数</p>
        </div>

        <div className={styles.completedGrid}>
          <div className={`${styles.completedStat} ${styles.completedCorrect}`}>
            <span className={styles.completedStatValue}>{summary.correct}</span>
            <span className={styles.completedStatLabel}>答对</span>
          </div>
          <div className={`${styles.completedStat} ${styles.completedPartial}`}>
            <span className={styles.completedStatValue}>{summary.partial}</span>
            <span className={styles.completedStatLabel}>部分</span>
          </div>
          <div className={`${styles.completedStat} ${styles.completedWrong}`}>
            <span className={styles.completedStatValue}>{summary.wrong}</span>
            <span className={styles.completedStatLabel}>错误</span>
          </div>
          <div className={styles.completedStat}>
            <span className={styles.completedStatValue}>{summary.accuracy}%</span>
            <span className={styles.completedStatLabel}>正确率</span>
          </div>
        </div>

        <div className={styles.completedRatings}>
          <p className={styles.completedRatingsTitle}>评分分布</p>
          <div className={styles.completedRatingsRow}>
            <span className={styles.completedRatingChip}>
              重来 <strong>{summary.again}</strong>
            </span>
            <span className={styles.completedRatingChip}>
              良好 <strong>{summary.good}</strong>
            </span>
            <span className={styles.completedRatingChip}>
              简单 <strong>{summary.easy}</strong>
            </span>
          </div>
        </div>

        <button
          type="button"
          className={`${styles.actionBtn} ${styles.primary} ${styles.completedExitBtn}`}
          onClick={onExit}
        >
          返回主舞台
        </button>
      </main>
    </div>
  );
}

function formatElapsed(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec} 秒`;
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  return `${min} 分 ${remSec} 秒`;
}
