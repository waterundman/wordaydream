/**
 * MemoryCardSchema (v0.1.0-harmony Stage 6)
 *
 * ArkTS 端 MemoryCard 类型定义 + RDB 表 schema 常量.
 * 字段与 Web 端 src/types/index.ts 的 MemoryCard 接口一一对应 (16 字段).
 *
 * ArkTS 适配说明:
 * - Web 端 DifficultyLevel = 1 | 2 | 3 | 4 | 5 (数值联合类型), ArkTS 用 number 表示.
 * - Web 端 Language = 'en' | 'de' (字符串联合类型), ArkTS 用 string 表示 (无法表达联合).
 *   Web 端 language 字段可选 (language?), RDB 端用 '' (空字符串) 表示 undefined.
 * - Web 端 status = 'new' | 'learning' | 'review' | 'relearning', ArkTS 用 string 表示.
 * - 所有字段命名与 Web MemoryCard 接口完全一致, 保证 JSBridge 单向镜像时的字段映射.
 *
 * 字段映射 (Web MemoryCard -> ArkTS MemoryCardRecord):
 *   id                  -> id                  (string,  PRIMARY KEY)
 *   lexemeGroupId       -> lexemeGroupId       (string)
 *   lemma               -> lemma               (string)
 *   objectiveDifficulty -> objectiveDifficulty (number,  1-5)
 *   language            -> language            (string,  'en' | 'de' | '')
 *   firstLearnedAt      -> firstLearnedAt      (number,  epoch ms)
 *   lastReviewAt        -> lastReviewAt        (number,  epoch ms)
 *   due                 -> due                 (number,  epoch ms)
 *   stability           -> stability           (number,  FSRS stability)
 *   difficulty          -> difficulty          (number,  FSRS difficulty)
 *   elapsedDays         -> elapsedDays         (number)
 *   scheduledDays       -> scheduledDays       (number)
 *   reps                -> reps                (number)
 *   lapses              -> lapses              (number)
 *   status              -> status              (string)
 *   learningSteps       -> learningSteps       (number)
 */

/** RDB 表名. */
export const TABLE_NAME: string = 'wordaydream_memory_cards';

/** RDB store 配置名. */
export const STORE_NAME: string = 'wordaydream_memory.db';

/** 列名常量 (避免硬编码字符串, 所有 SQL 引用 COLUMN_* 常量). */
export const COLUMN_ID: string = 'id';
export const COLUMN_LEXEME_GROUP_ID: string = 'lexemeGroupId';
export const COLUMN_LEMMA: string = 'lemma';
export const COLUMN_OBJECTIVE_DIFFICULTY: string = 'objectiveDifficulty';
export const COLUMN_LANGUAGE: string = 'language';
export const COLUMN_FIRST_LEARNED_AT: string = 'firstLearnedAt';
export const COLUMN_LAST_REVIEW_AT: string = 'lastReviewAt';
export const COLUMN_DUE: string = 'due';
export const COLUMN_STABILITY: string = 'stability';
export const COLUMN_DIFFICULTY: string = 'difficulty';
export const COLUMN_ELAPSED_DAYS: string = 'elapsedDays';
export const COLUMN_SCHEDULED_DAYS: string = 'scheduledDays';
export const COLUMN_REPS: string = 'reps';
export const COLUMN_LAPSES: string = 'lapses';
export const COLUMN_STATUS: string = 'status';
export const COLUMN_LEARNING_STEPS: string = 'learningSteps';

/**
 * 建表 SQL (IF NOT EXISTS).
 *
 * 类型映射:
 * - string -> TEXT
 * - number (整数: 时间戳/计数/难度等级/步骤) -> INTEGER
 * - number (浮点: FSRS stability/difficulty) -> REAL
 *
 * 主键: id (Web 端 MemoryCard.id 唯一标识符).
 */
export const CREATE_TABLE_SQL: string =
  `CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (` +
  `${COLUMN_ID} TEXT PRIMARY KEY, ` +
  `${COLUMN_LEXEME_GROUP_ID} TEXT, ` +
  `${COLUMN_LEMMA} TEXT, ` +
  `${COLUMN_OBJECTIVE_DIFFICULTY} INTEGER, ` +
  `${COLUMN_LANGUAGE} TEXT DEFAULT '', ` +
  `${COLUMN_FIRST_LEARNED_AT} INTEGER, ` +
  `${COLUMN_LAST_REVIEW_AT} INTEGER, ` +
  `${COLUMN_DUE} INTEGER, ` +
  `${COLUMN_STABILITY} REAL, ` +
  `${COLUMN_DIFFICULTY} REAL, ` +
  `${COLUMN_ELAPSED_DAYS} INTEGER, ` +
  `${COLUMN_SCHEDULED_DAYS} INTEGER, ` +
  `${COLUMN_REPS} INTEGER, ` +
  `${COLUMN_LAPSES} INTEGER, ` +
  `${COLUMN_STATUS} TEXT, ` +
  `${COLUMN_LEARNING_STEPS} INTEGER` +
  `);`;
