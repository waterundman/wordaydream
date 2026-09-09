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
