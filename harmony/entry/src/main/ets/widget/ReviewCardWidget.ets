/**
 * Wordaydream 复习服务卡片 UI。
 *
 * 支持尺寸:
 * - 2*2: 数字徽章、到期文案和复习入口。
 * - 2*4: 在紧凑布局上增加词位、今日进度和更新时间。
 *
 * 数据由 ReviewCardFormAbility 在卡片提供方进程中读取，再通过 FormBindingData
 * 注入卡片渲染进程的 LocalStorage。卡片 UI 不直接访问 Context、RDB 或 preferences。
 *
 * 多语言:
 * - CTA 文案: zh='开始复习' / en='Start Review' / de='Starten'
 * - UpdatedTime 文案: zh='更新于' / en='Updated' / de='Aktualisiert'
 * - 到期数文案支持 zh/en/de
 * - 非 zh/en/de 默认 en
 *
 * 进度环仅在 2*4 且 totalCount > 0 时显示。
 * - Progress({ type: Ring, value: reviewedCount, total: totalCount })
 * 点击通过 postCardAction router 拉起 EntryAbility，并携带 action=startReview。
 */
/** API 22 formInfo.FormDimension 中的 2*2 / 2*4 数值。 */
const DIMENSION_2_2: number = 2;
const DIMENSION_2_4: number = 3;
const storage: LocalStorage = new LocalStorage();

@Entry(storage)
@Component
struct ReviewCardWidget {
  @LocalStorageProp('dueCount') dueCount: number = 0;
  @LocalStorageProp('nextWord') nextWord: string = '';
  @LocalStorageProp('nextCardId') nextCardId: string = '';
  @LocalStorageProp('lastUpdated') lastUpdated: number = 0;
  @LocalStorageProp('language') language: string = 'en';
  @LocalStorageProp('formDimension') dimension: number = DIMENSION_2_2;
  @LocalStorageProp('reviewedCount') reviewedCount: number = 0;
  @LocalStorageProp('totalCount') totalCount: number = 0;


  /**
   * 触发卡片点击跳转 (router action -> EntryAbility).
   */
  private triggerReview(): void {
    postCardAction(this, {
      'action': 'router',
      'abilityName': 'EntryAbility',
      'params': { 'query': 'action=startReview' },
    });
  }

  /**
   * 触发打开指定卡片 (router action -> EntryAbility).
   * nextCardId 非空时携带 action=openCard&cardId=<nextCardId> 拉起 EntryAbility;
   * 为空 (无到期卡 / 数据未就绪) 时回退到 triggerReview (action=startReview).
   */
  private triggerOpenCard(): void {
    if (this.nextCardId.length > 0) {
      postCardAction(this, {
        'action': 'router',
        'abilityName': 'EntryAbility',
        'params': { 'query': 'action=openCard&cardId=' + this.nextCardId },
      });
    } else {
      this.triggerReview();
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

  private formatDueCountText(): string {
    if (this.language === 'zh') {
      if (this.dueCount === 0) {
        return '暂无到期';
      }
      if (this.dueCount === 1) {
        return '1 个到期';
      }
      return `${this.dueCount} 个到期`;
    }
    if (this.language === 'de') {
      if (this.dueCount === 0) {
        return 'Keine Karten';
      }
      if (this.dueCount === 1) {
        return '1 Karte fällig';
      }
      return `${this.dueCount} Karten fällig`;
    }
    if (this.dueCount === 0) {
      return 'No cards';
    }
    return this.dueCount === 1
      ? '1 card due'
      : `${this.dueCount} cards due`;
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
    Text(this.formatDueCountText())
      .fontSize(14)
      .fontColor($r('app.color.card_text_secondary'))
      .maxLines(1)
      .textOverflow({ overflow: TextOverflow.Ellipsis })
  }

  @Builder
  NextWordDisplay() {
    if (this.nextWord.length > 0) {
      Text(this.nextWord)
        .fontSize(18)
        .fontWeight(FontWeight.Medium)
        .fontColor($r('app.color.card_text_primary'))
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
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
    if (this.totalCount > 0) {
      Progress({
        type: ProgressType.Ring,
        value: this.reviewedCount,
        total: this.totalCount,
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
          .onClick(() => {
            this.triggerOpenCard();
          })

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
