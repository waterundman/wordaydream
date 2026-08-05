/**
 * v2.3.0 Stage 5 — CurrentLessonCard 测试 (TDD)
 *
 * 覆盖 test_spec:
 * - T01 [critical]: 无 currentLesson 时渲染卡片 + "选择课程" CTA 标题
 * - T02 [critical]: 无 currentLesson 时展示 "浏览课程" 按钮 (data-testid)
 * - T03 [critical]: 无 currentLesson 时点击 "浏览课程" 跳转 '#/course'
 * - T04 [critical]: 有 currentLesson 时渲染 lesson.title + Module.title
 * - T05 [critical]: 有 currentLesson 时展示进度环 + 正确 aria 值 + 百分比
 * - T06 [critical]: 点击 "继续学习" 调用 loadSession(language, difficulty, lessonId)
 * - T07 [critical]: 点击 "查看课程" 跳转 '#/course'
 * - T08 [critical]: prefers-reduced-motion CSS 含 @media query
 *
 * 框架: vitest + @testing-library/react
 * 策略:
 * - 用真实 useCourseStore + enrollCourse/startLesson 控制课程状态
 * - useReadingSessionStore.setState 注入 mock loadSession + lastConfig
 * - useSettingsStore.setState 控制 difficulty
 * - T08 用 readFileSync 读取 CSS 文件, 验证 @media (prefers-reduced-motion: reduce) 存在
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { CurrentLessonCard } from './CurrentLessonCard';
import { useCourseStore } from '../course/store/useCourseStore';
import { useReadingSessionStore } from '../reading/store/useReadingSessionStore';
import { useSettingsStore } from '../settings/store/useSettingsStore';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================================================
// 保存原始 store 状态, 测试后恢复
// ============================================================================

const originalLoadSession = useReadingSessionStore.getState().loadSession;
const originalLastConfig = useReadingSessionStore.getState().lastConfig;
const originalDifficulty = useSettingsStore.getState().difficulty;

// loadSession mock (每个 beforeEach 重新创建)
let loadSessionSpy: ReturnType<typeof vi.fn>;

// ============================================================================
// Setup / Cleanup
// ============================================================================

beforeEach(() => {
  // 重置课程 store
  useCourseStore.getState().resetProgress();
  // 注入 mock loadSession + lastConfig (避免真实 LLM 调用)
  loadSessionSpy = vi.fn().mockResolvedValue(undefined);
  useReadingSessionStore.setState({
    lastConfig: { language: 'en', difficulty: 1 },
    loadSession: loadSessionSpy,
  });
  // 设置 difficulty 为 1 (A1, 与课程首 Module 匹配)
  useSettingsStore.setState({ difficulty: 1 });
  // 清理 hash
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
  // 恢复原始 store 状态
  useReadingSessionStore.setState({
    lastConfig: originalLastConfig,
    loadSession: originalLoadSession,
  });
  useSettingsStore.setState({ difficulty: originalDifficulty });
  window.location.hash = '';
});

// ============================================================================
// Helper: 注册课程 + 开始首课, 返回 lessonId
// ============================================================================

/** 注册 en-from-zh 课程并开始第一个可用课时, 返回 lessonId */
function setupCurrentLesson(): string {
  useCourseStore.getState().enrollCourse('en-from-zh');
  const progress = useCourseStore.getState().lessonProgress;
  const firstLessonId = Object.keys(progress).find(
    (id) => progress[id].status === 'available',
  );
  if (!firstLessonId) throw new Error('No available lesson found after enrollCourse');
  useCourseStore.getState().startLesson(firstLessonId);
  return firstLessonId;
}

// ============================================================================
// T01: 无 currentLesson 时渲染卡片 + "选择课程" CTA 标题 [critical]
// ============================================================================

describe('T01: 无 currentLesson 时渲染选择课程 CTA', () => {
  it('渲染卡片根元素 (data-testid="current-lesson-card")', () => {
    render(<CurrentLessonCard />);
    expect(screen.getByTestId('current-lesson-card')).toBeInTheDocument();
  });

  it('展示 "选择课程" 标题', () => {
    render(<CurrentLessonCard />);
    expect(screen.getByText('选择课程')).toBeInTheDocument();
  });

  it('展示课程引导文案', () => {
    render(<CurrentLessonCard />);
    expect(
      screen.getByText(/挑选一门课程.*按顺序解锁课时.*系统化地学习词汇/),
    ).toBeInTheDocument();
  });
});

