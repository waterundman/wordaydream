/**
 * v2.1.0 Stage 4 (Contract 68): package.json version 测试
 *
 * 覆盖 test_spec:
 * - T22: package.json version === "2.2.0" (v2.2.0 Stage 4 bump)
 *
 * 实现:
 * - tsconfig.app.json 未启用 resolveJsonModule, 用 node:fs readFileSync 替代 JSON import
 * - 测试文件位于 src/package.test.ts, ../package.json 指向项目根
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf-8')) as {
  version: string;
};

describe('package.json version (v2.1.0 Stage 4 Contract 68)', () => {
  it('T22: version === "2.2.0"', () => {
    expect(pkg.version).toBe('2.2.2');
  });
});
