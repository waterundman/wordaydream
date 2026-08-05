/**
 * v2.3.0 Stage 4 — CoursePathPage
 *
 * 课程导航页: 展示 Module/Lesson 树 + 解锁状态 + 进度.
 *
 * 两种视图:
 * 1. 未选课 (currentCourseId === null): 列出所有 courses, 点击 → enrollCourse(courseId)
 * 2. 已选课: 渲染当前 Course 的 Module 列表 (ModuleSection), 顶部展示课程切换按钮
 *
 * 路由 hash: '#/course' (在 App.tsx 注册)
 *
 * 设计约束:
 * - 无 emoji
 * - 配色用 tokens.css 变量 (warm white #faf8f5 + dark ink #1c1917)
 * - 阅读区 max-width 42rem, centered
 * - prefers-reduced-motion 降级 (见 .module.css)
 */
import { useMemo } from 'react';
import { courses, getCourseById } from '../../../data/courses';
import { useCourseStore } from '../store/useCourseStore';
import type { LessonProgress } from '../store/useCourseStore';
import { ModuleSection } from './ModuleSection';
import styles from './CoursePathPage.module.css';

interface CoursePathPageProps {
  /** 返回主页 */
  onGoHome: () => void;
  /** 开始阅读会话 (用户点击 available/in-progress/completed lesson 时触发) */
  onStartReading: () => void;
}

/**
 * 校验 Module 的 prerequisiteModuleIds 是否全部满足.
 * 满足条件: 所有前置 Module 的所有 lesson 都 'completed'.
 */
function isModulePrerequisiteMet(
  courseId: string,
  moduleId: string,
  lessonProgress: Record<string, LessonProgress>
): boolean {
  const course = getCourseById(courseId);
  if (!course) return false;
  const module = course.modules.find((m) => m.id === moduleId);
  if (!module) return false;

  // 无前置 Module → 总是满足
  if (module.prerequisiteModuleIds.length === 0) return true;

  return module.prerequisiteModuleIds.every((prereqId) => {
    const prereqModule = course.modules.find((m) => m.id === prereqId);
    if (!prereqModule) return true;
    return prereqModule.lessons.every(
      (l) => lessonProgress[l.id]?.status === 'completed'
    );
  });
}

export function CoursePathPage({ onGoHome, onStartReading }: CoursePathPageProps) {
  const currentCourseId = useCourseStore((s) => s.currentCourseId);
  const lessonProgress = useCourseStore((s) => s.lessonProgress);
  const enrollCourse = useCourseStore((s) => s.enrollCourse);
  const startLesson = useCourseStore((s) => s.startLesson);

  const currentCourse = useMemo(
    () => (currentCourseId ? getCourseById(currentCourseId) : undefined),
    [currentCourseId]
  );

  // 处理点击 lesson: 调用 startLesson (校验 status) + 触发 onStartReading 跳转
  const handleStartLesson = (lessonId: string) => {
    startLesson(lessonId);
    onStartReading();
  };

  // 处理选课
  const handleEnroll = (courseId: string) => {
    enrollCourse(courseId);
  };

  // === 未选课视图: 课程选择列表 ===
  if (!currentCourseId || !currentCourse) {
    return (
      <div className={styles.page}>
        <header className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.eyebrow}>课程</span>
            <h1 className={styles.title}>选择一门课程开始学习</h1>
          </div>
          <button
            type="button"
            className={styles.homeBtn}
            onClick={onGoHome}
            aria-label="返回主页"
          >
            返回主页
          </button>
        </header>

        <main className={styles.main}>
          {courses.length === 0 ? (
            <div className={styles.emptyState}>
              <p className={styles.emptyStateText}>
                暂无可用课程
              </p>
            </div>
          ) : (
            <div className={styles.courseList}>
              {courses.map((course) => (
                <button
                  key={course.id}
                  type="button"
                  className={styles.courseCard}
                  onClick={() => handleEnroll(course.id)}
                  aria-label={`选择课程 ${course.title}`}
                  data-testid={`course-card-${course.id}`}
                >
                  <span className={styles.courseCardTitle}>{course.title}</span>
                  <span className={styles.courseCardMeta}>
                    {course.modules.length} 个 Module · 目标语言 {course.targetLanguage.toUpperCase()}
                  </span>
                  <span className={styles.courseCardCta}>开始学习</span>
                </button>
              ))}
            </div>
          )}
        </main>
      </div>
    );
  }

  // === 已选课视图: Module 列表 ===
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.eyebrow}>课程</span>
          <h1 className={styles.title}>{currentCourse.title}</h1>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button
            type="button"
            className={styles.homeBtn}
            onClick={onGoHome}
            aria-label="返回主页"
          >
            返回主页
          </button>
          {courses.length > 1 && (
            <button
              type="button"
              className={styles.switchBtn}
              onClick={() => {
                // 切换课程: 重置 currentCourseId, 回到选课视图
                useCourseStore.setState({ currentCourseId: null });
              }}
              aria-label="切换课程"
              data-testid="course-switch-btn"
            >
              切换课程
            </button>
          )}
        </div>
      </header>

      <main className={styles.main}>
        <div className={styles.moduleList}>
          {currentCourse.modules.map((module) => {
            const prereqMet = isModulePrerequisiteMet(
              currentCourse.id,
              module.id,
              lessonProgress
            );
            return (
              <ModuleSection
                key={module.id}
                module={module}
                lessons={module.lessons}
                lessonProgress={lessonProgress}
                onStartLesson={handleStartLesson}
                isPrerequisiteMet={prereqMet}
              />
            );
          })}
        </div>
      </main>
    </div>
  );
}
