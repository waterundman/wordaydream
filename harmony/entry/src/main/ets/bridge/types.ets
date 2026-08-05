/**
 * ReminderPayload (v0.1.0-harmony Stage 3)
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
