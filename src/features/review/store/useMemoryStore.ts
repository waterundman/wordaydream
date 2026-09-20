import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { MemoryCard, TokenOccurrence, Rating, Language, DifficultyLevel } from '../../../types';
import { createInitialMemoryCard, scheduleNextReview, scheduleNextReviewBatch } from '../services/schedulerAdapter';
import { publish } from '../../../domain/events';
import type { MemoryCardsUpdatedPayload } from '../../../domain/events';
import type { MemoryCardRecordBridge } from '../../../platform/harmonyBridge';

let resolveNativeMemoryRestore: (() => void) | null = null;
let nativeMemoryRestoreSettled: boolean = false;
const nativeMemoryRestoreReady: Promise<void> = new Promise((resolve) => {
  resolveNativeMemoryRestore = resolve;
});

/**
 * v1.6.0 D1: 原生卡片推送接收器 (R-1 恢复的实机通道).
 *
 * API 22 模拟器实测: async JSProxy 返回值无论数组还是 JSON string, Web 端
 * Promise 一律 resolve 成 number (回执路由失效, refresh() 亦无效) — 拉取
 * (web -> native getAllCards) 通道在该环境不可用. 而 runJavaScript 派发
 * (native -> web) 已实证可靠 (FIFO openCard 链), 故恢复数据改由原生在
 * content-ready 后主动推送, 落到本处理器.
 *
 * 语义与拉取路径一致: 仅 store 为空时应用 (不覆盖用户数据), 卡片按
 * lexemeGroupId 入 Map. 纯 Web 环境 (无原生) 下该 handler 永不被调用, 零影响.
 */
