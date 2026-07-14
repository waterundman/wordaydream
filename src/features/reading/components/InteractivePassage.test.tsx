/**
 * InteractivePassage 段落渲染测试 (Stage 4: T01-T03, Stage 2: T06-T09)
 *
 * 覆盖 test_spec:
 * - T01: passage 含 \n\n -> 渲染 2+ 段
 * - T02: passage 不含 \n\n -> 渲染 1 段
 * - T03: passage 含 \r\n\r\n -> normalizeText 清洗后能正确切分
 * - T06: TokenSpan 含 alignment status (e.g. 'corrected') -> 渲染 tooltip
 * - T07: TokenSpan 不含 alignment status (mock 数据) -> 不渲染 tooltip
 * - T08: hover trigger 触发 aria-describedby
 * - T09: 4 status 文案正确 (perfect/corrected/fallback/dropped)
 *
 * 设计:
 * - 通过 useReadingSessionStore.setState 直接注入 session, 避免走完整 loadSession 链路
 * - 在 jsdom 中渲染组件, 容器 DOM 上 [data-paragraph] 节点数 == 段数
 * - 段内不主动放 token/grammar, 让 segments useMemo 退化为纯 text 段,
 *   这样断言 [data-paragraph] 节点数 === 预期段数, 不受 token/grammar 渲染路径影响
 *
 * 关键不变量 (Stage 4 重构后):
 * - paragraphRanges = text.split(/\n\n+/).filter(p => p.trim().length > 0)
 * - 段间分隔符: \n\n+ (1 个或多个 \n\n), 与 LLM prompt V2 约定一致
 * - \r\n\r\n 不会匹配 \n\n+, 必须先经 Stage 1 normalizeText 转换为 \n\n
 *
 * v1.2.0 P1 Stage 2: Radix Tooltip 集成 (alignment status UI 提示)
 * - 测试组件必须包在 TooltipProvider 内 (delayDuration=0 避免 300ms 等待)
 * - Radix Tooltip 监听 onPointerMove / onFocus, fireEvent.pointerMove + waitFor
 *   是 jsdom 下验证 tooltip 显示的标准方式
 * - Tooltip content 会被 portal 到 document.body, 用 screen 查询更稳
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { TooltipProvider } from '@radix-ui/react-tooltip';
import { InteractivePassage } from './InteractivePassage';
import { useReadingSessionStore } from '../store/useReadingSessionStore';
import { normalizeText } from '../../llm/utils/textNormalize';
import type { Passage, ReadingSession, TokenOccurrence, Language } from '../../../types';

// v2.2.3 Stage 2 (D2): mock CSS module 以便检查段落 visible class (css:false 下 styles 为空对象)
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
  },
}));

// jsdom 默认不实现 matchMedia, usePageEntranceAnimation 在 useEffect 启动时会调用它.
// 提前 stub 掉, 避免 React 渲染阶段抛 TypeError.
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

/**
 * v1.2.0 Stage 2: 构造一个含 alignment status 的 token (模拟 v1.1.0 alignmentValidator 输出).
 * surfaceForm 与 text 中对应子串一致, 保证 segments useMemo 能正确归类为 type='token'.
 */
function makeTokenWithAlignment(
  surfaceForm: string,
  startIndex: number,
  alignmentStatus: TokenOccurrence['alignmentStatus'],
  originalOffset?: number,
): TokenOccurrence {
  return {
    id: `tok-${startIndex}`,
    lexemeGroupId: `lg-${startIndex}`,
    surfaceForm,
    lemma: surfaceForm,
    objectiveDifficulty: 2,
    startIndex,
    endIndex: startIndex + surfaceForm.length,
    isResolved: false,
    isActive: false,
    kind: 'normal',
    isCompound: false,
    alignmentStatus,
    originalOffset,
  };
}

function countParagraphs(container: HTMLElement): number {
  return container.querySelectorAll('[data-paragraph]').length;
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
});

afterEach(() => {
  cleanup();
});

