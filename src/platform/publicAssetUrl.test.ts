import { describe, expect, it } from 'vitest';
import { publicAssetUrl } from './publicAssetUrl';

describe('publicAssetUrl', () => {
  it('keeps regular web assets rooted at the configured web base', () => {
    expect(publicAssetUrl('assets/svg/grain-overlay.svg', '/')).toBe(
      '/assets/svg/grain-overlay.svg',
    );
  });

  it('creates relative URLs for the Harmony rawfile base', () => {
    expect(publicAssetUrl('assets/svg/grain-overlay.svg', './')).toBe(
      './assets/svg/grain-overlay.svg',
    );
  });

  it('normalizes base and asset separators', () => {
    // v1.6.1 Stage 2: 样例文件名同步为实际存在的优化后纹理 (原 .jpg 已现代化为 .webp)
    expect(publicAssetUrl('/assets/img/paper-texture-warm.webp', '/wordaydream')).toBe(
      '/wordaydream/assets/img/paper-texture-warm.webp',
    );
  });
});
