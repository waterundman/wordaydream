/**
 * check-version-alignment.mjs
 *
 * Wordaydream v0.5.0-harmony Stage 1: 版本策略统一校验器。
 *
 * 版本口径规则（单一真源 = 仓库根包 package.json 的 web 版本）：
 *   - web 版本与 harmony 版本映射：web.major.minor = harmony.major.minor + 2
 *     （即 web 2.5.0 ↔ harmony 0.5.0）
 *   - patch 必须一致：web.patch === harmony.patch
 *   - harmony 侧各文件（AppScope / entry / build-profile）之间必须对齐。
 *
 * 核心逻辑 checkAlignment(versions) 为纯函数，便于 T01/T02/T03 单测直接 import。
 * CLI 入口读取实际文件后调用它，并打印对齐表或差异明细。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative } from 'node:path';
import JSON5 from 'json5';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

/** 各版本来源对应的真实文件路径（供 diff 报告打印）。 */
export const VERSION_FILES = {
  web: 'package.json',
  appScope: 'harmony/AppScope/app.json5',
  entry: 'harmony/entry/oh-package.json5',
  buildProfile: 'harmony/build-profile.json5',
};

const MAJOR_OFFSET = 2;

/**
 * 解析 semver 字符串为 { major, minor, patch }（仅取三段数字）。
 * 容错：忽略预发布/build 后缀；非数字段按 0 处理。
 */
export function parseSemver(version) {
  const m = String(version).trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) {
    return { major: NaN, minor: NaN, patch: NaN };
  }
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

/**
 * 由 web 版本推导期望的 harmony 版本字符串。
 * web.major.minor = harmony.major.minor + MAJOR_OFFSET，patch 一致。
 */
export function expectedHarmonyFromWeb(webVersion) {
  const web = parseSemver(webVersion);
  return {
    major: web.major - MAJOR_OFFSET,
    minor: web.minor,
    patch: web.patch,
  };
}

/**
 * 纯函数：校验版本对齐。
 *
 * @param {Object} versions 形如 { web, appScope, entry, buildProfile? }
 *   web 为必填；harmony 侧任意一项缺失（undefined/null）则跳过该项。
 * @returns {{ ok: boolean, diffs: Array<{source:string,file:string,expected:string,actual:string}> }}
 *   ok=false 时 diffs 含每处错位：来源键、文件路径、期望值、实际值。
 */
export function checkAlignment(versions) {
  const diffs = [];

  if (!versions || versions.web === undefined || versions.web === null) {
    throw new Error('checkAlignment: versions.web is required');
  }

  const expected = expectedHarmonyFromWeb(versions.web);
  const expectedStr = `${expected.major}.${expected.minor}.${expected.patch}`;

  const harmonySources = ['appScope', 'entry', 'buildProfile'];
  for (const key of harmonySources) {
    const actual = versions[key];
    if (actual === undefined || actual === null) {
      continue; // 该来源无版本字段，跳过
    }
    const parsed = parseSemver(actual);
    const mismatch =
      parsed.major !== expected.major ||
      parsed.minor !== expected.minor ||
      parsed.patch !== expected.patch;
    if (mismatch) {
      diffs.push({
        source: key,
        file: VERSION_FILES[key],
        expected: expectedStr,
        actual: String(actual),
      });
    }
  }

  return { ok: diffs.length === 0, diffs };
}

/**
 * 从磁盘读取四处版本，构造 checkAlignment 所需的 versions 对象。
 * - 读取失败或文件不存在的 web 会抛错；harmony 侧缺版本字段则置为 undefined。
 */
export function readVersionsFromDisk(root = ROOT) {
  const web = JSON5.parse(
    readFileSync(resolve(root, VERSION_FILES.web), 'utf8'),
  ).version;

  const appScope = JSON5.parse(
    readFileSync(resolve(root, VERSION_FILES.appScope), 'utf8'),
  ).app.versionName;

  const entry = JSON5.parse(
    readFileSync(resolve(root, VERSION_FILES.entry), 'utf8'),
  ).version;

  // build-profile.json5 可能没有版本字段；缺失则用 undefined 表示。
  let buildProfile;
  try {
    const bp = JSON5.parse(
      readFileSync(resolve(root, VERSION_FILES.buildProfile), 'utf8'),
    );
    buildProfile =
      bp.app?.versionName ??
      bp.app?.version ??
      bp.version ??
      undefined;
  } catch {
    buildProfile = undefined;
  }

  return { web, appScope, entry, buildProfile };
}

function formatTableRow(label, value) {
  return `  ${label.padEnd(14)} ${value}`;
}

/** CLI 入口。 */
function main() {
  const versions = readVersionsFromDisk();
  const { ok, diffs } = checkAlignment(versions);
  const root = process.cwd();

  if (ok) {
    const expected = expectedHarmonyFromWeb(versions.web);
    const expectedStr = `${expected.major}.${expected.minor}.${expected.patch}`;
    console.log('版本对齐校验通过 (PASS)');
    console.log('对齐映射: web = harmony + ' + MAJOR_OFFSET + ' (patch 一致)');
    console.log(formatTableRow('web (package)', versions.web));
    console.log(formatTableRow('harmony 期望', expectedStr));
    console.log(formatTableRow('AppScope', versions.appScope));
    console.log(formatTableRow('entry', versions.entry));
    console.log(
      formatTableRow(
        'build-profile',
        versions.buildProfile ?? '(无版本字段, 跳过)',
      ),
    );
    process.exit(0);
  } else {
    console.error('版本对齐校验失败 (FAIL)');
    for (const d of diffs) {
      const rel = relative(root, resolve(root, d.file));
      console.error(`  - ${rel}`);
      console.error(`      期望: ${d.expected}`);
      console.error(`      实际: ${d.actual}`);
    }
    process.exit(1);
  }
}

// 仅当作为入口直接运行（而非被 import）时执行 CLI。
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  main();
}
