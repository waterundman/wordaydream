/**
 * v2.1.0 Stage 4 (Contract 68): package.json version 一致性测试
 *
 * v2.4.0 CI 重构 (2026-09): 原测试硬编码 version 字符串 ('2.2.0' -> '2.2.4' -> '2.3.0'
 * 一路漂移, 导致 Netlify CI vitest 步骤 7 周连续失败), 改为动态对比:
 *   package.json version === CHANGELOG.md 顶部 `## [x.y.z]` 条目
 * 未来 bump 只需改 package.json + CHANGELOG 各一处, 测试不再需要手改.
 *
 * 实现:
 * - tsconfig.app.json 未启用 resolveJsonModule, 用 node:fs readFileSync 替代 JSON import
 * - CHANGELOG 顶部版本用正则提取 (Keep a Changelog 格式: `## [2.3.0] — 2026-08-05`)
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '../..');

const pkg = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf-8')) as {
  version: string;
};

const changelog = readFileSync(resolve(projectRoot, 'CHANGELOG.md'), 'utf-8');
const changelogVersionMatch = changelog.match(/^## \[(\d+\.\d+\.\d+)\]/m);

describe('package.json version (v2.1.0 Stage 4 Contract 68)', () => {
  it('T22: package.json version 与 CHANGELOG 顶部版本一致', () => {
    expect(changelogVersionMatch, 'CHANGELOG.md 顶部应存在 `## [x.y.z]` 版本条目').toBeTruthy();
    expect(pkg.version).toBe(changelogVersionMatch![1]);
  });
});
