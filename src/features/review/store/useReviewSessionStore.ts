import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { MemoryCard, Rating, AnswerEvaluation, Language } from '../../../types';
import { useMemoryStore } from '../store/useMemoryStore';
import { evaluateAnswer } from '../../evaluation/services/evaluateAnswer';
import { SIMPLE_REMEDY_TEMPLATES_EN, SIMPLE_REMEDY_TEMPLATES_DE } from '../../llm/services/mockProvider';
import { useStreakStore } from '../../streak/store/useStreakStore';
import { useAchievementStore } from '../../achievements/store/useAchievementStore';
import { buildAchievementContext } from '../../achievements/services/buildContext';

export type ReviewMode = 'idle' | 'reviewing' | 'completed';

export interface ReviewCardResult {
  cardId: string;
  rating: Rating | null;
  evaluation: AnswerEvaluation | null;
  answeredAt: number;
}

export interface ReviewStats {
  total: number;
  correct: number;
  partial: number;
  wrong: number;
  again: number;
  hard: number;
  good: number;
  easy: number;
}

interface ReviewSessionState {
  mode: ReviewMode;
  language: Language;
  queue: MemoryCard[];
  currentIndex: number;
  userAnswer: string;
  evaluation: AnswerEvaluation | null;
  isEvaluating: boolean;
  isPaused: boolean;
  showRatingBar: boolean;
  results: ReviewCardResult[];
  startedAt: number;
  /** 卡片上下文短句缓存: cardId -> sentence */
  cardContexts: Record<string, string>;

  startReview: (language?: Language) => void;
  setUserAnswer: (answer: string) => void;
  submitAnswer: (answer?: string) => Promise<AnswerEvaluation | null>;
  completeReview: (rating: Rating) => void;
  nextCard: () => void;
  pauseReview: () => void;
  resumeReview: () => void;
  exitReview: () => void;
  recordContext: (cardId: string, sentence: string) => void;
  getContextForCard: (cardId: string) => string | undefined;
  getStats: () => ReviewStats;
  getCurrentCard: () => MemoryCard | null;
  getProgress: () => { current: number; total: number };
}

function buildFallbackContext(card: MemoryCard, language: Language): string {
  const lemma = card.lemma;
  if (language === 'de') {
    return `Ein Beispiel mit "${lemma}" in einem einfachen Satz.`;
  }
  return `An example sentence using "${lemma}" in a simple context.`;
}

const SCHEMA_VERSION = 1;

