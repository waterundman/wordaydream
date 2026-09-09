/**
 * check-version-alignment.test.mjs
 *
 * v0.5.0-harmony Stage 1 版本对齐校验单测 (T01/T02/T03)。
 * 直接 import 纯函数 checkAlignment(versions)，不启动子进程。
 */

import { describe, it, expect } from 'vitest';
import { checkAlignment } from './check-version-alignment.mjs';

describe('checkAlignment (版本策略统一)', () => {
  // T01 (critical): 一致版本集合
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

  // T02 (critical): 任一处错位
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

  // T03 (non-critical): patch 不一致
  it('T03: web patch 不一致(2.5.1 vs harmony 0.5.0) → ok=false', () => {
    const versions = {
      web: '2.5.1',
      appScope: '0.5.0',
      entry: '0.5.0',
    };
    const { ok, diffs } = checkAlignment(versions);
    expect(ok).toBe(false);
    // web.major-2=0, minor=5, patch=0 期望 -> 期望 0.5.0, 实际 0.5.0? 不对
    // 注意: appScope/entry 实际为 0.5.0, 期望应为 web 推导的 0.5.1, 故 mismatch
    const hit = diffs.find((d) => d.source === 'appScope');
    expect(hit).toBeDefined();
    expect(hit.expected).toBe('0.5.1');
    expect(hit.actual).toBe('0.5.0');
  });
});
