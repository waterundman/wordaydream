import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Rating } from '../../../types';

/**
 * v1.0.0 Stage 1: 可改键的评分快捷键 store
 *
 * 复习页评分键默认 1/2/3/4 对应 again/hard/good/easy, 用户可在设置面板改键。
 * 改键需做冲突校验 (单字符可打印 / 保留键 / 评分互斥), 拒绝时**不覆盖旧值**。
 *
 * persist: 仅持久化 ratingKeys, key 为 `wordaydream:shortcut-overrides`,
 * 沿 review/store/useWrongWordsStore.ts 的 persist 写法。
 */

/** 各评级对应的按键 (单字符字符串) */
export interface RatingKeys {
  again: string;
  hard: string;
  good: string;
  easy: string;
}

/** 默认键位: 1/2/3/4 */
export const DEFAULT_RATING_KEYS: RatingKeys = {
  again: '1',
  hard: '2',
  good: '3',
  easy: '4',
};

/**
 * 保留键: 已被全局/阅读页占用的单键, 不可作为评分键。
 * 注意 ' ' (空格) 是单字符, 必须显式列入; 多字符功能键 (如 'F1'/'Escape')
 * 会被下方单字符校验天然拦截, 但仍列入保持语义完整与未来扩展。
 */
export const RESERVED_KEYS: readonly string[] = [
  '?',
  's',
  'S',
  'r',
  'R',
  'Escape',
  ' ',
  'Tab',
  'Enter',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
];

const RATINGS: Rating[] = ['again', 'hard', 'good', 'easy'];

const SCHEMA_VERSION = 1;

interface ShortcutsState {
  ratingKeys: RatingKeys;
  /**
   * 设置某评级的键位。
   * @returns { ok: true } 成功; { ok: false, reason } 拒绝 (不覆盖旧值)。
   *  拒绝条件:
   *   a) 单字符可打印校验失败 (key.length !== 1) — 修饰组合/功能键天然拦截
   *   b) 保留键 (RESERVED_KEYS)
   *   c) 评分互斥 — key 已被其他评级占用
   */
  setRatingKey: (rating: Rating, key: string) => { ok: boolean; reason?: string };
  /** 恢复默认键位 */
  resetRatingKeys: () => void;
}

export const useShortcutsStore = create<ShortcutsState>()(
  persist(
    (set, get) => ({
      ratingKeys: { ...DEFAULT_RATING_KEYS },

      setRatingKey: (rating, key) => {
        // a) 单字符可打印校验: 修饰组合 / 功能键 (F1, Escape, ArrowUp...)
        //    长度非 1, 天然拦截
        if (key.length !== 1) {
          return { ok: false, reason: `按键 "${key}" 无效: 必须是单字符可打印键` };
        }

        // b) 保留键拒绝
        if (RESERVED_KEYS.includes(key)) {
          return { ok: false, reason: `按键 "${key}" 是保留键, 不可用于评分` };
        }

        // c) 评分互斥: key 已被其他评级占用 → 拒绝
        const { ratingKeys } = get();
        for (const r of RATINGS) {
          if (r !== rating && ratingKeys[r] === key) {
            return { ok: false, reason: `按键 "${key}" 已被 ${r} 占用` };
          }
        }

        set({ ratingKeys: { ...ratingKeys, [rating]: key } });
        return { ok: true };
      },

      resetRatingKeys: () => set({ ratingKeys: { ...DEFAULT_RATING_KEYS } }),
    }),
    {
      name: 'wordaydream:shortcut-overrides',
      version: SCHEMA_VERSION,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        ratingKeys: state.ratingKeys,
      }),
    },
  ),
);

/**
 * 派生 '1'→'again' 形态的键位映射 (供 useGlobalShortcuts 订阅使用)。
 * 读取当前 store 状态; 也可传 { ratingKeys } 字面量以契合 selector 用法。
 */
export function getRatingKeyMap(state?: {
  ratingKeys: RatingKeys;
}): Record<string, Rating> {
  const ratingKeys = state ? state.ratingKeys : useShortcutsStore.getState().ratingKeys;
  const map: Record<string, Rating> = {};
  for (const r of RATINGS) {
    map[ratingKeys[r]] = r;
  }
  return map;
}
