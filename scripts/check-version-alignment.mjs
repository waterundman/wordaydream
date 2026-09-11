/**
 * check-version-alignment.mjs
 *
 * Wordaydream v0.5.0-harmony Stage 1: 版本策略统一校验器。
 *
 * 版本口径规则（单一真源 = 仓库根包 package.json 的 web 版本）：
 *   - web 版本与 harmony 版本映射：web.major.minor = harmony.major.minor + 2
 *     （即 web 2.6.0 ↔ harmony 0.6.0）
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
 * 由 harmony versionName 推导期望的 app.versionCode（数字字面量）。
 *
 * 线性规则（v0.7.0-harmony Stage 2 固化，与三个历史锚点全部吻合）：
 *   versionCode = 1000000 + (minor - 3) * 5 + patch
 *   锚点: 0.3.0 → 1000000, 0.5.0 → 1000010, 0.6.0 → 1000015, 0.7.0 → 1000020
 *
 * harmony major ≠ 0 时返回 null：表示规则未覆盖，校验应跳过。
 * 注释：major 演进（1.x / 2.x …）时版本基准会重设，需同步修订本规则与基准常量。
 *
 * @param {string} harmonyVersionName harmony 版本名, 如 '0.6.0'
 * @returns {number|null} 期望值数字；未覆盖返回 null
 */
export function expectedVersionCode(harmonyVersionName) {
  const { major, minor, patch } = parseSemver(harmonyVersionName);
  if (major !== 0) {
    return null; // 规则未覆盖（major 演进时需重设基准）
  }
  return 1000000 + (minor - 3) * 5 + patch;
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

  // versionCode 检查（向后兼容：未携带 versionCode 字段的调用自动跳过）。
  // harmony versionName 取自 versions.appScope（与 diff 报告同源）。
  const harmonyVersionName = versions.appScope;
  const expectedCode = expectedVersionCode(harmonyVersionName);
  const actualCode = versions.versionCode;
  if (actualCode !== undefined && actualCode !== null && expectedCode !== null) {
    if (Number(actualCode) !== expectedCode) {
      diffs.push({
        source: 'versionCode',
        file: VERSION_FILES.appScope,
        expected: String(expectedCode),
        actual: String(actualCode),
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

  const appScopeRaw = JSON5.parse(
    readFileSync(resolve(root, VERSION_FILES.appScope), 'utf8'),
  );
  const appScope = appScopeRaw.app.versionName;
  // versionCode 为数字字面量；数字字符串也能接受，缺失为 undefined。
  const versionCode = appScopeRaw.app.versionCode;

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

  return { web, appScope, entry, buildProfile, versionCode };
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
    // versionCode 行（规则未覆盖或缺失时给出跳过说明）。
    const expectedCode = expectedVersionCode(versions.appScope);
    if (expectedCode === null) {
      console.log(
        formatTableRow('versionCode', versions.versionCode ?? '(缺失)') +
          ' (规则未覆盖 major≠0, 跳过)',
      );
    } else if (versions.versionCode === undefined || versions.versionCode === null) {
      console.log(formatTableRow('versionCode', '(缺失, 跳过)'));
    } else {
      console.log(
        formatTableRow('versionCode', String(versions.versionCode)) +
          ` (期望 ${expectedCode})`,
      );
    }
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
