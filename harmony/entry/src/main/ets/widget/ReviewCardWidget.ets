/**
 * ReviewCardWidget (v0.1.0-harmony Stage 6, v0.2.0-harmony Stage 4 富化)
 *
 * ArkUI 服务卡片组件 (桌面卡片), 展示到期复习卡片数与最近到期词位.
 *
 * 支持尺寸 (Stage 4 新增分支):
 * - 2*2: 数字徽章 + 到期文案 + CTA (紧凑布局, 不展示词位 / 进度环 / 更新时间)
 * - 2*4: 数字徽章 + 到期文案 + 词位 + 进度环 + CTA + 更新时间 (富布局)
 *
 * 多语言 (Stage 4 新增):
 * - CTA 文案: zh='开始复习' / en='Start Review' / de='Starten'
 * - UpdatedTime 文案: zh='更新于' / en='Updated' / de='Aktualisiert'
 * - DueCountText: 复用 CardDataProvider.formatDueCountText (已支持 zh/en/de)
 * - 非 zh/en/de 默认 en
 *
 * 进度环 (Stage 4 新增, 仅 2*4):
 * - Progress({ type: Ring, value: reviewedCount, total: totalCount })
 * - total=0 时不渲染 (避免除零)
 *
 * 数据来源: CardDataProvider -> MemoryCardStore (relationalStore).
 * 卡片点击: postCardAction router 跳转到 EntryAbility, 携带 query=action=startReview,
 *   由 EntryAbility.onNewWant -> HarmonyBridge.handleHarmonyLaunch 派发到 ArkWeb 跳转复习页.
 *
 * 刷新策略 (Stage 4 增强):
 * - 系统调度: form_config.json updateDuration=1 (约 60 分钟一次) 作为兜底.
 * - aboutToAppear: 主动拉取一次最新数据.
 * - 实时刷新 (Stage 4): emitter 监听 'wordaydream_widget_refresh' 事件,
 *   由 EntryAbility.onNewWant 在 action=startReview 等场景 emit.
 *   5 分钟节流 (鸿蒙系统 updateForm 限制).
 *   真机验证项: emitter 跨进程 (EntryAbility ↔ widget host) 是否生效,
 *     若不生效需改用 commonEventManager + FormExtensionAbility 订阅.
 */
import { postCardAction, formBindingData } from '@kit.FormKit';
import { emitter } from '@kit.BasicServicesKit';
import { common } from '@kit.AbilityKit';
import { CardDataProvider } from './CardDataProvider';
import { TodayReviewStats } from '../data/MemoryCardSchema';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { BusinessError } from '@kit.BasicServicesKit';

const DOMAIN: number = 0x0001;
const TAG: string = 'ReviewCardWidget';

/** emitter event id (EntryAbility.onNewWant 与本组件约定). */
const WIDGET_REFRESH_EVENT_ID: number = 10001;

/** 5 分钟节流 (鸿蒙系统 updateForm 限制). */
const WIDGET_REFRESH_THROTTLE_MS: number = 5 * 60 * 1000;

/** FormDimensionalType 数值常量 (避免依赖枚举命名, 直接用数值). */
const DIMENSION_2_2: number = 2;
const DIMENSION_2_4: number = 3;

@ComponentV2
export struct ReviewCardWidget {
  @LocalV2 dueCount: number = 0;
  @LocalV2 nextWord: string = '';
  @LocalV2 lastUpdated: number = 0;
  @LocalV2 language: string = 'en';
  @LocalV2 dimension: number = DIMENSION_2_2;
  @LocalV2 todayStats: TodayReviewStats = {
    dueCount: 0,
    reviewedCount: 0,
    totalCount: 0,
  };

  private provider: CardDataProvider = CardDataProvider.getInstance();
  private lastRefresh: number = 0;

