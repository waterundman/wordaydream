/**
 * check-tokens.mjs — Wordaydream v1.6.4 Stage 4 (S4 前端美术排版收敛) 守护脚本
 *
 * 单一真源: `src/styles/tokens.css`（全仓唯一声明自定义属性的文件, 已实测）。
 *
 * 判定规则（任一违规 → 打印明细并 exit 1）:
 *
 *   C1 token 闭包
 *      `src/**\/*.css` 中出现的 `var(--x)` 引用集合
 *      − tokens.css 的 `--x:` 定义集合
 *      − 运行时注入集合
 *      = 空。
 *
 *      运行时注入集合 = SPEC §3 S4 显式列出的 3 项
 *        (--progress / --path-length / --panel-shift-x)
 *      ∪ 自动探测集合: `src/**\/*.{ts,tsx}` 中以字符串字面量出现的自定义属性名
 *        （即 `style={{ '--x': … }}` / `setProperty('--x', …)` 这类由 JS 在运行时
 *        写入的变量, 例如 --sprig-length / --swatch / --breathing-delay）。
 *      自动探测让「新增一个运行时变量」不需要改本脚本; 同时
 *      「CSS 里写了 var(--x) 却既没定义、也没有任何 JS 写入」一定被拦住。
 *      探测范围**排除测试文件**（__tests__ / __integration__ / *.test.* / *.spec.*）:
 *      测试里的 `'--x'` 字面量是断言 token 名, 不是注入点; 纳入会把闸门放空。
 *
 *   C2 断点派生
 *      所有 `@media (…-width: Npx)` 的数值必须命中 tokens.css 的 `--breakpoint-*` 表:
 *        min-width 侧: N 必须等于某个 token 值
 *        max-width 侧: N 必须等于某个 token 值, 或该值 - 1px（<= 语义的常用写法）
 *      CSS 自定义属性无法用于 @media 条件（CSS Variables L1），媒体查询只能保留
 *      字面量 —— 派生关系由本脚本锁定, 见 tokens.css 的断点注释。
 *      无法识别的 px 写法（如 `(width >= 768px)`）也判违规, 避免出现检查盲区。
 *
 *   C3 字号阶梯
 *      `src/**\/*.module.css` 内 `font-size: <N>px` 裸值 = 0（必须走 --text-* 阶梯）。
 *
 * 纯函数（extract* / checkTokens）与 CLI 分离: CLI 只负责读盘 + 打印,
 * 单测直接对纯函数喂内存 fixture（见 check-tokens.test.mjs）。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

/** tokens.css 相对仓库根的路径（唯一定义真源）。 */
export const TOKENS_FILE = 'src/styles/tokens.css';

/**
 * SPEC §3 S4 显式列出的运行时注入项。
 * 保留为常量（而非只靠自动探测）: 这是合同里点名的豁免清单, 即使将来注入点
 * 改成非字面量写法, 也不会误判为「未定义 token」。
 */
export const SPEC_RUNTIME_INJECTED_TOKENS = ['--progress', '--path-length', '--panel-shift-x'];

/**
 * 把 CSS 注释替换为等长空白（保留换行）:
 * 既避免注释里的 token 名 / 断点数值被误读, 又保持行号与原文一致（报错可定位）。
 */
export function maskCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '));
}

/** `var(--x)` 引用集合（含嵌套 var() 的内层）。 */
export function extractReferencedTokens(css) {
  const found = new Set();
  for (const m of maskCssComments(css).matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)) {
    found.add(m[1]);
  }
  return found;
}

