/**
 * v0.5.0-harmony Stage 2 — T03 [critical]: BridgeMethodRegistry 快照测试
 *
 * 单一事实来源: harmony/entry/src/main/ets/bridge/BridgeMethodRegistry.ets
 * 的 BRIDGE_ASYNC_METHODS / BRIDGE_SYNC_METHODS 数组.
 *
 * 注册表驱动 ArkWeb registerJavaScriptProxy (Index.ets 的
 * registerJavaScriptProxy(bridge, NAME, SYNC, ASYNC)), 新增桥接能力若漏注册
 * 则 Web 侧无法调用. 本测试镜像该契约, 断言:
 * - notifyReviewCompleted 已加入异步组 (Stage 2)
 * - Stage 3 新增 requestNotificationPermission / scheduleReviewReminder /
 *   cancelReviewReminder 三项
 * - 异步组总数 = 16 (原 12 + Stage 2 notifyReviewCompleted + Stage 3 x3)
 * - 同步组仍为 4 (两个 Stage 均未改动)
 *
 * 0 emoji. 0 改动源文件, 仅新增测试 (快照期望值更新为合法契约变更).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REGISTRY_PATH: string = join(
  process.cwd(),
  'harmony',
  'entry',
  'src',
  'main',
  'ets',
  'bridge',
  'BridgeMethodRegistry.ets'
);

function readRegistry(): string {
  return readFileSync(REGISTRY_PATH, 'utf-8');
}

/** 从 .ets 文本中提取某数组字面量的元素 (单引号字符串). */
function parseStringArray(content: string, constName: string): string[] {
  const marker: string = `export const ${constName}: string[] = [`;
  const start: number = content.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  const open: number = start + marker.length - 1; // 指向 '['
  const close: number = content.indexOf(']', open);
  expect(close).toBeGreaterThan(open);
  const body: string = content.substring(open + 1, close);
  const matches: RegExpMatchArray | null = body.match(/'([^']+)'/g);
  if (!matches) return [];
  return matches.map((m) => m.replace(/'/g, ''));
}

describe('Stage 2 — T03 [critical]: BridgeMethodRegistry 含 notifyReviewCompleted', () => {
  const content: string = readRegistry();
  const sync: string[] = parseStringArray(content, 'BRIDGE_SYNC_METHODS');
  const async: string[] = parseStringArray(content, 'BRIDGE_ASYNC_METHODS');

  it('BRIDGE_ASYNC_METHODS 包含新增的 notifyReviewCompleted', () => {
    expect(async).toContain('notifyReviewCompleted');
  });

  it('BRIDGE_ASYNC_METHODS 总数 = 16 (12 原方法 + Stage 2 x1 + Stage 3 x3)', () => {
    expect(async.length).toBe(16);
  });

  it('BRIDGE_ASYNC_METHODS 包含 Stage 3 新增的三项通知方法', () => {
    expect(async).toContain('requestNotificationPermission');
    expect(async).toContain('scheduleReviewReminder');
    expect(async).toContain('cancelReviewReminder');
  });

  it('BRIDGE_SYNC_METHODS 总数仍为 4 (本 Stage 未改动同步组)', () => {
    expect(sync.length).toBe(4);
  });

  it('notifyReviewCompleted 仅出现在异步组, 不重复于同步组', () => {
    expect(async).toContain('notifyReviewCompleted');
    expect(sync).not.toContain('notifyReviewCompleted');
  });

  it('既有异步方法未被移除 (speak / getAllCards / getTodayReviewStats)', () => {
    expect(async).toContain('speak');
    expect(async).toContain('getAllCards');
    expect(async).toContain('getTodayReviewStats');
  });
});
