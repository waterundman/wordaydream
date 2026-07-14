import { useMemo, useEffect, useState, useCallback, memo, useRef } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { useReadingSessionStore } from '../store/useReadingSessionStore';
import { LinkedOccurrenceHighlight } from './LinkedOccurrenceHighlight';
import { InlineAnswerPanel } from './InlineAnswerPanel';
import { GrammarHighlight } from '../../grammar/components/GrammarHighlight';
import { GrammarPanel } from '../../grammar/components/GrammarPanel';
import { usePageEntranceAnimation } from '../hooks/usePageEntranceAnimation';
import { EmptyState } from '../../../components/EmptyState';
import { useKeyboardShortcuts } from '../../../hooks/useKeyboardShortcuts';
import styles from './InteractivePassage.module.css';
import type { TokenOccurrence, Language, GrammarPoint } from '../../../types';

interface TextSegment {
  type: 'text' | 'token' | 'grammar';
  content: string;
  /** 该 segment 在原 text 中的起始位置 (仅 text 段有意义, 用于按段落分组) */
  startIndex?: number;
  token?: TokenOccurrence;
  grammarPoint?: GrammarPoint;
}

interface ParagraphRange {
  /** 段落文本 (已 split 后, 不含 \n\n) */
  text: string;
  /** 在原 passage.text 中的 [start, end) 闭开区间 */
  start: number;
  end: number;
}

interface TokenSpanProps {
  token: TokenOccurrence;
  isActive: boolean;
  isFocused: boolean;
  language: Language;
  isReplay: boolean;
  children: React.ReactNode;
}

/**
 * v1.2.0: 根据 token.alignmentStatus 渲染 Radix Tooltip 文案.
 * - 'perfect': 不显示 tooltip (无信息量)
 * - 'corrected': "位置已校正" + originalOffset (正负符号)
 * - 'fallback': "位置已优化" + originalOffset
 * - 'dropped': "(已隐藏)"
 *
 * 返回 null 表示不渲染 tooltip (perfect 状态).
 */
function buildAlignmentTooltip(
  alignment: TokenOccurrence['alignmentStatus'],
  offset: number | undefined,
): string | null {
  if (!alignment || alignment === 'perfect') return null;
  const signedOffset = offset && offset !== 0
    ? ` (${offset > 0 ? '+' : ''}${offset})`
    : '';
  if (alignment === 'corrected') return `位置已校正${signedOffset}`;
  if (alignment === 'fallback') return `位置已优化${signedOffset}`;
  if (alignment === 'dropped') return '(已隐藏)';
  return null;
}

