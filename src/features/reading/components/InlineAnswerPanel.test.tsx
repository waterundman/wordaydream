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
vi.mock('../hooks/usePageEntranceAnimation', () => ({
  usePageEntranceAnimation: () => ({ getStyle: () => ({}) }),
}));
vi.mock('../hooks/useVocabPulseAnimation', () => ({
  useVocabPulseAnimation: () => ({ className: '', triggerPulse: vi.fn() }),
}));
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

    // v2.2.1 Bug 3 修复: partial 时也标记 resolved (之前仅 correct 时标记)
    expect(markOccurrenceResolvedSpy).toHaveBeenCalledWith(token.id);
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

    render(<InlineAnswerPanel token={token} language="en" />);

    // 输入答案并提交
    const input = screen.getByLabelText('释义输入') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '变革' } });
    const submitBtn = screen.getByText('确认');
    fireEvent.click(submitBtn);

    // 等待异步 evaluateAnswer 完成
    await waitFor(() => {
      expect(evaluateAnswer).toHaveBeenCalledTimes(1);
    });

    // partial 时不建立记忆卡片 (记忆卡片只记录答对的词)
    expect(addCardFromTokenSpy).not.toHaveBeenCalled();
    // 但 markOccurrenceResolved 被调用 (Bug 3 修复: 进度条推进)
    expect(markOccurrenceResolvedSpy).toHaveBeenCalledWith(token.id);
  });
});
