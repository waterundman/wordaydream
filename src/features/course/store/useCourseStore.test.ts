/**
 * v2.3.0 Stage 2 — useCourseStore 单元测试 (TDD)
 *
 * 覆盖 10 个测试用例 (T01-T10), 其中 T01-T08 为 critical.
 * 使用真实课程定义 (src/data/courses), 不 mock 静态数据.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useCourseStore } from './useCourseStore';
import { courses } from '../../../data/courses';

// 英语课程 (en-from-zh) 作为测试主课程
const enCourse = courses.find((c) => c.id === 'en-from-zh')!;
const enA1Module = enCourse.modules[0];
const enA1FirstLesson = enA1Module.lessons[0];
const enA1SecondLesson = enA1Module.lessons[1];
const enA1LastLesson = enA1Module.lessons[enA1Module.lessons.length - 1];
const enA2Module = enCourse.modules[1];
const enA2FirstLesson = enA2Module.lessons[0];

beforeEach(() => {
  window.localStorage.clear();
  useCourseStore.getState().resetProgress();
});

describe('useCourseStore — checkCompletion (T01-T02)', () => {
  it('T01: checkCompletion: 三阈值全部满足时返回 true 并标记 completed', () => {
    useCourseStore.getState().enrollCourse('en-from-zh');
    useCourseStore.getState().startLesson(enA1FirstLesson.id);

    const criteria = enA1FirstLesson.completionCriteria;

    // 直接设置 progress 满足全部阈值 (避免 recordReview 内部调用 checkCompletion 干扰)
    useCourseStore.setState({
      lessonProgress: {
        ...useCourseStore.getState().lessonProgress,
        [enA1FirstLesson.id]: {
          status: 'in-progress',
          wordsEncountered: enA1FirstLesson.targetLemmas.slice(0, criteria.minWordsEncountered),
          wordsLearned: enA1FirstLesson.targetLemmas.slice(0, criteria.minWordsLearned),
          reviewCorrectCount: 7,
          reviewTotalCount: 10,
          startedAt: Date.now(),
          completedAt: null,
        },
      },
    });

    const result = useCourseStore.getState().checkCompletion(enA1FirstLesson.id);
    expect(result).toBe(true);
    expect(useCourseStore.getState().lessonProgress[enA1FirstLesson.id].status).toBe('completed');
    expect(useCourseStore.getState().lessonProgress[enA1FirstLesson.id].completedAt).not.toBeNull();
  });

  it('T02: checkCompletion: 任一阈值未满足时返回 false, status 保持 in-progress', () => {
    useCourseStore.getState().enrollCourse('en-from-zh');
    useCourseStore.getState().startLesson(enA1FirstLesson.id);

    const criteria = enA1FirstLesson.completionCriteria;

    // wordsEncountered 少 1 个 (不满足 minWordsEncountered)
    useCourseStore.setState({
      lessonProgress: {
        ...useCourseStore.getState().lessonProgress,
        [enA1FirstLesson.id]: {
          status: 'in-progress',
          wordsEncountered: enA1FirstLesson.targetLemmas.slice(0, criteria.minWordsEncountered - 1),
          wordsLearned: enA1FirstLesson.targetLemmas.slice(0, criteria.minWordsLearned),
          reviewCorrectCount: 7,
          reviewTotalCount: 10,
          startedAt: Date.now(),
          completedAt: null,
        },
      },
    });

    const result = useCourseStore.getState().checkCompletion(enA1FirstLesson.id);
    expect(result).toBe(false);
    expect(useCourseStore.getState().lessonProgress[enA1FirstLesson.id].status).toBe('in-progress');
    expect(useCourseStore.getState().lessonProgress[enA1FirstLesson.id].completedAt).toBeNull();
  });
});

describe('useCourseStore — unlockNext (T03-T04)', () => {
  it('T03: unlockNext: 当前 Module 内有下一个 locked Lesson 时解锁并返回新 lessonId', () => {
    useCourseStore.getState().enrollCourse('en-from-zh');

    // 将第一课标记为 completed
    useCourseStore.setState({
      lessonProgress: {
        ...useCourseStore.getState().lessonProgress,
        [enA1FirstLesson.id]: {
          ...useCourseStore.getState().lessonProgress[enA1FirstLesson.id],
          status: 'completed',
          completedAt: Date.now(),
        },
      },
    });

    // 解锁前, 第二课应为 locked
    expect(useCourseStore.getState().lessonProgress[enA1SecondLesson.id].status).toBe('locked');

    const nextLessonId = useCourseStore.getState().unlockNext(enA1FirstLesson.id);
    expect(nextLessonId).toBe(enA1SecondLesson.id);
    expect(useCourseStore.getState().lessonProgress[enA1SecondLesson.id].status).toBe('available');
  });

  it('T04: unlockNext: 当前 Module 全部完成时跳到下一 Module 首个 Lesson (校验 prerequisiteModuleIds)', () => {
    useCourseStore.getState().enrollCourse('en-from-zh');

    // 将 A1 Module 全部课程标记为 completed
    const newProgress = { ...useCourseStore.getState().lessonProgress };
    for (const lesson of enA1Module.lessons) {
      newProgress[lesson.id] = {
        ...newProgress[lesson.id],
        status: 'completed',
        completedAt: Date.now(),
      };
    }
    useCourseStore.setState({ lessonProgress: newProgress });

    // 解锁前, A2 首课应为 locked
    expect(useCourseStore.getState().lessonProgress[enA2FirstLesson.id].status).toBe('locked');

    // 从 A1 最后一课调用 unlockNext
    const nextLessonId = useCourseStore.getState().unlockNext(enA1LastLesson.id);
    expect(nextLessonId).toBe(enA2FirstLesson.id);
    expect(useCourseStore.getState().lessonProgress[enA2FirstLesson.id].status).toBe('available');

    // 验证 prerequisiteModuleIds 校验: en-a2 的 prerequisite 是 en-a1, 全部 completed → 满足
    expect(enA2Module.prerequisiteModuleIds).toContain('en-a1');
  });
});

describe('useCourseStore — recordEncounter / recordLearning 去重 (T05-T06)', () => {
  it('T05: recordEncounter: 同一 lemma 多次调用只算 1 (去重)', () => {
    useCourseStore.getState().enrollCourse('en-from-zh');
    useCourseStore.getState().startLesson(enA1FirstLesson.id);

    const lemma = enA1FirstLesson.targetLemmas[0];

    useCourseStore.getState().recordEncounter(enA1FirstLesson.id, lemma);
    useCourseStore.getState().recordEncounter(enA1FirstLesson.id, lemma);
    useCourseStore.getState().recordEncounter(enA1FirstLesson.id, lemma);

    const progress = useCourseStore.getState().lessonProgress[enA1FirstLesson.id];
    expect(progress.wordsEncountered).toHaveLength(1);
    expect(progress.wordsEncountered).toContain(lemma);
  });

  it('T06: recordLearning: 同一 lemma 多次调用只算 1 (去重)', () => {
    useCourseStore.getState().enrollCourse('en-from-zh');
    useCourseStore.getState().startLesson(enA1FirstLesson.id);

    const lemma = enA1FirstLesson.targetLemmas[0];

    useCourseStore.getState().recordLearning(enA1FirstLesson.id, lemma);
    useCourseStore.getState().recordLearning(enA1FirstLesson.id, lemma);
    useCourseStore.getState().recordLearning(enA1FirstLesson.id, lemma);

    const progress = useCourseStore.getState().lessonProgress[enA1FirstLesson.id];
    expect(progress.wordsLearned).toHaveLength(1);
    expect(progress.wordsLearned).toContain(lemma);
  });
});

describe('useCourseStore — recordReview (T07)', () => {
  it('T07: recordReview: reviewAccuracy = correctCount / totalCount 正确累加', () => {
    useCourseStore.getState().enrollCourse('en-from-zh');
    useCourseStore.getState().startLesson(enA1FirstLesson.id);

    // 7 correct + 3 incorrect = 10 total, accuracy = 0.7
    for (let i = 0; i < 7; i++) {
      useCourseStore.getState().recordReview(enA1FirstLesson.id, true);
    }
    for (let i = 0; i < 3; i++) {
      useCourseStore.getState().recordReview(enA1FirstLesson.id, false);
    }

    const progress = useCourseStore.getState().lessonProgress[enA1FirstLesson.id];
    expect(progress.reviewCorrectCount).toBe(7);
    expect(progress.reviewTotalCount).toBe(10);
    // accuracy = 7/10 = 0.7
    expect(progress.reviewCorrectCount / progress.reviewTotalCount).toBe(0.7);
  });
});

describe('useCourseStore — enrollCourse (T08)', () => {
  it('T08: enrollCourse: 设置 currentCourseId, 首个 Lesson available, 其余 locked', () => {
    useCourseStore.getState().enrollCourse('en-from-zh');

    expect(useCourseStore.getState().currentCourseId).toBe('en-from-zh');

    const firstModule = enCourse.modules[0];
    const firstLesson = firstModule.lessons[0];

    // 首个 Module 首个 Lesson 应为 available
    expect(useCourseStore.getState().lessonProgress[firstLesson.id].status).toBe('available');

    // 首个 Module 其余 Lesson 应为 locked
    for (let li = 1; li < firstModule.lessons.length; li++) {
      expect(useCourseStore.getState().lessonProgress[firstModule.lessons[li].id].status).toBe('locked');
    }

    // 其他 Module 的所有 Lesson 应为 locked
    for (let mi = 1; mi < enCourse.modules.length; mi++) {
      for (const lesson of enCourse.modules[mi].lessons) {
        expect(useCourseStore.getState().lessonProgress[lesson.id].status).toBe('locked');
      }
    }

    // 应加入 enrolledCourseIds
    expect(useCourseStore.getState().enrolledCourseIds).toContain('en-from-zh');
  });
});

describe('useCourseStore — startLesson (T09)', () => {
  it('T09: startLesson: 校验 status, 设置 currentLessonId, status=in-progress', () => {
    useCourseStore.getState().enrollCourse('en-from-zh');

    const beforeTime = Date.now();
    useCourseStore.getState().startLesson(enA1FirstLesson.id);
    const afterTime = Date.now();

    expect(useCourseStore.getState().currentLessonId).toBe(enA1FirstLesson.id);
    expect(useCourseStore.getState().lessonProgress[enA1FirstLesson.id].status).toBe('in-progress');
    expect(useCourseStore.getState().lessonProgress[enA1FirstLesson.id].startedAt).not.toBeNull();
    const startedAt = useCourseStore.getState().lessonProgress[enA1FirstLesson.id].startedAt!;
    expect(startedAt).toBeGreaterThanOrEqual(beforeTime);
    expect(startedAt).toBeLessThanOrEqual(afterTime);

    // 校验: 对 locked 的 lesson 调用 startLesson 不生效
    useCourseStore.getState().startLesson(enA1SecondLesson.id);
    expect(useCourseStore.getState().currentLessonId).toBe(enA1FirstLesson.id);
    expect(useCourseStore.getState().lessonProgress[enA1SecondLesson.id].status).toBe('locked');
  });
});

describe('useCourseStore — persist (T10)', () => {
  it('T10: persist: localStorage key=wordaydream:course, version=1', () => {
    const options = useCourseStore.persist.getOptions();
    expect(options.name).toBe('wordaydream:course');
    expect(options.version).toBe(1);
  });
});
