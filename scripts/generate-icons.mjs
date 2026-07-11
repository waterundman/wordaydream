// scripts/generate-icons.mjs
//
// v1.4.1 Stage 2: PWA 图标生成脚本
//
// 用 sharp 把内联 SVG 转成 192x192 / 512x512 PNG, 写入 public/icons/.
// 颜色: 暖白底 (#faf8f5) + 深墨色 (#1c1917) 大写 "W" 字母,
// 与项目 tokens.css 的色板保持一致.
//
// 用法:
//   node scripts/generate-icons.mjs
//
// 注意:
// - 沙箱里 sharp 在 Windows 平台存在原生绑定问题,
//   若失败, 直接用 PowerShell 兜底 (scripts/generate-icons.ps1).
// - 该脚本是 manual-tool, 不接入 npm run (避免在 CI 频繁跑).

import sharp from 'sharp';
import { mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'public', 'icons');
await mkdir(outDir, { recursive: true });

// 暖白底色 (#faf8f5) + 深墨色 (#1c1917) 简单文字图标
// 用 SVG 矢量生成 PNG, 无需额外设计
const svg = (size) =>
  Buffer.from(
    `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${size}" height="${size}" fill="#faf8f5"/>
  <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" font-family="serif" font-size="${
    size * 0.5
  }" font-weight="600" fill="#1c1917">W</text>
</svg>`,
  );

await sharp(svg(192)).png().toFile(join(outDir, 'icon-192.png'));
await sharp(svg(512)).png().toFile(join(outDir, 'icon-512.png'));
console.log('Generated icon-192.png + icon-512.png');
