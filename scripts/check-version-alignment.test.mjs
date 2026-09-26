/**
 * check-version-alignment.test.mjs
 *
 * v0.5.0-harmony Stage 1 版本对齐校验单测 (T01/T02/T03) +
 * v0.7.0-harmony Stage 2 versionCode 规则 CI 化 (T01/T02/T03/T04) +
 * H8 修复: versionCode 盲区消除 —— major=1 线纳入映射校验 + 跨版本单调性护栏
 * (T05 1.x 锚点 / T06 未覆盖 major 必须失败 / T07 单调性 / T08 真源读取).
 * 直接 import 纯函数，不启动子进程 (readLastReleaseVersionCode 只读磁盘 JSON).
 *
 * 测试分组:
 *   T01 (critical): expectedVersionCode 0.x 线锚点 + patch
 *   T02 (critical): checkAlignment versionCode 错位
 *   T03 (critical): 跳过路径（versionCode 缺失 / versionName 缺失）
 *   T04 (critical): 现有 versionName 对齐/错位/patch 不回归
 *   T05-T08 (critical): H8 盲区与单调性
 */

import { describe, it, expect } from 'vitest';
import {
  checkAlignment,
  checkVersionCodeMonotonic,
  expectedVersionCode,
  readLastReleaseVersionCode,
  LAST_RELEASE_FILE,
} from './check-version-alignment.mjs';

describe('T01: expectedVersionCode 0.x 线线性规则四锚点', () => {
  it('0.3.0 → 1000000', () => {
    expect(expectedVersionCode('0.3.0')).toBe(1000000);
  });
  it('0.5.0 → 1000010', () => {
    expect(expectedVersionCode('0.5.0')).toBe(1000010);
  });
  it('0.6.0 → 1000015', () => {
    expect(expectedVersionCode('0.6.0')).toBe(1000015);
  });
  it('0.7.0 → 1000020', () => {
    expect(expectedVersionCode('0.7.0')).toBe(1000020);
  });
  it('含 patch: 0.7.1 → 1000021', () => {
    expect(expectedVersionCode('0.7.1')).toBe(1000021);
  });
  it('未覆盖 major (2.x / 非法) → 返回 null', () => {
    expect(expectedVersionCode('2.3.4')).toBe(null);
    expect(expectedVersionCode('v3.6.2')).toBe(null);
    expect(expectedVersionCode(undefined)).toBe(null);
  });
});

describe('T05: expectedVersionCode 1.x 线锚点 (H8 盲区消除)', () => {
  // 锚点表来源: docs/spec/v1.6.1/main.md §R10 (git 历史实测) + 当前 AppScope 1.6.2/1000075
  const anchors = [
    ['1.0.0', 1000035],
    ['1.1.0', 1000040],
    ['1.2.0', 1000045],
    ['1.3.0', 1000050],
    ['1.4.0', 1000055],
    ['1.5.0', 1000060],
    ['1.6.0', 1000065],
    ['1.6.1', 1000070],
    ['1.6.2', 1000075],
  ];
  it.each(anchors)('%s → %i', (versionName, expected) => {
    expect(expectedVersionCode(versionName)).toBe(expected);
  });
  it('1.x 线 patch/minor 步进均为 +5 (与 0.x 线 patch 步进 1 不同)', () => {
    expect(expectedVersionCode('1.6.3')).toBe(1000080);
    expect(expectedVersionCode('1.7.0')).toBe(1000070);
  });
  it('已知局限: 1.x 公式在「patch 发布后再跳 minor」时会给出回退值, 由单调性护栏兜底', () => {
    // 1.6.3 → 1000080, 但 1.7.0 → 1000070 < 1000080: 映射式无法预知发布顺序,
    // 此时 checkAlignment 必须因 versionCodeMonotonic 而 FAIL (而非静默放行).
    const { ok, diffs } = checkAlignment({
      web: '3.7.0',
      appScope: '1.7.0',
      entry: '1.7.0',
      versionCode: expectedVersionCode('1.7.0'),
      lastReleaseVersionCode: expectedVersionCode('1.6.3'),
    });
    expect(ok).toBe(false);
    expect(diffs.some((d) => d.source === 'versionCodeMonotonic')).toBe(true);
  });
});

