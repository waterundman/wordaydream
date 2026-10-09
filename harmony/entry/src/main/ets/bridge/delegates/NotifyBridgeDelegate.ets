/**
 * NotifyBridgeDelegate (v1.6.3 S1 — B1 上帝文件拆分)
 *
 * 通知域委托: Web → 鸿蒙本地通知 / reminderAgent / 服务卡片刷新.
 * 由 HarmonyBridge facade 持有并转发; 桥接契约面 (方法名/签名) 不变.
 *
 * 跨域协作 (避免在委托间复制 RDB / prefs 访问路径):
 * - cardDelegate.getDueCardsCountAt(ts): 通知文案"有 N 个词汇到期"的到期数.
 * - prefsDelegate.readPreferences(key): app_language / notifications_config.
 * 两个委托实例由 facade 创建并同源 refreshContext, 委托只持引用不自行刷新.
 * Contract: 所有方法 try/catch 兜底, 异常返回安全默认值 (void / {ok:false} /
 * {skipped:true} / {state:'error'}) 不抛错 (异常不传播到 Web).
 */
import { hilog } from '@kit.PerformanceAnalysisKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { common } from '@kit.AbilityKit';
import type {
  ReminderPayload,
  NotifyReviewCompletedResult,
  NotificationPermissionResult,
  NotificationPermissionState,
  ScheduleReminderResult,
  CancelReminderResult,
} from '../types';
import { FormRefresher } from '../../widget/FormRefresher';
import {
  NotificationService,
  NotificationWindow,
} from '../../notification/NotificationService';
import { ReminderAgentService } from '../../notification/ReminderAgentService';
import { BridgeInputValidator } from '../BridgeInputValidator';
import { getReviewReminderText } from '../../notification/templates';
import type { NotificationText } from '../../notification/templates';
import { CardBridgeDelegate } from './CardBridgeDelegate';
import { PrefsBridgeDelegate } from './PrefsBridgeDelegate';

const DOMAIN: number = 0x0001;
const TAG: string = 'HarmonyBridge';

export class NotifyBridgeDelegate {
  private context: common.Context;
  private cardDelegate: CardBridgeDelegate;
  private prefsDelegate: PrefsBridgeDelegate;

  constructor(
    context: common.Context,
    cardDelegate: CardBridgeDelegate,
    prefsDelegate: PrefsBridgeDelegate
  ) {
    this.context = context;
    this.cardDelegate = cardDelegate;
    this.prefsDelegate = prefsDelegate;
  }

  /** 由 facade.refreshContext 同源刷新 (cardDelegate / prefsDelegate 由 facade 一并刷新). */
  refreshContext(newContext: common.Context): void {
    this.context = newContext;
  }

  /**
   * 注册本地复习提醒 (真实 NotificationService 调用).
   *
   * 流程:
   * 1. 读取 preferences 'app_language' (默认 'en') 作为通知文案语言.
   * 2. 读取 preferences 'notifications_config' (JSON: {enabled, startHour, endHour}),
   *    默认 {enabled:true, startHour:8, endHour:22}.
   * 3. 通过 cardDelegate.getDueCardsCountAt(payload.dueAt) 获取到期卡片数.
   * 4. 调用 NotificationService.scheduleReviewReminder 发布本地通知.
   *
   * 异常 try/catch 兜底返回 void (ArkTS 侧异常不传播到 Web).
   */
  async registerReminder(payload: ReminderPayload): Promise<void> {
    try {
      if (!BridgeInputValidator.validateReminderPayload(payload)) {
        hilog.warn(DOMAIN, TAG, 'registerReminder rejected: invalid payload');
        return;
      }
      // 1. 读取语言偏好 (默认 'en')
      const langValue: string | null =
        await this.prefsDelegate.readPreferences('app_language');
      const language: string = langValue !== null ? langValue : 'en';

      // 2. 读取通知时间窗配置 (默认 8:00-22:00, enabled=true)
      const win: NotificationWindow = await this.readNotificationWindow();

      // 3. 获取到期卡片数 (供通知文案展示 "有 N 个词汇到期")
      const dueCount: number =
        await this.cardDelegate.getDueCardsCountAt(payload.dueAt);

      // 4. 调度通知 (NotificationService 内部 try/catch 兜底)
      await NotificationService.getInstance().scheduleReviewReminder(
        payload.dueAt,
        dueCount,
        language,
        win
      );

      hilog.debug(
        DOMAIN,
        TAG,
        'registerReminder (Stage 7): dueCount=%{public}d lang=%{public}s',
        dueCount,
        language
      );
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'registerReminder failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
    }
  }

