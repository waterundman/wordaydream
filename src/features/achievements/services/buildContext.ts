/**
 * v1.5.3 fix V3-P2-005: 统一成就评估 context 构建.
 *
 * 之前复习流 (useReviewSessionStore.startReview / nextCard) 调用 checkAndUnlock
 * 时传全 0/空的 context (totalWords=0, totalSessions=0, languages=[], masteredByLevel 全 0),
 * 导致 bilingual / polyglot_2 / words_50 / words_500 / first_session / difficult_climb /
 * compound_master 共 7 个成就永远无法从复习流解锁.
 *
 * 本函数从 useStreakStore / useMemoryStore / useReadingHistoryStore 读取真实数据,
 * 供阅读流 (loadSession) 和复习流 (startReview / nextCard) 共用.
 */
import { useStreakStore } from '../../streak/store/useStreakStore';
import { useMemoryStore } from '../../review/store/useMemoryStore';
import { useReadingHistoryStore } from '../../reading/store/useReadingHistoryStore';
import type { DifficultyLevel } from '../../../types';
import type { AchievementContext } from '../types';

export function buildAchievementContext(
  lastSessionPerfect: boolean = false
): AchievementContext {
  const streak = useStreakStore.getState().currentStreak;
  const memoryState = useMemoryStore.getState();
  const historyState = useReadingHistoryStore.getState();

  const totalWords = memoryState.getCardCount();
  const totalSessions = historyState.history.length;
  const languages = Array.from(
    new Set(historyState.history.map((h) => h.language))
  );

  const masteredByLevel: Record<DifficultyLevel, number> = {
    1: 0,
    2: 0,
    3: 0,
    4: 0,
    5: 0,
  };
  for (const card of memoryState.cards.values()) {
    if (card.status === 'review' && card.reps >= 2) {
      const lv = card.objectiveDifficulty;
      if (lv >= 1 && lv <= 5) {
        masteredByLevel[lv] += 1;
      }
    }
  }

  // v1.5.3 fix V4-P2-001: 从阅读历史汇总已解析的德语复合词数.
  // 之前硬编码为 0, 导致 compound_master 成就永远无法解锁.
  // 统计口径: 跨所有历史 passage, isCompound && isResolved 的 distinct lexemeGroupId.
  let completedCompounds = 0;
  for (const entry of historyState.history) {
    if (entry.passage.language !== 'de') continue;
    const resolvedCompoundIds = new Set<string>();
    for (const token of entry.passage.tokens) {
      if (token.isCompound && token.isResolved) {
        resolvedCompoundIds.add(token.lexemeGroupId);
      }
    }
    completedCompounds += resolvedCompoundIds.size;
  }

  return {
    streak,
    totalWords,
    totalSessions,
    languages,
    masteredByLevel,
    completedCompounds,
    lastSessionPerfect,
  };
}
