/**
 * check-tokens 单测 (v1.6.4 Stage 4 / S4)
 *
 * 设计要点（避免平凡通过）:
 * - 全部针对**纯函数**喂内存 fixture: 每条规则都给正例 + 反例, 反例必须真被拦下。
 * - 最后一组 (T07) 是**真实仓库回归**: 读盘跑一遍, 断言当前仓库全绿 ——
 *   既是「本版本 S4 已收敛」的证据, 也保证将来任何回退都会被这里挡住。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SPEC_RUNTIME_INJECTED_TOKENS,
  checkTokens,
  collectFiles,
  extractBreakpointValues,
  extractDefinedTokens,
  extractMediaWidthLiterals,
  extractReferencedTokens,
  extractRuntimeInjectedTokens,
  findBareFontSizes,
  isTestSource,
  TOKENS_FILE,
} from './check-tokens.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

/** 最小可用 tokens.css: 2 个 token + 2 个断点。 */
const TOKENS_CSS = `:root {
  --color-paper: #faf9f5;
  --color-ink: #1b1b19;
  --breakpoint-sm: 375px;
  --breakpoint-md: 768px;
}
`;

describe('check-tokens / 抽取器', () => {
  it('T01: var() 引用 / 声明抽取, 且注释内的 token 名不参与判定', () => {
    expect([...extractReferencedTokens('.a { color: var(--color-paper); }')]).toEqual(['--color-paper']);
    // 嵌套 var(): 内层也算引用
    expect([...extractReferencedTokens('.a { color: var(--x, var(--color-ink)); }')].sort()).toEqual([
      '--color-ink',
      '--x',
    ]);
    // 注释里的 token 名必须被掩码掉（否则注释能"假装"定义）
    expect([...extractReferencedTokens('/* var(--ghost) */ .a { color: red; }')]).toEqual([]);
    expect([...extractDefinedTokens('/* --ghost: 1; */ :root { --real: 2; }')]).toEqual(['--real']);
    // 声明前是 `(` 的（即 var() 引用）不算声明
    expect([...extractDefinedTokens(':root { --a: var(--b); }')]).toEqual(['--a']);
  });

  it('T02: 运行时注入探测只看字符串字面量, 并排除测试文件', () => {
    expect([...extractRuntimeInjectedTokens("style={{ '--swatch': x }}")]).toEqual(['--swatch']);
    expect([...extractRuntimeInjectedTokens("el.style.setProperty('--sprig-length', '1')")]).toEqual([
      '--sprig-length',
    ]);
    expect([...extractRuntimeInjectedTokens('const x = token;')]).toEqual([]);

    expect(isTestSource('src/__tests__/a.test.ts')).toBe(true);
    expect(isTestSource('src/__integration__/b.test.tsx')).toBe(true);
    expect(isTestSource('src/features/x/__tests__/c.tsx')).toBe(true);
    expect(isTestSource('src/features/x/Thing.test.tsx')).toBe(true);
    expect(isTestSource('src/features/x/Thing.tsx')).toBe(false);
  });

  it('T03: 断点表与 @media 字面量抽取（含 min+max 组合与未知写法）', () => {
    const table = extractBreakpointValues(TOKENS_CSS);
    expect([...table.entries()]).toEqual([
      ['--breakpoint-sm', 375],
      ['--breakpoint-md', 768],
    ]);

    const literals = extractMediaWidthLiterals(
      '@media (max-width: 767px) { a { color: red } }\n' +
        '@media (min-width: 768px) and (max-width: 1023px) { b { color: red } }\n' +
        '@media (prefers-reduced-motion: reduce) { c { color: red } }\n' +
        '@media (width >= 900px) { d { color: red } }',
    );
    expect(literals).toEqual([
      { kind: 'max', value: 767, prelude: '(max-width: 767px)' },
      { kind: 'min', value: 768, prelude: '(min-width: 768px) and (max-width: 1023px)' },
      { kind: 'max', value: 1023, prelude: '(min-width: 768px) and (max-width: 1023px)' },
      { kind: 'unknown', value: Number.NaN, prelude: '(width >= 900px)' },
    ]);
    // 无 px 的媒体查询不产生记录
    expect(findBareFontSizes('.a { font-size: 13px; }')).toEqual([{ line: 1, text: '.a { font-size: 13px; }' }]);
  });
});

