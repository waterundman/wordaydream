/**
 * v2.3.0 Stage 5/6 — LessonCompleteModal 测试 (TDD)
 *
 * 覆盖 test_spec (Stage 5 遗留 gap, Stage 6 补充):
 * - M01 [critical]: status === 'completed' 且本会话未展示过时弹出
 * - M02 [critical]: 展示 '课时完成' + lesson.title + 统计 (遇到 X 词 / 学会 Y 词 / 正确率 Z%)
 * - M03 [critical]: 有 unlockNext 时显示 '下一课'; 无则 '返回课程'
 * - M04 [critical]: 点击 '下一课' 调用 unlockNext + startLesson
 * - M05 [critical]: 点击 '返回课程' 跳转 '#/course'
 * - M06 [critical]: 已展示过本课的 modal 后不再弹出 (useRef 防重复)
 * - M07 [critical]: status !== 'completed' 时不渲染
 * - M08 [critical]: prefers-reduced-motion CSS 含 @media query
 *
 * 框架: vitest + @testing-library/react
 * 策略:
 * - 用真实 useCourseStore + setState 控制状态 (避免 vi.mock 复杂性)
 * - M04: vi.spyOn 验证 unlockNext + startLesson 调用
 * - M05: 检查 window.location.hash
 * - M06: 第一次渲染弹出, 关闭后切换 currentLessonId 再回来不再弹出
 * - M08: 读 CSS 文件验证 @media
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { LessonCompleteModal } from './LessonCompleteModal';
import { useCourseStore } from '../store/useCourseStore';
import { courses } from '../../../data/courses';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================================================
// 测试 fixtures
// ============================================================================

const enCourse = courses.find((c) => c.id === 'en-from-zh')!;
const enA1Module = enCourse.modules[0];
const enA1FirstLesson = enA1Module.lessons[0];
const enA1SecondLesson = enA1Module.lessons[1];
const enA1LastLesson = enA1Module.lessons[enA1Module.lessons.length - 1];

/**
 * 将指定 lesson 标记为 completed (直接 setState, 不经过 checkCompletion 逻辑).
 * 同时设置 wordsEncountered / wordsLearned / reviewCount 以支持统计测试.
 */
function markLessonCompleted(
  lessonId: string,
  overrides?: {
    encountered?: string[];
    learned?: string[];
    correct?: number;
    total?: number;
  }
): void {
  const state = useCourseStore.getState();
  const existing = state.lessonProgress[lessonId];
  useCourseStore.setState({
    currentLessonId: lessonId,
    lessonProgress: {
      ...state.lessonProgress,
      [lessonId]: {
        status: 'completed',
        wordsEncountered: overrides?.encountered ?? ['a', 'b', 'c'],
        wordsLearned: overrides?.learned ?? ['a', 'b'],
        reviewCorrectCount: overrides?.correct ?? 7,
        reviewTotalCount: overrides?.total ?? 10,
        startedAt: existing?.startedAt ?? Date.now(),
        completedAt: Date.now(),
      },
    },
  });
}

// ============================================================================
// Setup / Cleanup
// ============================================================================

