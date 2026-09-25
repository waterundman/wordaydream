/**
 * v1.6.1 Stage 2 (Contract 50): 静态资源现代化不变式
 *
 * 背景 (见 docs/spec/v1.6.1/main.md §2.2 / §4 D1-D2):
 *   public/ 下 5 张位图原为 1061.3 KB (3 张 JPG 纹理 + 2 张 RGBA PNG 图标, 后者
 *   alpha 恒为 255 属"假透明")。Stage 2 做了两件事:
 *     纹理  JPG -> WebP q80/method=6        (实测 -59.8%)
 *     图标  RGBA PNG -> MEDIANCUT 256 调色板 PNG (实测 -46.5%, PSNR 45.3/46.9 dB)
 *   合计 1061.3 KB -> 471.9 KB (-55.5%)。
 *
 * 本测试把"优化后状态"固化为不变式, 防止回归:
 *   - 有人把 .jpg 纹理加回 public/  -> T02 失败
 *   - 有人改了引用但忘了换扩展名     -> T01 失败
 *   - 有人重新引入大体积位图         -> T05 失败
 *   - 有人误删原始素材 (脚本不可重跑) -> T04 失败
 *
 * 设计: 与 src/__tests__/package.test.ts 同范式 —— 用 node:fs 直读磁盘,
 * 因为要断言的是"产物文件形态"而非运行时行为。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { resolveHarmonyLocalResource } from '../platform/arkWebLocalResourcePolicy';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '../..');

/** Stage 2 验收阈值: public/ 下位图子集合计上限 (SPEC §6.3)。 */
const BITMAP_BUDGET_BYTES = 500 * 1024;

const TEXTURE_REFS: Array<{ file: string; expected: string }> = [
  {
    file: 'src/components/transitions/InkWipeTransition.module.css',
    expected: "url('/assets/img/paper-texture-dark.webp')",
  },
  {
    file: 'src/components/transitions/ReadingCompleteOverlay.module.css',
    expected: "url('/assets/img/paper-texture-dark.webp')",
  },
  {
    file: 'src/components/transitions/WordLearnedOverlay.module.css',
    expected: "url('/assets/img/paper-texture-warm.webp')",
  },
  {
    file: 'src/components/transitions/AchievementUnlockOverlay.tsx',
    expected: "publicAssetUrl('assets/img/ink-splash-terracotta.webp')",
  },
];

const SOURCE_ASSETS = [
  'assets-sources/img/paper-texture-dark.jpg',
  'assets-sources/img/paper-texture-warm.jpg',
  'assets-sources/img/ink-splash-terracotta.jpg',
  'assets-sources/icons/icon-192.png',
  'assets-sources/icons/icon-512.png',
];

const PUBLISHED_TEXTURES = [
  'public/assets/img/paper-texture-dark.webp',
  'public/assets/img/paper-texture-warm.webp',
  'public/assets/img/ink-splash-terracotta.webp',
];

const PUBLISHED_ICONS = ['public/icons/icon-192.png', 'public/icons/icon-512.png'];

/** 读取 PNG IHDR: 返回 { bitDepth, colorType }。colorType 3 = 索引调色板。 */
function readPngHeader(file: string): { bitDepth: number; colorType: number } {
  const buf = readFileSync(file);
  const signature = buf.subarray(0, 8).toString('hex');
  expect(signature, `${file} 应是合法 PNG`).toBe('89504e470d0a1a0a');
  expect(buf.subarray(12, 16).toString('ascii'), `${file} 首个 chunk 应是 IHDR`).toBe('IHDR');
  return { bitDepth: buf[24], colorType: buf[25] };
}

function listBitmaps(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => /\.(png|jpe?g|webp)$/i.test(name))
    .map((name) => join(dir, name));
}

describe('v1.6.1 Stage 2: 静态资源现代化不变式', () => {
  it('T01 [critical]: 4 处纹理引用全部指向 .webp, 且源码中不再残留 .jpg 纹理引用', () => {
    for (const ref of TEXTURE_REFS) {
      const content = readFileSync(resolve(projectRoot, ref.file), 'utf-8');
      expect(content, `${ref.file} 应引用 .webp 纹理`).toContain(ref.expected);
      expect(content, `${ref.file} 不应再引用已移除的 .jpg 纹理`).not.toMatch(
        /paper-texture-(dark|warm)\.jpg|ink-splash-terracotta\.jpg/,
      );
    }
  });

  it('T02 [critical]: public/ 下已无 .jpg 位图 (原图移出打包目录, 避免继续分发)', () => {
    for (const texture of PUBLISHED_TEXTURES) {
      expect(existsSync(resolve(projectRoot, texture)), `${texture} 应存在`).toBe(true);
    }
    for (const dir of ['public/assets/img', 'public/icons']) {
      const jpgs = readdirSync(resolve(projectRoot, dir)).filter((n) => /\.jpe?g$/i.test(n));
      expect(jpgs, `${dir} 不应残留 .jpg 文件`).toEqual([]);
    }
  });

  it('T03 [critical]: 图标仍为 PNG —— 鸿蒙 rawfile MIME 契约与 PWA manifest 语义不变', () => {
    for (const icon of PUBLISHED_ICONS) {
      const abs = resolve(projectRoot, icon);
      expect(existsSync(abs), `${icon} 应存在`).toBe(true);
      // 仍是 PNG 签名 (未被误换成 WebP)
      expect(readFileSync(abs).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    }
    // arkWebLocalResourcePolicy 的扩展名 -> MIME 映射未被改动
    expect(
      resolveHarmonyLocalResource('https://app.wordaydream.invalid/icons/icon-192.png'),
    ).toEqual({ rawfilePath: 'dist/icons/icon-192.png', mimeType: 'image/png' });
  });

  it('T04: 原始素材仍保留在 assets-sources/ —— 优化脚本可重跑 (调 q 值 / 换量化参数)', () => {
    for (const asset of SOURCE_ASSETS) {
      expect(existsSync(resolve(projectRoot, asset)), `${asset} 应存在`).toBe(true);
    }
    // 素材目录不参与打包: 不在 public/ 之下, 因此不会被 Vite 复制进 dist/
    for (const asset of SOURCE_ASSETS) {
      expect(asset.startsWith('public/'), 'assets-sources/ 必须位于 public/ 之外').toBe(false);
    }
  });

  it('T05: 位图子集合计 ≤ 500 KB, 且图标已量化为 256 色调色板 PNG', () => {
    const bitmaps = [
      ...listBitmaps(resolve(projectRoot, 'public/assets/img')),
      ...listBitmaps(resolve(projectRoot, 'public/icons')),
    ];
    const totalBytes = bitmaps.reduce((sum, file) => sum + statSync(file).size, 0);
    const totalKb = totalBytes / 1024;
    expect(
      totalBytes,
      `public/ 位图合计 ${totalKb.toFixed(1)} KB, 超出 ${BITMAP_BUDGET_BYTES / 1024} KB 预算`,
    ).toBeLessThanOrEqual(BITMAP_BUDGET_BYTES);

    // 量化后的图标应是 8-bit 索引调色板图 (colorType 3), 且位深 8
    for (const icon of PUBLISHED_ICONS) {
      const header = readPngHeader(resolve(projectRoot, icon));
      expect(header.colorType, `${icon} 应已量化为调色板 PNG (colorType 3)`).toBe(3);
      expect(header.bitDepth, `${icon} 位深应为 8`).toBe(8);
    }
  });
});
