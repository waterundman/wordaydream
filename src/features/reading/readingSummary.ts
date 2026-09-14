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
