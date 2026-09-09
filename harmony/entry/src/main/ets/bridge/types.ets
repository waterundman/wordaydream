/**
 * ReminderPayload (v0.1.0-harmony)
 *
 * ArkTS 侧提醒任务载荷, 与 src/platform/harmonyBridge.ts 的
 * ReminderPayload TS interface 字段一一对应 (dueAt: number, cardId: string).
 *
 * 由 HarmonyBridge.registerReminder 接收, 透传给 notificationManager (Stage 7).
 */
export interface ReminderPayload {
  /** 触发时间戳 (ms, epoch). */
  dueAt: number;
  /** 关联的记忆卡片 ID. */
  cardId: string;
}

/**
 * notifyReviewCompleted 返回结果 (v0.5.0-harmony Stage 2).
 *
 * Web 侧 completeReview 完成 → 原生主动刷新所有已持久化服务卡片.
 * 返回值遵循既有 ArkTS 桥接约定: 成功 {ok:true}, 失败 {ok:false, reason}.
 */
export interface NotifyReviewCompletedResult {
  /** 是否成功触发刷新 (或静默降级). */
  ok: boolean;
  /** 失败时的原因 (ok=false 时携带). */
  reason?: string;
}

/**
 * 通知权限请求结果 (v0.5.0-harmony Stage 3).
 *
 * NotificationService.requestEnableNotification 的三态结果, 经
 * HarmonyBridge.requestNotificationPermission 透传给 Web 设置面板.
 */
export type NotificationPermissionState = 'granted' | 'denied' | 'error';

export interface NotificationPermissionResult {
  /** 授权状态: granted / denied / error. */
  state: NotificationPermissionState;
  /** denied/error 时的补充说明 (如 BusinessError.message). */
  reason?: string;
}

/**
 * reminderAgent 定时提醒调度结果 (v0.5.0-harmony Stage 3).
 *
 * ReminderAgentService.publishReminder 的返回. 安全降级契约:
 * 权益不可用 / 系统不支持 / 发布抛错时返回 {skipped:true, reason},
 * 绝不真实发布, 绝不向上抛错.
 */
export interface ScheduleReminderResult {
  /** 是否被安全跳过 (权益不可用等). */
  skipped: boolean;
  /** 跳过/失败原因. */
  reason?: string;
  /** 系统侧 reminderId (publish 成功时携带). */
  systemReminderId?: number;
}

/** 取消定时提醒结果 (v0.5.0-harmony Stage 3). */
export interface CancelReminderResult {
  /** 是否成功取消 (或该 id 本就不存在, 视为幂等成功). */
  ok: boolean;
  /** 失败原因 (ok=false 时携带). */
  reason?: string;
}
