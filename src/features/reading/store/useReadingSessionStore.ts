import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type {
  ReadingSession,
  TokenOccurrence,
  Language,
  DifficultyLevel,
  Passage,
  GrammarPoint,
} from '../../../types';
import { useMemoryStore } from '../../review/store/useMemoryStore';
import { useReadingHistoryStore } from './useReadingHistoryStore';
import { useStreakStore } from '../../streak/store/useStreakStore';
import { useAchievementStore } from '../../achievements/store/useAchievementStore';
import { buildAchievementContext } from '../../achievements/services/buildContext';

/**
 * v1.6.1 Stage 1: 重依赖懒加载 —— 把它们移出首屏依赖图.
 *
 * 背景: 本 store 被 App.tsx 静态导入 (只为读 mode), 于是它的全部静态 import 都进入
 * entry 静态图, 进而被 Vite 推导进 `modulepreload` 清单 —— 首屏白下载 ~42 KB:
 *   - `mocks/passages`  (26.2 KB chunk): 仅 LLM 失败时的同步兜底语料
 *   - `useCourseStore`  (15.9 KB chunk) + `data/courses`: 仅 lessonId 非空时使用
 * 两者都只在 `loadSession` (async) 内部使用, 故改为按需动态导入并缓存 Promise
 * (ESM 本身也缓存, 这里缓存 Promise 是为了避免重复构造 import 调用).
 *
 * 与本文件既有的 `await import('../services/passageGenerator')` (见 loadSession)
 * 是同一设计意图: 让非首屏必需的重模块留在懒加载边界之后.
 */
type CourseModule = {
  useCourseStore: typeof import('../../course/store/useCourseStore')['useCourseStore'];
  getLessonById: typeof import('../../../data/courses')['getLessonById'];
};

let courseModulePromise: Promise<CourseModule> | null = null;
function loadCourseModule(): Promise<CourseModule> {
  if (!courseModulePromise) {
    courseModulePromise = Promise.all([
      import('../../course/store/useCourseStore'),
      import('../../../data/courses'),
    ]).then(([course, courses]) => ({
      useCourseStore: course.useCourseStore,
      getLessonById: courses.getLessonById,
    }));
  }
  return courseModulePromise;
}

let mockPassagesPromise: Promise<typeof import('../../../mocks/passages')> | null = null;
function loadMockPassages(): Promise<typeof import('../../../mocks/passages')> {
  if (!mockPassagesPromise) {
    mockPassagesPromise = import('../../../mocks/passages');
  }
  return mockPassagesPromise;
}

/**
 * v2.2.4 Stage 3 (Bug 14): 从(可能不完整的)JSON 文本中增量提取 "text" 字段的当前值.
 *
 * LLM 流式返回 JSON passage payload, 每个 chunk 是 JSON 片段.
 * 用户不应看到整个 JSON, 只应看到 passage.text (文章正文).
 * 此函数从累积 buffer 中增量提取 text 字段值 (已反转义), 未找到或未开始则返回 ''.
 *
 * 策略: 用正则定位 "text":" 起始, 然后逐字符扫描处理转义, 直到遇到未转义的闭合引号.
 * text 字段通常在 title 之后、tokens 之前, 能在流式早期开始展示.
 *
 * @param accumulated 累积的原始 JSON 片段
 * @returns 已接收到的 text 字段内容 (已反转义), 未找到返回 ''
 */
