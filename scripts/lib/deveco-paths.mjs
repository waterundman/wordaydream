/**
 * deveco-paths.mjs — DevEco Studio 工具链路径的唯一解析入口 (M6 规范)
 *
 * 背景: 此前有两处各自硬编码工具链位置 ——
 *   - scripts/assemble-harmony-hap.mjs: 已经支持 DEVECO_STUDIO_HOME 兜底 (基准实现);
 *   - scripts/mcp-deveco-driver.cjs:    写死 'D:\\DevEco Studio\\...', 换机即失效.
 * 本模块把「环境变量优先 + 缺省值 + 缺失即 fail-fast」收敛成一份逻辑, 两个脚本共用.
 *
 * 环境变量 (全部可选):
 *   DEVECO_STUDIO_HOME   DevEco Studio 安装根目录, 缺省 'D:\\DevEco Studio'
 *   DEVECO_NODE_PATH     内置 node 可执行文件 (覆盖由 studioHome 推导的值)
 *   HVIGOR_ENTRY_PATH    hvigorw.js 入口   (覆盖由 studioHome 推导的值)
 *   DEVECO_SDK_HOME / JAVA_HOME            传给 Hvigor 的 SDK / JDK 位置
 *
 * 0 emoji. 报错文案由各调用方决定前缀, 本模块只给事实描述.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** 缺省安装位置 (Windows + D 盘, 与团队现状一致); 换机用 DEVECO_STUDIO_HOME 覆盖. */
export const DEFAULT_DEVECO_STUDIO_HOME = 'D:\\DevEco Studio';

/** @param {string} [message] 抛出「工具链缺失」错误的工厂, 便于调用方统一 fail-fast. */
export class DevEcoToolchainError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DevEcoToolchainError';
  }
}

/**
 * 解析 studioHome: 环境变量优先, 缺省 D:\DevEco Studio.
 * @param {Record<string, string|undefined>} [env]
 * @returns {string}
 */
export function resolveStudioHome(env = process.env) {
  const configured = String(env.DEVECO_STUDIO_HOME ?? '').trim();
  return configured.length > 0 ? configured : DEFAULT_DEVECO_STUDIO_HOME;
}

/**
 * 由 studioHome + 显式覆盖变量推导整套工具链路径 (纯函数, 不落盘、不校验存在性).
 *
 * @param {Record<string, string|undefined>} [env]
 * @param {string} [platform] process.platform
 * @returns {{studioHome: string, nodeHome: string, bundledNode: string,
 *            hvigorEntry: string, hvigorwBat: string, sdkHome: string, javaHome: string}}
 */
export function resolveDevEcoToolchain(env = process.env, platform = process.platform) {
  const studioHome = resolveStudioHome(env);
  const nodeHome = join(studioHome, 'tools', 'node');
  const hvigorBin = join(studioHome, 'tools', 'hvigor', 'bin');
  const executableName = platform === 'win32' ? 'node.exe' : 'node';
  return {
    studioHome,
    nodeHome,
    bundledNode: env.DEVECO_NODE_PATH || join(nodeHome, executableName),
    hvigorEntry: env.HVIGOR_ENTRY_PATH || join(hvigorBin, 'hvigorw.js'),
    hvigorwBat: join(hvigorBin, 'hvigorw.bat'),
    sdkHome: env.DEVECO_SDK_HOME || join(studioHome, 'sdk'),
    javaHome: env.JAVA_HOME || join(studioHome, 'jbr'),
  };
}

/**
 * 列出缺失的工具链路径 (按 toolchain 键名).
 * @param {ReturnType<typeof resolveDevEcoToolchain>} toolchain
 * @param {string[]} requiredKeys 需要存在性保证的键
 * @param {(p: string) => boolean} [exists] 注入点 (单测用)
 * @returns {string[]} 缺失的绝对路径
 */
export function missingDevEcoPaths(toolchain, requiredKeys, exists = existsSync) {
  const missing = [];
  for (const key of requiredKeys) {
    const value = toolchain[key];
    if (typeof value !== 'string' || value.length === 0) {
      throw new DevEcoToolchainError(`unknown DevEco toolchain key: ${key}`);
    }
    if (!exists(value)) missing.push(value);
  }
  return missing;
}

/**
 * 解析并校验工具链; 任一路径缺失即抛 DevEcoToolchainError (fail-fast, 清晰报错).
 *
 * 报错文案保持历史契约 (assemble-harmony-hap.mjs 的既有输出):
 *   'DevEco tool not found: <path>. Set DEVECO_STUDIO_HOME or the explicit tool path variables.'
 * 一次报全部缺失项, 避免「修一个跑一次」.
 *
 * @param {{env?: Record<string, string|undefined>, platform?: string,
 *          required: string[], exists?: (p: string) => boolean}} options
 * @returns {ReturnType<typeof resolveDevEcoToolchain>}
 */
export function requireDevEcoToolchain({
  env = process.env,
  platform = process.platform,
  required,
  exists = existsSync,
}) {
  const toolchain = resolveDevEcoToolchain(env, platform);
  const missing = missingDevEcoPaths(toolchain, required, exists);
  if (missing.length > 0) {
    throw new DevEcoToolchainError(
      missing
        .map(
          (path) =>
            `DevEco tool not found: ${path}. ` +
            'Set DEVECO_STUDIO_HOME or the explicit tool path variables.',
        )
        .join('\n'),
    );
  }
  return toolchain;
}
