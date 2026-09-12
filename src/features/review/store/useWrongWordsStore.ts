import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { MemoryCard, Language } from '../../../types';

/**
 * v0.9.0 Stage 1: 跨会话错词本 (Cross-session Wrong Words Book)
 *
 * 与 v0.8.0 的"会话内错词回顾"(useReviewSessionStore.results 只持久化最近一次会话,
 * 刷新即丢) 不同, 本 store 把复习答错 (grade==='wrong') 的词独立持久化,
 * 不受单次会话生命周期影响, 可在 wordlist 页随时回看。
 *
 * 入账口径: 仅 grade==='wrong' 入账, partial(拼写部分正确) 不计入 —— 与完成页
 * "本次错词回顾" 同源, 保证两处错词口径一致。详见下列 recordWrong 调用处的选型说明。
 */

/** 错词本容量上限: 超出后按 lastWrongAt(FIFO) 淘汰最旧一条 */
export const MAX_WRONG_WORDS = 500;

export interface WrongWordEntry {
  /** MemoryCard.id — 作为去重键 (同一张卡片多次答错只保留一条) */
  cardId: string;
  /** MemoryCard.lexemeGroupId — 复习评分 / 反查用 */
  lexemeGroupId: string;
  /** 词条原文 (冗余存储, 即使 MemoryCard 被删也能回看) */
  lemma: string;
  /** 语言标记 ('en'|'de'); MemoryCard.language 为可选, 故允许 undefined 并在渲染降级 */
  language?: Language;
  /** 累计答错次数 */
  wrongCount: number;
  /** 最近一次答错时间 (timestamp) — 排序 / 淘汰依据 */
  lastWrongAt: number;
  /** 首次答错时间 (timestamp) — 不随后续答错变化 */
  firstWrongAt: number;
}

interface WrongWordsState {
  entries: WrongWordEntry[];
  /**
   * 答错入账 (upsert)。
   * - 已有 cardId → wrongCount+1, lastWrongAt=answeredAt (firstWrongAt 不变)
   * - 新卡      → wrongCount=1, firstWrongAt=lastWrongAt=answeredAt
   * 入账后若超出 MAX_WRONG_WORDS, 淘汰 lastWrongAt 最小(最旧)的一条 (FIFO)。
   */
  recordWrong: (card: MemoryCard, answeredAt: number) => void;
  /** 清空全部错词 (供将来设置面板用, 本轮仅实现+测试) */
  clearAll: () => void;
}

const SCHEMA_VERSION = 1;

export const useWrongWordsStore = create<WrongWordsState>()(
  persist(
    (set) => ({
      entries: [],

      recordWrong: (card, answeredAt) => {
        set((state) => {
          const idx = state.entries.findIndex((e) => e.cardId === card.id);
          let entries: WrongWordEntry[];

          if (idx >= 0) {
            // upsert: 已存在 → 次数+1, 仅更新 lastWrongAt, 保留 firstWrongAt
            entries = state.entries.map((e, i) =>
              i === idx
                ? { ...e, wrongCount: e.wrongCount + 1, lastWrongAt: answeredAt }
                : e,
            );
          } else {
            const entry: WrongWordEntry = {
              cardId: card.id,
              lexemeGroupId: card.lexemeGroupId,
              lemma: card.lemma,
              language: card.language,
              wrongCount: 1,
              lastWrongAt: answeredAt,
              firstWrongAt: answeredAt,
            };
            entries = [...state.entries, entry];
          }

          // 容量上限: 超出则淘汰 lastWrongAt 最小(最旧)的一条。
          // 刚入账的条目拥有最大 lastWrongAt, 不会被本次淘汰命中。
          if (entries.length > MAX_WRONG_WORDS) {
            let oldestIdx = 0;
            for (let i = 1; i < entries.length; i++) {
              if (entries[i].lastWrongAt < entries[oldestIdx].lastWrongAt) {
                oldestIdx = i;
              }
            }
            entries = entries.filter((_, i) => i !== oldestIdx);
          }

          return { entries };
        });
      },

      clearAll: () => set({ entries: [] }),
    }),
    {
      name: 'wordaydream:wrong-words',
      version: SCHEMA_VERSION,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        entries: state.entries,
      }),
    },
  ),
);

