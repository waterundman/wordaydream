/**
 * FormRefresher (v0.5.0-harmony Stage 2)
 *
 * 复习完成后主动刷新所有已持久化的服务卡片 (Stage 2 闭环: 复习完成 → 主动刷新).
 *
 * 触发路径: Web 侧 completeReview 完成 → harmonyBridge.notifyReviewCompleted
 *   → FormRefresher.refreshAllForms(context).
 *
 * 行为:
 * 1. 读 FormIdStore.getAllFormIds (持久化的 formId 集合).
 * 2. 无 formId → 静默返回 (不抛错).
 * 3. 复用 CardDataProvider.getWidgetFormData 组装与 ReviewCardWidget 消费字段
 *    一致的数据 (dueCount / nextWord / lastUpdated / language / reviewedCount /
 *    totalCount).
 * 4. 对每个 formId 调 formProvider.updateForm; 单个失败仅记录日志并继续其余,
 *    全部失败也不抛错 (静默降级).
 *
 * 并发安全: 单例 + CardDataProvider / MemoryCardStore 自身幂等初始化.
 */
import { formBindingData, formProvider } from '@kit.FormKit';
import { common } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { CardDataProvider, ReviewCardFormData } from './CardDataProvider';
import { FormIdStore } from './FormIdStore';

const DOMAIN: number = 0x0001;
const TAG: string = 'FormRefresher';

export class FormRefresher {
  private static instance: FormRefresher | null = null;

  private constructor() {}

  static getInstance(): FormRefresher {
    if (FormRefresher.instance === null) {
      FormRefresher.instance = new FormRefresher();
    }
    return FormRefresher.instance;
  }

  /**
   * 主动刷新所有已持久化的服务卡片.
   *
   * @param context 任意 ability context (通常是 EntryAbility context, 由
   *   HarmonyBridge.notifyReviewCompleted 注入). 用于初始化 RDB / preferences.
   *   无 context 或初始化失败时静默返回.
   */
  async refreshAllForms(context: common.Context): Promise<void> {
    try {
      const formIds: string[] =
        await FormIdStore.getInstance().getAllFormIds();
      if (formIds.length === 0) {
        hilog.info(DOMAIN, TAG, 'refreshAllForms: no persisted formId, skip');
        return;
      }

      const provider: CardDataProvider = CardDataProvider.getInstance();
      provider.setContext(context);
      const data: ReviewCardFormData = await provider.getWidgetFormData();

      let refreshed: number = 0;
      let failed: number = 0;
      for (const formId of formIds) {
        try {
          await formProvider.updateForm(
            formId,
            formBindingData.createFormBindingData(data)
          );
          refreshed += 1;
          // formId 明文降为 private: info 级日志不暴露安装级标识符.
          hilog.info(DOMAIN, TAG, 'form refreshed: %{private}s', formId);
        } catch (e) {
          failed += 1;
          const err: BusinessError = e as BusinessError;
          hilog.error(
            DOMAIN,
            TAG,
            'refresh form failed: formId=%{public}s code=%{public}d msg=%{public}s',
            formId,
            err.code,
            err.message
          );
        }
      }
      hilog.info(
        DOMAIN,
        TAG,
        'refreshAllForms done: refreshed=%{public}d failed=%{public}d',
        refreshed,
        failed
      );
    } catch (e) {
      // 全部失败 / 初始化失败: 静默返回, 不抛错 (避免影响复习主流程).
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'refreshAllForms aborted: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
    }
  }
}
