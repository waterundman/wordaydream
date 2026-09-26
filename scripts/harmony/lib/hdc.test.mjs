/**
 * hdc.test.mjs — M6 共享底层单测 (scripts/harmony/lib/hdc.mjs)
 *
 * 覆盖被 seed-and-verify.mjs / collect-perf.mjs 共用的四件事:
 *   - createArgsParser : --flag 传参 (含 number 回退 / optional 空串 / boolean 别名)
 *   - isDeviceOnline   : 统一后的设备在线判定 (含 CONNECTED 分支与 [Empty] 空态)
 *   - buildSkipReport  : SKIP 报告骨架 + 各脚本专属字段
 *   - isCliInvocation  : 「直接运行 vs 被 import」判定 (Windows 盘符大小写不敏感)
 *   - runHdc/runHdcText: 真实子进程 (用 node 代替 hdc, 不依赖模拟器)
 *
 * 0 emoji. 0 网络/模拟器依赖 —— 离线可跑.
 */
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';

import {
  buildSkipReport,
  createArgsParser,
  isCliInvocation,
  isDeviceOnline,
  runHdc,
  runHdcText,
} from './hdc.mjs';

const seedParser = createArgsParser([
  { flag: '--hdc', key: 'hdc', default: 'hdc' },
  { flag: '--hap', key: 'hap', default: 'a.hap' },
  { flag: '--bundle', key: 'bundle', default: 'com.wordaydream.app' },
  { flag: '--timeout', key: 'timeoutMs', type: 'number', default: 60000 },
  { flag: '--out', key: 'out', default: null },
  { flag: '--open-card', key: 'openCard', type: 'optional', default: 'debug-seed-1' },
  { flag: '--help', key: 'help', type: 'boolean', aliases: ['-h'], default: false },
]);

describe('M6 createArgsParser', () => {
  it('无参数时返回全部默认值', () => {
    const args = seedParser([]);
    expect(args).toEqual({
      hdc: 'hdc',
      hap: 'a.hap',
      bundle: 'com.wordaydream.app',
      timeoutMs: 60000,
      out: null,
      openCard: 'debug-seed-1',
      help: false,
    });
  });

  it('字符串旗标覆盖 + 数值旗标解析', () => {
    const args = seedParser(['--hdc', 'C:/x/hdc.exe', '--bundle', 'b', '--timeout', '30000', '--out', 'r.json']);
    expect(args.hdc).toBe('C:/x/hdc.exe');
    expect(args.bundle).toBe('b');
    expect(args.timeoutMs).toBe(30000);
    expect(args.out).toBe('r.json');
  });

  it('非法 timeout 回退默认值 (与历史 Number(next)||DEFAULT 一致)', () => {
    expect(seedParser(['--timeout', 'abc']).timeoutMs).toBe(60000);
    expect(seedParser(['--timeout', '0']).timeoutMs).toBe(60000);
  });

  it('optional 旗标: 空串仍生效, 缺值或值本身是旗标时保留默认', () => {
    expect(seedParser(['--open-card', '']).openCard).toBe('');
    expect(seedParser(['--open-card', 'card-x']).openCard).toBe('card-x');
    expect(seedParser(['--open-card']).openCard).toBe('debug-seed-1');
    expect(seedParser(['--open-card', '--out', 'r.json']).openCard).toBe('debug-seed-1');
    // 不吞掉后一个旗标: --out 仍生效
    expect(seedParser(['--open-card', '--out', 'r.json']).out).toBe('r.json');
  });

  it('boolean 旗标与别名', () => {
    expect(seedParser(['--help']).help).toBe(true);
    expect(seedParser(['-h']).help).toBe(true);
  });

  it('未知旗标忽略', () => {
    expect(seedParser(['--nope', 'x']).hdc).toBe('hdc');
  });
});