describe('check-tokens / 判定 (正例 + 反例)', () => {
  const cssFile = (path, content) => ({ path, content });

  it('T04 [正例]: token 闭包 + 断点 + 字号三者合规 → ok, 无任何违规', () => {
    const result = checkTokens({
      tokensCss: TOKENS_CSS,
      cssFiles: [
        cssFile(TOKENS_FILE, TOKENS_CSS),
        cssFile(
          'src/features/demo/Demo.module.css',
          '.a { color: var(--color-paper); }\n@media (max-width: 767px) { .a { color: var(--color-ink); } }\n',
        ),
      ],
      tsSources: [],
    });
    expect(result.undefinedTokens).toEqual([]);
    expect(result.breakpointViolations).toEqual([]);
    expect(result.bareFontSizes).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('T05 [反例 C1]: 引用未定义 token 被拦下; 运行时注入项不判违规', () => {
    const result = checkTokens({
      tokensCss: TOKENS_CSS,
      cssFiles: [
        cssFile('src/features/demo/Demo.module.css', '.a { color: var(--color-missing); }'),
      ],
      tsSources: [],
    });
    expect(result.ok).toBe(false);
    expect(result.undefinedTokens).toEqual([
      { token: '--color-missing', files: ['src/features/demo/Demo.module.css'] },
    ]);

    // 同一 token 由 JS 注入后即合法（自动探测路径）
    const injected = checkTokens({
      tokensCss: TOKENS_CSS,
      cssFiles: [
        cssFile('src/features/demo/Demo.module.css', '.a { color: var(--color-missing); }'),
      ],
      tsSources: [{ path: 'src/features/demo/Demo.tsx', content: "style={{ '--color-missing': x }}" }],
    });
    expect(injected.ok).toBe(true);
    expect(injected.runtimeInjectedAuto).toEqual(['--color-missing']);

    // SPEC 点名的 3 项即使没有任何 JS 字面量也必须豁免
    const specInjected = checkTokens({
      tokensCss: TOKENS_CSS,
      cssFiles: [cssFile('src/a.css', `.a { width: var(${SPEC_RUNTIME_INJECTED_TOKENS[0]}); }`)],
      tsSources: [],
    });
    expect(specInjected.ok).toBe(true);
  });

  it('T06 [反例 C2]: 断点字面量必须由 --breakpoint-* 派生 (max 允许 token-1)', () => {
    const ok = checkTokens({
      tokensCss: TOKENS_CSS,
      cssFiles: [
        cssFile(
          'src/a.css',
          '@media (max-width: 767px) { a { color: red } }\n@media (min-width: 768px) { a { color: red } }\n',
        ),
      ],
      tsSources: [],
    });
    expect(ok.ok).toBe(true);

    const bad = checkTokens({
      tokensCss: TOKENS_CSS,
      cssFiles: [cssFile('src/a.css', '@media (max-width: 900px) { a { color: red } }')],
      tsSources: [],
    });
    expect(bad.ok).toBe(false);
    expect(bad.breakpointViolations).toEqual([
      { file: 'src/a.css', kind: 'max', value: 900, prelude: '(max-width: 900px)', allowed: [374, 375, 767, 768] },
    ]);

    // 未知写法同样判违规（不留检查盲区）
    const unknown = checkTokens({
      tokensCss: TOKENS_CSS,
      cssFiles: [cssFile('src/a.css', '@media (width >= 768px) { a { color: red } }')],
      tsSources: [],
    });
    expect(unknown.ok).toBe(false);
    expect(unknown.breakpointViolations[0].kind).toBe('unknown');
  });

  it('T07 [反例 C3]: module css 内 font-size 裸 px 判违规, 非 module css 不判', () => {
    const bad = checkTokens({
      tokensCss: TOKENS_CSS,
      cssFiles: [cssFile('src/features/demo/Demo.module.css', '.a { font-size: 13px; }')],
      tsSources: [],
    });
    expect(bad.ok).toBe(false);
    expect(bad.bareFontSizes).toEqual([
      { file: 'src/features/demo/Demo.module.css', line: 1, text: '.a { font-size: 13px; }' },
    ]);

    const nonModule = checkTokens({
      tokensCss: TOKENS_CSS,
      cssFiles: [cssFile('src/index.css', '.a { font-size: 13px; }')],
      tsSources: [],
    });
    expect(nonModule.ok).toBe(true);
  });
});

describe('check-tokens / 真实仓库回归', () => {
  it('T08 [critical]: 当前仓库 src/**/*.css 全部 token 闭包 / 断点派生 / 字号阶梯合规', () => {
    const result = checkTokens({
      tokensCss: readFileSync(resolve(ROOT, TOKENS_FILE), 'utf8'),
      cssFiles: collectFiles('src', (name) => name.endsWith('.css'), ROOT),
      tsSources: collectFiles(
        'src',
        (name) => name.endsWith('.ts') || name.endsWith('.tsx'),
        ROOT,
      ).filter((file) => !isTestSource(file.path)),
    });

    expect(result.undefinedTokens, '未定义 token 引用必须为 0').toEqual([]);
    expect(result.breakpointViolations, '断点字面量必须全部命中 --breakpoint-* 表').toEqual([]);
    expect(result.bareFontSizes, 'module css 内 font-size 裸 px 必须为 0').toEqual([]);
    expect(result.ok).toBe(true);
    // 运行时注入项至少覆盖 SPEC 点名的 3 项 + 3 个真实 JS 注入变量
    for (const token of [
      ...SPEC_RUNTIME_INJECTED_TOKENS,
      '--sprig-length',
      '--swatch',
      '--breathing-delay',
    ]) {
      expect(result.runtimeInjected, `${token} 应在运行时注入集合内`).toContain(token);
    }
  });
});