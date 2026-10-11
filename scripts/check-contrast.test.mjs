/**
 * check-contrast.mjs 单测 (v1.6.6 对比度闸门)
 *
 * 覆盖: tokens.css 三主题解析 / var() 别名链取值 / 色值格式解析 / WCAG 比值已知锚点 /
 * 棘轮判定 (新增回归必须被抓, 修好的必须提示收紧)。
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BASELINE_FAILURES,
  CONTRAST_CASES,
  contrastRatio,
  diffAgainstBaseline,
  evaluate,
  parseThemeTokens,
  resolveToken,
  toRgb,
} from './check-contrast.mjs';

const ROOT = process.cwd();
const tokens = parseThemeTokens(
  readFileSync(join(ROOT, 'src/styles/tokens.css'), 'utf-8')
);

describe('check-contrast: tokens.css 解析', () => {
  it('三主题各自成表, dark/sepia 在 base 之上叠加覆盖', () => {
    expect(Object.keys(tokens)).toEqual(['base', 'dark', 'sepia']);
    expect(tokens.base['--color-paper']).toBe('#faf9f5');
    expect(tokens.dark['--color-paper']).not.toBe(tokens.base['--color-paper']);
    expect(tokens.sepia['--color-paper']).not.toBe(tokens.base['--color-paper']);
    // 未覆盖的 token 应继续沿用 base
    expect(tokens.dark['--radius-sm']).toBe(tokens.base['--radius-sm']);
  });

  it('沿 var() 别名链取到字面色', () => {
    expect(resolveToken(tokens.base, '--color-bg')).toBe('#faf9f5');
    expect(resolveToken(tokens.base, '--color-text-primary')).toBe('#1b1b19');
    expect(resolveToken(tokens.base, '--color-does-not-exist')).toBeNull();
  });
});

describe('check-contrast: 色值与比值', () => {
  it('支持 #rgb / #rrggbb / rgb() / rgba(), 拒绝无法解析的输入', () => {
    expect(toRgb('#fff')).toEqual([255, 255, 255]);
    expect(toRgb('#faf9f5')).toEqual([250, 249, 245]);
    expect(toRgb('rgb(10, 20, 30)')).toEqual([10, 20, 30]);
    expect(toRgb('rgba(10, 20, 30, 0.5)')).toEqual([10, 20, 30]);
    expect(toRgb('red')).toBeNull();
    expect(toRgb(null)).toBeNull();
  });

  it('黑白为 21:1, 同色为 1:1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#123456', '#123456')).toBeCloseTo(1, 5);
  });

  it('解析不出色值时返回 null 而不是抛错', () => {
    expect(contrastRatio('red', '#ffffff')).toBeNull();
  });

  it('锚点: 强调色作正文在 base 页面底上不达 AA (这正是被量化的债)', () => {
    const r = contrastRatio('#d97757', '#faf9f5');
    expect(r).not.toBeNull();
    expect(r).toBeGreaterThan(2.5);
    expect(r).toBeLessThan(3.5);
  });
});

describe('check-contrast: 全量测量与棘轮', () => {
  const rows = evaluate(tokens);

  it('每个主题 × 每个案例都有一条测量, 且案例 id 唯一', () => {
    expect(rows).toHaveLength(CONTRAST_CASES.length * 3);
    expect(new Set(CONTRAST_CASES.map((c) => c.id)).size).toBe(CONTRAST_CASES.length);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  });

  it('基线与实测一致: 既不虚报也不漏报存量不达标', () => {
    const failing = rows.filter((r) => r.status === 'fail').map((r) => r.key).sort();
    expect(failing).toEqual([...BASELINE_FAILURES].sort());
  });

  it('新增不达标一定被 regressed 抓到', () => {
    const synthetic = [
      ...rows,
      { key: 'base:brand-new-case', theme: 'base', status: 'fail', ratio: 1.2, need: 4.5 },
    ];
    const { regressed } = diffAgainstBaseline(synthetic);
    expect(regressed).toEqual(['base:brand-new-case']);
  });

  it('基线项转达标后提示收紧 (要求从 BASELINE_FAILURES 删除)', () => {
    const allPass = rows.map((r) => ({ ...r, status: 'pass' }));
    const { regressed, fixed } = diffAgainstBaseline(allPass);
    expect(regressed).toEqual([]);
    expect([...fixed].sort()).toEqual([...BASELINE_FAILURES].sort());
  });

  it('取不到字面色的案例进 unknown 并被显式报告, 不静默放行', () => {
    const { unknown } = diffAgainstBaseline([
      { key: 'dark:mystery-token', status: 'unknown' },
    ]);
    expect(unknown).toEqual(['dark:mystery-token']);
  });
});
