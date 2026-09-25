#!/usr/bin/env node
/**
 * scripts/optimize-static-assets.mjs
 *
 * v1.6.1 Stage 2 — 静态资源现代化。
 *
 * 现状 (实测基线, 见 docs/spec/v1.6.1/main.md §2):
 *   public/ 下 5 张位图共 1061.3 KB, 全部是 2010 年代中期的编码方式:
 *     - 3 张 JPG 纹理 (paper-texture-dark / paper-texture-warm /
 *       ink-splash-terracotta), 1368x768 与 1024x1024, 合计 739.4 KB
 *     - 2 张 PNG 图标 (icon-192 / icon-512, 均为 RGBA 且 alpha 全为 255
 *       —— 即"假透明"), 合计 347.4 KB, 高达 1.2 bytes/px
 *
 * 本脚本做两件事:
 *   1. JPG 纹理 -> WebP q80 / method=6  (实测 -59.8%, 大尺寸背景图肉眼无差)
 *   2. PNG 图标 -> MEDIANCUT 256 色调色板 PNG (去冗余 alpha, 实测 -46.5%,
 *      PSNR 45.3 / 46.9 dB; 8x 放大误差图对比为三种量化器中最佳)
 *
 * 为什么图标不用 WebP:
 *   PWA manifest 声明 type='image/png', 且 src/platform/arkWebLocalResourcePolicy
 *   的 MIME 白名单按扩展名映射 —— 换格式会同时打破 manifest 语义与鸿蒙 rawfile 策略。
 *   详见 docs/spec/v1.6.1/main.md §4 D2。
 *
 * 为什么原始素材放在 assets-sources/ 而不是留在 public/:
 *   Vite 会把 public/ 整目录复制进 dist/, 原图留在 public/ 等于继续分发给用户,
 *   而且会把"公共静态资源体积"这个验收指标从 471.9 KB 撑到 1211.3 KB。
 *   放到 public/ 之外既保住了回滚路径, 也让脚本永久可重跑 (调 q 值 / 换量化参数
 *   只需改 TARGETS 再跑 --force, 不必回 git 历史捞文件)。
 *
 * 幂等性:
 *   - 纹理: 产物 .webp 已存在则跳过 (--force 覆盖)
 *   - 图标: 通过读 public/ 产物的 PNG IHDR 判断 colorType 是否已是 3 (indexed);
 *           已是调色板图则跳过 (--force 覆盖)。不依赖 mtime 或额外状态文件。
 *
 * 用法:
 *   node scripts/optimize-static-assets.mjs                 # 执行 (幂等)
 *   node scripts/optimize-static-assets.mjs --dry-run       # 只测不改, 输出报告
 *   node scripts/optimize-static-assets.mjs --check         # 校验是否已全部优化, 未优化则 exit 1
 *   node scripts/optimize-static-assets.mjs --force         # 强制重跑
 *   node scripts/optimize-static-assets.mjs --report out.json
 *   node scripts/optimize-static-assets.mjs --python <path> # 指定带 Pillow 的解释器
 *
 * 回滚:
 *   git checkout HEAD -- public/assets public/icons
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 目标清单: 单一事实来源, 参数改动只需改这里。
 *
 * source = 仓库内保留的原始素材 (assets-sources/, 不参与打包), output = 实际分发的
 * public/ 产物。两者分离的理由:
 *   1. Vite 会把 public/ 整目录复制进 dist/ —— 原图若留在 public/, 等于继续分发给用户,
 *      且"公共静态资源体积"这个验收指标会被原图撑爆 (471.9 KB 会变成 1211.3 KB)。
 *   2. 原始素材留在仓库内, 脚本才能**永久可重跑**: 想调 q80 -> q75/q85 或换量化参数,
 *      只需改本表再跑 --force, 不必回到 git 历史里捞文件。
 */
