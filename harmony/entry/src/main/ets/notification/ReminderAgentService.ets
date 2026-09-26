/**
 * ReminderAgentService (v0.5.0-harmony Stage 3)
 *
 * 封装 @ohos.reminderAgentManager 的定时提醒能力:
 * 发布 / 去重 / 取消 / 启动对账恢复, 并实现"无权益安全降级"契约.
 *
 * 背景: reminderAgent 属于系统开放能力, 需要在 AGC 申请 PUBLISH_AGENT_REMINDER
 * 权益并在签名 Profile 中声明后才可真实发布. 未开通权益时所有调用必须
 * 安全跳过 ({skipped:true, reason}), 绝不 fallback 为立即通知 — 与
 * NotificationService.scheduleReviewReminder 的"未来触发一律跳过"边界一致.
 *
 * 权益探测: reminderAgentManager 无显式 isSupported API, 采用 getValidReminders()
 * 探测 — 抛错 (权限/能力缺失) 即视为不支持, 结果缓存避免反复探测.
 *
 * 去重: 同一 reminderId (Web 侧字符串标识) 重新调度时先 cancel 旧 systemId
 * 再 publish, 避免重复提醒堆积.
 *
 * 恢复: restoreOnStartup 比对 preferences 中期望的提醒集合与系统
 * getValidReminders 的实际集合, 补发缺失项 (仅 supported 时执行).
 *
 * ArkTS 适配: 无 any / 无对象字面量类型 / 无 var; 所有方法 try/catch 兜底,
 * 异常转为 {skipped:true, reason} 不抛错到 HarmonyBridge.
 */
import reminderAgentManager from '@ohos.reminderAgentManager';
import { preferences } from '@kit.ArkData';
import { common } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { BusinessError } from '@kit.BasicServicesKit';
import type { ScheduleReminderResult, CancelReminderResult } from '../bridge/types';

const DOMAIN: number = 0x0001;
const TAG: string = 'ReminderAgentService';
const PREFS_NAME: string = 'wordaydream_reminder_prefs';
const REMINDERS_KEY: string = 'scheduled_reminders';

/** 期望提醒条目: Web 侧标识 → 系统侧 id + 触发时间. */
interface ReminderEntry {
  /** Web 侧标识 (validateReminderId 白名单字符). */
  id: string;
  /** publish 成功后系统返回的 reminderId. */
  systemId: number;
  /** 期望触发时间戳 (ms, epoch). */
  triggerAt: number;
}

/** restoreOnStartup 结果 (ArkTS 禁止内联对象字面量类型, 显式声明). */
interface RestoreOutcome {
  /** 对账流程是否完成 (含不支持场景的 skipped 成功路径). */
  ok: boolean;
  /** 补发的提醒数量. */
  restored: number;
  /** 是否因权益不可用而跳过. */
  skipped: boolean;
}

export class ReminderAgentService {
  private static instance: ReminderAgentService | null = null;
  private context: common.Context | null = null;
  private prefs: preferences.Preferences | null = null;
  private initPromise: Promise<preferences.Preferences> | null = null;
  /** 权益探测缓存: null = 未探测; true/false = 探测结果. */
  private supportedCache: boolean | null = null;

  private constructor() {}

  static getInstance(): ReminderAgentService {
    if (ReminderAgentService.instance === null) {
      ReminderAgentService.instance = new ReminderAgentService();
    }
    return ReminderAgentService.instance;
  }

  /**
   * 初始化 preferences (幂等, 并发共享同一 Promise, 参考 FormIdStore).
   * 仅首次调用时使用 context.
   */
  initialize(context: common.Context): Promise<preferences.Preferences> {
    if (this.prefs !== null) {
      return Promise.resolve(this.prefs);
    }
    if (this.initPromise !== null) {
      return this.initPromise;
    }
    this.context = context;
    this.initPromise = this.initializePrefs(context);
    return this.initPromise;
  }

  /**
   * 实际打开 preferences. 成功时缓存实例; 无论成败都在 finally 复位
   * initPromise, 避免首次失败后 Promise 被永久毒化 (后续调用永远拿到同一
   * 个 rejected Promise, 与 MemoryCardStore.initializeStore 的 finally 模式一致).
   */
  private async initializePrefs(context: common.Context): Promise<preferences.Preferences> {
    try {
      const prefs: preferences.Preferences =
        await preferences.getPreferences(context, PREFS_NAME);
      this.prefs = prefs;
      return prefs;
    } finally {
      this.initPromise = null;
    }
  }

