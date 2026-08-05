/**
 * v2.3.0 Stage 1 — 课程定义入口
 *
 * 汇总所有静态课程定义, 提供按 id 查找 Course / Module / Lesson 的工具函数.
 */

import type { Course, Lesson, Module } from '../../features/course/types';
import { enCourse } from './en';
import { deCourse } from './de';

/** 所有已定义的课程 */
export const courses: Course[] = [enCourse, deCourse];

/** 按 id 查找课程 */
export function getCourseById(id: string): Course | undefined {
  return courses.find((c) => c.id === id);
}

/** 按 courseId + moduleId 查找 Module, 返回所在 Course 与 Module */
export function getModuleById(
  courseId: string,
  moduleId: string
): { course: Course; module: Module } | undefined {
  const course = getCourseById(courseId);
  if (!course) return undefined;
  const module = course.modules.find((m) => m.id === moduleId);
  if (!module) return undefined;
  return { course, module };
}

/** 按 courseId + moduleId + lessonId 查找 Lesson, 返回所在 Course / Module / Lesson */
export function getLessonById(
  courseId: string,
  moduleId: string,
  lessonId: string
): { course: Course; module: Module; lesson: Lesson } | undefined {
  const found = getModuleById(courseId, moduleId);
  if (!found) return undefined;
  const lesson = found.module.lessons.find((l) => l.id === lessonId);
  if (!lesson) return undefined;
  return { course: found.course, module: found.module, lesson };
}
