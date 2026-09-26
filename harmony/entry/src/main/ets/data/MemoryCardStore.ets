/**
 * MemoryCardStore (v0.1.0-harmony Stage 6)
 *
 * 封装 @kit.ArkData relationalStore 操作, 管理 MemoryCardRecord 的持久化.
 *
 * 数据流: Web 端 IndexedDB 写入 -> JSBridge 镜像 -> ArkTS 端 MemoryCardStore.upsertCard.
 * ArkTS 端为单向镜像 (只接收 Web 端写入, 不回写), 服务卡片 (ReviewCardWidget) 通过
 * CardDataProvider 读取本 store 展示到期卡片数与词位.
 *
 * 单例模式: 全局唯一实例, 由 HarmonyBridge constructor / CardDataProvider 共享.
 * 所有方法 try/catch 兜底, 异常返回空值/0/空数组, 不抛错 (ArkTS 侧异常不传播到调用方).
 */
import { relationalStore } from '@kit.ArkData';
import { common } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { BusinessError } from '@kit.BasicServicesKit';
import {
  TABLE_NAME,
  STORE_NAME,
  CREATE_TABLE_SQL,
  CREATE_INDEX_SQL_DUE,
  CREATE_INDEX_SQL_LAST_REVIEW,
  CREATE_INDEX_SQL_LANGUAGE,
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
  MemoryCardRecord,
  TodayReviewStats,
} from './MemoryCardSchema';

const DOMAIN: number = 0x0001;
const TAG: string = 'MemoryCardStore';

export class MemoryCardStore {
  private static instance: MemoryCardStore | null = null;
  private rdbStore: relationalStore.RdbStore | null = null;
  private initDone: boolean = false;
  private initializePromise: Promise<void> | null = null;

  private constructor() {}

  static getInstance(): MemoryCardStore {
    if (MemoryCardStore.instance === null) {
      MemoryCardStore.instance = new MemoryCardStore();
    }
    return MemoryCardStore.instance;
  }

  /**
   * 初始化 RDB store 并创建表 (IF NOT EXISTS).
   * 幂等: 并发调用共享同一个 initializePromise, 完成后直接复用 store.
   */
  initialize(context: common.Context): Promise<void> {
    if (this.initDone && this.rdbStore !== null) {
      return Promise.resolve();
    }
    if (this.initializePromise !== null) {
      return this.initializePromise;
    }
    this.initializePromise = this.initializeStore(context);
    return this.initializePromise;
  }

  private async initializeStore(context: common.Context): Promise<void> {
    try {
      const config: relationalStore.StoreConfig = {
        name: STORE_NAME,
        securityLevel: relationalStore.SecurityLevel.S1,
      };
      const store: relationalStore.RdbStore =
        await relationalStore.getRdbStore(context, config);
      await store.executeSql(CREATE_TABLE_SQL);
      await store.executeSql(CREATE_INDEX_SQL_DUE);
      await store.executeSql(CREATE_INDEX_SQL_LAST_REVIEW);
      await store.executeSql(CREATE_INDEX_SQL_LANGUAGE);
      this.rdbStore = store;
      this.initDone = true;
      hilog.info(DOMAIN, TAG, 'initialize done: store=%{public}s table=%{public}s', STORE_NAME, TABLE_NAME);
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'initialize failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
      // 异常兜底: rdbStore 保持 null, 后续操作返回空值
      this.rdbStore = null;
      this.initDone = false;
    } finally {
      this.initializePromise = null;
    }
  }

  private async getReadyStore(operation: string): Promise<relationalStore.RdbStore | null> {
    const pendingInitialize: Promise<void> | null = this.initializePromise;
    if (pendingInitialize !== null) {
      await pendingInitialize;
    }
    if (!this.initDone || this.rdbStore === null) {
      hilog.warn(
        DOMAIN,
        TAG,
        '%{public}s: store not initialized',
        operation
      );
      return null;
    }
    return this.rdbStore;
  }

