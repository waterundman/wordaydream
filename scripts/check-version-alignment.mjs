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

/**
 * 「上次发布 versionCode」真源（H8 修复）：此前 versionCode 只校验「与版本号的映射」，
 * 没有任何跨版本单调性护栏 —— 漏 bump / 回退都能 PASS。基准数值落在受版本控制的
 * 独立文件里，发布时随版本号一起人工递进（脚本只读，不自动改写，避免误伤）。
 */
export const LAST_RELEASE_FILE = 'scripts/harmony/last-release.json';

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
 * versionCode 映射基准（按 harmony major 分段）。
 *
 * 统一线性形式：
 *   versionCode = anchorCode + (minor - anchorMinor) * minorStep + patch * patchStep
 *
 *   - 0.x 线（历史原式，语义保持不变）：1000000 + (minor - 3) * 5 + patch
 *       锚点 0.3.0→1000000 / 0.5.0→1000010 / 0.6.0→1000015 / 0.7.0→1000020 / 0.7.1→1000021
 *   - 1.x 线（H8 新覆盖，来自 docs/spec/v1.6.1/main.md §R10 的 git 历史实测表）：
 *       1000035 + minor * 5 + patch * 5
 *       锚点 1.0.0→1000035 / 1.4.0→1000055 / 1.6.0→1000065 / 1.6.1→1000070 / 1.6.2→1000075
 *       注：1.x 线每次发布（minor 或 patch 前进）都 +5，与 0.x 线「patch 只 +1」不同，
 *       这是历史事实而非笔误 —— 0→1 跨越时基准不重设、继续线性累加。
 *
 * 未覆盖的 major（≥2 或版本号不可解析）返回 null：调用方 **不得静默跳过**，
 * 必须显式失败并提示在此补基准常量（H8 的根因就是「null → 静默跳过」形成盲区）。
 *
 * 已知局限：映射式无法预知真实发布顺序 —— 若先出 1.6.3(=1000080) 再出 1.7.0(=1000070)，
 * 公式会给出回退值。该情形由单调性校验（checkVersionCodeMonotonic + last-release.json）
 * 兜底为显式 FAIL，需要人工在 VERSION_CODE_BASES 重设基准。
 *
 * @param {string} harmonyVersionName harmony 版本名, 如 '0.6.0' / '1.6.2'
 * @returns {number|null} 期望值数字；未覆盖返回 null
 */
export const VERSION_CODE_BASES = {
  0: { anchorMinor: 3, anchorCode: 1000000, minorStep: 5, patchStep: 1 },
  1: { anchorMinor: 0, anchorCode: 1000035, minorStep: 5, patchStep: 5 },
};

export function expectedVersionCode(harmonyVersionName) {
  const { major, minor, patch } = parseSemver(harmonyVersionName);
  const base = VERSION_CODE_BASES[major];
  if (!base) {
    return null; // 规则未覆盖（major 演进时需补 VERSION_CODE_BASES 基准）
  }
  return base.anchorCode + (minor - base.anchorMinor) * base.minorStep + patch * base.patchStep;
}

/**
 * 纯函数：versionCode 跨版本单调性（H8）。
 *
 * 规则：当前 versionCode 必须 **>=** 上次发布值；等于时不判失败但必须告警
 * （同一 versionCode 覆盖安装会被鸿蒙拒装 / 灰度无法区分），大于则通过。
 *
 * @param {number|string|undefined|null} currentCode 当前 AppScope versionCode
 * @param {number|string|undefined|null} lastReleaseCode last-release.json 记录的数值
 * @returns {{status: 'ok'|'equal'|'behind'|'skipped', diff?: Object, warning?: string}}
 */
export function checkVersionCodeMonotonic(currentCode, lastReleaseCode) {
  if (currentCode === undefined || currentCode === null || lastReleaseCode === undefined || lastReleaseCode === null) {
    return { status: 'skipped' };
  }
  const current = Number(currentCode);
  const last = Number(lastReleaseCode);
  if (!Number.isFinite(current) || !Number.isFinite(last)) {
    return { status: 'skipped' };
  }
  if (current > last) {
    return { status: 'ok' };
  }
  if (current === last) {
    return {
      status: 'equal',
      warning:
        `versionCode 与上次发布相同 (${current}) —— 正式发布前必须递增 ` +
        `(真源: ${LAST_RELEASE_FILE})`,
    };
  }
  return {
    status: 'behind',
    diff: {
      source: 'versionCodeMonotonic',
      file: LAST_RELEASE_FILE,
      expected: `> ${last} (上次发布 versionCode, 需单调递增)`,
      actual: String(current),
    },
  };
}


/**
 * 纯函数：校验版本对齐。
 *
 * @param {Object} versions 形如 { web, appScope, entry, buildProfile?, versionCode?, lastReleaseVersionCode? }
 *   web 为必填；harmony 侧任意一项缺失（undefined/null）则跳过该项。
 *   lastReleaseVersionCode 为上次发布值（见 LAST_RELEASE_FILE），提供即启用单调性校验。
 * @returns {{ ok: boolean, diffs: Array<{source:string,file:string,expected:string,actual:string}>, warnings: string[] }}
 *   ok=false 时 diffs 含每处错位：来源键、文件路径、期望值、实际值。
 */
