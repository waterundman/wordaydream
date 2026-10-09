/**
 * CardBridgeDelegate (v1.6.3 S1 — B1 上帝文件拆分)
 *
 * RDB 卡片域委托: Web → 鸿蒙 relationalStore 镜像 (upsert / delete / 查询).
 * 由 HarmonyBridge facade 持有并转发; 桥接契约面 (方法名/签名) 不变,
 * BridgeMethodRegistry.ets 仍是唯一方法真源.
 *
 * 实现状态:
 * - getDueCardsCount: MemoryCardStore.getDueCardsCount(Date.now()) 读取 RDB
 *   (wordaydream_memory.db / wordaydream_memory_cards 表, WHERE due <= now).
 * - getAllCards / getRecentlyReviewedCards / getTodayReviewStats: 返回 JSON 字符串
 *   (v1.6.0 D1 API 22 实机契约: async JSProxy 复杂返回值不可跨桥, 基本类型 string 可靠).
 *
 * context 由 facade 的 refreshContext 同源刷新, 委托不自持陈旧 context.
 * Contract: 所有方法 try/catch 兜底, 异常返回空值/0/'[]' 不抛错 (异常不传播到 Web).
 */
import { hilog } from '@kit.PerformanceAnalysisKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { common } from '@kit.AbilityKit';
import type { MemoryCardRecord, TodayReviewStats } from '../../data/MemoryCardSchema';
import { MemoryCardStore } from '../../data/MemoryCardStore';
import { BridgeInputValidator } from '../BridgeInputValidator';

const DOMAIN: number = 0x0001;
const TAG: string = 'HarmonyBridge';

export class CardBridgeDelegate {
  private context: common.Context;

  constructor(context: common.Context) {
    this.context = context;
  }

  /**
   * 由 facade.refreshContext 同源刷新 (换引用后不保留旧 context).
   * 调用点: HarmonyBridge.refreshContext — 与 facade 同一刷新源, 委托不自行监听.
   */
  refreshContext(newContext: common.Context): void {
    this.context = newContext;
  }

  /** 每次 RDB 操作均等待共享初始化任务，首次失败时允许后续调用重试. */
  private async getMemoryCardStore(): Promise<MemoryCardStore> {
    const store: MemoryCardStore = MemoryCardStore.getInstance();
    await store.initialize(this.context);
    return store;
  }

