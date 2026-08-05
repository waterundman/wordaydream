/**
 * v2.3.0 Stage 5 — CurrentLessonCard
 *
 * 首页当前课时卡片.
 *
 * 两种状态:
 * - 有 currentLesson (currentLessonId 非空 + getCurrentLesson() 命中):
 *   - 展示 lesson.title + Module.title (如 'English A1 — Beginner > Playing in the Park')
 *   - 进度环: wordsLearned.length / targetLemmas.length (CSS conic-gradient)
 *   - 按钮 '继续学习' → loadSession(language, difficulty, currentLessonId)
 *     (loadSession 内部已修复: lessonId 非空时自动取 lesson.targetLemmas 注入 prompt)
 *   - 按钮 '查看课程' → 跳转 '#/course'
 * - 无 currentLesson:
 *   - 展示 '选择课程' CTA
 *   - 按钮 '浏览课程' → 跳转 '#/course'
 *
 * 设计约束:
 * - 无 emoji
 * - 配色用 tokens.css 变量 (warm white + dark ink)
 * - prefers-reduced-motion 降级 (见 .module.css)
 */
import type { CSSProperties } from 'react';
import { useCourseStore } from '../course/store/useCourseStore';
import { useSettingsStore } from '../settings/store/useSettingsStore';
import { useReadingSessionStore } from '../reading/store/useReadingSessionStore';
import styles from './CurrentLessonCard.module.css';

export function CurrentLessonCard() {
  const currentLessonId = useCourseStore((s) => s.currentLessonId);
  const getCurrentLesson = useCourseStore((s) => s.getCurrentLesson);
  const lessonProgress = useCourseStore((s) => s.lessonProgress);
  const difficulty = useSettingsStore((s) => s.difficulty);
  const language = useReadingSessionStore((s) => s.lastConfig?.language) ?? 'en';
  const loadSession = useReadingSessionStore((s) => s.loadSession);

  const goToCourse = () => {
    window.location.hash = '#/course';
  };

  const current = getCurrentLesson();

  // 无 currentLesson: 展示选择课程 CTA
  if (!currentLessonId || !current) {
    return (
      <section className={styles.card} data-testid="current-lesson-card">
        <div className={styles.emptyInfo}>
          <span className={styles.eyebrow}>课程</span>
          <h2 className={styles.emptyTitle}>选择课程</h2>
          <p className={styles.emptyCopy}>挑选一门课程, 按顺序解锁课时, 系统化地学习词汇.</p>
        </div>
        <div className={styles.emptyActions}>
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={goToCourse}
            data-testid="current-lesson-browse"
          >
            浏览课程
          </button>
        </div>
      </section>
    );
  }

  const { module, lesson } = current;
  const progress = lessonProgress[currentLessonId];
  const learned = progress?.wordsLearned.length ?? 0;
  const total = lesson.targetLemmas.length;
  const ratio = total > 0 ? Math.min(1, learned / total) : 0;
  const pct = Math.round(ratio * 100);

  const handleContinue = () => {
    void loadSession(language, difficulty, currentLessonId);
  };

  return (
    <section className={styles.card} data-testid="current-lesson-card">
      <div className={styles.info}>
        <span className={styles.eyebrow}>{module.title}</span>
        <h2 className={styles.lessonTitle}>{lesson.title}</h2>
        <p className={styles.moduleTitle}>
          {module.title} &gt; {lesson.title}
        </p>
      </div>
      <div className={styles.body}>
        <div
          className={styles.progressRing}
          style={{ '--progress': ratio } as CSSProperties}
          role="progressbar"
          aria-valuenow={learned}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-label={`已学会 ${learned} / ${total} 词`}
          data-testid="current-lesson-progress-ring"
        >
          <div className={styles.progressInner}>
            <span className={styles.progressPct}>{pct}%</span>
          </div>
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={handleContinue}
            data-testid="current-lesson-continue"
          >
            继续学习
          </button>
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={goToCourse}
            data-testid="current-lesson-view-course"
          >
            查看课程
          </button>
        </div>
      </div>
    </section>
  );
}
