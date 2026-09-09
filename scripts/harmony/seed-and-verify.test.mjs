/**
 * v0.5.0-harmony Stage 4 — T03 [non-critical]: 运行验证脚本纯函数
 *
 * 覆盖 scripts/harmony/seed-and-verify.mjs 与 collect-perf.mjs 的可测单元:
 * - parseArgs 默认值 / 覆盖 / 超时解析
 * - buildSkipReport 结构 (模拟器不在线 SKIP 契约: skipped=true, ok=true)
 * - evaluateAssertion 关键词命中 / 未命中
 * - ASSERTION_KEYWORDS 验证链完整性 (A1-A5)
 * - computeColdStartMs 时间戳差计算 (含跨午夜保护)
 * - extractPssKb hidumper 输出解析
 *
 * 0 emoji. 0 改动源文件.
 */
import { describe, expect, it } from 'vitest';
import {
  parseArgs,
  buildSkipReport,
  evaluateAssertion,
  ASSERTION_KEYWORDS,
} from './seed-and-verify.mjs';
import {
  parseArgs as parsePerfArgs,
  buildSkipReport as buildPerfSkip,
  computeColdStartMs,
  extractPssKb,
} from './collect-perf.mjs';

describe('Stage 4 — T03 [non-critical]: seed-and-verify script units', () => {
  it('parseArgs 返回默认值 (无参数)', () => {
    const a = parseArgs([]);
    expect(a.hdc).toBe('hdc');
    expect(a.bundle).toBe('com.wordaydream.app');
    expect(a.timeoutMs).toBe(60000);
    expect(a.out).toBeNull();
  });

  it('parseArgs 解析覆盖参数', () => {
    const a = parseArgs(['--hdc', 'C:/x/hdc.exe', '--bundle', 'b.name', '--timeout', '30000', '--out', 'r.json']);
    expect(a.hdc).toBe('C:/x/hdc.exe');
    expect(a.bundle).toBe('b.name');
    expect(a.timeoutMs).toBe(30000);
    expect(a.out).toBe('r.json');
  });

  it('parseArgs 非法 timeout 回退默认值', () => {
    const a = parseArgs(['--timeout', 'abc']);
    expect(a.timeoutMs).toBe(60000);
  });

  it('buildSkipReport: skipped=true, ok=true, steps 空 (SKIP 不视为失败)', () => {
    const r = buildSkipReport('no device', { hap: 'x.hap', bundle: 'b' });
    expect(r.skipped).toBe(true);
    expect(r.ok).toBe(true);
    expect(r.reason).toBe('no device');
    expect(r.steps).toEqual([]);
    expect(r.hap).toBe('x.hap');
  });

  it('evaluateAssertion: 命中 true / 未命中 false', () => {
    expect(evaluateAssertion('Web content ready', '... Web content ready ...')).toBe(true);
    expect(evaluateAssertion('Web content ready', 'nothing here')).toBe(false);
  });

  it('ASSERTION_KEYWORDS 验证链 A1-A5 完整', () => {
    const ids = ASSERTION_KEYWORDS.map((k) => k.id);
    expect(ids).toEqual(['A1', 'A2', 'A3', 'A4', 'A5']);
    expect(ASSERTION_KEYWORDS[0].keyword).toBe('seedDebugCards done');
  });
});

describe('Stage 4 — T03 [non-critical]: collect-perf script units', () => {
  it('parsePerfArgs 默认值与覆盖', () => {
    const d = parsePerfArgs([]);
    expect(d.bundle).toBe('com.wordaydream.app');
    const o = parsePerfArgs(['--bundle', 'x.y', '--timeout', '10000']);
    expect(o.bundle).toBe('x.y');
    expect(o.timeoutMs).toBe(10000);
  });

  it('buildPerfSkip: skipped=true 结构', () => {
    const r = buildPerfSkip('offline', { bundle: 'b' });
    expect(r.skipped).toBe(true);
    expect(r.ok).toBe(true);
  });

  it('computeColdStartMs: 同分钟时间戳差正确', () => {
    const log = [
      '09-09 17:00:00.100  Page begin',
      '09-09 17:00:02.600  Web content ready',
    ].join('\n');
    expect(computeColdStartMs(log)).toBe(2500);
  });

  it('computeColdStartMs: 无时间戳返回 null (跨午夜保护)', () => {
    expect(computeColdStartMs('no timestamps here')).toBeNull();
    // HH:MM:SS 无日期: 跨午夜窗口的 min/max 差 > 1h, 被 1h 保护正确拦截为 null.
    const crossMidnight = [
      '09-09 23:59:59.900  a',
      '09-10 00:01:59.900  b',
    ].join('\n');
    expect(computeColdStartMs(crossMidnight)).toBeNull();
  });

  it('extractPssKb: 解析 TOTAL PSS 行, 未命中返回 null', () => {
    expect(extractPssKb('TOTAL PSS: 123456 KB\nother')).toBe(123456);
    expect(extractPssKb('nothing')).toBeNull();
  });
});
