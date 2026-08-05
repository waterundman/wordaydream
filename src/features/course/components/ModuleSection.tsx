/**
 * v2.3.0 Stage 4 — ModuleSection
 *
 * 可折叠的 Module 区块, 包含 header (title + cefrLevel badge + 完成度) 和 body (LessonCard 列表).
 *
 * 行为:
 * - 可折叠 (默认: 当前 Module 展开, 其他折叠)
 *   "当前 Module" 判定: 包含 status='in-progress' 或首个含 'available' lesson 的 Module.
 * - isPrerequisiteMet=false 时整段禁用 (灰色 + 不可展开)
 * - 折叠状态用 localStorage 持久化
 *   key: 'wordaydream:course:collapsed-modules'
 *   value: Record<moduleId, boolean> (true = collapsed)
 *
 * 设计约束:
 * - 无 emoji (折叠箭头用 SVG)
 * - 配色用 tokens.css 变量
 * - prefers-reduced-motion 降级 (见 .module.css)
 */
import { useState, useEffect, useCallback } from 'react';
import type { Lesson, Module } from '../types';
import type { LessonProgress } from '../store/useCourseStore';
import { LessonCard } from './LessonCard';
import styles from './ModuleSection.module.css';

/** localStorage key (与 STAGE CONTRACT 一致) */
const COLLAPSED_STORAGE_KEY = 'wordaydream:course:collapsed-modules';

interface ModuleSectionProps {
  module: Module;
  lessons: Lesson[];
  lessonProgress: Record<string, LessonProgress>;
  onStartLesson: (lessonId: string) => void;
  isPrerequisiteMet: boolean;
}

/** 从 localStorage 读取折叠状态 map */
function readCollapsedMap(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(COLLAPSED_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, boolean>;
    }
  } catch {
    // 容错: 损坏的 JSON 视为空
  }
  return {};
}

/** 写入折叠状态 map 到 localStorage */
function writeCollapsedMap(map: Record<string, boolean>): void {
  try {
    localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // 容错: localStorage 不可用时静默
  }
}

/**
 * 判断 Module 是否应默认展开 (无 localStorage 记录时):
 * - 包含 status='in-progress' 的 lesson → 用户当前正在学
 * - 或包含首个 'available' lesson (按 order 升序) → 用户下一步要学
 */
function shouldDefaultExpand(
  module: Module,
  lessonProgress: Record<string, LessonProgress>
): boolean {
  const hasInProgress = module.lessons.some(
    (l) => lessonProgress[l.id]?.status === 'in-progress'
  );
  if (hasInProgress) return true;

  // 含任何 'available' lesson (即未完成且未锁定) → 当前活跃 Module
  return module.lessons.some(
    (l) => lessonProgress[l.id]?.status === 'available'
  );
}

/** 计算已完成 lesson 数 */
function countCompleted(
  module: Module,
  lessonProgress: Record<string, LessonProgress>
): number {
  return module.lessons.filter(
    (l) => lessonProgress[l.id]?.status === 'completed'
  ).length;
}

export function ModuleSection({
  module,
  lessons,
  lessonProgress,
  onStartLesson,
  isPrerequisiteMet,
}: ModuleSectionProps) {
  // 折叠状态: true=折叠, false=展开
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    const map = readCollapsedMap();
    if (module.id in map) {
      return Boolean(map[module.id]);
    }
    // 默认: 当前活跃 Module 展开, 其他折叠
    return !shouldDefaultExpand(module, lessonProgress);
  });

  // 同步: 若 localStorage 被外部修改 (其他 tab), 更新本组件状态
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === COLLAPSED_STORAGE_KEY && e.newValue !== null) {
        try {
          const map = JSON.parse(e.newValue) as Record<string, boolean>;
          if (module.id in map) {
            setCollapsed(Boolean(map[module.id]));
          }
        } catch {
          // 容错
        }
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [module.id]);

  const toggleCollapsed = useCallback(() => {
    if (!isPrerequisiteMet) return;
    setCollapsed((prev) => {
      const next = !prev;
      // 持久化到 localStorage
      const map = readCollapsedMap();
      map[module.id] = next;
      writeCollapsedMap(map);
      return next;
    });
  }, [isPrerequisiteMet, module.id]);

  const completedCount = countCompleted(module, lessonProgress);
  const totalLessons = module.lessons.length;
  const isExpanded = !collapsed && isPrerequisiteMet;

  const sectionClass = isPrerequisiteMet
    ? styles.section
    : `${styles.section} ${styles.disabled}`;

  const arrowClass = isExpanded
    ? `${styles.arrow} ${styles.arrowExpanded}`
    : styles.arrow;

  return (
    <section
      className={sectionClass}
      data-testid={`module-section-${module.id}`}
      data-disabled={!isPrerequisiteMet}
      aria-disabled={!isPrerequisiteMet}
    >
      <button
        type="button"
        className={styles.header}
        onClick={toggleCollapsed}
        disabled={!isPrerequisiteMet}
        aria-expanded={isExpanded}
        aria-controls={`module-body-${module.id}`}
        aria-label={`${module.title} — ${completedCount} of ${totalLessons} lessons completed`}
      >
        <div className={styles.headerInfo}>
          <span className={styles.cefrBadge}>{module.cefrLevel}</span>
          <span className={styles.title}>{module.title}</span>
        </div>
        <div className={styles.headerMeta}>
          <span className={styles.completion}>
            {completedCount}/{totalLessons}
          </span>
          <svg
            className={arrowClass}
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
        </div>
      </button>

      {isPrerequisiteMet ? (
        isExpanded && (
          <div className={styles.body} id={`module-body-${module.id}`}>
            {lessons.map((lesson) => {
              const progress = lessonProgress[lesson.id];
              if (!progress) return null;
              return (
                <LessonCard
                  key={lesson.id}
                  lesson={lesson}
                  progress={progress}
                  onStartLesson={onStartLesson}
                />
              );
            })}
          </div>
        )
      ) : (
        <div className={styles.disabledNote}>
          完成前置 Module 后解锁
        </div>
      )}
    </section>
  );
}