const TokenSpan = memo(function TokenSpan({
  token,
  isActive,
  isFocused,
  language,
  isReplay,
  children,
}: TokenSpanProps) {
  // v2.1.0 Stage 4 (Contract 68): 重读模式下禁用作答面板.
  // isReplay=true 时即使 isActive 也不渲染 InlineAnswerPanel (重读模式不可作答).
  const showPanel = isActive && !token.isCompound && !isReplay;
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const tooltipText = useMemo(
    () => buildAlignmentTooltip(token.alignmentStatus, token.originalOffset),
    [token.alignmentStatus, token.originalOffset]
  );
  const showAlignmentTooltip = tooltipText !== null;

  const wrapperClassName = [
    styles.tokenWrapper,
    isFocused ? styles.focused : '',
    isReplay ? styles.tokenReplay : '',
  ]
    .filter(Boolean)
    .join(' ');

  // v2.1.0 Stage 4 (Contract 68): 重读模式下阻止 click/keydown 事件传播到
  // LinkedOccurrenceHighlight 的内部 handler, 防止 setActiveOccurrence 触发.
  // CSS pointer-events:none 在真实浏览器中生效, 此 capture handler 作为
  // JS 层守卫 (jsdom 测试环境下 CSS 不生效时仍能阻止交互).
  const handleReplayClickCapture = useCallback((e: React.SyntheticEvent) => {
    if (isReplay) {
      e.stopPropagation();
      e.preventDefault();
    }
  }, [isReplay]);

  const handleReplayKeyDownCapture = useCallback((e: React.SyntheticEvent) => {
    if (isReplay) {
      e.stopPropagation();
      e.preventDefault();
    }
  }, [isReplay]);

  const trigger = (
    <span
      ref={wrapperRef}
      className={wrapperClassName}
      data-replay={isReplay ? 'true' : undefined}
      onClickCapture={handleReplayClickCapture}
      onKeyDownCapture={handleReplayKeyDownCapture}
    >
      <LinkedOccurrenceHighlight token={token} language={language}>
        {children}
      </LinkedOccurrenceHighlight>
    </span>
  );

  return (
    <>
      {showAlignmentTooltip ? (
        <Tooltip.Root delayDuration={300}>
          <Tooltip.Trigger asChild>{trigger}</Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              className={styles.alignmentTooltip}
              sideOffset={6}
              collisionPadding={8}
              data-alignment={token.alignmentStatus}
              data-testid="alignment-tooltip"
            >
              {tooltipText}
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      ) : (
        trigger
      )}
      {showPanel && (
        <InlineAnswerPanel
          token={token}
          language={language}
          anchorRef={wrapperRef as React.RefObject<HTMLElement | null>}
        />
      )}
    </>
  );
});

interface GrammarSpanProps {
  grammarPoint: GrammarPoint;
  isActive: boolean;
  isTypeHovered: boolean;
  isReplay: boolean;
  onClick: (gp: GrammarPoint) => void;
  onMouseEnter: (gp: GrammarPoint) => void;
  onMouseLeave: () => void;
  onClose: () => void;
  children: React.ReactNode;
}

const GrammarSpan = memo(function GrammarSpan({
  grammarPoint,
  isActive,
  isTypeHovered,
  isReplay,
  onClick,
  onMouseEnter,
  onMouseLeave,
  onClose,
  children,
}: GrammarSpanProps) {
  const handleClick = useCallback(() => onClick(grammarPoint), [onClick, grammarPoint]);
  const handleMouseEnter = useCallback(() => onMouseEnter(grammarPoint), [onMouseEnter, grammarPoint]);
  const wrapperRef = useRef<HTMLSpanElement>(null);

  return (
    <span ref={wrapperRef} className={styles.tokenWrapper}>
      <GrammarHighlight
        grammarPoint={grammarPoint}
        isActive={isActive}
        isTypeHovered={isTypeHovered}
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={onMouseLeave}
        aria-disabled={isReplay ? 'true' : undefined}
        data-replay={isReplay ? 'true' : undefined}
      >
        {children}
      </GrammarHighlight>
      {isActive && (
        <GrammarPanel
          grammarPoint={grammarPoint}
          onClose={onClose}
          anchorRef={wrapperRef as React.RefObject<HTMLElement | null>}
        />
      )}
    </span>
  );
});

interface Props {
  language?: Language;
  isReplay?: boolean;
}

