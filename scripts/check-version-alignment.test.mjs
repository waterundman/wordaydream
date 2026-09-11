/**
 * check-version-alignment.test.mjs
 *
 * v0.5.0-harmony Stage 1 版本对齐校验单测 (T01/T02/T03) +
 * v0.7.0-harmony Stage 2 versionCode 规则 CI 化 (T01/T02/T03/T04)。
 * 直接 import 纯函数 checkAlignment / expectedVersionCode，不启动子进程。
 *
 * 测试分组:
 *   T01 (critical): expectedVersionCode 四锚点 + patch
 *   T02 (critical): checkAlignment versionCode 错位
 *   T03 (critical): 跳过路径（versionCode 缺失 / harmony major≠0）
 *   T04 (critical): 现有 versionName 对齐/错位/patch 不回归
 */

import { describe, it, expect } from 'vitest';
import {
  checkAlignment,
  expectedVersionCode,
} from './check-version-alignment.mjs';

describe('T01: expectedVersionCode 线性规则四锚点', () => {
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
  it('harmony major≠0 → 返回 null（规则未覆盖）', () => {
    expect(expectedVersionCode('1.0.0')).toBe(null);
    expect(expectedVersionCode('2.3.4')).toBe(null);
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

  it('harmony major≠0 (1.0.0) → expectedVersionCode 返回 null 且不 FAIL', () => {
    expect(expectedVersionCode('1.0.0')).toBe(null);
    const versions = {
      web: '3.0.0', // 推导 harmony 期望 1.0.0
      appScope: '1.0.0',
      entry: '1.0.0',
      versionCode: 1000000, // 提供任意值，应被跳过
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