describe('T02: checkAlignment versionCode 错位', () => {
  it('0.7.0 配 1000015（错位）→ ok=false 且 diffs 含 source:versionCode', () => {
    const versions = {
      web: '2.7.0', // 推导 harmony 期望 0.7.0，versionName 对齐
      appScope: '0.7.0',
      entry: '0.7.0',
      versionCode: 1000015, // 期望应为 1000020
    };
    const { ok, diffs } = checkAlignment(versions);
    expect(ok).toBe(false);
    const hit = diffs.find((d) => d.source === 'versionCode');
    expect(hit).toBeDefined();
    expect(hit.file).toBe('harmony/AppScope/app.json5');
    expect(hit.expected).toBe('1000020');
    expect(hit.actual).toBe('1000015');
  });

  it('数字字符串 versionCode 错位同样被检出', () => {
    const { ok, diffs } = checkAlignment({
      web: '2.7.0',
      appScope: '0.7.0',
      entry: '0.7.0',
      versionCode: '1000019', // 期望 1000020
    });
    expect(ok).toBe(false);
    const hit = diffs.find((d) => d.source === 'versionCode');
    expect(hit).toBeDefined();
    expect(hit.expected).toBe('1000020');
    expect(hit.actual).toBe('1000019');
  });

  it('H8: 1.x 线错位 (1.6.2 配 1000070) → ok=false 且期望 1000075', () => {
    const { ok, diffs } = checkAlignment({
      web: '3.6.2',
      appScope: '1.6.2',
      entry: '1.6.2',
      versionCode: 1000070,
    });
    expect(ok).toBe(false);
    const hit = diffs.find((d) => d.source === 'versionCode');
    expect(hit).toBeDefined();
    expect(hit.expected).toBe('1000075');
    expect(hit.actual).toBe('1000070');
  });

  it('H8: 当前真实基线 3.6.2/1.6.2/1000075 → ok=true (盲区不再存在)', () => {
    const { ok, diffs } = checkAlignment({
      web: '3.6.2',
      appScope: '1.6.2',
      entry: '1.6.2',
      versionCode: 1000075,
      lastReleaseVersionCode: 1000070,
    });
    expect(diffs).toEqual([]);
    expect(ok).toBe(true);
  });
});

describe('T06: 未覆盖 major 不再静默跳过 (H8)', () => {
  it('major=2 且携带 versionCode → ok=false 且 diffs 含 versionCodeRule', () => {
    const { ok, diffs } = checkAlignment({
      web: '4.0.0',
      appScope: '2.0.0',
      entry: '2.0.0',
      versionCode: 1000100,
    });
    expect(ok).toBe(false);
    const hit = diffs.find((d) => d.source === 'versionCodeRule');
    expect(hit).toBeDefined();
    expect(hit.actual).toContain('未覆盖');
  });

  it('major=2 但未携带 versionCode → 跳过 (纯 versionName 调用不回归)', () => {
    const { ok, diffs } = checkAlignment({
      web: '4.0.0',
      appScope: '2.0.0',
      entry: '2.0.0',
    });
    expect(ok).toBe(true);
    expect(diffs.find((d) => d.source === 'versionCodeRule')).toBeUndefined();
  });
});

