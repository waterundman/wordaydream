/**
 * v2.3.0 Stage 2 — 课程进度 Store
 *
 * 职责:
 * - 管理课时进度 (lessonProgress, key = lessonId)
 * - 管理解锁状态 (locked / available / in-progress / completed)
 * - 完成判定 (三阈值 + requiredSessionTypes)
 * - 解锁下一课 (同 Module 顺序解锁 / 跨 Module prerequisite 校验)
 *
 * 持久化:
 * - key: 'wordaydream:course'
 * - version: 1
 * - 持久化字段: enrolledCourseIds, currentCourseId, currentModuleId, currentLessonId, lessonProgress
 *
 * 参考: useWordlistStore (Zustand persist 模式)
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Course, Lesson, LessonStatus, Module } from '../types';
import { getCourseById, getLessonById } from '../../../data/courses';

/** 课时进度 (持久化, key = lessonId) */
export interface LessonProgress {
  status: LessonStatus;
  /** 遇到的目标词 (去重 lemma 列表) */
  wordsEncountered: string[];
  /** 学会的目标词 (去重 lemma 列表) */
  wordsLearned: string[];
  reviewCorrectCount: number;
  reviewTotalCount: number;
  startedAt: number | null;
  completedAt: number | null;
}

interface CourseState {
  // === 持久化状态 ===
  enrolledCourseIds: string[];
  currentCourseId: string | null;
  currentModuleId: string | null;
  currentLessonId: string | null;
  lessonProgress: Record<string, LessonProgress>;

  // === Actions ===
  enrollCourse: (courseId: string) => void;
  startLesson: (lessonId: string) => void;
  recordEncounter: (lessonId: string, lemma: string) => void;
  recordLearning: (lessonId: string, lemma: string) => void;
  recordReview: (lessonId: string, correct: boolean) => void;
  checkCompletion: (lessonId: string) => boolean;
  unlockNext: (lessonId: string) => string | null;
  getCurrentLesson: () => { course: Course; module: Module; lesson: Lesson } | null;
  resetProgress: () => void;
}

/** 构造初始 LessonProgress */
function makeInitialProgress(): LessonProgress {
  return {
    status: 'locked',
    wordsEncountered: [],
    wordsLearned: [],
    reviewCorrectCount: 0,
    reviewTotalCount: 0,
    startedAt: null,
    completedAt: null,
  };
}

/** 在课程中查找 lesson, 返回所属 module index 与 lesson index */
function findLessonIndex(
  course: Course,
  lessonId: string
): { moduleIndex: number; lessonIndex: number } | null {
  for (let mi = 0; mi < course.modules.length; mi++) {
    const li = course.modules[mi].lessons.findIndex((l) => l.id === lessonId);
    if (li >= 0) {
      return { moduleIndex: mi, lessonIndex: li };
    }
  }
  return null;
}

/** 在课程中查找 lesson 的 completionCriteria */
function findLesson(course: Course, lessonId: string): Lesson | null {
  for (const module of course.modules) {
    const lesson = module.lessons.find((l) => l.id === lessonId);
    if (lesson) return lesson;
  }
  return null;
}