beforeEach(() => {
  useCourseStore.getState().resetProgress();
  localStorage.clear();
  // 重置 location.hash (避免跨测试泄漏)
  if (typeof window !== 'undefined') {
    window.location.hash = '';
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ============================================================================
// M01: status === 'completed' 且本会话未展示过时弹出 [critical]
// ============================================================================

describe('M01: LessonCompleteModal completed 时弹出', () => {
  it('status === completed 且未展示过时渲染 modal', () => {
    useCourseStore.getState().enrollCourse('en-from-zh');
    useCourseStore.getState().startLesson(enA1FirstLesson.id);
    markLessonCompleted(enA1FirstLesson.id);

    render(<LessonCompleteModal />);

    expect(screen.getByTestId('lesson-complete-modal')).toBeInTheDocument();
  });

  it('modal 含 role=dialog + aria-modal=true', () => {
    useCourseStore.getState().enrollCourse('en-from-zh');
    useCourseStore.getState().startLesson(enA1FirstLesson.id);
    markLessonCompleted(enA1FirstLesson.id);

    render(<LessonCompleteModal />);

    const modal = screen.getByRole('dialog');
    expect(modal).toHaveAttribute('aria-modal', 'true');
    expect(modal).toHaveAttribute('aria-labelledby', 'lesson-complete-title');
  });
});

// ============================================================================
// M02: 展示 '课时完成' + lesson.title + 统计 [critical]
// ============================================================================

describe('M02: 展示课时完成 + lesson.title + 统计', () => {
  it('展示 课时完成 标题', () => {
    useCourseStore.getState().enrollCourse('en-from-zh');
    useCourseStore.getState().startLesson(enA1FirstLesson.id);
    markLessonCompleted(enA1FirstLesson.id);

    render(<LessonCompleteModal />);

    expect(screen.getByText('课时完成')).toBeInTheDocument();
  });

  it('展示 lesson.title', () => {
    useCourseStore.getState().enrollCourse('en-from-zh');
    useCourseStore.getState().startLesson(enA1FirstLesson.id);
    markLessonCompleted(enA1FirstLesson.id);

    render(<LessonCompleteModal />);

    expect(screen.getByText(enA1FirstLesson.title)).toBeInTheDocument();
  });

  it('展示统计: 遇到 3 词 / 学会 2 词 / 正确率 70%', () => {
    useCourseStore.getState().enrollCourse('en-from-zh');
    useCourseStore.getState().startLesson(enA1FirstLesson.id);
    markLessonCompleted(enA1FirstLesson.id, {
      encountered: ['apple', 'banana', 'cherry'],
      learned: ['apple', 'banana'],
      correct: 7,
      total: 10,
    });

    render(<LessonCompleteModal />);

    // 遇到 3 词
    expect(screen.getByTestId('stat-encountered')).toHaveTextContent('遇到');
    expect(screen.getByTestId('stat-encountered')).toHaveTextContent('3');
    // 学会 2 词
    expect(screen.getByTestId('stat-learned')).toHaveTextContent('学会');
    expect(screen.getByTestId('stat-learned')).toHaveTextContent('2');
    // 正确率 70%
    expect(screen.getByTestId('stat-accuracy')).toHaveTextContent('正确率');
    expect(screen.getByTestId('stat-accuracy')).toHaveTextContent('70%');
  });

  it('reviewTotalCount=0 时正确率显示 N/A', () => {
    useCourseStore.getState().enrollCourse('en-from-zh');
    useCourseStore.getState().startLesson(enA1FirstLesson.id);
    markLessonCompleted(enA1FirstLesson.id, {
      encountered: ['a'],
      learned: ['a'],
      correct: 0,
      total: 0,
    });

    render(<LessonCompleteModal />);

    expect(screen.getByTestId('stat-accuracy')).toHaveTextContent('N/A');
  });
});

// ============================================================================
// M03: 有 unlockNext 时显示 '下一课'; 无则 '返回课程' [critical]
// ============================================================================

describe('M03: 下一课 / 返回课程 按钮', () => {
  it('有 unlockNext (下一课存在) 时显示 下一课 按钮', () => {
    useCourseStore.getState().enrollCourse('en-from-zh');
    useCourseStore.getState().startLesson(enA1FirstLesson.id);
    markLessonCompleted(enA1FirstLesson.id);

    render(<LessonCompleteModal />);

    // 第一课完成 → 第二课 locked → unlockNext 解锁第二课 → 显示 '下一课'
    expect(screen.getByTestId('lesson-complete-next')).toBeInTheDocument();
    expect(screen.getByText('下一课')).toBeInTheDocument();
    // 不应有 '返回课程' 按钮
    expect(screen.queryByTestId('lesson-complete-back')).not.toBeInTheDocument();
  });

  it('无 unlockNext (无下一课) 时显示 返回课程 按钮', () => {
    useCourseStore.getState().enrollCourse('en-from-zh');
    // 直接设置最后一课为 completed (A1 未全部完成 → unlockNext 返回 null)
    markLessonCompleted(enA1LastLesson.id);

    render(<LessonCompleteModal />);

    // 最后一课完成 → 无后续 locked lesson + A1 未全部完成 → unlockNext 返回 null → '返回课程'
    expect(screen.getByTestId('lesson-complete-back')).toBeInTheDocument();
    expect(screen.getByText('返回课程')).toBeInTheDocument();
    // 不应有 '下一课' 按钮
    expect(screen.queryByTestId('lesson-complete-next')).not.toBeInTheDocument();
  });
});

// ============================================================================
// M04: 点击 '下一课' 调用 unlockNext + startLesson [critical]
// ============================================================================

describe('M04: 点击 下一课 调用 unlockNext + startLesson', () => {
  it('modal 打开时 useEffect 调用 unlockNext(currentLessonId)', () => {
    useCourseStore.getState().enrollCourse('en-from-zh');
    useCourseStore.getState().startLesson(enA1FirstLesson.id);
    markLessonCompleted(enA1FirstLesson.id);

    const unlockNextSpy = vi.spyOn(useCourseStore.getState(), 'unlockNext');

    render(<LessonCompleteModal />);

    expect(unlockNextSpy).toHaveBeenCalledWith(enA1FirstLesson.id);
    // 副作用: 第二课应被解锁为 available
    expect(
      useCourseStore.getState().lessonProgress[enA1SecondLesson.id].status,
    ).toBe('available');
  });

  it('点击 下一课 调用 startLesson(nextLessonId)', () => {
    useCourseStore.getState().enrollCourse('en-from-zh');
    useCourseStore.getState().startLesson(enA1FirstLesson.id);
    markLessonCompleted(enA1FirstLesson.id);

    const startLessonSpy = vi.spyOn(useCourseStore.getState(), 'startLesson');

    render(<LessonCompleteModal />);

    // 点击 下一课
    fireEvent.click(screen.getByTestId('lesson-complete-next'));

    // startLesson 应以第二课 id 调用
    expect(startLessonSpy).toHaveBeenCalledWith(enA1SecondLesson.id);
    // 副作用: currentLessonId 切换到第二课
    expect(useCourseStore.getState().currentLessonId).toBe(enA1SecondLesson.id);
    // 副作用: 第二课状态变为 in-progress
    expect(
      useCourseStore.getState().lessonProgress[enA1SecondLesson.id].status,
    ).toBe('in-progress');
  });
});

// ============================================================================
// M05: 点击 '返回课程' 跳转 '#/course' [critical]
// ============================================================================

describe('M05: 点击 返回课程 跳转 #/course', () => {
  it('点击返回课程后 window.location.hash 为 #/course', () => {
    useCourseStore.getState().enrollCourse('en-from-zh');
    // 最后一课 completed + A1 未全部完成 → unlockNext 返回 null → '返回课程' 按钮
    markLessonCompleted(enA1LastLesson.id);

    render(<LessonCompleteModal />);

    const backBtn = screen.getByTestId('lesson-complete-back');
    expect(backBtn).toBeInTheDocument();

    fireEvent.click(backBtn);

    // hash 应为 #/course
    expect(window.location.hash).toBe('#/course');
  });
});

// ============================================================================
// M06: 已展示过本课的 modal 后不再弹出 (useRef 防重复) [critical]
// ============================================================================

describe('M06: 防重复弹出 (useRef)', () => {
  it('关闭后切换 currentLessonId 回已展示的课时不再弹出', () => {
    useCourseStore.getState().enrollCourse('en-from-zh');
    useCourseStore.getState().startLesson(enA1FirstLesson.id);
    markLessonCompleted(enA1FirstLesson.id);

    render(<LessonCompleteModal />);

    // 第一次: modal 弹出
    expect(screen.getByTestId('lesson-complete-modal')).toBeInTheDocument();

    // 点击 下一课 → 关闭 modal + 切换 currentLessonId 到第二课
    fireEvent.click(screen.getByTestId('lesson-complete-next'));
    expect(screen.queryByTestId('lesson-complete-modal')).not.toBeInTheDocument();

    // 切换 currentLessonId 回第一课 (status 仍为 completed)
    act(() => {
      useCourseStore.setState({ currentLessonId: enA1FirstLesson.id });
    });

    // 不应再次弹出 (shownRef.current === enA1FirstLesson.id)
    expect(screen.queryByTestId('lesson-complete-modal')).not.toBeInTheDocument();
  });
});

// ============================================================================
// M07: status !== 'completed' 时不渲染 [critical]
// ============================================================================

describe('M07: 非 completed 时不渲染', () => {
  it('status === in-progress 时不渲染 modal', () => {
    useCourseStore.getState().enrollCourse('en-from-zh');
    useCourseStore.getState().startLesson(enA1FirstLesson.id);
    // status = in-progress (未 markCompleted)

    render(<LessonCompleteModal />);

    expect(screen.queryByTestId('lesson-complete-modal')).not.toBeInTheDocument();
  });

  it('status === available 时不渲染 modal', () => {
    useCourseStore.getState().enrollCourse('en-from-zh');
    // 第一课 available, currentLessonId = null

    render(<LessonCompleteModal />);

    expect(screen.queryByTestId('lesson-complete-modal')).not.toBeInTheDocument();
  });

  it('currentLessonId === null 时不渲染 modal', () => {
    useCourseStore.getState().enrollCourse('en-from-zh');
    // currentLessonId = null (未 startLesson)

    render(<LessonCompleteModal />);

    expect(screen.queryByTestId('lesson-complete-modal')).not.toBeInTheDocument();
  });
});

// ============================================================================
// M08: prefers-reduced-motion CSS 含 @media query [critical]
// ============================================================================

describe('M08: prefers-reduced-motion CSS 降级', () => {
  it('LessonCompleteModal.module.css 含 @media (prefers-reduced-motion: reduce)', () => {
    const content = readFileSync(
      resolve(__dirname, './LessonCompleteModal.module.css'),
      'utf-8',
    );
    expect(content).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('reduced-motion 块内禁用 animation + transition', () => {
    const content = readFileSync(
      resolve(__dirname, './LessonCompleteModal.module.css'),
      'utf-8',
    );
    // 提取 reduced-motion 块
    const reducedMotionBlock = content.match(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/,
    );
    expect(reducedMotionBlock).not.toBeNull();
    // 块内应有 animation: none
    expect(reducedMotionBlock?.[1]).toMatch(/animation:\s*none/);
    // 块内应有 transition: none
    expect(reducedMotionBlock?.[1]).toMatch(/transition:\s*none/);
  });
});