function extractStreamingText(accumulated: string): string {
  // 定位 "text":" 或 "text" : " (允许空格)
  const keyMatch = accumulated.match(/"text"\s*:\s*"/);
  if (!keyMatch || keyMatch.index === undefined) return '';
  const start = keyMatch.index + keyMatch[0].length;

  let result = '';
  let i = start;
  while (i < accumulated.length) {
    const ch = accumulated[i];
    if (ch === '\\') {
      // 转义序列
      const next = accumulated[i + 1];
      if (next === undefined) break; // 转义字符被截断, 等待更多 chunk
      switch (next) {
        case '"': result += '"'; break;
        case '\\': result += '\\'; break;
        case '/': result += '/'; break;
        case 'n': result += '\n'; break;
        case 't': result += '\t'; break;
        case 'r': result += '\r'; break;
        case 'b': result += '\b'; break;
        case 'f': result += '\f'; break;
        case 'u': {
          // \uXXXX, 需 4 位 hex; 不足则等待更多 chunk
          const hex = accumulated.slice(i + 2, i + 6);
          if (hex.length < 4) { i = accumulated.length; continue; }
          result += String.fromCharCode(parseInt(hex, 16));
          i += 6;
          continue;
        }
        default: result += next;
      }
      i += 2;
      continue;
    }
    if (ch === '"') {
      // 未转义的闭合引号, text 字段完整
      break;
    }
    result += ch;
    i += 1;
  }
  return result;
}

interface ReadingSessionState {
  session: ReadingSession | null;
  activeOccurrenceId: string | null;
  hoveredGroupId: string | null;
  activeGrammarPointId: string | null;
  hoveredGrammarTypeId: string | null;
  isLoading: boolean;
  lastConfig: { language: Language; difficulty: DifficultyLevel } | null;
  currentHistoryId: string | null;
  /** v2.2.4 Stage 2 (流式): 流式生成期间的渐进预览文本 (null = 非流式生成中) */
  streamingPreviewText: string | null;

  loadSession: (language: Language, difficulty: DifficultyLevel, lessonId?: string) => Promise<void>;
  loadFromHistory: (
    passage: Passage,
    language: Language,
    difficulty: DifficultyLevel,
    options?: { resetResolved?: boolean }
  ) => void;
  setLastConfig: (config: { language: Language; difficulty: DifficultyLevel }) => void;
  setActiveOccurrence: (occurrenceId: string | null) => void;
  setHoveredGroup: (groupId: string | null) => void;
  setActiveGrammarPoint: (grammarPointId: string | null) => void;
  setHoveredGrammarType: (grammarTypeId: string | null) => void;
  markOccurrenceResolved: (occurrenceId: string, grade?: 'correct' | 'partial' | 'wrong') => void;
  getLinkedOccurrences: (groupId: string) => TokenOccurrence[];
  getResolvedCount: () => number;
  getTotalTokenCount: () => number;
  getReviewTokens: () => TokenOccurrence[];
  getActiveGrammarPoint: () => GrammarPoint | null;
  clearSession: () => void;
}

// v2.2.4 Stage 1 (D1-5): 序列化后的 ReadingSession 形状.
// resolvedTokens 在 JSON 中序列化为 string[], 反序列化后由
// onRehydrateStorage 还原为 Set<string>. 此类型用于 partialize 返回值,
// 消除原 partialize 中的 `as unknown as Set<string>` 断言.
type PersistedReadingSession = Omit<ReadingSession, 'resolvedTokens'> & {
  resolvedTokens: string[];
};

export function buildReviewTokens(
  passage: Passage,
  dueCards: { lexemeGroupId: string; lemma: string; id: string; objectiveDifficulty: DifficultyLevel }[]
): TokenOccurrence[] {
  const newTokens: TokenOccurrence[] = [];
  // v1.5.3 fix V2-P2-008: 删除 usedIndices 死代码 (构建后从未使用, 重叠检查用 passage.tokens.some).

  for (const card of dueCards) {
    const lemmaLower = card.lemma.toLowerCase();
    const textLower = passage.text.toLowerCase();
    // v2.2.2 Stage 1 (Bug 6): 词边界正则匹配, 避免 "go" 匹配 "good" 的子串
    // 前后负向断言确保只匹配完整单词 (非字母/数字字符作为边界), 支持德语变音符
    const escapedLemma = lemmaLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wordBoundaryRe = new RegExp(`(?<![\\p{L}\\p{N}])${escapedLemma}(?![\\p{L}\\p{N}])`, 'giu');
    let occurrenceCount = 0;
    let match: RegExpExecArray | null;
    while ((match = wordBoundaryRe.exec(textLower)) !== null) {
      const idx = match.index;
      const endIdx = idx + match[0].length;
      const isOverlapping = passage.tokens.some(
        (t) => !(endIdx <= t.startIndex || idx >= t.endIndex)
      );
      if (!isOverlapping) {
        newTokens.push({
          id: `review-${card.id}-${occurrenceCount}`,
          lexemeGroupId: card.lexemeGroupId,
          surfaceForm: passage.text.substring(idx, endIdx),
          lemma: card.lemma,
          objectiveDifficulty: card.objectiveDifficulty,
          startIndex: idx,
          endIndex: endIdx,
          isResolved: false,
          isActive: false,
          kind: 'review',
          cardId: card.id,
          isReview: true,
          // v1.5.3 fix V4-P2-005: 补全必填字段, 移除 as TokenOccurrence 断言.
          isCompound: false,
          alignmentStatus: 'unknown',
          originalOffset: 0,
        });
        occurrenceCount += 1;
        if (occurrenceCount >= 2) break;
      }
    }
  }
  return newTokens;
}

/**
 * v1.5.3 fix V2-P2-004: loadSession 请求取消 controller (模块级单例).
 *
 * 快速连续触发 loadSession (例如用户狂点"生成新文本", 或切换语言/难度时
 * 旧请求未完成新请求已发出) 时, 通过 abort 旧 controller 取消旧请求,
 * 避免旧请求后写覆盖新请求的 session 状态 (典型竞态).
 *
 * 设计要点:
 * - 模块级单例: 同一时刻只保留最新一次 loadSession 的 controller.
 * - 不放 store state: 这是请求生命周期管理, 不属于应用状态, 不应被持久化/订阅.
 * - abort 仅作信号: loadSession 内部在 3 个关键点检查 controller.signal.aborted
 *   (300ms 等待后 / generatePassage catch 后 / generatePassage 成功后),
 *   提前 return 不写状态. generatePassage 内部也可消费此 signal (未来增强).
 */
let loadSessionAbortController: AbortController | null = null;

export const useReadingSessionStore = create<ReadingSessionState>()(
  persist(
    (set, get) => ({
      session: null,
      activeOccurrenceId: null,
      hoveredGroupId: null,
      activeGrammarPointId: null,
      hoveredGrammarTypeId: null,
      isLoading: false,
      lastConfig: null,
      currentHistoryId: null,
      streamingPreviewText: null,

      loadSession: async (language: Language, difficulty: DifficultyLevel, lessonId?: string) => {
        // v1.5.3 fix V2-P2-004: 请求取消机制.
        // 快速连续点击"生成新文本"或切换语言/难度时, 旧请求 abort, 避免竞态覆盖.
        if (loadSessionAbortController) {
          loadSessionAbortController.abort();
        }
        const controller = new AbortController();
        loadSessionAbortController = controller;

        set({ isLoading: true, streamingPreviewText: null });
        await new Promise((resolve) => setTimeout(resolve, 300));

        // abort 检查: 300ms 等待期间可能被新请求取消
        if (controller.signal.aborted) return;

        // v2.2.2 Stage 2 (Bug 7): 只注入 review/relearning 态卡片, new/learning 不注入新文章
        // (new 卡 due=now 但属于初始学习阶段, 不应跨文章复现; 与 passageGenerator.ts 内部
        // dueReviewCards 过滤口径对齐). 这个过滤同时影响传给 generatePassage 的 reviewWords
        // 和传给 buildReviewTokens 的 dueCards, 避免刚学完的词立即在新文章中复现.
        const dueCards = useMemoryStore.getState().getDueCards(language).filter(
          (c) => c.status === 'review' || c.status === 'relearning'
        );

        // v2.3.0 Stage 5: lessonId 非空时, 查找 lesson.targetLemmas 传给 generatePassage,
        // 让 LLM 在 passage 中自然融入课程目标词 (修复 Stage 3 gap: 之前 loadSession 未把
        // targetLemmas 注入 prompt). 不改变 loadSession 签名, 仅内部读取课程静态定义.
        let targetLemmas: string[] | undefined;
        if (lessonId) {
          // v1.6.1 Stage 1: 按需加载课程模块 (不再静态导入, 见文件头注释).
          const { useCourseStore, getLessonById } = await loadCourseModule();
          const courseState = useCourseStore.getState();
          if (courseState.currentCourseId && courseState.currentModuleId) {
            const found = getLessonById(
              courseState.currentCourseId,
              courseState.currentModuleId,
              lessonId
            );
            if (found) {
              targetLemmas = found.lesson.targetLemmas;
            }
          }
        }

        let passage: Passage;
        try {
          // Keep the complete LLM/parser graph out of the first-screen module
          // graph. Native ESM caches this module after the first reading request.
          const { generatePassage, clearPassageCache } = await import(
            '../services/passageGenerator'
          );
          if (controller.signal.aborted) return;
          // v2.2.1 Stage 1 (Bug 1): clear the passage cache before generation.
          clearPassageCache();
          // v1.5.3 fix V3-P3-006: 透传 controller.signal, abort 时真正中断 LLM fetch.
          // v2.2.4 Stage 2 (流式): 传 onChunk 回调, 流式生成时更新 streamingPreviewText.
          //   generatePassage 内部判断 llm.streaming + onChunk 决定是否走流式分支.
          // v2.2.4 Stage 3 (Bug 14): 流式预览只展示 passage.text 内容, 不展示整个 JSON.
          //   之前直接拼接原始 delta (JSON 片段), 用户看到 {"title":"...","text":"..."} 流式增长.
          //   修复: 累积原始 buffer, 用 extractStreamingText 增量提取 text 字段值 (反转义后).
          let rawStreamBuffer = '';
          passage = await generatePassage(
            language,
            difficulty,
            dueCards,
            controller.signal,
            true,
            (delta) => {
              if (!controller.signal.aborted) {
                rawStreamBuffer += delta;
                const textSoFar = extractStreamingText(rawStreamBuffer);
                set({ streamingPreviewText: textSoFar });
              }
            },
            targetLemmas
          );
        } catch {
          if (controller.signal.aborted) return;
          // v1.6.1 Stage 1: 按需加载 mock 兜底语料 (不再静态导入, 见文件头注释).
          const { getMockPassage } = await loadMockPassages();
          const basePassage = getMockPassage(language, difficulty);
          const reviewTokens = buildReviewTokens(basePassage, dueCards);
          passage = {
            ...basePassage,
            tokens: [...basePassage.tokens, ...reviewTokens],
          };
        }

        // abort 检查: generatePassage 期间可能被新请求取消
        if (controller.signal.aborted) return;

        if (dueCards.length > 0) {
          const reviewTokens = buildReviewTokens(passage, dueCards);
          if (reviewTokens.length > 0) {
            passage = {
              ...passage,
              tokens: [...passage.tokens, ...reviewTokens],
            };
          }
        }

        const historyId = useReadingHistoryStore.getState().addEntry({
          passage,
          language,
          difficulty,
          startedAt: Date.now(),
          resolvedCount: 0,
          // v1.5.2 fix P0-1: 与 getResolvedCount/getTotalTokenCount 同口径 (排除 review token)
          totalTokenCount: new Set(
            passage.tokens.filter((t) => t.kind !== 'review').map((t) => t.lexemeGroupId)
          ).size,
        });

        const session: ReadingSession = {
          id: `session-${Date.now()}`,
          language,
          difficulty,
          passage,
          startedAt: Date.now(),
          resolvedTokens: new Set(),
          activeOccurrenceId: null,
          // v2.3.0 Stage 3: 课程化模式关联课时 ID.
          lessonId: lessonId,
        };
        set({
          session,
          activeOccurrenceId: null,
          hoveredGroupId: null,
          activeGrammarPointId: null,
          hoveredGrammarTypeId: null,
          isLoading: false,
          streamingPreviewText: null,
          lastConfig: { language, difficulty },
          currentHistoryId: historyId,
        });

        // v2.3.0 Stage 3: lessonId 非空时, passage 生成 + 对齐完成后,
        // 对每个 token 的 lemma (去重后) 调用 recordEncounter (遇到, 非学会).
        // 只调用 recordEncounter; recordLearning 在答题答对后才调用.
        // lessonId 为空或未提供时完全跳过 (向后兼容, 不调用 useCourseStore).
        if (lessonId) {
          // v1.6.1 Stage 1: 按需加载课程模块 (不再静态导入, 见文件头注释).
          const { useCourseStore } = await loadCourseModule();
          const courseStore = useCourseStore.getState();
          const seenLemmas = new Set<string>();
          for (const token of passage.tokens) {
            const lemmaKey = token.lemma.toLowerCase();
            if (seenLemmas.has(lemmaKey)) continue;
            seenLemmas.add(lemmaKey);
            courseStore.recordEncounter(lessonId, token.lemma);
          }
        }

        // Stage 1: 累计 streak 并用真实数据触发成就评估。
        // v1.5.3 fix V3-P2-005: 用 buildAchievementContext 统一构建, 与复习流共用.
        useStreakStore.getState().recordDay();
        useAchievementStore.getState().checkAndUnlock(buildAchievementContext(false));
      },

      loadFromHistory: (passage, language, difficulty, options) => {
        // v2.2.1 Stage 1 (Bug 2 P0): 取消 in-flight loadSession, 避免历史重读与
        // 正在进行的 loadSession 竞态覆盖 session 状态.
        if (loadSessionAbortController) {
          loadSessionAbortController.abort();
          loadSessionAbortController = null;
        }
        const resetResolved = options?.resetResolved === true;
        // resetResolved=true 时深拷贝 passage 并将所有 token.isResolved 置 false (不修改原 passage).
        // resetResolved=false (默认) 时保留原 passage 引用 (向后兼容).
        const effectivePassage = resetResolved
          ? { ...passage, tokens: passage.tokens.map((t) => ({ ...t, isResolved: false })) }
          : passage;
        const session: ReadingSession = {
          id: `session-${Date.now()}`,
          language,
          difficulty,
          passage: effectivePassage,
          startedAt: Date.now(),
          resolvedTokens: resetResolved
            ? new Set()
            : new Set(passage.tokens.filter((t) => t.isResolved).map((t) => t.id)),
          activeOccurrenceId: null,
          // v1.5.2 fix P1-5: 标记为历史重读, ReadingSessionPage effect 跳过 addCardFromToken.
          // v2.2.1 Stage 1 (Bug 2 P1): resetResolved=true (重新练习) 时 isReplay=false,
          // 让用户能真正作答; resetResolved=false (普通历史回顾) 时仍为 true.
          isReplay: resetResolved ? false : true,
        };
        set({
          session,
          activeOccurrenceId: null,
          hoveredGroupId: null,
          activeGrammarPointId: null,
          hoveredGrammarTypeId: null,
          isLoading: false,
          streamingPreviewText: null,
          lastConfig: { language, difficulty },
          currentHistoryId: null,
        });
      },

      setLastConfig: (config) => set({ lastConfig: config }),

      setActiveOccurrence: (occurrenceId: string | null) => {
        set({ activeOccurrenceId: occurrenceId, activeGrammarPointId: null });
      },

      setHoveredGroup: (groupId: string | null) => {
        set({ hoveredGroupId: groupId });
      },

      setActiveGrammarPoint: (grammarPointId: string | null) => {
        set({ activeGrammarPointId: grammarPointId, activeOccurrenceId: null });
      },

      setHoveredGrammarType: (grammarTypeId: string | null) => {
        set({ hoveredGrammarTypeId: grammarTypeId });
      },

      markOccurrenceResolved: (occurrenceId: string, grade?: 'correct' | 'partial' | 'wrong') => {
        const { session } = get();
        if (!session) return;

        const token = session.passage.tokens.find((t) => t.id === occurrenceId);
        if (!token) return;

        const groupTokens = session.passage.tokens.filter(
          (t) => t.lexemeGroupId === token.lexemeGroupId
        );

        // v2.2.4 Stage 3 (Bug 13): resolvedGrade 解耦视觉表现.
        // isResolved=true 推进进度 (答对答错都前进), resolvedGrade 决定变绿/揭开动画.
        // grade 未传时 (旧调用方兼容) 默认 'correct', 保持旧行为.
        const resolvedGrade = grade ?? 'correct';

        const updatedTokens: TokenOccurrence[] = session.passage.tokens.map((t) => {
          const isInGroup = groupTokens.find((gt) => gt.id === t.id);
          if (isInGroup) {
            return {
              ...t,
              isResolved: true,
              isActive: false,
              resolvedGrade,
            };
          }
          return t;
        });

        const newResolved = new Set(session.resolvedTokens);
        groupTokens.forEach((t) => newResolved.add(t.id));

        set({
          session: {
            ...session,
            resolvedTokens: newResolved,
            passage: {
              ...session.passage,
              tokens: updatedTokens,
            },
          },
          activeOccurrenceId:
            get().activeOccurrenceId === occurrenceId ? null : get().activeOccurrenceId,
        });
      },

      getLinkedOccurrences: (groupId: string) => {
        const { session } = get();
        if (!session) return [];
        return session.passage.tokens.filter((t) => t.lexemeGroupId === groupId);
      },

      getResolvedCount: () => {
        const { session } = get();
        if (!session) return 0;
        // v1.5.2 fix P0-1: 进度分子分母口径统一, 仅统计 normal token (排除 review token).
        // review token 是"复现旧词", 不应计入"新词学习进度".
        // 之前 review token 的 lexemeGroupId 计入分子但不计入分母 (lexemeGroups.length),
        // 导致进度可超 100% (例如 8 新词 + 2 复现词全 resolve → 10/8 = 125%).
        const resolvedGroupIds = new Set(
          session.passage.tokens
            .filter((t) => t.isResolved && t.kind !== 'review')
            .map((t) => t.lexemeGroupId)
        );
        return resolvedGroupIds.size;
      },

      getTotalTokenCount: () => {
        const { session } = get();
        if (!session) return 0;
        // v1.5.2 fix P0-1: 分母与分子同口径, 基于 normal token 的 distinct lexemeGroupId.
        // 不再用 lexemeGroups.length (不含 review token 对应的 group, 导致口径不一致).
        const totalGroupIds = new Set(
          session.passage.tokens
            .filter((t) => t.kind !== 'review')
            .map((t) => t.lexemeGroupId)
        );
        return totalGroupIds.size;
      },

      getReviewTokens: () => {
        const { session } = get();
        if (!session) return [];
        return session.passage.tokens.filter((t) => t.kind === 'review');
      },

      getActiveGrammarPoint: () => {
        const { session, activeGrammarPointId } = get();
        if (!session || !activeGrammarPointId) return null;
        return session.passage.grammarPoints.find((gp) => gp.id === activeGrammarPointId) || null;
      },

      clearSession: () => {
        set({
          session: null,
          activeOccurrenceId: null,
          hoveredGroupId: null,
          activeGrammarPointId: null,
          hoveredGrammarTypeId: null,
        });
      },
    }),
    {
      name: 'wordaydream:reading-session',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        session: state.session
          ? ({
              ...state.session,
              resolvedTokens: Array.from(state.session.resolvedTokens),
            } as PersistedReadingSession)
          : null,
        lastConfig: state.lastConfig,
        currentHistoryId: state.currentHistoryId,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state?.session) return;
        // v2.2.4 Stage 1 (D1-5): 反序列化后 resolvedTokens 是 string[],
        // 用 PersistedReadingSession 类型断言访问, 还原为 Set<string>.
        const persisted = state.session as unknown as PersistedReadingSession;
        if (Array.isArray(persisted.resolvedTokens)) {
          state.session.resolvedTokens = new Set(persisted.resolvedTokens);
        }
      },
    }
  )
);

// 暴露到 window 方便 E2E 测试 (dev/test only, 不影响生产 bundle 行为)
if (typeof window !== 'undefined' && import.meta.env?.DEV) {
  window.__READING_STORE__ = useReadingSessionStore;
}