  async aboutToAppear(): Promise<void> {
    try {
      // Stage 4: 注入 Context 供 provider.getLanguage 读取 preferences.
      // 真机验证项: ArkTS V2 form widget 的 getContext(this) 行为.
      try {
        const ctx: common.Context = getContext(this) as common.Context;
        this.provider.setContext(ctx);
      } catch (ctxErr) {
        const ctxErrTyped: BusinessError = ctxErr as BusinessError;
        hilog.warn(
          DOMAIN,
          TAG,
          'setContext skipped: code=%{public}d msg=%{public}s',
          ctxErrTyped.code,
          ctxErrTyped.message
        );
      }

      // Stage 4: 读取当前卡片尺寸 (formBindingData.getDimension 同步返回数值).
      // 真机验证项: getDimension 在 ArkTS V2 form widget 中的可用性.
      try {
        const dim: number = formBindingData.getDimension();
        if (dim === DIMENSION_2_2 || dim === DIMENSION_2_4) {
          this.dimension = dim;
        }
      } catch (dimErr) {
        const dimErrTyped: BusinessError = dimErr as BusinessError;
        hilog.warn(
          DOMAIN,
          TAG,
          'getDimension fallback to 2*2: code=%{public}d msg=%{public}s',
          dimErrTyped.code,
          dimErrTyped.message
        );
      }

      // 拉取最新数据 (dueCount + language + todayStats + nextWord)
      await this.refreshCardData();

      // Stage 4: 注册 emitter 监听器 (实时刷新, 5min 节流).
      // 系统的 60min updateDuration 作为兜底.
      // 真机验证项: emitter.on 在卡片宿主进程可用性 + 跨进程事件投递.
      try {
        emitter.on({ eventId: WIDGET_REFRESH_EVENT_ID }, () => {
          this.handleRefreshEvent();
        });
      } catch (emitErr) {
        const emitErrTyped: BusinessError = emitErr as BusinessError;
        hilog.warn(
          DOMAIN,
          TAG,
          'emitter.on skipped: code=%{public}d msg=%{public}s',
          emitErrTyped.code,
          emitErrTyped.message
        );
      }
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'aboutToAppear failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
    }
  }

  /**
   * Stage 4: 处理 emitter 刷新事件 (5min 节流).
   * 鸿蒙系统 updateForm 限制: 5 分钟内最多 1 次.
   */
  private handleRefreshEvent(): void {
    const now: number = Date.now();
    if (now - this.lastRefresh < WIDGET_REFRESH_THROTTLE_MS) {
      hilog.warn(DOMAIN, TAG, 'Widget refresh throttled (5min limit), skip');
      return;
    }
    this.lastRefresh = now;
    this.refreshCardData();
  }

  /**
   * Stage 4: 刷新卡片数据 (从 provider 拉取最新值, ArkUI 自动重渲染).
   */
  private async refreshCardData(): Promise<void> {
    try {
      this.dueCount = await this.provider.getDueCardsCountForWidget();
      this.language = await this.provider.getLanguage();
      this.todayStats = await this.provider.getTodayReviewStatsForWidget();
      const card = await this.provider.getNextDueCardForWidget();
      if (card !== null) {
        this.nextWord = card.lemma;
      } else {
        this.nextWord = '';
      }
      this.lastUpdated = Date.now();
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'refreshCardData failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
    }
  }

  /**
   * 触发卡片点击跳转 (router action -> EntryAbility).
   */
  private triggerReview(): void {
    try {
      postCardAction(this, {
        'action': 'router',
        'abilityName': 'EntryAbility',
        'params': { 'query': 'action=startReview' },
      });
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'triggerReview failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
    }
  }

  /**
   * 格式化最近更新时间 (HH:MM).
   */
  private formatUpdateTime(ts: number): string {
    if (ts === 0) {
      return '';
    }
    try {
      const date: Date = new Date(ts);
      const hours: number = date.getHours();
      const minutes: number = date.getMinutes();
      const hh: string = hours < 10 ? `0${hours}` : `${hours}`;
      const mm: string = minutes < 10 ? `0${minutes}` : `${minutes}`;
      return `${hh}:${mm}`;
    } catch (e) {
      return '';
    }
  }

  /**
   * Stage 4: 多语言 CTA 文案.
   * zh='开始复习' / en='Start Review' / de='Starten'.
   * 非 zh/en/de 默认 en.
   */
  private getCtaText(): string {
    if (this.language === 'zh') {
      return '开始复习';
    }
    if (this.language === 'de') {
      return 'Starten';
    }
    return 'Start Review';
  }

