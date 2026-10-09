/**
 * v1.6.4 Stage 1 (回归护栏): `scripts/verify-wordlists.mjs` 端到端冒烟测试.
 *
 * 为什么必须有这条测试 (事故复盘):
 * - `verify-wordlists.example.test.mjs` 只 `import { validateWordlist }` 并注入自己的收集器,
 *   **完全不触发 `main()`** —— 所以当 `main()` 内的 `COURSES_EN` 被改名成 `_COURSES`
 *   而第 266 行仍引用旧名时, 全量 `vitest run` 依然全绿, 而 `npm run verify:wordlists`
 *   (R1–R5 闸门) 已经 100% 崩溃。闸门失效却静默通过, 属于最危险的一类回归。
 * - 本文件是**唯一**能在 CI 内捕获该类的断言: 真的把脚本当子进程跑一遍, 断言退出码 0。
 *
 * 口径: 只断言「脚本可运行且通过」(退出码 0) + 8 个词表都出现在 stdout + 通过行。
 * 不断言词条数具体数值 (那属于数据契约, 由 verify-wordlists 自身与 S2 的 N1–N9 负责),
 * 否则数据清理会让这条护栏变成需要同步维护的噪音。
 */
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT_REL = 'scripts/verify-wordlists.mjs';

/** 8 个词表文件 (en/de × a1-a4) 必须逐个出现在 stdout 的计数行里. */
const WORDLIST_LABELS = [
  'en/a1.json',
  'en/a2.json',
  'en/b1.json',
  'en/b2.json',
  'de/a1.json',
  'de/a2.json',
  'de/b1.json',
  'de/b2.json',
];

describe('v1.6.4 Stage 1 回归护栏: verify-wordlists.mjs 端到端冒烟', () => {
  it('T-smoke [critical]: node scripts/verify-wordlists.mjs 退出码 0 且打印 8 个词表计数', () => {
    let stdout = '';
    let failed = false;
    let stderr = '';

    try {
      // execFileSync: 退出码非 0 时抛错 → 用 failed 承接, 便于给出可读的失败信息
      stdout = execFileSync(process.execPath, [SCRIPT_REL], {
        cwd: projectRoot,
        encoding: 'utf8',
        timeout: 60_000,
      });
    } catch (e) {
      failed = true;
      stdout = typeof e?.stdout === 'string' ? e.stdout : '';
      stderr = typeof e?.stderr === 'string' ? e.stderr : String(e?.message ?? e);
    }

    // 退出码断言 (等价于 exit code 0)
    expect(failed, `verify-wordlists.mjs 非 0 退出:\n${stderr}`).toBe(false);

    // 8 个词表的词条计数行 (R1–R5 逐条校验的执行证据)
    for (const label of WORDLIST_LABELS) {
      expect(stdout, `stdout 缺少 ${label} 的计数行`).toContain(label);
    }
    expect(stdout).toMatch(/words=\d+/);

    // 课程 ↔ 词表一致性 + 总通过行
    expect(stdout).toContain('courses/en.ts');
    expect(stdout).toContain('✓ 词表契约校验通过');
  });
});