export const useCourseStore = create<CourseState>()(
  persist(
    (set, get) => ({
      enrolledCourseIds: [],
      currentCourseId: null,
      currentModuleId: null,
      currentLessonId: null,
      lessonProgress: {},

      // === Actions ===

      enrollCourse: (courseId) => {
        const course = getCourseById(courseId);
        if (!course) return;

        const progress: Record<string, LessonProgress> = {};
        for (const module of course.modules) {
          for (const lesson of module.lessons) {
            progress[lesson.id] = makeInitialProgress();
          }
        }

        // 首个 Module 首个 Lesson → available, 其余保持 locked
        const firstModule = course.modules[0];
        const firstLesson = firstModule.lessons[0];
        progress[firstLesson.id].status = 'available';

        set({
          currentCourseId: courseId,
          currentModuleId: firstModule.id,
          currentLessonId: null,
          lessonProgress: progress,
          enrolledCourseIds: [...new Set([...get().enrolledCourseIds, courseId])],
        });
      },

      startLesson: (lessonId) => {
        const state = get();
        const progress = state.lessonProgress[lessonId];
        if (!progress || progress.status !== 'available') return;

        const courseId = state.currentCourseId;
        if (!courseId) return;
        const course = getCourseById(courseId);
        if (!course) return;

        const found = findLessonIndex(course, lessonId);
        if (!found) return;

        const moduleId = course.modules[found.moduleIndex].id;

        set({
          currentLessonId: lessonId,
          currentModuleId: moduleId,
          lessonProgress: {
            ...state.lessonProgress,
            [lessonId]: {
              ...progress,
              status: 'in-progress',
              startedAt: Date.now(),
            },
          },
        });
      },

      recordEncounter: (lessonId, lemma) => {
        const progress = get().lessonProgress[lessonId];
        if (!progress) return;

        // 去重: 同一 lemma 多次调用只算 1
        if (progress.wordsEncountered.includes(lemma)) return;

        set({
          lessonProgress: {
            ...get().lessonProgress,
            [lessonId]: {
              ...progress,
              wordsEncountered: [...progress.wordsEncountered, lemma],
            },
          },
        });

        get().checkCompletion(lessonId);
      },

      recordLearning: (lessonId, lemma) => {
        const progress = get().lessonProgress[lessonId];
        if (!progress) return;

        // 去重: 同一 lemma 多次调用只算 1
        if (progress.wordsLearned.includes(lemma)) return;

        set({
          lessonProgress: {
            ...get().lessonProgress,
            [lessonId]: {
              ...progress,
              wordsLearned: [...progress.wordsLearned, lemma],
            },
          },
        });

        get().checkCompletion(lessonId);
      },

      recordReview: (lessonId, correct) => {
        const progress = get().lessonProgress[lessonId];
        if (!progress) return;

        set({
          lessonProgress: {
            ...get().lessonProgress,
            [lessonId]: {
              ...progress,
              reviewTotalCount: progress.reviewTotalCount + 1,
              reviewCorrectCount: correct
                ? progress.reviewCorrectCount + 1
                : progress.reviewCorrectCount,
            },
          },
        });

        get().checkCompletion(lessonId);
      },

      checkCompletion: (lessonId) => {
        const state = get();
        const progress = state.lessonProgress[lessonId];
        if (!progress) return false;
        // 已完成则不再重复判定
        if (progress.status === 'completed') return false;

        const courseId = state.currentCourseId;
        if (!courseId) return false;
        const course = getCourseById(courseId);
        if (!course) return false;

        const lesson = findLesson(course, lessonId);
        if (!lesson) return false;

        const criteria = lesson.completionCriteria;

        const encounteredOk = progress.wordsEncountered.length >= criteria.minWordsEncountered;
        const learnedOk = progress.wordsLearned.length >= criteria.minWordsLearned;
        const accuracy =
          progress.reviewTotalCount > 0
            ? progress.reviewCorrectCount / progress.reviewTotalCount
            : 0;
        const reviewOk = accuracy >= criteria.minReviewAccuracy;

        // requiredSessionTypes: 暂时只检查 'reading', 即只要 lesson 处于 in-progress 就算满足
        const sessionOk = progress.status === 'in-progress';

        if (encounteredOk && learnedOk && reviewOk && sessionOk) {
          set({
            lessonProgress: {
              ...get().lessonProgress,
              [lessonId]: {
                ...progress,
                status: 'completed',
                completedAt: Date.now(),
              },
            },
          });
          return true;
        }

        return false;
      },

      unlockNext: (lessonId) => {
        const state = get();
        const courseId = state.currentCourseId;
        if (!courseId) return null;
        const course = getCourseById(courseId);
        if (!course) return null;

        const found = findLessonIndex(course, lessonId);
        if (!found) return null;

        const currentModule = course.modules[found.moduleIndex];
        const progress = state.lessonProgress;

        // 1. 在当前 Module 内找下一个 locked Lesson (按 lessons 数组顺序 = order 升序)
        for (let li = found.lessonIndex + 1; li < currentModule.lessons.length; li++) {
          const nextLesson = currentModule.lessons[li];
          if (progress[nextLesson.id]?.status === 'locked') {
            set({
              lessonProgress: {
                ...get().lessonProgress,
                [nextLesson.id]: {
                  ...get().lessonProgress[nextLesson.id],
                  status: 'available',
                },
              },
            });
            return nextLesson.id;
          }
        }

        // 2. 当前 Module 内无下一个 locked Lesson, 检查是否全部 completed
        const moduleAllCompleted = currentModule.lessons.every(
          (l) => progress[l.id]?.status === 'completed'
        );
        if (!moduleAllCompleted) return null;

        // 3. 找下一 Module (按 modules 数组顺序 = CEFR 升序)
        if (found.moduleIndex + 1 >= course.modules.length) return null;

        const nextModule = course.modules[found.moduleIndex + 1];

        // 校验 prerequisiteModuleIds: 所有前置 Module 的所有 Lesson 都 completed
        const prereqOk = nextModule.prerequisiteModuleIds.every((prereqId) => {
          const prereqModule = course.modules.find((m) => m.id === prereqId);
          if (!prereqModule) return true;
          return prereqModule.lessons.every((l) => progress[l.id]?.status === 'completed');
        });
        if (!prereqOk) return null;

        // 解锁下一 Module 首个 Lesson
        const firstLesson = nextModule.lessons[0];
        if (progress[firstLesson.id]?.status === 'locked') {
          set({
            lessonProgress: {
              ...get().lessonProgress,
              [firstLesson.id]: {
                ...get().lessonProgress[firstLesson.id],
                status: 'available',
              },
            },
          });
          return firstLesson.id;
        }

        return null;
      },

      getCurrentLesson: () => {
        const { currentCourseId, currentModuleId, currentLessonId } = get();
        if (!currentCourseId || !currentModuleId || !currentLessonId) return null;
        const found = getLessonById(currentCourseId, currentModuleId, currentLessonId);
        return found ?? null;
      },

      resetProgress: () =>
        set({
          enrolledCourseIds: [],
          currentCourseId: null,
          currentModuleId: null,
          currentLessonId: null,
          lessonProgress: {},
        }),
    }),
    {
      name: 'wordaydream:course',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        enrolledCourseIds: state.enrolledCourseIds,
        currentCourseId: state.currentCourseId,
        currentModuleId: state.currentModuleId,
        currentLessonId: state.currentLessonId,
        lessonProgress: state.lessonProgress,
      }),
    }
  )
);
