/**
 * notification/NotificationService (v0.1.0-harmony Stage 7)
 *
 * 封装 @ohos.notificationManager, 提供复习到期提醒的调度 / 取消 / 权限管理.
 *
 * 设计要点:
 * - 单例模式 (getInstance), 全局唯一, 由 HarmonyBridge.registerReminder 调用.
 * - 通知能力边界: notificationManager 无延迟调度能力, 本 service 只负责
 *   "卡片已到期 (或 1 分钟内到期) 且当前不在静音时段" 时立即 publish;
 *   未来时刻的定时提醒由 ReminderAgentService (reminderAgentManager) 承担,
 *   未开通 PUBLISH_AGENT_REMINDER 权益时两侧都安全跳过, 绝不降级为立即通知.
 * - 时间窗配置 (notifications_config) 由 HarmonyBridge 从 preferences 读取后传入
 *   scheduleReviewReminder; 本 service 仅用其判断"现在能否发布", 不做跨天延迟.
 * - 所有方法 try/catch 兜底, 异常返回安全默认值 (false / void) 不抛错,
 *   保证 ArkTS 侧异常不传播到 Web 端 JSBridge.
 * - wantAgent: 点击通知跳转 EntryAbility, parameters.query=action=startReview (API 22
 *   actionType/actionData 已移除, 改用 wantAgent 实现点击路由).
 *
 * ArkTS 适配: 无 any / 无对象字面量类型 / 无 var / 无 enum / 用 interface 而非 type alias.
 * 异步用 async/await, 不嵌套 Promise 构造函数.
 */
import notificationManager from '@ohos.notificationManager';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { common, wantAgent, Want, WantAgent } from '@kit.AbilityKit';
import { getReviewReminderText, NotificationText } from './templates';
import type { NotificationPermissionState } from '../bridge/types';

const DOMAIN: number = 0x0001;
const TAG: string = 'NotificationService';
const REMINDER_TAG: string = 'wordaydream_review_reminder';
const MIN_DELAY_MS: number = 60_000;

/**
 * 点击通知拉起的目标包名 — 与 harmony/AppScope/app.json5 的
 * bundleName ("com.wordaydream.app") 一一对应; 改包名时两处同步.
 */
const BUNDLE_NAME: string = 'com.wordaydream.app';

/**
 * requestEnableNotification 在用户拒绝授权 / 通知总开关关闭时抛出的系统错误码
 * (NotificationErrorCode.NOTIFICATION_ENABLED).
 */
const ERROR_NOTIFICATION_NOT_ENABLED: number = 1600004;

/** 时间窗配置 (由 HarmonyBridge 从 preferences 读取后传入). */
export interface NotificationWindow {
  /** 是否启用通知. */
  enabled: boolean;
  /** 允许通知的开始小时 (0-23). */
  startHour: number;
  /** 允许通知的结束小时 (0-23). */
  endHour: number;
}

/** 默认时间窗: 8:00-22:00, enabled=true. */
const DEFAULT_WINDOW: NotificationWindow = {
  enabled: true,
  startHour: 8,
  endHour: 22,
};

export class NotificationService {
  private static instance: NotificationService | null = null;

  private constructor() {}