const TARGETS = [
  {
    id: 'paper-texture-dark',
    kind: 'webp',
    source: 'assets-sources/img/paper-texture-dark.jpg',
    output: 'public/assets/img/paper-texture-dark.webp',
    quality: 80,
    method: 6,
  },
  {
    id: 'paper-texture-warm',
    kind: 'webp',
    source: 'assets-sources/img/paper-texture-warm.jpg',
    output: 'public/assets/img/paper-texture-warm.webp',
    quality: 80,
    method: 6,
  },
  {
    id: 'ink-splash-terracotta',
    kind: 'webp',
    source: 'assets-sources/img/ink-splash-terracotta.jpg',
    output: 'public/assets/img/ink-splash-terracotta.webp',
    quality: 80,
    method: 6,
  },
  {
    id: 'icon-192',
    kind: 'png-palette',
    source: 'assets-sources/icons/icon-192.png',
    output: 'public/icons/icon-192.png',
    colors: 256,
    quantizer: 'MEDIANCUT',
  },
  {
    id: 'icon-512',
    kind: 'png-palette',
    source: 'assets-sources/icons/icon-512.png',
    output: 'public/icons/icon-512.png',
    colors: 256,
    quantizer: 'MEDIANCUT',
  },
];

const DRY_RUN_DIR = path.join(ROOT, '.tmp-assets');

// ---------------------------------------------------------------- CLI

function parseArgs(argv) {
  const opts = {
    dryRun: false,
    check: false,
    force: false,
    report: null,
    python: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--check') opts.check = true;
    else if (arg === '--force') opts.force = true;
    else if (arg === '--report') opts.report = argv[++i];
    else if (arg === '--python') opts.python = argv[++i];
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else {
      console.error(`未知参数: ${arg}`);
      process.exit(2);
    }
  }
  return opts;
}

const HELP = `scripts/optimize-static-assets.mjs — v1.6.1 Stage 2 静态资源现代化

  原始素材: assets-sources/ (不参与打包)   产物: public/
  目标清单见脚本顶部 TARGETS, 调参只需改那里。

  --dry-run          只测量并打印报告, 不写入 public/
  --check            校验所有资源已优化; 有未优化项则 exit 1
  --force            忽略幂等检查, 强制重新生成
  --report <file>    把结果 JSON 写入指定路径
  --python <path>    指定带 Pillow 的 Python 解释器
  -h, --help         显示本帮助

回滚: git checkout HEAD -- public/assets public/icons`;

// ---------------------------------------------------------- Python 探测

/** 依次尝试候选解释器, 返回第一个能 import PIL 的。 */
function pickPython(explicit) {
  const candidates = [
    explicit,
    process.env.WORDAYDREAM_PYTHON,
    // 本仓库实测已验证带 Pillow 12.0.0 的解释器 (见 docs/spec/v1.6.1/main.md §2)
    'C:/veighna_studio/python.exe',
    'python',
    'python3',
  ].filter(Boolean);

  const tried = [];
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['-c', 'import PIL; print(PIL.__version__)'], {
      encoding: 'utf8',
      shell: false,
    });
    if (probe.status === 0 && probe.stdout) {
      return { bin: candidate, pillow: probe.stdout.trim(), tried };
    }
    tried.push(candidate);
  }
  const err = new Error(
    `找不到带 Pillow 的 Python 解释器。已尝试: ${tried.join(', ')}\n` +
      `请用 --python <path> 指定, 或设置环境变量 WORDAYDREAM_PYTHON。`,
  );
  err.tried = tried;
  throw err;
}

// ------------------------------------------------------------- PNG 探测

