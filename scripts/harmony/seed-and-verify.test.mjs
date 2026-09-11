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
  OPEN_CARD_ASSERTIONS,
  openCardEnabled,
  isCritical,
  collectReport,
  buildEvidence,
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

describe('v0.7.0-harmony Stage 1 — openCard 验证准备 (T01-T04)', () => {
  it('T01: parseArgs --open-card 默认 debug-seed-1 / 显式值生效 / 空串=跳过', () => {
    expect(parseArgs([]).openCard).toBe('debug-seed-1');
    expect(openCardEnabled(parseArgs([]))).toBe(true);

    const explicit = parseArgs(['--open-card', 'card-x']);
    expect(explicit.openCard).toBe('card-x');
    expect(openCardEnabled(explicit)).toBe(true);

    // 空串 -> 跳过标记 (openCard 阶段判断依据)
    const skip = parseArgs(['--open-card', '']);
    expect(skip.openCard).toBe('');
    expect(openCardEnabled(skip)).toBe(false);
  });

  it('T01: --open-card 缺值不消费 (保留默认)', () => {
    const a = parseArgs(['--open-card']);
    expect(a.openCard).toBe('debug-seed-1');
    expect(openCardEnabled(a)).toBe(true);
  });

  it('T02: critical FAIL -> 整体 ok=false', () => {
    const seed = [{ id: 'A1', passed: false, level: 'critical' }];
    const r = collectReport({ hap: 'x', bundle: 'b', timeoutMs: 1 }, [], seed, Date.now());
    expect(r.ok).toBe(false);
  });

  it('T02: 仅 soft FAIL -> ok=true, 且 soft 断言记录 passed:false + evidence 可用', () => {
    const seed = [{ id: 'A1', passed: true, level: 'critical' }];
    const oc = [
      { id: 'A6', keyword: 'dispatching query=action=openCard', desc: 'd', passed: true, level: 'critical' },
      { id: 'A7', keyword: '[harmonyLaunch] openCard', desc: 'd', passed: false, level: 'soft' },
    ];
    const r = collectReport(
      { hap: 'x', bundle: 'b', timeoutMs: 1 },
      [],
      seed,
      Date.now(),
      { openCardAssertions: oc, openCardQuery: 'action=openCard&cardId=debug-seed-1' },
    );
    expect(r.ok).toBe(true);
    expect(r.openCardAssertions[1].passed).toBe(false);
    expect(r.openCardAssertions[1].level).toBe('soft');
    // evidence 机制对 soft 同样可用
    expect(buildEvidence('... [harmonyLaunch] openCard located cardId=x ...', oc)['A7']).toBeTruthy();
  });

  it('T02: level 缺省视为 critical (向后兼容)', () => {
    expect(isCritical({ level: 'critical' })).toBe(true);
    expect(isCritical({ level: 'soft' })).toBe(false);
    expect(isCritical({})).toBe(true);
    expect(isCritical({ level: undefined })).toBe(true);
  });

  it('T03: 现有 ASSERTION_KEYWORDS A1-A5 结构与 level 兼容 (不回归)', () => {
    const ids = ASSERTION_KEYWORDS.map((k) => k.id);
    expect(ids).toEqual(['A1', 'A2', 'A3', 'A4', 'A5']);
    expect(ASSERTION_KEYWORDS[0].keyword).toBe('seedDebugCards done');
    expect(ASSERTION_KEYWORDS.every((k) => k.level === 'critical')).toBe(true);
  });

  it('T04: OPEN_CARD_ASSERTIONS A6 critical / A7 soft', () => {
    const ids = OPEN_CARD_ASSERTIONS.map((a) => a.id);
    expect(ids).toEqual(['A6', 'A7']);
    const a6 = OPEN_CARD_ASSERTIONS.find((a) => a.id === 'A6');
    const a7 = OPEN_CARD_ASSERTIONS.find((a) => a.id === 'A7');
    expect(a6.level).toBe('critical');
    expect(a6.keyword).toBe('dispatching query=action=openCard');
    expect(a7.level).toBe('soft');
    expect(a7.keyword).toBe('[harmonyLaunch] openCard');
  });

  it('T04: collectReport 报告段 openCardQuery/openCardAssertions 字段存在且结构正确', () => {
    const seed = [
      { id: 'A1', keyword: 'k', desc: 'd', level: 'critical', passed: true },
      { id: 'A5', keyword: 'k', desc: 'd', level: 'critical', passed: true },
    ];
    const oc = [
      { id: 'A6', keyword: 'k', desc: 'd', level: 'critical', passed: true },
      { id: 'A7', keyword: 'k', desc: 'd', level: 'soft', passed: true },
    ];
    const r = collectReport(
      { hap: 'x.hap', bundle: 'b', timeoutMs: 5000 },
      [{ name: 's', ok: true }],
      seed,
      Date.now(),
      { openCardAssertions: oc, openCardQuery: 'action=openCard&cardId=debug-seed-1' },
    );
    expect(r.openCardQuery).toBe('action=openCard&cardId=debug-seed-1');
    expect(Array.isArray(r.openCardAssertions)).toBe(true);
    expect(r.openCardAssertions).toHaveLength(2);
    expect(r.openCardAssertions[0].id).toBe('A6');
    expect(r.openCardAssertions[1].level).toBe('soft');
    // 向后兼容: 现有字段语义不变
    expect(r.skipped).toBe(false);
    expect(r.assertions).toBe(seed);
    expect(r.hap).toBe('x.hap');
    expect(r.timeoutMs).toBe(5000);
  });

  it('T04: collectReport 未启用 openCard -> 字段为 null', () => {
    const r = collectReport({ hap: 'x', bundle: 'b', timeoutMs: 1 }, [], [], Date.now());
    expect(r.openCardQuery).toBeNull();
    expect(r.openCardAssertions).toBeNull();
    expect(r.ok).toBe(true);
  });
});
