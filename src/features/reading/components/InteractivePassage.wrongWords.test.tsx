/**
 * v1.2.0 Stage 1: 阅读流 ↔ 错词本联动高亮测试
 *
 * 覆盖 test_spec:
 * - T01: 预置 useWrongWordsStore 1 条 (lemma 与 passage 中某 token 匹配)
 *        → 该 token span 渲染错词标记类 (class + data-wrong-count 断言)
 * - T02: 命中 token 的 tooltip 文案含 "错词 · 累计 3 次" (wrongCount=3)
 * - T03: 非错词 token 无标记类 (零视觉变化)
 * - T04: 点击命中错词 token → InlineAnswerPanel 打开 (交互零变更)
 * - T05: 运行中新增错词 (recordWrong) → 标记即时出现 (订阅式生效)
 * - T06: lexemeGroupId 精确口径优先 (surfaceForm 为变体时仍命中,
 *        验证 'lg:' 键优先于 'sf:' 键)
 *
 * 渲染手法沿 InteractivePassage.test.tsx:
 * - useReadingSessionStore.setState 直接注入 session
 * - TooltipProvider delayDuration={0} + fireEvent.pointerMove + waitFor
 *   触发 Radix Tooltip (jsdom 无真实弹层, portal 到 document.body 用 screen 查)
 * - vi.mock CSS module (css:false 下 styles 为空对象), 断言 mock 类名
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { TooltipProvider } from '@radix-ui/react-tooltip';
import { InteractivePassage } from './InteractivePassage';
import { useReadingSessionStore } from '../store/useReadingSessionStore';
import { useWrongWordsStore } from '../../review/store/useWrongWordsStore';
import type {
  Passage,
  ReadingSession,
  TokenOccurrence,
  MemoryCard,
  Language,
} from '../../../types';

vi.mock('./InteractivePassage.module.css', () => ({
  default: {
    passage: 'passage',
    title: 'title',
    text: 'text',
    paragraph: 'paragraph',
    visible: 'visible',
    paragraphActive: 'paragraphActive',
    empty: 'empty',
    tokenWrapper: 'tokenWrapper',
    focused: 'focused',
    tokenReplay: 'tokenReplay',
    alignmentTooltip: 'alignmentTooltip',
    wrongWordMark: 'wrongWordMark',
  },
}));

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

function makeSession(text: string, language: Language = 'en', tokens: TokenOccurrence[] = []): ReadingSession {
  const passage: Passage = {
    id: `test-passage-${Date.now()}`,
    language,
    difficulty: 2,
    text,
    tokens,
    lexemeGroups: [],
    grammarPoints: [],
  };
  return {
    id: `test-session-${Date.now()}`,
    language,
    difficulty: 2,
    passage,
    startedAt: Date.now(),
    resolvedTokens: new Set(),
    activeOccurrenceId: null,
  };
}

function makeToken(
  surfaceForm: string,
  startIndex: number,
  overrides: Partial<TokenOccurrence> = {},
): TokenOccurrence {
  return {
    id: `tok-${startIndex}`,
    lexemeGroupId: `lg-${surfaceForm}`,
    surfaceForm,
    lemma: surfaceForm,
    objectiveDifficulty: 2,
    startIndex,
    endIndex: startIndex + surfaceForm.length,
    isResolved: false,
    isActive: false,
    kind: 'normal',
    isCompound: false,
    ...overrides,
  };
}

function makeCard(overrides: Partial<MemoryCard> = {}): MemoryCard {
  const now = Date.now();
  return {
    id: 'card-1',
    lexemeGroupId: 'lg-cat',
    lemma: 'cat',
    objectiveDifficulty: 2,
    language: 'en',
    firstLearnedAt: now,
    lastReviewAt: now,
    due: now,
    stability: 1,
    difficulty: 5,
    elapsedDays: 0,
    scheduledDays: 1,
    reps: 1,
    lapses: 0,
    status: 'review',
    learningSteps: 0,
    ...overrides,
  };
}

/** 找到 surfaceForm 对应 token 的 TokenSpan wrapper (沿 InteractivePassage.test.tsx 手法) */
function findTokenWrapper(surfaceForm: string): HTMLElement {
  const buttons = Array.from(document.body.querySelectorAll('[role="button"]'));
  const btn = buttons.find(
    (b) => b.getAttribute('aria-label') === surfaceForm,
  ) as HTMLElement | undefined;
  if (!btn) {
    throw new Error(`Could not find token trigger for surfaceForm=${surfaceForm}`);
  }
  let ancestor: HTMLElement | null = btn.parentElement;
  const spanAncestors: HTMLElement[] = [];
  while (ancestor) {
    if (ancestor.tagName === 'SPAN') {
      spanAncestors.push(ancestor);
      if (spanAncestors.length >= 2) break;
    }
    ancestor = ancestor.parentElement;
  }
  if (spanAncestors.length < 2) {
    throw new Error(`Could not find TokenSpan wrapper for surfaceForm=${surfaceForm}`);
  }
  return spanAncestors[1];
}

