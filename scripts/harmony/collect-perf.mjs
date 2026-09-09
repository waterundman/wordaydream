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
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const DEFAULT_BUNDLE = 'com.wordaydream.app';
const DEFAULT_TIMEOUT_MS = 60000;

/** CLI 参数解析 (纯函数, 供 T03 单测). */
export function parseArgs(argv) {
  const args = {
    hdc: 'hdc',
    bundle: DEFAULT_BUNDLE,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    out: null,
  };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--hdc': args.hdc = argv[i + 1]; i++; break;
      case '--bundle': args.bundle = argv[i + 1]; i++; break;
      case '--timeout': args.timeoutMs = Number(argv[i + 1]) || DEFAULT_TIMEOUT_MS; i++; break;
      case '--out': args.out = argv[i + 1]; i++; break;
      default: break;
    }
  }
  return args;
}

/** SKIP 报告 (纯函数). */
export function buildSkipReport(reason, args) {
  return { skipped: true, ok: true, reason, metrics: {}, bundle: args?.bundle ?? null };
}

/** 从 hilog 行提取最早/最晚时间戳 (HH:MM:SS.mmm) 并计算毫秒差 (纯函数). */
export function computeColdStartMs(logWindow) {
  const ts = [...logWindow.matchAll(/(\d{2}):(\d{2}):(\d{2})\.(\d{3})/g)].map((m) => {
    const [, h, mi, s, ms] = m;
    return Number(h) * 3600000 + Number(mi) * 60000 + Number(s) * 1000 + Number(ms);
  });
  if (ts.length < 2) return null;
  const min = Math.min(...ts);
  const max = Math.max(...ts);
  // 跨午夜保护: 差值异常大 (>1h) 视为无效.
  return max - min > 3600000 ? null : max - min;
}

/** 从 hidumper 输出提取 PSS 合计行 (纯函数). */
export function extractPssKb(hidumperOutput) {
  const m = hidumperOutput.match(/TOTAL PSS:\s*(\d+)/i) || hidumperOutput.match(/TOTAL:\s*(\d+)/i);
  return m ? Number(m[1]) : null;
}

function runHdc(hdc, argsList, timeoutMs) {
  const child = spawnSync(hdc, argsList, { encoding: 'utf8', timeout: timeoutMs });
  return (child.stdout || '') + (child.stderr || '');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const targets = runHdc(args.hdc, ['list', 'targets'], 10000);
  const online = targets.split('\n').some((l) => l.startsWith('127.0.0.1') || (l.trim().length > 0 && !l.startsWith('[Empty]')));
  if (!online) {
    const skip = buildSkipReport('no emulator/device online', args);
    const text = JSON.stringify(skip, null, 2);
    if (args.out) writeFileSync(args.out, text, 'utf8');
    else console.log(text);
    console.log('[perf] SKIP: no device online');
    return 0;
  }

  runHdc(args.hdc, ['shell', 'aa', 'force-stop', args.bundle], 15000);
  runHdc(args.hdc, ['shell', 'hilog', '-r'], 15000);
  runHdc(args.hdc, ['shell', 'aa', 'start', '-b', args.bundle, '-a', 'EntryAbility'], 20000);

  const deadline = Date.now() + args.timeoutMs;
  let logWindow = '';
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    logWindow = runHdc(args.hdc, ['shell', 'hilog', '-x'], 15000);
    if (logWindow.includes('Web content ready')) break;
  }
  const coldStartMs = computeColdStartMs(logWindow);
  const pidLine = runHdc(args.hdc, ['shell', 'pidof', args.bundle], 10000).trim();
  const pid = pidLine.split(/\s+/)[0];
  let pssKb = null;
  if (pid) {
    pssKb = extractPssKb(runHdc(args.hdc, ['shell', 'hidumper', '--mem', pid], 20000));
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

const isMain = process.argv[1]?.endsWith('collect-perf.mjs');
if (isMain) {
  main().then((code) => process.exit(code)).catch((e) => {
    console.error('[perf] fatal:', e.message);
    process.exit(1);
  });
}
