import { formBindingData, FormExtensionAbility, formInfo, formProvider } from '@kit.FormKit';
import { Want } from '@kit.AbilityKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { DIMENSION_2_2, DIMENSION_2_4 } from './CardFormDimension';
import { CardDataProvider, ReviewCardFormData } from './CardDataProvider';
import { FormIdStore } from './FormIdStore';

const DOMAIN: number = 0x0001;
const TAG: string = 'ReviewCardFormAbility';
/** 系统 FormDimension 的 2*4 数值 (仅本进程感知). */
const FORM_DIMENSION_2_4: number = formInfo.FormDimension.Dimension_2_4;

/**
 * 服务卡片提供方。
 *
 * FormExtensionAbility 运行在卡片提供方进程，负责读取本地数据并通过
 * FormBindingData 传给卡片渲染进程。卡片 UI 不直接访问 Context 或 RDB。
 *
 * 尺寸契约：want / onSizeChanged 给出的是系统 formInfo.FormDimension 数值，
 * 本文件是「系统数值 -> CardFormDimension 标签」的唯一翻译点；卡片渲染进程
 * 只消费 '2*2' / '2*4' 字符串，因而无需（也不得）引用 @kit.FormKit。
 */
export default class ReviewCardFormAbility extends FormExtensionAbility {
  private provider: CardDataProvider = CardDataProvider.getInstance();
  private formDimensionLabels: Map<string, string> = new Map<string, string>();

  onAddForm(want: Want): formBindingData.FormBindingData {
    const dimension: string = this.readDimensionLabel(want);
    const formId: string = this.readFormId(want);
    if (formId.length > 0) {
      this.formDimensionLabels.set(formId, dimension);
      // Stage 2: 持久化 formId, 供复习完成后主动刷新闭环使用.
      FormIdStore.getInstance().initialize(this.context);
      void FormIdStore.getInstance().saveFormId(formId, this.context);
      // onAddForm 必须同步返回；随后异步推送真实 RDB 数据。
      this.refreshForm(formId, dimension);
    }
    return formBindingData.createFormBindingData(this.createDefaultData(dimension));
  }

  onUpdateForm(formId: string): void {
    if (formId.length > 0) {
      // Stage 2: 刷新时确保 formId 已持久化 (兜底 onCreate 遗漏).
      void FormIdStore.getInstance().saveFormId(formId, this.context);
    }
    this.refreshForm(formId, this.formDimensionLabels.get(formId));
  }

  onSizeChanged(
    formId: string,
    newDimension: formInfo.FormDimension,
    newRect: formInfo.Rect
  ): void {
    const dimension: string = this.dimensionLabel(newDimension as number);
    this.formDimensionLabels.set(formId, dimension);
    hilog.info(
      DOMAIN,
      TAG,
      'size changed: formId=%{private}s dimension=%{public}s width=%{public}f height=%{public}f',
      formId,
      dimension,
      newRect.width,
      newRect.height
    );
    this.refreshForm(formId, dimension);
  }

  onRemoveForm(formId: string): void {
    this.formDimensionLabels.delete(formId);
    // Stage 2: 移除 formId, 避免主动刷新时命中已删除的卡片.
    void FormIdStore.getInstance().removeFormId(formId);
  }

  onAcquireFormState(_want: Want): formInfo.FormState {
    return formInfo.FormState.READY;
  }

  private readFormId(want: Want): string {
    const raw: Object | undefined = want.parameters?.[formInfo.FormParam.IDENTITY_KEY];
    return typeof raw === 'string' ? raw : '';
  }

  /** 从 want 读取系统尺寸并翻译为标签；缺失或未知尺寸回落 2*2。 */
  private readDimensionLabel(want: Want): string {
    const raw: Object | undefined = want.parameters?.[formInfo.FormParam.DIMENSION_KEY];
    return typeof raw === 'number' ? this.dimensionLabel(raw) : DIMENSION_2_2;
  }

  /**
   * 系统 FormDimension 数值 -> 卡片渲染进程消费的稳定标签。
   * 全工程唯一跨 Kit 边界的尺寸翻译点；未知尺寸回落 2*2 紧凑布局。
   */
  private dimensionLabel(dimension: number): string {
    return dimension === FORM_DIMENSION_2_4 ? DIMENSION_2_4 : DIMENSION_2_2;
  }

  private createDefaultData(dimension: string): ReviewCardFormData {
    return {
      dueCount: 0,
      nextWord: '',
      nextCardId: '',
      lastUpdated: 0,
      language: 'en',
      reviewedCount: 0,
      totalCount: 0,
      formDimension: dimension,
    };
  }

  private async refreshForm(formId: string, dimension?: string): Promise<void> {
    try {
      this.provider.setContext(this.context);
      const data: ReviewCardFormData =
        await this.provider.getWidgetFormData(dimension);
      await formProvider.updateForm(
        formId,
        formBindingData.createFormBindingData(data)
      );
      // formId 明文降为 private: info 级日志不暴露安装级标识符.
      hilog.info(DOMAIN, TAG, 'form updated: %{private}s', formId);
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