  /**
   * Stage 4: 多语言 UpdatedTime 前缀.
   * zh='更新于' / en='Updated' / de='Aktualisiert'.
   * 非 zh/en/de 默认 en.
   */
  private getUpdatedPrefix(): string {
    if (this.language === 'zh') {
      return '更新于';
    }
    if (this.language === 'de') {
      return 'Aktualisiert';
    }
    return 'Updated';
  }

  @Builder
  DueCountBadge() {
    Stack() {
      Text(`${this.dueCount}`)
        .fontSize(32)
        .fontWeight(FontWeight.Bold)
        .fontColor($r('app.color.card_text_primary'))
    }
    .width(64)
    .height(64)
    .borderRadius(32)
    .backgroundColor($r('app.color.card_accent'))
    .alignContent(Alignment.Center)
  }

  @Builder
  DueCountText() {
    Text(this.provider.formatDueCountText(this.dueCount, this.language))
      .fontSize(14)
      .fontColor($r('app.color.card_text_secondary'))
      .maxLines(1)
      .textOverflow(TextOverflow.Ellipsis)
  }

  @Builder
  NextWordDisplay() {
    if (this.nextWord.length > 0) {
      Text(this.nextWord)
        .fontSize(18)
        .fontWeight(FontWeight.Medium)
        .fontColor($r('app.color.card_text_primary'))
        .maxLines(1)
        .textOverflow(TextOverflow.Ellipsis)
    }
  }

  @Builder
  ReviewCta() {
    Button(this.getCtaText())
      .fontSize(14)
      .fontColor($r('app.color.card_cta_text'))
      .backgroundColor($r('app.color.card_cta_background'))
      .borderRadius(20)
      .height(36)
      .onClick(() => {
        this.triggerReview();
      })
  }

  @Builder
  UpdatedTime() {
    if (this.lastUpdated > 0) {
      Text(`${this.getUpdatedPrefix()} ${this.formatUpdateTime(this.lastUpdated)}`)
        .fontSize(10)
        .fontColor($r('app.color.card_text_secondary'))
    }
  }

  /**
   * Stage 4: 进度环 (仅 2*4 尺寸渲染).
   * total=0 时不渲染 (避免除零).
   */
  @Builder
  ProgressRing() {
    if (this.todayStats.totalCount > 0) {
      Progress({
        type: ProgressType.Ring,
        value: this.todayStats.reviewedCount,
        total: this.todayStats.totalCount,
      })
        .color($r('app.color.card_accent'))
        .backgroundColor($r('app.color.card_background'))
        .width(40)
        .height(40)
    }
  }

  build() {
    Column() {
      // 顶部: 标题 + 徽章 (2*2 与 2*4 共用)
      Row() {
        this.DueCountBadge()
        Column() {
          this.DueCountText()
        }
        .margin({ left: 12 })
        .alignItems(HorizontalAlign.Start)
      }
      .width('100%')
      .justifyContent(FlexAlign.Start)
      .alignItems(VerticalAlign.Center)

      if (this.dimension === DIMENSION_2_4) {
        // 2*4 富布局: 词位 + 进度环 + CTA + 更新时间
        Row() {
          Column() {
            this.NextWordDisplay()
          }
          .layoutWeight(1)
          .alignItems(HorizontalAlign.Start)
          .margin({ top: 12 })

          Column() {
            this.ProgressRing()
          }
          .width(40)
          .height(40)
          .margin({ top: 12, left: 12 })
          .alignItems(HorizontalAlign.Center)
          .justifyContent(FlexAlign.Center)
        }
        .width('100%')

        Column() {
          this.ReviewCta()
          this.UpdatedTime()
        }
        .width('100%')
        .margin({ top: 12 })
        .alignItems(HorizontalAlign.Center)
      } else {
        // 2*2 紧凑布局: 仅 CTA (不展示词位 / 进度环 / 更新时间)
        Column() {
          this.ReviewCta()
        }
        .width('100%')
        .margin({ top: 12 })
        .alignItems(HorizontalAlign.Center)
      }
    }
    .width('100%')
    .height('100%')
    .padding(16)
    .backgroundColor($r('app.color.card_background'))
    .alignItems(HorizontalAlign.Start)
    .justifyContent(FlexAlign.SpaceBetween)
  }
}
