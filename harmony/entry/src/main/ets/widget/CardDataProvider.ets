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
 * 注意: MemoryCardStore 需先由 HarmonyBridge constructor 调用 initialize(context)
 * 完成 RDB 初始化; 若未初始化, getDueCardsCount 返回 0, getDueCards 返回空数组.
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
   * 由 ReviewCardWidget.aboutToAppear 调用 getContext(this) as common.Context 注入.
   * 幂等: 重复调用安全 (覆盖旧值).
   * 真机验证项: ArkTS V2 form widget 的 getContext(this) 返回类型实际为
   *   FormExtensionContext, 此处用基类 common.Context 接收, 由 ArkTS 多态保证.
   */
  setContext(context: common.Context): void {
    this.context = context;
  }

  /**
   * 获取当前到期卡片数 (due <= Date.now()).
   * 异常返回 0.
   */
  async getDueCardsCountForWidget(): Promise<number> {
    try {
      const store: MemoryCardStore = MemoryCardStore.getInstance();
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
      const store: MemoryCardStore = MemoryCardStore.getInstance();
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
      const store: MemoryCardStore = MemoryCardStore.getInstance();
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
      const store: MemoryCardStore = MemoryCardStore.getInstance();
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
}
