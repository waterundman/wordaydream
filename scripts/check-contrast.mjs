/**
 * check-contrast.mjs — 三主题 WCAG 2.1 对比度闸门 (v1.6.6 候选, 先量化欠账)
 *
 * 来源: v1.6.4 探测留档 L6「课程锁定卡 badge 窄屏对比度待确认」升级为全量测量。
 * 实测结论 (2026-10-10): tokens.css 三主题下有 17 组「前景 token × 背景 token」
 * 不达 AA —— 且**不存在**一个能同时通过亮/暗/羊皮纸三主题的强调色 (亮底需 ~#a8492a,
 * 暗底需 #d97757)。因此修复需要引入按主题解析的 `--color-accent-text` 语义 token
 * 并重排 sepia 的正文灰阶, 属于设计体系决策, 不在本脚本里擅自动配色。
 *
 * 本脚本的作用是把这笔债变成**只能缩小、不能扩大**的棘轮 (与 verify-wordlists 的
 * EXEMPT/ratchet 同一口径):
 * - 新增不达标组合 → exit 1 (BLOCK);
 * - 基线内的组合转为达标 → 打印「可收紧基线」提示, 要求把它从 BASELINE_FAILURES 删掉;
 * - 完全不认识的组合按达标处理与否由 evaluate() 的判定决定, 不做静默放行。
 *
 * 判据口径: 文字一律按 AA 普通文本 4.5:1 (案例里的字号都是 --text-xs/--text-sm 级别,
 * 未达 WCAG「大字号」18.66px 粗体门槛); 焦点环按非文本对比度 3:1 (SC 1.4.11)。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 需要测量的「前景 token × 背景 token」组合. id 稳定, 基线按 id 记账. */
export const CONTRAST_CASES = [
  { id: 'badge-accent-on-light', label: '状态徽章文字 (可用/已完成)', fg: '--color-accent', bg: '--color-accent-light', need: 4.5 },
  { id: 'badge-inverse-on-accent', label: '状态徽章文字 (进行中)', fg: '--color-text-inverse', bg: '--color-accent', need: 4.5 },
  { id: 'badge-locked-on-subtle', label: '锁定徽章 / 锁定标题 / 进度文本', fg: '--color-text-tertiary', bg: '--color-bg-subtle', need: 4.5 },
  { id: 'tertiary-on-elevated', label: '弱化文字 on 卡面', fg: '--color-text-tertiary', bg: '--color-bg-elevated', need: 4.5 },
  { id: 'secondary-on-elevated', label: '次要文字 on 卡面', fg: '--color-text-secondary', bg: '--color-bg-elevated', need: 4.5 },
  { id: 'primary-on-bg', label: '正文 on 页面底', fg: '--color-text-primary', bg: '--color-bg', need: 4.5 },
  { id: 'secondary-on-bg', label: '次要正文 on 页面底', fg: '--color-text-secondary', bg: '--color-bg', need: 4.5 },
  { id: 'tertiary-on-bg', label: '弱化正文 on 页面底', fg: '--color-text-tertiary', bg: '--color-bg', need: 4.5 },
  { id: 'focus-ring-on-bg', label: '焦点环 on 页面底 (非文本 3:1)', fg: '--color-focus', bg: '--color-bg', need: 3 },
  { id: 'accent-text-on-bg', label: '强调色作正文/链接 on 页面底', fg: '--color-accent', bg: '--color-bg', need: 4.5 },
];

/**
 * 2026-10-10 实测的已知不达标组合 (棘轮基线, 只能减不能增).
 * 修好任何一条就从这里删掉; 新增的一律视为回归并 exit 1。
 */
export const BASELINE_FAILURES = [
  'base:badge-accent-on-light',
  'base:badge-inverse-on-accent',
  'base:focus-ring-on-bg',
  'base:accent-text-on-bg',
  'dark:badge-accent-on-light',
  'dark:badge-locked-on-subtle',
  'dark:tertiary-on-elevated',
  'dark:tertiary-on-bg',
  'sepia:badge-accent-on-light',
  'sepia:badge-inverse-on-accent',
  'sepia:badge-locked-on-subtle',
  'sepia:tertiary-on-elevated',
  'sepia:secondary-on-elevated',
  'sepia:secondary-on-bg',
  'sepia:tertiary-on-bg',
  'sepia:focus-ring-on-bg',
  'sepia:accent-text-on-bg',
];

/** 解析 tokens.css, 返回三主题各自的 token 表 (dark/sepia 在 base 之上叠加覆盖). */
export function parseThemeTokens(css) {
  const blockOf = (re) => {
    const m = re.exec(css);
    return m ? m[1] : '';
  };
  const parseDecls = (body) => {
    const map = {};
    for (const m of body.matchAll(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/gm)) {
      map[m[1]] = m[2].trim();
    }
    return map;
  };

  const base = parseDecls(blockOf(/:root\s*\{([\s\S]*?)\n\}/));
  const overrides = (theme) =>
    parseDecls(blockOf(new RegExp(`:root\\[data-theme=['"]?${theme}['"]?\\]\\s*\\{([\\s\\S]*?)\\n\\}`)));

  return {
    base,
    dark: { ...base, ...overrides('dark') },
    sepia: { ...base, ...overrides('sepia') },
  };
}

