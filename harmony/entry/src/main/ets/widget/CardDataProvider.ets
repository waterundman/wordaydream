/**
 * CardDataProvider (v0.1.0-harmony Stage 6, v0.2.0-harmony Stage 4 扩展)
 *
 * 服务卡片数据提供者, 封装 MemoryCardStore 查询, 供 ReviewCardWidget 使用.
 *
 * 职责:
 * - getDueCardsCountForWidget: 取到期卡片数 (供卡片角标/数字展示)
 * - getNextDueCardForWidget: 取最近到期的 1 张卡片 (供卡片显示词位 lemma)
 * - formatDueCountText: 多语言格式化到期数文案 (zh / en / de)
 * - getTodayReviewStatsForWidget (Stage 4): 今日复习统计 (供进度环)
 * - getLanguage (Stage 4): 读取 app_language preferences (供多语言文案)
 * - getRecentlyReviewedCardsForWidget (Stage 4): 最近复习卡片 (供 2*4 富布局)
 *
 * 单例模式: 全局唯一实例.
 * 异常返回安全默认值 (0 / null / 'en' / []), 不抛错.
 *
 * 注意: 服务卡片可能运行在独立进程, 每次 RDB 查询都会使用自身 Context
 * 等待 MemoryCardStore 初始化完成, 不依赖主应用的 HarmonyBridge 生命周期.
 * Stage 4: getLanguage 需通过 setContext 注入 Context 后才能读取 preferences,
 *   未注入时 fallback 'en'.
 */
import { preferences } from '@kit.ArkData';
import { common } from '@kit.AbilityKit';
import { MemoryCardStore } from '../data/MemoryCardStore';
import { MemoryCardRecord, TodayReviewStats } from '../data/MemoryCardSchema';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { BusinessError } from '@kit.BasicServicesKit';

const DOMAIN: number = 0x0001;
const TAG: string = 'CardDataProvider';
const PREFS_NAME: string = 'wordaydream_prefs';
const LANGUAGE_KEY: string = 'app_language';

/**
 * 服务卡片渲染消费的 FormBindingData 字段 shape (与 ReviewCardWidget 的
 * @LocalStorageProp 字段一一对应). 单一事实来源: ReviewCardFormAbility 与
 * FormRefresher 共用此接口, 保证 updateForm 写入的字段与卡片渲染一致.
 *
 * 字段: dueCount / nextWord / lastUpdated / language / reviewedCount / totalCount
 *   + formDimension? (仅首次 add 时带入, 其余刷新可省略).
 */
export interface ReviewCardFormData {
  dueCount: number;
  nextWord: string;
  lastUpdated: number;
  language: string;
  reviewedCount: number;
  totalCount: number;
  formDimension?: number;
}

export class CardDataProvider {
  private static instance: CardDataProvider | null = null;
  private context: common.Context | null = null;

  private constructor() {}

  static getInstance(): CardDataProvider {
    if (CardDataProvider.instance === null) {
      CardDataProvider.instance = new CardDataProvider();
    }
    return CardDataProvider.instance;
  }

  /**
   * Stage 4: 注入 Context (供 getLanguage 读取 preferences).
   *
   * 由 ReviewCardFormAbility 使用其 FormExtensionContext 注入。
   * 幂等: 重复调用安全 (覆盖旧值).
   */
  setContext(context: common.Context): void {
    this.context = context;
  }

  /** 使用服务卡片进程的 Context 显式初始化并等待 RDB 就绪. */
  private async getMemoryCardStore(): Promise<MemoryCardStore | null> {
    if (this.context === null) {
      hilog.warn(
        DOMAIN,
        TAG,
        'getMemoryCardStore: context not set'
      );
      return null;
    }
    const store: MemoryCardStore = MemoryCardStore.getInstance();
    await store.initialize(this.context);
    return store;
  }

  /**
   * 获取当前到期卡片数 (due <= Date.now()).
   * 异常返回 0.
   */
  async getDueCardsCountForWidget(): Promise<number> {
    try {
      const store: MemoryCardStore | null = await this.getMemoryCardStore();
      if (store === null) {
        return 0;
      }
      const count: number = await store.getDueCardsCount(Date.now());
      return count;
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'getDueCardsCountForWidget failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
      return 0;
    }
  }

  /**
   * 取最近到期的 1 张卡片 (用于卡片显示词位 lemma).
   * 异常或无到期卡片时返回 null.
   */
  async getNextDueCardForWidget(): Promise<MemoryCardRecord | null> {
    try {
      const store: MemoryCardStore | null = await this.getMemoryCardStore();
      if (store === null) {
        return null;
      }
      const cards: MemoryCardRecord[] = await store.getDueCards(Date.now(), 1);
      if (cards.length === 0) {
        return null;
      }
      return cards[0];
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'getNextDueCardForWidget failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
      return null;
    }
  }