// ============================================================================
// T02: 无 currentLesson 时展示 "浏览课程" 按钮 [critical]
// ============================================================================

describe('T02: 无 currentLesson 时展示浏览课程按钮', () => {
  it('渲染 "浏览课程" 按钮 (data-testid="current-lesson-browse")', () => {
    render(<CurrentLessonCard />);
    expect(screen.getByTestId('current-lesson-browse')).toBeInTheDocument();
  });

  it('按钮文字为 "浏览课程"', () => {
    render(<CurrentLessonCard />);
    expect(screen.getByRole('button', { name: '浏览课程' })).toBeInTheDocument();
  });

  it('无 currentLesson 时不渲染 "继续学习" 按钮', () => {
    render(<CurrentLessonCard />);
    expect(screen.queryByTestId('current-lesson-continue')).not.toBeInTheDocument();
  });

  it('无 currentLesson 时不渲染进度环', () => {
    render(<CurrentLessonCard />);
    expect(screen.queryByTestId('current-lesson-progress-ring')).not.toBeInTheDocument();
  });
});

// ============================================================================
// T03: 无 currentLesson 时点击 "浏览课程" 跳转 '#/course' [critical]
// ============================================================================

describe('T03: 点击浏览课程跳转课程页', () => {
  it('点击 "浏览课程" 设置 window.location.hash 为 "#/course"', () => {
    render(<CurrentLessonCard />);
    const btn = screen.getByTestId('current-lesson-browse');
    fireEvent.click(btn);
    expect(window.location.hash).toBe('#/course');
  });
});

// ============================================================================
// T04: 有 currentLesson 时渲染 lesson.title + Module.title [critical]
// ============================================================================

describe('T04: 有 currentLesson 时渲染课时信息', () => {
  it('渲染课时标题 (lesson.title)', () => {
    setupCurrentLesson();
    render(<CurrentLessonCard />);
    // en-from-zh 首课标题: 'Playing in the Park'
    expect(screen.getByText('Playing in the Park')).toBeInTheDocument();
  });

  it('渲染 Module 标题 (eyebrow)', () => {
    setupCurrentLesson();
    render(<CurrentLessonCard />);
    // en-a1 Module 标题: 'English A1 — Beginner'
    expect(screen.getByText('English A1 — Beginner')).toBeInTheDocument();
  });

  it('渲染 "Module > Lesson" 副标题', () => {
    setupCurrentLesson();
    render(<CurrentLessonCard />);
    expect(
      screen.getByText('English A1 — Beginner > Playing in the Park'),
    ).toBeInTheDocument();
  });

  it('有 currentLesson 时不渲染 "选择课程" CTA', () => {
    setupCurrentLesson();
    render(<CurrentLessonCard />);
    expect(screen.queryByText('选择课程')).not.toBeInTheDocument();
  });
});

// ============================================================================
// T05: 有 currentLesson 时展示进度环 + 正确 aria 值 [critical]
// ============================================================================

