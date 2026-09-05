import { formBindingData, FormExtensionAbility, formInfo, formProvider } from '@kit.FormKit';
import { Want } from '@kit.AbilityKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { MemoryCardRecord, TodayReviewStats } from '../data/MemoryCardSchema';
import { CardDataProvider } from './CardDataProvider';

const DOMAIN: number = 0x0001;
const TAG: string = 'ReviewCardFormAbility';
const DIMENSION_2_2: number = formInfo.FormDimension.Dimension_2_2;
const DIMENSION_2_4: number = formInfo.FormDimension.Dimension_2_4;

interface ReviewCardFormData {
  dueCount: number;
  nextWord: string;
  lastUpdated: number;
  language: string;
  reviewedCount: number;
  totalCount: number;
  formDimension?: number;
}

/**
 * 服务卡片提供方。
 *
 * FormExtensionAbility 运行在卡片提供方进程，负责读取本地数据并通过
 * FormBindingData 传给卡片渲染进程。卡片 UI 不直接访问 Context 或 RDB。
 */
export default class ReviewCardFormAbility extends FormExtensionAbility {
  private provider: CardDataProvider = CardDataProvider.getInstance();
  private formDimensions: Map<string, number> = new Map<string, number>();

  onAddForm(want: Want): formBindingData.FormBindingData {
    const dimension: number = this.readDimension(want);
    const formId: string = this.readFormId(want);
    if (formId.length > 0) {
      this.formDimensions.set(formId, dimension);
      // onAddForm 必须同步返回；随后异步推送真实 RDB 数据。
      this.refreshForm(formId, dimension);
    }
    return formBindingData.createFormBindingData(this.createDefaultData(dimension));
  }

  onUpdateForm(formId: string): void {
    this.refreshForm(formId, this.formDimensions.get(formId));
  }

  onSizeChanged(
    formId: string,
    newDimension: formInfo.FormDimension,
    newRect: formInfo.Rect
  ): void {
    const dimension: number = this.normalizeDimension(newDimension as number);
    this.formDimensions.set(formId, dimension);
    hilog.info(
      DOMAIN,
      TAG,
      'size changed: formId=%{public}s dimension=%{public}d width=%{public}f height=%{public}f',
      formId,
      dimension,
      newRect.width,
      newRect.height
    );
    this.refreshForm(formId, dimension);
  }

  onRemoveForm(formId: string): void {
    this.formDimensions.delete(formId);
  }

  onAcquireFormState(_want: Want): formInfo.FormState {
    return formInfo.FormState.READY;
  }

  private readFormId(want: Want): string {
    const raw: Object | undefined = want.parameters?.[formInfo.FormParam.IDENTITY_KEY];
    return typeof raw === 'string' ? raw : '';
  }

  private readDimension(want: Want): number {
    const raw: Object | undefined = want.parameters?.[formInfo.FormParam.DIMENSION_KEY];
    return typeof raw === 'number'
      ? this.normalizeDimension(raw)
      : DIMENSION_2_2;
  }

  private normalizeDimension(dimension: number): number {
    return dimension === DIMENSION_2_4 ? DIMENSION_2_4 : DIMENSION_2_2;
  }

  private createDefaultData(dimension: number): ReviewCardFormData {
    return {
      dueCount: 0,
      nextWord: '',
      lastUpdated: 0,
      language: 'en',
      reviewedCount: 0,
      totalCount: 0,
      formDimension: dimension,
    };
  }

  private async refreshForm(formId: string, dimension?: number): Promise<void> {
    try {
      this.provider.setContext(this.context);
      const dueCount: number = await this.provider.getDueCardsCountForWidget();
      const language: string = await this.provider.getLanguage();
      const todayStats: TodayReviewStats =
        await this.provider.getTodayReviewStatsForWidget();
      const nextCard: MemoryCardRecord | null =
        await this.provider.getNextDueCardForWidget();
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
      await formProvider.updateForm(
        formId,
        formBindingData.createFormBindingData(data)
      );
      hilog.info(DOMAIN, TAG, 'form updated: %{public}s', formId);
    } catch (error) {
      const err: BusinessError = error as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'refresh failed: formId=%{public}s code=%{public}d msg=%{public}s',
        formId,
        err.code,
        err.message
      );
    }
  }
}
