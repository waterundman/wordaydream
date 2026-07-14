/**
 * v1.6.0 词表进度 Store (v2: 教学编排层)
 *
 * 职责:
 * - 跟踪词表中每个词的学习状态 (unseen / learning / mastered)
 * - 追踪 encounterCount (在不同 passage 中答对的次数, 按 passageId 去重)
 * - 提供"未学词"列表给 passageGenerator, 约束 LLM 生成
 * - 提供等级解锁判定 (闯关模式: 上一级 ≥80% mastered)
 * - 从 useMemoryStore.cards 派生 progress (单向同步, 不反向写)
 *
 * v2 升级 (Stage 3.5):
 * - progress 从 Record<string, WordStatus> 升级为 Record<string, WordProgress>
 * - mastered 判定加 encounterCount>=2 语境闭环
 * - 新增 recordEncounter(language, lemma, passageId) 方法
 * - v1.6.1 Stage 1: mastered 衰减 — 改用 ts-fsrs get_retrievability(card) < 0.9 判定 (替代原 30 天窗口硬编码)
 *
 * 持久化:
 * - progress: Record<string, WordProgress>, key = `${language}:${lemma.toLowerCase()}`
 * - linearMode: 闯关模式 (默认 true) vs 自由模式
 * - schemaVersion: 2
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { DifficultyLevel, Language, MemoryCard } from '../../../types';
import { loadWordlist, getCachedWordlist } from '../../../data/wordlists';
import { makeProgress, syncFromMemoryCards as syncFromMemoryCardsDomain } from '../../../domain/wordlistDomain';
import { subscribe } from '../../../domain/events';
import type { MemoryCardsUpdatedPayload } from '../../../domain/events';
import type { WordStatus, WordProgress } from '../../../domain/wordlistDomain';

// v2.0.0 Stage 2: WordStatus / WordProgress 从 domain 层 re-export (canonical source).
export type { WordStatus, WordProgress } from '../../../domain/wordlistDomain';

/** v1.6.0 Stage 3.5-6: 每日学习目标 */
export interface DailyGoal {
  /** yyyy-mm-dd (跨日重置锚点) */
  date: string;
  /** 今日建议新词数 (初期固定 10) */
  newWordsTarget: number;
  /** 今日已学新词数 (unseen → learning 时 ++) */
  newWordsDone: number;
  /** v1.6.0 Stage 3.6-C: 今日建议复习数 (取 dueCards.length) */
  reviewsTarget: number;
  /** 今日已复习数 (rateCard 时 ++) */
  reviewsDone: number;
}

/** 解锁阈值: 上一级 mastered 比例 */
const UNLOCK_THRESHOLD = 0.8;

/** v1.6.0 Stage 3.5-6: 今日日期字符串 (yyyy-mm-dd), 跨日重置锚点 */
function getTodayString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** v1.6.0 Stage 3.5-6: 构造一个新的 dailyGoal (跨日重置时使用) */
function makeFreshDailyGoal(today: string, reviewsTarget: number = 0): DailyGoal {
  return { date: today, newWordsTarget: 10, newWordsDone: 0, reviewsTarget, reviewsDone: 0 };
}

interface WordlistStore {
  /** key = `${language}:${lemma.toLowerCase()}`, value = WordProgress */
  progress: Record<string, WordProgress>;
  /** 闯关模式 (默认 true) vs 自由模式 */
  linearMode: boolean;
  schemaVersion: number;
  /** v1.6.0 Stage 3.5-6: 每日学习目标 */
  dailyGoal: DailyGoal;

  // === 派生查询 (同步, 基于已缓存词表) ===

  /** 获取指定等级词表的总词数 (需词表已加载, 否则返回 0) */
  getLevelTotalSync: (language: Language, difficulty: DifficultyLevel) => number;

  /** 获取指定等级已掌握词数 */
  getMasteredCount: (language: Language, difficulty: DifficultyLevel) => number;

  /** 获取指定等级已学词数 (learning + mastered) */
  getLearnedCount: (language: Language, difficulty: DifficultyLevel) => number;

  /** 获取指定等级未学词列表 (基于已缓存词表, 最多 limit 个) */
  getUnlearnedWordsSync: (language: Language, difficulty: DifficultyLevel, limit: number) => string[];

  /** 获取指定等级学习中词列表 (status === 'learning', 用于 passageGenerator optionalWords 强化复现) */
  getLearningWordsSync: (language: Language, difficulty: DifficultyLevel, limit: number) => string[];

  /** 等级是否解锁 */
  isLevelUnlocked: (language: Language, difficulty: DifficultyLevel) => boolean;

