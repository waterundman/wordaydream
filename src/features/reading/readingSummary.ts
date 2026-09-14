/**
 * readingSummary (v1.4.0 S3b: 轻量阅读摘要 — 纯派生, 不修改 useReadingHistoryStore)
 *
 * 数据源: useReadingHistoryStore.history (localStorage 持久化, 上限 50 条),
 * HistoryEntry { completedAt?, resolvedCount, totalTokenCount, language, ... }.
 *
 * 口径 (SPEC v1.4.0 §4.5 + R7 钉死, 防歧义):
 * - 完成条目 = completedAt 非空; 摘要的 "完成" 维度 (completedSessions /
 *   completedResolved / last7dSessions / byLanguage) 只计完成条目
 * - totalSessions = 历史全部条目 (含进行中); totalResolved = 全部条目 resolvedCount 求和
 * - last7dSessions = completedAt >= now - 7d 的完成条目数 (严格大于, 边界注入 now 测试)
 * - byLanguage = 完成条目按 language 分组; undefined (旧数据) 归 other
 * - now 可注入 (测试用), 缺省 Date.now()
 */
import type { HistoryEntry } from './store/useReadingHistoryStore';
import type { TokenOccurrence } from '../../types';

export interface ReadingSummary {
  /** 历史全部条目数 (含进行中) */
  totalSessions: number;
  /** 完成条目数 (completedAt 非空) */
  completedSessions: number;
  /** 全部条目 resolvedCount 求和 (含进行中已解析部分) */
  totalResolved: number;
  /** 完成条目 resolvedCount 求和 */
  completedResolved: number;
  /** 近 7 天完成条目数 (completedAt >= now - 7d) */
  last7dSessions: number;
  /** 完成条目语言分布 (undefined 归 other) */
  byLanguage: { en: number; de: number; other: number };
}

const SEVEN_DAYS_MS = 7 * 86_400_000;

export function summarizeReadingHistory(
  history: HistoryEntry[],
  now: number = Date.now(),
): ReadingSummary {
  const summary: ReadingSummary = {
    totalSessions: history.length,
    completedSessions: 0,
    totalResolved: 0,
    completedResolved: 0,
    last7dSessions: 0,
    byLanguage: { en: 0, de: 0, other: 0 },
  };

  for (const entry of history) {
    summary.totalResolved += entry.resolvedCount;

    if (entry.completedAt === undefined) continue;
    summary.completedSessions += 1;
    summary.completedResolved += entry.resolvedCount;

    if (entry.completedAt >= now - SEVEN_DAYS_MS) {
      summary.last7dSessions += 1;
    }

    if (entry.language === 'en') {
      summary.byLanguage.en += 1;
    } else if (entry.language === 'de') {
      summary.byLanguage.de += 1;
    } else {
      summary.byLanguage.other += 1;
    }
  }

  return summary;
}

/**
 * 本篇会话统计 (v1.5.0 S1: 阅读完成页摘要 — 纯派生自 passage.tokens, store 零改动).
 *
 * 口径 (SPEC v1.5.0 §4, 与 getResolvedCount/getTotalTokenCount 的 v1.5.2 fix P0-1
 * "normal token distinct lexemeGroupId" 同源):
 * - totalWords: 非复习 token 的 distinct lexemeGroupId 数 (本篇生词总数)
 * - correctWords: 已 resolve 且 resolvedGrade==='correct' 的非复习 distinct 组数
 * - wrongWords: 已 resolve 且 resolvedGrade 为 'wrong' 或 'partial' 的非复习 distinct
 *   组数 — partial (部分对) 归入答错侧 (未完全答对), 保证 答对+答错 = 已答组数
 * - reviewWords: 复习 token 的 distinct cardId 数 (复现旧词); cardId 缺失 (手造数据
 *   防御, 运行时 review token 构造必带 cardId) 按 lexemeGroupId 兜底 distinct
 *
 * 同组多 occurrence 运行时由 markOccurrenceResolved 一起 resolve (grade 一致);
 * 防御性场景下同组有对有错会分别计入 correct 与 wrong 两桶 (distinct 口径事实).
 */
export interface ReadingSessionStats {
  /** 本篇生词总数 (非复习 distinct 组数) */
  totalWords: number;
  /** 答对组数 (resolvedGrade==='correct') */
  correctWords: number;
  /** 答错组数 (resolvedGrade 为 'wrong' 或 'partial') */
  wrongWords: number;
  /** 复习复现旧词数 (review distinct cardId) */
  reviewWords: number;
}

export function summarizeReadingSession(tokens: TokenOccurrence[]): ReadingSessionStats {
  const totalGroups = new Set<string>();
  const correctGroups = new Set<string>();
  const wrongGroups = new Set<string>();
  const reviewGroups = new Set<string>();

  for (const t of tokens) {
    if (t.kind === 'review') {
      reviewGroups.add(t.cardId ?? t.lexemeGroupId);
      continue;
    }
    totalGroups.add(t.lexemeGroupId);
    if (!t.isResolved) continue;
    if (t.resolvedGrade === 'correct') {
      correctGroups.add(t.lexemeGroupId);
    } else if (t.resolvedGrade === 'wrong' || t.resolvedGrade === 'partial') {
      wrongGroups.add(t.lexemeGroupId);
    }
  }

  return {
    totalWords: totalGroups.size,
    correctWords: correctGroups.size,
    wrongWords: wrongGroups.size,
    reviewWords: reviewGroups.size,
  };
}
