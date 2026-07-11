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
import { getMockPassage } from '../../../mocks/passages';
import { useMemoryStore } from '../../review/store/useMemoryStore';
import { generatePassage } from '../services/passageGenerator';
import { useReadingHistoryStore } from './useReadingHistoryStore';
import { useStreakStore } from '../../streak/store/useStreakStore';
import { useAchievementStore } from '../../achievements/store/useAchievementStore';
import { buildAchievementContext } from '../../achievements/services/buildContext';

interface ReadingSessionState {
  session: ReadingSession | null;
  activeOccurrenceId: string | null;
  hoveredGroupId: string | null;
  activeGrammarPointId: string | null;
  hoveredGrammarTypeId: string | null;
  isLoading: boolean;
  lastConfig: { language: Language; difficulty: DifficultyLevel } | null;
  currentHistoryId: string | null;

  loadSession: (language: Language, difficulty: DifficultyLevel) => Promise<void>;
  loadFromHistory: (passage: Passage, language: Language, difficulty: DifficultyLevel) => void;
  setActiveOccurrence: (occurrenceId: string | null) => void;
  setHoveredGroup: (groupId: string | null) => void;
  setActiveGrammarPoint: (grammarPointId: string | null) => void;
  setHoveredGrammarType: (grammarTypeId: string | null) => void;
  markOccurrenceResolved: (occurrenceId: string) => void;
  getLinkedOccurrences: (groupId: string) => TokenOccurrence[];
  getResolvedCount: () => number;
  getTotalTokenCount: () => number;
  getReviewTokens: () => TokenOccurrence[];
  getActiveGrammarPoint: () => GrammarPoint | null;
  clearSession: () => void;
}

function buildReviewTokens(
  passage: Passage,
  dueCards: { lexemeGroupId: string; lemma: string; id: string; objectiveDifficulty: DifficultyLevel }[]
): TokenOccurrence[] {
  const newTokens: TokenOccurrence[] = [];
  // v1.5.3 fix V2-P2-008: 删除 usedIndices 死代码 (构建后从未使用, 重叠检查用 passage.tokens.some).

  for (const card of dueCards) {
    const lemmaLower = card.lemma.toLowerCase();
    const textLower = passage.text.toLowerCase();
    let idx = -1;
    let occurrenceCount = 0;
    while ((idx = textLower.indexOf(lemmaLower, idx + 1)) !== -1) {
      const endIdx = idx + card.lemma.length;
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

      loadSession: async (language: Language, difficulty: DifficultyLevel) => {
        // v1.5.3 fix V2-P2-004: 请求取消机制.
        // 快速连续点击"生成新文本"或切换语言/难度时, 旧请求 abort, 避免竞态覆盖.
        if (loadSessionAbortController) {
          loadSessionAbortController.abort();
        }
        const controller = new AbortController();
        loadSessionAbortController = controller;

        set({ isLoading: true });
        await new Promise((resolve) => setTimeout(resolve, 300));

        // abort 检查: 300ms 等待期间可能被新请求取消
        if (controller.signal.aborted) return;

        const dueCards = useMemoryStore.getState().getDueCards(language);

        let passage: Passage;
        try {
          // v1.5.3 fix V3-P3-006: 透传 controller.signal, abort 时真正中断 LLM fetch.
          passage = await generatePassage(language, difficulty, dueCards, controller.signal);
        } catch {
          if (controller.signal.aborted) return;
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
        };
        set({
          session,
          activeOccurrenceId: null,
          hoveredGroupId: null,
          activeGrammarPointId: null,
          hoveredGrammarTypeId: null,
          isLoading: false,
          lastConfig: { language, difficulty },
          currentHistoryId: historyId,
        });

        // Stage 1: 累计 streak 并用真实数据触发成就评估。
        // v1.5.3 fix V3-P2-005: 用 buildAchievementContext 统一构建, 与复习流共用.
        useStreakStore.getState().recordDay();
        useAchievementStore.getState().checkAndUnlock(buildAchievementContext(false));
      },

      loadFromHistory: (passage: Passage, language: Language, difficulty: DifficultyLevel) => {
        const session: ReadingSession = {
          id: `session-${Date.now()}`,
          language,
          difficulty,
          passage,
          startedAt: Date.now(),
          resolvedTokens: new Set(passage.tokens.filter((t) => t.isResolved).map((t) => t.id)),
          activeOccurrenceId: null,
          // v1.5.2 fix P1-5: 标记为历史重读, ReadingSessionPage effect 跳过 addCardFromToken.
          isReplay: true,
        };
        set({
          session,
          activeOccurrenceId: null,
          hoveredGroupId: null,
          activeGrammarPointId: null,
          hoveredGrammarTypeId: null,
          isLoading: false,
          lastConfig: { language, difficulty },
          currentHistoryId: null,
        });
      },

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

      markOccurrenceResolved: (occurrenceId: string) => {
        const { session } = get();
        if (!session) return;

        const token = session.passage.tokens.find((t) => t.id === occurrenceId);
        if (!token) return;

        const groupTokens = session.passage.tokens.filter(
          (t) => t.lexemeGroupId === token.lexemeGroupId
        );

        const updatedTokens: TokenOccurrence[] = session.passage.tokens.map((t) => {
          const isInGroup = groupTokens.find((gt) => gt.id === t.id);
          if (isInGroup) {
            return {
              ...t,
              isResolved: true,
              isActive: false,
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
          ? {
              ...state.session,
              resolvedTokens: Array.from(state.session.resolvedTokens) as unknown as Set<string>,
            }
          : null,
        lastConfig: state.lastConfig,
        currentHistoryId: state.currentHistoryId,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state?.session) return;
        if (Array.isArray(state.session.resolvedTokens)) {
          state.session.resolvedTokens = new Set(state.session.resolvedTokens);
        }
      },
      // v1.5.2 fix L3: 占位 migrate, 未来 schema bump 需补真实迁移逻辑.
      migrate: (persistedState) => persistedState,
    }
  )
);

// 暴露到 window 方便 E2E 测试 (dev/test only, 不影响生产 bundle 行为)
if (typeof window !== 'undefined' && import.meta.env?.DEV) {
  (window as unknown as { __READING_STORE__: typeof useReadingSessionStore }).__READING_STORE__ = useReadingSessionStore;
}
