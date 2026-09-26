/**
 * InlineAnswerPanel 测试 (v2.2.1 Stage 2 Bug 3 — T09, T10, T11)
 *
 * 覆盖 SPEC Stage 2 Bug 3 门控点修复:
 * - T09 [critical]: handleSubmit 在 grade='partial' 时也调用 markOccurrenceResolved
 * - T10 [critical]: handleSubmit 在 grade='correct' 时调用 addCardFromToken
 * - T11 [non-critical]: handleSubmit 在 grade='partial' 时不调用 addCardFromToken
 *
 * 设计:
 * - vi.mock evaluateAnswer 拦截评估结果, 控制 grade 返回值
 * - vi.mock RemedyPanel / RatingBar 避免 子组件依赖
 * - vi.mock usePanelPosition / usePageEntranceAnimation / useVocabPulseAnimation 避免 jsdom 布局问题
 * - useReadingSessionStore / useMemoryStore / useWordlistStore 用 setState 注入 spy
 * - stub window.matchMedia (hooks 依赖)
 */
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';
import type { TokenOccurrence, AnswerEvaluation } from '../../../types';

// 拦截 evaluateAnswer, 控制 grade 返回值
vi.mock('../../evaluation/services/evaluateAnswer', () => ({
  evaluateAnswer: vi.fn(),
}));

// 拦截子组件, 避免其内部依赖影响测试
vi.mock('../../evaluation/components/RemedyPanel', () => ({
  RemedyPanel: () => null,
}));
vi.mock('../../review/components/RatingBar', () => ({
  RatingBar: () => null,
}));

// 拦截 hooks, 避免 jsdom 布局问题
// v1.6.3 UX-fix: usePageEntranceAnimation / useVocabPulseAnimation 已从面板移除 (死代码), mock 一并删除.
vi.mock('../../../hooks/usePanelPosition', () => ({
  usePanelPosition: () => ({ vertical: 'bottom', horizontal: 'center', offsetX: 0 }),
}));

import { InlineAnswerPanel } from './InlineAnswerPanel';
import { evaluateAnswer } from '../../evaluation/services/evaluateAnswer';
import { useReadingSessionStore } from '../store/useReadingSessionStore';
import { useMemoryStore } from '../../review/store/useMemoryStore';
import { useWordlistStore } from '../../wordlist/store/useWordlistStore';

// jsdom 默认不实现 matchMedia, hooks 在 useEffect 启动时会调用它.
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

function makeToken(overrides: Partial<TokenOccurrence> = {}): TokenOccurrence {
  return {
    id: 'tok-test-1',
    lexemeGroupId: 'lg-test-1',
    surfaceForm: 'revolution',
    lemma: 'revolution',
    objectiveDifficulty: 3,
    startIndex: 0,
    endIndex: 10,
    isResolved: false,
    isActive: false,
    kind: 'normal',
    isCompound: false,
    ...overrides,
  };
}