function installNativeCardRestorePush(): void {
  if (typeof window === 'undefined') {
    return;
  }
  const target = window as unknown as {
    __applyNativeCardRestore?: (json: string) => void;
  };
  target.__applyNativeCardRestore = (json: string): void => {
    try {
      if (useMemoryStore.getState().cards.size > 0) {
        console.log('[memory-restore] push skipped: store non-empty');
        return;
      }
      const cards = parseBridgeRecords(json);
      const newCards = new Map<string, MemoryCard>();
      for (const bridgeCard of cards) {
        const memoryCard = bridgeToMemoryCard(bridgeCard);
        if (memoryCard) {
          newCards.set(memoryCard.lexemeGroupId, memoryCard);
        }
      }
      console.log(
        `[memory-restore] push rawLen=${json.length} applied=${newCards.size}`,
      );
      if (newCards.size > 0) {
        useMemoryStore.setState({ cards: newCards });
        publish<MemoryCardsUpdatedPayload>('memory:cards-updated', {
          cards: newCards,
          isReview: false,
        });
      }
    } catch (e) {
      console.log(
        `[memory-restore] push failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };
}
installNativeCardRestorePush();

/**
 * Resolves after persisted Web state is hydrated and any required Harmony RDB
 * restore attempt has settled. Launch actions use this to avoid racing an empty
 * localStorage snapshot against the native card mirror.
 */
export function waitForNativeMemoryRestore(): Promise<void> {
  return nativeMemoryRestoreReady;
}

function markNativeMemoryRestoreSettled(): void {
  if (nativeMemoryRestoreSettled) {
    return;
  }
  nativeMemoryRestoreSettled = true;
  resolveNativeMemoryRestore?.();
  resolveNativeMemoryRestore = null;
}
/**
 * v0.2.0-harmony Stage 3: Web MemoryCard → 鸿蒙 MemoryCardRecordBridge 转换.
 *
 * 字段差异:
 * - MemoryCard.objectiveDifficulty: DifficultyLevel (1|2|3|4|5) → number
 * - MemoryCard.language?: Language ('en'|'de') | undefined → string ('en'|'de'|'')
 *
 * 16 字段全为 JSON 安全类型 (string/number), JSBridge 序列化无丢失.
 */
function memoryCardToBridge(card: MemoryCard): MemoryCardRecordBridge {
  return {
    id: card.id,
    lexemeGroupId: card.lexemeGroupId,
    lemma: card.lemma,
    objectiveDifficulty: card.objectiveDifficulty,
    language: card.language ?? '',
    firstLearnedAt: card.firstLearnedAt,
    lastReviewAt: card.lastReviewAt,
    due: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsedDays,
    scheduledDays: card.scheduledDays,
    reps: card.reps,
    lapses: card.lapses,
    status: card.status,
    learningSteps: card.learningSteps,
  };
}

/**
 * v1.6.0 D1: ArkWeb async JSProxy 返回值归一 (纯函数).
 *
 * 实机 (API 22 模拟器) 发现复杂返回值可能以 JSON string 形态到达 Web
 * (native `getAllCards done: count=5`, Web 端按数组消费得到 0 条).
 * 统一兼容数组直传与 JSON string 两种形态; 解析失败返回空数组
 * (走"首次安装静默跳过"分支, 与空 RDB 语义一致).
 */
function parseBridgeRecords(raw: unknown): MemoryCardRecordBridge[] {
  if (Array.isArray(raw)) {
    return raw as MemoryCardRecordBridge[];
  }
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as MemoryCardRecordBridge[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * v0.2.0-harmony Stage 3: 鸿蒙 MemoryCardRecordBridge → Web MemoryCard 反向转换.
 *
 * 用于 onRehydrateStorage 从鸿蒙 relationalStore 恢复卡片.
 * language '' → undefined (Web 端 language?: Language 语义).
 * status 强制转为联合类型 (TS 编译期检查), 运行期值由 ArkTS 端保证合法.
 */
function bridgeToMemoryCard(bridge: MemoryCardRecordBridge): MemoryCard | null {
  // 客观难度边界校验 (DifficultyLevel 1-5)
  if (
    !Number.isInteger(bridge.objectiveDifficulty) ||
    bridge.objectiveDifficulty < 1 ||
    bridge.objectiveDifficulty > 5
  ) {
    return null;
  }
  // status 合法性校验
  if (
    bridge.status !== 'new' &&
    bridge.status !== 'learning' &&
    bridge.status !== 'review' &&
    bridge.status !== 'relearning'
  ) {
    return null;
  }
  // language 合法性校验 ('en' | 'de' | '')
  if (bridge.language !== 'en' && bridge.language !== 'de' && bridge.language !== '') {
    return null;
  }
  return {
    id: bridge.id,
    lexemeGroupId: bridge.lexemeGroupId,
    lemma: bridge.lemma,
    objectiveDifficulty: bridge.objectiveDifficulty as DifficultyLevel,
    language: bridge.language === '' ? undefined : bridge.language,
    firstLearnedAt: bridge.firstLearnedAt,
    lastReviewAt: bridge.lastReviewAt,
    due: bridge.due,
    stability: bridge.stability,
    difficulty: bridge.difficulty,
    elapsedDays: bridge.elapsedDays,
    scheduledDays: bridge.scheduledDays,
    reps: bridge.reps,
    lapses: bridge.lapses,
    status: bridge.status,
    learningSteps: bridge.learningSteps,
  };
}

interface MemoryStore {
  cards: Map<string, MemoryCard>;
  newlyAdded: string[];
  ratingHistory: Array<{ cardId: string; rating: Rating; at: number }>;
  schemaVersion: number;
  /**
           * v0.4.0-harmony Stage 1 D1: 派生索引 — 存储当前 due 卡片的 lexemeGroupId 集合.
           *
           * 设计:
           * - null: 索引未初始化 (首次加载 / setState 直接写入 cards 后未触发增量更新 /
           *   addCardFromToken 添加非 due 卡 / resetAll 清空). getDueCards 此时 fallback
           *   到全量扫描 (O(n), 向后兼容测试用例).
           * - Set<string> (可能为空): 索引已初始化, getDueCards 用它做 O(1) 候选过滤.
           *   仅在 onRehydrateStorage (cards.size > 0) 时创建.
           *
           * 增量更新时机:
           * - addCardFromToken: 仅当索引已存在 (非 null) 时才增量更新; null 保持 null.
           * - rateCard (recordRating): 同上, 仅当索引已存在时才更新.
           * - deleteCard: 从索引中移除.
           * - onRehydrateStorage: 遍历 cards 一次重建索引 (仅 cards.size > 0 时).
           * - resetAll: 重置为 null.
           *
           * 关键: 派生索引不持久化 (partialize 排除), 每次 rehydrate 后重建.
           */
  dueCardsIndex: Set<string> | null;
  /**
   * v0.4.0-harmony Stage 2 D2: 派生索引 — 存储语言 → 卡片 ID 集合映射.
   *
   * 设计 (与 dueCardsIndex 协同):
   * - null: 索引未初始化 (首次加载 / setState 直接写入 cards 后未触发增量更新 /
   *   resetAll 清空). getCardsByLanguage 此时 fallback 到全量扫描 (O(n), 向后兼容).
   * - Map<Language, Set<string>> (可能为空 Map): 索引已初始化, getCardsByLanguage 用它做
   *   O(1) 候选 ID 查询 (再用 cards.get(id) 取卡片). 仅在 onRehydrateStorage (cards.size > 0)
   *   时创建.
   *
   * 增量更新时机 (与 dueCardsIndex 同步维护):
   * - addCardFromToken: 仅当索引已存在 (非 null) 且 card.language 有值时才增量更新; null 保持 null.
   * - rateCard (recordRating): 同步维护 — rateCard 不改变 language (scheduleNextReview 保留原 language),
   *   但防御性处理: 如果新卡 language 与旧卡不同 (未来扩展场景), 从旧 language set 移除, 加到新 language set.
   * - deleteCard: 从对应 language set 移除 (需先查卡片获取 language).
   * - onRehydrateStorage: 遍历 cards 一次重建索引 (与 dueCardsIndex 同步, 仅 cards.size > 0 时).
   * - resetAll: 重置为 null.
   *
   * 关键: 派生索引不持久化 (partialize 排除), 每次 rehydrate 后重建.
   */
  cardsByLanguageIndex: Map<Language, Set<string>> | null;

  addCardFromToken: (token: TokenOccurrence, language?: Language) => MemoryCard;
  getCardByLexemeGroup: (groupId: string) => MemoryCard | undefined;
  getCardByLemma: (lemma: string, language?: Language) => MemoryCard | undefined;
  getCardCount: () => number;
  getNewlyAdded: () => MemoryCard[];
  rateCard: (cardId: string, rating: Rating) => void;
  // v0.2.0-harmony Stage 3: 删除卡片 (Web → 鸿蒙 relationalStore 镜像)
  deleteCard: (cardId: string) => void;
  // v1.5.3 fix V4-P3-008: 返回类型改为 nullable, 调用方需处理 null.
  getRatingPreviews: (cardId: string) => Record<Rating, { card: MemoryCard; nextReviewAt: number }> | null;
  clearNewlyAdded: () => void;
  // v2.2.2 Stage 2 (Bug 7): states 可选参数, 让调用方按语义取卡 (向后兼容, 不传时返回全部 due 卡)
  getDueCards: (language?: Language, now?: number, states?: MemoryCard['status'][]) => MemoryCard[];
  /**
   * v0.4.0-harmony Stage 2 D2: 按语言查询所有卡片 (用 cardsByLanguageIndex O(1) 候选过滤).
   *
   * - 索引已初始化 (非 null): 用 cardsByLanguageIndex.get(language) 获取候选 ID 集合,
   *   再用 cards.get(id) 取卡片. O(1) 候选查询 + O(k) 取卡 (k = 该语言的卡片数).
   * - 索引未初始化 (null): fallback 到全量扫描 cards.values() 过滤 language.
   *   向后兼容测试用例 setState({ cards: map }) 直接写入 cards (未触发 onRehydrateStorage).
   *
   * 注: getDueCards(language) 已有 dueCardsIndex + language 过滤的快速路径,
   *   本方法提供独立的"按语言查所有卡片"语义 (不限定 due 状态).
   */
  getCardsByLanguage: (language: Language) => MemoryCard[];
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
      // v0.4.0-harmony Stage 1 D1: 初始为 null, onRehydrateStorage 重建为 Set.
      dueCardsIndex: null,
      // v0.4.0-harmony Stage 2 D2: 初始为 null, onRehydrateStorage 重建为 Map.
      cardsByLanguageIndex: null,

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

        // v0.4.0-harmony Stage 1 D1: 增量更新 dueCardsIndex.
        // 新卡 due = now + 4h (非 due), 不加入索引.
        // 关键: 如果索引还未初始化 (null), 不创建空 Set — 保持 null 让 getDueCards fallback
        // 到全量扫描 (向后兼容测试用例 setState({ cards: map }) 直接写入 cards).
        const prevIndex = get().dueCardsIndex;
        const nextIndex = prevIndex === null ? null : new Set(prevIndex);
        if (nextIndex !== null && card.due <= Date.now()) {
          nextIndex.add(token.lexemeGroupId);
        }

        // v0.4.0-harmony Stage 2 D2: 增量更新 cardsByLanguageIndex (与 dueCardsIndex 同步维护).
        // 仅当索引已存在 (非 null) 且 card.language 有值时才增量更新; null 保持 null
        // (向后兼容测试用例 setState 直接写入 cards).
        const prevLangIndex = get().cardsByLanguageIndex;
        const nextLangIndex = prevLangIndex === null ? null : new Map(prevLangIndex);
        if (nextLangIndex !== null && card.language) {
          const set = nextLangIndex.get(card.language) ?? new Set<string>();
          set.add(token.lexemeGroupId);
          nextLangIndex.set(card.language, set);
        }

        set({
          cards: newCards,
          newlyAdded: [...get().newlyAdded, token.lexemeGroupId],
          dueCardsIndex: nextIndex,
          cardsByLanguageIndex: nextLangIndex,
        });

        // v2.0.0 Stage 2: 同步 wordlist 进度 (addCardFromToken 不是复习, isReview=false)
        publish<MemoryCardsUpdatedPayload>('memory:cards-updated', { cards: newCards, isReview: false });

        // v0.2.0 Stage 3: Web → 鸿蒙 relationalStore 镜像 (fire-and-forget, 不阻塞主流程)
        try {
          void window.harmonyBridge
            ?.upsertCard(memoryCardToBridge(card))
            ?.catch?.(() => {
              // silent skip — JSBridge 异步失败不传播到 Web
            });
        } catch {
          // silent skip — Web 端无 harmonyBridge 或同步抛错
        }

        return card;
      },

      getCardByLexemeGroup: (groupId: string) => {
        return get().cards.get(groupId);
      },

      getCardByLemma: (lemma: string, language?: Language) => {
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

        // v0.4.0-harmony Stage 1 D1: 增量更新 dueCardsIndex.
        // 评分后卡片 due 变化: 如果新 due <= now (due), 加入索引; 否则移除.
        // 关键: 如果索引还未初始化 (null), 不创建空 Set — 保持 null 让 getDueCards fallback
        // 到全量扫描 (向后兼容测试用例 setState({ cards: map }) 直接写入 cards).
        const prevIndex = get().dueCardsIndex;
        const nextIndex = prevIndex === null ? null : new Set(prevIndex);
        const now = Date.now();
        if (nextIndex !== null) {
          if (result.card.due <= now) {
            nextIndex.add(cardId);
          } else {
            nextIndex.delete(cardId);
          }
        }

        // v0.4.0-harmony Stage 2 D2: 增量更新 cardsByLanguageIndex (与 dueCardsIndex 同步维护).
        // rateCard 不改变 language (scheduleNextReview 保留原 language), 但防御性处理:
        // 如果新卡 language 与旧卡不同 (未来扩展场景), 从旧 language set 移除, 加到新 language set.
        const prevLangIndex = get().cardsByLanguageIndex;
        const nextLangIndex = prevLangIndex === null ? null : new Map(prevLangIndex);
        if (nextLangIndex !== null && card.language !== result.card.language) {
          // language 变化: 从旧 language set 移除
          if (card.language) {
            nextLangIndex.get(card.language)?.delete(cardId);
          }
          // 加到新 language set
          if (result.card.language) {
            const set = nextLangIndex.get(result.card.language) ?? new Set<string>();
            set.add(cardId);
            nextLangIndex.set(result.card.language, set);
          }
        }

        set({
          cards: newCards,
          ratingHistory: [
            ...get().ratingHistory,
            { cardId, rating, at: now },
          ].slice(-200),
          dueCardsIndex: nextIndex,
          cardsByLanguageIndex: nextLangIndex,
        });

        // v2.0.0 Stage 2: 同步 wordlist 进度 + 记录复习 (v1.6.0 Stage 3.5-6 dailyGoal)
        publish<MemoryCardsUpdatedPayload>('memory:cards-updated', { cards: newCards, isReview: true });

        // v0.1.0-harmony Stage 3: 通知鸿蒙原生侧注册本地提醒 (fire-and-forget).
        // Web 端 window.harmonyBridge === undefined 时静默跳过 (optional chaining);
        // ArkTS 侧 registerReminder 异常由 .catch 兜底, 不阻塞 rateCard 主流程.
        try {
          void window.harmonyBridge
            ?.registerReminder({ dueAt: result.card.due, cardId })
            ?.catch(() => {
              // silent skip — JSBridge 异步失败 (网络/权限/序列化), 不传播到 Web
            });
        } catch {
          // silent skip — Web 端无 harmonyBridge 或 JSBridge 同步抛错
        }

        // v0.2.0 Stage 3: Web → 鸿蒙 relationalStore 镜像 (fire-and-forget, 不阻塞主流程)
        try {
          void window.harmonyBridge
            ?.upsertCard(memoryCardToBridge(result.card))
            ?.catch?.(() => {
              // silent skip — JSBridge 异步失败不传播到 Web
            });
        } catch {
          // silent skip — Web 端无 harmonyBridge 或同步抛错
        }
      },

      deleteCard: (lexemeGroupId: string) => {
        const next = new Map(get().cards);
        next.delete(lexemeGroupId);
        // v0.4.0-harmony Stage 1 D1: 增量更新 dueCardsIndex — 从索引中移除.
        const prevIndex = get().dueCardsIndex;
        const nextIndex = prevIndex === null ? null : new Set(prevIndex);
        nextIndex?.delete(lexemeGroupId);
        // v0.4.0-harmony Stage 2 D2: 增量更新 cardsByLanguageIndex — 从对应 language set 移除.
        // 需先查卡片获取 language (删之前从旧 cards 取, next 上已无该卡).
        const prevCard = get().cards.get(lexemeGroupId);
        const prevLangIndex = get().cardsByLanguageIndex;
        const nextLangIndex = prevLangIndex === null ? null : new Map(prevLangIndex);
        if (nextLangIndex !== null && prevCard?.language) {
          nextLangIndex.get(prevCard.language)?.delete(lexemeGroupId);
        }
        set({ cards: next, dueCardsIndex: nextIndex, cardsByLanguageIndex: nextLangIndex });

        // v0.2.0 Stage 3: Web → 鸿蒙 relationalStore 镜像 (fire-and-forget)
        try {
          void window.harmonyBridge
            ?.deleteCard(lexemeGroupId)
            ?.catch?.(() => {
              // silent skip — JSBridge 异步失败不传播到 Web
            });
        } catch {
          // silent skip — Web 端无 harmonyBridge 或同步抛错
        }

        publish<MemoryCardsUpdatedPayload>('memory:cards-updated', {
          cards: next,
          isReview: false,
        });
      },

      getRatingPreviews: (cardId: string) => {
        const card = get().cards.get(cardId);
        // v1.5.3 fix V4-P3-008: 卡片不存在时返回 null, 不再用 {} as MemoryCard.
        if (!card) return null;
        // v0.4.0-harmony Stage 1 D1: 批处理优化 — 调用 scheduleNextReviewBatch 1 次,
        // 内部只调用 f.repeat() 1 次, 复用 4 个 rating 的结果.
        // 优化前: 调用 scheduleNextReview 4 次 = f.repeat() 4 次 (冗余 FSRS 计算).
        return scheduleNextReviewBatch(card);
      },

      clearNewlyAdded: () => set({ newlyAdded: [] }),

      // v2.2.2 Stage 2 (Bug 7): 增加 states 可选参数, 让调用方按语义取卡
      // (不传 states 时行为不变, 向后兼容)
      // v0.4.0-harmony Stage 1 D1: 优化 — 先按 dueCardsIndex 过滤候选 (O(1) 查询),
      // 再按 language/states 过滤. 索引未初始化 (null) 时 fallback 到全量扫描.
      getDueCards: (language, now = Date.now(), states?: MemoryCard['status'][]) => {
        const { cards, dueCardsIndex } = get();
        const result: MemoryCard[] = [];

        // v0.4.0-harmony Stage 1 D1: 索引未初始化 (null) 时 fallback 到全量扫描.
        // 这发生在: ① 首次加载未触发 onRehydrateStorage 前; ② 测试用 setState 直接写入 cards.
        // 生产环境 onRehydrateStorage 后索引一定非 null, 走快速路径.
        const candidateIds: Iterable<string> = dueCardsIndex ?? cards.keys();

        for (const cardId of candidateIds) {
          const card = cards.get(cardId);
          if (!card) continue; // 索引可能过期 (卡片已被删除)
          if (card.due > now) continue;
          if (states && !states.includes(card.status)) continue;
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

      // v0.4.0-harmony Stage 2 D2: 按语言查所有卡片 (用 cardsByLanguageIndex O(1) 候选过滤).
      // 索引未初始化 (null) 时 fallback 到全量扫描 (向后兼容测试用例 setState).
      getCardsByLanguage: (language: Language) => {
        const { cards, cardsByLanguageIndex } = get();
        // 索引未初始化 (null) 时 fallback 到全量扫描 cards.values() 过滤 language.
        // 这发生在: ① 首次加载未触发 onRehydrateStorage 前; ② 测试用 setState 直接写入 cards.
        // 生产环境 onRehydrateStorage 后索引一定非 null, 走快速路径.
        if (cardsByLanguageIndex === null) {
          const result: MemoryCard[] = [];
          for (const card of cards.values()) {
            if (card.language === language) {
              result.push(card);
            }
          }
          return result;
        }
        // O(1) 查询: 用索引获取候选 ID, 再用 cards.get(id) 取卡片
        const ids = cardsByLanguageIndex.get(language);
        if (!ids) return [];
        const result: MemoryCard[] = [];
        for (const id of ids) {
          const card = cards.get(id);
          if (card) result.push(card); // 索引可能过期 (卡片已被删除)
        }
        return result;
      },

      resetAll: () => {
        // v0.2.0 Stage 3: resetAll 罕见且不阻塞, harmonyBridge 没有 clear 方法,
        // 遍历 state.cards.keys() 逐个 deleteCard (fire-and-forget, 不阻塞主流程)
        const existingLexemeGroupIds: string[] = Array.from(get().cards.keys());
        set({
          cards: new Map(),
          newlyAdded: [],
          ratingHistory: [],
          // v0.4.0-harmony Stage 1 D1: 重置 dueCardsIndex 为 null (空状态, 未初始化).
          // 让后续 getDueCards fallback 到全量扫描 (向后兼容测试用例 setState).
          dueCardsIndex: null,
          // v0.4.0-harmony Stage 2 D2: 重置 cardsByLanguageIndex 为 null (与 dueCardsIndex 一致).
          cardsByLanguageIndex: null,
        });
        for (const lexemeGroupId of existingLexemeGroupIds) {
          try {
            void window.harmonyBridge
              ?.deleteCard(lexemeGroupId)
              ?.catch?.(() => {
                // silent skip — JSBridge 异步失败不传播到 Web
              });
          } catch {
            // silent skip — Web 端无 harmonyBridge 或同步抛错
          }
        }
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
        if (!state) {
          markNativeMemoryRestoreSettled();
          return;
        }
        if (state.cards && !(state.cards instanceof Map)) {
          state.cards = new Map(Object.entries(state.cards));
        }
        // v0.4.0-harmony Stage 1 D1: 重建 dueCardsIndex 派生索引.
        // 遍历 cards 一次, 把 due <= now 的 lexemeGroupId 加入 Set.
        // 重建后 getDueCards 走快速路径 (O(1) 候选过滤), 不再全量扫描.
        //
        // 关键: 仅当 cards.size > 0 时才重建索引. 若 cards 为空 (首次安装 /
        // localStorage 清空), 保持 dueCardsIndex = null, 让 getDueCards fallback
        // 到全量扫描 (向后兼容测试用例 setState({ cards: map }) 直接写入 cards).
        if (state.cards instanceof Map && state.cards.size > 0) {
          const now = Date.now();
          const index = new Set<string>();
          // v0.4.0-harmony Stage 2 D2: 同步重建 cardsByLanguageIndex (与 dueCardsIndex 协同).
          // 遍历 cards 一次填充两个索引, 避免两次遍历.
          const langIndex = new Map<Language, Set<string>>();
          for (const [cardId, card] of state.cards) {
            if (card.due <= now) {
              index.add(cardId);
            }
            if (card.language) {
              const set = langIndex.get(card.language) ?? new Set<string>();
              set.add(cardId);
              langIndex.set(card.language, set);
            }
          }
          state.dueCardsIndex = index;
          state.cardsByLanguageIndex = langIndex;
        }
        // v0.2.0-harmony Stage 3: R-1 闭环 — 鸿蒙 → Web 卡片恢复
        // 仅在 localStorage 为空 (cards.size === 0) 且 harmonyBridge 存在时调用 getAllCards.
        // 已有数据 (state.cards.size > 0) 不调用, 避免覆盖用户最近写入.
        // getAllCards 返回空数组时静默跳过 (首次安装场景).
        if (
          state.cards instanceof Map &&
          state.cards.size === 0 &&
          typeof window !== 'undefined' &&
          window.harmonyBridge
        ) {
          const bridge = window.harmonyBridge;
          void Promise.resolve()
            .then(() => bridge.getAllCards())
            .then((raw: unknown) => {
              const cards = parseBridgeRecords(raw);
              const rawLen = Array.isArray(raw)
                ? raw.length
                : typeof raw === 'string'
                  ? raw.length
                  : -1;
              const newCards = new Map<string, MemoryCard>();
              for (const bridgeCard of cards) {
                const memoryCard = bridgeToMemoryCard(bridgeCard);
                if (memoryCard) {
                  newCards.set(memoryCard.lexemeGroupId, memoryCard);
                }
              }
              // v1.6.0 D1 运行验证日志点: 归一化前后形态一次说清,
              // 防止恢复断链再次被静默吞掉 (rawLen=-1 = 意外形态).
              console.log(
                `[memory-restore] rawType=${typeof raw} rawLen=${rawLen} cards=${cards.length} applied=${newCards.size}`,
              );
              if (newCards.size > 0) {
                useMemoryStore.setState({ cards: newCards });
                publish<MemoryCardsUpdatedPayload>('memory:cards-updated', {
                  cards: newCards,
                  isReview: false,
                });
              }
            })
            .catch((e: unknown) => {
              // 仍不传播到 Web, 但留运行日志点 — 此前 .catch 全静默,
              // 十版实机欠账期间断链无法诊断 (v1.6.0 D1 教训).
              console.log(
                `[memory-restore] rejected: ${e instanceof Error ? e.message : String(e)}`,
              );
            })
            .finally(() => {
              markNativeMemoryRestoreSettled();
            });
          return;
        }
        markNativeMemoryRestoreSettled();
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
