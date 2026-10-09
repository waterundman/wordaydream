/**
 * check-theme-parity 单测 (v1.6.4 Stage 4 / S4)
 *
 * 设计要点（避免平凡通过）:
 * - 纯函数喂内存 fixture, 每条 parity 规则（P1 base-only / P2 半覆盖 / P3 反向孤儿）
 *   都给正例 + 反例, 反例必须真被拦下。
 * - 别名型 token（var()）与 transparent 关键字必须**不**被要求逐主题声明。
 * - 豁免表自身也要被校验: 条目失效（已在 dark/sepia 覆盖）→ staleAllowlist。
 * - T07 是真实仓库回归: 读 src/styles/tokens.css 断言差集为空。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  THEME_INVARIANT_COLOR_TOKENS,
  checkThemeParity,
  extractDeclarations,
  extractThemeBlocks,
  extractTopLevelBlocks,
  isLiteralColor,
  TOKENS_FILE,
} from './check-theme-parity.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

/** 三主题对称的最小 tokens.css（正例基线）。 */
const PARITY_OK_CSS = `:root {
  --color-paper: #faf9f5;
  --color-ink: #1b1b19;
  --color-surface-base: var(--color-paper);
  --color-underline-resolved: transparent;
}
:root[data-theme='dark'] {
  --color-paper: #1c1917;
  --color-ink: #faf8f5;
}
:root[data-theme='sepia'] {
  --color-paper: #f4ecd8;
  --color-ink: #5b4636;
}
`;

describe('check-theme-parity / 抽取器', () => {
  it('T01: 顶层块 / 声明 / 字面色判定', () => {
    const blocks = extractTopLevelBlocks(
      ":root { --a: 1; }\n@media (max-width: 767px) { html { color: red } }\n:root[data-theme='dark'] { --a: 2; }",
    );
    expect(blocks.map((b) => b.prelude)).toEqual([
      ':root',
      '@media (max-width: 767px)',
      ":root[data-theme='dark']",
    ]);

    // @media 内部嵌套的 :root 不得被当作顶层主题块
    const nested = extractThemeBlocks('@media print { :root { --color-x: #111111; } }');
    expect(nested.base.size).toBe(0);

    expect([...extractDeclarations('--a: #fff;\n--b: var(--a);')]).toEqual([
      ['--a', '#fff'],
      ['--b', 'var(--a)'],
    ]);

    expect(isLiteralColor('#faf9f5')).toBe(true);
    expect(isLiteralColor('rgba(0, 0, 0, 0.1)')).toBe(true);
    expect(isLiteralColor('var(--color-paper)')).toBe(false);
    expect(isLiteralColor('transparent')).toBe(false);
    expect(isLiteralColor('currentColor')).toBe(false);
  });

  it('T02 [正例]: 三主题颜色 token 对称 → ok, 差集为空', () => {
    const result = checkThemeParity(PARITY_OK_CSS);
    expect(result.baseOnly).toEqual([]);
    expect(result.partial).toEqual([]);
    expect(result.darkOnly).toEqual([]);
    expect(result.sepiaOnly).toEqual([]);
    expect(result.ok).toBe(true);
    // 别名与关键字色不参与 parity 计数
    expect(result.counts.baseLiteralColors).toBe(2);
    expect(result.counts.darkColors).toBe(2);
    expect(result.counts.sepiaColors).toBe(2);
  });

  it('T03 [反例 P1]: base 独有的字面色 token 被拦下', () => {
    const result = checkThemeParity(
      `${PARITY_OK_CSS.replace(
        '  --color-ink: #1b1b19;',
        '  --color-ink: #1b1b19;\n  --color-orphan: #123456;',
      )}`,
    );
    expect(result.ok).toBe(false);
    expect(result.baseOnly).toEqual([{ token: '--color-orphan', value: '#123456' }]);
  });

  it('T04 [反例 P2/P3]: 半覆盖与反向孤儿都被拦下', () => {
    const half = checkThemeParity(
      PARITY_OK_CSS.replace(
        ":root[data-theme='sepia'] {\n  --color-paper: #f4ecd8;\n  --color-ink: #5b4636;\n}",
        ":root[data-theme='sepia'] {\n  --color-paper: #f4ecd8;\n}",
      ),
    );
    expect(half.ok).toBe(false);
    expect(half.partial).toEqual([{ token: '--color-ink', value: '#1b1b19', inDark: true, inSepia: false }]);

    const orphan = checkThemeParity(
      PARITY_OK_CSS.replace(
        ":root[data-theme='dark'] {\n  --color-paper: #1c1917;",
        ":root[data-theme='dark'] {\n  --color-paper: #1c1917;\n  --color-dark-only: #000000;",
      ),
    );
    expect(orphan.ok).toBe(false);
    expect(orphan.darkOnly).toEqual(['--color-dark-only']);
  });

  it('T05: 豁免表命中 → 不算违规; 豁免表条目失效 → staleAllowlist', () => {
    const [invariantToken] = THEME_INVARIANT_COLOR_TOKENS;
    const withInvariant = checkThemeParity(
      `:root {\n  ${invariantToken}: #d97757;\n}\n:root[data-theme='dark'] {\n}\n:root[data-theme='sepia'] {\n}\n`,
    );
    expect(withInvariant.ok).toBe(true);
    expect(withInvariant.invariantApplied).toEqual([invariantToken]);
    expect(withInvariant.staleAllowlist).not.toContain(invariantToken);

    // 一旦该品牌色被逐主题覆盖, 豁免条目即失效（提示移除, 保持豁免表最小）
    const stale = checkThemeParity(
      `:root {\n  ${invariantToken}: #d97757;\n}\n:root[data-theme='dark'] {\n  ${invariantToken}: #d97757;\n}\n:root[data-theme='sepia'] {\n  ${invariantToken}: #d97757;\n}\n`,
    );
    expect(stale.ok).toBe(true);
    expect(stale.invariantApplied).toEqual([]);
    // 该条目已不再满足「仅 base 定义」→ 必须被标记失效
    expect(stale.staleAllowlist).toContain(invariantToken);
  });
});

describe('check-theme-parity / 真实仓库回归', () => {
  it('T06 [critical]: src/styles/tokens.css 三主题颜色 token 差集 = 空', () => {
    const result = checkThemeParity(readFileSync(resolve(ROOT, TOKENS_FILE), 'utf8'));

    expect(result.baseOnly, 'base-only 字面色 token 必须为 0').toEqual([]);
    expect(result.partial, '不得只覆盖 dark / sepia 之一').toEqual([]);
    expect(result.darkOnly, 'dark 不得有 base 未声明的颜色 token').toEqual([]);
    expect(result.sepiaOnly, 'sepia 不得有 base 未声明的颜色 token').toEqual([]);
    expect(result.ok).toBe(true);

    // 豁免表必须全部生效（无失效条目 = 表最小且真实）
    expect(result.staleAllowlist).toEqual([]);
    expect(result.invariantApplied.length).toBe(THEME_INVARIANT_COLOR_TOKENS.length);
  });
});