/** 沿 var(--x) 别名链取到最终字面值; 取不到 (运行时注入/非色值) 返回 null. */
export function resolveToken(map, token, depth = 0) {
  let value = map[token];
  if (value === undefined) return null;
  while (value.startsWith('var(') && depth < 10) {
    const inner = value.match(/^var\(\s*(--[a-z0-9-]+)/);
    if (!inner) return null;
    value = map[inner[1]];
    if (value === undefined) return null;
    depth += 1;
  }
  return value;
}

/** #rgb / #rrggbb / rgb() / rgba() → [r,g,b]; 解析不了返回 null. */
export function toRgb(color) {
  if (!color) return null;
  const c = String(color).trim();
  const m6 = c.match(/^#([0-9a-f]{6})$/i);
  if (m6) {
    const n = parseInt(m6[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m3 = c.match(/^#([0-9a-f]{3})$/i);
  if (m3) {
    const s = m3[1];
    return [parseInt(s[0] + s[0], 16), parseInt(s[1] + s[1], 16), parseInt(s[2] + s[2], 16)];
  }
  const fn = c.match(/^rgba?\(([^)]+)\)/i);
  if (fn) {
    const parts = fn[1].split(/[\s,/]+/).filter((p) => p.length > 0).map(Number);
    if (parts.length >= 3 && parts.slice(0, 3).every((n) => Number.isFinite(n))) {
      return [parts[0], parts[1], parts[2]];
    }
  }
  return null;
}

function relativeLuminance([r, g, b]) {
  const channel = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.1 对比度 (1..21); 任一色解析失败返回 null. */
export function contrastRatio(fg, bg) {
  const a = toRgb(fg);
  const b = toRgb(bg);
  if (!a || !b) return null;
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * 逐主题逐案例求值.
 * status: 'pass' | 'fail' | 'unknown' (token 解析不出字面色, 例如运行时注入)
 */
export function evaluate(themes, cases = CONTRAST_CASES) {
  const rows = [];
  for (const theme of Object.keys(themes)) {
    const map = themes[theme];
    for (const c of cases) {
      const fg = resolveToken(map, c.fg);
      const bg = resolveToken(map, c.bg);
      const ratio = contrastRatio(fg, bg);
      rows.push({
        key: `${theme}:${c.id}`,
        theme,
        id: c.id,
        label: c.label,
        fg,
        bg,
        need: c.need,
        ratio,
        status: ratio === null ? 'unknown' : ratio >= c.need ? 'pass' : 'fail',
      });
    }
  }
  return rows;
}

/** 棘轮判定: 返回新增失败 / 已修好但仍留在基线里的两组键. */
export function diffAgainstBaseline(rows, baseline = BASELINE_FAILURES) {
  const known = new Set(baseline);
  const regressed = rows.filter((r) => r.status === 'fail' && !known.has(r.key)).map((r) => r.key);
  const fixed = [...known].filter(
    (key) => !rows.some((r) => r.key === key && r.status === 'fail')
  );
  const unknown = rows.filter((r) => r.status === 'unknown').map((r) => r.key);
  return { regressed, fixed, unknown };
}

function main() {
  const css = readFileSync(join(ROOT, 'src/styles/tokens.css'), 'utf-8');
  const rows = evaluate(parseThemeTokens(css));
  const { regressed, fixed, unknown } = diffAgainstBaseline(rows);

  const failing = rows.filter((r) => r.status === 'fail');
  for (const theme of ['base', 'dark', 'sepia']) {
    console.log(`\n===== ${theme} =====`);
    for (const r of rows.filter((x) => x.theme === theme)) {
      const mark = r.status === 'pass' ? 'PASS' : r.status === 'fail' ? 'FAIL' : '??  ';
      const value = r.ratio === null ? 'n/a' : `${r.ratio.toFixed(2)}:1 (需 ${r.need})`;
      console.log(`  ${mark} ${value.padEnd(18)} ${r.label}  [${r.fg} on ${r.bg}]`);
    }
  }

  console.log(
    `\n不达标 ${failing.length} 组 / 共 ${rows.length} 组测量; 棘轮基线 ${BASELINE_FAILURES.length} 组。`
  );

  if (unknown.length > 0) {
    console.log(`\n[WARN] ${unknown.length} 组取不到字面色值 (未计入判定):`);
    unknown.forEach((k) => console.log(`  - ${k}`));
  }
  if (fixed.length > 0) {
    console.log(`\n[收紧] 以下基线项已达标, 请从 BASELINE_FAILURES 删除:`);
    fixed.forEach((k) => console.log(`  - ${k}`));
  }
  if (regressed.length > 0) {
    console.error(`\n[BLOCK] 新增 ${regressed.length} 组对比度回归:`);
    regressed.forEach((k) => console.error(`  - ${k}`));
    process.exitCode = 1;
    return;
  }
  console.log('\n[check:contrast] 无新增对比度回归 (存量欠账见上方 FAIL 行)');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
