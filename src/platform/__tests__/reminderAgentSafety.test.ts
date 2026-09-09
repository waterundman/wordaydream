/**
 * v0.5.0-harmony Stage 3 — T03 [critical]: ReminderAgentService 安全不变量
 *
 * 源码级守卫 (与 harmonyNotificationSafety.test.ts 同模式, ArkTS 无法在
 * vitest 中运行, 以源码结构断言安全契约):
 * - ReminderAgentService.publishReminder: 权益探测 (isSupported) 守卫先于
 *   reminderAgentManager.publishReminder 调用 — 无权益绝不真实发布.
 * - 不支持路径显式返回 { skipped: true, reason: '...entitlement not provisioned' }.
 * - HarmonyBridge.scheduleReviewReminder: validateReminderTime 校验先于
 *   ReminderAgentService 调用 — 过去时间在桥接层即被拒绝.
 *
 * 现有 NotificationService 安全守卫 (harmonyNotificationSafety.test.ts)
 * 保持不变并随全量测试运行 — 0 regression.
 *
 * 0 emoji. 0 改动既有源文件.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const reminderAgentSource = readFileSync(
  resolve(
    process.cwd(),
    'harmony/entry/src/main/ets/notification/ReminderAgentService.ets',
  ),
  'utf8',
);

const bridgeSource = readFileSync(
  resolve(process.cwd(), 'harmony/entry/src/main/ets/bridge/HarmonyBridge.ets'),
  'utf8',
);

describe('Stage 3 — T03 [critical]: reminderAgent safety invariants', () => {
  it('publishReminder 中权益探测守卫先于真实 publish 调用', () => {
    const supportedProbe = reminderAgentSource.indexOf('await this.isSupported()');
    const unsupportedGuard = reminderAgentSource.indexOf('if (!supported)');
    const publish = reminderAgentSource.indexOf(
      'await reminderAgentManager.publishReminder(timer)',
    );

    expect(supportedProbe).toBeGreaterThanOrEqual(0);
    expect(unsupportedGuard).toBeGreaterThan(supportedProbe);
    expect(publish).toBeGreaterThan(unsupportedGuard);
  });

  it('不支持路径显式返回 skipped:true 且携带权益缺失原因 (安全降级契约)', () => {
    expect(reminderAgentSource).toContain(
      "reason: 'reminderAgent entitlement not provisioned'",
    );
    // publish 抛错路径同样降级为 skipped (不 fallback 为立即通知)
    expect(reminderAgentSource).toContain("return { skipped: true, reason: err.message };");
  });

  it('publishReminder 异常路径不抛错 (全部 try/catch 兜底)', () => {
    const publishMethod = reminderAgentSource.slice(
      reminderAgentSource.indexOf('async publishReminder('),
      reminderAgentSource.indexOf('async cancelReminder('),
    );
    expect(publishMethod).toContain('} catch (e) {');
    expect(publishMethod).not.toContain('throw');
  });

  it('HarmonyBridge.scheduleReviewReminder: 时间校验先于 ReminderAgentService 调用', () => {
    const method = bridgeSource.slice(
      bridgeSource.indexOf('async scheduleReviewReminder('),
      bridgeSource.indexOf('async cancelReviewReminder('),
    );
    const timeGuard = method.indexOf('validateReminderTime(triggerAt, Date.now())');
    const serviceCall = method.indexOf('publishReminder(');

    expect(timeGuard).toBeGreaterThan(0);
    expect(serviceCall).toBeGreaterThan(timeGuard);
  });

  it('HarmonyBridge.scheduleReviewReminder: 过去时间拒绝路径返回 skipped', () => {
    const method = bridgeSource.slice(
      bridgeSource.indexOf('async scheduleReviewReminder('),
      bridgeSource.indexOf('async cancelReviewReminder('),
    );
    expect(method).toContain("reason: 'triggerAt must be a future time'");
  });
});
