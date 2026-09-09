/**
 * seed-and-verify.mjs (v0.5.0-harmony Stage 4)
 *
 * 模拟器运行验证自动化: 预置到期卡片 -> 冷启动 -> 断言运行日志关键词链.
 *
 * 验证链 (对应 harmony/CURRENT_STATUS.md 7.1):
 *   RDB seed (action=debugSeed) -> RDB 恢复 -> Web ready ACK ->
 *   冷/热启动 FIFO 消费 -> 进入复习页
 *
 * 用法:
 *   node scripts/harmony/seed-and-verify.mjs \
 *     --hdc "D:\DevEco Studio\sdk\default\openharmony\toolchains\hdc.exe" \
 *     --hap harmony/entry/build/default/outputs/default/entry-default-unsigned.hap \
 *     --timeout 60000 --out seed-report.json
 *
 * 退出码: 0 = 全部断言通过或 SKIP (模拟器不在线); 1 = 断言失败/运行错误.
 * SKIP 不视为失败 (沙箱约束: 模拟器不在线时不阻塞 CI).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DEFAULT_BUNDLE = 'com.wordaydream.app';
const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_POLL_INTERVAL_MS = 2000;

/** CLI 参数解析 (纯函数, 供 T03 单测). */
export function parseArgs(argv) {
  const args = {
    hdc: 'hdc',
    hap: 'harmony/entry/build/default/outputs/default/entry-default-unsigned.hap',
    bundle: DEFAULT_BUNDLE,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    out: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    const next = argv[i + 1];
    switch (key) {
      case '--hdc': args.hdc = next; i++; break;
      case '--hap': args.hap = next; i++; break;
      case '--bundle': args.bundle = next; i++; break;
      case '--timeout': args.timeoutMs = Number(next) || DEFAULT_TIMEOUT_MS; i++; break;
      case '--out': args.out = next; i++; break;
      case '--help': case '-h': args.help = true; break;
      default: break;
    }
  }
  return args;
}

/** SKIP 报告结构 (纯函数, 供 T03 单测): 模拟器不在线等场景. */
export function buildSkipReport(reason, args) {
  return {
    skipped: true,
    ok: true,
    reason,
    steps: [],
    assertions: [],
    generatedAt: null,
    hap: args?.hap ?? null,
    bundle: args?.bundle ?? null,
  };
}

/** 断言关键词 (运行日志证据链, 顺序即验证链顺序). */
export const ASSERTION_KEYWORDS = [
  { id: 'A1', keyword: 'seedDebugCards done', desc: '原生 RDB 预置 5 张到期卡完成' },
  { id: 'A2', keyword: 'Page begin', desc: 'ArkWeb 虚拟 HTTPS 入口开始加载' },
  { id: 'A3', keyword: 'Web content ready', desc: 'React content-ready ACK 到达' },
  { id: 'A4', keyword: 'getAllCards=', desc: 'RDB 恢复链路执行 (卡片数上报)' },
  { id: 'A5', keyword: 'queued', desc: '启动请求进入原生 FIFO 队列' },
];

/** 单条日志断言评估 (纯函数, 供单测): 关键词在日志窗口中是否出现. */
export function evaluateAssertion(keyword, logWindow) {
  return logWindow.includes(keyword);
}

function runHdc(hdc, argsList, timeoutMs) {
  const child = spawnSync(hdc, argsList, {
    encoding: 'utf8',
    timeout: timeoutMs,
    shell: false,
  });
  return {
    code: child.status,
    stdout: child.stdout || '',
    stderr: child.stderr || '',
    error: child.error ? child.error.message : null,
  };
}

function collectReport(args, steps, assertionResults, startedAt) {
  const ok = assertionResults.every((a) => a.passed);
  const report = {
    skipped: false,
    ok,
    steps,
    assertions: assertionResults,
    hap: args.hap,
    bundle: args.bundle,
    timeoutMs: args.timeoutMs,
    generatedAt: new Date(startedAt).toISOString(),
  };
  return report;
}

