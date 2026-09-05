import { existsSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { inspectHvigorOutput } from './hvigor-output.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..');
const harmonyRoot = join(projectRoot, 'harmony');
const studioHome =
  process.env.DEVECO_STUDIO_HOME || 'D:\\DevEco Studio';
const executableName = process.platform === 'win32' ? 'node.exe' : 'node';
const bundledNode =
  process.env.DEVECO_NODE_PATH ||
  join(studioHome, 'tools', 'node', executableName);
const hvigorEntry =
  process.env.HVIGOR_ENTRY_PATH ||
  join(studioHome, 'tools', 'hvigor', 'bin', 'hvigorw.js');

for (const requiredPath of [bundledNode, hvigorEntry]) {
  if (!existsSync(requiredPath)) {
    console.error(
      '[assemble:harmony] DevEco tool not found: ' + requiredPath +
      '. Set DEVECO_STUDIO_HOME or the explicit tool path variables.',
    );
    process.exit(1);
  }
}

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
      DEVECO_SDK_HOME:
        process.env.DEVECO_SDK_HOME || join(studioHome, 'sdk'),
      JAVA_HOME: process.env.JAVA_HOME || join(studioHome, 'jbr'),
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