export function checkAlignment(versions) {
  const diffs = [];
  const warnings = [];

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

  // versionCode 检查（H8：无条件）。
  // - 携带 versionCode 且 harmony versionName 可解析 → 必须校验映射关系；
  //   规则未覆盖的 major 不再静默跳过，而是产出显式失败，强制补基准常量。
  // - 未携带 versionCode / 无 harmony versionName → 跳过（纯 versionName 调用方向后兼容）。
  const harmonyVersionName = versions.appScope;
  const parsedHarmony = parseSemver(harmonyVersionName);
  const hasVersionName = Number.isFinite(parsedHarmony.major);
  const hasVersionCode =
    versions.versionCode !== undefined &&
    versions.versionCode !== null &&
    String(versions.versionCode).trim() !== '';
  const expectedCode = expectedVersionCode(harmonyVersionName);

  if (hasVersionCode && hasVersionName) {
    if (expectedCode === null) {
      diffs.push({
        source: 'versionCodeRule',
        file: VERSION_FILES.appScope,
        expected: `已覆盖的 versionCode 映射规则 (现有 major: ${Object.keys(VERSION_CODE_BASES).join(', ')})`,
        actual: `major=${parsedHarmony.major} 未覆盖 —— 请在 VERSION_CODE_BASES 补基准后重试`,
      });
    } else if (Number(versions.versionCode) !== expectedCode) {
      diffs.push({
        source: 'versionCode',
        file: VERSION_FILES.appScope,
        expected: String(expectedCode),
        actual: String(versions.versionCode),
      });
    }
  }

  // 单调性：当前 versionCode 不得小于上次发布值；相等仅告警。
  const monotonic = checkVersionCodeMonotonic(
    versions.versionCode,
    versions.lastReleaseVersionCode,
  );
  if (monotonic.diff) {
    diffs.push(monotonic.diff);
  }
  if (monotonic.warning) {
    warnings.push(monotonic.warning);
  }

  return { ok: diffs.length === 0, diffs, warnings };
}

/**
 * 读取「上次发布 versionCode」真源。
 * 文件缺失 / 非 JSON / 缺 versionCode 字段都视为硬错误：单调性护栏不能因为
 * 真源丢失而自动放行（那正是 H8 要消除的盲区形态）。
 *
 * @param {string} root 仓库根
 * @returns {number} 上次发布的 versionCode
 */
export function readLastReleaseVersionCode(root = ROOT) {
  const filePath = resolve(root, LAST_RELEASE_FILE);
  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch {
    throw new Error(
      `缺少 versionCode 单调性真源 ${LAST_RELEASE_FILE} —— ` +
      '请创建, 内容形如 {"versionCode":1000075,"versionName":"1.6.2"} (上次已发布版本的值)',
    );
  }
  let parsed;
  try {
    parsed = JSON5.parse(raw);
  } catch (error) {
    throw new Error(`${LAST_RELEASE_FILE} 不是合法 JSON: ${error.message}`);
  }
  const code = Number(parsed?.versionCode);
  if (!Number.isFinite(code)) {
    throw new Error(`${LAST_RELEASE_FILE} 缺少数字字段 versionCode`);
  }
  return code;
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

/**
 * CLI 用：读盘构造 versions 对象，并把 last-release.json 的单调性基准并入。
 * 真源不可读时返回 null 并把错误交调用方打印（保证「缺真源」是显式失败而非跳过）。
 */
export function readVersionsWithLastRelease(root = ROOT) {
  const versions = readVersionsFromDisk(root);
  versions.lastReleaseVersionCode = readLastReleaseVersionCode(root);
  return versions;
}


function formatTableRow(label, value) {
  return `  ${label.padEnd(14)} ${value}`;
}

/** CLI 入口。 */
function main() {
  let versions;
  try {
    versions = readVersionsWithLastRelease();
  } catch (error) {
    // 单调性真源缺失/损坏 = 硬失败（不得退化为「跳过校验的 PASS」）。
    console.error('版本对齐校验失败 (FAIL)');
    console.error(`  - ${error.message}`);
    process.exitCode = 1;
    return;
  }
  const { ok, diffs, warnings } = checkAlignment(versions);
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
    // versionCode 行（规则未覆盖时不会走到 PASS —— 见 checkAlignment）。
    const expectedCode = expectedVersionCode(versions.appScope);
    if (versions.versionCode === undefined || versions.versionCode === null) {
      console.log(formatTableRow('versionCode', '(缺失, 跳过)'));
    } else {
      console.log(
        formatTableRow('versionCode', String(versions.versionCode)) +
          (expectedCode === null
            ? ' (规则未覆盖, 未校验)'
            : ` (期望 ${expectedCode})`),
      );
    }
    console.log(
      formatTableRow(
        '上次发布 code',
        versions.lastReleaseVersionCode ?? '(未提供, 跳过单调性)',
      ),
    );
    for (const warning of warnings) {
      console.warn(`[WARN] ${warning}`);
    }
    // exitCode 而非 exit(): 保证 stderr 上的 [WARN] 在管道下也完整冲刷.
    process.exitCode = 0;
  } else {
    console.error('版本对齐校验失败 (FAIL)');
    for (const d of diffs) {
      const rel = relative(root, resolve(root, d.file));
      console.error(`  - ${rel}`);
      console.error(`      期望: ${d.expected}`);
      console.error(`      实际: ${d.actual}`);
    }
    process.exitCode = 1;
  }
}

// 仅当作为入口直接运行（而非被 import）时执行 CLI。
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  main();
}
