/**
 * hdc.mjs — 鸿蒙运行验证脚本的共享底层 (M6 脚本去重与规范)
 *
 * 被 scripts/harmony/seed-and-verify.mjs 与 scripts/harmony/collect-perf.mjs 复用.
 * 本模块只做「抽取 + 统一」, 不改变任一脚本的断言集合、超时数值、报告字段语义:
 *   - runHdc / runHdcText      : hdc 子进程调用 (seed 需要退出码, perf 只需要合并文本)
 *   - isDeviceOnline           : 设备在线判定 (此前两处实现不一致: perf 漏了 CONNECTED 分支)
 *   - createArgsParser         : --flag 传参解析 (两脚本共用同一语义)
 *   - buildSkipReport          : 模拟器离线 SKIP 报告骨架 (skipped:true, ok:true)
 *   - isCliInvocation          : 「被直接运行 vs 被 import」标准判定
 *
 * 0 emoji. 报告/日志文案由各脚本自己决定, 便于保持既有输出契约.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 单条 hdc 命令的默认超时 (ms) —— 与各脚本历史用值一致. */
export const DEFAULT_HDC_TIMEOUT_MS = 10000;

/**
 * 执行一条 hdc 命令, 返回结构化结果; 不抛异常 (失败体现在 code/error 上).
 *
 * @param {string} hdc hdc 可执行文件路径
 * @param {string[]} argsList 参数数组 (不经 shell, 避免 '&' 等设备端 shell 解析问题)
 * @param {number} [timeoutMs]
 * @returns {{code: number|null, stdout: string, stderr: string, error: string|null}}
 */
export function runHdc(hdc, argsList, timeoutMs = DEFAULT_HDC_TIMEOUT_MS) {
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

/**
 * runHdc 的文本视图: stdout + stderr 合并 (collect-perf 历史形态).
 *
 * @param {string} hdc
 * @param {string[]} argsList
 * @param {number} [timeoutMs]
 * @returns {string}
 */
export function runHdcText(hdc, argsList, timeoutMs = DEFAULT_HDC_TIMEOUT_MS) {
  const result = runHdc(hdc, argsList, timeoutMs);
  return result.stdout + result.stderr;
}

/**
 * 设备在线判定 (M6: 统一此前 seed / perf 两处不一致的实现).
 *
 * `hdc list targets` 的空态输出是 `[Empty]`; 其余任何非空行都视为一个在线目标
 * (真机序列号、`127.0.0.1:5555` 模拟器、带 CONNECTED 标记的行都落在这个集合里),
 * 因此这里是「非空且非 [Empty]」的并集判定 —— 与 seed 历史行为等价,
 * 对 perf 而言只是补上了它缺失的 CONNECTED 分支.
 *
 * @param {string} listTargetsOutput `hdc list targets` 的 stdout
 * @param {number|null} [exitCode] 该命令退出码; 非 0 (含 null=没跑起来) 一律视为离线
 * @returns {boolean}
 */
export function isDeviceOnline(listTargetsOutput, exitCode = 0) {
  if (exitCode !== 0) return false;
  return String(listTargetsOutput ?? '')
    .split('\n')
    .some((line) => line.trim().length > 0 && !line.startsWith('[Empty]'));
}

/**
 * 生成一个 --flag 传参解析器 (纯函数工厂, 供单测).
 *
 * spec 形态:
 *   { flag: '--hdc', key: 'hdc', default: 'hdc' }                      字符串旗标 (无条件吃掉下一个值)
 *   { flag: '--timeout', key: 'timeoutMs', type: 'number', default: 1} 数值旗标, 非法值回退默认
 *   { flag: '--open-card', key: 'openCard', type: 'optional', ... }    可选值旗标: 值为空串仍生效,
 *                                                                      缺值或值本身是 --xxx 时不消费
 *   { flag: '--help', key: 'help', type: 'boolean', aliases: ['-h'] }  布尔旗标
 *
 * @param {Array<{flag: string, key: string, type?: 'string'|'number'|'optional'|'boolean',
 *               default?: unknown, aliases?: string[]}>} specs
 * @returns {(argv: string[]) => Record<string, any>}
 */
export function createArgsParser(specs) {
  return function parseArgs(argv) {
    /** @type {Record<string, any>} */
    const args = {};
    for (const spec of specs) {
      args[spec.key] = spec.default;
    }
    for (let i = 0; i < argv.length; i++) {
      const spec = specs.find(
        (candidate) =>
          candidate.flag === argv[i] || (candidate.aliases ?? []).includes(argv[i]),
      );
      if (!spec) continue;
      if (spec.type === 'boolean') {
        args[spec.key] = true;
        continue;
      }
      const next = argv[i + 1];
      if (spec.type === 'optional') {
        // 空串 ('') 是显式的「跳过这一段」标记, 必须能吃进去; 缺值/下一个是旗标则不动.
        if (next !== undefined && !next.startsWith('--')) {
          args[spec.key] = next;
          i++;
        }
        continue;
      }
      if (spec.type === 'number') {
        args[spec.key] = Number(next) || spec.default;
        i++;
        continue;
      }
      args[spec.key] = next;
      i++;
    }
    return args;
  };
}

/**
 * SKIP 报告骨架 (模拟器不在线等场景): skipped=true 且 ok=true, 不阻塞 CI.
 * 各脚本自己提供专属字段 (steps/assertions 或 metrics), 以保持既有报告结构不变.
 *
 * @param {string} reason
 * @param {Object|null} [args]
 * @param {Record<string, unknown>} [extra] 脚本专属字段 (合并进报告)
 * @returns {{skipped: true, ok: true, reason: string}}
 */
export function buildSkipReport(reason, args, extra = {}) {
  return { skipped: true, ok: true, reason, ...extra };
}

function realpathOrSelf(path) {
  try {
    return existsSync(path) ? realpathSync(path) : path;
  } catch {
    return path;
  }
}

/**
 * 「本文件是否作为 CLI 入口被直接运行」的标准判定 (M6: 取代字符串替换式 hack).
 *
 * 用 import.meta.url 与 process.argv[1] 比较; Windows 下同时做盘符大小写与
 * realpath 规范化 (npm 从 Git Bash 启动时 argv[1] 可能是 w:\ 小写盘符).
 * 被 import (单测 / 未来契约测试) 时返回 false, 因此导出面不受影响.
 *
 * @param {string} moduleUrl 调用方的 import.meta.url
 * @param {string} [invokedPath] 默认 process.argv[1]
 * @returns {boolean}
 */
export function isCliInvocation(moduleUrl, invokedPath = process.argv[1]) {
  if (!invokedPath) return false;
  try {
    const self = realpathOrSelf(fileURLToPath(moduleUrl));
    const invoked = realpathOrSelf(resolve(invokedPath));
    if (self === invoked) return true;
    return (
      process.platform === 'win32' &&
      self.toLowerCase() === invoked.toLowerCase()
    );
  } catch {
    return false;
  }
}