  /**
   * 统一 ResultSet 生命周期: 执行查询 -> 交由 consume 消费 -> finally close.
   *
   * 替代各查询方法内重复的 "try { ... } catch { throw } finally { close }" 样板:
   * - consume 抛出的异常原样上抛, 由各方法自身的 catch 兜底为安全默认值;
   * - close 失败不得覆盖业务异常, 仅降级为 warn 日志.
   *
   * @param args 绑定参数; 无参查询传 null (走 querySql(sql) 重载).
   */
  private async withResultSet<T>(
    store: relationalStore.RdbStore,
    sql: string,
    args: relationalStore.ValueType[] | null,
    consume: (resultSet: relationalStore.ResultSet) => T
  ): Promise<T> {
    const resultSet: relationalStore.ResultSet = args === null
      ? await store.querySql(sql)
      : await store.querySql(sql, args);
    try {
      return consume(resultSet);
    } finally {
      try {
        resultSet.close();
      } catch (e) {
        const err: BusinessError = e as BusinessError;
        hilog.warn(
          DOMAIN,
          TAG,
          'resultSet.close failed: code=%{public}d msg=%{public}s',
          err.code,
          err.message
        );
      }
    }
  }

  /**
   * 插入或替换卡片 (INSERT OR REPLACE, 按 id 主键冲突替换).
   * 参数化 SQL 防注入; 字段顺序与 MemoryCardRecord 一致.
   */
  async upsertCard(card: MemoryCardRecord): Promise<void> {
    try {
      const store: relationalStore.RdbStore | null =
        await this.getReadyStore('upsertCard');
      if (store === null) {
        return;
      }
      const sql: string =
        `INSERT OR REPLACE INTO ${TABLE_NAME} (` +
        `${COLUMN_ID}, ${COLUMN_LEXEME_GROUP_ID}, ${COLUMN_LEMMA}, ` +
        `${COLUMN_OBJECTIVE_DIFFICULTY}, ${COLUMN_LANGUAGE}, ${COLUMN_FIRST_LEARNED_AT}, ` +
        `${COLUMN_LAST_REVIEW_AT}, ${COLUMN_DUE}, ${COLUMN_STABILITY}, ${COLUMN_DIFFICULTY}, ` +
        `${COLUMN_ELAPSED_DAYS}, ${COLUMN_SCHEDULED_DAYS}, ${COLUMN_REPS}, ${COLUMN_LAPSES}, ` +
        `${COLUMN_STATUS}, ${COLUMN_LEARNING_STEPS}` +
        `) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      const args: relationalStore.ValueType[] = [
        card.id,
        card.lexemeGroupId,
        card.lemma,
        card.objectiveDifficulty,
        card.language,
        card.firstLearnedAt,
        card.lastReviewAt,
        card.due,
        card.stability,
        card.difficulty,
        card.elapsedDays,
        card.scheduledDays,
        card.reps,
        card.lapses,
        card.status,
        card.learningSteps,
      ];
      await store.executeSql(sql, args);
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'upsertCard failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
    }
  }

  /**
   * 查询到期卡片数 (due <= now).
   * 异常返回 0.
   */
  async getDueCardsCount(now: number): Promise<number> {
    try {
      const store: relationalStore.RdbStore | null =
        await this.getReadyStore('getDueCardsCount');
      if (store === null) {
        return 0;
      }
      const sql: string =
        `SELECT COUNT(*) AS cnt FROM ${TABLE_NAME} WHERE ${COLUMN_DUE} <= ?`;
      return await this.withResultSet<number>(store, sql, [now],
        (resultSet: relationalStore.ResultSet): number => {
          let count: number = 0;
          if (resultSet.goToFirstRow()) {
            const idx: number = resultSet.getColumnIndex('cnt');
            if (idx >= 0) {
              count = resultSet.getLong(idx);
            }
          }
          return count;
        });
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'getDueCardsCount failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
      return 0;
    }
  }

  /**
   * 查询到期卡片列表 (due <= now, 按 due 升序, LIMIT limit).
   * 异常返回空数组.
   */
  async getDueCards(now: number, limit: number): Promise<MemoryCardRecord[]> {
    try {
      const store: relationalStore.RdbStore | null =
        await this.getReadyStore('getDueCards');
      if (store === null) {
        return [];
      }
      const sql: string =
        `SELECT * FROM ${TABLE_NAME} WHERE ${COLUMN_DUE} <= ? ` +
        `ORDER BY ${COLUMN_DUE} ASC LIMIT ?`;
      return await this.withResultSet<MemoryCardRecord[]>(store, sql, [now, limit],
        (resultSet: relationalStore.ResultSet): MemoryCardRecord[] => {
          const cards: MemoryCardRecord[] = [];
          while (resultSet.goToNextRow()) {
            cards.push(this.mapRow(resultSet));
          }
          return cards;
        });
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'getDueCards failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
      return [];
    }
  }

  /**
   * 删除指定词位组的卡片 (Web Map key 为 lexemeGroupId).
   */
  async deleteCardByLexemeGroupId(lexemeGroupId: string): Promise<void> {
    try {
      const store: relationalStore.RdbStore | null =
        await this.getReadyStore('deleteCardByLexemeGroupId');
      if (store === null) {
        return;
      }
      const sql: string = `DELETE FROM ${TABLE_NAME} WHERE ${COLUMN_LEXEME_GROUP_ID} = ?`;
      await store.executeSql(sql, [lexemeGroupId]);
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'deleteCardByLexemeGroupId failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
    }
  }

  /**
   * 清空表 (测试用).
   */
  async clear(): Promise<void> {
    try {
      const store: relationalStore.RdbStore | null =
        await this.getReadyStore('clear');
      if (store === null) {
        return;
      }
      const sql: string = `DELETE FROM ${TABLE_NAME}`;
      await store.executeSql(sql);
      hilog.info(DOMAIN, TAG, 'clear done: table=%{public}s', TABLE_NAME);
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'clear failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
    }
  }

  /**
   * 查询全部卡片 (按 due 升序).
   *
   * 用于 Web 端 onRehydrateStorage 从鸿蒙 relationalStore 恢复卡片 (R-1 闭环).
   * 异常返回空数组.
   */
  async getAllCards(): Promise<MemoryCardRecord[]> {
    try {
      const store: relationalStore.RdbStore | null =
        await this.getReadyStore('getAllCards');
      if (store === null) {
        return [];
      }
      const sql: string =
        `SELECT * FROM ${TABLE_NAME} ORDER BY ${COLUMN_DUE} ASC`;
      return await this.withResultSet<MemoryCardRecord[]>(store, sql, null,
        (resultSet: relationalStore.ResultSet): MemoryCardRecord[] => {
          const cards: MemoryCardRecord[] = [];
          while (resultSet.goToNextRow()) {
            cards.push(this.mapRow(resultSet));
          }
          return cards;
        });
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'getAllCards failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
      return [];
    }
  }

  /**
   * 查询最近复习过的卡片 (lastReviewAt > 0, 按 lastReviewAt 降序, LIMIT ?).
   *
   * 用于 Web 端 dashboard 展示最近复习记录. 异常返回空数组.
   */
  async getRecentlyReviewedCards(limit: number): Promise<MemoryCardRecord[]> {
    try {
      const store: relationalStore.RdbStore | null =
        await this.getReadyStore('getRecentlyReviewedCards');
      if (store === null) {
        return [];
      }
      const sql: string =
        `SELECT * FROM ${TABLE_NAME} WHERE ${COLUMN_LAST_REVIEW_AT} > 0 ` +
        `ORDER BY ${COLUMN_LAST_REVIEW_AT} DESC LIMIT ?`;
      return await this.withResultSet<MemoryCardRecord[]>(store, sql, [limit],
        (resultSet: relationalStore.ResultSet): MemoryCardRecord[] => {
          const cards: MemoryCardRecord[] = [];
          while (resultSet.goToNextRow()) {
            cards.push(this.mapRow(resultSet));
          }
          return cards;
        });
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'getRecentlyReviewedCards failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
      return [];
    }
  }

  /**
   * 查询今日复习统计 (优化: 3 次查询合并为 1 次子查询).
   *
   * 单条 SQL 用子查询同时计算 3 个 COUNT, 减少到 1 次 querySql 调用:
   * - dueCount: WHERE due <= now (待复习)
   * - reviewedCount: WHERE lastReviewAt >= todayStart (今日已复习)
   * - totalCount: COUNT(*) (总卡片数)
   *
   * todayStart 计算: new Date(now).setHours(0,0,0,0) (本地午夜).
   * 异常返回默认 stats {dueCount:0, reviewedCount:0, totalCount:0}.
   */
  async getTodayReviewStats(now: number): Promise<TodayReviewStats> {
    const defaultStats: TodayReviewStats = {
      dueCount: 0,
      reviewedCount: 0,
      totalCount: 0,
    };
    try {
      const store: relationalStore.RdbStore | null =
        await this.getReadyStore('getTodayReviewStats');
      if (store === null) {
        return defaultStats;
      }
      // 本地午夜 (今日 00:00:00.000)
      const todayStart: number = new Date(now).setHours(0, 0, 0, 0);

      // 单次查询用子查询同时计算 3 个 COUNT (减少 3 次 querySql 到 1 次)
      const sql: string =
        `SELECT ` +
        `(SELECT COUNT(*) FROM ${TABLE_NAME} WHERE ${COLUMN_DUE} <= ?) AS dueCount, ` +
        `(SELECT COUNT(*) FROM ${TABLE_NAME} WHERE ${COLUMN_LAST_REVIEW_AT} >= ?) AS reviewedCount, ` +
        `(SELECT COUNT(*) FROM ${TABLE_NAME}) AS totalCount`;
      return await this.withResultSet<TodayReviewStats>(store, sql, [now, todayStart],
        (resultSet: relationalStore.ResultSet): TodayReviewStats => {
          let dueCount: number = 0;
          let reviewedCount: number = 0;
          let totalCount: number = 0;
          if (resultSet.goToFirstRow()) {
            const dueIdx: number = resultSet.getColumnIndex('dueCount');
            const reviewedIdx: number = resultSet.getColumnIndex('reviewedCount');
            const totalIdx: number = resultSet.getColumnIndex('totalCount');
            if (dueIdx >= 0) {
              dueCount = resultSet.getLong(dueIdx);
            }
            if (reviewedIdx >= 0) {
              reviewedCount = resultSet.getLong(reviewedIdx);
            }
            if (totalIdx >= 0) {
              totalCount = resultSet.getLong(totalIdx);
            }
          }
          const stats: TodayReviewStats = {
            dueCount,
            reviewedCount,
            totalCount,
          };
          return stats;
        });
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'getTodayReviewStats failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
      return defaultStats;
    }
  }

  /**
   * 按 ID 查询单张卡片.
   *
   * 用于 Web 端定向恢复指定卡片 (如 deep link 打开卡片). 异常返回 null.
   */
  async getCardById(id: string): Promise<MemoryCardRecord | null> {
    try {
      const store: relationalStore.RdbStore | null =
        await this.getReadyStore('getCardById');
      if (store === null) {
        return null;
      }
      const sql: string = `SELECT * FROM ${TABLE_NAME} WHERE ${COLUMN_ID} = ?`;
      return await this.withResultSet<MemoryCardRecord | null>(store, sql, [id],
        (resultSet: relationalStore.ResultSet): MemoryCardRecord | null => {
          let card: MemoryCardRecord | null = null;
          if (resultSet.goToFirstRow()) {
            card = this.mapRow(resultSet);
          }
          return card;
        });
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'getCardById failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
      return null;
    }
  }

  /**
   * 将 ResultSet 当前行映射为 MemoryCardRecord.
   * 按列名读取 (getColumnIndex), 类型与 RDB schema 一致.
   */
  private mapRow(rs: relationalStore.ResultSet): MemoryCardRecord {
    try {
      const card: MemoryCardRecord = {
        id: rs.getString(rs.getColumnIndex(COLUMN_ID)),
        lexemeGroupId: rs.getString(rs.getColumnIndex(COLUMN_LEXEME_GROUP_ID)),
        lemma: rs.getString(rs.getColumnIndex(COLUMN_LEMMA)),
        objectiveDifficulty: rs.getLong(rs.getColumnIndex(COLUMN_OBJECTIVE_DIFFICULTY)),
        language: rs.getString(rs.getColumnIndex(COLUMN_LANGUAGE)),
        firstLearnedAt: rs.getLong(rs.getColumnIndex(COLUMN_FIRST_LEARNED_AT)),
        lastReviewAt: rs.getLong(rs.getColumnIndex(COLUMN_LAST_REVIEW_AT)),
        due: rs.getLong(rs.getColumnIndex(COLUMN_DUE)),
        stability: rs.getDouble(rs.getColumnIndex(COLUMN_STABILITY)),
        difficulty: rs.getDouble(rs.getColumnIndex(COLUMN_DIFFICULTY)),
        elapsedDays: rs.getLong(rs.getColumnIndex(COLUMN_ELAPSED_DAYS)),
        scheduledDays: rs.getLong(rs.getColumnIndex(COLUMN_SCHEDULED_DAYS)),
        reps: rs.getLong(rs.getColumnIndex(COLUMN_REPS)),
        lapses: rs.getLong(rs.getColumnIndex(COLUMN_LAPSES)),
        status: rs.getString(rs.getColumnIndex(COLUMN_STATUS)),
        learningSteps: rs.getLong(rs.getColumnIndex(COLUMN_LEARNING_STEPS)),
      };
      return card;
    } catch (e) {
      // ArkTS requires explicit handling for ResultSet getters; preserve the error.
      const error: Error = e as Error;
      throw error;
    }
  }
}
