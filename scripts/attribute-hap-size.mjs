#!/usr/bin/env node
/**
 * v1.6.3 S3: HAP 体积逐条目归因
 *
 * 用途: 对两个 HAP (zip) 做 central directory 级对比, 输出逐条目压缩体积差异表,
 *       把「总差异」拆到具体文件, 让体积变化可归因、可复核。
 *
 * 为什么自读 zip central directory:
 *   HAP 本质是 zip. 读取 EOCD (0x06054b50) 定位 central directory,
 *   再逐条读 central directory file header (0x02014b50). 只读元数据,
 *   不解压条目内容, 因此对 GB 级产物也很快, 且不依赖任何三方 zip 库。
 *
 * 用法:
 *   node scripts/attribute-hap-size.mjs --before <a.hap> --after <b.hap>
 *   node scripts/attribute-hap-size.mjs --before a.hap --after b.hap --out report.json
 *   node scripts/attribute-hap-size.mjs --before a.hap --after b.hap --top 30
 *   node scripts/attribute-hap-size.mjs --before a.hap --after b.hap --normalize
 *
 * --normalize: 剥离 Vite 内容 hash (name-<hash>.ext -> name.ext) 后再匹配.
 *   Vite 每次构建产物文件名都带新 hash, 直接按名匹配会把「同一模块内容变化」
 *   误判成「删旧增新」. 归一化后按逻辑模块归因, 才能看清哪个模块真的变重了.
 *
 * 输出:
 *   - 控制台: 总差异 + 变化最大的 N 个条目 + 按顶层目录聚合
 *   - JSON 报告 (可选 --out): 全量条目 + 聚合, 供 Vault 归档
 */
import { readFileSync, writeFileSync } from 'node:fs';

const EOCD_SIG = 0x06054b50;
const CDFH_SIG = 0x02014b50;

