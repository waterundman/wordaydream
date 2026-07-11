/**
 * 成就系统类型定义
 *
 * 阶段 1 数据层: 成就 store / 引擎 / 难度顾问的纯类型声明。
 * 本文件不引用任何运行时, 仅 export type, 符合 `verbatimModuleSyntax` 严格模式。
 */
import type { DifficultyLevel } from '../../types';

/**
 * 成就分类
 *
 * - starter: 入门 (前几次会话就能解锁)
 * - progress: 进度 (需要长期坚持)
 * - explore: 探索 (多语言 / 高难度 / 复合词)
 * - hidden: 隐藏 (不展示具体描述, 解锁后才揭晓)
 */
export type AchievementCategory = 'starter' | 'progress' | 'explore' | 'hidden';

/**
 * 成就解锁条件
 *
 * 用判别联合 (discriminated union) 表示所有可能的触发条件。
 * `type` 字段是判别子, `isConditionMet` 根据它分发到对应的判定逻辑。
 */
export type AchievementCondition =
  | { type: 'streak'; days: number }
  | { type: 'total_words'; count: number }
  | { type: 'session_count'; count: number }
  | { type: 'perfect_session' }
  | { type: 'language_count'; count: number }
  | { type: 'max_difficulty_count'; level: DifficultyLevel; count: number }
  | { type: 'compound_count'; count: number }
  | { type: 'hidden'; check: 'marathon' | 'polyglot_2' };

/**
 * 单个成就定义
 */
export interface Achievement {
  /** 唯一 ID (snake_case, 与 ALL_ACHIEVEMENTS 的 key 对应) */
  id: string;
  /** 成就分类 */
  category: AchievementCategory;
  /** 成就标题 (中文, hidden 类型可使用 "?" 占位) */
  title: string;
  /** 成就描述 (hidden 类型可使用 "?" 占位) */
  description: string;
  /** 解锁条件 */
  condition: AchievementCondition;
  /** 是否已解锁 */
  unlocked: boolean;
  /** 解锁时间戳 (毫秒), 未解锁时为 null */
  unlockedAt: number | null;
  /** 图标键 (用于 UI 渲染时映射到 iconKey.svg sprite) */
  iconKey: string;
}

/**
 * 成就评估上下文
 *
 * 汇总自 reading / review / settings 等 store 的派生数据,
 * 由调用方在每次需要评估时组装, 传入 `evaluate(ctx, current)`。
 */
export interface AchievementContext {
  /** 当前连续学习天数 */
  streak: number;
  /** 累计已学习词数 */
  totalWords: number;
  /** 累计完成会话数 */
  totalSessions: number;
  /** 当前已激活的语言列表 (e.g. ['en', 'de']) */
  languages: string[];
  /** 各难度等级下已掌握的词数 (key = DifficultyLevel 1-5) */
  masteredByLevel: Record<DifficultyLevel, number>;
  /** 累计已完成的德语复合词数 */
  completedCompounds: number;
  /** 最近一次会话是否零错误 (用于 first_perfect) */
  lastSessionPerfect: boolean;
}

/**
 * 成就解锁事件
 *
 * 引擎 `evaluate` 返回的载荷, 包含被解锁的成就快照和解锁时间,
 * store 据此更新 `achievements` 列表并把事件推入 `newUnlocks` 队列。
 */
export interface AchievementUnlock {
  /** 被解锁的成就 (含 unlocked: true 与 unlockedAt) */
  achievement: Achievement;
  /** 解锁时间戳 (毫秒) */
  unlockedAt: number;
}
