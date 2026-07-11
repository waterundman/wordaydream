/**
 * 成就引擎 (纯函数)
 *
 * 负责根据当前 `AchievementContext` 与已解锁列表, 计算新增解锁事件。
 * 不修改 state, 不引用 store, 不产生副作用, 易于在后续阶段加入单元测试。
 */
import type {
  Achievement,
  AchievementCondition,
  AchievementContext,
  AchievementUnlock,
} from '../types';

/**
 * 全部 13 个成就定义
 *
 * 分类: 4 入门 + 4 进度 + 3 探索 + 2 隐藏。
 * 全部以 `unlocked: false, unlockedAt: null` 初始化,
 * store 在 hydrate 时复制此列表作为基础状态。
 */
export const ALL_ACHIEVEMENTS: Achievement[] = [
  // ── 入门 (4) ───────────────────────────────────────
  {
    id: 'first_session',
    category: 'starter',
    title: '初次启航',
    description: '完成首次阅读会话',
    condition: { type: 'session_count', count: 1 },
    unlocked: false,
    unlockedAt: null,
    iconKey: 'sailboat',
  },
  {
    id: 'streak_3',
    category: 'starter',
    title: '三日入门',
    description: '连续 3 天学习',
    condition: { type: 'streak', days: 3 },
    unlocked: false,
    unlockedAt: null,
    iconKey: 'flame',
  },
  {
    id: 'streak_7',
    category: 'starter',
    title: '一周',
    description: '连续 7 天学习',
    condition: { type: 'streak', days: 7 },
    unlocked: false,
    unlockedAt: null,
    iconKey: 'flame-strong',
  },
  {
    id: 'first_perfect',
    category: 'starter',
    title: '首次完美',
    description: '完成一次无错会话',
    condition: { type: 'perfect_session' },
    unlocked: false,
    unlockedAt: null,
    iconKey: 'star',
  },

  // ── 进度 (4) ───────────────────────────────────────
  {
    id: 'words_50',
    category: 'progress',
    title: '半百',
    description: '累计学习 50 个词',
    condition: { type: 'total_words', count: 50 },
    unlocked: false,
    unlockedAt: null,
    iconKey: 'badge-50',
  },
  {
    id: 'words_500',
    category: 'progress',
    title: '五百之师',
    description: '累计学习 500 个词',
    condition: { type: 'total_words', count: 500 },
    unlocked: false,
    unlockedAt: null,
    iconKey: 'badge-500',
  },
  {
    id: 'streak_30',
    category: 'progress',
    title: '月度习惯',
    description: '连续 30 天学习',
    condition: { type: 'streak', days: 30 },
    unlocked: false,
    unlockedAt: null,
    iconKey: 'calendar',
  },
  {
    id: 'streak_100',
    category: 'progress',
    title: '百日',
    description: '连续 100 天学习',
    condition: { type: 'streak', days: 100 },
    unlocked: false,
    unlockedAt: null,
    iconKey: 'calendar-strong',
  },

  // ── 探索 (3) ───────────────────────────────────────
  {
    id: 'bilingual',
    category: 'explore',
    title: '双语者',
    description: '同时学习英/德',
    condition: { type: 'language_count', count: 2 },
    unlocked: false,
    unlockedAt: null,
    iconKey: 'hands',
  },
  {
    id: 'difficult_climb',
    category: 'explore',
    title: '难度登顶',
    description: '在 L5 完成 10 个词',
    condition: { type: 'max_difficulty_count', level: 5, count: 10 },
    unlocked: false,
    unlockedAt: null,
    iconKey: 'mountain',
  },
  {
    id: 'compound_master',
    category: 'explore',
    title: '复合大师',
    description: '完成 5 个德语复合词',
    condition: { type: 'compound_count', count: 5 },
    unlocked: false,
    unlockedAt: null,
    iconKey: 'puzzle',
  },

  // ── 隐藏 (2) ───────────────────────────────────────
  {
    id: 'polyglot_2',
    category: 'hidden',
    title: '?',
    description: '?',
    condition: { type: 'hidden', check: 'polyglot_2' },
    unlocked: false,
    unlockedAt: null,
    iconKey: 'hidden',
  },
  {
    id: 'marathon',
    category: 'hidden',
    title: '?',
    description: '?',
    condition: { type: 'hidden', check: 'marathon' },
    unlocked: false,
    unlockedAt: null,
    iconKey: 'hidden',
  },
];

/**
 * 评估当前 context, 返回本次新增的解锁事件列表
 *
 * 行为约定:
 * - 已解锁的成就不会被重复解锁 (通过 `current` 中 `unlocked === true` 过滤)
 * - 返回的 `achievement` 是带 `unlocked: true, unlockedAt` 的快照,
 *   调用方需自行决定是否替换原 `current` 中的对象
 * - 返回数组可能为空 (无新增), 调用方据此判断是否触发 toast
 */
export function evaluate(
  ctx: AchievementContext,
  current: Achievement[],
): AchievementUnlock[] {
  const unlockedIds = new Set(
    current.filter((a) => a.unlocked).map((a) => a.id),
  );
  const result: AchievementUnlock[] = [];
  const now = Date.now();

  for (const ach of ALL_ACHIEVEMENTS) {
    if (unlockedIds.has(ach.id)) continue;
    if (isConditionMet(ach.condition, ctx)) {
      result.push({
        achievement: { ...ach, unlocked: true, unlockedAt: now },
        unlockedAt: now,
      });
    }
  }
  return result;
}

/**
 * 判定单个条件是否满足
 *
 * switch 各分支覆盖 `AchievementCondition` 联合的全部 8 个 case,
 * 配合 `noFallthroughCasesInSwitch: true` 编译约束保证无遗漏。
 */
function isConditionMet(
  condition: AchievementCondition,
  ctx: AchievementContext,
): boolean {
  switch (condition.type) {
    case 'streak':
      return ctx.streak >= condition.days;
    case 'total_words':
      return ctx.totalWords >= condition.count;
    case 'session_count':
      return ctx.totalSessions >= condition.count;
    case 'perfect_session':
      return ctx.lastSessionPerfect;
    case 'language_count':
      return ctx.languages.length >= condition.count;
    case 'max_difficulty_count':
      return (ctx.masteredByLevel[condition.level] ?? 0) >= condition.count;
    case 'compound_count':
      return ctx.completedCompounds >= condition.count;
    case 'hidden':
      // 隐藏成就:
      // - polyglot_2: 双语学者 — 同时学习英/德且累计 100+ 词 (v1.5.2 修复 M2: 原 >=5 languages 不可达)
      // - marathon: marathon (totalSessions >= 50)
      if (condition.check === 'polyglot_2') {
        return ctx.languages.length >= 2 && ctx.totalWords >= 100;
      }
      if (condition.check === 'marathon') return ctx.totalSessions >= 50;
      return false;
  }
}