  /**
   * 权益探测: getAllValidReminders() 成功 → 支持; 抛错 → 不支持 (缓存).
   * 失败不抛错, 返回 false.
   */
  async isSupported(): Promise<boolean> {
    if (this.supportedCache !== null) {
      return this.supportedCache;
    }
    try {
      await reminderAgentManager.getAllValidReminders();
      this.supportedCache = true;
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.warn(
        DOMAIN,
        TAG,
        'agent not supported (entitlement not provisioned): code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
      this.supportedCache = false;
    }
    return this.supportedCache;
  }

  /**
   * 调度定时提醒 (去重 + 无权益安全降级).
   *
   * 安全降级契约 (不可破坏):
   * - 权益不可用 → {skipped:true, reason}, 绝不 publish.
   * - publish 抛错 → {skipped:true, reason}, 绝不重试为立即通知.
   *
   * @param reminderId Web 侧标识 (BridgeInputValidator.validateReminderId 已校验).
   * @param triggerAt 未来触发时间戳 (validateReminderTime 已校验).
   * @param title 提醒标题 (通知文案).
   * @param content 提醒正文.
   */
  async publishReminder(
    reminderId: string,
    triggerAt: number,
    title: string,
    content: string
  ): Promise<ScheduleReminderResult> {
    try {
      await this.ensurePrefs();
      const supported: boolean = await this.isSupported();
      if (!supported) {
        return { skipped: true, reason: 'reminderAgent entitlement not provisioned' };
      }
      // 去重: 同 id 已存在时先取消旧提醒再发布新提醒.
      const existing: ReminderEntry | null = await this.readEntry(reminderId);
      if (existing !== null) {
        try {
          await reminderAgentManager.cancelReminder(existing.systemId);
        } catch (e2) {
          const err2: BusinessError = e2 as BusinessError;
          hilog.warn(
            DOMAIN,
            TAG,
            'cancel stale reminder failed (continue publish): code=%{public}d msg=%{public}s',
            err2.code,
            err2.message
          );
        }
      }
      const seconds: number = Math.max(1, Math.ceil((triggerAt - Date.now()) / 1000));
      const timer: reminderAgentManager.ReminderRequestTimer = {
        reminderType: reminderAgentManager.ReminderType.REMINDER_TYPE_TIMER,
        triggerTimeInSeconds: seconds,
        title: title,
        content: content,
      };
      const systemId: number = await reminderAgentManager.publishReminder(timer);
      await this.writeEntry({ id: reminderId, systemId: systemId, triggerAt: triggerAt });
      hilog.info(
        DOMAIN,
        TAG,
        'publishReminder: id=%{public}s systemId=%{public}d triggerAt=%{public}d',
        reminderId,
        systemId,
        triggerAt
      );
      return { skipped: false, systemReminderId: systemId };
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'publishReminder failed: id=%{public}s code=%{public}d msg=%{public}s',
        reminderId,
        err.code,
        err.message
      );
      return { skipped: true, reason: err.message };
    }
  }

