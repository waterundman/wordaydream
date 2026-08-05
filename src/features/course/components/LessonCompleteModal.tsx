/**
 * v2.3.0 Stage 5 — LessonCompleteModal
 *
 * 课时完成反馈弹窗 (自包含组件).
 *
 * 触发条件 (STAGE CONTRACT):
 * - useCourseStore.lessonProgress[currentLessonId].status === 'completed'
 * - 且本会话内未展示过 (用 useRef 标记 shownRef, 记录已弹出的 lessonId)
 *
 * 行为:
 * - 弹出时展示 '课时完成' + lesson.title + 统计 (遇到 X 词 / 学会 Y 词 / 正确率 Z%)
 * - 调用 unlockNext(currentLessonId) 解锁下一课:
 *   - 返回非 null → 显示 '下一课' 按钮 (startLesson(nextId) + 关闭)
 *   - 返回 null    → 显示 '返回课程' 按钮 (关闭 + 跳转 '#/course')
 * - 点击 modal 外部不关闭, ESC 不关闭 (必须点按钮)
 * - 关闭后不再自动弹出 (shownRef 标记)
 *
 * 设计约束:
 * - 无 emoji
 * - 配色用 tokens.css 变量 (warm white + dark ink)
 * - prefers-reduced-motion 降级 (见 .module.css)
 */
import { useEffect, useRef, useState } from 'react';
import { useCourseStore } from '../store/useCourseStore';
import styles from './LessonCompleteModal.module.css';

export function LessonCompleteModal() {
  const currentLessonId = useCourseStore((s) => s.currentLessonId);
  const lessonProgress = useCourseStore((s) => s.lessonProgress);
  const getCurrentLesson = useCourseStore((s) => s.getCurrentLesson);
  const unlockNext = useCourseStore((s) => s.unlockNext);
  const startLesson = useCourseStore((s) => s.startLesson);

  // 本会话已展示过的 lessonId (防止同一课时重复弹出)
  const shownRef = useRef<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  // unlockNext 的结果: undefined=尚未判定, string=下一课 id, null=无下一课
  const [nextLessonId, setNextLessonId] = useState<string | null | undefined>(undefined);
  // 确保 unlockNext 每次 open 只调用一次 (避免重复解锁副作用)
  const unlockCalledRef = useRef(false);

  const status = currentLessonId ? lessonProgress[currentLessonId]?.status : undefined;

  // 监听 status === 'completed' → 弹出 modal (本会话仅一次)
  useEffect(() => {
    if (!currentLessonId) return;
    if (status !== 'completed') return;
    if (shownRef.current === currentLessonId) return;
    shownRef.current = currentLessonId;
    setIsOpen(true);
  }, [status, currentLessonId]);

  // modal 打开时调用 unlockNext 解锁下一课 (副作用: 设置下一课 available),
  // 返回值决定显示 '下一课' 或 '返回课程' 按钮.
  useEffect(() => {
    if (!isOpen || !currentLessonId) return;
    if (unlockCalledRef.current) return;
    unlockCalledRef.current = true;
    const nextId = unlockNext(currentLessonId);
    setNextLessonId(nextId);
  }, [isOpen, currentLessonId, unlockNext]);

  const handleClose = () => {
    setIsOpen(false);
    // 重置 unlock 标记, 允许下次打开时重新判定
    unlockCalledRef.current = false;
  };

  if (!isOpen || !currentLessonId) return null;

  const current = getCurrentLesson();
  if (!current) return null;
  const { lesson } = current;
  const progress = lessonProgress[currentLessonId];
  if (!progress) return null;

  const encountered = progress.wordsEncountered.length;
  const learned = progress.wordsLearned.length;
  const accuracy =
    progress.reviewTotalCount > 0
      ? Math.round((progress.reviewCorrectCount / progress.reviewTotalCount) * 100) + '%'
      : 'N/A';

  const handleNextLesson = () => {
    if (nextLessonId) {
      startLesson(nextLessonId);
    }
    handleClose();
  };

  const handleBackToCourse = () => {
    handleClose();
    window.location.hash = '#/course';
  };

  // hasNext: unlockNext 已判定且返回非 null
  const hasNext = nextLessonId !== null && nextLessonId !== undefined;

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="lesson-complete-title"
      data-testid="lesson-complete-modal"
    >
      <div className={styles.card}>
        <h2 id="lesson-complete-title" className={styles.title}>
          课时完成
        </h2>
        <p className={styles.lessonTitle}>{lesson.title}</p>
        <div className={styles.stats}>
          <p className={styles.stat} data-testid="stat-encountered">
            遇到 <span className={styles.statNum}>{encountered}</span> 词
          </p>
          <p className={styles.stat} data-testid="stat-learned">
            学会 <span className={styles.statNum}>{learned}</span> 词
          </p>
          <p className={styles.stat} data-testid="stat-accuracy">
            正确率 <span className={styles.statNum}>{accuracy}</span>
          </p>
        </div>
        <div className={styles.actions}>
          {hasNext ? (
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={handleNextLesson}
              data-testid="lesson-complete-next"
            >
              下一课
            </button>
          ) : (
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={handleBackToCourse}
              data-testid="lesson-complete-back"
            >
              返回课程
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