describe('InteractivePassage Stage 4 段落渲染', () => {
  it('T01 [critical]: passage 含 \\n\\n -> 渲染 2+ 段', () => {
    const text = 'First paragraph here.\n\nSecond paragraph follows.\n\nThird one too.';
    useReadingSessionStore.setState({ session: makeSession(text) });

    const { container } = render(<InteractivePassage />);
    const paragraphCount = countParagraphs(container);

    expect(paragraphCount).toBeGreaterThanOrEqual(2);
    // SPEC: 段落数与 split 一致, 此处 3 段
    expect(paragraphCount).toBe(3);
  });

  it('T02 [critical]: passage 不含 \\n\\n -> 渲染 1 段', () => {
    // 真实 LLM 退化输出: 整篇一段, 用 \n 做软换行
    const text = 'This is a single paragraph.\nIt has soft line breaks.\nBut no paragraph separator.';
    useReadingSessionStore.setState({ session: makeSession(text) });

    const { container } = render(<InteractivePassage />);
    const paragraphCount = countParagraphs(container);

    expect(paragraphCount).toBe(1);
  });

  it('T03 [critical]: passage 含 \\r\\n\\r\\n -> normalizeText 清洗后正确切分', () => {
    // 模拟 LLM 在 Windows 风格输出 (Stage 1 之前)
    const rawText = 'Windows paragraph one.\r\n\r\nWindows paragraph two.\r\n\r\nWindows paragraph three.';
    // Stage 1 清洗: \r\n\r\n -> \n\n, 之后 InteractivePassage 切分
    const normalized = normalizeText(rawText);
    expect(normalized).toContain('\n\n');
    // sanity: 清洗后不含 \r
    expect(normalized).not.toContain('\r');

    useReadingSessionStore.setState({ session: makeSession(normalized) });

    const { container } = render(<InteractivePassage />);
    const paragraphCount = countParagraphs(container);

    expect(paragraphCount).toBeGreaterThanOrEqual(2);
    expect(paragraphCount).toBe(3);
  });

  it('T04 [critical]: passage 单段无 \\n\\n -> 兜底注入触发, 渲染 2+ 段', () => {
    // v1.1.0 hotfix: 真实 LLM (DeepSeek) 输出经常不含 \n\n.
    // 兜底逻辑: 按 `[.!?] + 空格` 切分句子, 形成 2-3 段.
    // 与 T02 的区别: T02 用 `.\n` (句号 + 换行), 这里用 `. ` (句号 + 空格).
    const text = 'The cat sat on the mat. The dog ran in the park. The bird flew in the sky.';
    expect(text).not.toContain('\n\n');
    expect(text).toContain('. ');

    useReadingSessionStore.setState({ session: makeSession(text) });

    const { container } = render(<InteractivePassage />);
    const paragraphCount = countParagraphs(container);

    // 兜底注入: 3 个句子 -> 3 段
    expect(paragraphCount).toBeGreaterThanOrEqual(2);
    expect(paragraphCount).toBe(3);

    // 验证段落文本内容正确 (用 .slice 切出与段落对应的子串, 字符位置正确)
    const paragraphs = Array.from(
      container.querySelectorAll('[data-paragraph]')
    ) as HTMLElement[];
    // v1.5.4 fix: 段落边界处的句末空格现在正确包含在段落中.
    const expectedP1 = 'The cat sat on the mat. ';
    const expectedP2 = 'The dog ran in the park. ';
    const expectedP3 = 'The bird flew in the sky.';
    expect(paragraphs[0].textContent).toBe(expectedP1);
    expect(paragraphs[1].textContent).toBe(expectedP2);
    expect(paragraphs[2].textContent).toBe(expectedP3);
  });

  it('T05 [critical]: passage 单段长度 ~100 字符无 \\n\\n -> 兜底注入, 验证分割后字符位置', () => {
    // v1.1.0 hotfix: 长 passage (>= 100 字符) 不含 \n\n 时也能正确分段.
    // 验证点: 段落边界在原 text 坐标中位置正确, 与 token.startIndex 兼容.
    const text =
      'Yesterday, I walked to the market. The sun was shining brightly in the clear blue sky. I bought some fresh fruits and vegetables.';
    expect(text.length).toBeGreaterThanOrEqual(100);
    expect(text).not.toContain('\n\n');

    useReadingSessionStore.setState({ session: makeSession(text) });

    const { container } = render(<InteractivePassage />);
    const paragraphCount = countParagraphs(container);

    expect(paragraphCount).toBeGreaterThanOrEqual(2);

    // 验证每段都是从 text 中正确切出的子串
    const paragraphs = Array.from(
      container.querySelectorAll('[data-paragraph]')
    ) as HTMLElement[];
    const joined = paragraphs.map((p) => p.textContent).join(' ');
    // 拼接后的字符串应包含 text 中的所有句子
    expect(joined).toContain('Yesterday, I walked to the market.');
    expect(joined).toContain('The sun was shining brightly in the clear blue sky.');
    expect(joined).toContain('I bought some fresh fruits and vegetables.');
  });
});