export function InteractivePassage({ language, isReplay = false }: Props = {}) {
  const { session, activeOccurrenceId, setActiveOccurrence } = useReadingSessionStore();
  const [visibleParagraphs, setVisibleParagraphs] = useState<Set<number>>(new Set());
  const [activeGrammarPointId, setActiveGrammarPointId] = useState<string | null>(null);
  const [hoveredGrammarType, setHoveredGrammarType] = useState<string | null>(null);
  const [focusedTokenId, setFocusedTokenId] = useState<string | null>(null);

  // v1.5.2 fix P0-2: token 激活时关闭语法面板 (互斥).
  // 之前局部 activeGrammarPointId 与 store.activeOccurrenceId 状态断裂:
  // 点 token → store.setActiveOccurrence 清 store.activeGrammarPointId (死代码),
  //   但不影响本组件局部 activeGrammarPointId → 语法面板仍开 + token 面板也开.
  // 修复: 监听 activeOccurrenceId 变化, 非 null 时清局部 grammar state.
  useEffect(() => {
    if (activeOccurrenceId !== null) {
      setActiveGrammarPointId(null);
    }
  }, [activeOccurrenceId]);

  const { getStyle: getParagraphStyle } = usePageEntranceAnimation({
    staggerDelay: 100,
    animationDuration: 500,
    offset: 16,
  });

  /**
   * Stage 4 单层段落切分 (替换旧版双层 split 状态机):
   * 旧版 L124 + L242-268 同时存在两套段落定义 (L124 `split(/\n+/)` 用于可见性动画,
   * L242-268 二次按 `\n` 切分 segments), 真实 LLM 无 \n\n 时两套定义都不输出多段.
   * 新版统一为 `split(/\n\n+/)`, 与 LLM prompt V2 的 `\n\n` 段落约定一致.
   *
   * v1.1.0 hotfix 兜底注入: DeepSeek 真实输出经常不含 `\n\n` (E2E 5/5 都不含),
   * 即便 prompt 强约束. 渲染层在 text 不含 `\n\n` 时, 按 `[.!?] + 空格` (非 \n)
   * 切分句子, 强制形成 2-3 段. 用 `. ` (而不是 `\s+`) 是为了不误伤 T02 这种
   * 用 `\n` 做软换行的退化输出 (T02 期望 1 段).
   *
   * 关键不变量: ranges 始终使用原 text 坐标, 与 token.startIndex / endIndex
   * 一致, 这样 paragraphSegments 的范围判断不会因为注入造成偏移错位.
   */
  const paragraphRanges = useMemo<ParagraphRange[]>(() => {
    if (!session) return [];
    const text = session.passage.text;

    if (/\n\n/.test(text)) {
      // 已有 \n\n, 用 Stage 4 单层 split 逻辑
      const parts = text.split(/\n\n+/).filter((p) => p.trim().length > 0);
      // v1.5.3 fix V3-P3-004: parts 全空时 (text 仅含 \n\n) 兜底返回整段, 避免文章不渲染.
      if (parts.length === 0) {
        return [{ text, start: 0, end: text.length }];
      }
      const ranges: ParagraphRange[] = [];
      let cursor = 0;
      for (const part of parts) {
        const start = text.indexOf(part, cursor);
        if (start < 0) {
          // 防御: 找不到时跳过 (理论上不会发生, 因为 split 来源是 text 本身)
          continue;
        }
        const end = start + part.length;
        ranges.push({ text: part, start, end });
        cursor = end;
      }
      return ranges;
    }

    // 兜底: 不含 \n\n 时按句子切分. 用 `[.!?][ \t]+` (空格/tab, 不含 \n)
    // 这样 T02 (用 \n 做软换行) 不会被切分, 仍保持 1 段.
    const sentenceEndRe = /[.!?][ \t]+/g;
    const sentenceBounds: Array<{ start: number; end: number }> = [];
    let lastStart = 0;
    let m: RegExpExecArray | null;
    while ((m = sentenceEndRe.exec(text)) !== null) {
      // v1.5.4 fix: 句末标点 + 空白都包含在当前句子中, 避免段落边界处空格丢失.
      const sentenceEnd = m.index + m[0].length;
      sentenceBounds.push({ start: lastStart, end: sentenceEnd });
      lastStart = m.index + m[0].length; // 下一个句子起点 (跳过空白)
    }
    if (lastStart < text.length) {
      sentenceBounds.push({ start: lastStart, end: text.length });
    }

    if (sentenceBounds.length === 0) {
      return [{ text, start: 0, end: text.length }];
    }

    // 限制最多 3 段
    const groupSize = Math.max(1, Math.ceil(sentenceBounds.length / 3));
    const ranges: ParagraphRange[] = [];
    for (let i = 0; i < sentenceBounds.length; i += groupSize) {
      const group = sentenceBounds.slice(i, i + groupSize);
      const start = group[0].start;
      const end = group[group.length - 1].end;
      ranges.push({ text: text.slice(start, end), start, end });
    }
    return ranges;
  }, [session]);

  const segments = useMemo(() => {
    if (!session) return [];

    const result: TextSegment[] = [];
    let currentIndex = 0;
    const text = session.passage.text;

    // 边界守卫:过滤非法 token/grammarPoint(避免 startIndex 偏移导致 highlight 跨段)
    const isValidRange = (start: number, end: number) =>
      Number.isFinite(start) &&
      Number.isFinite(end) &&
      start >= 0 &&
      end > start &&
      end <= text.length;

    const validTokens = session.passage.tokens.filter((t) =>
      isValidRange(t.startIndex, t.endIndex)
    );
    if (validTokens.length !== session.passage.tokens.length) {
      // 一次性 warn 防止刷屏
      console.warn(
        `[InteractivePassage] dropped ${session.passage.tokens.length - validTokens.length} invalid token(s) out of bounds`,
      );
    }
    const validGrammarPoints = session.passage.grammarPoints.filter((gp) =>
      isValidRange(gp.startIndex, gp.endIndex)
    );

    const sortedTokens = [...validTokens].sort((a, b) => a.startIndex - b.startIndex);
    const sortedGrammarPoints = [...validGrammarPoints].sort(
      (a, b) => a.startIndex - b.startIndex
    );

    let tokenIdx = 0;
    let grammarIdx = 0;

    while (tokenIdx < sortedTokens.length || grammarIdx < sortedGrammarPoints.length) {
      const nextToken = sortedTokens[tokenIdx];
      const nextGrammar = sortedGrammarPoints[grammarIdx];

      let nextSegment: TextSegment | null = null;

      if (!nextToken && nextGrammar) {
        nextSegment = {
          type: 'grammar',
          content: text.slice(nextGrammar.startIndex, nextGrammar.endIndex),
          startIndex: nextGrammar.startIndex,
          grammarPoint: nextGrammar,
        };
        grammarIdx++;
      } else if (nextToken && !nextGrammar) {
        nextSegment = {
          type: 'token',
          content: nextToken.surfaceForm,
          token: nextToken,
        };
        tokenIdx++;
      } else if (nextToken && nextGrammar) {
        // v1.5.4 fix: 当 startIndex 相同时 token 优先 (token 是可交互的),
        // 避免 grammar 先消费文本导致 token 不可点击.
        if (nextToken.startIndex <= nextGrammar.startIndex) {
          nextSegment = {
            type: 'token',
            content: nextToken.surfaceForm,
            token: nextToken,
          };
          tokenIdx++;
        } else {
          nextSegment = {
            type: 'grammar',
            content: text.slice(nextGrammar.startIndex, nextGrammar.endIndex),
            startIndex: nextGrammar.startIndex,
            grammarPoint: nextGrammar,
          };
          grammarIdx++;
        }
      }

      if (nextSegment) {
        if (nextSegment.type === 'token') {
          // v1.5.4 fix: 跳过与已渲染区域重叠的 token, 避免文本重复.
          // 当 grammar 先渲染且 token 完全在其范围内时, token 文本已被 grammar 的
          // text.slice 包含, 跳过 token 避免重复 (但 token 不可点击, 属于边缘情况).
          if (nextSegment.token!.startIndex < currentIndex) {
            // token 起点已被消费, 跳过不渲染
          } else {
            if (nextSegment.token!.startIndex > currentIndex) {
              result.push({
                type: 'text',
                content: text.slice(currentIndex, nextSegment.token!.startIndex),
                startIndex: currentIndex,
              });
            }
            currentIndex = nextSegment.token!.endIndex;
            result.push(nextSegment);
          }
        } else if (nextSegment.type === 'grammar') {
          // v1.5.4 fix: grammar 与已渲染 token 重叠时, 调整 grammar 起点避免文本重复.
          // 例如 grammar "verbarg sich" [177,189) 与 token "verbarg" [177,184):
          // token 先渲染 [177,184), grammar 调整为 [184,189) 只渲染 " sich".
          const gp = nextSegment.grammarPoint!;
          if (gp.startIndex < currentIndex) {
            const adjustedStart = currentIndex;
            const adjustedEnd = gp.endIndex;
            if (adjustedEnd > adjustedStart) {
              // v1.5.4 fix: 分离前导空格到 text segment,
              // 避免 inline-block 元素吃掉 grammar 的前导空格.
              let contentStart = adjustedStart;
              if (text[adjustedStart] === ' ') {
                result.push({
                  type: 'text',
                  content: ' ',
                  startIndex: adjustedStart,
                });
                contentStart = adjustedStart + 1;
              }
              if (adjustedEnd > contentStart) {
                result.push({
                  type: 'grammar',
                  content: text.slice(contentStart, adjustedEnd),
                  startIndex: contentStart,
                  grammarPoint: gp,
                });
              }
              currentIndex = adjustedEnd;
            }
            // 调整后为空则跳过
          } else {
            if (gp.startIndex > currentIndex) {
              result.push({
                type: 'text',
                content: text.slice(currentIndex, gp.startIndex),
                startIndex: currentIndex,
              });
            }
            currentIndex = gp.endIndex;
            result.push(nextSegment);
          }
        }
      }
    }

    if (currentIndex < text.length) {
      result.push({
        type: 'text',
        content: text.slice(currentIndex),
        startIndex: currentIndex,
      });
    }

    return result;
  }, [session]);

  /**
   * 将 segments 按段落范围分组 (Stage 4 替代旧版 L242-268 二次 split):
   * 对每个段落 range, 收集 startIndex 在 [pStart, pEnd) 内的 text segments,
   * 并将 token/grammar segments 按其 startIndex 落入对应段落.
   * 这样 segments useMemo 的 token 排序逻辑完全保留, 仅渲染层按段落分组.
   */
  const paragraphSegments = useMemo<(TextSegment | string)[][]>(() => {
    if (paragraphRanges.length === 0) return [];
    const buckets: (TextSegment | string)[][] = paragraphRanges.map(() => []);

    paragraphRanges.forEach((range, pIdx) => {
      for (const seg of segments) {
        if (seg.type === 'text') {
          // text segment 可能是从 currentIndex 开始的连续文本, 可能跨越多段
          const segStart = seg.startIndex ?? 0;
          const segEnd = segStart + seg.content.length;
          // 与当前段落有重叠
          if (segEnd <= range.start || segStart >= range.end) continue;
          const clipStart = Math.max(segStart, range.start);
          const clipEnd = Math.min(segEnd, range.end);
          const clipped = seg.content.slice(clipStart - segStart, clipEnd - segStart);
          if (clipped.length > 0) {
            buckets[pIdx].push(clipped);
          }
        } else if (seg.type === 'token' && seg.token) {
          if (seg.token.startIndex >= range.start && seg.token.startIndex < range.end) {
            buckets[pIdx].push(seg);
          }
        } else if (seg.type === 'grammar' && seg.grammarPoint) {
          if (
            seg.grammarPoint.startIndex >= range.start &&
            seg.grammarPoint.startIndex < range.end
          ) {
            buckets[pIdx].push(seg);
          }
        }
      }
    });

    return buckets;
  }, [paragraphRanges, segments]);

  // 段落可见性 staggered 动画: 切换 session 或 paragraphRanges 长度时重新触发
  // (与旧版 L121-134 useEffect 等价, 但驱动源改为新的 paragraphRanges)
  // v1.5.2 fix L5: 追踪所有 inner setTimeout 句柄, cleanup 时全部清除,
  // 避免 unmount 后 setState 触发 React 警告 + staggering 动画泄漏.
  useEffect(() => {
    if (!session) {
      setVisibleParagraphs(new Set());
      return;
    }
    setVisibleParagraphs(new Set());
    const innerTimers: ReturnType<typeof setTimeout>[] = [];
    const outerTimer = setTimeout(() => {
      paragraphRanges.forEach((_, index) => {
        const innerTimer = setTimeout(() => {
          setVisibleParagraphs((prev) => new Set([...prev, index]));
        }, index * 100);
        innerTimers.push(innerTimer);
      });
    }, 100);
    return () => {
      clearTimeout(outerTimer);
      innerTimers.forEach((t) => clearTimeout(t));
    };
  }, [session, paragraphRanges]);

  const handleGrammarClick = useCallback((grammarPoint: GrammarPoint) => {
    setActiveGrammarPointId((prev) => (prev === grammarPoint.id ? null : grammarPoint.id));
    setActiveOccurrence(null);
  }, [setActiveOccurrence]);

  const handleGrammarMouseEnter = useCallback((grammarPoint: GrammarPoint) => {
    setHoveredGrammarType(grammarPoint.type);
  }, []);

  const handleGrammarMouseLeave = useCallback(() => {
    setHoveredGrammarType(null);
  }, []);

  const handleGrammarClose = useCallback(() => {
    setActiveGrammarPointId(null);
  }, []);

  const tokenIds = useMemo(() => {
    if (!session) return [];
    return session.passage.tokens
      .filter((t) => t.kind === 'normal' || t.kind === 'review')
      .map((t) => t.id);
  }, [session]);

  const focusNextToken = useCallback(() => {
    if (tokenIds.length === 0) return;
    setFocusedTokenId((prev) => {
      if (!prev) return tokenIds[0];
      const idx = tokenIds.indexOf(prev);
      if (idx === -1) return tokenIds[0];
      return tokenIds[(idx + 1) % tokenIds.length];
    });
  }, [tokenIds]);

  const focusPrevToken = useCallback(() => {
    if (tokenIds.length === 0) return;
    setFocusedTokenId((prev) => {
      if (!prev) return tokenIds[tokenIds.length - 1];
      const idx = tokenIds.indexOf(prev);
      if (idx === -1) return tokenIds[tokenIds.length - 1];
      return tokenIds[(idx - 1 + tokenIds.length) % tokenIds.length];
    });
  }, [tokenIds]);

  const activateFocusedToken = useCallback(() => {
    if (focusedTokenId) {
      setActiveOccurrence(focusedTokenId);
    }
  }, [focusedTokenId, setActiveOccurrence]);

  const handleSpace = useCallback(() => {
    if (!focusedTokenId) {
      const firstUnresolved = tokenIds.find((id) => {
        const token = session?.passage.tokens.find((t) => t.id === id);
        return token && !token.isResolved;
      });
      setFocusedTokenId(firstUnresolved ?? tokenIds[0] ?? null);
    } else {
      activateFocusedToken();
    }
  }, [focusedTokenId, tokenIds, session, activateFocusedToken]);

  const shortcuts = useMemo(
    () => [
      {
        id: 'tab-next',
        key: 'Tab',
        shift: false,
        scope: 'reading' as const,
        handler: (e: KeyboardEvent) => {
          e.preventDefault();
          focusNextToken();
        },
        description: '下一个词汇',
      },
      {
        id: 'shift-tab-prev',
        key: 'Tab',
        shift: true,
        scope: 'reading' as const,
        handler: (e: KeyboardEvent) => {
          e.preventDefault();
          focusPrevToken();
        },
        description: '上一个词汇',
      },
      {
        id: 'arrow-right-next',
        key: 'ArrowRight',
        scope: 'reading' as const,
        handler: () => focusNextToken(),
        description: '下一个词汇',
      },
      {
        id: 'arrow-left-prev',
        key: 'ArrowLeft',
        scope: 'reading' as const,
        handler: () => focusPrevToken(),
        description: '上一个词汇',
      },
      {
        id: 'enter-activate',
        key: 'Enter',
        scope: 'reading' as const,
        handler: () => activateFocusedToken(),
        description: '激活词汇',
      },
      {
        id: 'space-activate',
        key: ' ',
        scope: 'reading' as const,
        handler: (e: KeyboardEvent) => {
          e.preventDefault();
          handleSpace();
        },
        description: '开始阅读/继续',
      },
    ],
    [focusNextToken, focusPrevToken, activateFocusedToken, handleSpace]
  );

  useKeyboardShortcuts('interactive-passage', shortcuts);

  if (!session) {
    return (
      <div className={styles.empty}>
        <EmptyState
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
              <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
            </svg>
          }
          title="准备开始阅读"
          description="选择语言和难度，点击生成文章，开启你的词汇学习之旅。"
          compact
        />
      </div>
    );
  }

  const effectiveLanguage: Language = language ?? session.language;

  return (
    <article className={styles.passage}>
      {session.passage.title && (
        <h1 className={styles.title} style={getParagraphStyle(0)}>
          {session.passage.title}
        </h1>
      )}
      <div className={styles.text} data-passage-root>
        {paragraphSegments.map((paragraph, paragraphIdx) => {
          const isVisible = visibleParagraphs.has(paragraphIdx);
          // v1.5.5 fix: 激活 token/grammar 的段落提升 z-index, 避免后续段落 stacking context 覆盖面板.
          const hasActivePanel = paragraph.some((item) => {
            if (typeof item === 'string') return false;
            if (item.type === 'token' && item.token?.id === activeOccurrenceId) return true;
            if (item.type === 'grammar' && item.grammarPoint?.id === activeGrammarPointId) return true;
            return false;
          });
          return (
            <div
              key={paragraphIdx}
              data-paragraph={paragraphIdx}
              className={`${styles.paragraph} ${isVisible ? styles.visible : ''} ${hasActivePanel ? styles.paragraphActive : ''}`}
              style={getParagraphStyle(paragraphIdx + 1)}
            >
              {paragraph.map((item, itemIdx) => {
                if (typeof item === 'string') {
                  return <span key={itemIdx}>{item}</span>;
                }

                if (item.type === 'token') {
                  const token = item.token!;
                  const isActive = token.id === activeOccurrenceId;
                  const isFocused = token.id === focusedTokenId;

                  return (
                    <TokenSpan
                      key={`${token.id}-${itemIdx}`}
                      token={token}
                      isActive={isActive}
                      isFocused={isFocused}
                      language={effectiveLanguage}
                      isReplay={isReplay}
                    >
                      {item.content}
                    </TokenSpan>
                  );
                }

                if (item.type === 'grammar') {
                  const grammarPoint = item.grammarPoint!;
                  const isActive = grammarPoint.id === activeGrammarPointId;
                  const isTypeHovered = hoveredGrammarType === grammarPoint.type;

                  return (
                    <GrammarSpan
                      key={`${grammarPoint.id}-${itemIdx}`}
                      grammarPoint={grammarPoint}
                      isActive={isActive}
                      isTypeHovered={isTypeHovered}
                      isReplay={isReplay}
                      onClick={handleGrammarClick}
                      onMouseEnter={handleGrammarMouseEnter}
                      onMouseLeave={handleGrammarMouseLeave}
                      onClose={handleGrammarClose}
                    >
                      {item.content}
                    </GrammarSpan>
                  );
                }

                return <span key={itemIdx}>{item.content}</span>;
              })}
            </div>
          );
        })}
      </div>
    </article>
  );
}