  /** v1.6.0 Stage 1: 检查指定等级是否 100% mastered (毕业条件). C1 (难度5) 或词表未加载返回 false. */
  checkLevelCompletion: (language: Language, difficulty: DifficultyLevel) => boolean;

  /** v1.6.0 Stage 1: 检查全部等级 (A1-B2, 难度1-4) 是否都 100% mastered (课程毕业条件). */
  checkCourseCompletion: (language: Language) => boolean;

  /** 获取单个词的状态 */
  getWordStatus: (language: Language, lemma: string) => WordStatus;

  // === 异步查询 (需加载词表) ===

  /** 加载词表并返回总词数 */
  getLevelTotal: (language: Language, difficulty: DifficultyLevel) => Promise<number>;

  /** 加载词表并返回未学词列表 */
  getUnlearnedWords: (language: Language, difficulty: DifficultyLevel, limit: number) => Promise<string[]>;

  /** 加载词表并返回学习中词列表 */
  getLearningWords: (language: Language, difficulty: DifficultyLevel, limit: number) => Promise<string[]>;

  // === 状态更新 ===

  /** 从 MemoryCard 集合同步 progress (单向, 不反向写 MemoryStore). 保留 encounterCount 等追踪字段. */
  syncFromMemoryCards: (cards: Map<string, MemoryCard>) => void;

  /** 标记词为 learning (LLM 生成 passage 覆盖了此词时调用) */
  markWordLearning: (language: Language, lemma: string) => void;

  /** 标记词为 mastered (FSRS 卡片达到 review && reps>=2 时由 syncFromMemoryCards 自动派生) */
  markWordMastered: (language: Language, lemma: string) => void;

  /** v2: 记录一次语境相遇 (用户在 InlineAnswerPanel 答对 token 时调用). 按 passageId 去重. */
  recordEncounter: (language: Language, lemma: string, passageId: string) => void;

  /** v1.6.0 Stage 3.5-6: 记录一次复习 (rateCard 时调用), reviewsDone++ */
  recordReview: () => void;

  /** v1.6.0 Stage 3.5-6: 跨日重置 dailyGoal (日期变更时清零 done 计数) */
  resetDailyGoalIfNewDay: (today?: string) => void;

  /** v1.6.0 Stage 3.6-C: 设置今日复习目标 (由 App.tsx 从 dueCards.length 计算) */
  setReviewsTarget: (count: number) => void;

  // === 设置 ===

  /** 切换闯关/自由模式 */
  setLinearMode: (linear: boolean) => void;

  /** 重置所有进度 (测试/调试用) */
  resetAll: () => void;
}

/**
 * v2.0.0 Stage 2: deriveStatus / makeProgress 已迁移至 domain/wordlistDomain (canonical source).
 * syncFromMemoryCards 方法体内联调用 domain 层 syncFromMemoryCards 纯函数.
 */

