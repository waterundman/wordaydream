import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { MemoryCard, Rating, AnswerEvaluation, Language } from '../../../types';
import { useMemoryStore } from '../store/useMemoryStore';
import { useWrongWordsStore } from './useWrongWordsStore';
import { SIMPLE_REMEDY_TEMPLATES_EN, SIMPLE_REMEDY_TEMPLATES_DE } from '../../llm/services/mockProvider';
import { useStreakStore } from '../../streak/store/useStreakStore';
import { useAchievementStore } from '../../achievements/store/useAchievementStore';
import { buildAchievementContext } from '../../achievements/services/buildContext';
import { useAppModeStore } from '../../../hooks/useAppModeStore';
import { notifyReviewCompleted } from '../../../platform/harmonyBridge';

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
  /**
   * v0.6.0-harmony Stage 1: 会话内定向定位到指定卡片。
   * 仅 mode === 'reviewing' 且 cardId 在 queue 中时生效：跳 currentIndex 并重置
   * 当前卡瞬时状态（userAnswer/evaluation/isEvaluating/isPaused/showRatingBar），
   * 返回 true。其余情况返回 false 且不修改任何状态。
   * 绝不触碰 results / startedAt / cardContexts，不触发 streak / 成就逻辑。
   */
  jumpToCard: (cardId: string) => boolean;
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
let evaluationRequestGeneration = 0;

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
        evaluationRequestGeneration += 1;
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

        // v2.1.0 Stage 1 (Contract 61): 进入复习前记录当前 AppMode 为 previousMode,
        // 供 exitReview 的 returnToPrevious 恢复 (修复 I1: 闭环断裂).
        // 必须在 set mode='reviewing' 之前调用, 此时 currentMode 仍是来源模式 (如 reading).
        useAppModeStore.getState().recordPreviousMode();

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

      jumpToCard: (cardId) => {
        const state = get();
        // 仅复习中且目标在队列中才定位；其余情况不修改任何状态，直接返回 false。
        if (state.mode !== 'reviewing') {
          return false;
        }
        const targetIndex = state.queue.findIndex((card) => card.id === cardId);
        if (targetIndex === -1) {
          return false;
        }
        // 重置当前卡瞬时交互状态，但绝不触碰 results / startedAt / cardContexts，
        // 也不触发 streak / 成就逻辑（与 startReview 不同，这是会话内跳转）。
        set({
          currentIndex: targetIndex,
          userAnswer: '',
          evaluation: null,
          isEvaluating: false,
          isPaused: false,
          showRatingBar: false,
        });
        return true;
      },

      setUserAnswer: (answer) => set({ userAnswer: answer }),

      submitAnswer: async (answer) => {
        const state = get();
        const currentCard = state.queue[state.currentIndex] ?? null;
        if (!currentCard || state.isEvaluating || state.isPaused) return null;

        const userAnswer = (answer ?? state.userAnswer).trim();
        if (!userAnswer) return null;

        set({ isEvaluating: true, evaluation: null });
        const requestGeneration = ++evaluationRequestGeneration;

        try {
          const { evaluateAnswer } = await import(
            '../../evaluation/services/evaluateAnswer'
          );
          const language = state.language;
          const evaluation = await evaluateAnswer(
            userAnswer,
            currentCard.lemma,
            currentCard.objectiveDifficulty,
            language
          );

          const latestState = get();
          if (
            requestGeneration !== evaluationRequestGeneration
            || latestState.mode !== 'reviewing'
            || latestState.isPaused
            || latestState.queue[latestState.currentIndex]?.id !== currentCard.id
          ) {
            return null;
          }

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
          const latestState = get();
          if (
            requestGeneration === evaluationRequestGeneration
            && latestState.mode === 'reviewing'
            && latestState.queue[latestState.currentIndex]?.id === currentCard.id
          ) {
            set({ isEvaluating: false });
          }
          return null;
        }
      },

      completeReview: (rating) => {
        // 注意: evaluation 是当前卡 (queue[currentIndex]) 在 submitAnswer 时落下,
        // 一直保留到 nextCard 才清空; completeReview 在二者之间调用, 故此处 evaluation
        // 即"当前被评分卡片"的作答判定, 与 v0.8.0 完成页错词口径同源。
        const { queue, currentIndex, results, evaluation } = get();
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

        // v0.9.0 Stage 1: 答错自动入账错词本 (跨会话持久化).
        // 口径选择: 以 evaluation?.grade === 'wrong' 判定入账 (与 v0.8.0 完成页"本次错词回顾"
        // 同源, 保证两处错词口径一致). 不取 rating === 'again':
        //  - partial(拼写部分正确) 不算错词 (完成页同样不计入);
        //  - 用户可在答错后改评 'again'/'hard', rating 不直接反映本次作答判定,
        //    而 grade 是评估器对本次作答的最终判定, 更贴合"答错"语义.
        // 包裹 try/catch: 错词本写入 (localStorage 序列化/配额) 失败绝不阻塞复习主流程.
        if (evaluation?.grade === 'wrong') {
          try {
            useWrongWordsStore.getState().recordWrong(card, Date.now());
          } catch {
            // 静默: 存储不可用 / 序列化失败, 不影响复习
          }
        }

        // Stage 2 (v0.5.0-harmony): 复习会话全部完成时主动刷新服务卡片.
        // 仅在当前卡是队列最后一张时触发一次 (会话完成点), 避免每张卡评分都刷新.
        // fire-and-forget, 异常仅日志, 绝不阻塞 / 影响复习主流程.
        if (queue.length > 0 && currentIndex === queue.length - 1) {
          void notifyReviewCompleted().catch((e: unknown) => {
            console.warn('[reviewSession] notifyReviewCompleted failed:', e);
          });
        }
      },

      nextCard: () => {
        evaluationRequestGeneration += 1;
        const { currentIndex, queue } = get();
        const nextIdx = currentIndex + 1;
        if (nextIdx >= queue.length) {
          set({ mode: 'completed', isEvaluating: false });

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

      pauseReview: () => {
        evaluationRequestGeneration += 1;
        set({ isPaused: true, isEvaluating: false });
      },
      resumeReview: () => set({ isPaused: false }),

      exitReview: () => {
        evaluationRequestGeneration += 1;
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
        // v2.1.0 Stage 1 (Contract 61): 退出复习时回到 previousMode (如 reading),
        // 修复 I1 闭环断裂. previousMode 由 startReview 调用 recordPreviousMode 记录.
        // 若 previousMode=null (无记录, 如 persist 恢复), returnToPrevious 回 home.
        // App.tsx useEffect (line 58-64) 第二条作为兜底: 异常 idle 且 appMode 仍 review 时回 home.
        useAppModeStore.getState().returnToPrevious();
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
