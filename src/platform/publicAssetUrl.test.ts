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
    expect(publicAssetUrl('/assets/img/paper-texture-warm.jpg', '/wordaydream')).toBe(
      '/wordaydream/assets/img/paper-texture-warm.jpg',
    );
  });
});