describe('v2.2.1 Stage 2 Bug 3 — InlineAnswerPanel handleSubmit 门控点 (T09, T10, T11)', () => {
  let markOccurrenceResolvedSpy: ReturnType<typeof vi.fn>;
  let addCardFromTokenSpy: ReturnType<typeof vi.fn>;
  let getCardByLexemeGroupSpy: ReturnType<typeof vi.fn>;
  let recordEncounterSpy: ReturnType<typeof vi.fn>;
  let setActiveOccurrenceSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(evaluateAnswer).mockReset();

    markOccurrenceResolvedSpy = vi.fn();
    setActiveOccurrenceSpy = vi.fn();
    addCardFromTokenSpy = vi.fn();
    getCardByLexemeGroupSpy = vi.fn(() => undefined);
    recordEncounterSpy = vi.fn();

    // 注入 spy 到 reading session store
    useReadingSessionStore.setState({
      session: null,
      activeOccurrenceId: null,
      markOccurrenceResolved: markOccurrenceResolvedSpy,
      setActiveOccurrence: setActiveOccurrenceSpy,
    } as never);

    // 注入 spy 到 memory store
    useMemoryStore.setState({
      addCardFromToken: addCardFromTokenSpy,
      getCardByLexemeGroup: getCardByLexemeGroupSpy,
      rateCard: vi.fn(),
    } as never);

    // 注入 spy 到 wordlist store
    useWordlistStore.setState({
      recordEncounter: recordEncounterSpy,
    } as never);
  });

  afterEach(() => {
    cleanup();
  });

  it('v2.2.1-T09 [critical]: handleSubmit 在 grade=partial 时也调用 markOccurrenceResolved', async () => {
    const token = makeToken();
    const partialEvaluation: AnswerEvaluation = {
      grade: 'partial',
      feedback: '部分正确，继续努力。',
      source: 'heuristic',
    };
    vi.mocked(evaluateAnswer).mockResolvedValue(partialEvaluation);

    // v2.2.4 Stage 3: partial 时 markOccurrenceResolved 延迟 3500ms, 用 fake timers 快进
    vi.useFakeTimers();
    render(<InlineAnswerPanel token={token} language="en" />);

    // 输入答案并提交
    const input = screen.getByLabelText('释义输入') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '革命' } });
    fireEvent.click(screen.getByText('确认'));

    // 快进 3500ms 触发 markOccurrenceResolved (flush microtasks + timers)
    await vi.advanceTimersByTimeAsync(3500);
    vi.useRealTimers();

    // v2.2.1 Bug 3 修复: partial 时也标记 resolved (之前仅 correct 时标记)
    // v2.2.4 Stage 3 (Bug 13): markOccurrenceResolved 现在接受 grade 参数
    expect(markOccurrenceResolvedSpy).toHaveBeenCalledWith(token.id, 'partial');
    // partial 时不建记忆卡片
    expect(addCardFromTokenSpy).not.toHaveBeenCalled();
  });

  it('v2.2.1-T10 [critical]: handleSubmit 在 grade=correct 时调用 addCardFromToken', async () => {
    const token = makeToken();
    const correctEvaluation: AnswerEvaluation = {
      grade: 'correct',
      feedback: '回答正确。',
      source: 'heuristic',
    };
    vi.mocked(evaluateAnswer).mockResolvedValue(correctEvaluation);
    // getCardByLexemeGroup 返回 undefined (无已有卡片) → addCardFromToken 会被调用
    getCardByLexemeGroupSpy.mockReturnValue(undefined);

    render(<InlineAnswerPanel token={token} language="en" />);

    // 输入答案并提交
    const input = screen.getByLabelText('释义输入') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '革命' } });
    const submitBtn = screen.getByText('确认');
    fireEvent.click(submitBtn);

    // 等待异步 evaluateAnswer 完成
    await waitFor(() => {
      expect(evaluateAnswer).toHaveBeenCalledTimes(1);
    });

    // correct 时调用 addCardFromToken 建立记忆卡片
    expect(addCardFromTokenSpy).toHaveBeenCalledWith(token, 'en');
  });

  it('v2.2.1-T11 [non-critical]: handleSubmit 在 grade=partial 时不调用 addCardFromToken', async () => {
    const token = makeToken();
    const partialEvaluation: AnswerEvaluation = {
      grade: 'partial',
      feedback: '部分正确。',
      source: 'heuristic',
    };
    vi.mocked(evaluateAnswer).mockResolvedValue(partialEvaluation);

    // v2.2.4 Stage 3: partial 时 markOccurrenceResolved 延迟 3500ms, 用 fake timers 快进
    vi.useFakeTimers();
    render(<InlineAnswerPanel token={token} language="en" />);

    // 输入答案并提交
    const input = screen.getByLabelText('释义输入') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '变革' } });
    fireEvent.click(screen.getByText('确认'));

    // 快进 3500ms 触发 markOccurrenceResolved
    await vi.advanceTimersByTimeAsync(3500);
    vi.useRealTimers();

    // partial 时不建立记忆卡片 (记忆卡片只记录答对的词)
    expect(addCardFromTokenSpy).not.toHaveBeenCalled();
    // 但 markOccurrenceResolved 被调用 (Bug 3 修复: 进度条推进)
    // v2.2.4 Stage 3 (Bug 13): markOccurrenceResolved 现在接受 grade 参数
    expect(markOccurrenceResolvedSpy).toHaveBeenCalledWith(token.id, 'partial');
  });
});

describe('v1.6.3 UX-fix — 面板定位契约 (inline style 不再与 CSS 定位竞争)', () => {
  it('面板根元素 style 携带 --panel-shift-x 且不含 animation / opacity / transform (防 fill-forwards 压死定位回归)', () => {
    const token = makeToken();
    const { container } = render(<InlineAnswerPanel token={token} language="en" />);

    const panel = container.firstElementChild as HTMLElement;
    // 定位变量按 usePanelPosition mock (center, offsetX=0) 输出
    expect(panel.style.getPropertyValue('--panel-shift-x')).toBe('calc(-50% + 0px)');
    // 关键不变量: inline 不得声明 animation / opacity / transform ——
    // 任何一项都会在级联上与 .panel.open 的 transform: translateX(...) 竞争
    // (此前 pageEntrance fill-forwards 终态无 translateX(-50%), 面板右漂半宽 → 乱跑 + 卡顿).
    expect(panel.style.animation).toBe('');
    expect(panel.style.opacity).toBe('');
    expect(panel.style.transform).toBe('');
  });

  it('面板挂载即 focus 输入框, 且仅挂载时执行一次 (无 triggerPulse 链路)', () => {
    const token = makeToken();
    const { container, rerender } = render(<InlineAnswerPanel token={token} language="en" />);
    const input = container.querySelector('input');
    expect(document.activeElement).toBe(input);

    // 重渲染 (模拟 keystroke) 不应改变焦点归属
    rerender(<InlineAnswerPanel token={token} language="en" />);
    expect(document.activeElement).toBe(input);
  });
});