function renderWithTooltip(ui: React.ReactElement) {
  return render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);
}

beforeEach(() => {
  useReadingSessionStore.setState({
    session: null,
    activeOccurrenceId: null,
    hoveredGroupId: null,
    activeGrammarPointId: null,
    hoveredGrammarTypeId: null,
    isLoading: false,
    lastConfig: null,
    currentHistoryId: null,
  });
  // 错词本清空 (persist store, setState 直改内存态)
  useWrongWordsStore.setState({ entries: [] });
});

afterEach(() => {
  cleanup();
  useWrongWordsStore.setState({ entries: [] });
});

describe('InteractivePassage 错词联动高亮 (v1.2.0 Stage 1)', () => {
  it('T01 [critical]: 错词本 lemma 命中 token → 该 token 渲染错词标记类', () => {
    const text = 'The cat sat on the mat.';
    // "cat" 在 4-7; token.surfaceForm='cat' 与 entry.lemma='cat' 小写等值 (sf: 口径)
    const token = makeToken('cat', 4);
    useReadingSessionStore.setState({ session: makeSession(text, 'en', [token]) });

    const now = Date.now();
    useWrongWordsStore.setState({
      entries: [
        {
          cardId: 'card-1',
          lexemeGroupId: 'lg-cat',
          lemma: 'cat',
          language: 'en',
          wrongCount: 1,
          lastWrongAt: now,
          firstWrongAt: now,
        },
      ],
    });

    const { container } = renderWithTooltip(<InteractivePassage />);

    const wrapper = container.querySelector('[data-token-id="tok-4"]') as HTMLElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper.className).toContain('wrongWordMark');
    expect(wrapper.getAttribute('data-wrong-count')).toBe('1');
  });

  it('T02 [critical]: 命中 token 的 tooltip 文案含 "错词 · 累计 3 次"', async () => {
    const text = 'The cat sat on the mat.';
    const token = makeToken('cat', 4);
    useReadingSessionStore.setState({ session: makeSession(text, 'en', [token]) });

    const now = Date.now();
    useWrongWordsStore.setState({
      entries: [
        {
          cardId: 'card-1',
          lexemeGroupId: 'lg-cat',
          lemma: 'cat',
          language: 'en',
          wrongCount: 3,
          lastWrongAt: now,
          firstWrongAt: now,
        },
      ],
    });

    renderWithTooltip(<InteractivePassage />);

    const trigger = findTokenWrapper('cat');
    expect(trigger).toBeTruthy();

    await act(async () => {
      fireEvent.pointerMove(trigger, { pointerType: 'mouse' });
    });

    await waitFor(() => {
      expect(screen.queryByRole('tooltip')).toBeInTheDocument();
    });

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.textContent).toContain('错词 · 累计 3 次');
  });

  it('T03 [critical]: 非错词 token 无标记类 (零视觉变化)', () => {
    const text = 'The cat sat on the mat.';
    const tokenCat = makeToken('cat', 4);
    const tokenSat = makeToken('sat', 8);
    useReadingSessionStore.setState({
      session: makeSession(text, 'en', [tokenCat, tokenSat]),
    });

    const now = Date.now();
    useWrongWordsStore.setState({
      entries: [
        {
          cardId: 'card-1',
          lexemeGroupId: 'lg-cat',
          lemma: 'cat',
          language: 'en',
          wrongCount: 1,
          lastWrongAt: now,
          firstWrongAt: now,
        },
      ],
    });

    const { container } = renderWithTooltip(<InteractivePassage />);

    const catWrapper = container.querySelector('[data-token-id="tok-4"]') as HTMLElement;
    const satWrapper = container.querySelector('[data-token-id="tok-8"]') as HTMLElement;
    expect(catWrapper.className).toContain('wrongWordMark');
    // 非错词: 无标记类, 无 data-wrong-count (零视觉变化)
    expect(satWrapper.className).not.toContain('wrongWordMark');
    expect(satWrapper.getAttribute('data-wrong-count')).toBeNull();
  });

  it('T04 [critical]: 点击命中错词 token → InlineAnswerPanel 打开 (交互零变更)', () => {
    const text = 'The cat sat.';
    const token = makeToken('cat', 4);
    useReadingSessionStore.setState({ session: makeSession(text, 'en', [token]) });

    const now = Date.now();
    useWrongWordsStore.setState({
      entries: [
        {
          cardId: 'card-1',
          lexemeGroupId: 'lg-cat',
          lemma: 'cat',
          language: 'en',
          wrongCount: 2,
          lastWrongAt: now,
          firstWrongAt: now,
        },
      ],
    });

    renderWithTooltip(<InteractivePassage />);

    // 错词标记不影响 click → setActiveOccurrence 链路 (showPanel 路径不变)
    const tokenBtn = screen.getByRole('button', { name: 'cat' });
    fireEvent.click(tokenBtn);

    expect(useReadingSessionStore.getState().activeOccurrenceId).toBe('tok-4');
  });

  it('T05 [critical]: 运行中 recordWrong 新增错词 → 标记即时出现 (订阅式生效)', async () => {
    const text = 'The cat sat.';
    const token = makeToken('cat', 4);
    useReadingSessionStore.setState({ session: makeSession(text, 'en', [token]) });

    // 初始: 错词本为空, cat 无标记
    const { container } = renderWithTooltip(<InteractivePassage />);
    const wrapper = container.querySelector('[data-token-id="tok-4"]') as HTMLElement;
    expect(wrapper.className).not.toContain('wrongWordMark');

    // 运行中答错入账 (recordWrong upsert)
    await act(async () => {
      useWrongWordsStore.getState().recordWrong(makeCard(), Date.now());
    });

    // sanity: store 已入账
    expect(useWrongWordsStore.getState().entries).toHaveLength(1);

    // 订阅式: 无需重挂载, 标记即时出现 (重新查询, 规避 React 节点替换)
    const wrapperAfter = container.querySelector('[data-token-id="tok-4"]') as HTMLElement;
    expect(wrapperAfter).not.toBeNull();
    expect(wrapperAfter.className).toContain('wrongWordMark');
    expect(wrapperAfter.getAttribute('data-wrong-count')).toBe('1');
  });

  it('T06 [non-critical]: lexemeGroupId 精确口径优先 (surfaceForm 为变体仍命中)', () => {
    const text = 'The cats sat.';
    // token.surfaceForm='cats' (复数变体, sf: 口径不匹配 lemma='cat'),
    // 但 token.lexemeGroupId 与 entry.lexemeGroupId 相同 → lg: 口径命中
    const token = makeToken('cats', 4, { lemma: 'cat', lexemeGroupId: 'lg-cat' });
    useReadingSessionStore.setState({ session: makeSession(text, 'en', [token]) });

    const now = Date.now();
    useWrongWordsStore.setState({
      entries: [
        {
          cardId: 'card-1',
          lexemeGroupId: 'lg-cat',
          lemma: 'cat',
          language: 'en',
          wrongCount: 5,
          lastWrongAt: now,
          firstWrongAt: now,
        },
      ],
    });

    const { container } = renderWithTooltip(<InteractivePassage />);

    const wrapper = container.querySelector('[data-token-id="tok-4"]') as HTMLElement;
    expect(wrapper.className).toContain('wrongWordMark');
    expect(wrapper.getAttribute('data-wrong-count')).toBe('5');
  });
});
