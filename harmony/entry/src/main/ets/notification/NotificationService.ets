/**
 * notification/NotificationService (v0.1.0-harmony Stage 7)
 *
 * 封装 @ohos.notificationManager, 提供复习到期提醒的调度 / 取消 / 权限管理.
 *
 * 设计要点:
 * - 单例模式 (getInstance), 全局唯一, 由 HarmonyBridge.registerReminder 调用.
 * - 时间窗约束: 仅在 [startHour, endHour) 内发布通知; 时间窗外延迟到次日 startHour.
 *   时间窗配置由 HarmonyBridge 从 preferences (notifications_config) 读取后传入 scheduleReviewReminder
 *   的隐式契约 — 本 service 仅负责"给定 dueAt + 时间窗, 决定何时 publish".
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

const DOMAIN: number = 0x0001;
const TAG: string = 'NotificationService';
const REMINDER_TAG: string = 'wordaydream_review_reminder';
const MIN_DELAY_MS: number = 60_000;
const MS_PER_DAY: number = 86_400_000;

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
   * 调度复习到期提醒.
   *
   * 逻辑:
   * 1. 若 window.enabled=false, 直接返回 (不发布通知).
   * 2. 计算 triggerAt = dueAt (卡片到期时间).
   * 3. 若 triggerAt 已过期或 < 1min 后, 立即触发 (triggerAt = now).
   * 4. 若 triggerAt 落在时间窗外 (hour < startHour 或 hour >= endHour), 延迟到次日 startHour.
   * 5. 通过 notificationManager.publish 发布通知 (slot=BASIC_CONTENT, actionType=router).
   *
   * 注: 当前实现为"立即 publish" (鸿蒙 notificationManager 无原生延迟调度,
   *   reminderAgent 需要额外 system_grant 权限). 时间窗延迟逻辑计算 triggerAt
   *   但实际 publish 时机由调用方决定 (Stage 7 范围内立即 publish, 真机由用户验证).
   * SAFETY OVERRIDE: the Stage 7 note above is historical. The current guard
   * skips every future trigger instead of publishing it immediately, until
   * reminderAgent entitlement and signing are provisioned.
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
      const triggerAt: number = this.computeTriggerAt(dueAt, now, win);
      if (triggerAt > now) {
        hilog.warn(
          DOMAIN,
          TAG,
          'scheduleReviewReminder skipped future delivery: dueAt=%{public}d triggerAt=%{public}d; reminderAgent capability is not provisioned',
          dueAt,
          triggerAt
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
          bundleName: 'com.wordaydream.app',
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
          dueAt: triggerAt,
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
        'scheduleReviewReminder published due notification: dueAt=%{public}d dueCount=%{public}d lang=%{public}s triggerAt=%{public}d',
        dueAt,
        dueCount,
        language,
        triggerAt
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
   * 请求通知权限 (弹窗引导用户授权).
   * 返回 true 表示已授权, false 表示用户拒绝或异常.
   */
  async requestPermission(context: common.UIAbilityContext): Promise<boolean> {
    try {
      await notificationManager.requestEnableNotification(context);
      hilog.info(DOMAIN, TAG, 'requestPermission: granted');
      return true;
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'requestPermission failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
      return false;
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
   * 计算实际触发时间 (考虑时间窗).
   *
   * 规则:
   * - 若 dueAt 已过期或距 now < 1min, triggerAt = now (立即触发).
   * - 否则 triggerAt = dueAt.
   * - 若 triggerAt 的小时 < startHour, 延迟到当日 startHour.
   * - 若 triggerAt 的小时 >= endHour, 延迟到次日 startHour.
   * - startHour >= endHour 视为全天允许, 不延迟.
   *
   * 此函数为纯函数 (无副作用), 便于单元测试 mock.
   */
  computeTriggerAt(dueAt: number, now: number, win: NotificationWindow): number {
    // 已过期或 < 1min: 立即触发
    if (dueAt <= now || dueAt - now < MIN_DELAY_MS) {
      return this.applyWindow(now, win);
    }
    return this.applyWindow(dueAt, win);
  }

  /** 将时间戳对齐到时间窗内 (窗外延迟到当日/次日 startHour). */
  private applyWindow(ts: number, win: NotificationWindow): number {
    if (win.startHour >= win.endHour) {
      // 全天允许 (如 0-23 或 startHour >= endHour)
      return ts;
    }
    const date: Date = new Date(ts);
    const hour: number = date.getHours();
    if (hour < win.startHour) {
      // 当日 startHour
      return this.atHour(date, win.startHour);
    }
    if (hour >= win.endHour) {
      // 次日 startHour
      const nextDay: number = ts + MS_PER_DAY;
      const nextDate: Date = new Date(nextDay);
      return this.atHour(nextDate, win.startHour);
    }
    return ts;
  }

  /** 将 Date 对齐到指定 hour (0 分 0 秒 0 毫秒), 返回时间戳. */
  private atHour(date: Date, hour: number): number {
    const d: Date = new Date(date.getTime());
    d.setHours(hour, 0, 0, 0);
    return d.getTime();
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
