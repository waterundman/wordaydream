/**
 * v2.1.0 Stage 4 (Contract 68): package.json version 测试
 *
 * 覆盖 test_spec:
 * - T22: package.json version === "2.2.0" (v2.2.0 Stage 4 bump)
 *
 * v0.1.0-harmony Phase 5: bump 2.2.4 → 2.3.0 (为鸿蒙移植新增的 platform 抽象层 /
 * harmonyBridge / notifications 设置等向后兼容特性作 minor bump).
 *
 * 实现:
 * - tsconfig.app.json 未启用 resolveJsonModule, 用 node:fs readFileSync 替代 JSON import
 * - 测试文件位于 src/__tests__/package.test.ts, ../../package.json 指向项目根
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf-8')) as {
  version: string;
};

describe('package.json version (v2.1.0 Stage 4 Contract 68)', () => {
  it('T22: version === "2.3.0" (v0.1.0-harmony Phase 5 bump)', () => {
    expect(pkg.version).toBe('2.3.0');
  });
});