/**
 * collect-perf.mjs (v0.5.0-harmony Stage 4)
 *
 * 模拟器性能基线采集 (对应 harmony/CURRENT_STATUS.md 7.2):
 * - 冷启动耗时: Page begin -> Web content ready 时间戳差 (hilog)
 * - 进程 PSS: hidumper --mem <pid> (RSS/PSS 汇总行)
 *
 * 模拟器不在线时 SKIP (exit 0, 不阻塞). 交互级性能 (CSV/LLM Worker 触发)
 * 需 uitest 自动化, 本脚本先落地无交互可采集的基线指标.
 *
 * 用法:
 *   node scripts/harmony/collect-perf.mjs --hdc <path> --bundle <name> [--timeout <ms>] [--out perf.json]
 *
 * M6: runHdc / parseArgs / buildSkipReport / 设备在线判定统一走
 * scripts/harmony/lib/hdc.mjs (与 seed-and-verify.mjs 同一实现), 报告字段与
 * SKIP 契约 (skipped:true / ok:true / 退出码 0) 保持不变.
 */
import { writeFileSync } from 'node:fs';

import {
  buildSkipReport as buildSkipReportBase,
  createArgsParser,
  isCliInvocation,
  isDeviceOnline,
  runHdc,
  runHdcText,
} from './lib/hdc.mjs';

const DEFAULT_BUNDLE = 'com.wordaydream.app';
const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_POLL_INTERVAL_MS = 2000;

const parseArgsImpl = createArgsParser([
  { flag: '--hdc', key: 'hdc', default: 'hdc' },
  { flag: '--bundle', key: 'bundle', default: DEFAULT_BUNDLE },
  { flag: '--timeout', key: 'timeoutMs', type: 'number', default: DEFAULT_TIMEOUT_MS },
  { flag: '--out', key: 'out', default: null },
]);

/** CLI 参数解析 (纯函数, 供 T03 单测). */
export function parseArgs(argv) {
  return parseArgsImpl(argv);
}

/** SKIP 报告 (纯函数). */
export function buildSkipReport(reason, args) {
  return buildSkipReportBase(reason, args, {
    metrics: {},
    bundle: args?.bundle ?? null,
  });
}

/** 解析 hilog 行首 `MM-DD HH:MM:SS.mmm` 为毫秒时间戳 (真实日期数学, 跨午夜/跨月正确; 纯函数). */
const HILOG_TS_RE = /(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\.(\d{3})/;

export function lineEpochMs(line) {
  const m = line.match(HILOG_TS_RE);
  if (!m) return null;
  const [, mo, d, h, mi, s, ms] = m;
  return Date.UTC(2020, Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), Number(ms));
}

/**
 * 冷启动耗时 (纯函数): 口径 = 最后一条 `Page begin` → 最后一条 `Web content ready` 的
 * 时间戳差. 必须按关键词过滤 —— hilog 窗口内混有大量无关系统日志, 直接取全窗口
 * min/max 时间戳跨度会把系统日志间隔当成冷启动 (实测会得出 188s 假值).
 * 任一关键词缺失、时间戳乱序 (差<0) 或差 >1h 均返回 null.
 */
export function computeColdStartMs(logWindow) {
  if (typeof logWindow !== 'string' || logWindow.length === 0) return null;
  const lastTsOf = (label) => {
    const rows = logWindow.split('\n').filter((l) => l.includes(label));
    if (rows.length === 0) return null;
    return lineEpochMs(rows[rows.length - 1]);
  };
  const begin = lastTsOf('Page begin');
  const ready = lastTsOf('Web content ready');
  if (begin === null || ready === null) return null;
  const diff = ready - begin;
  return diff >= 0 && diff <= 3600000 ? diff : null;
}

/**
 * 从 hidumper --mem 输出提取进程 PSS 合计 (KB, 纯函数).
 * API 22 实测格式为三行表头 + `Total  <pssTotal> ...` 行 (Pss Total 列);
 * 兼容旧 `TOTAL PSS:` 单行格式.
 */
export function extractPssKb(hidumperOutput) {
  const m =
    hidumperOutput.match(/TOTAL PSS:\s*(\d+)/i) || hidumperOutput.match(/^\s*Total\s+(\d+)/m);
  return m ? Number(m[1]) : null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const targets = runHdc(args.hdc, ['list', 'targets'], 10000);
  if (!isDeviceOnline(targets.stdout, targets.code)) {
    const skip = buildSkipReport('no emulator/device online', args);
    const text = JSON.stringify(skip, null, 2);
    if (args.out) writeFileSync(args.out, text, 'utf8');
    else console.log(text);
    console.log('[perf] SKIP: no device online');
    return 0;
  }

  runHdcText(args.hdc, ['shell', 'aa', 'force-stop', args.bundle], 15000);
  runHdcText(args.hdc, ['shell', 'hilog', '-r'], 15000);
  runHdcText(args.hdc, ['shell', 'aa', 'start', '-b', args.bundle, '-a', 'EntryAbility'], 20000);

  const deadline = Date.now() + args.timeoutMs;
  let logWindow = '';
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, DEFAULT_POLL_INTERVAL_MS));
    logWindow = runHdcText(args.hdc, ['shell', 'hilog', '-x'], 15000);
    if (logWindow.includes('Web content ready')) break;
  }
  const coldStartMs = computeColdStartMs(logWindow);
  const pidLine = runHdcText(args.hdc, ['shell', 'pidof', args.bundle], 10000).trim();
  const pid = pidLine.split(/\s+/)[0];
  let pssKb = null;
  if (pid) {
    pssKb = extractPssKb(runHdcText(args.hdc, ['shell', 'hidumper', '--mem', pid], 20000));
  }

  const report = {
    skipped: false,
    ok: coldStartMs !== null,
    metrics: { coldStartMs, pssKb, pid: pid || null },
    bundle: args.bundle,
    generatedAt: new Date().toISOString(),
  };
  const text = JSON.stringify(report, null, 2);
  if (args.out) writeFileSync(args.out, text, 'utf8');
  else console.log(text);
  return report.ok ? 0 : 1;
}

// CLI 入口 (被 import 时不执行; M6: 标准 import.meta.url 比较).
const isMain = isCliInvocation(import.meta.url);
if (isMain) {
  main().then((code) => process.exit(code)).catch((e) => {
    console.error('[perf] fatal:', e.message);
    process.exit(1);
  });
}
