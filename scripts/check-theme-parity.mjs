/**
 * check-theme-parity.mjs — Wordaydream v1.6.4 Stage 4 (S4) 主题 parity 守护脚本
 *
 * 判定规则（违规 → 打印明细并 exit 1）:
 *
 *   tokens.css 三个主题块（base `:root` / dark / sepia）的**颜色 token 差集 = 空**:
 *     P1 base-only : 在 base 里以**字面色值**声明、dark 与 sepia 都没有的 --color-* → 违规
 *     P2 半覆盖    : 只出现在 dark / sepia 其中之一的 base 字面色 token → 违规
 *     P3 反向孤儿  : dark / sepia 里声明了但 base 没有的 --color-* → 违规
 *
 *   为什么只对「字面色值」要求 parity:
 *     别名型 token（`--color-surface-base: var(--color-paper)`）本身不携带色值,
 *     最终取值由被引用的主题化 token 决定 —— 三主题自动正确, 无需逐主题重复声明。
 *     同理 `transparent` / `currentColor` 这类关键字色与主题无关, 不参与 parity。
 *
 *   为什么允许「主题不变量品牌色」豁免（THEME_INVARIANT_COLOR_TOKENS）:
 *     品牌/成就语义色（terracotta 主色族、语法与复合词墨色、火焰与连击色）按设计
 *     三主题同值。若在 dark / sepia 里重复声明同一字面量, 等于把同一个常量维护
 *     三份 —— 正是本版本在清理的「值与 token 真值漂移」问题。故这些 token 显式
 *     豁免, 并就地注明理由。豁免表由脚本自身校验是否失效（stale → 提示移除）。
 *
 * 纯函数（extract* / checkThemeParity）与 CLI 分离, 单测喂内存 fixture
 * （见 check-theme-parity.test.mjs）。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

/** tokens.css 相对仓库根的路径（三主题块的唯一真源）。 */
export const TOKENS_FILE = 'src/styles/tokens.css';

/**
 * 主题不变量品牌色（三主题按设计同值 → 无需 dark / sepia 覆盖）。
 *
 * 若某条目在 dark / sepia 中获得了覆盖, 说明它已不再是主题不变量:
 * 脚本会把它列进 staleAllowlist 提示移除, 保持豁免表最小。
 */
export const THEME_INVARIANT_COLOR_TOKENS = [
  '--color-accent', // terracotta 主色: 品牌色, 三主题同值
  '--color-accent-hover', // 主色 hover 态, 同上
  '--color-accent-muted', // 主色弱化态（渐变中段）, 同上
  '--color-primary-foreground', // 主色前景（按钮文字）, 随主色恒定
  '--color-grammar', // 语法墨色（语法面板/高亮描边）
  '--color-compound', // 复合词墨色
  '--color-flame', // 火焰（连击）色
  '--color-flame-strong', // 火焰强调态
  '--color-achievement-unlocked', // 成就解锁色
  '--color-streak-text', // 连击文字色
];

/** 与 check-tokens.mjs 同源的注释掩码: 保行号、去注释干扰。 */
export function maskCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '));
}

/**
 * 抽取顶层块（depth 0）的 prelude + body。
 * `@media { … }` 内部的嵌套块不会被当作顶层块（其 prelude 在 depth ≥ 1 时被忽略）。
 */
export function extractTopLevelBlocks(css) {
  const src = maskCssComments(css);
  const blocks = [];
  let depth = 0;
  let preludeStart = 0;
  let currentPrelude = '';
  let bodyStart = 0;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '{') {
      if (depth === 0) {
        currentPrelude = src.slice(preludeStart, i).trim();
        bodyStart = i + 1;
      }
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        blocks.push({ prelude: currentPrelude, body: src.slice(bodyStart, i) });
      }
      preludeStart = i + 1;
    }
  }
  return blocks;
}

