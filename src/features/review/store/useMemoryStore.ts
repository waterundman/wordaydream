import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { MemoryCard, TokenOccurrence, Rating, Language } from '../../../types';
import { createInitialMemoryCard, scheduleNextReview } from '../services/schedulerAdapter';
import { publish } from '../../../domain/events';
import type { MemoryCardsUpdatedPayload } from '../../../domain/events';

interface MemoryStore {
  cards: Map<string, MemoryCard>;
  newlyAdded: string[];
  ratingHistory: Array<{ cardId: string; rating: Rating; at: number }>;
  schemaVersion: number;

  addCardFromToken: (token: TokenOccurrence, language?: Language) => MemoryCard;
  getCardByLexemeGroup: (groupId: string) => MemoryCard | undefined;
  getCardByLemma: (lemma: string, language?: 'en' | 'de') => MemoryCard | undefined;
  getCardCount: () => number;
  getNewlyAdded: () => MemoryCard[];
  rateCard: (cardId: string, rating: Rating) => void;
  // v1.5.3 fix V4-P3-008: 返回类型改为 nullable, 调用方需处理 null.
  getRatingPreviews: (cardId: string) => Record<Rating, { card: MemoryCard; nextReviewAt: number }> | null;
  clearNewlyAdded: () => void;
  getDueCards: (language?: 'en' | 'de', now?: number) => MemoryCard[];
  getReviewingCards: () => MemoryCard[];
  resetAll: () => void;
}

const SCHEMA_VERSION = 2;

export const useMemoryStore = create<MemoryStore>()(
  persist(
    (set, get) => ({
      cards: new Map(),
      newlyAdded: [],
      ratingHistory: [],
      schemaVersion: SCHEMA_VERSION,

      addCardFromToken: (token: TokenOccurrence, language?: Language) => {
        const existing = get().cards.get(token.lexemeGroupId);
        if (existing) {
          return existing;
        }

        const card = createInitialMemoryCard(
          token.lexemeGroupId,
          token.lemma,
          token.objectiveDifficulty,
          language
        );

        const newCards = new Map(get().cards);
        newCards.set(token.lexemeGroupId, card);

        set({
          cards: newCards,
          newlyAdded: [...get().newlyAdded, token.lexemeGroupId],
        });

        // v2.0.0 Stage 2: 同步 wordlist 进度 (addCardFromToken 不是复习, isReview=false)
        publish<MemoryCardsUpdatedPayload>('memory:cards-updated', { cards: newCards, isReview: false });

        return card;
      },

      getCardByLexemeGroup: (groupId: string) => {
        return get().cards.get(groupId);
      },

      getCardByLemma: (lemma: string, language?: 'en' | 'de') => {
        const target = lemma.toLowerCase();
        for (const card of get().cards.values()) {
          if (card.lemma.toLowerCase() !== target) continue;
          // v1.6.0 Stage 3.5-B: 按 language 精确匹配 (同 lemma 不同语言视为不同词)
          // card.language 为 undefined 时 (旧卡片) 不过滤, 保持向后兼容
          if (language && card.language && card.language !== language) continue;
          return card;
        }
        return undefined;
      },

      getCardCount: () => get().cards.size,

      getNewlyAdded: () => {
        const { cards, newlyAdded } = get();
        return newlyAdded
          .map((id) => cards.get(id))
          .filter((c): c is MemoryCard => c !== undefined);
      },

      rateCard: (cardId: string, rating: Rating) => {
        const card = get().cards.get(cardId);
        if (!card) return;

        const result = scheduleNextReview(card, rating);
        const newCards = new Map(get().cards);
        newCards.set(cardId, result.card);

        set({
          cards: newCards,
          ratingHistory: [
            ...get().ratingHistory,
            { cardId, rating, at: Date.now() },
          ].slice(-200),
        });

        // v2.0.0 Stage 2: 同步 wordlist 进度 + 记录复习 (v1.6.0 Stage 3.5-6 dailyGoal)
        publish<MemoryCardsUpdatedPayload>('memory:cards-updated', { cards: newCards, isReview: true });
      },

      getRatingPreviews: (cardId: string) => {
        const card = get().cards.get(cardId);
        // v1.5.3 fix V4-P3-008: 卡片不存在时返回 null, 不再用 {} as MemoryCard.
        if (!card) return null;
        return {
          again: scheduleNextReview(card, 'again'),
          hard: scheduleNextReview(card, 'hard'),
          good: scheduleNextReview(card, 'good'),
          easy: scheduleNextReview(card, 'easy'),
        };
      },

      clearNewlyAdded: () => set({ newlyAdded: [] }),

      getDueCards: (language, now = Date.now()) => {
        const result: MemoryCard[] = [];
        for (const card of get().cards.values()) {
          if (card.due > now) continue;
          if (language && card.lemma) {
            // 优先使用 card.language 精确匹配（v1.5.2 修复 H1）
            if (card.language) {
              if (card.language !== language) continue;
            } else {
              // v1.5.3 fix V3-P2-007: 改进语言推断, 用变音符 + 首字母大写综合判断.
              // 之前仅用 /^[a-z]/ 判断英语, 但德语动词/形容词/副词都是小写开头
              // (如 laufen/schön/verstehen), 会被误判为英语, 导致德语复习时被过滤.
              // 德语特征: 含 ä/ö/ü/ß, 或首字母大写 (德语名词统一大写).
              const hasGermanChars = /[äöüß]/i.test(card.lemma);
              const startsUpper = /^[A-ZÄÖÜ]/.test(card.lemma);
              const isGerman = hasGermanChars || startsUpper;
              if (language === 'en' && isGerman) continue;
              if (language === 'de' && !isGerman) continue;
            }
          }
          result.push(card);
        }
        return result.sort((a, b) => a.due - b.due);
      },

      getReviewingCards: () => {
        const all: MemoryCard[] = [];
        for (const card of get().cards.values()) {
          if (card.status === 'review' || card.status === 'relearning') {
            all.push(card);
          }
        }
        return all.sort((a, b) => a.due - b.due);
      },

      resetAll: () => {
        set({
          cards: new Map(),
          newlyAdded: [],
          ratingHistory: [],
        });
      },
    }),
    {
      name: 'wordaydream:memory',
      version: SCHEMA_VERSION,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        cards: Object.fromEntries(state.cards),
        ratingHistory: state.ratingHistory,
        schemaVersion: state.schemaVersion,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        if (state.cards && !(state.cards instanceof Map)) {
          state.cards = new Map(Object.entries(state.cards));
        }
      },
      // v1.5.3 fix V4-P2-003: 实现 migrate, 为旧数据补 learningSteps 和 language 字段.
      migrate: (persistedState, version) => {
        const state = persistedState as Partial<MemoryStore>;
        if (!state.cards) return persistedState;

        const cards: Map<string, MemoryCard> = state.cards instanceof Map
          ? state.cards
          : new Map(Object.entries(state.cards as Record<string, MemoryCard>));

        if (version < 2) {
          for (const card of cards.values()) {
            // 旧卡片没有 learningSteps 字段, 补默认值.
            if (card.learningSteps === undefined) {
              card.learningSteps = card.status === 'learning' ? 1 : 0;
            }
            // 旧卡片可能没有 language 字段, 用变音符推断.
            if (!card.language) {
              card.language = /[äöüß]/i.test(card.lemma) ? 'de' : 'en';
            }
          }
        }

        state.cards = cards;
        return state as typeof persistedState;
      },
    }
  )
);
