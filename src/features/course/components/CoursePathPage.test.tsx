/**
 * v2.3.0 Stage 4 — CoursePathPage 测试 (TDD)
 *
 * 覆盖 test_spec:
 * - T01 [critical]: CoursePathPage 渲染当前 Course 的 Module 列表
 * - T02 [critical]: LessonCard status='locked' 时不可点击 + 显示 Locked 文字
 * - T03 [critical]: LessonCard status='available' 时可点击, 触发 onStartLesson(lessonId)
 * - T04 [critical]: ModuleSection isPrerequisiteMet=false 时整段禁用
 * - T05 [non-critical]: ModuleSection 折叠状态用 localStorage 持久化
 * - T06 [critical, integration]: CoursePathPage 路由 hash '#/course' 可访问
 * - T07 [non-critical]: LessonCard 进度条展示 wordsEncountered/targetLemmas.length
 * - T08 [critical]: prefers-reduced-motion CSS 含 @media query
 *
 * 框架: vitest + @testing-library/react
 * 策略:
 * - 用真实 useCourseStore + setState/resetProgress 控制状态 (避免 vi.mock 复杂性)
 * - LessonCard/ModuleSection 单元测试直接 render, 不依赖 store
 * - T06 用 VALID_APP_MODES + App.tsx 源码静态检查路由注册
 * - T08 用 fs.readFileSync 读取 CSS 文件, 验证 @media (prefers-reduced-motion: reduce) 存在
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { CoursePathPage } from './CoursePathPage';
import { LessonCard } from './LessonCard';
import { ModuleSection } from './ModuleSection';
import { useCourseStore } from '../store/useCourseStore';
import type { LessonProgress } from '../store/useCourseStore';
import { VALID_APP_MODES } from '../../../hooks/useAppModeStore';
import type { Lesson, Module } from '../types';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================================================
// 测试 fixtures
// ============================================================================

/** 构造初始 LessonProgress */
function makeProgress(
  overrides: Partial<LessonProgress> = {}
): LessonProgress {
  return {
    status: 'locked',
    wordsEncountered: [],
    wordsLearned: [],
    reviewCorrectCount: 0,
    reviewTotalCount: 0,
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

/** 构造测试用 Lesson (含 5 个 targetLemmas) */
function makeLesson(overrides: Partial<Lesson> = {}): Lesson {
  return {
    id: 'test-lesson-1',
    moduleId: 'test-module',
    title: 'Test Lesson',
    theme: 'a test theme',
    targetLemmas: ['apple', 'banana', 'cherry', 'date', 'elderberry'],
    order: 1,
    completionCriteria: {
      minWordsEncountered: 4,
      minWordsLearned: 3,
      minReviewAccuracy: 0.7,
      requiredSessionTypes: ['reading'],
    },
    ...overrides,
  };
}

/** 构造测试用 Module (含 2 个 lesson) */
function makeModule(overrides: Partial<Module> = {}): Module {
  const lesson1 = makeLesson({ id: 'mod1-l1', order: 1, title: 'Lesson One' });
  const lesson2 = makeLesson({
    id: 'mod1-l2',
    order: 2,
    title: 'Lesson Two',
    targetLemmas: ['fig', 'grape', 'honeydew'],
  });
  return {
    id: 'test-module',
    courseId: 'test-course',
    cefrLevel: 'A1',
    title: 'Test Module A1',
    lessons: [lesson1, lesson2],
    prerequisiteModuleIds: [],
    ...overrides,
  };
}

// ============================================================================
// Setup / Cleanup
// ============================================================================

beforeEach(() => {
  // 重置 store, 避免单例状态跨测试泄漏
  useCourseStore.getState().resetProgress();
  // 清理 localStorage (test/setup.ts 已在每个测试后清理, 这里双重保险)
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

// ============================================================================
// T01: CoursePathPage 渲染当前 Course 的 Module 列表 [critical]
// ============================================================================

describe('T01: CoursePathPage 渲染当前 Course 的 Module 列表', () => {
  it('已选课时渲染所有 Module 标题', () => {
    // 注册课程 → 设置 currentCourseId + lessonProgress
    useCourseStore.getState().enrollCourse('en-from-zh');

    render(<CoursePathPage onGoHome={() => {}} onStartReading={() => {}} />);

    // 应渲染 en-from-zh 的 4 个 Module 标题
    expect(screen.getByText('English A1 — Beginner')).toBeInTheDocument();
    expect(screen.getByText('English A2 — Elementary')).toBeInTheDocument();
    expect(screen.getByText('English B1 — Intermediate')).toBeInTheDocument();
    expect(screen.getByText('English B2 — Upper Intermediate')).toBeInTheDocument();
  });

  it('已选课时渲染课程标题', () => {
    useCourseStore.getState().enrollCourse('en-from-zh');

    render(<CoursePathPage onGoHome={() => {}} onStartReading={() => {}} />);

    expect(screen.getByText('English for Chinese Speakers')).toBeInTheDocument();
  });

  it('未选课时渲染课程选择列表', () => {
    // currentCourseId 为 null (resetProgress 后默认)
    render(<CoursePathPage onGoHome={() => {}} onStartReading={() => {}} />);

    // 应渲染所有课程卡片
    expect(screen.getByText('English for Chinese Speakers')).toBeInTheDocument();
    expect(screen.getByText('选择一门课程开始学习')).toBeInTheDocument();
  });
});

// ============================================================================
// T02: LessonCard status='locked' 时不可点击 + 显示 Locked 文字 [critical]
// ============================================================================

describe('T02: LessonCard locked 状态', () => {
  it('显示 Locked 文字', () => {
    const lesson = makeLesson();
    const progress = makeProgress({ status: 'locked' });

    render(
      <LessonCard lesson={lesson} progress={progress} onStartLesson={() => {}} />
    );

    expect(screen.getByText('Locked')).toBeInTheDocument();
  });

  it('locked 状态点击不触发 onStartLesson', () => {
    const lesson = makeLesson();
    const progress = makeProgress({ status: 'locked' });
    const onStartLesson = vi.fn();

    render(
      <LessonCard lesson={lesson} progress={progress} onStartLesson={onStartLesson} />
    );

    // 卡片应为 disabled button
    const card = screen.getByTestId(`lesson-card-${lesson.id}`);
    expect(card).toBeDisabled();

    // 点击不触发回调 (即使强行 dispatch click)
    fireEvent.click(card);
    expect(onStartLesson).not.toHaveBeenCalled();
  });
});

// ============================================================================
// T03: LessonCard status='available' 时可点击, 触发 onStartLesson(lessonId) [critical]
// ============================================================================

describe('T03: LessonCard available 状态', () => {
  it('显示 Start 文字', () => {
    const lesson = makeLesson();
    const progress = makeProgress({ status: 'available' });

    render(
      <LessonCard lesson={lesson} progress={progress} onStartLesson={() => {}} />
    );

    expect(screen.getByText('Start')).toBeInTheDocument();
  });

  it('available 状态点击触发 onStartLesson(lessonId)', () => {
    const lesson = makeLesson({ id: 'avail-lesson-1' });
    const progress = makeProgress({ status: 'available' });
    const onStartLesson = vi.fn();

    render(
      <LessonCard lesson={lesson} progress={progress} onStartLesson={onStartLesson} />
    );

    const card = screen.getByTestId(`lesson-card-${lesson.id}`);
    expect(card).not.toBeDisabled();

    fireEvent.click(card);
    expect(onStartLesson).toHaveBeenCalledTimes(1);
    expect(onStartLesson).toHaveBeenCalledWith('avail-lesson-1');
  });

  it('in-progress 状态点击触发 onStartLesson 且显示 Continue', () => {
    const lesson = makeLesson({ id: 'ip-lesson-1' });
    const progress = makeProgress({
      status: 'in-progress',
      wordsEncountered: ['apple'],
      startedAt: Date.now(),
    });
    const onStartLesson = vi.fn();

    render(
      <LessonCard lesson={lesson} progress={progress} onStartLesson={onStartLesson} />
    );

    expect(screen.getByText('Continue')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId(`lesson-card-${lesson.id}`));
    expect(onStartLesson).toHaveBeenCalledWith('ip-lesson-1');
  });

  it('completed 状态点击触发 onStartLesson 且显示 Review', () => {
    const lesson = makeLesson({ id: 'done-lesson-1' });
    const progress = makeProgress({
      status: 'completed',
      wordsEncountered: ['apple', 'banana', 'cherry', 'date', 'elderberry'],
      wordsLearned: ['apple', 'banana', 'cherry'],
      completedAt: Date.now(),
    });
    const onStartLesson = vi.fn();

    render(
      <LessonCard lesson={lesson} progress={progress} onStartLesson={onStartLesson} />
    );

    expect(screen.getByText('Review')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId(`lesson-card-${lesson.id}`));
    expect(onStartLesson).toHaveBeenCalledWith('done-lesson-1');
  });
});

// ============================================================================
// T04: ModuleSection isPrerequisiteMet=false 时整段禁用 [critical]
// ============================================================================

describe('T04: ModuleSection prerequisite 未满足时禁用', () => {
  it('isPrerequisiteMet=false 时 header 不可点击', () => {
    const module = makeModule();
    const lessonProgress: Record<string, LessonProgress> = {
      'mod1-l1': makeProgress({ status: 'available' }),
      'mod1-l2': makeProgress({ status: 'locked' }),
    };

    render(
      <ModuleSection
        module={module}
        lessons={module.lessons}
        lessonProgress={lessonProgress}
        onStartLesson={() => {}}
        isPrerequisiteMet={false}
      />
    );

    // header button 应 disabled
    const header = screen.getByRole('button', { name: /Test Module A1/i });
    expect(header).toBeDisabled();
  });

  it('isPrerequisiteMet=false 时不渲染 lesson 列表', () => {
    const module = makeModule();
    const lessonProgress: Record<string, LessonProgress> = {
      'mod1-l1': makeProgress({ status: 'available' }),
      'mod1-l2': makeProgress({ status: 'locked' }),
    };

    render(
      <ModuleSection
        module={module}
        lessons={module.lessons}
        lessonProgress={lessonProgress}
        onStartLesson={() => {}}
        isPrerequisiteMet={false}
      />
    );

    // lesson 标题不应可见 (折叠 + 禁用)
    expect(screen.queryByText('Lesson One')).not.toBeInTheDocument();
    expect(screen.queryByText('Lesson Two')).not.toBeInTheDocument();
  });

  it('isPrerequisiteMet=false 时显示解锁提示', () => {
    const module = makeModule();
    const lessonProgress: Record<string, LessonProgress> = {
      'mod1-l1': makeProgress({ status: 'available' }),
      'mod1-l2': makeProgress({ status: 'locked' }),
    };

    render(
      <ModuleSection
        module={module}
        lessons={module.lessons}
        lessonProgress={lessonProgress}
        onStartLesson={() => {}}
        isPrerequisiteMet={false}
      />
    );

    expect(screen.getByText('完成前置 Module 后解锁')).toBeInTheDocument();
  });

  it('section 元素标记 aria-disabled', () => {
    const module = makeModule();
    const lessonProgress: Record<string, LessonProgress> = {
      'mod1-l1': makeProgress({ status: 'available' }),
    };

    const { container } = render(
      <ModuleSection
        module={module}
        lessons={module.lessons}
        lessonProgress={lessonProgress}
        onStartLesson={() => {}}
        isPrerequisiteMet={false}
      />
    );

    const section = container.querySelector(`[data-testid="module-section-${module.id}"]`);
    expect(section).not.toBeNull();
    expect(section?.getAttribute('aria-disabled')).toBe('true');
    expect(section?.getAttribute('data-disabled')).toBe('true');
  });
});

// ============================================================================
// T05: ModuleSection 折叠状态用 localStorage 持久化 [non-critical]
// ============================================================================

describe('T05: ModuleSection 折叠状态 localStorage 持久化', () => {
  const STORAGE_KEY = 'wordaydream:course:collapsed-modules';

  it('localStorage 标记 collapsed=true 时默认折叠', () => {
    const module = makeModule();
    const lessonProgress: Record<string, LessonProgress> = {
      'mod1-l1': makeProgress({ status: 'available' }),
      'mod1-l2': makeProgress({ status: 'locked' }),
    };

    // 预设 localStorage: 该 module 折叠
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ 'test-module': true })
    );

    render(
      <ModuleSection
        module={module}
        lessons={module.lessons}
        lessonProgress={lessonProgress}
        onStartLesson={() => {}}
        isPrerequisiteMet={true}
      />
    );

    // 折叠状态: lesson 列表不可见
    expect(screen.queryByText('Lesson One')).not.toBeInTheDocument();
    expect(screen.queryByText('Lesson Two')).not.toBeInTheDocument();
  });

  it('点击 header 折叠时写入 localStorage', () => {
    const module = makeModule();
    const lessonProgress: Record<string, LessonProgress> = {
      'mod1-l1': makeProgress({ status: 'available' }),
      'mod1-l2': makeProgress({ status: 'locked' }),
    };

    // 默认展开 (含 available lesson)
    render(
      <ModuleSection
        module={module}
        lessons={module.lessons}
        lessonProgress={lessonProgress}
        onStartLesson={() => {}}
        isPrerequisiteMet={true}
      />
    );

    // 初始: lesson 可见 (展开)
    expect(screen.getByText('Lesson One')).toBeInTheDocument();

    // 点击 header 折叠
    const header = screen.getByRole('button', { name: /Test Module A1/i });
    fireEvent.click(header);

    // 折叠后: lesson 不可见
    expect(screen.queryByText('Lesson One')).not.toBeInTheDocument();

    // localStorage 应记录折叠状态
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, boolean>;
    expect(stored['test-module']).toBe(true);
  });

  it('再次点击展开时 localStorage 更新为 false', () => {
    const module = makeModule();
    const lessonProgress: Record<string, LessonProgress> = {
      'mod1-l1': makeProgress({ status: 'available' }),
    };

    render(
      <ModuleSection
        module={module}
        lessons={module.lessons}
        lessonProgress={lessonProgress}
        onStartLesson={() => {}}
        isPrerequisiteMet={true}
      />
    );

    const header = screen.getByRole('button', { name: /Test Module A1/i });

    // 折叠
    fireEvent.click(header);
    // 展开
    fireEvent.click(header);

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, boolean>;
    expect(stored['test-module']).toBe(false);
  });
});

// ============================================================================
// T06: CoursePathPage 路由 hash '#/course' 可访问 [critical, integration]
// ============================================================================

describe('T06: 路由 #/course 注册', () => {
  it('VALID_APP_MODES 包含 course', () => {
    expect(VALID_APP_MODES).toContain('course');
  });

  it('App.tsx 导入并渲染 CoursePathPage (源码静态检查)', () => {
    const appSource = readFileSync(
      resolve(__dirname, '../../../App.tsx'),
      'utf-8'
    );

    // v0.4.0-harmony Stage 3 (D3): CoursePathPage 改为 React.lazy 动态导入.
    // 匹配 lazy(() => import('...CoursePathPage')) 模式 (兼容旧静态 import 写法).
    expect(appSource).toMatch(/(?:import\s+\{[^}]*CoursePathPage[^}]*\}\s+from|import\(['"][^']*CoursePathPage['"]\))[^;]*CoursePathPage/);

    // 应有 appMode === 'course' 分支
    expect(appSource).toMatch(/appMode\s*===\s*['"]course['"]/);
  });

  it('useAppModeStore AppMode 类型含 course', () => {
    // 通过 VALID_APP_MODES 间接验证 (类型在编译时检查)
    expect(VALID_APP_MODES).toContain('course');
  });
});

// ============================================================================
// T07: LessonCard 进度条展示 wordsEncountered/targetLemmas.length [non-critical]
// ============================================================================

describe('T07: LessonCard 进度条', () => {
  it('in-progress 状态展示进度文本 wordsEncountered/total', () => {
    const lesson = makeLesson({
      targetLemmas: ['a', 'b', 'c', 'd', 'e'],
    });
    const progress = makeProgress({
      status: 'in-progress',
      wordsEncountered: ['a', 'b'],
    });

    render(
      <LessonCard lesson={lesson} progress={progress} onStartLesson={() => {}} />
    );

    // 进度文本: 2/5
    expect(screen.getByText('2/5')).toBeInTheDocument();
  });

  it('progressbar 含正确的 aria-valuenow / aria-valuemax', () => {
    const lesson = makeLesson({
      targetLemmas: ['a', 'b', 'c', 'd'],
    });
    const progress = makeProgress({
      status: 'in-progress',
      wordsEncountered: ['a', 'b', 'c'],
    });

    render(
      <LessonCard lesson={lesson} progress={progress} onStartLesson={() => {}} />
    );

    const progressbar = screen.getByRole('progressbar');
    expect(progressbar).toHaveAttribute('aria-valuenow', '3');
    expect(progressbar).toHaveAttribute('aria-valuemin', '0');
    expect(progressbar).toHaveAttribute('aria-valuemax', '4');
  });

  it('completed 状态也展示进度条 (满进度)', () => {
    const lesson = makeLesson({
      targetLemmas: ['a', 'b', 'c'],
    });
    const progress = makeProgress({
      status: 'completed',
      wordsEncountered: ['a', 'b', 'c'],
      completedAt: Date.now(),
    });

    render(
      <LessonCard lesson={lesson} progress={progress} onStartLesson={() => {}} />
    );

    // 满进度: 3/3
    expect(screen.getByText('3/3')).toBeInTheDocument();
  });

  it('available 状态不展示进度条 (尚未开始)', () => {
    const lesson = makeLesson({
      targetLemmas: ['a', 'b', 'c'],
    });
    const progress = makeProgress({
      status: 'available',
      wordsEncountered: [],
    });

    render(
      <LessonCard lesson={lesson} progress={progress} onStartLesson={() => {}} />
    );

    // available 状态不渲染 progressbar
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});

// ============================================================================
// T08: prefers-reduced-motion CSS 含 @media query [critical]
// ============================================================================

describe('T08: prefers-reduced-motion CSS 降级', () => {
  const cssFiles = [
    { name: 'CoursePathPage.module.css', path: './CoursePathPage.module.css' },
    { name: 'LessonCard.module.css', path: './LessonCard.module.css' },
    { name: 'ModuleSection.module.css', path: './ModuleSection.module.css' },
  ];

  for (const css of cssFiles) {
    it(`${css.name} 含 @media (prefers-reduced-motion: reduce)`, () => {
      const content = readFileSync(resolve(__dirname, css.path), 'utf-8');
      expect(content).toContain('@media (prefers-reduced-motion: reduce)');
    });
  }

  it('LessonCard.module.css 进度条 transition 在 reduced-motion 下被禁用', () => {
    const content = readFileSync(
      resolve(__dirname, './LessonCard.module.css'),
      'utf-8'
    );
    // reduced-motion 块内应禁用 transition (进度条动画降级)
    const reducedMotionBlock = content.match(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}/
    );
    expect(reducedMotionBlock).not.toBeNull();
    expect(reducedMotionBlock?.[1]).toMatch(/transition:\s*none/);
  });
});