describe('T05: 有 currentLesson 时展示进度环', () => {
  it('渲染进度环 (data-testid="current-lesson-progress-ring")', () => {
    setupCurrentLesson();
    render(<CurrentLessonCard />);
    expect(screen.getByTestId('current-lesson-progress-ring')).toBeInTheDocument();
  });

  it('进度环含正确 aria-valuenow (默认 0)', () => {
    setupCurrentLesson();
    render(<CurrentLessonCard />);
    const ring = screen.getByTestId('current-lesson-progress-ring');
    // 刚 startLesson, wordsLearned 为空 → 0
    expect(ring).toHaveAttribute('aria-valuenow', '0');
  });

  it('进度环含正确 aria-valuemax (= targetLemmas.length = 15)', () => {
    setupCurrentLesson();
    render(<CurrentLessonCard />);
    const ring = screen.getByTestId('current-lesson-progress-ring');
    expect(ring).toHaveAttribute('aria-valuemax', '15');
  });

  it('进度环含正确 aria-valuemin (= 0)', () => {
    setupCurrentLesson();
    render(<CurrentLessonCard />);
    const ring = screen.getByTestId('current-lesson-progress-ring');
    expect(ring).toHaveAttribute('aria-valuemin', '0');
  });

  it('默认进度 0% 显示在环内', () => {
    setupCurrentLesson();
    render(<CurrentLessonCard />);
    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it('学会 3 词后进度显示 20%', () => {
    const lessonId = setupCurrentLesson();
    // 手动注入 wordsLearned (3/15 = 20%)
    const progress = useCourseStore.getState().lessonProgress[lessonId];
    useCourseStore.setState({
      lessonProgress: {
        ...useCourseStore.getState().lessonProgress,
        [lessonId]: {
          ...progress,
          wordsLearned: ['be', 'have', 'do'],
        },
      },
    });

    render(<CurrentLessonCard />);
    expect(screen.getByText('20%')).toBeInTheDocument();

    const ring = screen.getByTestId('current-lesson-progress-ring');
    expect(ring).toHaveAttribute('aria-valuenow', '3');
  });
});

// ============================================================================
// T06: 点击 "继续学习" 调用 loadSession(language, difficulty, lessonId) [critical]
// ============================================================================

describe('T06: 点击继续学习调用 loadSession', () => {
  it('渲染 "继续学习" 按钮 (data-testid="current-lesson-continue")', () => {
    setupCurrentLesson();
    render(<CurrentLessonCard />);
    expect(screen.getByTestId('current-lesson-continue')).toBeInTheDocument();
  });

  it('点击 "继续学习" 调用 loadSession 一次', () => {
    setupCurrentLesson();
    render(<CurrentLessonCard />);
    fireEvent.click(screen.getByTestId('current-lesson-continue'));
    expect(loadSessionSpy).toHaveBeenCalledTimes(1);
  });

  it('loadSession 参数为 (language, difficulty, currentLessonId)', () => {
    const lessonId = setupCurrentLesson();
    render(<CurrentLessonCard />);
    fireEvent.click(screen.getByTestId('current-lesson-continue'));
    // language='en' (来自 lastConfig), difficulty=1 (来自 settings), lessonId
    expect(loadSessionSpy).toHaveBeenCalledWith('en', 1, lessonId);
  });
});

// ============================================================================
// T07: 点击 "查看课程" 跳转 '#/course' [critical]
// ============================================================================

describe('T07: 点击查看课程跳转课程页', () => {
  it('渲染 "查看课程" 按钮 (data-testid="current-lesson-view-course")', () => {
    setupCurrentLesson();
    render(<CurrentLessonCard />);
    expect(screen.getByTestId('current-lesson-view-course')).toBeInTheDocument();
  });

  it('点击 "查看课程" 设置 window.location.hash 为 "#/course"', () => {
    setupCurrentLesson();
    render(<CurrentLessonCard />);
    fireEvent.click(screen.getByTestId('current-lesson-view-course'));
    expect(window.location.hash).toBe('#/course');
  });
});

// ============================================================================
// T08: prefers-reduced-motion CSS 含 @media query [critical]
// ============================================================================

describe('T08: prefers-reduced-motion CSS 降级', () => {
  const cssFiles = [
    {
      name: 'CurrentLessonCard.module.css',
      path: './CurrentLessonCard.module.css',
    },
    {
      name: 'LessonCompleteModal.module.css',
      path: '../course/components/LessonCompleteModal.module.css',
    },
  ];

  for (const css of cssFiles) {
    it(`${css.name} 含 @media (prefers-reduced-motion: reduce)`, () => {
      const content = readFileSync(resolve(__dirname, css.path), 'utf-8');
      expect(content).toContain('@media (prefers-reduced-motion: reduce)');
    });
  }

  it('CurrentLessonCard.module.css 进度环 transition 在 reduced-motion 下被禁用', () => {
    const content = readFileSync(
      resolve(__dirname, './CurrentLessonCard.module.css'),
      'utf-8',
    );
    // reduced-motion 块内应禁用 transition
    const reducedMotionBlock = content.match(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}/,
    );
    expect(reducedMotionBlock).not.toBeNull();
    expect(reducedMotionBlock?.[1]).toMatch(/transition:\s*none/);
  });
});
