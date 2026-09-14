/**
 * ReadingCompleteOverlay 测试 (v1.5.0 S2)
 *
 * 覆盖 SPEC v1.5.0 合同 C2.1-C2.2:
 * - T01 [C2.1] stats 无 session 字段 → 会话统计行不渲染 (向后兼容既有调用方)
 * - T02 [C2.2] stats.session 存在 → 统计行文案 + testid; reviewWords>0 含复习段
 * - T03 [C2.2] reviewWords=0 → 省略复习段
 *
 * 实现策略: 直接 render Overlay (visible=true)。jsdom 无 matchMedia → stub
 * (matches: false 走动画分支, 但统计行 DOM 始终挂载, CSS 淡入不影响 textContent 断言)。
 * 该组件此前无独立测试文件, 本文件为 v1.5.0 新建 (沿 ReadingSessionPage.test.tsx
 * 的 matchMedia stub 模式)。
 */
import { beforeAll, afterEach, describe, expect, it } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ReadingCompleteOverlay } from './ReadingCompleteOverlay';
import type { ReadingSessionStats } from '../../features/reading/readingSummary';

beforeAll(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    });
  }
});

afterEach(() => {
  cleanup();
});

const BASE_STATS = { minutesRead: 5, articlesRead: 3 };

describe('ReadingCompleteOverlay 会话统计行 (v1.5.0 S2)', () => {
  it('T01 [C2.1] 无 session 字段 → 统计行不渲染 (向后兼容)', () => {
    render(<ReadingCompleteOverlay visible={true} stats={BASE_STATS} />);
    expect(screen.getByText('今日阅读 5 分钟 · 3 篇文章')).toBeTruthy();
    expect(screen.queryByTestId('reading-complete-session-stats')).toBeNull();
  });

  it('T02 [C2.2] 有 session → 统计行文案正确, reviewWords>0 含复习段', () => {
    const session: ReadingSessionStats = {
      totalWords: 7,
      correctWords: 6,
      wrongWords: 1,
      reviewWords: 2,
    };
    render(<ReadingCompleteOverlay visible={true} stats={{ ...BASE_STATS, session }} />);
    const row = screen.getByTestId('reading-complete-session-stats');
    expect(row.textContent).toBe('本篇生词 7 个 · 答对 6 · 答错 1 · 复习 2');
  });

  it('T03 [C2.2] reviewWords=0 → 省略复习段', () => {
    const session: ReadingSessionStats = {
      totalWords: 3,
      correctWords: 2,
      wrongWords: 1,
      reviewWords: 0,
    };
    render(<ReadingCompleteOverlay visible={true} stats={{ ...BASE_STATS, session }} />);
    const row = screen.getByTestId('reading-complete-session-stats');
    expect(row.textContent).toBe('本篇生词 3 个 · 答对 2 · 答错 1');
  });
});
