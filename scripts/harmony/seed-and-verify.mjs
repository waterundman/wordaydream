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
 *
 * M6: runHdc / parseArgs / buildSkipReport / 设备在线判定 统一收敛到
 * scripts/harmony/lib/hdc.mjs; 断言关键词收敛到 scripts/harmony/assertion-keywords.mjs
 * (本文件仍原样再导出, 导入面与报告字段完全不变).
 */
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  buildSkipReport as buildSkipReportBase,
  createArgsParser,
  isCliInvocation,
  isDeviceOnline,
  runHdc,
} from './lib/hdc.mjs';
import { ASSERTION_KEYWORDS, OPEN_CARD_ASSERTIONS, isCritical } from './assertion-keywords.mjs';

const DEFAULT_BUNDLE = 'com.wordaydream.app';
const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_POLL_INTERVAL_MS = 2000;

/** 断言关键词真源在 assertion-keywords.mjs; 此处再导出, 保持既有 import 面不变. */
export { ASSERTION_KEYWORDS, OPEN_CARD_ASSERTIONS, isCritical };

const parseArgsImpl = createArgsParser([
  { flag: '--hdc', key: 'hdc', default: 'hdc' },
  {
    flag: '--hap',
    key: 'hap',
    default: 'harmony/entry/build/default/outputs/default/entry-default-unsigned.hap',
  },
  { flag: '--bundle', key: 'bundle', default: DEFAULT_BUNDLE },
  { flag: '--timeout', key: 'timeoutMs', type: 'number', default: DEFAULT_TIMEOUT_MS },
  { flag: '--out', key: 'out', default: null },
  // 空串 (--open-card "") = 跳过 openCard 阶段的标记, 因此值本身要能落进去.
  { flag: '--open-card', key: 'openCard', type: 'optional', default: 'debug-seed-1' },
  { flag: '--help', key: 'help', type: 'boolean', aliases: ['-h'], default: false },
]);

/** CLI 参数解析 (纯函数, 供 T03 单测). */
export function parseArgs(argv) {
  return parseArgsImpl(argv);
}

/** SKIP 报告结构 (纯函数, 供 T03 单测): 模拟器不在线等场景. */
export function buildSkipReport(reason, args) {
  return buildSkipReportBase(reason, args, {
    steps: [],
    assertions: [],
    generatedAt: null,
    hap: args?.hap ?? null,
    bundle: args?.bundle ?? null,
  });
}

/** openCard 阶段是否启用 (openCard 为空串 = 跳过标记). */
export function openCardEnabled(args) {
  return args.openCard !== '' && args.openCard != null;
}

/** 单条日志断言评估 (纯函数, 供单测): 关键词在日志窗口中是否出现. */
export function evaluateAssertion(keyword, logWindow) {
  return logWindow.includes(keyword);
}

export function collectReport(args, steps, seedAssertions, startedAt, options = {}) {
  const openCardAssertions = options.openCardAssertions ?? null;
  const openCardQuery = options.openCardQuery ?? null;
  // ok 仅由 critical 断言决定 (level 缺省 = critical); soft 失败不影响
  const allCritical = [...seedAssertions, ...(openCardAssertions ?? [])]
    .filter(isCritical)
    .every((a) => a.passed);
  const report = {
    skipped: false,
    ok: allCritical,
    steps,
    assertions: seedAssertions,
    openCardQuery,
    openCardAssertions,
    hap: args.hap,
    bundle: args.bundle,
    timeoutMs: args.timeoutMs,
    generatedAt: new Date(startedAt).toISOString(),
  };
  return report;
}

