import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const notificationSource = readFileSync(
  resolve(
    process.cwd(),
    'harmony/entry/src/main/ets/notification/NotificationService.ets',
  ),
  'utf8',
);

const reminderAgentSource = readFileSync(
  resolve(
    process.cwd(),
    'harmony/entry/src/main/ets/notification/ReminderAgentService.ets',
  ),
  'utf8',
);

describe('Harmony notification safety invariants', () => {
  it('never publishes a future reminder as an immediate notification', () => {
    // v0.5.0-harmony 技术债修复 M2: 旧的 computeTriggerAt/applyWindow 跨天推算死逻辑
    // 已删除 (notificationManager 无延迟调度能力, 推算出的未来时刻只能被错误地立即发布).
    // 等价强度改为断言新结构: 发布入口前必须依次通过三道守卫, 且未来到期分支早退.
    const schedule = notificationSource.slice(
      notificationSource.indexOf('async scheduleReviewReminder('),
      notificationSource.indexOf('async cancelReminder('),
    );
    const disabledGuard = schedule.indexOf('if (!win.enabled)');
    const futureGuard = schedule.indexOf('if (dueAt - now >= MIN_DELAY_MS)');
    const quietHoursGuard = schedule.indexOf('if (!this.isInNotificationWindow(now, win))');
    const publish = schedule.indexOf('await notificationManager.publish(request)');

    expect(disabledGuard).toBeGreaterThanOrEqual(0);
    expect(futureGuard).toBeGreaterThan(disabledGuard);
    expect(quietHoursGuard).toBeGreaterThan(futureGuard);
    expect(publish).toBeGreaterThan(quietHoursGuard);

    // 未来到期分支: 记 warn 后 return, 且明确把责任指向 ReminderAgentService
    const futureBranch = schedule.slice(futureGuard, quietHoursGuard);
    expect(futureBranch).toContain('hilog.warn');
    expect(futureBranch).toContain('skipped future delivery');
    expect(futureBranch).toContain('ReminderAgentService');
    expect(futureBranch).toContain('return;');
    // 静音时段分支同样早退, 不发布
    expect(schedule.slice(quietHoursGuard, publish)).toContain('return;');
    // 方法内 publish 只有一个出口, 且位于全部守卫之后
    expect((schedule.match(/notificationManager\.publish\(/g) || []).length).toBe(1);

    // 死逻辑不得回流
    expect(notificationSource).not.toContain('computeTriggerAt');
    expect(notificationSource).not.toContain('applyWindow');
    expect(notificationSource).not.toContain('atHour');
    expect(notificationSource).not.toContain('MS_PER_DAY');
    // 时间窗判断收敛为单一纯函数 (定义 + 唯一调用点)
    expect(notificationSource).toContain(
      'private isInNotificationWindow(now: number, win: NotificationWindow): boolean {',
    );
    expect((notificationSource.match(/isInNotificationWindow/g) || []).length).toBe(2);
  });

  it('future reminders go through ReminderAgentService and skip safely without entitlement', () => {
    // 权益探测先于真实发布: 不支持时直接 return skipped, 绝不 publish.
    const publishReminder = reminderAgentSource.slice(
      reminderAgentSource.indexOf('async publishReminder('),
      reminderAgentSource.indexOf('async cancelReminder('),
    );
    const supportedProbe = publishReminder.indexOf('await this.isSupported()');
    const unsupportedGuard = publishReminder.indexOf('if (!supported)');
    const systemPublish = publishReminder.indexOf(
      'await reminderAgentManager.publishReminder(timer)',
    );
    expect(supportedProbe).toBeGreaterThanOrEqual(0);
    expect(unsupportedGuard).toBeGreaterThan(supportedProbe);
    expect(systemPublish).toBeGreaterThan(unsupportedGuard);
    // 不支持分支: skipped 降级且不含任何发布调用
    const skippedBranch = publishReminder.slice(
      unsupportedGuard,
      publishReminder.indexOf('const existing'),
    );
    expect(skippedBranch).toContain('return { skipped: true');
    expect(skippedBranch).toContain('reminderAgent entitlement not provisioned');
    expect(skippedBranch).not.toContain('publishReminder(');
    // reminderAgent 侧绝不降级调用 notificationManager (立即通知不是 fallback 路径)
    expect(reminderAgentSource).not.toContain('notificationManager');
    // 启动对账同样先探测权益, 不支持时 skipped
    const restore = reminderAgentSource.slice(
      reminderAgentSource.indexOf('async restoreOnStartup('),
      reminderAgentSource.indexOf('private async ensurePrefs('),
    );
    const restoreProbe = restore.indexOf('await this.isSupported()');
    const restoreSkip = restore.indexOf('return { ok: true, restored: 0, skipped: true }');
    const restorePublish = restore.indexOf(
      'await reminderAgentManager.publishReminder(timer)',
    );
    expect(restoreProbe).toBeGreaterThanOrEqual(0);
    expect(restoreSkip).toBeGreaterThan(restoreProbe);
    expect(restorePublish).toBeGreaterThan(restoreSkip);
  });

  it('cancels only the review notification owned by this service', () => {
    expect(notificationSource).not.toContain('notificationManager.cancelAll()');
    expect(notificationSource).toContain('await this.cancelReminder(REMINDER_TAG)');
  });
});