/**
 * Index SQL (v0.3.0-harmony Stage 4, R-IDB-2: CREATE INDEX IF NOT EXISTS idempotent).
 *
 * 3 indexes cover MemoryCardStore high-frequency query paths:
 * - idx_due: getDueCardsCount / getDueCards (WHERE due <= ? ORDER BY due ASC)
 * - idx_lastReviewAt: getRecentlyReviewedCards / getTodayReviewStats (lastReviewAt range query)
 * - idx_language: language filter for cards (Stage 5 dashboard extension)
 */
export const CREATE_INDEX_SQL_DUE: string =
  `CREATE INDEX IF NOT EXISTS idx_due ON ${TABLE_NAME} (${COLUMN_DUE});`;
export const CREATE_INDEX_SQL_LAST_REVIEW: string =
  `CREATE INDEX IF NOT EXISTS idx_lastReviewAt ON ${TABLE_NAME} (${COLUMN_LAST_REVIEW_AT});`;
export const CREATE_INDEX_SQL_LANGUAGE: string =
  `CREATE INDEX IF NOT EXISTS idx_language ON ${TABLE_NAME} (${COLUMN_LANGUAGE});`;

/**
 * ArkTS 端 MemoryCard 记录类型.
 *
 * 与 Web 端 src/types/index.ts 的 MemoryCard 接口字段一一对应 (16 字段).
 * ArkTS 不支持 TypeScript 联合类型 (union type), 因此 objectiveDifficulty 用 number、
 * language/status 用 string 表示, 有效值见各字段 JSDoc.
 */
export interface MemoryCardRecord {
  /** 唯一标识符 (主键). */
  id: string;
  /** 所属词位组 ID. */
  lexemeGroupId: string;
  /** 词位. */
  lemma: string;
  /**
   * 客观难度等级.
   * 有效值: 1 | 2 | 3 | 4 | 5 (对应 Web DifficultyLevel 数值联合类型).
   */
  objectiveDifficulty: number;
  /**
   * 语言类型.
   * 有效值: 'en' | 'de' (对应 Web Language 联合类型).
   * Web 端 language 字段可选 (language?), RDB 端用 '' (空字符串) 表示 undefined.
   */
  language: string;
  /** 首次学习时间戳 (ms, epoch, 不可变). */
  firstLearnedAt: number;
  /** 最近一次复习时间戳 (ms, epoch). */
  lastReviewAt: number;
  /** 下次复习时间戳 (ms, epoch). */
  due: number;
  /** FSRS 稳定性参数. */
  stability: number;
  /** FSRS 难度参数. */
  difficulty: number;
  /** 已过去天数. */
  elapsedDays: number;
  /** 计划间隔天数. */
  scheduledDays: number;
  /** 复习次数. */
  reps: number;
  /** 遗忘次数. */
  lapses: number;
  /**
   * 状态.
   * 有效值: 'new' | 'learning' | 'review' | 'relearning' (对应 Web status 联合类型).
   */
  status: string;
  /** FSRS learning_steps 索引 (0=第一步, 1=第二步, ...). */
  learningSteps: number;
}

/**
 * 列名有序列表 (与 MemoryCardRecord 字段顺序一致, 用于结果集映射).
 * 用于 MemoryCardStore 读取 ResultSet 时按列名取值.
 */
export const COLUMN_LIST: string[] = [
  COLUMN_ID,
  COLUMN_LEXEME_GROUP_ID,
  COLUMN_LEMMA,
  COLUMN_OBJECTIVE_DIFFICULTY,
  COLUMN_LANGUAGE,
  COLUMN_FIRST_LEARNED_AT,
  COLUMN_LAST_REVIEW_AT,
  COLUMN_DUE,
  COLUMN_STABILITY,
  COLUMN_DIFFICULTY,
  COLUMN_ELAPSED_DAYS,
  COLUMN_SCHEDULED_DAYS,
  COLUMN_REPS,
  COLUMN_LAPSES,
  COLUMN_STATUS,
  COLUMN_LEARNING_STEPS,
];

/**
 * 今日复习统计 (Stage 3 新增, 供服务卡片进度环 + Web 端 dashboard 展示).
 *
 * 字段与 Web 端 src/platform/harmonyBridge.ts 的 TodayReviewStatsBridge 接口一一对应,
 * 通过 JSBridge 序列化无字段丢失 (3 个 number 字段, JSON 安全).
 */
export interface TodayReviewStats {
  /** 待复习卡片数 (due <= now). */
  dueCount: number;
  /** 今日已复习卡片数 (lastReviewAt >= todayStart). */
  reviewedCount: number;
  /** 总卡片数 (COUNT(*)). */
  totalCount: number;
}