/**
 * Stage 2 P1: Radix Tooltip 集成 (alignment status UI 提示)
 *
 * 测试假设:
 * - TokenSpan 在 token.alignmentStatus === 'perfect' 或 undefined 时不包裹 Tooltip
 * - 在 'corrected' / 'fallback' / 'dropped' 时包裹 Radix Tooltip,
 *   hover 触发后通过 role='tooltip' 找到 content
 * - Tooltip 触发后, trigger 元素会带 aria-describedby 指向 tooltip id
 *
 * 工具函数: 用 TooltipProvider delayDuration={0} 包住组件, 跳过 300ms 等待
 * (生产环境 main.tsx 用 delayDuration=300, 测试中设为 0 加速)
 */
function renderWithTooltip(ui: React.ReactElement) {
  return render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);
}

function findTokenTrigger(_container: HTMLElement, surfaceForm: string): HTMLElement {
  // 实际 DOM 结构 (v1.2.0):
  // <span class="tokenWrapper ...">  ← TokenSpan wrapper (Radix Tooltip trigger with asChild)
  //   <span class="motionContainer highlight ...">  ← ResolvedUnderlineMotion
  //     <span role="button" aria-label={lemma}>  ← LinkedOccurrenceHighlight inner button
  //       <span class="word">surfaceForm</span>
  //     </span>
  //   </span>
  // </span>
  //
  // 我们要的 trigger = TokenSpan wrapper (最外层 span). 它用 asChild 包裹
  // 整个 LinkedOccurrenceHighlight, 因此 aria-describedby 会出现在这里.
  // 搜索方向: 找到 [role=button][aria-label=surfaceForm], 然后向上找第二个 span 祖先
  // (跳过 ResolvedUnderlineMotion 的 motionContainer).
  const buttons = Array.from(document.body.querySelectorAll('[role="button"]'));
  const btn = buttons.find((b) => b.getAttribute('aria-label') === surfaceForm) as HTMLElement | undefined;
  if (!btn) {
    throw new Error(`Could not find token trigger for surfaceForm=${surfaceForm}`);
  }
  // 第一个 span 祖先 = ResolvedUnderlineMotion (motionContainer)
  // 第二个 span 祖先 = TokenSpan wrapper (Radix trigger)
  let ancestor: HTMLElement | null = btn.parentElement;
  let spanAncestors: HTMLElement[] = [];
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

describe('InteractivePassage Stage 2 alignment tooltip', () => {
  it('T06 [critical]: TokenSpan 含 alignment status (corrected) -> 渲染 tooltip', async () => {
    const text = 'The cat sat on the mat.';
    // "cat" 在 4-7 位置, alignmentStatus='corrected', originalOffset=3
    const token = makeTokenWithAlignment('cat', 4, 'corrected', 3);
    useReadingSessionStore.setState({
      session: makeSession(text, 'en', [token]),
    });

    renderWithTooltip(<InteractivePassage />);

    // hover 之前 role=tooltip 应不存在
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    // 找到 token trigger 并触发 hover
    const trigger = findTokenTrigger(document.body as unknown as HTMLElement, 'cat');
    expect(trigger).toBeTruthy();

    await act(async () => {
      fireEvent.pointerMove(trigger, { pointerType: 'mouse' });
    });

    // Radix Tooltip 在 onPointerMove 后异步 open, 用 waitFor 等 tooltip
    await waitFor(() => {
      expect(screen.queryByRole('tooltip')).toBeInTheDocument();
    });

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.textContent).toContain('位置已校正');
    expect(tooltip.textContent).toContain('+3');
  });

  it('T07 [critical]: TokenSpan 不含 alignment status (mock) -> 不渲染 tooltip', async () => {
    const text = 'The dog ran in the park.';
    // 创建一个无 alignmentStatus 的 token (模拟旧版 mock 数据)
    const token: TokenOccurrence = {
      id: 'tok-4-noalign',
      lexemeGroupId: 'lg-4',
      surfaceForm: 'dog',
      lemma: 'dog',
      objectiveDifficulty: 2,
      startIndex: 4,
      endIndex: 7,
      isResolved: false,
      isActive: false,
      kind: 'normal',
      isCompound: false,
      // alignmentStatus 不设置
    };
    useReadingSessionStore.setState({
      session: makeSession(text, 'en', [token]),
    });

    renderWithTooltip(<InteractivePassage />);

    const trigger = findTokenTrigger(document.body as unknown as HTMLElement, 'dog');
    expect(trigger).toBeTruthy();

    await act(async () => {
      fireEvent.pointerMove(trigger, { pointerType: 'mouse' });
      // 等待可能的 open (300ms delay) + 一些 buffer
      await new Promise((r) => setTimeout(r, 50));
    });

    // perfect/undefined 状态不渲染 tooltip
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('T08 [critical]: hover trigger 触发 aria-describedby', async () => {
    const text = 'The bird flew high.';
    // "bird" 在 4-8 位置
    const token = makeTokenWithAlignment('bird', 4, 'fallback', -2);
    useReadingSessionStore.setState({
      session: makeSession(text, 'en', [token]),
    });

    renderWithTooltip(<InteractivePassage />);

    const wrapper = findTokenTrigger(document.body as unknown as HTMLElement, 'bird');
    expect(wrapper).toBeTruthy();

    // hover 之前 wrapper 不应有 aria-describedby
    expect(wrapper.getAttribute('aria-describedby')).toBeNull();

    await act(async () => {
      fireEvent.pointerMove(wrapper, { pointerType: 'mouse' });
    });

    // 等待 tooltip 出现
    await waitFor(() => {
      expect(screen.queryByRole('tooltip')).toBeInTheDocument();
    });

    // tooltip 出现后 wrapper 应有 aria-describedby 指向 tooltip id
    // (Radix Tooltip 1.1.4 内部 Primitive.button + Slot + asChild 把 aria-describedby
    //  应用到我们的 TokenSpan wrapper span, 同时设 data-state="delayed-open")
    const describedBy = wrapper.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(describedBy).not.toBe('');

    // aria-describedby 指向的 id 应能在 document 中找到, 且是 tooltip 元素
    if (describedBy) {
      const tooltipEl = document.getElementById(describedBy);
      expect(tooltipEl).toBeInTheDocument();
      expect(tooltipEl?.getAttribute('role')).toBe('tooltip');
    }

    // 额外断言: data-state 表明 tooltip 已 open
    expect(wrapper.getAttribute('data-state')).toBe('delayed-open');
  });

  it('T09 [non-critical]: 4 status 文案正确 (perfect/corrected/fallback/dropped)', async () => {
    // 4 个 token 放在同一 text 中, 用不同 alignment status
    // text = "perfect corrected fallback dropped" (各 word 间空格)
    const text = 'perfect corrected fallback dropped';
    const tokenPerfect = makeTokenWithAlignment('perfect', 0, 'perfect');
    const tokenCorrected = makeTokenWithAlignment('corrected', 8, 'corrected', 5);
    const tokenFallback = makeTokenWithAlignment('fallback', 18, 'fallback', -3);
    const tokenDropped = makeTokenWithAlignment('dropped', 27, 'dropped');

    useReadingSessionStore.setState({
      session: makeSession(text, 'en', [
        tokenPerfect,
        tokenCorrected,
        tokenFallback,
        tokenDropped,
      ]),
    });

    renderWithTooltip(<InteractivePassage />);

    const perfectTrigger = findTokenTrigger(
      document.body as unknown as HTMLElement,
      'perfect',
    );
    const correctedTrigger = findTokenTrigger(
      document.body as unknown as HTMLElement,
      'corrected',
    );
    const fallbackTrigger = findTokenTrigger(
      document.body as unknown as HTMLElement,
      'fallback',
    );
    const droppedTrigger = findTokenTrigger(
      document.body as unknown as HTMLElement,
      'dropped',
    );

    // perfect 状态: hover 不应触发 tooltip
    await act(async () => {
      fireEvent.pointerMove(perfectTrigger, { pointerType: 'mouse' });
    });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    // 串行 hover: 同一测试会话内 hover 不同 trigger, Radix 内部用 setOpen(false)+setOpen(true)
    // 切换内容. 用 waitFor 轮询直到文本变成目标值.
    await act(async () => {
      fireEvent.pointerMove(correctedTrigger, { pointerType: 'mouse' });
    });
    await waitFor(
      () => {
        const t = screen.queryByRole('tooltip');
        expect(t?.textContent).toContain('位置已校正');
      },
      { timeout: 2000 },
    );
    expect(screen.getByRole('tooltip').textContent).toContain('+5');

    // fallback
    await act(async () => {
      fireEvent.pointerMove(fallbackTrigger, { pointerType: 'mouse' });
    });
    await waitFor(
      () => {
        const t = screen.queryByRole('tooltip');
        expect(t?.textContent).toContain('位置已优化');
      },
      { timeout: 2000 },
    );
    expect(screen.getByRole('tooltip').textContent).toContain('-3');

    // dropped
    await act(async () => {
      fireEvent.pointerMove(droppedTrigger, { pointerType: 'mouse' });
    });
    await waitFor(
      () => {
        const t = screen.queryByRole('tooltip');
        expect(t?.textContent).toContain('(已隐藏)');
      },
      { timeout: 2000 },
    );
    expect(screen.getByRole('tooltip').textContent).toBe('(已隐藏)');
  });
});

/**
 * v2.1.0 Stage 4 (Contract 68): InteractivePassage isReplay 禁用作答测试
 *
 * 覆盖 test_spec:
 * - T20a: isReplay=true → token wrapper 有 data-replay="true" 属性
 * - T20b: isReplay=true → 点击 token 不触发 setActiveOccurrence (activeOccurrenceId 仍为 null)
 * - T20c: isReplay=false (默认) → token 可点击, 点击后 activeOccurrenceId 被设置
 *
 * 设计:
 * - 使用真实 store + setState 注入 session (含 1 个 isResolved=false token)
 * - jsdom 不执行 CSS pointer-events:none, TokenSpan wrapper 上的
 *   onClickCapture/onKeyDownCapture 作为 JS 层守卫阻止事件传播
 * - data-replay 属性作为可测试标记 (CSS module 类名在 css:false 下为 undefined)
 */
describe('InteractivePassage isReplay (v2.1.0 Stage 4 Contract 68)', () => {
  function makeReplaySession(): ReadingSession {
    const text = 'The cat sat.';
    const token: TokenOccurrence = {
      id: 'tok-cat',
      lexemeGroupId: 'grp-cat',
      surfaceForm: 'cat',
      lemma: 'cat',
      objectiveDifficulty: 2,
      startIndex: 4,
      endIndex: 7,
      isResolved: false,
      isActive: false,
      kind: 'normal',
      isCompound: false,
      alignmentStatus: 'perfect',
      originalOffset: 0,
    };
    return makeSession(text, 'en', [token]);
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
  });

  it('T20a: isReplay=true → token wrapper 有 data-replay="true" 属性', () => {
    useReadingSessionStore.setState({ session: makeReplaySession() });

    render(<InteractivePassage isReplay={true} />);

    const replayWrapper = document.querySelector('[data-replay="true"]');
    expect(replayWrapper).not.toBeNull();
    expect(replayWrapper).toBeInTheDocument();
  });

  it('T20b: isReplay=true → 点击 token 不触发 setActiveOccurrence (activeOccurrenceId 仍为 null)', () => {
    useReadingSessionStore.setState({ session: makeReplaySession() });

    render(<InteractivePassage isReplay={true} />);

    // 找到 token 内部的 button (LinkedOccurrenceHighlight 的 role=button)
    const tokenBtn = screen.getByRole('button', { name: 'cat' });
    expect(tokenBtn).toBeInTheDocument();

    fireEvent.click(tokenBtn);

    // activeOccurrenceId 应仍为 null (replay 模式禁止激活)
    expect(useReadingSessionStore.getState().activeOccurrenceId).toBeNull();
  });

  it('T20c: isReplay=false (默认) → token 可点击, 点击后 activeOccurrenceId 被设置', () => {
    useReadingSessionStore.setState({ session: makeReplaySession() });

    render(<InteractivePassage isReplay={false} />);

    const tokenBtn = screen.getByRole('button', { name: 'cat' });
    fireEvent.click(tokenBtn);

    // 非 replay 模式: 点击后 activeOccurrenceId 应为 token id
    expect(useReadingSessionStore.getState().activeOccurrenceId).toBe('tok-cat');
  });

  it('T20d: isReplay=true → 无 data-replay 属性于 wrapper (isReplay=false 时)', () => {
    useReadingSessionStore.setState({ session: makeReplaySession() });

    render(<InteractivePassage isReplay={false} />);

    const replayWrapper = document.querySelector('[data-replay="true"]');
    expect(replayWrapper).toBeNull();
  });
});

/**
 * v2.2.3 Stage 2 (D2): InteractivePassage data-testid + prefers-reduced-motion
 *
 * 覆盖 test_spec:
 * - T07: TokenSpan 渲染 data-testid="passage-token"
 * - T08: TokenSpan 渲染 data-token-id
 * - T09: prefers-reduced-motion 启用时段落一次性可见 (无 stagger)
 * - T10: prefers-reduced-motion 禁用时保持 stagger 行为 (段落逐步可见)
 *
 * 设计:
 * - vi.mock CSS module 以便检查段落 visible class (css:false 下 styles 为空对象)
 * - T09: mock matchMedia 返回 matches:true, 渲染后立即检查所有段落 visible
 * - T10: mock matchMedia 返回 matches:false, 使用 fake timers 验证 stagger
 */
describe('InteractivePassage v2.2.3 Stage 2 (D2)', () => {
  let originalMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    vi.useRealTimers();
  });

  describe('D2-1: data-testid 属性', () => {
    it('T07: TokenSpan 渲染 data-testid="passage-token"', () => {
      const text = 'The cat sat.';
      const token: TokenOccurrence = {
        id: 'tok-cat',
        lexemeGroupId: 'grp-cat',
        surfaceForm: 'cat',
        lemma: 'cat',
        objectiveDifficulty: 2,
        startIndex: 4,
        endIndex: 7,
        isResolved: false,
        isActive: false,
        kind: 'normal',
        isCompound: false,
      };
      useReadingSessionStore.setState({ session: makeSession(text, 'en', [token]) });

      const { container } = render(<InteractivePassage />);

      const tokenEl = container.querySelector('[data-testid="passage-token"]');
      expect(tokenEl).not.toBeNull();
      expect(tokenEl).toBeInTheDocument();
    });

    it('T08: TokenSpan 渲染 data-token-id', () => {
      const text = 'The cat sat.';
      const token: TokenOccurrence = {
        id: 'tok-cat-42',
        lexemeGroupId: 'grp-cat',
        surfaceForm: 'cat',
        lemma: 'cat',
        objectiveDifficulty: 2,
        startIndex: 4,
        endIndex: 7,
        isResolved: false,
        isActive: false,
        kind: 'normal',
        isCompound: false,
      };
      useReadingSessionStore.setState({ session: makeSession(text, 'en', [token]) });

      const { container } = render(<InteractivePassage />);

      const tokenEl = container.querySelector('[data-testid="passage-token"]');
      expect(tokenEl).not.toBeNull();
      expect(tokenEl?.getAttribute('data-token-id')).toBe('tok-cat-42');
    });
  });

  describe('D2-2: prefers-reduced-motion', () => {
    /**
     * mock matchMedia: 当 query 为 prefers-reduced-motion: reduce 时返回指定 matches.
     */
    function setReducedMotion(matches: boolean) {
      window.matchMedia = (query: string) => ({
        matches: query === '(prefers-reduced-motion: reduce)' ? matches : false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      });
    }

    it('T09: prefers-reduced-motion 启用时段落一次性可见 (无 stagger)', () => {
      setReducedMotion(true);

      const text = 'First paragraph here.\n\nSecond paragraph follows.\n\nThird one too.';
      useReadingSessionStore.setState({ session: makeSession(text) });

      const { container } = render(<InteractivePassage />);

      const paragraphs = container.querySelectorAll('[data-paragraph]');
      expect(paragraphs.length).toBe(3);

      // 所有段落应立即有 visible class (无 setTimeout delay)
      paragraphs.forEach((p) => {
        expect(p.className).toContain('visible');
      });
    });

    it('T10: prefers-reduced-motion 禁用时保持 stagger (段落逐步可见)', async () => {
      setReducedMotion(false);
      // 使用真实 timer + waitFor 验证 stagger, 避免 fake timer 与 React 18 调度冲突
      // (React 18 使用 MessageChannel/queueMicrotask 调度, fake timer 会阻断 setState 刷新)

      const text = 'First paragraph here.\n\nSecond paragraph follows.\n\nThird one too.';
      useReadingSessionStore.setState({ session: makeSession(text) });

      const { container } = render(<InteractivePassage />);

      const getParagraphs = () => container.querySelectorAll('[data-paragraph]');

      // 初始: 无段落 visible (stagger 尚未开始, outer timer 100ms 未到)
      expect(getParagraphs().length).toBe(3);
      getParagraphs().forEach((p) => {
        expect(p.className).not.toContain('visible');
      });

      // 等待第一段 visible (outer 100ms + inner 0ms)
      // waitFor 间隔 10ms, 确保 100ms 间隔内能捕获中间状态
      await waitFor(
        () => {
          expect(getParagraphs()[0].className).toContain('visible');
        },
        { timeout: 500, interval: 10 }
      );
      // 第一段 visible 时, 第二/三段尚未 visible (stagger 100ms 间隔)
      expect(getParagraphs()[1].className).not.toContain('visible');
      expect(getParagraphs()[2].className).not.toContain('visible');

      // 等待第二段 visible (outer 100ms + inner 100ms = 200ms)
      await waitFor(
        () => {
          expect(getParagraphs()[1].className).toContain('visible');
        },
        { timeout: 500, interval: 10 }
      );
      expect(getParagraphs()[2].className).not.toContain('visible');

      // 等待第三段 visible (outer 100ms + inner 200ms = 300ms)
      await waitFor(
        () => {
          expect(getParagraphs()[2].className).toContain('visible');
        },
        { timeout: 500, interval: 10 }
      );
    });
  });
});
