/**
 * v0.5.0-harmony Stage 3 — T01 [critical] + T04 [non-critical]
 *
 * T01 [critical]: 无原生桥环境 requestNotificationPermission /
 *   scheduleReviewReminder / cancelReviewReminder 的 no-op 安全契约:
 *   - 不抛错, 返回稳定 no-op 标记
 *   - 有桥但方法未注入 (旧版原生桥) 时同样安全降级
 *   - 有桥且方法存在时透传结果; 原生抛错转为失败结果不向上传播
 *
 * T04 [non-critical]: validateReminderTime / validateReminderId 参数校验:
 *   - 过去时间被拒绝 (防止"未来提醒"被误发布, 安全契约)
 *   - 超过 1 年提前量被拒绝
 *   - reminderId 白名单字符集
 *
 * 0 emoji. 0 改动既有源文件.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import {
  _resetPlatformCache,
} from '../detect';
import {
  requestNotificationPermission,
  scheduleReviewReminder,
  cancelReviewReminder,
  type HarmonyBridge,
} from '../harmonyBridge';
import { validateReminderTime, validateReminderId } from '../bridgeInputValidator';

type BridgeWindow = Window & { harmonyBridge?: HarmonyBridge };

function injectBridge(bridge: Partial<HarmonyBridge>): void {
  (window as BridgeWindow).harmonyBridge = bridge as HarmonyBridge;
}

function clearBridge(): void {
  delete (window as BridgeWindow).harmonyBridge;
}

beforeEach(() => {
  _resetPlatformCache();
  clearBridge();
});

describe('Stage 3 — T01 [critical]: notification permission no-op contract', () => {
  it('无桥环境 requestNotificationPermission 返回 granted + noop 且不抛错', async () => {
    await expect(requestNotificationPermission()).resolves.toEqual({
      state: 'granted',
      noop: true,
    });
  });

  it('无桥环境 scheduleReviewReminder 返回 skipped + noop 且不抛错', async () => {
    await expect(scheduleReviewReminder('review-daily', Date.now() + 60_000)).resolves.toEqual({
      skipped: true,
      noop: true,
    });
  });

  it('无桥环境 cancelReviewReminder 返回 ok + noop (幂等成功) 且不抛错', async () => {
    await expect(cancelReviewReminder('review-daily')).resolves.toEqual({
      ok: true,
      noop: true,
    });
  });

  it('有桥但新方法未注入 (旧版原生桥) 时同样安全降级', async () => {
    injectBridge({});
    await expect(requestNotificationPermission()).resolves.toEqual({
      state: 'granted',
      noop: true,
    });
    await expect(scheduleReviewReminder('review-daily', Date.now() + 60_000)).resolves.toEqual({
      skipped: true,
      noop: true,
    });
    await expect(cancelReviewReminder('review-daily')).resolves.toEqual({
      ok: true,
      noop: true,
    });
  });

  it('原生方法存在时透传结果 (granted / 发布成功 / 取消成功)', async () => {
    injectBridge({
      requestNotificationPermission: () => Promise.resolve({ state: 'granted' }),
      scheduleReviewReminder: () =>
        Promise.resolve({ skipped: false, systemReminderId: 42 }),
      cancelReviewReminder: () => Promise.resolve({ ok: true }),
    });
    await expect(requestNotificationPermission()).resolves.toEqual({ state: 'granted' });
    await expect(scheduleReviewReminder('review-daily', Date.now() + 60_000)).resolves.toEqual({
      skipped: false,
      systemReminderId: 42,
    });
    await expect(cancelReviewReminder('review-daily')).resolves.toEqual({ ok: true });
  });

  it('原生返回 skipped:true (无权益降级) 时原样透传 — 安全降级契约', async () => {
    injectBridge({
      scheduleReviewReminder: () =>
        Promise.resolve({ skipped: true, reason: 'reminderAgent entitlement not provisioned' }),
    });
    await expect(scheduleReviewReminder('review-daily', Date.now() + 60_000)).resolves.toEqual({
      skipped: true,
      reason: 'reminderAgent entitlement not provisioned',
    });
  });

  it('原生方法抛错时转为失败结果, 不向上抛错', async () => {
    injectBridge({
      requestNotificationPermission: () => Promise.reject(new Error('bridge boom')),
      scheduleReviewReminder: () => Promise.reject(new Error('bridge boom')),
      cancelReviewReminder: () => Promise.reject(new Error('bridge boom')),
    });
    const perm = await requestNotificationPermission();
    expect(perm.state).toBe('error');
    expect(perm.reason).toBe('bridge boom');

    const sched = await scheduleReviewReminder('review-daily', Date.now() + 60_000);
    expect(sched.skipped).toBe(true);
    expect(sched.reason).toBe('bridge boom');

    const cancel = await cancelReviewReminder('review-daily');
    expect(cancel.ok).toBe(false);
    expect(cancel.reason).toBe('bridge boom');
  });
});

describe('Stage 3 — T04 [non-critical]: validateReminderTime / validateReminderId', () => {
  it('过去时间被拒绝 (安全契约: 未来提醒不得立即发布)', () => {
    const now = 1_700_000_000_000;
    expect(validateReminderTime(now - 1, now)).toBe(false);
    expect(validateReminderTime(now, now)).toBe(false);
  });

  it('未来时间 (<= 1 年) 通过', () => {
    const now = 1_700_000_000_000;
    expect(validateReminderTime(now + 60_000, now)).toBe(true);
    expect(validateReminderTime(now + 366 * 24 * 60 * 60 * 1000, now)).toBe(true);
  });

  it('超过 1 年提前量被拒绝', () => {
    const now = 1_700_000_000_000;
    expect(validateReminderTime(now + 366 * 24 * 60 * 60 * 1000 + 1, now)).toBe(false);
  });

  it('非法输入 (NaN / Infinity / 非 number) 被拒绝', () => {
    const now = 1_700_000_000_000;
    expect(validateReminderTime(Number.NaN, now)).toBe(false);
    expect(validateReminderTime(Number.POSITIVE_INFINITY, now)).toBe(false);
    expect(
      validateReminderTime('not-a-number' as unknown as number, now),
    ).toBe(false);
  });

  it('nowMs = -1 时内部取 Date.now()', () => {
    expect(validateReminderTime(Date.now() + 60_000, -1)).toBe(true);
    expect(validateReminderTime(Date.now() - 60_000, -1)).toBe(false);
  });

  it('reminderId 白名单: 合法标识符通过, 空串/超长/非法字符拒绝', () => {
    expect(validateReminderId('review-daily')).toBe(true);
    expect(validateReminderId('review.daily_1')).toBe(true);
    expect(validateReminderId('')).toBe(false);
    expect(validateReminderId('a'.repeat(129))).toBe(false);
    expect(validateReminderId('bad id!')).toBe(false);
    expect(validateReminderId('中文')).toBe(false);
  });
});
