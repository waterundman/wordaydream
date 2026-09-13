import { useMemo } from 'react';
import { useWrongWordsStore } from '../../review/store/useWrongWordsStore';
import type { WrongWordEntry } from '../../review/store/useWrongWordsStore';
import type { TokenOccurrence } from '../../../types';

/**
 * v1.2.0 Stage 1: 阅读流 ↔ 错词本联动高亮 — 匹配派生
 *
 * 从 useWrongWordsStore 订阅式读取 entries (zustand selector, persist
 * rehydrate 完成后 entries 变化会触发重渲染, 运行中 recordWrong 即时生效),
 * 构建 Map<string, number> (key = 匹配键, value = wrongCount)。
 *
 * 匹配键口径 (宁漏勿错: 变体不匹配就漏标, 不误标):
 * - 'lg:<lexemeGroupId>' — entry.lexemeGroupId 与 token.lexemeGroupId 精确等值
 *   (最精确, 复数/时态等表面变体也能命中)
 * - 'sf:<surfaceForm 小写>' — entry.lemma 与 token.surfaceForm 小写等值
 *   (兜底: entry 是 MemoryCard 冗余快照, cardId 与 passage token 无直接关联,
 *   只有表面形式完全一致才匹配; 'Cats'/'cats' 命中, 'cats' vs lemma 'cat' 漏标)
 *
 * 同键多条 entry (同 lexemeGroupId 多卡 / 同 lemma 多卡) 取 max(wrongCount)
 * 保守合并, 避免后写覆盖导致累计次数显示偏小。
 */

/** 错词查找 Map: key = 'lg:<id>' | 'sf:<lemma 小写>', value = wrongCount */
export type WrongWordMarkMap = Map<string, number>;

export function buildWrongWordMap(entries: WrongWordEntry[]): WrongWordMarkMap {
  const map: WrongWordMarkMap = new Map();
  for (const entry of entries) {
    if (entry.lexemeGroupId) {
      const prev = map.get(`lg:${entry.lexemeGroupId}`);
      map.set(`lg:${entry.lexemeGroupId}`, prev === undefined ? entry.wrongCount : Math.max(prev, entry.wrongCount));
    }
    const sfKey = entry.lemma.trim().toLowerCase();
    if (sfKey) {
      const prev = map.get(`sf:${sfKey}`);
      map.set(`sf:${sfKey}`, prev === undefined ? entry.wrongCount : Math.max(prev, entry.wrongCount));
    }
  }
  return map;
}

/**
 * 查询单个 token 的错词次数。lg: 精确口径优先, 未命中再查 sf: 兜底口径。
 * 未命中返回 undefined (非错词)。
 */
export function getTokenWrongCount(
  map: WrongWordMarkMap,
  token: Pick<TokenOccurrence, 'lexemeGroupId' | 'surfaceForm'>,
): number | undefined {
  return map.get(`lg:${token.lexemeGroupId}`) ?? map.get(`sf:${token.surfaceForm.toLowerCase()}`);
}

/**
 * React hook: 订阅错词本 entries 并派生匹配 Map。
 * useMemo 依赖 entries (引用变化即重派生), 无本地状态。
 */
export function useWrongWordMarks(): WrongWordMarkMap {
  const entries = useWrongWordsStore((s) => s.entries);
  return useMemo(() => buildWrongWordMap(entries), [entries]);
}
