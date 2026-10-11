#!/usr/bin/env node
/**
 * v1.6.1 Stage 1: 构建产物体积基线测量
 *
 * 用途: 为「首屏负载收窄」「静态资源现代化」提供 before/after 可对比的硬数据.
 * 输出: JSON 报告 (默认 bundle-report.json), 含首屏 JS / 全量 JS / CSS / 公共静态资源.
 *
 * 首屏 JS 定义: dist/index.html 的 entry <script src> + 全部 <link rel="modulepreload">
 *   —— 即浏览器在首屏真正会拉取的 JS 集合 (Vite/rolldown 推导的静态依赖图).
 *
 * 用法:
 *   node scripts/measure-bundle.mjs                        # 量 dist/
 *   node scripts/measure-bundle.mjs --out before.json      # 指定输出
 *   node scripts/measure-bundle.mjs --label before         # 报告内标注
 *   node scripts/measure-bundle.mjs --compare before.json  # 与基线对比并打印差异表
 */
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join, extname, relative, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = process.cwd();
const DIST = join(ROOT, 'dist');
const PUBLIC_DIR = join(ROOT, 'public');

function argOf(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

const kb = (n) => Math.round((n / 1024) * 10) / 10;
const rel = (p) => relative(ROOT, p).replace(/\\/g, '/');

/**
 * 从 `dist/index.html` 抽取「首屏 JS 集合」的 URL 列表（纯函数，便于单测）。
 *
 * 定义 = entry `<script src>` + 全部 `<link rel="modulepreload" href>`
 * —— 即浏览器首屏真正会拉取的 JS 集合（Vite/rolldown 推导的静态依赖图）。
 *
 * @param {string} html dist/index.html 内容
 * @returns {string[]} 按出现顺序拼接的 URL 列表（可能含重复，去重由 aggregateFirstScreen 负责）
 */
export function extractFirstScreenUrls(html) {
  const entrySrc = [...html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
  const preloads = [...html.matchAll(/<link[^>]*\brel="modulepreload"[^>]*\bhref="([^"]+)"/g)].map(
    (m) => m[1]
  );
  return [...entrySrc, ...preloads];
}

/**
 * 汇总首屏 JS：按 `file` 去重（entry 可能同时出现在 modulepreload 中）后求和，按体积降序（纯函数）。
 *
 * @param {Array<{url: string, file: string, bytes: number}>} items 已 stat 过的候选 chunk
 * @returns {{bytes: number, kb: number, chunkCount: number, chunks: Array<object>}}
 */
export function aggregateFirstScreen(items) {
  const seen = new Set();
  const chunks = items.filter((x) => {
    if (x.bytes <= 0 || seen.has(x.file)) return false;
    seen.add(x.file);
    return true;
  });
  const bytes = chunks.reduce((s, x) => s + x.bytes, 0);
  return { bytes, kb: kb(bytes), chunkCount: chunks.length, chunks: chunks.sort((a, b) => b.bytes - a.bytes) };
}

function measureDist() {
  if (!existsSync(DIST)) {
    throw new Error('dist/ 不存在 —— 请先执行 npm run build');
  }

  const html = readFileSync(join(DIST, 'index.html'), 'utf8');

  const toDistPath = (url) => join(DIST, url.replace(/^\//, '').split('?')[0]);
  const describe = (urls) =>
    urls
      .map((u) => {
        const p = toDistPath(u);
        return { url: u, file: rel(p), bytes: existsSync(p) ? statSync(p).size : 0 };
      })
      .filter((x) => x.bytes > 0);

  // 首屏集合: entry script + modulepreload (抽取/去重/求和逻辑已提为纯函数, 见上方 export)
  const firstScreen = aggregateFirstScreen(describe(extractFirstScreenUrls(html)));

  const allJs = walk(DIST)
    .filter((p) => extname(p) === '.js')
    .map((p) => ({ file: rel(p), bytes: statSync(p).size }));
  const allCss = walk(DIST)
    .filter((p) => extname(p) === '.css')
    .map((p) => ({ file: rel(p), bytes: statSync(p).size }));

  const sum = (arr) => arr.reduce((s, x) => s + x.bytes, 0);

  return {
    firstScreen,
    js: { bytes: sum(allJs), kb: kb(sum(allJs)), chunkCount: allJs.length },
    css: { bytes: sum(allCss), kb: kb(sum(allCss)), fileCount: allCss.length },
  };
}

function measurePublic() {
  const files = walk(PUBLIC_DIR).map((p) => ({ file: rel(p), bytes: statSync(p).size }));
  const sum = files.reduce((s, x) => s + x.bytes, 0);

  // 可优化子集: 位图 (svg 是矢量的, 不计入格式转换收益)
  const bitmaps = files.filter((x) => /\.(png|jpe?g|webp|avif)$/i.test(x.file));
  const bitmapBytes = bitmaps.reduce((s, x) => s + x.bytes, 0);

  return {
    bytes: sum,
    kb: kb(sum),
    fileCount: files.length,
    bitmaps: {
      bytes: bitmapBytes,
      kb: kb(bitmapBytes),
      fileCount: bitmaps.length,
      files: bitmaps.sort((a, b) => b.bytes - a.bytes),
    },
    top: files.sort((a, b) => b.bytes - a.bytes).slice(0, 12),
  };
}

function gitHead() {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * v1.6.6 债闸门: 体积预算 (棘轮语义, 与 check-contrast 一致)。
 *
 * - 超过 `baseline * (1 + tolerance)` → status 'over' → --gate 退出 1
 * - 低于 baseline → status 'under'，提示把预算收紧 (欠账只能变小, 不能变大)
 * - 预算表缺该指标 → status 'missing' (不得静默放行)
 */
export const BUDGET_METRICS = [
  { key: 'firstScreenJs', label: '首屏 JS', get: (r) => r.dist.firstScreen.bytes },
  { key: 'totalJs', label: '全量 JS', get: (r) => r.dist.js.bytes },
  { key: 'css', label: 'CSS', get: (r) => r.dist.css.bytes },
  { key: 'staticAssets', label: '公共静态资源', get: (r) => r.publicAssets.bytes },
  { key: 'bitmaps', label: '其中位图', get: (r) => r.publicAssets.bitmaps.bytes },
];

export function evaluateBudget(budgets, current, tolerance = 0.02) {
  const table = budgets && budgets.budgets ? budgets.budgets : budgets ?? {};
  return BUDGET_METRICS.map((m) => {
    const baseline = table[m.key];
    const value = m.get(current);
    if (typeof baseline !== 'number') {
      return { key: m.key, label: m.label, baseline: null, value, allowed: null, status: 'missing' };
    }
    const allowed = Math.ceil(baseline * (1 + tolerance));
    const status = value > allowed ? 'over' : value < baseline ? 'under' : 'ok';
    return { key: m.key, label: m.label, baseline, value, allowed, status };
  });
}

function printCompare(baseline, current) {
  const rows = [
    ['首屏 JS', baseline.dist.firstScreen.bytes, current.dist.firstScreen.bytes],
    ['全量 JS', baseline.dist.js.bytes, current.dist.js.bytes],
    ['CSS', baseline.dist.css.bytes, current.dist.css.bytes],
    ['公共静态资源', baseline.publicAssets.bytes, current.publicAssets.bytes],
    ['  其中位图', baseline.publicAssets.bitmaps.bytes, current.publicAssets.bitmaps.bytes],
  ];
  console.log('');
  console.log('=== before/after 对比 ===');
  console.log(
    `${'指标'.padEnd(18)}${'before'.padStart(11)}${'after'.padStart(11)}${'Δ'.padStart(12)}${'Δ%'.padStart(9)}`
  );
  for (const [name, b, a] of rows) {
    const d = a - b;
    const pct = b > 0 ? ((d / b) * 100).toFixed(1) : 'n/a';
    const sign = d > 0 ? '+' : '';
    console.log(
      `${name.padEnd(18)}${(kb(b) + ' KB').padStart(11)}${(kb(a) + ' KB').padStart(11)}` +
        `${(sign + kb(d) + ' KB').padStart(12)}${(sign + pct + '%').padStart(9)}`
    );
  }
  console.log('');
}

/**
 * 只有**直接执行本文件**时才跑测量/写盘；被 `import`（单测）时只暴露纯函数。
 * 这样 `scripts/measure-bundle.test.mjs` 可以 import 而不会真的去量 dist/。
 */
const invokedDirectly =
  typeof process.argv[1] === 'string' && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const label = argOf('--label', 'current');
  const outPath = argOf('--out', 'bundle-report.json');
  const comparePath = argOf('--compare');

  const report = {
    label,
    measuredAt: new Date().toISOString(),
    gitHead: gitHead(),
    dist: measureDist(),
    publicAssets: measurePublic(),
  };

  if (comparePath && existsSync(comparePath)) {
    const baseline = JSON.parse(readFileSync(comparePath, 'utf8'));
    printCompare(baseline, report);
  } else if (comparePath) {
    console.log(`[warn] 基线文件不存在: ${comparePath}`);
  }

  writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');

  console.log(
    `[${label}] 首屏 JS: ${report.dist.firstScreen.kb} KB (${report.dist.firstScreen.chunkCount} chunk)`
  );
  console.log(`[${label}] 全量 JS: ${report.dist.js.kb} KB (${report.dist.js.chunkCount} chunk)`);
  console.log(`[${label}] CSS: ${report.dist.css.kb} KB (${report.dist.css.fileCount} 文件)`);
  console.log(
    `[${label}] 公共静态资源: ${report.publicAssets.kb} KB (${report.publicAssets.fileCount} 文件)`
  );
  console.log(
    `[${label}]   其中位图: ${report.publicAssets.bitmaps.kb} KB (${report.publicAssets.bitmaps.fileCount} 文件)`
  );
  console.log(`报告已写入: ${outPath}`);

  const budgetPath = argOf('--budget', 'scripts/bundle-budget.json');

  if (process.argv.includes('--update-budget')) {
    const rows = BUDGET_METRICS.map((m) => [m.key, m.get(report)]);
    const payload = {
      note: 'check:bundle-budget 的基线 (字节)。--update-budget 从当前 dist 覆写；' +
        '闸门语义: 超过 baseline*(1+tolerance) 即 exit 1, 低于 baseline 提示收紧。',
      tolerance: 0.02,
      gitHead: report.gitHead,
      budgets: Object.fromEntries(rows),
    };
    writeFileSync(budgetPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
    console.log(`[budget] 预算表已更新: ${budgetPath}`);
    for (const [k, v] of rows) console.log(`  ${k} = ${v} B (${kb(v)} KB)`);
  } else if (process.argv.includes('--gate')) {
    if (!existsSync(budgetPath)) {
      console.error(`[gate] 预算表不存在: ${budgetPath} (先跑 npm run measure:bundle -- --update-budget)`);
      process.exit(2);
    }
    const budgets = JSON.parse(readFileSync(budgetPath, 'utf8'));
    const rows = evaluateBudget(budgets, report, budgets.tolerance ?? 0.02);
    console.log('');
    console.log('=== 体积预算闸门 ===');
    for (const r of rows) {
      const mark = r.status === 'over' ? 'OVER ' : r.status === 'under' ? 'TIGHT' : r.status === 'missing' ? 'NODBUD' : 'OK   ';
      const base = r.baseline === null ? 'n/a' : `${kb(r.baseline)} KB`;
      console.log(
        `${mark} ${r.label.padEnd(14)} 实测 ${(kb(r.value) + ' KB').padStart(10)} · 预算 ${base.padStart(10)} · 上限 ${r.allowed === null ? 'n/a' : kb(r.allowed) + ' KB'}`
      );
    }
    const over = rows.filter((r) => r.status === 'over');
    const under = rows.filter((r) => r.status === 'under');
    const missing = rows.filter((r) => r.status === 'missing');
    if (missing.length) {
      console.error(`[gate] 预算表缺少 ${missing.length} 项指标, 拒绝静默放行`);
    }
    if (under.length) {
      console.log(`[gate] ${under.map((r) => r.label).join(' / ')} 低于预算 —— 收紧基线: npm run measure:bundle -- --update-budget`);
    }
    if (over.length || missing.length) {
      console.error(
        `[gate] FAIL: ${over.map((r) => `${r.label}(+${kb(r.value - r.allowed)} KB 超上限)`).join(' / ')}${missing.length ? ` · 缺表项 ${missing.map((r) => r.label).join(' / ')}` : ''}`
      );
      process.exit(1);
    }
    console.log('[gate] PASS (无体积回退)');
  }
}