export const useWordlistStore = create<WordlistStore>()(
  persist(
    (set, get) => ({
      progress: {},
      linearMode: true,
      schemaVersion: 4,
      dailyGoal: makeFreshDailyGoal(getTodayString()),

      // === 同步派生查询 ===

      getLevelTotalSync: (language, difficulty) => {
        const wordlist = getCachedWordlist(language, difficulty);
        return wordlist?.words.length ?? 0;
      },

      getMasteredCount: (language, difficulty) => {
        const wordlist = getCachedWordlist(language, difficulty);
        if (!wordlist) return 0;
        let count = 0;
        for (const entry of wordlist.words) {
          const key = `${language}:${entry.lemma.toLowerCase()}`;
          if (get().progress[key]?.status === 'mastered') count++;
        }
        return count;
      },

      getLearnedCount: (language, difficulty) => {
        const wordlist = getCachedWordlist(language, difficulty);
        if (!wordlist) return 0;
        let count = 0;
        for (const entry of wordlist.words) {
          const key = `${language}:${entry.lemma.toLowerCase()}`;
          const status = get().progress[key]?.status;
          if (status === 'learning' || status === 'mastered') count++;
        }
        return count;
      },

      getUnlearnedWordsSync: (language, difficulty, limit) => {
        const wordlist = getCachedWordlist(language, difficulty);
        if (!wordlist) return [];
        // v1.6.0 Stage 3.5-3: 筛未学词后按 priority 升序 + topic 聚簇排序.
        // priority 默认 2, topic 默认空串 — 旧词表无此字段时保持原顺序.
        const unlearned = wordlist.words.filter((w) => {
          const key = `${language}:${w.lemma.toLowerCase()}`;
          const st = get().progress[key]?.status;
          return st !== 'mastered' && st !== 'learning';
        });
        unlearned.sort((a, b) => {
          const pa = a.priority ?? 2;
          const pb = b.priority ?? 2;
          if (pa !== pb) return pa - pb;
          const ta = a.topic ?? '';
          const tb = b.topic ?? '';
          return ta.localeCompare(tb);
        });
        // v1.6.1 Stage 2: 语义混淆避让 — 排除当前 learning 词的 semanticConflicts.
        // 仅在词表条目带 semanticConflicts 时生效; v1 词表无此字段时 conflictSet 为空, 行为不变.
        const learningWords = get().getLearningWordsSync(language, difficulty, 999);
        if (learningWords.length > 0) {
          const conflictSet = new Set<string>();
          for (const learningLemma of learningWords) {
            const entry = wordlist.words.find((w) => w.lemma.toLowerCase() === learningLemma.toLowerCase());
            if (entry?.semanticConflicts) {
              for (const conflict of entry.semanticConflicts) {
                conflictSet.add(conflict.toLowerCase());
              }
            }
          }
          if (conflictSet.size > 0) {
            const filtered = unlearned.filter((w) => !conflictSet.has(w.lemma.toLowerCase()));
            return filtered.slice(0, limit).map((w) => w.lemma);
          }
        }
        return unlearned.slice(0, limit).map((w) => w.lemma);
      },

      getLearningWordsSync: (language, difficulty, limit) => {
        const wordlist = getCachedWordlist(language, difficulty);
        if (!wordlist) return [];
        const result: string[] = [];
        for (const entry of wordlist.words) {
          const key = `${language}:${entry.lemma.toLowerCase()}`;
          if (get().progress[key]?.status === 'learning') {
            result.push(entry.lemma);
            if (result.length >= limit) break;
          }
        }
        return result;
      },

      isLevelUnlocked: (language, difficulty) => {
        if (!get().linearMode) return true;  // 自由模式全解锁
        if (difficulty <= 1) return true;    // A1 默认解锁
        // 上一级 ≥80% mastered
        const prevDifficulty = (difficulty - 1) as DifficultyLevel;
        const total = get().getLevelTotalSync(language, prevDifficulty);
        if (total === 0) return true;  // 上一级词表未加载, 容错放行
        const mastered = get().getMasteredCount(language, prevDifficulty);
        return mastered / total >= UNLOCK_THRESHOLD;
      },

      // v1.6.0 Stage 1: 毕业判定 — 当前等级 100% mastered
      checkLevelCompletion: (language, difficulty) => {
        // C1 (难度5) 无词表, 不触发毕业
        if (difficulty === 5) return false;
        const total = get().getLevelTotalSync(language, difficulty);
        // 词表未加载 → false (避免误触发)
        if (total === 0) return false;
        const mastered = get().getMasteredCount(language, difficulty);
        return mastered === total;
      },

      // v1.6.0 Stage 1: 课程毕业判定 — A1-B2 (难度1-4) 全部 100% mastered
      checkCourseCompletion: (language) => {
        for (let d = 1; d <= 4; d++) {
          if (!get().checkLevelCompletion(language, d as DifficultyLevel)) {
            return false;
          }
        }
        return true;
      },

      getWordStatus: (language, lemma) => {
        const key = `${language}:${lemma.toLowerCase()}`;
        return get().progress[key]?.status ?? 'unseen';
      },

      // === 异步查询 ===

      getLevelTotal: async (language, difficulty) => {
        const wordlist = await loadWordlist(language, difficulty);
        return wordlist?.words.length ?? 0;
      },

      getUnlearnedWords: async (language, difficulty, limit) => {
        await loadWordlist(language, difficulty);
        return get().getUnlearnedWordsSync(language, difficulty, limit);
      },

      getLearningWords: async (language, difficulty, limit) => {
        await loadWordlist(language, difficulty);
        return get().getLearningWordsSync(language, difficulty, limit);
      },

      // === 状态更新 ===

      syncFromMemoryCards: (cards) => {
        set((state) => {
          const newProgress = syncFromMemoryCardsDomain(cards, state.progress);
          return { progress: newProgress };
        });
      },

      markWordLearning: (language, lemma) => {
        const key = `${language}:${lemma.toLowerCase()}`;
        const current = get().progress[key];
        // 不降级: 已 mastered 的词不回退到 learning
        if (current?.status === 'mastered') return;
        // v1.6.0 Stage 3.5-6: 只在 unseen → learning 时计 newWordsDone
        const wasUnseen = !current || current.status === 'unseen';
        const today = getTodayString();
        const goal = get().dailyGoal.date === today
          ? get().dailyGoal
          : makeFreshDailyGoal(today);
        set((state) => ({
          progress: {
            ...state.progress,
            [key]: makeProgress('learning', current),
          },
          dailyGoal: wasUnseen
            ? { ...goal, newWordsDone: goal.newWordsDone + 1 }
            : goal,
        }));
      },

      markWordMastered: (language, lemma) => {
        const key = `${language}:${lemma.toLowerCase()}`;
        const current = get().progress[key];
        set((state) => ({
          progress: {
            ...state.progress,
            [key]: makeProgress('mastered', current),
          },
        }));
      },

      recordEncounter: (language, lemma, passageId) => {
        const key = `${language}:${lemma.toLowerCase()}`;
        const current = get().progress[key];
        // 词表外词不追踪 (progress 中无记录则跳过)
        if (!current) return;
        // 按 passageId 去重: 同一篇内重复答对只算一次
        if (current.lastEncounterPassageId === passageId) return;
        const now = Date.now();
        set((state) => ({
          progress: {
            ...state.progress,
            [key]: {
              ...current,
              encounterCount: current.encounterCount + 1,
              lastEncounterPassageId: passageId,
              firstEncounteredAt: current.firstEncounteredAt || now,
              lastEncounteredAt: now,
            },
          },
        }));
      },

      recordReview: () => {
        // v1.6.0 Stage 3.5-6: 记录一次复习, reviewsDone++. 跨日自动重置.
        const today = getTodayString();
        const goal = get().dailyGoal.date === today
          ? get().dailyGoal
          : makeFreshDailyGoal(today);
        set({ dailyGoal: { ...goal, reviewsDone: goal.reviewsDone + 1 } });
      },

      resetDailyGoalIfNewDay: (today) => {
        const t = today ?? getTodayString();
        if (get().dailyGoal.date !== t) {
          set({ dailyGoal: makeFreshDailyGoal(t) });
        }
      },

      setReviewsTarget: (count) => {
        const today = getTodayString();
        const goal = get().dailyGoal.date === today
          ? get().dailyGoal
          : makeFreshDailyGoal(today, count);
        set({ dailyGoal: { ...goal, reviewsTarget: count } });
      },

      // === 设置 ===

      setLinearMode: (linear) => set({ linearMode: linear }),

      resetAll: () => set({
        progress: {},
        linearMode: true,
        dailyGoal: makeFreshDailyGoal(getTodayString()),
      }),
    }),
    {
      name: 'wordaydream:wordlist',
      version: 4,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        progress: state.progress,
        linearMode: state.linearMode,
        schemaVersion: state.schemaVersion,
        dailyGoal: state.dailyGoal,
      }),
      migrate: (persistedState, fromVersion) => {
        const base = (persistedState ?? {}) as Record<string, unknown>;
        // v1 → v2: progress 从 Record<string, WordStatus>(字符串) 升级为 Record<string, WordProgress>
        if (fromVersion < 2) {
          const oldProgress = (base.progress ?? {}) as Record<string, unknown>;
          const newProgress: Record<string, WordProgress> = {};
          for (const [key, value] of Object.entries(oldProgress)) {
            if (typeof value === 'string') {
              // 旧格式: 字符串 WordStatus
              newProgress[key] = {
                status: value as WordStatus,
                encounterCount: 0,
                lastEncounterPassageId: null,
                firstEncounteredAt: 0,
                lastEncounteredAt: 0,
              };
            } else if (value && typeof value === 'object') {
              // 已是对象格式 (防重复 migrate), 保留
              newProgress[key] = value as WordProgress;
            }
          }
          base.progress = newProgress;
        }
        // v2 → v3: 新增 dailyGoal 字段 (v1.6.0 Stage 3.5-6)
        if (fromVersion < 3) {
          const d = new Date();
          const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          base.dailyGoal = {
            date: today,
            newWordsTarget: 10,
            newWordsDone: 0,
            reviewsDone: 0,
          };
        }
        // v3 → v4: dailyGoal 新增 reviewsTarget 字段 (v1.6.0 Stage 3.6-C)
        // 旧 dailyGoal 无 reviewsTarget 时补 0, 由 App.tsx 随后调 setReviewsTarget 更新
        if (fromVersion < 4) {
          const dg = (base.dailyGoal ?? {}) as Record<string, unknown>;
          base.dailyGoal = {
            ...dg,
            reviewsTarget: (dg.reviewsTarget as number | undefined) ?? 0,
          };
        }
        base.schemaVersion = 4;
        return base as Partial<WordlistStore>;
      },
    }
  )
);

// v2.0.0 Stage 2: 订阅 memory:cards-updated 事件 (替代动态 import, 消除循环依赖).
// useMemoryStore.addCardFromToken / rateCard 发布事件, 此处同步消费.
subscribe<MemoryCardsUpdatedPayload>('memory:cards-updated', (payload) => {
  const { cards, isReview } = payload;
  useWordlistStore.getState().syncFromMemoryCards(cards);
  if (isReview) useWordlistStore.getState().recordReview();
});
