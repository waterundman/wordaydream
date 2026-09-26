import { existsSync, readdirSync, statSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { inspectHvigorOutput } from './hvigor-output.mjs';
import { requireDevEcoToolchain } from './lib/deveco-paths.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..');
// realpathSync 规范化盘符大小写: hvigor 对 cwd 大小写敏感 (w:\ 报 "Path not found",
// W:\ 正常), 而 npm 从 Git Bash (cd /w/wordaydream) 启动时 process.cwd() 可能是小写.
const harmonyRoot = realpathSync(join(projectRoot, 'harmony'));
// M6: 工具链路径统一由 scripts/lib/deveco-paths.mjs 解析
// (DEVECO_STUDIO_HOME 优先, 缺省 D:\DevEco Studio, 缺失即 fail-fast).
// 输出保持历史契约: 每行 [assemble:harmony] 前缀 + exit 1, 不打印异常堆栈.
let toolchain;
try {
  toolchain = requireDevEcoToolchain({
    required: ['bundledNode', 'hvigorEntry'],
  });
} catch (error) {
  for (const line of String(error.message ?? error).split('\n')) {
    console.error(`[assemble:harmony] ${line}`);
  }
  process.exit(1);
}
const { bundledNode, hvigorEntry, sdkHome, javaHome } = toolchain;

const child = spawnSync(
  bundledNode,
  [
    hvigorEntry,
    'assembleHap',
    '-p',
    'product=default',
    '-p',
    'buildMode=debug',
    '--no-daemon',
    // DevEco Studio 6.0.2's Hvigor advertises `--analyze=false`, but rejects
    // that spelling at runtime; keep the supported legacy flag for now.
    '--no-analyze',
    '--stacktrace',
  ],
  {
    cwd: harmonyRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      DEVECO_SDK_HOME: sdkHome,
      JAVA_HOME: javaHome,
    },
  },
);

const output = (child.stdout || '') + (child.stderr || '');
process.stdout.write(child.stdout || '');
process.stderr.write(child.stderr || '');

// Hvigor wraps status markers in ANSI color codes. Inspect normalized output so
// the leading word boundary is not hidden by the final `m` in `\u001B[32m`.
const { reportsFailure, reportsSuccess } = inspectHvigorOutput(output);

if (child.error || child.status !== 0 || reportsFailure || !reportsSuccess) {
  if (child.error) {
    console.error('[assemble:harmony] ' + child.error.message);
  }
  console.error(
    '[assemble:harmony] Hvigor did not report a successful build. ' +
    'The log is checked because some Hvigor failures return exit code 0.',
  );
  process.exit(1);
}

const outputDir = join(
  harmonyRoot,
  'entry',
  'build',
  'default',
  'outputs',
  'default',
);
const hapFiles = existsSync(outputDir)
  ? readdirSync(outputDir)
      .filter((name) => name.endsWith('.hap'))
      .map((name) => join(outputDir, name))
  : [];

if (hapFiles.length === 0) {
  console.error('[assemble:harmony] Build succeeded but no HAP was produced.');
  process.exit(1);
}

hapFiles.sort(
  (left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs,
);
const artifact = hapFiles[0];
console.log(
  '[assemble:harmony] produced ' + artifact +
  ' (' + statSync(artifact).size + ' bytes)',
);
