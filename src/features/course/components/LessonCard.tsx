/**
 * v2.3.0 Stage 4 — LessonCard
 *
 * 单个课时卡片: 展示 title + theme 文字标签 + 进度条 + status badge.
 *
 * 状态变体:
 * - 'locked': 灰色 + 不可点击 + 显示 "Locked"
 * - 'available': 正常颜色 + 可点击 + 显示 "Start"
 * - 'in-progress': 高亮 + 可点击 + 显示 "Continue" + 进度条
 * - 'completed': 绿色边框 + 可点击 (复习) + 显示 "Review"
 *
 * 点击 'available'/'in-progress'/'completed' 触发 onStartLesson(lesson.id).
 *
 * 设计约束:
 * - 无 emoji (status 用文字 badge)
 * - 配色用 tokens.css 变量
 * - 进度条 CSS 实现 (无第三方库)
 * - prefers-reduced-motion 降级 (见 .module.css)
 */
import type { Lesson } from '../types';
import type { LessonProgress } from '../store/useCourseStore';
import styles from './LessonCard.module.css';

interface LessonCardProps {
  lesson: Lesson;
  progress: LessonProgress;
  onStartLesson: (lessonId: string) => void;
}

/** Status badge 文案 (无 emoji) */
function statusLabel(status: LessonProgress['status']): string {
  switch (status) {
    case 'locked':
      return 'Locked';
    case 'available':
      return 'Start';
    case 'in-progress':
      return 'Continue';
    case 'completed':
      return 'Review';
  }
}

/** 根据 status 拼接 className */
function cardClass(status: LessonProgress['status']): string {
  const base = styles.card;
  switch (status) {
    case 'locked':
      return `${base} ${styles.locked}`;
    case 'available':
      return base;
    case 'in-progress':
      return `${base} ${styles.inProgress}`;
    case 'completed':
      return `${base} ${styles.completed}`;
  }
}

/** 根据 status 拼接 badge className */
function badgeClass(status: LessonProgress['status']): string {
  switch (status) {
    case 'locked':
      return `${styles.badge} ${styles.badgeLocked}`;
    case 'available':
      return `${styles.badge} ${styles.badgeAvailable}`;
    case 'in-progress':
      return `${styles.badge} ${styles.badgeInProgress}`;
    case 'completed':
      return `${styles.badge} ${styles.badgeCompleted}`;
  }
}

export function LessonCard({ lesson, progress, onStartLesson }: LessonCardProps) {
  const { status, wordsEncountered } = progress;
  const total = lesson.targetLemmas.length;
  const encountered = wordsEncountered.length;
  const ratio = total > 0 ? Math.min(1, encountered / total) : 0;
  const isLocked = status === 'locked';

  const handleClick = () => {
    if (isLocked) return;
    onStartLesson(lesson.id);
  };

  return (
    <button
      type="button"
      className={cardClass(status)}
      onClick={handleClick}
      disabled={isLocked}
      aria-disabled={isLocked}
      aria-label={`${lesson.title} — ${statusLabel(status)}`}
      data-testid={`lesson-card-${lesson.id}`}
      data-status={status}
    >
      <div className={styles.info}>
        <span className={styles.title}>{lesson.title}</span>
        <span className={styles.theme}>{lesson.theme}</span>
      </div>
      <div className={styles.meta}>
        {status !== 'available' && (
          <>
            <div
              className={styles.progressTrack}
              role="progressbar"
              aria-valuenow={encountered}
              aria-valuemin={0}
              aria-valuemax={total}
              aria-label={`${encountered} of ${total} words encountered`}
            >
              <div
                className={styles.progressFill}
                style={{ transform: `scaleX(${ratio})` }}
              />
            </div>
            <span className={styles.progressLabel}>
              {encountered}/{total}
            </span>
          </>
        )}
        <span className={badgeClass(status)}>{statusLabel(status)}</span>
      </div>
    </button>
  );
}