/** 写报告 (stdout 或 --out 文件). */
function emitReport(report, out) {
  const text = JSON.stringify(report, null, 2);
  if (out) {
    writeFileSync(resolve(out), text, 'utf8');
    console.log(`[seed-verify] report written to ${out}`);
  } else {
    console.log(text);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/harmony/seed-and-verify.mjs [--hdc <path>] [--hap <path>] [--bundle <name>] [--timeout <ms>] [--out <file>]');
    return 0;
  }
  if (!existsSync(args.hap)) {
    console.error(`[seed-verify] HAP not found: ${args.hap} — run npm run build:harmony:hap first`);
    return 1;
  }

  const startedAt = Date.now();
  const steps = [];

  // 1. 设备在线检测 — 不在线 = SKIP (exit 0, 不阻塞).
  const targets = runHdc(args.hdc, ['list', 'targets'], 10000);
  const online = targets.code === 0 && targets.stdout.split('\n').some((l) => l.startsWith('127.0.0.1') || l.includes('CONNECTED') || (l.trim().length > 0 && !l.startsWith('[Empty]')));
  if (!online) {
    const report = buildSkipReport('no emulator/device online (hdc list targets empty)', args);
    report.generatedAt = new Date(startedAt).toISOString();
    emitReport(report, args.out);
    console.log('[seed-verify] SKIP: no device online — not treated as failure');
    return 0;
  }
  steps.push({ name: 'list-targets', ok: true, detail: targets.stdout.trim() });

  // 2. 安装 HAP.
  const hapAbs = resolve(args.hap);
  const install = runHdc(args.hdc, ['install', '-r', hapAbs], 120000);
  const installOk = install.stdout.includes('successfully') || install.code === 0;
  steps.push({ name: 'install-hap', ok: installOk, detail: (install.stdout + install.stderr).trim().slice(0, 500) });
  if (!installOk) {
    emitReport(collectReport(args, steps, [{ id: 'INSTALL', passed: false, detail: install.stderr }], startedAt), args.out);
    return 1;
  }

  // 3. 强制停止 + 清空 hilog.
  runHdc(args.hdc, ['shell', 'aa', 'force-stop', args.bundle], 15000);
  runHdc(args.hdc, ['shell', 'hilog', '-r'], 15000);
  steps.push({ name: 'reset', ok: true, detail: 'force-stop + hilog -r' });

  // 4. 冷启动 + seed (want parameter query=action=debugSeed).
  const start = runHdc(args.hdc, ['shell', 'aa', 'start', '--ps', 'query', 'action=debugSeed', '-b', args.bundle, '-a', 'EntryAbility'], 20000);
  const startOk = start.code === 0 && !/error/i.test(start.stdout + start.stderr);
  steps.push({ name: 'aa-start-debug-seed', ok: startOk, detail: (start.stdout + start.stderr).trim().slice(0, 300) });

  // 5. 轮询 hilog 收集窗口, 直到全部关键词命中或超时.
  const deadline = Date.now() + args.timeoutMs;
  let logWindow = '';
  const assertionResults = ASSERTION_KEYWORDS.map((k) => ({ id: k.id, keyword: k.keyword, desc: k.desc, passed: false }));
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, DEFAULT_POLL_INTERVAL_MS));
    const dump = runHdc(args.hdc, ['shell', 'hilog', '-x'], 15000);
    logWindow = dump.stdout || '';
    for (const a of assertionResults) {
      if (!a.passed && evaluateAssertion(a.keyword, logWindow)) {
        a.passed = true;
        a.evidenceAt = new Date().toISOString();
      }
    }
    if (assertionResults.every((a) => a.passed)) break;
  }

  const report = collectReport(args, steps, assertionResults, startedAt);
  // 留存日志窗口片段作为证据 (每条断言首行命中前后 1 行).
  report.evidence = {};
  for (const a of assertionResults) {
    const idx = logWindow.indexOf(a.keyword);
    if (idx >= 0) {
      report.evidence[a.id] = logWindow.slice(Math.max(0, idx - 120), idx + 160);
    }
  }
  emitReport(report, args.out);
  return report.ok ? 0 : 1;
}

// CLI 入口 (被 import 时不执行).
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.url.replace('file:///', '').replace(/\//g, process.platform === 'win32' ? '\\' : '/'));
if (isMain || process.argv[1]?.endsWith('seed-and-verify.mjs')) {
  main().then((code) => process.exit(code)).catch((e) => {
    console.error('[seed-verify] fatal:', e.message);
    process.exit(1);
  });
}
