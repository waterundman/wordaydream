import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Passage, Language, DifficultyLevel } from '../../../types';
import { publish } from '../../../domain/events';

export interface HistoryEntry {
  id: string;
  passage: Passage;
  language: Language;
  difficulty: DifficultyLevel;
  startedAt: number;
  completedAt?: number;
  resolvedCount: number;
  totalTokenCount: number;
}

interface ReadingHistoryState {
  history: HistoryEntry[];
  maxHistory: number;

  addEntry: (entry: Omit<HistoryEntry, 'id'>) => string;
  completeEntry: (id: string) => void;
  getEntry: (id: string) => HistoryEntry | undefined;
  getHistory: () => HistoryEntry[];
  removeEntry: (id: string) => void;
  clearHistory: () => void;
}

const MAX_HISTORY = 50;

// v1.5.3 fix V3-P3-001: 同毫秒 id 冲突防护计数器.
let historyIdCounter = 0;

export const useReadingHistoryStore = create<ReadingHistoryState>()(
  persist(
    (set, get) => ({
      history: [],
      maxHistory: MAX_HISTORY,

      addEntry: (entry) => {
        const newEntry: HistoryEntry = {
          ...entry,
          id: `history-${Date.now()}-${historyIdCounter++}`,
        };
        
        const history = [newEntry, ...get().history].slice(0, get().maxHistory);
        set({ history });
        return newEntry.id;
      },

      completeEntry: (id) => {
        // v2.1.0 Stage 2 (Contract 63): 激活死代码 — 之前 completeEntry 全项目 0 调用点,
        // 现由 ReadingSessionPage 在所有 token resolved 时调用.
        // 幂等性: 已完成的 entry 不重复 publish, 避免重复触发订阅方副作用.
        const existing = get().history.find((entry) => entry.id === id);
        if (!existing) return;
        if (existing.completedAt) return;

        const history = get().history.map((entry) =>
          entry.id === id ? { ...entry, completedAt: Date.now() } : entry
        );
        set({ history });

        // v2.1.0 Stage 2 (Contract 63): 发布 'reading:completed' 事件,
        // 供 ReviewPromptBanner / TodayCard 等订阅方响应阅读完成 (替代轮询).
        publish('reading:completed', {
          entryId: id,
          passageId: existing.passage.id,
          language: existing.language,
          difficulty: existing.difficulty,
        });
      },

      getEntry: (id) => {
        return get().history.find((entry) => entry.id === id);
      },

      getHistory: () => {
        return get().history;
      },

      removeEntry: (id) => {
        const history = get().history.filter((entry) => entry.id !== id);
        set({ history });
      },

      clearHistory: () => {
        set({ history: [] });
      },
    }),
    {
      name: 'wordaydream:reading-history',
      version: 2,
      storage: createJSONStorage(() => localStorage),
      // v1.5.3 fix V2-P2-007: 压缩持久化, 去除 tokens 中历史重读不需要的冗余字段.
      // 历史重读 (loadFromHistory) 仅需 token 的位置/词形/难度/解析状态用于渲染,
      // 不需要 alignment 阶段的调试字段 (alignmentStatus / originalOffset) 和
      // 可异步重建的 compoundParts (CompoundWordDisplay 会调 splitCompound 重新获取).
      // 单条 Passage 约 5-8KB → 压缩后约 3-5KB, 50 条历史节省 ~100KB+.
      // 缺失字段在 TokenOccurrence 类型中均为 optional, 不影响类型安全.
      partialize: (state) => ({
        ...state,
        history: state.history.map((entry) => ({
          ...entry,
          passage: {
            ...entry.passage,
            tokens: entry.passage.tokens.map((t) => ({
              id: t.id,
              lexemeGroupId: t.lexemeGroupId,
              surfaceForm: t.surfaceForm,
              lemma: t.lemma,
              objectiveDifficulty: t.objectiveDifficulty,
              startIndex: t.startIndex,
              endIndex: t.endIndex,
              isResolved: t.isResolved,
              isActive: t.isActive,
              kind: t.kind,
              isCompound: t.isCompound,
              // 保留 cardId/isReview: review token 需要 kind + cardId 标识来源.
              ...(t.cardId !== undefined ? { cardId: t.cardId } : {}),
              ...(t.isReview !== undefined ? { isReview: t.isReview } : {}),
              // 去除: alignmentStatus / originalOffset / compoundParts
              // (历史重读时 alignment 已完成, 无需调试信息; compoundParts 可异步重建)
            })),
          },
        })),
      }),
      // v2.1.0 hotfix: v1.5.3 fix V3-P3-001 之前 ID 格式为 `history-${Date.now()}` (无 counter 后缀),
      // 同毫秒添加的多条 entry 会产生重复 ID, 触发 React duplicate key 警告并可能导致列表渲染异常.
      // 此 migrate 检测重复 ID 并添加 index 后缀使其唯一, 一次性清理 localStorage 中的旧数据.
      migrate: (persistedState: unknown) => {
        const state = persistedState as Partial<ReadingHistoryState>;
        if (!state || !Array.isArray(state.history)) return state as ReadingHistoryState;
        const seenIds = new Set<string>();
        const migratedHistory = state.history.map((entry, index) => {
          if (seenIds.has(entry.id)) {
            return { ...entry, id: `${entry.id}-migrated-${index}` };
          }
          seenIds.add(entry.id);
          return entry;
        });
        return { ...state, history: migratedHistory } as ReadingHistoryState;
      },
    }
  )
);