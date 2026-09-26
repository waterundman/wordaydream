#!/usr/bin/env node

import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, extname, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CHUNK_GRAPH_FILE_NAME,
  chunkGraphAdjacency,
  parseChunkGraph,
} from './harmony/lib/chunk-graph.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, '..');
/** 默认校验目录 = ArkWeb rawfile 产物; `--dist <dir>` 仅用于自测/离线复算. */
const DEFAULT_BUILD_DIRECTORY = join(
  projectRoot,
  'harmony',
  'entry',
  'src',
  'main',
  'resources',
  'rawfile',
  'dist',
);

const textExtensions = new Set(['.css', '.html', '.js', '.json', '.mjs', '.svg']);
const servedExtensions = new Set([
  '.html', '.js', '.mjs', '.css', '.json', '.wasm', '.svg', '.png', '.jpg',
  '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.otf',
]);
const safeSegment = /^[A-Za-z0-9._-]+$/;
const rootAbsoluteAssetPattern = /(?:^|["'`(=,\s])\/assets\//gm;

function getAttribute(tag, name) {
  const match = tag.match(
    new RegExp(`\\s${name}(?:\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+)))?`, 'i'),
  );
  return match ? (match[1] ?? match[2] ?? match[3] ?? '') : undefined;
}

function isLocalReference(reference) {
  return (
    reference.length > 0 &&
    !reference.startsWith('#') &&
    !reference.startsWith('data:') &&
    !reference.startsWith('blob:') &&
    !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(reference) &&
    !reference.startsWith('//')
  );
}

export function validateHarmonyHtml(html) {
  const failures = [];
  const tags = html.match(/<(?:script|link)\b[^>]*>/gi) ?? [];
  const moduleScripts = [];
  const modulePreloads = [];
  const stylesheets = [];

  for (const tag of tags) {
    const src = getAttribute(tag, 'src');
    const href = getAttribute(tag, 'href');
    const type = getAttribute(tag, 'type')?.toLowerCase();
    const rel = getAttribute(tag, 'rel')?.toLowerCase();
    const reference = src ?? href;
    if (!reference || !isLocalReference(reference)) continue;

    if (tag.toLowerCase().startsWith('<script')) {
      if (type !== 'module') {
        failures.push(`local script is not an ES module: ${reference}`);
      } else {
        moduleScripts.push(reference);
      }
    } else if (rel === 'modulepreload') {
      modulePreloads.push(reference);
    } else if (rel === 'stylesheet') {
      stylesheets.push(reference);
    }
  }

  if (moduleScripts.length !== 1) {
    failures.push(`expected one local module entry, found ${moduleScripts.length}`);
  }
  if (modulePreloads.length === 0) {
    failures.push('expected at least one local modulepreload');
  }
  if (stylesheets.length === 0) {
    failures.push('expected at least one local stylesheet');
  }

  const cspTags = html.match(/<meta\b[^>]*>/gi) ?? [];
  const cspTag = cspTags.find(
    (tag) => getAttribute(tag, 'http-equiv')?.toLowerCase() === 'content-security-policy',
  );
  if (!cspTag) {
    failures.push('missing Content-Security-Policy meta tag');
  } else {
    const csp = getAttribute(cspTag, 'content') ?? '';
    const directives = csp
      .split(';')
      .map((directive) => directive.trim().split(/\s+/));
    const scriptDirective = directives.find(
      ([name]) => name?.toLowerCase() === 'script-src',
    );
    if (!scriptDirective?.slice(1).includes("'self'")) {
      failures.push("Content-Security-Policy script-src must include 'self'");
    }
    if (directives.some((directive) => directive.slice(1).includes("'unsafe-eval'"))) {
      failures.push("Content-Security-Policy must not allow 'unsafe-eval'");
    }
    const workerDirective = directives.find(
      ([name]) => name?.toLowerCase() === 'worker-src',
    );
    if (!workerDirective) {
      failures.push('Content-Security-Policy is missing worker-src');
    } else {
      const workerSources = workerDirective.slice(1);
      if (workerSources.length !== 1 || workerSources[0] !== "'self'") {
        failures.push("worker-src must allow only 'self'");
      }
    }
    const connectDirective = directives.find(
      ([name]) => name?.toLowerCase() === 'connect-src',
    );
    if (connectDirective?.slice(1).some((source) => /^http:/i.test(source))) {
      failures.push('Content-Security-Policy connect-src must not allow insecure HTTP');
    }
  }
  return failures;
}

export function validateOutputFileSet(relativePaths) {
  const failures = [];
  const normalized = relativePaths.map((file) => file.replace(/\\/g, '/'));
  const javascriptFiles = normalized.filter((file) => ['.js', '.mjs'].includes(posix.extname(file)));
  const cssFiles = normalized.filter((file) => posix.extname(file) === '.css');

  if (javascriptFiles.length <= 1) {
    failures.push(`expected split ESM output, found ${javascriptFiles.length} JavaScript file(s)`);
  }
  if (cssFiles.length <= 1) {
    failures.push(`expected split CSS output, found ${cssFiles.length} CSS file(s)`);
  }
  if (!javascriptFiles.some((file) => /(?:^|\/)csvParser\.worker-[A-Za-z0-9_-]+\.js$/.test(file))) {
    failures.push('missing csvParser module Worker bundle');
  }
  if (!javascriptFiles.some((file) => /(?:^|\/)llmJsonWorker-[A-Za-z0-9_-]+\.js$/.test(file))) {
    failures.push('missing llmJsonWorker module Worker bundle');
  }
  if (normalized.some((file) => file.endsWith('.br') || file.endsWith('.gz'))) {
    failures.push('rawfile contains HTTP compression sidecars');
  }
  if (normalized.some((file) => file.endsWith('.map'))) {
    failures.push('rawfile contains production source maps');
  }

  for (const file of normalized) {
    // index.html / 图标是 rawfile 根级例外; harmony-chunk-graph.json 是 M5 的构建期
    // 元数据 sidecar (由 vite.config.ts 的 harmony-chunk-graph 插件写出, 供本校验器
    // 消费, 不参与运行时加载), 同样允许落在根级.
    if (
      file === 'index.html' ||
      file === 'favicon.svg' ||
      file === 'icons.svg' ||
      file === CHUNK_GRAPH_FILE_NAME
    ) continue;
    const segments = file.split('/');
    if (
      !(file.startsWith('assets/') || file.startsWith('icons/')) ||
      segments.some((segment) => !segment || !safeSegment.test(segment)) ||
      !servedExtensions.has(posix.extname(file).toLowerCase())
    ) {
      failures.push(`output file is outside the ArkWeb rawfile policy: ${file}`);
    }
  }
  return failures;
}

/**
 * 从产物文本里抽取本地引用边.
 *
 * @param {string} contents 文件内容
 * @param {string} extension 扩展名 (含点)
 * @param {boolean} [includeViteMapDeps=true] 是否逆向 `__vite__mapDeps` 数组.
 *   M5 之后这是 **fallback 专用开关**: dist 里有 harmony-chunk-graph.json 时校验器
 *   传 false, 改用打包器正向导出的邻接表; 只有图缺失 (旧产物 / 非 vite 产物) 才
 *   退回这条依赖 Vite 内部代码形态的正则路径.
 */
export function extractLocalReferences(contents, extension, includeViteMapDeps = true) {
  const references = new Set();
  const patterns = [];
  if (extension === '.html') {
    patterns.push(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi);
  } else if (extension === '.css') {
    patterns.push(/\burl\(\s*["']?([^"')\s]+)["']?\s*\)/gi);
  } else if (extension === '.js' || extension === '.mjs') {
    // Vite/Rolldown may emit either quote style or template literals for
    // module specifiers. Capture only literal imports and Worker URLs; a
    // generic new URL can be a non-fetch base used by Vite's preload helper.
    patterns.push(/\bimport\s*\(\s*["'`]((?:\.{1,2}\/)[^"'`]+)["'`]\s*\)/g);
    patterns.push(/\bfrom\s*["'`]((?:\.{1,2}\/)[^"'`]+)["'`]/g);
    patterns.push(/(?:^|[;}])\s*import\s*["'`]((?:\.{1,2}\/)[^"'`]+)["'`]/g);
    patterns.push(
      /\bnew\s+Worker\s*\(\s*new\s+URL\(\s*["'`]((?:\.{1,2}\/)[^"'`]+)["'`]/g,
    );
    patterns.push(
      /\bnew\s+URL\(\s*["'`]((?:\.\/)?(?:csvParser\.worker|llmJsonWorker)-[^"'`]+\.js)["'`]/g,
    );
  }
  for (const pattern of patterns) {
    for (const match of contents.matchAll(pattern)) {
      if (isLocalReference(match[1])) references.add(match[1]);
    }
  }

  if (
    includeViteMapDeps &&
    (extension === '.js' || extension === '.mjs')
  ) {
    // FALLBACK (M5): Vite records lazy JS/CSS dependency edges in __vite__mapDeps
    // arrays. They are ordinary string literals rather than import expressions.
    // 优先路径是打包器导出的 harmony-chunk-graph.json; 本分支只在图缺失时启用,
    // 因为它是「逆向 Vite 内部 helper 形态」, Vite/rolldown 升级即可能失效.
    for (const mapMatch of contents.matchAll(
      /\b__vite__mapDeps\s*=\s*\([^[]*?\bm\.f\s*\|\|\s*\(\s*m\.f\s*=\s*\[([^\]]*)\]/g,
    )) {
      for (const literalMatch of mapMatch[1].matchAll(/["'`]([^"'`]+)["'`]/g)) {
        if (isLocalReference(literalMatch[1])) references.add(literalMatch[1]);
      }
    }
  }
  return references;
}

export function validateExecutableReachability(
  relativePaths,
  referenceGraph,
  entry = 'index.html',
) {
  const reachable = new Set([entry]);
  const queue = [entry];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const target of referenceGraph.get(current) ?? []) {
      if (reachable.has(target)) continue;
      reachable.add(target);
      queue.push(target);
    }
  }

  return relativePaths
    .map((file) => file.replace(/\\/g, '/'))
    .filter((file) => ['.js', '.mjs', '.css'].includes(posix.extname(file)))
    .filter((file) => !reachable.has(file))
    .map((file) => `unreachable executable or stylesheet output: ${file}`);
}

function resolveLocalReference(fromFile, reference) {
  const withoutSuffix = reference.split(/[?#]/, 1)[0];
  if (withoutSuffix.startsWith('/')) return null;
  const resolved = posix.normalize(posix.join(posix.dirname(fromFile), withoutSuffix));
  return resolved === '..' || resolved.startsWith('../') ? null : resolved;
}

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const entryPath = join(directory, entry.name);
    return entry.isDirectory() ? collectFiles(entryPath) : [entryPath];
  }));
  return nested.flat();
}

async function verifyHarmonyBuild(buildDirectory = DEFAULT_BUILD_DIRECTORY) {
  const failures = [];
  try {
    await access(join(buildDirectory, 'index.html'));
  } catch {
    failures.push('missing rawfile/dist/index.html');
  }

  let files = [];
  try {
    files = await collectFiles(buildDirectory);
  } catch (error) {
    failures.push(`cannot read Harmony build directory: ${error.message}`);
  }
  const relativePaths = files.map((file) => relative(buildDirectory, file).replace(/\\/g, '/'));
  const fileSet = new Set(relativePaths);
  failures.push(...validateOutputFileSet(relativePaths));

  // M5: 优先消费打包器正向导出的 chunk 邻接表; 缺失/损坏时回退 __vite__mapDeps 正则.
  let chunkGraph = null;
  try {
    chunkGraph = parseChunkGraph(
      await readFile(join(buildDirectory, CHUNK_GRAPH_FILE_NAME), 'utf8'),
    );
  } catch (error) {
    if (error?.code === 'ENOENT') {
      console.warn(
        `[verify:harmony-build] warn: ${CHUNK_GRAPH_FILE_NAME} not found; ` +
        'falling back to the deprecated __vite__mapDeps regex path ' +
        '(re-run "npm run build:harmony" to emit the chunk graph)',
      );
    } else {
      failures.push(
        `${CHUNK_GRAPH_FILE_NAME}: unreadable chunk graph (${error.message}); ` +
        'falling back to the deprecated __vite__mapDeps regex path',
      );
    }
  }
  const useChunkGraph = chunkGraph !== null;

  const referencedFiles = new Set();
  const referenceGraph = new Map();
  for (const file of files) {
    const extension = extname(file).toLowerCase();
    if (!textExtensions.has(extension)) continue;
    const contents = await readFile(file, 'utf8');
    const relativePath = relative(buildDirectory, file).replace(/\\/g, '/');
    if (extension === '.html') {
      failures.push(...validateHarmonyHtml(contents).map((failure) => `${relativePath}: ${failure}`));
    }
    if (rootAbsoluteAssetPattern.test(contents)) {
      failures.push(`root-absolute /assets/ reference in ${relativePath}`);
    }
    rootAbsoluteAssetPattern.lastIndex = 0;

    const outgoingReferences = new Set();
    for (const reference of extractLocalReferences(contents, extension, !useChunkGraph)) {
      const target = resolveLocalReference(relativePath, reference);
      if (target === null) {
        failures.push(`unsafe local reference in ${relativePath}: ${reference}`);
      } else {
        referencedFiles.add(target);
        outgoingReferences.add(target);
        if (!fileSet.has(target)) {
          failures.push(`missing local file referenced by ${relativePath}: ${target}`);
        }
      }
    }
    referenceGraph.set(relativePath, outgoingReferences);
  }

  if (useChunkGraph) {
    const { adjacency, failures: graphFailures } = chunkGraphAdjacency(chunkGraph, fileSet);
    failures.push(
      ...graphFailures.map((failure) => `${CHUNK_GRAPH_FILE_NAME}: ${failure}`),
    );
    for (const [chunkKey, targets] of adjacency) {
      const existing = referenceGraph.get(chunkKey) ?? new Set();
      for (const target of targets) {
        existing.add(target);
        referencedFiles.add(target);
      }
      referenceGraph.set(chunkKey, existing);
    }
  }

  failures.push(...validateExecutableReachability(relativePaths, referenceGraph));

  if (referencedFiles.size === 0) failures.push('no local build references were detected');
  if (failures.length > 0) {
    console.error('[verify:harmony-build] failed');
    failures.forEach((failure) => console.error(`- ${failure}`));
    process.exitCode = 1;
    return;
  }

  const jsCount = relativePaths.filter((file) => ['.js', '.mjs'].includes(posix.extname(file))).length;
  const cssCount = relativePaths.filter((file) => posix.extname(file) === '.css').length;
  console.log(
    `[verify:harmony-build] passed (${jsCount} ESM/Worker JS, ${cssCount} CSS, ` +
    `${relativePaths.length} files, ${referencedFiles.size} local references)`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // `--dist <dir>` 只用于脚本自测/离线复算 (指向一份拷贝出来的产物目录),
  // 默认仍是 harmony rawfile/dist, 门禁行为不变.
  const distFlagIndex = process.argv.indexOf('--dist');
  let targetDirectory = DEFAULT_BUILD_DIRECTORY;
  if (distFlagIndex >= 0) {
    const raw = process.argv[distFlagIndex + 1];
    if (!raw || raw.startsWith('--')) {
      console.error('[verify:harmony-build] --dist 需要一个目录参数');
      process.exitCode = 1;
    } else {
      targetDirectory = resolve(raw);
    }
  }
  if (process.exitCode !== 1) await verifyHarmonyBuild(targetDirectory);
}
