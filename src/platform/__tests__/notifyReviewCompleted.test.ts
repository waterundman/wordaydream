/**
 * v0.5.0-harmony Stage 2 — T01 [critical]: 无原生桥环境 notifyReviewCompleted no-op
 *
 * 验证 Web 侧 notifyReviewCompleted 在非鸿蒙 / 无 bridge 环境:
 * - 返回 no-op 标记 { ok: true, noop: true }
 * - 绝不抛错 (不影响复习主流程)
 *
 * 0 emoji. 0 改动源文件.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import {
  detectPlatform,
  _resetPlatformCache,
} from '../detect';
import { notifyReviewCompleted } from '../harmonyBridge';

describe('Stage 2 — T01 [critical]: notifyReviewCompleted no-op in non-bridge env', () => {
  beforeEach(() => {
    // 重置平台探测缓存, 保证使用干净环境
    _resetPlatformCache();
    // 确保无原生桥 (Web / 浏览器环境)
    delete (window as unknown as { harmonyBridge?: unknown }).harmonyBridge;
  });

  it('非鸿蒙环境 isHarmonyOS() = false, getNativeBridge() = null', () => {
    const cap = detectPlatform();
    expect(cap.isHarmonyOS()).toBe(false);
    expect(cap.getNativeBridge()).toBeNull();
  });

  it('调用返回 no-op 标记且不抛错', async () => {
    const res = await notifyReviewCompleted();
    expect(res.ok).toBe(true);
    expect(res.noop).toBe(true);
    expect(res.reason).toBeUndefined();
  });

  it('重复调用均稳定返回 no-op', async () => {
    const a = await notifyReviewCompleted();
    const b = await notifyReviewCompleted();
    expect(a).toEqual({ ok: true, noop: true });
    expect(b).toEqual({ ok: true, noop: true });
  });

  it('不抛错 (promise 始终 resolve)', async () => {
    await expect(notifyReviewCompleted()).resolves.toBeDefined();
  });
});
