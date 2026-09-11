import { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import {
  useReviewSessionStore,
  resolveContextSentence,
} from '../store/useReviewSessionStore';
import { RatingBar } from './RatingBar';
import { EmptyState } from '../../../components/EmptyState';
import { useGlobalShortcuts } from '../../reading/hooks/useGlobalShortcuts';
import { useAppModeStore } from '../../../hooks/useAppModeStore';
import { useFocusTrap } from '../../../hooks/useFocusTrap';
import { useMemoryStore } from '../store/useMemoryStore';
import { useStreakStore } from '../../streak/store/useStreakStore';
import styles from './ReviewSessionPage.module.css';
import cardStyles from './ReviewCard.module.css';
import type { Rating, Language, MemoryCard } from '../../../types';

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

  // v0.8.0-harmony Stage 1: 评分键 (1-4 → again/hard/good/easy) 在复习会话作用域注册.
  // 触发条件: mode==='reviewing' (enabled) 且 showRatingBar && !isPaused (ratingEnabled)
  // 且焦点不在可编辑元素上 (useGlobalShortcuts 内部 isEditableTarget 守卫).
  // 评分路径与按钮 onClick 完全等价: 直接 completeReview(rating), 不新增 store action.
  const handleRate = useCallback(
    (rating: Rating) => {
      completeReview(rating);
      // v1.5.3 fix V4-P3-002: 设置新 timer 前先清旧 timer, 避免覆盖后泄漏.
      if (nextCardTimerRef.current !== null) {
        clearTimeout(nextCardTimerRef.current);
      }
      nextCardTimerRef.current = setTimeout(() => {
        nextCardTimerRef.current = null;
        nextCard();
      }, 50);
    },
    [completeReview, nextCard],
  );

  useGlobalShortcuts({
    enabled: mode === 'reviewing',
    ratingEnabled: showRatingBar && !isPaused,
    handlers: {
      onEscape: () => exitReview(),
      onRate: handleRate,
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

  // v2.2.3 Stage 3 (D3-2): statsLine 提取到 useMemo, 避免每次渲染重复 filter
  const stats = useMemo(() => {
    let correct = 0;
    let partial = 0;
    let wrong = 0;
    for (const r of results) {
      if (r.evaluation?.grade === 'correct') correct++;
      else if (r.evaluation?.grade === 'partial') partial++;
      else if (r.evaluation?.grade === 'wrong') wrong++;
    }
    return { correct, partial, wrong };
  }, [results]);

  // v2.2.3 Stage 3 (D3-2): 实时计时器 (替代每次渲染时 Date.now() - startedAt)
  // - startedAt > 0 时启动 1s interval, 卸载/startedAt 变化时 cleanup
  // - 立即设置一次初值, 避免 1s 内显示 0 秒
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!startedAt) {
      setElapsed(0);
      return;
    }
    setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

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
    return (
      <ReviewCompletedView
        onContinueReading={exitReview}
        onExit={() => {
          exitReview();
          useAppModeStore.getState().setMode('home');
        }}
      />
    );
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
          onRate={handleRate}
          onSkip={nextCard}
        />
      )}

      <footer className={styles.footer}>
        <div className={styles.statsLine}>
          <span className={styles.statItem}>
            答对 <strong>{stats.correct}</strong>
          </span>
          <span className={styles.statItem}>
            部分 <strong>{stats.partial}</strong>
          </span>
          <span className={styles.statItem}>
            错误 <strong>{stats.wrong}</strong>
          </span>
          {startedAt > 0 && (
            <span className={styles.statItem}>
              用时 <strong>{formatElapsed(elapsed)}</strong>
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
  language: Language;
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
          <p className={cardStyles.ratingHint}>评分可用数字键 1-4</p>
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
  const cardRef = useRef<HTMLDivElement>(null);
  // v2.2.4 Round 2 (D3-5): Tab 循环交给 useFocusTrap
  useFocusTrap(cardRef, true);

  // v2.2.4 Round 3 (R3-P1-001): 暂停态 ESC 应恢复复习, 而非退出整个会话.
  // 父级 useGlobalShortcuts 在 mode==='reviewing' 时监听 ESC -> exitReview(),
  // 会绕过暂停态的"恢复"语义. 这里用 capture 阶段优先拦截 + stopPropagation,
  // 让 ESC 触发 onResume 而不冒泡到 window.
  // v2.2.4 Round 4 (R4-P2-001): 仅当焦点在 pausedOverlay 内时才拦截,
  // 避免堆叠模态 (如 KeyboardShortcutsHelp) 打开时 ESC 被错误吞掉.
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const overlay = cardRef.current;
      if (overlay && overlay.contains(document.activeElement)) {
        e.stopPropagation();
        onResume();
      }
    };
    document.addEventListener('keydown', onEsc, true);
    return () => document.removeEventListener('keydown', onEsc, true);
  }, [onResume]);

  return (
    <div className={styles.pausedOverlay}>
      <div
        ref={cardRef}
        className={styles.pausedCard}
        role="dialog"
        aria-modal="true"
        aria-label="复习已暂停"
      >
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

function ReviewCompletedView({
  onContinueReading,
  onExit,
}: {
  onContinueReading: () => void;
  onExit: () => void;
}) {
  const results = useReviewSessionStore((s) => s.results);
  // v0.8.0-harmony Stage 2: completed 态下 queue 仍在会话内可读 (不持久化, 仅会话内存),
  // 用于按 results.cardId 反查错词的 MemoryCard (取 lemma / language 给错词回顾渲染).
  const queue = useReviewSessionStore((s) => s.queue);
  const cardContexts = useReviewSessionStore((s) => s.cardContexts);
  const language = useReviewSessionStore((s) => s.language);
  // v0.8.0-harmony Stage 2: streak 展示 (只读), 订阅当前连击天数.
  const currentStreak = useStreakStore((s) => s.currentStreak);
  // v2.1.0 Stage 1 (Contract 62): 订阅 previousMode, 决定渲染双 CTA 还是单按钮.
  // previousMode='reading' → 双 CTA (继续阅读 + 返回主页); 否则 → 单按钮 (返回主舞台).
  const previousMode = useAppModeStore((s) => s.previousMode);
  const showContinueReading = previousMode === 'reading';
  // v0.9.0 Stage 2: 完成页区块跳转 wordlist (错词本链接 / 到期前瞻) 共用 setMode.
  const setMode = useAppModeStore((s) => s.setMode);

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

  // v0.8.0-harmony Stage 2 (§3/§5): 错词回顾 (只读).
  // 数据: results 中 evaluation.grade==='wrong' 的条目, 按 answeredAt 倒序 (最近答错在前).
  // 反查: 按 result.cardId 在会话内 queue 中找 MemoryCard.
  // 防御处理: ReviewCardResult 仅含 cardId, 不含 lemma —— 若某 wrong 条目的 cardId
  // 在 queue 中找不到 (理论上不应发生; 最常见于页面刷新后 queue 被清空但 results 已持久化),
  // 则该条目无法取得 lemma 进行渲染, 直接跳过 (不渲染、不影响其余条目).
  // 注意 (v0.9.0 Stage 2 修正): 旧实现在 wrongReviewItems 全空时让区块整体消失, 造成
  // "计数说有错、区块却消失" 的不一致. 现区块渲染条件改为 hasWrong (见下方), 本处仅决定
  // 区块内是渲染列表还是刷新态提示行. 此处仍按防御逻辑跳过无法反查的条目.
  const wrongReviewItems = useMemo(() => {
    const byId = new Map<string, MemoryCard>();
    for (const card of queue) byId.set(card.id, card);
    const items: { cardId: string; card: MemoryCard; answeredAt: number }[] = [];
    for (const r of results) {
      if (r.evaluation?.grade !== 'wrong') continue;
      const card = byId.get(r.cardId);
      if (!card) continue; // 防御: 队列中找不到该 cardId, 跳过 (无 lemma 可渲染)
      items.push({ cardId: r.cardId, card, answeredAt: r.answeredAt });
    }
    items.sort((a, b) => b.answeredAt - a.answeredAt);
    return items;
  }, [results, queue]);

  // v0.9.0 Stage 2 (§3.4 收敛): 错词区块渲染条件从 "wrongReviewItems 非空" 升级为
  // "results 含 wrong 条目". 原因: 刷新态下 queue 被清空 → 反查失败 → wrongReviewItems
  // 为空, 但 results 仍含 wrong, 旧条件会让区块整体消失, 产生 "计数说有错、区块却消失"
  // 的不一致. 新条件保证区块始终渲染, 内容按 wrongReviewItems 是否非空分两态 (见 JSX).
  const hasWrong = useMemo(
    () => results.some((r) => r.evaluation?.grade === 'wrong'),
    [results],
  );

  // v0.8.0-harmony Stage 2 (§3/§5): 到期前瞻 (只读, 纯展示).
  // 口径实现说明 (SPEC 实现期锁定): 采用"累计口径", 与卡片页 dueCount 语义一致 ——
  //   明天 = getDueCards(undefined, now+1d) 中 due <= now+1d 的卡片数
  //         (含已过期/今天到期 + 未来 1 天内的到期)
  //   7 天 = getDueCards(undefined, now+7d) 中 due <= now+7d 的卡片数
  //         (含"明天口径"内的全部 + 第 2~7 天到期的, 即 7 天是 1 天的超集)
  // getDueCards 返回原样 MemoryCard[] (map key 即 lexemeGroupId, 已天然按词元组去重,
  // 无需再按 lexemeGroup 去重). 数字取整展示, 无点击交互.
  // 在 completed 态为静态快照, 仅挂载时计算一次 (deps=[]).
  const dueForecast = useMemo(() => {
    const now = Date.now();
    const tomorrow = useMemoryStore.getState().getDueCards(undefined, now + 86400e3).length;
    const next7 = useMemoryStore.getState().getDueCards(undefined, now + 7 * 86400e3).length;
    return { tomorrow, next7 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

        {hasWrong && (
          <section className={styles.completedWrongReview} aria-label="本次错词回顾">
            <p className={styles.completedSectionTitle}>本次错词回顾</p>
            {wrongReviewItems.length > 0 ? (
              <ul className={styles.completedWrongList}>
                {wrongReviewItems.map(({ cardId, card }) => (
                  <li key={cardId} className={styles.completedWrongItem}>
                    <div className={styles.completedWrongHead}>
                      <span className={styles.completedWrongLemma}>{card.lemma}</span>
                      <span className={styles.completedWrongLang}>
                        {card.language === 'de' ? '德语' : '英语'}
                      </span>
                    </div>
                    <p className={styles.completedWrongContext}>
                      {resolveContextSentence(card, language, cardContexts[card.id])}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              // 刷新态: queue 已清空, 反查失败 → 无错词明细可渲染, 给出 wordlist 跳转提示.
              <p className={styles.completedWrongRefreshHint}>
                刷新后本次错词明细不可用，历史错词见{' '}
                <button
                  type="button"
                  className={styles.completedWrongLink}
                  onClick={() => setMode('wordlist')}
                >
                  错词本
                </button>
              </p>
            )}
          </section>
        )}

        <section className={styles.completedDueForecast} aria-label="到期前瞻">
          <p className={styles.completedSectionTitle}>到期前瞻</p>
          <div className={styles.completedDueRow}>
            <button
              type="button"
              className={styles.completedDueItem}
              onClick={() => setMode('wordlist')}
            >
              明天到期 <strong>{dueForecast.tomorrow}</strong> 张
            </button>
            <button
              type="button"
              className={styles.completedDueItem}
              onClick={() => setMode('wordlist')}
            >
              未来 7 天到期 <strong>{dueForecast.next7}</strong> 张
            </button>
          </div>
        </section>

        <p className={styles.completedStreak}>
          连续学习 <strong>{currentStreak}</strong> 天
        </p>

        {showContinueReading ? (
          <div className={styles.completedActions}>
            <button
              type="button"
              className={`${styles.actionBtn} ${styles.primary} ${styles.completedExitBtn}`}
              onClick={onContinueReading}
            >
              继续阅读
            </button>
            <button
              type="button"
              className={`${styles.actionBtn} ${styles.completedExitBtn}`}
              onClick={onExit}
            >
              返回主页
            </button>
          </div>
        ) : (
          <button
            type="button"
            className={`${styles.actionBtn} ${styles.primary} ${styles.completedExitBtn}`}
            onClick={onExit}
          >
            返回主舞台
          </button>
        )}
      </main>
    </div>
  );
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`;
  const min = Math.floor(seconds / 60);
  const remSec = seconds % 60;
  return `${min} 分 ${remSec} 秒`;
}