export const useReviewSessionStore = create<ReviewSessionState>()(
  persist(
    (set, get) => ({
      mode: 'idle',
      language: 'en',
      queue: [],
      currentIndex: 0,
      userAnswer: '',
      evaluation: null,
      isEvaluating: false,
      isPaused: false,
      showRatingBar: false,
      results: [],
      startedAt: 0,
      cardContexts: {},

      startReview: (language) => {
        const lang = language ?? get().language;
        const dueCards = useMemoryStore.getState().getDueCards(lang);
        if (dueCards.length === 0) {
          set({
            mode: 'idle',
            language: lang,
            queue: [],
            currentIndex: 0,
            userAnswer: '',
            evaluation: null,
            isEvaluating: false,
            isPaused: false,
            showRatingBar: false,
            results: [],
            startedAt: 0,
          });
          return;
        }

        set({
          mode: 'reviewing',
          language: lang,
          queue: dueCards,
          currentIndex: 0,
          userAnswer: '',
          evaluation: null,
          isEvaluating: false,
          isPaused: false,
          showRatingBar: false,
          results: [],
          startedAt: Date.now(),
        });

        // Stage 2: 复习会话开始时也累计 streak, 并评估 streak 类成就。
        // recordDay() 内部幂等 (同一日期重复调用直接 return),
        // 即使用户先在阅读流走过一遍, 也不会重复递增。
        // v1.5.3 fix V3-P2-005: 用 buildAchievementContext 传真实数据, 之前全 0/空.
        useStreakStore.getState().recordDay();
        useAchievementStore.getState().checkAndUnlock(buildAchievementContext(false));
      },

      setUserAnswer: (answer) => set({ userAnswer: answer }),

      submitAnswer: async (answer) => {
        const state = get();
        const currentCard = state.queue[state.currentIndex] ?? null;
        if (!currentCard || state.isEvaluating || state.isPaused) return null;

        const userAnswer = (answer ?? state.userAnswer).trim();
        if (!userAnswer) return null;

        set({ isEvaluating: true, evaluation: null });

        try {
          const language = state.language;
          const evaluation = await evaluateAnswer(
            userAnswer,
            currentCard.lemma,
            currentCard.objectiveDifficulty,
            language
          );

          set({
            evaluation,
            isEvaluating: false,
            showRatingBar: true,
            results: [
              ...get().results,
              {
                cardId: currentCard.id,
                rating: null,
                evaluation,
                answeredAt: Date.now(),
              },
            ],
          });

          if (evaluation.grade !== 'wrong') {
            get().recordContext(currentCard.id, userAnswer);
          }

          return evaluation;
        } catch (err) {
          console.warn('[reviewSession] submit failed:', err);
          set({ isEvaluating: false });
          return null;
        }
      },

      completeReview: (rating) => {
        const { queue, currentIndex, results } = get();
        const card = queue[currentIndex];
        if (!card) return;

        useMemoryStore.getState().rateCard(card.lexemeGroupId, rating);

        const hasMatching = results.some(
          (r) => r.cardId === card.id && r.rating === null
        );
        const finalResults = hasMatching
          ? results.map((r) =>
              r.cardId === card.id && r.rating === null
                ? { ...r, rating, answeredAt: Date.now() }
                : r
            )
          : [
              ...results,
              { cardId: card.id, rating, evaluation: null, answeredAt: Date.now() },
            ];

        set({
          results: finalResults,
          showRatingBar: false,
        });
      },

      nextCard: () => {
        const { currentIndex, queue } = get();
        const nextIdx = currentIndex + 1;
        if (nextIdx >= queue.length) {
          set({ mode: 'completed' });

          // Stage 2: 复习会话结束, 评估成就。
          // perfect = 至少答过一题且零错误 (wrong === 0);
          // partial (拼写部分正确) 不算无错, 留作后续阶段决定是否放宽。
          // v1.5.3 fix V3-P2-005: 用 buildAchievementContext 传真实数据, 之前全 0/空.
          const stats = get().getStats();
          const lastSessionPerfect = stats.total > 0 && stats.wrong === 0;
          useAchievementStore.getState().checkAndUnlock(buildAchievementContext(lastSessionPerfect));
        } else {
          set({
            currentIndex: nextIdx,
            userAnswer: '',
            evaluation: null,
            isEvaluating: false,
            showRatingBar: false,
          });
        }
      },

      pauseReview: () => set({ isPaused: true }),
      resumeReview: () => set({ isPaused: false }),

      exitReview: () => {
        set({
          mode: 'idle',
          queue: [],
          currentIndex: 0,
          userAnswer: '',
          evaluation: null,
          isEvaluating: false,
          isPaused: false,
          showRatingBar: false,
        });
      },

      recordContext: (cardId, sentence) => {
        if (!sentence || !sentence.trim()) return;
        set((s) => ({
          cardContexts: { ...s.cardContexts, [cardId]: sentence.trim() },
        }));
      },

      getContextForCard: (cardId) => {
        return get().cardContexts[cardId];
      },

      getStats: () => {
        const { results } = get();
        const stats: ReviewStats = {
          total: results.length,
          correct: 0,
          partial: 0,
          wrong: 0,
          again: 0,
          hard: 0,
          good: 0,
          easy: 0,
        };
        for (const r of results) {
          if (r.evaluation) {
            if (r.evaluation.grade === 'correct') stats.correct += 1;
            else if (r.evaluation.grade === 'partial') stats.partial += 1;
            else stats.wrong += 1;
          }
          if (r.rating) {
            stats[r.rating] += 1;
          }
        }
        return stats;
      },

      getCurrentCard: () => {
        const { queue, currentIndex } = get();
        return queue[currentIndex] ?? null;
      },

      getProgress: () => {
        const { currentIndex, queue } = get();
        return {
          current: Math.min(currentIndex + 1, queue.length),
          total: queue.length,
        };
      },
    }),
    {
      name: 'wordaydream:review-session',
      version: SCHEMA_VERSION,
      storage: createJSONStorage(() => localStorage),
      // v1.5.3 fix V2-P2-001: 不持久化 queue (MemoryCard[] 快照).
      // queue 是复习会话开始时从 useMemoryStore.getDueCards() 拷贝的快照,
      // 持久化后刷新页面, queue 中的 FSRS 状态 (stability/difficulty/reps/due)
      // 可能与 memory store 中的最新状态不一致, 导致重复评分 / reps 错误累加.
      // 刷新后若 mode='reviewing', onRehydrateStorage 从 memory store 重建 queue.
      // 同时不持久化 evaluation/userAnswer/showRatingBar/isEvaluating:
      // 这些是当前卡片的瞬时交互状态, 刷新后应重置, 避免用户卡在
      // "showRatingBar=false 且 evaluation=null" 的死锁状态.
      partialize: (state) => ({
        mode: state.mode,
        language: state.language,
        currentIndex: state.currentIndex,
        results: state.results,
        startedAt: state.startedAt,
        cardContexts: state.cardContexts,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // 刷新后重置瞬时交互状态, 确保用户可以从当前卡片重新开始答题.
        state.evaluation = null;
        state.userAnswer = '';
        state.showRatingBar = false;
        state.isEvaluating = false;
        state.isPaused = false;

        if (state.mode === 'reviewing') {
          // 从 memory store 重建 queue: 只保留仍 due 的卡片.
          // 已评分的卡片 due date 已更新, 不会出现在 getDueCards 结果中,
          // 避免对同一卡片重复评分.
          const freshDue = useMemoryStore.getState().getDueCards(state.language);
          state.queue = freshDue;
          // clamp currentIndex 到有效范围 (queue 重建后长度可能变化).
          if (state.currentIndex >= freshDue.length) {
            state.currentIndex = Math.max(0, freshDue.length - 1);
          }
          // 若重建后 queue 为空 (所有卡片都已复习完), 标记会话完成.
          if (freshDue.length === 0) {
            state.mode = 'completed';
          }
        } else {
          // idle / completed 状态: queue 留空, 由 startReview 重新填充.
          state.queue = [];
        }
      },
      // v1.5.2 fix L3: 占位 migrate, 未来 schema bump 需补真实迁移逻辑.
      migrate: (persistedState) => persistedState,
    }
  )
);

/**
 * 获取某张复习卡的展示用上下文短句
 *
 * 优先级:
 * 1. 用户答对时已记录的上下文
 * 2. mock 模式预置的 SIMPLE_REMEDY_TEMPLATES
 * 3. fallback 简单模板
 */
export function resolveContextSentence(
  card: MemoryCard,
  language: Language,
  recorded?: string
): string {
  if (recorded && recorded.trim().length > 0) {
    return recorded.trim();
  }

  const table = language === 'en' ? SIMPLE_REMEDY_TEMPLATES_EN : SIMPLE_REMEDY_TEMPLATES_DE;
  const lemmaKey = card.lemma.toLowerCase();
  if (table[lemmaKey]) return table[lemmaKey];

  return buildFallbackContext(card, language);
}