  static getInstance(): NotificationService {
    if (NotificationService.instance === null) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  /**
   * 发布"已到期"复习提醒通知 (立即发布, 无延迟调度能力).
   *
   * 逻辑:
   * 1. 若 window.enabled=false, 直接返回 (不发布通知).
   * 2. 若 dueAt 仍在 MIN_DELAY_MS 之后 (未来到期), 记录 warn 并跳过 —
   *    真正的定时提醒由 ReminderAgentService.publishReminder 承担
   *    (reminderAgent 需要 PUBLISH_AGENT_REMINDER 权益, 未开通时同样安全跳过).
   * 3. 若当前小时落在时间窗外 ([startHour, endHour) 之外), 跳过, 不打扰用户.
   * 4. 其余情况通过 notificationManager.publish 立即发布通知.
   */
  async scheduleReviewReminder(
    dueAt: number,
    dueCount: number,
    language: string,
    window?: NotificationWindow
  ): Promise<void> {
    try {
      const win: NotificationWindow = window !== undefined ? window : DEFAULT_WINDOW;
      if (!win.enabled) {
        hilog.info(DOMAIN, TAG, 'scheduleReviewReminder: notifications disabled, skip');
        return;
      }

      const now: number = Date.now();
      if (dueAt - now >= MIN_DELAY_MS) {
        hilog.warn(
          DOMAIN,
          TAG,
          'scheduleReviewReminder skipped future delivery: dueAt=%{private}d (future reminders belong to ReminderAgentService, skipped when entitlement is absent)',
          dueAt
        );
        return;
      }
      if (!this.isInNotificationWindow(now, win)) {
        hilog.info(
          DOMAIN,
          TAG,
          'scheduleReviewReminder skipped quiet hours: window=%{public}d-%{public}d',
          win.startHour,
          win.endHour
        );
        return;
      }

      const text: NotificationText = getReviewReminderText(language, dueCount);

      // API 22: actionType/actionData 已从 NotificationRequest 移除, 改用 wantAgent
      // 实现点击跳转. Want 携带 parameters.query='action=startReview', EntryAbility.
      // onNewWant 读取后派发到 HarmonyBridge.handleHarmonyLaunch (与原
      // actionType=TYPE_ROUTER + actionData 行为一致).
      let clickAgent: WantAgent | null = null;
      try {
        const want: Want = {
          bundleName: BUNDLE_NAME,
          abilityName: 'EntryAbility',
          parameters: { 'query': 'action=startReview' },
        };
        const wantAgentInfo: wantAgent.WantAgentInfo = {
          wants: [want],
          actionType: wantAgent.OperationType.START_ABILITY,
          requestCode: 0,
          actionFlags: [wantAgent.WantAgentFlags.UPDATE_PRESENT_FLAG],
        };
        clickAgent = await wantAgent.getWantAgent(wantAgentInfo);
      } catch (e2) {
        const err2: BusinessError = e2 as BusinessError;
        hilog.warn(
          DOMAIN,
          TAG,
          'getWantAgent failed: code=%{public}d msg=%{public}s',
          err2.code,
          err2.message
        );
      }

      const request: notificationManager.NotificationRequest = {
        id: this.hashToId(REMINDER_TAG),
        content: {
          notificationContentType: notificationManager.ContentType.NOTIFICATION_CONTENT_BASIC_TEXT,
          normal: {
            title: text.title,
            text: text.text,
            additionalText: text.expandedText,
          },
        },
        notificationSlotType: notificationManager.SlotType.SERVICE_INFORMATION,
        label: REMINDER_TAG,
        extraInfo: {
          dueAt: dueAt,
          dueCount: dueCount,
        },
      };
      if (clickAgent !== null) {
        request.wantAgent = clickAgent;
      }

      await notificationManager.publish(request);
      hilog.info(
        DOMAIN,
        TAG,
        'scheduleReviewReminder published due notification: dueAt=%{private}d dueCount=%{public}d lang=%{public}s',
        dueAt,
        dueCount,
        language
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
    }
  }

  /**
   * 取消指定 tag 的通知.
   * 鸿蒙 notificationManager.cancel 通过 id + label 取消, tag 即 label.
   */
  async cancelReminder(tag: string): Promise<void> {
    try {
      const id: number = this.hashToId(tag);
      await notificationManager.cancel(id, tag);
      hilog.info(DOMAIN, TAG, 'cancelReminder: tag=%{public}s', tag);
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'cancelReminder failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
    }
  }

  /** 取消所有由本 service 发布的通知. */
  async cancelAllReminders(): Promise<void> {
    try {
      await this.cancelReminder(REMINDER_TAG);
      hilog.info(DOMAIN, TAG, 'cancelAllReminders done');
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'cancelAllReminders failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
    }
  }

  /**
   * 请求通知权限 (弹窗引导用户授权) — 三态结果 (v0.5.0-harmony Stage 3).
   *
   * - granted: 用户已授权 (含此前已授权的场景).
   * - denied: 用户在弹窗中拒绝.
   * - error: 系统调用异常 (context 无效等).
   *
   * 返回值经 HarmonyBridge.requestNotificationPermission 透传给 Web 设置面板,
   * denied 时由 Web 端给出跳转系统设置的引导提示.
   */
  async requestEnableNotification(
    context: common.UIAbilityContext
  ): Promise<NotificationPermissionState> {
    try {
      await notificationManager.requestEnableNotification(context);
      hilog.info(DOMAIN, TAG, 'requestEnableNotification: granted');
      return 'granted';
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      // 用户拒绝授权时 requestEnableNotification 以 BusinessError 抛出,
      // 错误码 ERROR_NOTIFICATION_NOT_ENABLED 视为 denied, 其余视为 error.
      if (err.code === ERROR_NOTIFICATION_NOT_ENABLED) {
        hilog.info(DOMAIN, TAG, 'requestEnableNotification: denied by user');
        return 'denied';
      }
      hilog.error(
        DOMAIN,
        TAG,
        'requestEnableNotification failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
      return 'error';
    }
  }

  /**
   * 查询通知是否已授权.
   * 返回 true 表示已授权, false 表示未授权或异常.
   */
  async isEnabled(): Promise<boolean> {
    try {
      const enabled: boolean = await notificationManager.isNotificationEnabled();
      return enabled;
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'isEnabled failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
      return false;
    }
  }

  /**
   * 当前时刻是否落在允许发布通知的时间窗 [startHour, endHour) 内.
   *
   * 规则:
   * - startHour >= endHour 视为全天允许 (如 0-23 或"不限制").
   * - hour < startHour 或 hour >= endHour 视为静音时段, 不发布.
   *
   * 此函数为纯函数 (无副作用), 便于单元测试 mock.
   */
  private isInNotificationWindow(now: number, win: NotificationWindow): boolean {
    if (win.startHour >= win.endHour) {
      return true;
    }
    const hour: number = new Date(now).getHours();
    return hour >= win.startHour && hour < win.endHour;
  }

  /** 将字符串 hash 为合法 notification id (0-32767, int16 范围). */
  private hashToId(s: string): number {
    let h: number = 0;
    for (let i: number = 0; i < s.length; i++) {
      h = ((h * 31) + s.charCodeAt(i)) & 0x7fff;
    }
    return h;
  }
}