/** 读取 PNG IHDR, 返回 { bitDepth, colorType } 或 null。 */
function pngHeader(file) {
  const buf = Buffer.alloc(26);
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    if (fs.readSync(fd, buf, 0, 26, 0) !== 26) return null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  if (buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null;
  if (buf.subarray(12, 16).toString('ascii') !== 'IHDR') return null;
  return { bitDepth: buf[24], colorType: buf[25] };
}

/** colorType 3 = 索引调色板图, 即本脚本的输出形态。 */
function isPalettePng(file) {
  const header = pngHeader(file);
  return header !== null && header.colorType === 3;
}

// ---------------------------------------------------------------- 主流程

const PY_PROGRAM = `
import json, os, sys
from PIL import Image

jobs = json.load(sys.stdin)
out = []
for job in jobs:
    rec = {
        "id": job["id"],
        "kind": job["kind"],
        "src": os.path.relpath(job["src"], job["root"]),
        "dst": os.path.relpath(job["dst"], job["root"]),
    }
    try:
        with Image.open(job["src"]) as opened:
            rec["srcMode"] = opened.mode
            rec["width"], rec["height"] = opened.size
            rec["srcBytes"] = os.path.getsize(job["src"])
            if job["kind"] == "webp":
                work = opened.convert("RGB")
                work.save(job["dst"], "WEBP", quality=job["quality"], method=job["method"])
            elif job["kind"] == "png-palette":
                # alpha 恒为 255 时先降为 RGB, 既去掉冗余通道又能用高质量量化器
                # (Pillow 12 限制: RGBA 只允许 FASTOCTREE / libimagequant)
                work = opened.convert("RGB")
                work = work.quantize(
                    colors=job["colors"],
                    method=getattr(Image.Quantize, job["quantizer"]),
                )
                work.save(job["dst"], "PNG", optimize=True)
            else:
                raise ValueError("unknown kind: " + job["kind"])

        with Image.open(job["dst"]) as check:
            rec["outMode"] = check.mode
            rec["outWidth"], rec["outHeight"] = check.size
            rec["outColors"] = len(set(check.convert("RGB").getdata()))
        rec["outBytes"] = os.path.getsize(job["dst"])
        if (rec["outWidth"], rec["outHeight"]) != (rec["width"], rec["height"]):
            raise ValueError(
                "dimension mismatch: %sx%s -> %sx%s"
                % (rec["width"], rec["height"], rec["outWidth"], rec["outHeight"])
            )
        rec["ok"] = True
    except Exception as exc:
        rec["ok"] = False
        rec["error"] = str(exc)
    out.append(rec)
json.dump(out, sys.stdout)
`;

function runPython(pythonBin, jobs) {
  const payload = JSON.stringify(
    jobs.map((job) => ({
      id: job.id,
      kind: job.kind,
      root: ROOT,
      src: path.join(ROOT, job.source),
      dst: path.join(ROOT, job.target),
      quality: job.quality,
      method: job.method,
      colors: job.colors,
      quantizer: job.quantizer,
    })),
  );

  // 注意: 程序必须走 -c, 数据走 stdin。若用 `python -` 传程序, Python 会把整个
  // stdin 当作源码读走, 后续 sys.stdin.read() 只能拿到 EOF (实测踩坑)。
  const result = spawnSync(pythonBin, ['-c', PY_PROGRAM], {
    input: payload,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(
      `Python 执行失败 (exit ${result.status}):\n${result.stderr || '(no stderr)'}`,
    );
  }
  return JSON.parse(result.stdout);
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function kb(bytes) {
  return (bytes / 1024).toFixed(1);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP);
    return 0;
  }

  // 1) 选目标: 依据幂等规则过滤, 并算出实际写入路径
  const planned = [];
  const skipped = [];
  for (const target of TARGETS) {
    const sourceAbs = path.join(ROOT, target.source);
    const outputAbs = path.join(ROOT, target.output);
    if (!fs.existsSync(sourceAbs)) {
      console.error(`[跳过] 原始素材不存在: ${target.source}`);
      skipped.push({ id: target.id, reason: 'missing-source' });
      continue;
    }
    // 幂等: 纹理看产物是否存在; 图标原地覆盖, 靠 PNG IHDR 的 colorType 判断
    //       (3 = 索引调色板, 即本脚本的输出形态) —— 不需要 mtime 或状态文件。
    const alreadyOptimized =
      target.kind === 'png-palette' && fs.existsSync(outputAbs)
        ? isPalettePng(outputAbs)
        : fs.existsSync(outputAbs);

    if (alreadyOptimized && !opts.force) {
      skipped.push({ id: target.id, reason: 'already-optimized' });
      continue;
    }
    // dry-run 时写出到临时目录, 避免污染 public/
    const writeAbs = opts.dryRun
      ? path.join(DRY_RUN_DIR, `${target.id}.${target.kind === 'webp' ? 'webp' : 'png'}`)
      : outputAbs;
    planned.push({
      id: target.id,
      kind: target.kind,
      quality: target.quality,
      method: target.method,
      colors: target.colors,
      quantizer: target.quantizer,
      source: target.source,
      output: target.output,
      target: path.relative(ROOT, writeAbs).replace(/\\/g, '/'),
      sourceBytes: fs.statSync(sourceAbs).size,
      sourceSha256: sha256(sourceAbs),
    });
  }

  if (opts.check) {
    if (planned.length > 0) {
      console.error(`[check] FAIL — ${planned.length} 项资源尚未优化:`);
      for (const item of planned) console.error(`  - ${item.output}`);
      return 1;
    }
    console.log(`[check] PASS — ${TARGETS.length} 项静态资源均已优化`);
    return 0;
  }

  if (planned.length === 0) {
    console.log(`无需处理 (${TARGETS.length} 项均已优化)。用 --force 可强制重跑。`);
    return 0;
  }

  // 2) 准备输出目录 (dry-run 用临时目录)
  if (opts.dryRun) fs.mkdirSync(DRY_RUN_DIR, { recursive: true });

  // 3) 执行
  const python = pickPython(opts.python);
  const started = new Date();
  const results = runPython(python.bin, planned);

  // 4) 校验 + 计算收益
  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    for (const bad of failed) console.error(`[失败] ${bad.id}: ${bad.error}`);
    return 1;
  }

  let srcTotal = 0;
  let dstTotal = 0;
  const plannedById = new Map(planned.map((p) => [p.id, p]));
  const report = { generatedAt: started.toISOString(), python: python.bin, pillow: python.pillow, dryRun: opts.dryRun, assets: [] };

  console.log('');
  console.log('资产                          格式            源大小     新大小      Δ        Δ%      附加');
  console.log('-'.repeat(104));
  for (const item of results) {
    const before = item.srcBytes;
    const after = item.outBytes;
    srcTotal += before;
    dstTotal += after;
    const delta = after - before;
    const pct = before === 0 ? 0 : (delta / before) * 100;
    const extra =
      item.kind === 'webp'
        ? `${item.width}x${item.height}`
        : `${item.width}x${item.height} ${item.outColors}色`;
    const sign = (value) => (value >= 0 ? `+${value}` : `${value}`);
    console.log(
      [
        item.id.padEnd(30),
        item.kind.padEnd(15),
        `${kb(before)} KB`.padStart(10),
        `${kb(after)} KB`.padStart(11),
        `${sign(kb(delta))} KB`.padStart(12),
        `${sign(pct.toFixed(1))}%`.padStart(9),
        `   ${extra}`,
      ].join(''),
    );
    report.assets.push({
      id: item.id,
      kind: item.kind,
      source: item.src,
      output: plannedById.get(item.id)?.output ?? item.dst,
      writtenPath: item.dst,
      srcBytes: before,
      outBytes: after,
      srcSha256: sha256(path.join(ROOT, item.src)),
      outSha256: sha256(path.join(ROOT, item.dst)),
      srcMode: item.srcMode,
      outMode: item.outMode,
      width: item.width,
      height: item.height,
      outColors: item.outColors,
    });
  }
  const deltaTotal = dstTotal - srcTotal;
  console.log('-'.repeat(104));
  console.log(
    `${'合计'.padEnd(30)}${''.padEnd(15)}${(kb(srcTotal) + ' KB').padStart(10)}` +
      `${(kb(dstTotal) + ' KB').padStart(11)}` +
      `${((deltaTotal >= 0 ? '+' : '') + kb(deltaTotal) + ' KB').padStart(12)}` +
      `${((deltaTotal >= 0 ? '+' : '') + ((deltaTotal / srcTotal) * 100).toFixed(1) + '%').padStart(9)}`,
  );
  report.totals = { srcBytes: srcTotal, outBytes: dstTotal, deltaBytes: deltaTotal };
  report.skipped = skipped;

  // 5) 收尾提示。原始素材始终保留在 assets-sources/ (不参与打包), 因此不需要
  //    "保留原件" 或 "删除原件" 的分支 —— 产物的回滚路径就是重跑本脚本。
  if (opts.dryRun) {
    console.log('');
    console.log(`[dry-run] 输出写在 ${path.relative(ROOT, DRY_RUN_DIR)}/, public/ 未被修改。`);
  }

  if (opts.report) {
    const reportAbs = path.resolve(ROOT, opts.report);
    fs.mkdirSync(path.dirname(reportAbs), { recursive: true });
    fs.writeFileSync(reportAbs, JSON.stringify(report, null, 2) + '\n');
    console.log(`报告已写入: ${path.relative(ROOT, reportAbs)}`);
  }

  if (skipped.length > 0) {
    console.log(`跳过 ${skipped.length} 项 (已优化): ${skipped.map((s) => s.id).join(', ')}`);
  }

  console.log('');
  console.log('原始素材保留在 assets-sources/ (不参与打包)。重跑即可覆盖产物。');
  console.log('回到 HEAD 版本: git checkout HEAD -- public/assets public/icons');
  return 0;
}

process.exitCode = main();
