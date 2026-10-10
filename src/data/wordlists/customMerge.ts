/**
 * v1.6.5 S1 — 自定义 CSV 词库并入官方等级词表 (纯函数层)
 *
 * 背景: v1.6.4 全功能探测证实导入的 CSV 词库「写入即失效」—— 它只在 IndexedDB 里可见,
 * 从不进入 loadWordlist, 因此阅读生成与复习队列永远看不到这些词。本模块是那条唯一的
 * 合并通路, 保持无副作用以便把边界情况全部钉在单测里。
 *
 * 语义约定 (与 docs/spec/v1.6.5/main.md §S1 一致):
 * - 调用方负责按 language 预筛, 本函数只处理「同一语言内、映射到目标 difficulty 的条目」;
 * - 官方词条优先: lemma 与官方词表重名时丢弃自定义条目, 否则同一个 lemma 会有两套进度
 *   语义 (progress 的 key 是 `${language}:${lemma.toLowerCase()}`);
 * - 批内自身也去重, 保留首次出现顺序, 保证同一输入永远得到同一输出 (可测、可缓存);
 * - 合并条目打 `source: 'custom'`, 供词表页标注来源;
 * - 上限 MAX_CUSTOM_PER_LEVEL: 一次误导入超大 CSV 不应挤爆生成候选池。
 */

import type { DifficultyLevel, Language } from '../../types';
import type { CsvWordlistEntry } from './csvLoader';
import type { Wordlist, WordlistEntry } from './index';
/** CEFR 标签 → 项目内 difficulty 数值 (1..5, 5 = C1 自由阅读档). */
export const CEFR_TO_DIFFICULTY: Record<string, DifficultyLevel> = {
  A1: 1,
  A2: 2,
  B1: 3,
  B2: 4,
  C1: 5,
};

/** 单个 language+difficulty 等级最多并入多少条自定义词 (超出按顺序截断). */
export const MAX_CUSTOM_PER_LEVEL = 1000;

export interface CustomMergeResult {
  /** null 表示「没有官方词表也没有可用的自定义词」—— 与既有 loadWordlist 语义一致 */
  wordlist: Wordlist | null;
  /** 实际并入的自定义词条数 */
  merged: number;
  /** 因 MAX_CUSTOM_PER_LEVEL 被截掉的条数 */
  truncated: number;
  /** cefr 缺失或不可识别而被跳过的条数 (CSV 是用户输入, 这里必须容错而非抛错) */
  skippedUnknownCefr: number;
}

function normalizeLemma(lemma: string): string {
  return lemma.trim().toLowerCase();
}

/**
 * 把自定义词条并入指定 language+difficulty 的词表.
 *
 * @param base 官方等级词表, C1 档为 null
 * @param custom 已按 language 预筛的自定义词条
 */
export function mergeCustomEntries(
  base: Wordlist | null,
  language: Language,
  difficulty: DifficultyLevel,
  custom: readonly CsvWordlistEntry[]
): CustomMergeResult {
  const levelWords: WordlistEntry[] = base ? base.words : [];
  const officialLemmas = new Set(levelWords.map((w) => normalizeLemma(w.lemma)));

  const mergedEntries: WordlistEntry[] = [];
  const seenCustom = new Set<string>();
  let skippedUnknownCefr = 0;
  let truncated = 0;

  for (const entry of custom) {
    const target = CEFR_TO_DIFFICULTY[(entry.cefr ?? '').toUpperCase()];
    if (target !== difficulty) {
      // cefr 缺失 / 拼错 / 不属于本等级: 前者计入可观测计数, 后者只是不匹配
      if (target === undefined) skippedUnknownCefr += 1;
      continue;
    }
    const key = normalizeLemma(entry.lemma);
    if (!key || officialLemmas.has(key) || seenCustom.has(key)) continue;

    if (mergedEntries.length >= MAX_CUSTOM_PER_LEVEL) {
      truncated += 1;
      continue;
    }
    seenCustom.add(key);
    mergedEntries.push({
      lemma: entry.lemma.trim(),
      pos: entry.pos,
      translation: entry.translation,
      cefr: entry.cefr,
      ...(entry.priority !== undefined ? { priority: entry.priority } : {}),
      ...(entry.topic !== undefined ? { topic: entry.topic } : {}),
      ...(entry.semanticConflicts !== undefined
        ? { semanticConflicts: entry.semanticConflicts }
        : {}),
      source: 'custom',
    });
  }

  if (mergedEntries.length === 0) {
    // 幂等: 没有任何可并入项时原样返回官方词表, 不新建对象 (避免缓存引用抖动)
    return { wordlist: base, merged: 0, truncated: 0, skippedUnknownCefr };
  }

  const words = [...levelWords, ...mergedEntries];
  const wordlist: Wordlist = {
    language,
    level: base ? base.level : String(difficulty),
    difficulty,
    version: base ? `${base.version}+custom` : 'custom-only',
    total: words.length,
    words,
  };
  return {
    wordlist,
    merged: mergedEntries.length,
    truncated,
    skippedUnknownCefr,
  };
}