  /**
   * 获取当前到期卡片数 (供首页角标 / 通知展示).
   *
   * 实现真实 MemoryCardStore.getDueCardsCount(Date.now()) 读取 RDB
   * (wordaydream_memory_cards 表, WHERE due <= now). 异常兜底返回 0.
   */
  async getDueCardsCount(): Promise<number> {
    try {
      const store: MemoryCardStore = await this.getMemoryCardStore();
      const count: number =
        await store.getDueCardsCount(Date.now());
      hilog.info(
        DOMAIN,
        TAG,
        'getDueCardsCount (Stage 6) -> %{public}d',
        count
      );
      return count;
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
   * 指定时刻的到期卡片数 (非桥接契约, 不进 BridgeMethodRegistry).
   *
   * 供通知域 (NotifyBridgeDelegate.registerReminder / scheduleReviewReminder) 复用
   * 同一条 store 访问路径, 避免在委托间复制 RDB 初始化等待逻辑.
   * 不吞异常: 调用方 (通知域方法) 自带 try/catch 兜底, 与拆分前语义一致.
   */
  async getDueCardsCountAt(timestamp: number): Promise<number> {
    const store: MemoryCardStore = await this.getMemoryCardStore();
    return await store.getDueCardsCount(timestamp);
  }

  /**
   * Web → 鸿蒙 relationalStore 镜像 (upsert).
   *
   * 1. 校验 16 字段 (BridgeInputValidator.validateCardRecord), 失败 hilog.warn + return.
   * 2. 调用 MemoryCardStore.upsertCard (INSERT OR REPLACE).
   * 3. hilog.debug 记录成功日志.
   */
  async upsertCard(card: MemoryCardRecord): Promise<void> {
    try {
      if (!BridgeInputValidator.validateCardRecord(card)) {
        hilog.warn(
          DOMAIN,
          TAG,
          'upsertCard rejected: invalid card (id=%{public}s)',
          card?.id ?? ''
        );
        return;
      }
      const store: MemoryCardStore = await this.getMemoryCardStore();
      await store.upsertCard(card);
      hilog.debug(
        DOMAIN,
        TAG,
        'upsertCard done: id=%{public}s due=%{public}d',
        card.id,
        card.due
      );
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
   * Web → 鸿蒙 relationalStore 镜像 (delete).
   *
   * Web 传入的键是 MemoryCard Map key (lexemeGroupId), 并非 RDB 主键 id.
   * 1. 校验 lexemeGroupId (复用 ID 格式校验), 失败 hilog.warn + return.
   * 2. 调用 MemoryCardStore.deleteCardByLexemeGroupId.
   * 3. hilog.debug 记录成功日志.
   */
  async deleteCard(lexemeGroupId: string): Promise<void> {
    try {
      if (!BridgeInputValidator.validateCardId(lexemeGroupId)) {
        hilog.warn(
          DOMAIN,
          TAG,
          'deleteCard rejected: invalid lexemeGroupId'
        );
        return;
      }
      const store: MemoryCardStore = await this.getMemoryCardStore();
      await store.deleteCardByLexemeGroupId(lexemeGroupId);
      hilog.debug(
        DOMAIN,
        TAG,
        'deleteCard done: lexemeGroupId=%{public}s',
        lexemeGroupId
      );
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'deleteCard failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
    }
  }

  /**
   * 鸿蒙 → Web 卡片恢复 (R-1 闭环核心).
   *
   * 返回所有卡片 (按 due 升序) 的 JSON 字符串, 供 Web 端 onRehydrateStorage 在
   * localStorage 为空时调用恢复. 异常返回 '[]'.
   *
   * v1.6.0 D1 实机契约 (API 22 模拟器实测): async JSProxy 复杂返回值
   * (对象/数组) 无法跨桥 — Web 端 Promise resolve 得到 number (原生 count=5,
   * Web rawType=number cards=0). 基本类型 string 可靠传输, 故统一序列化为
   * JSON 字符串; Web 侧 parseBridgeRecords 兼容解析 (useMemoryStore.ts).
   * getRecentlyReviewedCards / getTodayReviewStats / getSpeechEngines 同契约.
   */
  async getAllCards(): Promise<string> {
    try {
      const store: MemoryCardStore = await this.getMemoryCardStore();
      const cards: MemoryCardRecord[] =
        await store.getAllCards();
      hilog.info(
        DOMAIN,
        TAG,
        'getAllCards done: count=%{public}d',
        cards.length
      );
      return JSON.stringify(cards);
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'getAllCards failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
      return '[]';
    }
  }

  /**
   * 全量卡片数组 (非桥接契约, 不进 BridgeMethodRegistry).
   *
   * 供 facade pushCardsToWeb (v1.6.0 D1 R-1 恢复推送) 复用同一条 RDB 访问路径,
   * 由 facade 自行 JSON 序列化 + runJavaScript 派发. 不吞异常: 调用方
   * (pushCardsToWeb) 自带 try/catch 兜底, 与拆分前语义一致.
   */
  async getAllCardsRaw(): Promise<MemoryCardRecord[]> {
    const store: MemoryCardStore = await this.getMemoryCardStore();
    return await store.getAllCards();
  }

  /**
   * 查询最近复习过的卡片 (Web 端 dashboard 展示).
   *
   * 1. 校验 limit: Number.isInteger(limit) && limit > 0 && limit <= 100, 失败返回 '[]'.
   * 2. 调用 MemoryCardStore.getRecentlyReviewedCards(limit).
   * 3. 返回 JSON 字符串 (v1.6.0 D1: 与 getAllCards 同契约, 异常返回 '[]').
   */
  async getRecentlyReviewedCards(limit: number): Promise<string> {
    try {
      if (
        !Number.isInteger(limit) ||
        limit <= 0 ||
        limit > 100
      ) {
        hilog.warn(
          DOMAIN,
          TAG,
          'getRecentlyReviewedCards rejected: invalid limit=%{public}d',
          limit
        );
        return '[]';
      }
      const store: MemoryCardStore = await this.getMemoryCardStore();
      const cards: MemoryCardRecord[] =
        await store.getRecentlyReviewedCards(limit);
      hilog.info(
        DOMAIN,
        TAG,
        'getRecentlyReviewedCards done: limit=%{public}d count=%{public}d',
        limit,
        cards.length
      );
      return JSON.stringify(cards);
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'getRecentlyReviewedCards failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
      return '[]';
    }
  }

  /**
   * 查询今日复习统计 (服务卡片进度环 + Web dashboard).
   *
   * 调用 MemoryCardStore.getTodayReviewStats(Date.now()).
   * 返回 TodayReviewStats 的 JSON 字符串 (v1.6.0 D1 契约), 异常返回默认值 JSON.
   */
  async getTodayReviewStats(): Promise<string> {
    const defaultStats: TodayReviewStats = {
      dueCount: 0,
      reviewedCount: 0,
      totalCount: 0,
    };
    try {
      const store: MemoryCardStore = await this.getMemoryCardStore();
      const stats: TodayReviewStats =
        await store.getTodayReviewStats(Date.now());
      hilog.info(
        DOMAIN,
        TAG,
        'getTodayReviewStats done: due=%{public}d reviewed=%{public}d total=%{public}d',
        stats.dueCount,
        stats.reviewedCount,
        stats.totalCount
      );
      return JSON.stringify(stats);
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'getTodayReviewStats failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
      return JSON.stringify(defaultStats);
    }
  }
}