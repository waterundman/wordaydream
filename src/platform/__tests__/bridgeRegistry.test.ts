/**
 * v0.5.0-harmony Stage 2 — T03 [critical]: BridgeMethodRegistry 契约测试
 *
 * 单一事实来源: harmony/entry/src/main/ets/bridge/BridgeMethodRegistry.ets
 * 的 BRIDGE_ASYNC_METHODS / BRIDGE_SYNC_METHODS 数组.
 *
 * 注册表驱动 ArkWeb registerJavaScriptProxy (Index.ets 的
 * registerJavaScriptProxy(bridge, NAME, SYNC, ASYNC)), 新增桥接能力若漏注册
 * 则 Web 侧无法调用. H7 防漂移: 方法名集合与分组 (sync/async) 全部由
 * readFileSync 解析 .ets 数组字面量 + src/platform/harmonyBridge.ts 的
 * HarmonyBridge interface 得出并双向断言, 不再硬编码数量.
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

const TS_BRIDGE_PATH: string = join(
  process.cwd(),
  'src',
  'platform',
  'harmonyBridge.ts'
);

const ETS_BRIDGE_PATH: string = join(
  process.cwd(),
  'harmony',
  'entry',
  'src',
  'main',
  'ets',
  'bridge',
  'HarmonyBridge.ets'
);

/**
 * 原生自用方法 (服务卡片 / 恢复推送在 ArkTS 侧调用, Web 侧零调用方):
 * 注册表保留, TS interface 不声明. 若原生侧删除实现, 下方守卫用例即失败,
 * 强制这份豁免清单同步收缩.
 */
const NATIVE_ONLY_METHODS: readonly string[] = [
  'getDueCardsCount',
  'getRecentlyReviewedCards',
  'getTodayReviewStats',
];

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

interface TsBridgeMember {
  name: string;
  optional: boolean;
  returnType: string;
}

/** 解析 src/platform/harmonyBridge.ts 的 HarmonyBridge interface 成员. */
function parseTsInterfaceMembers(): TsBridgeMember[] {
  const content: string = readFileSync(TS_BRIDGE_PATH, 'utf-8');
  const start: number = content.indexOf('export interface HarmonyBridge {');
  expect(start).toBeGreaterThan(-1);
  const rest: string = content.substring(start);
  const endMatch: RegExpExecArray | null = /^\}/m.exec(rest);
  expect(endMatch).not.toBeNull();
  const body: string = rest.substring(0, endMatch ? endMatch.index : 0);
  const memberPattern: RegExp =
    /^ {2}([a-zA-Z][\w]*)(\?)?\((?:[^)]*)\)\s*:\s*([^;]+);$/gm;
  const members: TsBridgeMember[] = [];
  let match: RegExpExecArray | null = memberPattern.exec(body);
  while (match !== null) {
    members.push({
      name: match[1],
      optional: match[2] === '?',
      returnType: match[3].trim(),
    });
    match = memberPattern.exec(body);
  }
  expect(members.length).toBeGreaterThan(0);
  return members;
}

describe('Stage 2 — T03 [critical]: BridgeMethodRegistry 含 notifyReviewCompleted', () => {
  const content: string = readRegistry();
  const sync: string[] = parseStringArray(content, 'BRIDGE_SYNC_METHODS');
  const async: string[] = parseStringArray(content, 'BRIDGE_ASYNC_METHODS');
  const tsMembers: TsBridgeMember[] = parseTsInterfaceMembers();
  const tsNames: string[] = tsMembers.map((m) => m.name);

  it('BRIDGE_ASYNC_METHODS 包含新增的 notifyReviewCompleted', () => {
    expect(async).toContain('notifyReviewCompleted');
  });

  it('BRIDGE_ASYNC_METHODS 包含 Stage 3 新增的三项通知方法', () => {
    expect(async).toContain('requestNotificationPermission');
    expect(async).toContain('scheduleReviewReminder');
    expect(async).toContain('cancelReviewReminder');
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

  it('T03 [critical]: 注册表两组无重复方法名', () => {
    const all: string[] = sync.concat(async);
    expect(new Set(all).size).toBe(all.length);
  });

  it('T03 [critical]: TS interface 方法名集合 == 注册表集合 - 原生自用清单 (双向)', () => {
    const registryNames: string[] = sync.concat(async);
    const expectedTsNames: string[] = registryNames.filter(
      (name) => !NATIVE_ONLY_METHODS.includes(name)
    );
    expect([...tsNames].sort()).toEqual([...expectedTsNames].sort());
    // 反向: 注册表不得出现 TS 与豁免清单之外的漏网方法
    expect(
      registryNames.filter((name) => !tsNames.includes(name)).sort()
    ).toEqual([...NATIVE_ONLY_METHODS].sort());
  });

  it('T03 [critical]: sync/async 分组与 TS 返回类型 (void / Promise) 一致', () => {
    const tsAsync = tsMembers
      .filter((m) => m.returnType.startsWith('Promise<'))
      .map((m) => m.name);
    const tsSync = tsMembers
      .filter((m) => !m.returnType.startsWith('Promise<'))
      .map((m) => m.name);
    expect([...async].sort()).toEqual(
      [...tsAsync.concat(NATIVE_ONLY_METHODS)].sort()
    );
    expect([...sync].sort()).toEqual([...tsSync].sort());
  });

  it('T03 [critical]: 可选 (旧版原生桥可能未注入) 成员仅限 Stage 2/3 通知方法', () => {
    const optional = tsMembers.filter((m) => m.optional).map((m) => m.name);
    expect([...optional].sort()).toEqual([
      'cancelReviewReminder',
      'notifyReviewCompleted',
      'requestNotificationPermission',
      'scheduleReviewReminder',
    ]);
  });

  it('T03 [critical]: 原生自用豁免清单仍在 ArkTS 桥实现中 (防豁免清单僵化)', () => {
    const bridgeSource: string = readFileSync(ETS_BRIDGE_PATH, 'utf-8');
    for (const name of NATIVE_ONLY_METHODS) {
      expect(bridgeSource).toContain(`async ${name}(`);
    }
  });
});
