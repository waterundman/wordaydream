/**
 * deveco-paths.test.mjs — M6 DevEco 工具链路径解析单测 (scripts/lib/deveco-paths.mjs)
 *
 * 覆盖 assemble-harmony-hap.mjs 与 mcp-deveco-driver.cjs 共用的解析入口:
 *   - resolveStudioHome        : DEVECO_STUDIO_HOME 优先 / 空白回退缺省 D:\DevEco Studio
 *   - resolveDevEcoToolchain   : 派生路径 + 显式覆盖变量 + win32/非 win32 可执行文件名
 *   - missingDevEcoPaths       : 存在性检查 (注入 exists, 不依赖本机安装)
 *   - requireDevEcoToolchain   : fail-fast 文案 (保持历史输出 'DevEco tool not found: …')
 *
 * 0 emoji. 不读写 DevEco 安装目录.
 */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';

import {
  DEFAULT_DEVECO_STUDIO_HOME,
  DevEcoToolchainError,
  missingDevEcoPaths,
  requireDevEcoToolchain,
  resolveDevEcoToolchain,
  resolveStudioHome,
} from './deveco-paths.mjs';

describe('M6 resolveStudioHome', () => {
  it('未设置 / 空串 / 仅空白 => 缺省安装位置', () => {
    expect(resolveStudioHome({})).toBe(DEFAULT_DEVECO_STUDIO_HOME);
    expect(DEFAULT_DEVECO_STUDIO_HOME).toBe('D:\\DevEco Studio');
    expect(resolveStudioHome({ DEVECO_STUDIO_HOME: '' })).toBe(DEFAULT_DEVECO_STUDIO_HOME);
    expect(resolveStudioHome({ DEVECO_STUDIO_HOME: '   ' })).toBe(DEFAULT_DEVECO_STUDIO_HOME);
  });

  it('环境变量优先并去掉首尾空白', () => {
    expect(resolveStudioHome({ DEVECO_STUDIO_HOME: ' E:\\DevEco ' })).toBe('E:\\DevEco');
  });
});

describe('M6 resolveDevEcoToolchain', () => {
  it('由 studioHome 推导 sdk / node / hvigor / jbr 路径', () => {
    const t = resolveDevEcoToolchain({ DEVECO_STUDIO_HOME: 'D:\\DevEco Studio' }, 'win32');
    expect(t.sdkHome).toBe(join('D:\\DevEco Studio', 'sdk'));
    expect(t.javaHome).toBe(join('D:\\DevEco Studio', 'jbr'));
    expect(t.bundledNode).toBe(join('D:\\DevEco Studio', 'tools', 'node', 'node.exe'));
    expect(t.hvigorEntry).toBe(join('D:\\DevEco Studio', 'tools', 'hvigor', 'bin', 'hvigorw.js'));
    expect(t.hvigorwBat).toBe(join('D:\\DevEco Studio', 'tools', 'hvigor', 'bin', 'hvigorw.bat'));
  });

  it('非 win32 用无扩展名 node', () => {
    const t = resolveDevEcoToolchain({ DEVECO_STUDIO_HOME: '/opt/deveco' }, 'linux');
    expect(t.bundledNode).toBe(join('/opt/deveco', 'tools', 'node', 'node'));
  });

  it('显式工具路径变量覆盖派生值; SDK/JAVA 亦被尊重', () => {
    const t = resolveDevEcoToolchain({
      DEVECO_STUDIO_HOME: 'D:\\DevEco Studio',
      DEVECO_NODE_PATH: 'C:\\node\\node.exe',
      HVIGOR_ENTRY_PATH: 'E:\\tools\\hvigorw.js',
      DEVECO_SDK_HOME: 'E:\\sdk',
      JAVA_HOME: 'E:\\jdk',
    }, 'win32');
    expect(t.bundledNode).toBe('C:\\node\\node.exe');
    expect(t.hvigorEntry).toBe('E:\\tools\\hvigorw.js');
    expect(t.sdkHome).toBe('E:\\sdk');
    expect(t.javaHome).toBe('E:\\jdk');
  });
});

describe('M6 missingDevEcoPaths / requireDevEcoToolchain', () => {
  const env = { DEVECO_STUDIO_HOME: 'D:\\DevEco Studio' };
  const always = () => true;

  it('全部存在 => 返回空数组 / 直接给出 toolchain', () => {
    const t = resolveDevEcoToolchain(env, 'win32');
    expect(missingDevEcoPaths(t, ['bundledNode', 'hvigorEntry'], always)).toEqual([]);
    expect(() => requireDevEcoToolchain({ env, platform: 'win32', required: ['hvigorEntry'], exists: always }))
      .not.toThrow();
  });

  it('缺失路径 => fail-fast 且保留历史报错文案', () => {
    let error;
    try {
      requireDevEcoToolchain({
        env,
        platform: 'win32',
        required: ['bundledNode', 'hvigorEntry'],
        exists: () => false,
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(DevEcoToolchainError);
    expect(error.message).toContain('DevEco tool not found:');
    expect(error.message).toContain('Set DEVECO_STUDIO_HOME or the explicit tool path variables.');
    // 一次报全: 两个缺失项都要出现, 避免「修一个跑一次」
    expect(error.message.match(/DevEco tool not found:/g)).toHaveLength(2);
  });

  it('未知 required 键 => 明确报错 (不静默通过)', () => {
    expect(() =>
      requireDevEcoToolchain({ env, platform: 'win32', required: ['nopePath'], exists: always }),
    ).toThrow(/unknown DevEco toolchain key/);
  });
});