  /**
   * 读取通知时间窗配置.
   *
   * 从 preferences 'notifications_config' 读取 JSON 字符串, 解析为 NotificationWindow.
   * 键不存在 / 解析失败 / 字段缺失时返回默认 {enabled:true, startHour:8, endHour:22}.
   */
  private async readNotificationWindow(): Promise<NotificationWindow> {
    const defaultWin: NotificationWindow = {
      enabled: true,
      startHour: 8,
      endHour: 22,
    };
    try {
      const raw: string | null =
        await this.prefsDelegate.readPreferences('notifications_config');
      if (raw === null || raw.length === 0) {
        return defaultWin;
      }
      const obj: Record<string, object> = JSON.parse(raw) as Record<string, object>;
      const enabled: boolean =
        typeof obj.enabled === 'boolean' ? obj.enabled : true;
      const startHour: number =
        typeof obj.startHour === 'number' && obj.startHour >= 0 && obj.startHour <= 23
          ? Math.floor(obj.startHour)
          : 8;
      const endHour: number =
        typeof obj.endHour === 'number' && obj.endHour >= 0 && obj.endHour <= 23
          ? Math.floor(obj.endHour)
          : 22;
      const win: NotificationWindow = { enabled, startHour, endHour };
      return win;
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.warn(
        DOMAIN,
        TAG,
        'readNotificationWindow fallback to default: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
      return defaultWin;
    }
  }

  /**
   * Stage 2: 复习完成后主动刷新所有已持久化的服务卡片.
   *
   * 由 Web 侧 useReviewSessionStore.completeReview 完成路径 fire-and-forget 调用.
   * 委托 FormRefresher.refreshAllForms 读 RDB + 持久化 formId 集合并 updateForm.
   * FormRefresher 内部已对所有异常静默降级 (无 formId / 全部失败均不抛错).
   *
   * 返回约定: 成功 {ok:true}; refreshAllForms 抛错 {ok:false, reason}.
   */
  async notifyReviewCompleted(): Promise<NotifyReviewCompletedResult> {
    try {
      await FormRefresher.getInstance().refreshAllForms(this.context);
      hilog.info(DOMAIN, TAG, 'notifyReviewCompleted -> refreshed all forms');
      return { ok: true };
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'notifyReviewCompleted failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
      return { ok: false, reason: err.message };
    }
  }

  /**
   * Stage 3: 请求通知权限 (三态: granted / denied / error).
   *
   * 由 Web 设置面板通知开关首次开启时调用. 委托
   * NotificationService.requestEnableNotification (requestEnableNotification
   * 为运行时用户授权 API, 无需 manifest 权限声明). 异常转为 error 态不抛错.
   */
  async requestNotificationPermission(): Promise<NotificationPermissionResult> {
    try {
      const ctx: common.UIAbilityContext = this.context as common.UIAbilityContext;
      const state: NotificationPermissionState = await NotificationService.getInstance()
        .requestEnableNotification(ctx);
      return { state: state };
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'requestNotificationPermission failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
      return { state: 'error', reason: err.message };
    }
  }

  /**
   * Stage 3: 调度 reminderAgent 定时提醒 (无权益安全降级).
   *
   * 校验先行: reminderId 白名单 + triggerAt 必须为未来时间 (过去时间拒绝,
   * 防止"未来提醒"被误发布). 委托 ReminderAgentService.publishReminder —
   * 权益不可用时 {skipped:true}, 绝不真实发布 (安全契约).
   * 文案取自 notification/templates.getReviewReminderText (按 app_language 本地化).
   */
  async scheduleReviewReminder(
    reminderId: string,
    triggerAt: number
  ): Promise<ScheduleReminderResult> {
    try {
      if (!BridgeInputValidator.validateReminderId(reminderId)) {
        hilog.warn(DOMAIN, TAG, 'scheduleReviewReminder rejected: invalid reminderId');
        return { skipped: true, reason: 'invalid reminderId' };
      }
      if (!BridgeInputValidator.validateReminderTime(triggerAt, Date.now())) {
        hilog.warn(
          DOMAIN,
          TAG,
          'scheduleReviewReminder rejected: triggerAt not in future, reminderId=%{public}s',
          reminderId
        );
        return { skipped: true, reason: 'triggerAt must be a future time' };
      }
      await ReminderAgentService.getInstance().initialize(this.context);
      // 提醒文案 i18n: 标题/正文取自 notification/templates 多语言模板
      // (按 app_language 偏好 + 到期卡片数生成), 不再硬编码中文.
      const langValue: string | null =
        await this.prefsDelegate.readPreferences('app_language');
      const language: string = langValue !== null ? langValue : 'en';
      const dueCount: number =
        await this.cardDelegate.getDueCardsCountAt(triggerAt);
      const reminderText: NotificationText = getReviewReminderText(
        language,
        dueCount
      );
      return await ReminderAgentService.getInstance().publishReminder(
        reminderId,
        triggerAt,
        reminderText.title,
        reminderText.text
      );
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'scheduleReviewReminder failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
      return { skipped: true, reason: err.message };
    }
  }

  /**
   * Stage 3: 取消 reminderAgent 定时提醒 (幂等: 不存在视为成功).
   */
  async cancelReviewReminder(reminderId: string): Promise<CancelReminderResult> {
    try {
      if (!BridgeInputValidator.validateReminderId(reminderId)) {
        hilog.warn(DOMAIN, TAG, 'cancelReviewReminder rejected: invalid reminderId');
        return { ok: false, reason: 'invalid reminderId' };
      }
      await ReminderAgentService.getInstance().initialize(this.context);
      return await ReminderAgentService.getInstance().cancelReminder(reminderId);
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'cancelReviewReminder failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
      return { ok: false, reason: err.message };
    }
  }
}