/** 生成证据片段 (命中关键词前后窗口), 纯函数供单测. */
export function buildEvidence(logWindow, assertions) {
  const ev = {};
  for (const a of assertions) {
    const idx = logWindow.indexOf(a.keyword);
    if (idx >= 0) {
      ev[a.id] = logWindow.slice(Math.max(0, idx - 120), idx + 160);
    }
  }
  return ev;
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
    console.log('Usage: node scripts/harmony/seed-and-verify.mjs [--hdc <path>] [--hap <path>] [--bundle <name>] [--timeout <ms>] [--open-card <cardId>] [--out <file>]');
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
  const online = isDeviceOnline(targets.stdout, targets.code);
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

  // 3. 强制停止 + 清应用数据 + 清空 hilog.
  runHdc(args.hdc, ['shell', 'aa', 'force-stop', args.bundle], 15000);
  // R-1 恢复契约 (useMemoryStore onRehydrateStorage): localStorage 非空时 web 跳过
  // getAllCards (避免覆盖用户最近写入). 模拟器残留历史数据会使 seed 到期卡对 web
  // 不可见 (实测 2026-09-16: 旧数据 83 卡全部未到期, openCard 场景 A 双语言
  // getDueCards=0 -> 静默降级 '暂无到期复习卡片', 该路径无运行验证日志点, A7 永失).
  // bm clean -d 清空应用数据 (localStorage + RDB), 保证验证从干净状态出发且可复现.
  const clean = runHdc(args.hdc, ['shell', 'bm', 'clean', '-n', args.bundle, '-d'], 30000);
  const cleanOk = !/error|failed/i.test(clean.stdout + clean.stderr);
  steps.push({ name: 'clean-app-data', ok: cleanOk, detail: (clean.stdout + clean.stderr).trim().slice(0, 300) });
  if (!cleanOk) {
    emitReport(
      collectReport(args, steps, [{ id: 'CLEAN', passed: false, detail: clean.stderr || clean.stdout }], startedAt),
      args.out,
    );
    return 1;
  }
  runHdc(args.hdc, ['shell', 'hilog', '-r'], 15000);
  steps.push({ name: 'reset', ok: true, detail: 'force-stop + clean-app-data + hilog -r' });

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

  const report = collectReport(args, steps, assertionResults, startedAt, {
    openCardAssertions: null,
    openCardQuery: null,
  });
  // 留存 seed 段日志窗口片段作为证据 (每条断言首行命中前后 1 行).
  report.evidence = buildEvidence(logWindow, assertionResults);

  // 6. openCard 阶段 (seed 全命中后, 模拟器在线才进入; --open-card "" 跳过).
  if (openCardEnabled(args)) {
    const query = `action=openCard&cardId=${args.openCard}`;
    // 清空 hilog, 避免 seed 段日志干扰 openCard 段独立评估窗口.
    runHdc(args.hdc, ['shell', 'hilog', '-r'], 15000);
    // query 含 '&' (action=openCard&cardId=...): hdc shell 把参数拼接成一行交给
    // 设备端 /bin/sh 解析, 裸 '&' 会被当成后台符拆断命令 (实测报错:
    // "/bin/sh: -b: inaccessible or not found"). 给 query 套一层双引号,
    // 保证设备端按单 token 解析. debugSeed 无 '&' 不受影响, 无需同改.
    const quotedQuery = `"${query}"`;
    // 发送 openCard want (query 整串作为单个 --ps 值, 与 debugSeed 传参方式一致).
    const ocStart = runHdc(
      args.hdc,
      ['shell', 'aa', 'start', '--ps', 'query', quotedQuery, '-b', args.bundle, '-a', 'EntryAbility'],
      20000,
    );
    steps.push({
      name: 'aa-start-open-card',
      ok: ocStart.code === 0 && !/error/i.test(ocStart.stdout + ocStart.stderr),
      detail: (ocStart.stdout + ocStart.stderr).trim().slice(0, 300),
    });

    // 独立轮询窗口 (复用 timeoutMs) 至 A6/A7 命中或超时.
    const ocDeadline = Date.now() + args.timeoutMs;
    let ocWindow = '';
    const ocAssertions = OPEN_CARD_ASSERTIONS.map((k) => ({
      id: k.id, keyword: k.keyword, desc: k.desc, level: k.level, passed: false,
    }));
    while (Date.now() < ocDeadline) {
      await new Promise((r) => setTimeout(r, DEFAULT_POLL_INTERVAL_MS));
      const dump = runHdc(args.hdc, ['shell', 'hilog', '-x'], 15000);
      ocWindow = dump.stdout || '';
      for (const a of ocAssertions) {
        if (!a.passed && evaluateAssertion(a.keyword, ocWindow)) {
          a.passed = true;
          a.evidenceAt = new Date().toISOString();
        }
      }
      if (ocAssertions.every((a) => a.passed)) break;
    }

    report.openCardAssertions = ocAssertions;
    report.openCardQuery = query;
    // evidence 机制对 openCardAssertions 同样生效 (命中片段留存).
    report.evidence = { ...report.evidence, ...buildEvidence(ocWindow, ocAssertions) };
  }

  // 最终 ok: 仅 critical 断言 (assertions + openCardAssertions 中的 critical) 决定;
  // soft 失败只记 evidence 不影响. seed 段与 openCard 段独立评估.
  report.ok = [...assertionResults, ...(report.openCardAssertions ?? [])]
    .filter(isCritical)
    .every((a) => a.passed);

  emitReport(report, args.out);
  return report.ok ? 0 : 1;
}

// CLI 入口 (被 import 时不执行). M6: 用标准 import.meta.url 比较替代
// 原先的 'file:///' 字符串替换 + endsWith 兜底判定 (见 lib/hdc.mjs isCliInvocation).
const isMain = isCliInvocation(import.meta.url);
if (isMain) {
  main().then((code) => process.exit(code)).catch((e) => {
    console.error('[seed-verify] fatal:', e.message);
    process.exit(1);
  });
}
