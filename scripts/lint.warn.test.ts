/**
 * T04 [critical] (v0.9.0 Stage 2): 全量 lint warning 数 ≤ 23 (回到 v0.7.0 基线).
 *
 * 通过子进程执行 `npm run lint` 并解析 "Found N warnings" 输出,
 * 断言 N ≤ 23. 以真实命令输出为证, 而非 mock. 与 check-version-alignment 等脚本测试
 * 同处 scripts/ 下, 由 vitest 直接运行.
 */
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

describe('T04 [critical]: lint warning count ≤ 23', () => {
  it('T04: npm run lint 全量输出 warnings ≤ 23', () => {
    let out = '';
    try {
      out = execSync('npm run lint', {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: 'pipe',
      });
    } catch (e) {
      // oxlint 仅在 error 时非零退出; warning 仍退出 0, 正常不应进这里.
      // 兜底: 抓取 stdout/stderr, 避免命令环境异常导致测试直接抛错.
      const err = e as { stdout?: string; stderr?: string };
      out = `${err.stdout ?? ''}\n${err.stderr ?? ''}`;
    }

    const m = out.match(/Found\s+(\d+)\s+warnings?/i);
    expect(m, 'lint 输出应含 "Found N warnings" 行').not.toBeNull();
    const count = Number(m![1]);
    // 以实际解析值为准的留痕
    expect(count).toBeLessThanOrEqual(23);
  });
});
