/**
 * src/platform barrel (v0.1.0-harmony Stage 2)
 *
 * 导出 PlatformCapability / detectPlatform / HarmonyBridge / ReminderPayload.
 * (registerServiceWorker / _resetPlatformCache 为内部 / 测试辅助, 不在此导出.)
 */
export type { PlatformCapability } from './types';
export type { HarmonyBridge, ReminderPayload } from './harmonyBridge';
export { detectPlatform } from './detect';