function argOf(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/**
 * 解析 zip 的 central directory, 返回条目列表 (纯函数, 便于单测).
 *
 * 返回每项: { name, compressedSize, uncompressedSize, method }
 * 其中 compressedSize 是真正占用 HAP 字节数的量, 归因以它为准。
 *
 * @param {Buffer} buf 整个 zip/HAP 文件内容
 * @returns {Array<{name:string, compressedSize:number, uncompressedSize:number, method:number}>}
 */
export function readZipEntries(buf) {
  // 1) 从尾部向前找 EOCD. comment 最长 65535, 故最多回扫 65535+22 字节.
  let eocd = -1;
  const minPos = Math.max(0, buf.length - 65535 - 22);
  for (let i = buf.length - 22; i >= minPos; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('EOCD not found: not a zip/HAP file');

  const totalEntries = buf.readUInt16LE(eocd + 10);
  let cdOffset = buf.readUInt32LE(eocd + 16);

  const entries = [];
  let p = cdOffset;
  for (let n = 0; n < totalEntries; n++) {
    if (buf.readUInt32LE(p) !== CDFH_SIG) {
      throw new Error('central directory header signature mismatch at ' + p);
    }
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const uncompressedSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.push({ name, compressedSize, uncompressedSize, method });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/**
 * 剥离 Vite 内容 hash, 把 `dir/name-<hash>.ext` 归一为 `dir/name.ext` (纯函数).
 *
 * 只对「末段文件名形如 <stem>-<hash>.<ext>」的条目动手. hash 判定要求:
 *   - 恰好 8 位 base64url 字符 (Vite 默认 hash 长度)
 *   - 且至少含 1 个大写字母或数字
 * 第二条是关键: 否则 `course-cover-en` 会被 `cover-en`(恰好 8 位纯小写) 误配成
 * `course`, 把 `course-cover-en` / `course-cover-de` 合并成同一条目. Vite 的
 * base64url hash 实践中必然含大写或数字, 而人工命名多为纯小写, 故该约束可安全区分.
 *
 * @param {string} name zip 内条目名
 * @returns {string} 归一化后的逻辑名
 */
export function normalizeEntryName(name) {
  const slash = name.lastIndexOf('/');
  const dir = slash >= 0 ? name.slice(0, slash + 1) : '';
  const base = slash >= 0 ? name.slice(slash + 1) : name;
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return name;
  const stem = base.slice(0, dot);
  const ext = base.slice(dot);
  const m = stem.match(/^(.*)-([A-Za-z0-9_-]{8})$/);
  if (!m) return name;
  const hash = m[2];
  if (!/[A-Z0-9]/.test(hash)) return name;
  return dir + m[1] + ext;
}

/**
 * 为一份条目列表生成「匹配键」: 默认用归一化名, 但当归一化名在同侧出现多次
 * (碰撞) 时, 碰撞组回退到原始条目名, 避免多个 chunk 合并成一条造成假差异.
 *
 * 例: `evaluateAnswer-<h1>.js` 与 `evaluateAnswer-<h2>.js` 归一后同名, 若强行
 * 合并会只保留其一, 报出 -35,808 这类假读数. 碰撞时回退原名即可各自独立比对.
 *
 * @param {Array} entries 条目列表
 * @param {boolean} normalize 是否启用归一化
 * @returns {Map<string, object>} 匹配键 -> 条目
 */
function buildKeyMap(entries, normalize) {
  const norm = (e) => (normalize ? normalizeEntryName(e.name) : e.name);
  const counts = new Map();
  for (const e of entries) {
    const k = norm(e);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const map = new Map();
  for (const e of entries) {
    const k = norm(e);
    // 碰撞组回退原名; 非碰撞组用归一化名.
    map.set(counts.get(k) > 1 ? e.name : k, e);
  }
  return map;
}

/**
 * 对比两份条目列表, 返回逐条目差异 (纯函数, 便于单测).
 *
 * @param {Array} before 基线条目
 * @param {Array} after  对照条目
 * @param {{normalize?: boolean}} [opts] normalize=true 时按剥离 hash 的逻辑名匹配
 * @returns {{rows:Array, onlyBefore:Array, onlyAfter:Array, totals:object}}
 */
export function diffEntries(before, after, opts = {}) {
  const bMap = buildKeyMap(before, opts.normalize);
  const aMap = buildKeyMap(after, opts.normalize);
  const names = new Set([...bMap.keys(), ...aMap.keys()]);

  const rows = [];
  const onlyBefore = [];
  const onlyAfter = [];
  for (const name of names) {
    const b = bMap.get(name);
    const a = aMap.get(name);
    if (b && a) {
      rows.push({
        name,
        beforeName: b.name,
        afterName: a.name,
        before: b.compressedSize,
        after: a.compressedSize,
        delta: a.compressedSize - b.compressedSize,
      });
    } else if (b) {
      onlyBefore.push({ name, before: b.compressedSize, after: 0, delta: -b.compressedSize });
    } else {
      onlyAfter.push({ name, before: 0, after: a.compressedSize, delta: a.compressedSize });
    }
  }

  const sum = (arr) => arr.reduce((s, x) => s + x.delta, 0);
  const beforeTotal = before.reduce((s, e) => s + e.compressedSize, 0);
  const afterTotal = after.reduce((s, e) => s + e.compressedSize, 0);
  const totals = {
    beforeEntries: before.length,
    afterEntries: after.length,
    changedEntries: rows.length,
    onlyBeforeCount: onlyBefore.length,
    onlyAfterCount: onlyAfter.length,
    beforeTotal,
    afterTotal,
    delta: afterTotal - beforeTotal,
    deltaCommon: sum(rows),
    deltaOnlyBefore: sum(onlyBefore),
    deltaOnlyAfter: sum(onlyAfter),
  };
  return { rows, onlyBefore, onlyAfter, totals };
}

/**
 * 按顶层目录 (第一段路径) 聚合差异, 便于看「哪块模块变重」.
 */
export function aggregateByTopDir(rows) {
  const acc = new Map();
  for (const r of rows) {
    const slash = r.name.indexOf('/');
    const dir = slash >= 0 ? r.name.slice(0, slash) : '(root)';
    const cur = acc.get(dir) || { dir, before: 0, after: 0, delta: 0, count: 0 };
    cur.before += r.before;
    cur.after += r.after;
    cur.delta += r.delta;
    cur.count += 1;
    acc.set(dir, cur);
  }
  return [...acc.values()].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

function fmt(n) {
  const sign = n > 0 ? '+' : n < 0 ? '-' : ' ';
  return sign + String(Math.abs(n)).padStart(9);
}

function main() {
  const beforePath = argOf('--before');
  const afterPath = argOf('--after');
  const outPath = argOf('--out');
  const top = Number(argOf('--top', '25'));
  const normalize = process.argv.includes('--normalize');
  if (!beforePath || !afterPath) {
    console.error('usage: node scripts/attribute-hap-size.mjs --before <a.hap> --after <b.hap> [--out r.json] [--top N] [--normalize]');
    process.exit(1);
  }

  const before = readZipEntries(readFileSync(beforePath));
  const after = readZipEntries(readFileSync(afterPath));
  const { rows, onlyBefore, onlyAfter, totals } = diffEntries(before, after, { normalize });

  const allRows = [...rows, ...onlyBefore, ...onlyAfter].sort(
    (a, b) => Math.abs(b.delta) - Math.abs(a.delta),
  );
  const byDir = aggregateByTopDir(allRows);

  console.log('=== HAP 体积逐条目归因 ===');
  console.log('before: ' + beforePath + '  (' + totals.beforeTotal + ' B, ' + totals.beforeEntries + ' entries)');
  console.log('after : ' + afterPath + '  (' + totals.afterTotal + ' B, ' + totals.afterEntries + ' entries)');
  console.log('total delta: ' + fmt(totals.delta) + ' B');
  console.log('');

  console.log('--- 变化最大的 ' + top + ' 个条目 (按 |delta| 排序) ---');
  console.log('     delta B   before B    after B  entry');
  for (const r of allRows.slice(0, top)) {
    console.log('  ' + fmt(r.delta) + '  ' + String(r.before).padStart(9) + '  ' + String(r.after).padStart(9) + '  ' + r.name);
  }
  console.log('');
  console.log('变化条目 ' + totals.changedEntries + ' / 删除 ' + totals.onlyBeforeCount + ' / 新增 ' + totals.onlyAfterCount);

  console.log('--- 按顶层目录聚合 ---');
  console.log('     delta B   before B    after B  n   dir');
  for (const d of byDir) {
    console.log('  ' + fmt(d.delta) + '  ' + String(d.before).padStart(9) + '  ' + String(d.after).padStart(9) + '  ' + String(d.count).padStart(3) + '  ' + d.dir);
  }
  console.log('');
  console.log('--- 新增条目 (' + onlyAfter.length + ') / 删除条目 (' + onlyBefore.length + ') ---');
  for (const r of onlyAfter.slice(0, top)) console.log('  + ' + String(r.after).padStart(9) + '  ' + r.name);
  for (const r of onlyBefore.slice(0, top)) console.log('  - ' + String(-r.delta).padStart(9) + '  ' + r.name);

  if (outPath) {
    const report = {
      generatedAt: new Date().toISOString(),
      normalize,
      before: { path: beforePath, ...totals, entries: before },
      after: { path: afterPath, entries: after },
      topByAbsDelta: allRows.slice(0, top),
      allRows,
      byTopDir: byDir,
      onlyAfter,
      onlyBefore,
    };
    writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
    console.log('');
    console.log('[attribute-hap-size] wrote ' + outPath);
  }
}

// 仅在作为 CLI 直接运行时执行 main (被 import 时不执行, 便于单测).
if (process.argv[1] && process.argv[1].endsWith('attribute-hap-size.mjs')) {
  main();
}