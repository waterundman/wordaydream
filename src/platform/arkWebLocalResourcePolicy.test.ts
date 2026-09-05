import { describe, expect, it } from 'vitest';
import {
  HARMONY_APP_ENTRY_URL,
  isHarmonyAppOriginRequest,
  isTrustedHarmonyDocument,
  resolveHarmonyLocalResource,
} from './arkWebLocalResourcePolicy';

describe('Harmony ArkWeb local resource policy', () => {
  it('accepts only the exact packaged document as a trusted page', () => {
    expect(isTrustedHarmonyDocument(HARMONY_APP_ENTRY_URL)).toBe(true);
    expect(isTrustedHarmonyDocument(`${HARMONY_APP_ENTRY_URL}#review`)).toBe(true);
    expect(isTrustedHarmonyDocument('https://app.wordaydream.invalid/assets/app.js')).toBe(false);
    expect(isTrustedHarmonyDocument('https://app.wordaydream.invalid.evil.test/index.html')).toBe(false);
  });

  it('distinguishes the exact synthetic origin from lookalikes', () => {
    expect(isHarmonyAppOriginRequest(HARMONY_APP_ENTRY_URL)).toBe(true);
    expect(isHarmonyAppOriginRequest('https://app.wordaydream.invalid.evil.test/index.html')).toBe(false);
    expect(isHarmonyAppOriginRequest('http://app.wordaydream.invalid/index.html')).toBe(false);
  });

  it.each([
    ['https://app.wordaydream.invalid/index.html', 'dist/index.html', 'text/html'],
    ['https://app.wordaydream.invalid/assets/app.js', 'dist/assets/app.js', 'text/javascript'],
    ['https://app.wordaydream.invalid/assets/img/paper.jpg', 'dist/assets/img/paper.jpg', 'image/jpeg'],
    ['https://app.wordaydream.invalid/icons/icon-192.png', 'dist/icons/icon-192.png', 'image/png'],
  ])('maps %s into one rawfile namespace', (url, rawfilePath, mimeType) => {
    expect(resolveHarmonyLocalResource(url)).toEqual({ rawfilePath, mimeType });
  });

  it.each([
    'https://app.wordaydream.invalid/',
    'https://app.wordaydream.invalid/unknown.txt',
    'https://app.wordaydream.invalid/assets/../index.html',
    'https://app.wordaydream.invalid/assets/%2e%2e/index.html',
    'https://app.wordaydream.invalid/assets/%252e%252e%252findex.html',
    'https://app.wordaydream.invalid/assets/%2Findex.js',
    'https://app.wordaydream.invalid/assets/app.js?cache=1',
    'https://app.wordaydream.invalid/assets/app.js#fragment',
    'https://app.wordaydream.invalid/assets//app.js',
    'https://app.wordaydream.invalid/assets/app.exe',
    'https://evil.test/assets/app.js',
  ])('fails closed for %s', (url) => {
    expect(resolveHarmonyLocalResource(url)).toBeNull();
  });
});
