import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractLocalReferences,
  validateExecutableReachability,
  validateHarmonyHtml,
  validateOutputFileSet,
} from './verify-harmony-build.mjs';

test('accepts a split ESM entry with modulepreload and local crossorigin', () => {
  const html = `
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; worker-src 'self';">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="modulepreload" href="./assets/react-vendor.js" crossorigin>
    <link rel="stylesheet" href="./assets/index.css" crossorigin>
    <script type="module" src="./assets/index.js" crossorigin></script>
  `;
  assert.deepEqual(validateHarmonyHtml(html), []);
});

test('rejects classic entries and missing modulepreload', () => {
  const failures = validateHarmonyHtml(`
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; worker-src 'self';">
    <link rel="stylesheet" href="./assets/index.css">
    <script src="./assets/index.js" defer></script>
  `);
  assert.ok(failures.some((failure) => failure.includes('not an ES module')));
  assert.ok(failures.some((failure) => failure.includes('modulepreload')));
  assert.ok(failures.some((failure) => failure.includes('found 0')));
});

test('requires a CSP that permits only same-origin Workers', () => {
  const missing = validateHarmonyHtml(`
    <link rel="modulepreload" href="./assets/vendor.js">
    <link rel="stylesheet" href="./assets/index.css">
    <script type="module" src="./assets/index.js"></script>
  `);
  assert.ok(missing.some((failure) => failure.includes('missing Content-Security-Policy')));

  const broad = validateHarmonyHtml(`
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; worker-src 'self' blob:">
    <link rel="modulepreload" href="./assets/vendor.js">
    <link rel="stylesheet" href="./assets/index.css">
    <script type="module" src="./assets/index.js"></script>
  `);
  assert.ok(broad.some((failure) => failure.includes("only 'self'")));

  const unsafeEval = validateHarmonyHtml(`
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-eval'; worker-src 'self'">
    <link rel="modulepreload" href="./assets/vendor.js">
    <link rel="stylesheet" href="./assets/index.css">
    <script type="module" src="./assets/index.js"></script>
  `);
  assert.ok(unsafeEval.some((failure) => failure.includes("'unsafe-eval'")));

  const insecureConnect = validateHarmonyHtml(`
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; worker-src 'self'; connect-src 'self' http://localhost:*">
    <link rel="modulepreload" href="./assets/vendor.js">
    <link rel="stylesheet" href="./assets/index.css">
    <script type="module" src="./assets/index.js"></script>
  `);
  assert.ok(insecureConnect.some((failure) => failure.includes('insecure HTTP')));
});

test('requires split JS/CSS and both module Workers', () => {
  const accepted = [
    'index.html', 'assets/index.js', 'assets/home.js',
    'assets/csvParser.worker-a1.js', 'assets/llmJsonWorker-b2.js',
    'assets/index.css', 'assets/home.css', 'favicon.svg',
  ];
  assert.deepEqual(validateOutputFileSet(accepted), []);

  const failures = validateOutputFileSet([
    'index.html', 'assets/index.js', 'assets/index.css', 'assets/app.js.map',
  ]);
  assert.ok(failures.some((failure) => failure.includes('split ESM')));
  assert.ok(failures.some((failure) => failure.includes('split CSS')));
  assert.ok(failures.some((failure) => failure.includes('csvParser')));
  assert.ok(failures.some((failure) => failure.includes('llmJsonWorker')));
  assert.ok(failures.some((failure) => failure.includes('source maps')));
});

test('rejects output outside the strict rawfile policy', () => {
  const failures = validateOutputFileSet([
    'index.html', 'assets/index.js', 'assets/home.js',
    'assets/csvParser.worker-a.js', 'assets/llmJsonWorker-b.js',
    'assets/index.css', 'assets/home.css', '../escape.js', 'assets/app.exe',
  ]);
  assert.ok(failures.some((failure) => failure.includes('../escape.js')));
  assert.ok(failures.some((failure) => failure.includes('app.exe')));
});

test('extracts ESM, Worker, stylesheet and HTML reference edges', () => {
  assert.deepEqual(
    [...extractLocalReferences(
      `import './boot.js'; import('./lazy.js'); export { x } from './state.js'; ` +
      `new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });`,
      '.js',
    )].sort(),
    ['./boot.js', './lazy.js', './state.js', './worker.js'],
  );
  assert.deepEqual(
    [...extractLocalReferences(`body{background:url('./paper.png')}`, '.css')],
    ['./paper.png'],
  );
  assert.deepEqual(
    [...extractLocalReferences(`<script src="./assets/app.js"></script>`, '.html')],
    ['./assets/app.js'],
  );

  assert.deepEqual(
    [...extractLocalReferences(
      'const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=[`./lazy.js`,"./lazy.css"])))=>i.map(i=>d[i]);' +
      'import(`./route.js`);new Worker(new URL(`csvParser.worker-a1.js`,import.meta.url),{type:`module`});',
      '.js',
    )].sort(),
    ['./lazy.css', './lazy.js', './route.js', 'csvParser.worker-a1.js'],
  );
});

test('requires every emitted script and stylesheet to be reachable from index.html', () => {
  assert.deepEqual(
    validateExecutableReachability(
      ['index.html', 'assets/index.js', 'assets/route.js', 'assets/route.css'],
      new Map([
        ['index.html', new Set(['assets/index.js'])],
        ['assets/index.js', new Set(['assets/route.js', 'assets/route.css'])],
      ]),
    ),
    [],
  );
  assert.deepEqual(
    validateExecutableReachability(
      [
        'index.html',
        'assets/index.js',
        'assets/index.css',
        'assets/orphan-a.js',
        'assets/orphan-b.js',
      ],
      new Map([
        ['index.html', new Set(['assets/index.js', 'assets/index.css'])],
        ['assets/orphan-a.js', new Set(['assets/orphan-b.js'])],
        ['assets/orphan-b.js', new Set(['assets/orphan-a.js'])],
      ]),
    ),
    [
      'unreachable executable or stylesheet output: assets/orphan-a.js',
      'unreachable executable or stylesheet output: assets/orphan-b.js',
    ],
  );
});