  /**
   * 取消定时提醒 (幂等: 不存在视为成功).
   */
  async cancelReminder(reminderId: string): Promise<CancelReminderResult> {
    try {
      await this.ensurePrefs();
      const existing: ReminderEntry | null = await this.readEntry(reminderId);
      if (existing === null) {
        return { ok: true };
      }
      await reminderAgentManager.cancelReminder(existing.systemId);
      await this.removeEntry(reminderId);
      hilog.info(DOMAIN, TAG, 'cancelReminder: id=%{public}s', reminderId);
      return { ok: true };
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'cancelReminder failed: id=%{public}s code=%{public}d msg=%{public}s',
        reminderId,
        err.code,
        err.message
      );
      return { ok: false, reason: err.message };
    }
  }

  /**
   * 启动对账恢复: 比对期望集合与系统实际集合, 补发缺失项.
   * 仅在权益可用时执行; 不支持时返回 {ok:true, restored:0, skipped:true}.
   */
  async restoreOnStartup(): Promise<RestoreOutcome> {
    try {
      await this.ensurePrefs();
      const supported: boolean = await this.isSupported();
      if (!supported) {
        return { ok: true, restored: 0, skipped: true };
      }
      const desired: ReminderEntry[] = await this.readAllEntries();
      const valid: reminderAgentManager.ReminderInfo[] =
        await reminderAgentManager.getAllValidReminders();
      let restored: number = 0;
      for (let i = 0; i < desired.length; i++) {
        const entry: ReminderEntry = desired[i];
        if (entry.triggerAt <= Date.now()) {
          // 期望时间已过期: 清理记录, 不补发.
          await this.removeEntry(entry.id);
          continue;
        }
        let found: boolean = false;
        for (let j = 0; j < valid.length; j++) {
          if (valid[j].reminderId === entry.systemId) {
            found = true;
            break;
          }
        }
        if (found) {
          continue;
        }
        const seconds: number = Math.max(1, Math.ceil((entry.triggerAt - Date.now()) / 1000));
        const timer: reminderAgentManager.ReminderRequestTimer = {
          reminderType: reminderAgentManager.ReminderType.REMINDER_TYPE_TIMER,
          triggerTimeInSeconds: seconds,
          title: 'Wordaydream',
          content: '复习提醒恢复',
        };
        const systemId: number = await reminderAgentManager.publishReminder(timer);
        await this.writeEntry({ id: entry.id, systemId: systemId, triggerAt: entry.triggerAt });
        restored++;
      }
      hilog.info(DOMAIN, TAG, 'restoreOnStartup: restored=%{public}d', restored);
      return { ok: true, restored: restored, skipped: false };
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.error(
        DOMAIN,
        TAG,
        'restoreOnStartup failed: code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
      return { ok: false, restored: 0, skipped: false };
    }
  }

  /** 已初始化则返回实例, 否则用已存 context 初始化 (无 context 返回 null). */
  private async ensurePrefs(): Promise<preferences.Preferences | null> {
    if (this.prefs !== null) {
      return this.prefs;
    }
    if (this.context === null) {
      return null;
    }
    return this.initialize(this.context);
  }

  /** 读取全部期望条目 (容错: 键不存在 / 解析失败返回 []). */
  private async readAllEntries(): Promise<ReminderEntry[]> {
    if (this.prefs === null) {
      return [];
    }
    const raw: preferences.ValueType = await this.prefs.get(REMINDERS_KEY, '');
    const str: string = typeof raw === 'string' ? raw : '';
    if (str.length === 0) {
      return [];
    }
    try {
      return JSON.parse(str) as ReminderEntry[];
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      hilog.warn(
        DOMAIN,
        TAG,
        'readAllEntries parse failed (reset): code=%{public}d msg=%{public}s',
        err.code,
        err.message
      );
      return [];
    }
  }

  /** 读取单个期望条目. */
  private async readEntry(reminderId: string): Promise<ReminderEntry | null> {
    const entries: ReminderEntry[] = await this.readAllEntries();
    for (let i = 0; i < entries.length; i++) {
      if (entries[i].id === reminderId) {
        return entries[i];
      }
    }
    return null;
  }

  /** 写入/更新单个期望条目. */
  private async writeEntry(entry: ReminderEntry): Promise<void> {
    if (this.prefs === null) {
      return;
    }
    const entries: ReminderEntry[] = await this.readAllEntries();
    const next: ReminderEntry[] = [];
    for (let i = 0; i < entries.length; i++) {
      if (entries[i].id !== entry.id) {
        next.push(entries[i]);
      }
    }
    next.push(entry);
    await this.prefs.put(REMINDERS_KEY, JSON.stringify(next));
    await this.prefs.flush();
  }

  /** 移除单个期望条目. */
  private async removeEntry(reminderId: string): Promise<void> {
    if (this.prefs === null) {
      return;
    }
    const entries: ReminderEntry[] = await this.readAllEntries();
    const next: ReminderEntry[] = [];
    for (let i = 0; i < entries.length; i++) {
      if (entries[i].id !== reminderId) {
        next.push(entries[i]);
      }
    }
    await this.prefs.put(REMINDERS_KEY, JSON.stringify(next));
    await this.prefs.flush();
  }
}