describe('M6 isDeviceOnline (统一两处不一致判定)', () => {
  it('[Empty] / 空输出 / 仅空白 => 离线', () => {
    expect(isDeviceOnline('[Empty]\n', 0)).toBe(false);
    expect(isDeviceOnline('', 0)).toBe(false);
    expect(isDeviceOnline('   \n', 0)).toBe(false);
    expect(isDeviceOnline(undefined, 0)).toBe(false);
  });

  it('模拟器地址 / 真机序列号 / 带 CONNECTED 的行 => 在线', () => {
    expect(isDeviceOnline('127.0.0.1:5555\n', 0)).toBe(true);
    expect(isDeviceOnline('FMR0224C13000649\n', 0)).toBe(true);
    expect(isDeviceOnline('some-target\tCONNECTED\n', 0)).toBe(true);
  });

  it('退出码非 0 (含 hdc 不存在导致的 null) => 离线', () => {
    expect(isDeviceOnline('127.0.0.1:5555', 1)).toBe(false);
    expect(isDeviceOnline('127.0.0.1:5555', null)).toBe(false);
  });
});

describe('M6 buildSkipReport', () => {
  it('基础字段 skipped=true / ok=true / reason, 专属字段按传入顺序合并', () => {
    const report = buildSkipReport('offline', { bundle: 'b' }, {
      steps: [],
      assertions: [],
      generatedAt: null,
      hap: 'x.hap',
      bundle: 'b',
    });
    expect(report).toEqual({
      skipped: true,
      ok: true,
      reason: 'offline',
      steps: [],
      assertions: [],
      generatedAt: null,
      hap: 'x.hap',
      bundle: 'b',
    });
    // 字段顺序也是契约的一部分 (JSON 报告可读性): 不引入额外键
    expect(Object.keys(report)).toEqual([
      'skipped', 'ok', 'reason', 'steps', 'assertions', 'generatedAt', 'hap', 'bundle',
    ]);
  });

  it('perf 形态: metrics 空对象 + bundle', () => {
    expect(buildSkipReport('no emulator/device online', { bundle: 'b' }, {
      metrics: {},
      bundle: 'b',
    })).toEqual({
      skipped: true, ok: true, reason: 'no emulator/device online', metrics: {}, bundle: 'b',
    });
  });
});

describe('M6 isCliInvocation', () => {
  const selfPath = fileURLToPath(import.meta.url);

  it('argv[1] 指向本文件 => true', () => {
    expect(isCliInvocation(import.meta.url, selfPath)).toBe(true);
  });
  it('Windows 盘符大小写不同仍判定为同一入口', { skip: process.platform !== 'win32' }, () => {
    const flipped = selfPath.replace(/^([A-Za-z]:)/, (drive) =>
      drive[0] === drive[0].toUpperCase() ? drive.toLowerCase() : drive.toUpperCase(),
    );
    expect(flipped).not.toBe(selfPath);
    expect(isCliInvocation(import.meta.url, flipped)).toBe(true);
  });
  it('argv[1] 是别的文件 / 为空 => false (被 import 时不执行 CLI)', () => {
    expect(isCliInvocation(import.meta.url, undefined)).toBe(false);
    expect(isCliInvocation(import.meta.url, 'scripts/harmony/seed-and-verify.mjs')).toBe(false);
  });
});

describe('M6 runHdc / runHdcText (真实子进程, 不依赖 hdc)', () => {
  it('成功命令: 返回 code=0 与 stdout', () => {
    const result = runHdc(process.execPath, ['--version'], 10000);
    expect(result.code).toBe(0);
    expect(result.error).toBeNull();
    expect(result.stdout.trim()).toMatch(/^v\d+\./);
  });

  it('可执行文件不存在: 不抛异常, code=null + error 文案', () => {
    const result = runHdc('__definitely_not_a_real_binary__', ['list', 'targets'], 5000);
    expect(result.code).toBeNull();
    expect(typeof result.error).toBe('string');
    expect(isDeviceOnline(result.stdout, result.code)).toBe(false);
  });

  it('runHdcText 返回 stdout+stderr 合并文本', () => {
    expect(typeof runHdcText(process.execPath, ['--version'], 10000)).toBe('string');
  });
});