/** 块内的 `--x: value;` 声明 → Map。 */
export function extractDeclarations(body) {
  const found = new Map();
  for (const m of maskCssComments(body).matchAll(/^\s*(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/gm)) {
    found.set(m[1], m[2].trim());
  }
  return found;
}

/** 是否为「携带具体色值」的字面色（别名 var() 与 transparent/currentColor 关键字不算）。 */
export function isLiteralColor(value) {
  const trimmed = String(value).trim();
  if (trimmed.startsWith('var(')) return false;
  return /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(|color-mix\(/.test(trimmed);
}

const PRELUDE_BASE = /^:root$/;
const PRELUDE_DARK = /^:root\[data-theme=(['"])dark\1\]$/;
const PRELUDE_SEPIA = /^:root\[data-theme=(['"])sepia\1\]$/;

/**
 * 纯函数: 抽取三主题块（同名块合并, 例如 tokens.css 末尾的第二个 `:root`）。
 * @returns {{base: Map<string,string>, dark: Map<string,string>, sepia: Map<string,string>}}
 */
export function extractThemeBlocks(tokensCss) {
  const theme = { base: new Map(), dark: new Map(), sepia: new Map() };
  for (const block of extractTopLevelBlocks(tokensCss)) {
    const target = PRELUDE_BASE.test(block.prelude)
      ? theme.base
      : PRELUDE_DARK.test(block.prelude)
        ? theme.dark
        : PRELUDE_SEPIA.test(block.prelude)
          ? theme.sepia
          : null;
    if (!target) continue;
    for (const [token, value] of extractDeclarations(block.body)) target.set(token, value);
  }
  return theme;
}

/**
 * 纯函数: 主题 parity 判定。
 * @param {string} tokensCss tokens.css 内容
 * @returns {{
 *   ok: boolean,
 *   baseOnly: Array<{token:string, value:string}>,
 *   partial: Array<{token:string, value:string, inDark:boolean, inSepia:boolean}>,
 *   darkOnly: string[],
 *   sepiaOnly: string[],
 *   staleAllowlist: string[],
 *   invariantApplied: string[],
 *   counts: {baseLiteralColors:number, darkColors:number, sepiaColors:number},
 * }}
 */
export function checkThemeParity(tokensCss) {
  const { base, dark, sepia } = extractThemeBlocks(tokensCss);
  const invariant = new Set(THEME_INVARIANT_COLOR_TOKENS);

  const baseLiteralColors = [...base.entries()].filter(
    ([token, value]) => token.startsWith('--color-') && isLiteralColor(value),
  );

  const baseOnly = baseLiteralColors
    .filter(([token]) => !dark.has(token) && !sepia.has(token) && !invariant.has(token))
    .map(([token, value]) => ({ token, value }))
    .sort((a, b) => a.token.localeCompare(b.token));

  const partial = baseLiteralColors
    .filter(([token]) => dark.has(token) !== sepia.has(token) && !invariant.has(token))
    .map(([token, value]) => ({ token, value, inDark: dark.has(token), inSepia: sepia.has(token) }))
    .sort((a, b) => a.token.localeCompare(b.token));

  const colorKeys = (map) => [...map.keys()].filter((token) => token.startsWith('--color-'));
  const darkOnly = colorKeys(dark)
    .filter((token) => !base.has(token))
    .sort();
  const sepiaOnly = colorKeys(sepia)
    .filter((token) => !base.has(token))
    .sort();

  const invariantApplied = THEME_INVARIANT_COLOR_TOKENS.filter(
    (token) => base.has(token) && !dark.has(token) && !sepia.has(token),
  ).sort();
  const staleAllowlist = THEME_INVARIANT_COLOR_TOKENS.filter(
    (token) => !invariantApplied.includes(token),
  ).sort();

  return {
    ok:
      baseOnly.length === 0 &&
      partial.length === 0 &&
      darkOnly.length === 0 &&
      sepiaOnly.length === 0,
    baseOnly,
    partial,
    darkOnly,
    sepiaOnly,
    staleAllowlist,
    invariantApplied,
    counts: {
      baseLiteralColors: baseLiteralColors.length,
      darkColors: colorKeys(dark).length,
      sepiaColors: colorKeys(sepia).length,
    },
  };
}

function main() {
  const tokensCss = readFileSync(resolve(ROOT, TOKENS_FILE), 'utf8');
  const result = checkThemeParity(tokensCss);

  if (result.ok) {
    console.log('主题 parity 校验通过 (PASS)');
    console.log(
      `  base 字面色 token ${result.counts.baseLiteralColors} 个 / dark ${result.counts.darkColors} 个 / ` +
        `sepia ${result.counts.sepiaColors} 个 → 差集 0`,
    );
    console.log(
      `  主题不变量品牌色豁免 ${result.invariantApplied.length} 个 ` +
        `(THEME_INVARIANT_COLOR_TOKENS, 三主题同值)`,
    );
    for (const token of result.staleAllowlist) {
      console.warn(`[WARN] 豁免表条目已失效: ${token} 已不再满足「仅 base 定义」, 请从豁免表移除`);
    }
    process.exitCode = 0;
    return;
  }

  console.error('主题 parity 校验失败 (FAIL)');
  if (result.baseOnly.length > 0) {
    console.error(`  [P1] base-only 字面色 token ${result.baseOnly.length} 个（dark/sepia 缺覆盖）:`);
    for (const item of result.baseOnly) {
      console.error(`    - ${item.token} = ${item.value}`);
    }
  }
  if (result.partial.length > 0) {
    console.error(`  [P2] 只覆盖单一主题 ${result.partial.length} 个:`);
    for (const item of result.partial) {
      console.error(
        `    - ${item.token} = ${item.value} (dark: ${item.inDark ? '有' : '缺'} / sepia: ${item.inSepia ? '有' : '缺'})`,
      );
    }
  }
  if (result.darkOnly.length > 0) {
    console.error(`  [P3] dark-only 颜色 token ${result.darkOnly.length} 个（base 未声明）:`);
    for (const token of result.darkOnly) console.error(`    - ${token}`);
  }
  if (result.sepiaOnly.length > 0) {
    console.error(`  [P3] sepia-only 颜色 token ${result.sepiaOnly.length} 个（base 未声明）:`);
    for (const token of result.sepiaOnly) console.error(`    - ${token}`);
  }
  console.error('      处置: 在缺失的主题块补语义近似值; 若为按设计恒定的品牌色, 加入豁免表并注明理由。');
  process.exitCode = 1;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  main();
}