describe('T07: versionCode 单调性 (H8)', () => {
  it('递增 → status ok, 无 diff 无告警', () => {
    const r = checkVersionCodeMonotonic(1000075, 1000070);
    expect(r.status).toBe('ok');
    expect(r.diff).toBeUndefined();
    expect(r.warning).toBeUndefined();
  });
  it('相等 → status equal + 告警 (发布前需递增), 不判失败', () => {
    const r = checkVersionCodeMonotonic(1000075, 1000075);
    expect(r.status).toBe('equal');
    expect(r.diff).toBeUndefined();
    expect(r.warning).toContain('发布前必须递增');
  });
  it('回退 → status behind + source versionCodeMonotonic 失败', () => {
    const r = checkVersionCodeMonotonic(1000070, 1000075);
    expect(r.status).toBe('behind');
    expect(r.diff.source).toBe('versionCodeMonotonic');
    expect(r.diff.file).toBe(LAST_RELEASE_FILE);
    expect(r.diff.expected).toContain('1000075');
    expect(r.diff.actual).toBe('1000070');
  });
  it('任一侧缺值 → skipped (向后兼容)', () => {
    expect(checkVersionCodeMonotonic(undefined, 1000070).status).toBe('skipped');
    expect(checkVersionCodeMonotonic(1000075, null).status).toBe('skipped');
  });
  it('checkAlignment 集成: 回退即 FAIL / 相等仅 warnings', () => {
    const behind = checkAlignment({
      web: '3.6.2',
      appScope: '1.6.2',
      entry: '1.6.2',
      versionCode: 1000070,
      lastReleaseVersionCode: 1000075,
    });
    expect(behind.ok).toBe(false);
    expect(behind.diffs.some((d) => d.source === 'versionCodeMonotonic')).toBe(true);

    const equal = checkAlignment({
      web: '3.6.2',
      appScope: '1.6.2',
      entry: '1.6.2',
      versionCode: 1000075,
      lastReleaseVersionCode: 1000075,
    });
    expect(equal.ok).toBe(true);
    expect(equal.warnings).toHaveLength(1);
    expect(equal.warnings[0]).toContain('1000075');
  });
});

describe('T08: last-release.json 真源可读', () => {
  it('磁盘上的真源可解析为数字且与当前 AppScope 同版本', () => {
    const code = readLastReleaseVersionCode();
    expect(Number.isFinite(code)).toBe(true);
    expect(code).toBeGreaterThanOrEqual(1000075);
  });
  it('真源不存在 → 抛错而非静默跳过', () => {
    expect(() => readLastReleaseVersionCode('/nonexistent-root-xyz')).toThrow(
      LAST_RELEASE_FILE,
    );
  });
});

describe('T03: 跳过路径', () => {
  it('versionCode 缺失 → 不 FAIL（仅 versionName 检查）', () => {
    const versions = {
      web: '2.5.0',
      appScope: '0.5.0',
      entry: '0.5.0',
      // 不携带 versionCode
    };
    const { ok, diffs } = checkAlignment(versions);
    expect(ok).toBe(true);
    expect(diffs.find((d) => d.source === 'versionCode')).toBeUndefined();
  });

  it('appScope 缺失（无法解析 harmony 版本名）→ versionCode 检查跳过且不 FAIL', () => {
    const { ok, diffs } = checkAlignment({
      web: '2.5.0',
      entry: '0.5.0',
      versionCode: 9999999,
    });
    expect(ok).toBe(true);
    expect(diffs.find((d) => d.source === 'versionCode')).toBeUndefined();
  });
});

describe('T04: 现有 versionName 对齐/错位/patch 不回归', () => {
  // 原 T01 (critical): 一致版本集合
  it('T01: 一致版本集合 → ok=true 且 diffs 为空', () => {
    const versions = {
      web: '2.5.0',
      appScope: '0.5.0',
      entry: '0.5.0',
    };
    const { ok, diffs } = checkAlignment(versions);
    expect(ok).toBe(true);
    expect(diffs).toEqual([]);
  });

  // 原 T02 (critical): 任一处错位
  it('T02: appScope 错位(0.3.0) → ok=false 且 diffs 含该文件路径与期望/实际值', () => {
    const versions = {
      web: '2.5.0',
      appScope: '0.3.0', // 错位
      entry: '0.5.0',
    };
    const { ok, diffs } = checkAlignment(versions);
    expect(ok).toBe(false);
    const hit = diffs.find((d) => d.source === 'appScope');
    expect(hit).toBeDefined();
    expect(hit.file).toBe('harmony/AppScope/app.json5');
    expect(hit.expected).toBe('0.5.0');
    expect(hit.actual).toBe('0.3.0');
  });

  // 原 T03 (non-critical): patch 不一致
  it('T03: web patch 不一致(2.5.1 vs harmony 0.5.0) → ok=false', () => {
    const versions = {
      web: '2.5.1',
      appScope: '0.5.0',
      entry: '0.5.0',
    };
    const { ok, diffs } = checkAlignment(versions);
    expect(ok).toBe(false);
    const hit = diffs.find((d) => d.source === 'appScope');
    expect(hit).toBeDefined();
    expect(hit.expected).toBe('0.5.1');
    expect(hit.actual).toBe('0.5.0');
  });
});