  /**
   * 多语言格式化到期数文案.
   *
   * @param count 到期卡片数
   * @param language 语言代码: 'zh' | 'en' | 'de' (默认 'en')
   * @returns 格式化后的文案
   *
   * 文案规则:
   *   zh: 0 -> '暂无到期', 1 -> '1 个到期', n -> '${n} 个到期'
   *   en: 0 -> 'No cards', 1 -> '1 card due', n -> '${n} cards due'
   *   de: 0 -> 'Keine Karten', 1 -> '1 Karte fällig', n -> '${n} Karten fällig'
   */
  formatDueCountText(count: number, language: string = 'en'): string {
    if (language === 'zh') {
      if (count === 0) {
        return '暂无到期';
      }
      if (count === 1) {
        return '1 个到期';
      }
      return `${count} 个到期`;
    }
    if (language === 'de') {
      if (count === 0) {
        return 'Keine Karten';
      }
      if (count === 1) {
        return '1 Karte fällig';
      }
      return `${count} Karten fällig`;
    }
    // 默认 en
    if (count === 0) {
      return 'No cards';
    }
    if (count === 1) {
      return '1 card due';
    }
    return `${count} cards due`;
  }

  /**
   * Stage 4: 查询今日复习统计 (供服务卡片进度环展示).
   *
   * 调用 MemoryCardStore.getInstance().getTodayReviewStats(Date.now()).
   * 异常返回 {dueCount:0, reviewedCount:0, totalCount:0}.
   */
  async getTodayReviewStatsForWidget(): Promise<TodayReviewStats> {
    const defaultStats: TodayReviewStats = {
      dueCount: 0,
      reviewedCount: 0,
      totalCount: 0,
    };
    try {
      const store: MemoryCardStore | null = await this.getMemoryCardStore();
      if (store === null) {
        return defaultStats;
      }
      const stats: TodayReviewStats = await store.getTodayReviewStats(Date.now());
      return stats;
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'getTodayReviewStatsForWidget failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
      return defaultStats;
    }
  }

  /**
   * Stage 4: 读取应用语言 (供服务卡片多语言文案).
   *
   * 从 preferences 'app_language' 读取 (默认 'en').
   * 仅接受 'zh' | 'en' | 'de' 三个值, 其他值 fallback 'en'.
   * 异常或未注入 Context 时返回 'en'.
   */
  async getLanguage(): Promise<string> {
    try {
      if (this.context === null) {
        return 'en';
      }
      const prefs: preferences.Preferences =
        await preferences.getPreferences(this.context, PREFS_NAME);
      const exists: boolean = await prefs.has(LANGUAGE_KEY);
      if (!exists) {
        return 'en';
      }
      // API 22: prefs.get 返回 ValueType 联合类型, 需 typeof 收窄到 string.
      const raw: preferences.ValueType = await prefs.get(LANGUAGE_KEY, '');
      const value: string = typeof raw === 'string' ? raw : '';
      if (value === 'zh' || value === 'en' || value === 'de') {
        return value;
      }
      return 'en';
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'getLanguage failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
      return 'en';
    }
  }

  /**
   * Stage 4: 查询最近复习过的卡片 (供 2*4 服务卡片富布局展示).
   *
   * 调用 MemoryCardStore.getInstance().getRecentlyReviewedCards(limit).
   * 异常返回 [].
   */
  async getRecentlyReviewedCardsForWidget(limit: number): Promise<MemoryCardRecord[]> {
    try {
      const store: MemoryCardStore | null = await this.getMemoryCardStore();
      if (store === null) {
        return [];
      }
      const cards: MemoryCardRecord[] = await store.getRecentlyReviewedCards(limit);
      return cards;
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'getRecentlyReviewedCardsForWidget failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
      return [];
    }
  }

  /**
   * Stage 2: 组装服务卡片 FormBindingData (供 refreshForm 与 refreshAllForms 共用).
   *
   * 复用既有查询: 到期数 / 语言 / 今日统计 / 最近到期卡片的 lemma.
   * 所有查询异常均被各方法自身兜底 (返回 0 / null / 'en' / 默认统计), 因此
   * 这里组装的数据始终安全可用.
   *
   * @param dimension 可选卡片尺寸, 仅在首次 add 时一并下发.
   * @returns ReviewCardFormData (与 ReviewCardWidget 消费字段一致).
   */
  async getWidgetFormData(dimension?: number): Promise<ReviewCardFormData> {
    const dueCount: number = await this.getDueCardsCountForWidget();
    const language: string = await this.getLanguage();
    const todayStats: TodayReviewStats =
      await this.getTodayReviewStatsForWidget();
    const nextCard: MemoryCardRecord | null =
      await this.getNextDueCardForWidget();
    const data: ReviewCardFormData = {
      dueCount,
      nextWord: nextCard === null ? '' : nextCard.lemma,
      lastUpdated: Date.now(),
      language,
      reviewedCount: todayStats.reviewedCount,
      totalCount: todayStats.totalCount,
    };
    if (dimension !== undefined) {
      data.formDimension = dimension;
    }
    return data;
  }
}