/**
 * 取 lastWrongAt 倒序 (最近答错在前) 的条目副本。
 * 接受 state ({ entries }) 以契合 store selector 用法; 也可直接传 { entries } 字面量。
 */
export function getSortedEntries(state: { entries: WrongWordEntry[] }): WrongWordEntry[] {
  return [...state.entries].sort((a, b) => b.lastWrongAt - a.lastWrongAt);
}

/**
 * v1.1.0 Stage 1: 错词本多模式排序 (纯派生, 不修改原数组, 与 getSortedEntries 同签名风格)。
 * - 'recent'    : lastWrongAt 倒序 (等价 getSortedEntries)
 * - 'oldest'    : firstWrongAt 升序 (最早入本在前)
 * - 'mostWrong' : wrongCount 倒序, 同分按 lastWrongAt 倒序 (最近答错的在前)
 */
export type WrongWordsSortMode = 'recent' | 'oldest' | 'mostWrong';

export function sortEntriesBy(
  state: { entries: WrongWordEntry[] },
  mode: WrongWordsSortMode,
): WrongWordEntry[] {
  const copy = [...state.entries];
  if (mode === 'oldest') {
    copy.sort((a, b) => a.firstWrongAt - b.firstWrongAt);
  } else if (mode === 'mostWrong') {
    copy.sort((a, b) => b.wrongCount - a.wrongCount || b.lastWrongAt - a.lastWrongAt);
  } else {
    copy.sort((a, b) => b.lastWrongAt - a.lastWrongAt);
  }
  return copy;
}

/**
 * v1.1.0 Stage 1: 错词本过滤 (纯派生, 不修改原数组)。
 * - language: 'all'/未传 → 不过滤; 'en'/'de' → entry.language === 该值;
 *   language 为 undefined 的条目 (旧数据) 只在 'all' 结果中出现。
 * - timeRange: 'all'/未传 → 不过滤; '7d'/'30d' → now - lastWrongAt 严格小于阈值;
 *   'older' → now - lastWrongAt >= 30 天。
 * - now 可注入 (测试用), 缺省 Date.now()。
 */
export type WrongWordsLanguageFilter = 'all' | 'en' | 'de';
export type WrongWordsTimeFilter = 'all' | '7d' | '30d' | 'older';

export function filterEntriesBy(
  state: { entries: WrongWordEntry[] },
  opts: {
    language?: WrongWordsLanguageFilter;
    timeRange?: WrongWordsTimeFilter;
    now?: number;
  } = {},
): WrongWordEntry[] {
  const language = opts.language ?? 'all';
  const timeRange = opts.timeRange ?? 'all';
  const now = opts.now ?? Date.now();
  const DAY = 86_400_000;

  return state.entries.filter((entry) => {
    if (language !== 'all' && entry.language !== language) {
      return false;
    }
    if (timeRange !== 'all') {
      const age = now - entry.lastWrongAt;
      if (timeRange === '7d' && age >= 7 * DAY) return false;
      if (timeRange === '30d' && age >= 30 * DAY) return false;
      if (timeRange === 'older' && age < 30 * DAY) return false;
    }
    return true;
  });
}

/**
 * 相对时间格式化 (零依赖)。
 * 阈值: <1min 刚刚 / <60min N 分钟前 / <24h N 小时前 / <30d N 天前 / 更久 YYYY-MM-DD。
 */
export function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const MIN = 60_000;
  const HOUR = 3_600_000;
  const DAY = 86_400_000;
  const MONTH = 30 * DAY;

  if (diff < MIN) return '刚刚';
  if (diff < HOUR) return `${Math.floor(diff / MIN)} 分钟前`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} 小时前`;
  if (diff < MONTH) return `${Math.floor(diff / DAY)} 天前`;
  const d = new Date(timestamp);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
