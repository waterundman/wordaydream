import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Passage, Language, DifficultyLevel } from '../../../types';

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
        const history = get().history.map((entry) =>
          entry.id === id ? { ...entry, completedAt: Date.now() } : entry
        );
        set({ history });
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
      version: 1,
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
      // v1.5.2 fix L3: 占位 migrate, 未来 schema bump 需补真实迁移逻辑.
      migrate: (persistedState) => persistedState,
    }
  )
);