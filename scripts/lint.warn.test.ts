/**
 * T04 [critical] (v0.9.0 Stage 2; v1.1.0 Stage 3 清零基线): 全量 lint warning 数 = 0.
 *
 * 通过子进程执行 `npm run lint` 并解析 "Found N warnings" 输出,
 * 断言 N = 0 (v1.1.0 Stage 3 完成 21 → 0 清零后的新基线).
 * 以真实命令输出为证, 而非 mock. 与 check-version-alignment 等脚本测试
 * 同处 scripts/ 下, 由 vitest 直接运行.
 *
 * execSync 包一层重试 (失败后隔 2s 重试 1 次): 并发 vitest worker 同时 spawn
 * 子进程时偶发 spawn 失败/管道中断, 两次都失败才视为断言失败.
 */
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

async function runLintWithRetry(): Promise<string> {
  let lastOut = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return execSync('npm run lint', {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: 'pipe',
      });
    } catch (e) {
      // oxlint 仅在 error 时非零退出; warning 仍退出 0, 正常不应进这里.
      // 兜底: 抓取 stdout/stderr, 避免命令环境异常导致测试直接抛错.
      const err = e as { stdout?: string; stderr?: string };
      lastOut = `${err.stdout ?? ''}\n${err.stderr ?? ''}`;
      if (attempt === 1) {
        // 并发 spawn 偶发失败: 隔 2s 重试一次
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }
  return lastOut;
}

describe('T04 [critical]: lint warning count = 0', () => {
  it('T04: npm run lint 全量输出 warnings = 0 (v1.1.0 清零基线)', async () => {
    const out = await runLintWithRetry();

    const m = out.match(/Found\s+(\d+)\s+warnings?/i);
    expect(m, 'lint 输出应含 "Found N warnings" 行').not.toBeNull();
    const count = Number(m![1]);
    // v1.1.0 Stage 3 清零基线: 不允许任何 warning 回流
    expect(count).toBe(0);
  });
});