/** `--x: …` 声明集合（声明位于行首或紧跟 `;` / `{` 之后）。 */
export function extractDefinedTokens(css) {
  const found = new Set();
  for (const m of maskCssComments(css).matchAll(/(?:^|[;{])\s*(--[a-zA-Z0-9-]+)\s*:/g)) {
    found.add(m[1]);
  }
  return found;
}

/** TS/TSX 中以字符串字面量出现的自定义属性名 = 运行时注入候选。 */
export function extractRuntimeInjectedTokens(source) {
  const found = new Set();
  for (const m of source.matchAll(/['"](--[a-zA-Z0-9-]+)['"]/g)) {
    found.add(m[1]);
  }
  return found;
}

/** `--breakpoint-*` 表: name → px 数值。 */
export function extractBreakpointValues(tokensCss) {
  const table = new Map();
  for (const m of maskCssComments(tokensCss).matchAll(/(--breakpoint-[a-zA-Z0-9-]+)\s*:\s*(\d+)px/g)) {
    table.set(m[1], Number(m[2]));
  }
  return table;
}

/**
 * 抽取所有 `@media` 前导中的宽度字面量。
 * @returns {Array<{kind:'min'|'max'|'unknown', value:number, prelude:string}>}
 */
export function extractMediaWidthLiterals(css) {
  const found = [];
  for (const m of maskCssComments(css).matchAll(/@media([^{]*)\{/g)) {
    const prelude = m[1].trim();
    const hits = [...prelude.matchAll(/(min|max)-width\s*:\s*(\d+)px/g)];
    if (hits.length === 0) {
      // 前导含 px 却不符合 min/max-width 写法 → 记为未知写法, 避免静默漏检。
      if (/\d+px/.test(prelude)) found.push({ kind: 'unknown', value: Number.NaN, prelude });
      continue;
    }
    for (const hit of hits) {
      found.push({ kind: hit[1], value: Number(hit[2]), prelude });
    }
  }
  return found;
}

/** module css 内的 `font-size: <N>px` 裸值（行号 1-based）。 */
export function findBareFontSizes(css) {
  const found = [];
  maskCssComments(css)
    .split('\n')
    .forEach((line, index) => {
      if (/font-size\s*:\s*[\d.]+px/.test(line)) found.push({ line: index + 1, text: line.trim() });
    });
  return found;
}

/**
 * 纯函数: 一次性跑完 C1 / C2 / C3。
 *
 * @param {Object} input
 * @param {string} input.tokensCss tokens.css 内容（定义真源 + 断点表）
 * @param {Array<{path:string, content:string}>} input.cssFiles 参与扫描的 CSS（含 tokens.css）
 * @param {Array<{path:string, content:string}>} input.tsSources 参与运行时注入探测的 TS/TSX
 * @returns {{
 *   ok: boolean,
 *   definitions: string[],
 *   runtimeInjected: string[],
 *   runtimeInjectedAuto: string[],
 *   undefinedTokens: Array<{token:string, files:string[]}>,
 *   breakpoints: Array<{token:string, value:number}>,
 *   breakpointViolations: Array<{file:string, kind:string, value:number, prelude:string, allowed:number[]}>,
 *   bareFontSizes: Array<{file:string, line:number, text:string}>,
 * }}
 */
export function checkTokens({ tokensCss, cssFiles = [], tsSources = [] }) {
  const definitions = extractDefinedTokens(tokensCss);

  const runtimeInjected = new Set(SPEC_RUNTIME_INJECTED_TOKENS);
  const runtimeInjectedAuto = new Set();
  for (const source of tsSources) {
    for (const token of extractRuntimeInjectedTokens(source.content)) {
      runtimeInjectedAuto.add(token);
      runtimeInjected.add(token);
    }
  }

  // C1: 引用闭包
  const referenced = new Map();
  for (const file of cssFiles) {
    for (const token of extractReferencedTokens(file.content)) {
      if (!referenced.has(token)) referenced.set(token, new Set());
      referenced.get(token).add(file.path);
    }
  }
  const undefinedTokens = [...referenced.entries()]
    .filter(([token]) => !definitions.has(token) && !runtimeInjected.has(token))
    .map(([token, files]) => ({ token, files: [...files].sort() }))
    .sort((a, b) => a.token.localeCompare(b.token));

  // C2: 断点派生
  const breakpoints = extractBreakpointValues(tokensCss);
  const values = [...breakpoints.values()];
  const allowedMin = new Set(values);
  const allowedMax = new Set([...values, ...values.map((v) => v - 1)]);
  const breakpointViolations = [];
  for (const file of cssFiles) {
    for (const literal of extractMediaWidthLiterals(file.content)) {
      if (literal.kind === 'unknown') {
        breakpointViolations.push({ file: file.path, ...literal, allowed: values.sort((a, b) => a - b) });
        continue;
      }
      const allowed = literal.kind === 'min' ? allowedMin : allowedMax;
      if (!allowed.has(literal.value)) {
        breakpointViolations.push({
          file: file.path,
          ...literal,
          allowed: [...allowed].sort((a, b) => a - b),
        });
      }
    }
  }

  // C3: 字号阶梯（仅 module css）
  const bareFontSizes = [];
  for (const file of cssFiles) {
    if (!file.path.endsWith('.module.css')) continue;
    for (const hit of findBareFontSizes(file.content)) {
      bareFontSizes.push({ file: file.path, ...hit });
    }
  }

  return {
    ok:
      undefinedTokens.length === 0 &&
      breakpointViolations.length === 0 &&
      bareFontSizes.length === 0,
    definitions: [...definitions].sort(),
    runtimeInjected: [...runtimeInjected].sort(),
    runtimeInjectedAuto: [...runtimeInjectedAuto].sort(),
    undefinedTokens,
    breakpoints: [...breakpoints.entries()]
      .map(([token, value]) => ({ token, value }))
      .sort((a, b) => a.value - b.value),
    breakpointViolations,
    bareFontSizes,
  };
}

/** 递归收集文件（返回仓库根相对 posix 路径 + 内容）。 */
export function collectFiles(dir, predicate, root = ROOT) {
  const out = [];
  const walk = (current) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (predicate(entry)) {
        out.push({
          path: relative(root, full).replace(/\\/g, '/'),
          content: readFileSync(full, 'utf8'),
        });
      }
    }
  };
  walk(resolve(root, dir));
  return out;
}

/** 测试文件不是运行时注入点（只断言 token 名），探测范围需排除。 */
export function isTestSource(path) {
  return (
    /(^|\/)(__tests__|__integration__)\//.test(path) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(path)
  );
}

function main() {
  const tokensCss = readFileSync(resolve(ROOT, TOKENS_FILE), 'utf8');
  const cssFiles = collectFiles('src', (name) => name.endsWith('.css'));
  const tsSources = collectFiles(
    'src',
    (name) => name.endsWith('.ts') || name.endsWith('.tsx'),
  ).filter((file) => !isTestSource(file.path));

  const result = checkTokens({ tokensCss, cssFiles, tsSources });

  if (result.ok) {
    console.log('设计 token 校验通过 (PASS)');
    console.log(
      `  C1 token 闭包: 定义 ${result.definitions.length} 个 / 运行时注入 ${result.runtimeInjected.length} 个 ` +
        `(自动探测 ${result.runtimeInjectedAuto.length} 个) / 未定义引用 ${result.undefinedTokens.length} 个`,
    );
    console.log(`  C2 断点派生: --breakpoint-* 表 ${result.breakpoints.length} 项, 违规字面量 0 处`);
    console.log('  C3 字号阶梯: module css 内 font-size 裸 px = 0 处');
    process.exitCode = 0;
    return;
  }

  console.error('设计 token 校验失败 (FAIL)');
  if (result.undefinedTokens.length > 0) {
    console.error(`  [C1] 未定义 token 引用 ${result.undefinedTokens.length} 个:`);
    for (const item of result.undefinedTokens) {
      console.error(`    - ${item.token}`);
      for (const file of item.files) console.error(`        ${file}`);
    }
    console.error('      处置: 在 tokens.css 补定义, 或改用既有 token, 或由 JS 写入该变量。');
  }
  if (result.breakpointViolations.length > 0) {
    console.error(`  [C2] 断点字面量未命中 --breakpoint-* 表 ${result.breakpointViolations.length} 处:`);
    for (const item of result.breakpointViolations) {
      console.error(
        `    - ${item.file}: ${item.prelude} (${item.kind} ${item.value})` +
          ` → 允许值 ${item.allowed.join(' / ')}`,
      );
    }
  }
  if (result.bareFontSizes.length > 0) {
    console.error(`  [C3] module css 内 font-size 裸 px ${result.bareFontSizes.length} 处:`);
    for (const item of result.bareFontSizes) {
      console.error(`    - ${item.file}:${item.line}: ${item.text}`);
    }
    console.error('      处置: 改用 --text-* 阶梯 token。');
  }
  process.exitCode = 1;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  main();
}