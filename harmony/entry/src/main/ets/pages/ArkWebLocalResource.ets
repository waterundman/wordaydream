/**
 * Pure request policy for the packaged ArkWeb application.
 *
 * ArkWeb treats resource:// pages as an opaque origin. The production shell
 * therefore presents packaged rawfiles under one synthetic HTTPS origin and
 * resolves only a small, canonical path namespace. This module intentionally
 * has no @kit imports so its fail-closed decisions can be unit tested.
 */

export const APP_ORIGIN: string = 'https://app.wordaydream.invalid';
export const APP_ENTRY_PATH: string = '/index.html';
export const APP_ENTRY_URL: string = `${APP_ORIGIN}${APP_ENTRY_PATH}`;

const APP_URL_PREFIX: string = `${APP_ORIGIN}/`;
const SAFE_PATH_SEGMENT: RegExp = /^[A-Za-z0-9._-]+$/;

export class LocalResourceDescriptor {
  rawfilePath: string;
  mimeType: string;
  isText: boolean;

  constructor(rawfilePath: string, mimeType: string, isText: boolean) {
    this.rawfilePath = rawfilePath;
    this.mimeType = mimeType;
    this.isText = isText;
  }
}

function stripFragment(url: string): string {
  const fragmentIndex: number = url.indexOf('#');
  return fragmentIndex < 0 ? url : url.substring(0, fragmentIndex);
}

/** A navigation is trusted only when it targets the one packaged document. */
export function isTrustedAppDocument(url: string): boolean {
  if (typeof url !== 'string' || url.length === 0) {
    return false;
  }
  return stripFragment(url) === APP_ENTRY_URL;
}

/** Exact synthetic-origin classifier; lookalike hosts never match. */
export function isAppOriginRequest(url: string): boolean {
  if (typeof url !== 'string') {
    return false;
  }
  return url === APP_ORIGIN || url.startsWith(APP_URL_PREFIX);
}

function mimeTypeForPath(relativePath: string): string | null {
  const dotIndex: number = relativePath.lastIndexOf('.');
  const extension: string = dotIndex < 0
    ? ''
    : relativePath.substring(dotIndex).toLowerCase();
  switch (extension) {
    case '.html':
      return 'text/html';
    case '.js':
    case '.mjs':
      return 'text/javascript';
    case '.css':
      return 'text/css';
    case '.json':
    case '.map':
      return 'application/json';
    case '.webmanifest':
      return 'application/manifest+json';
    case '.wasm':
      return 'application/wasm';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.ico':
      return 'image/x-icon';
    case '.woff':
      return 'font/woff';
    case '.woff2':
      return 'font/woff2';
    case '.ttf':
      return 'font/ttf';
    case '.otf':
      return 'font/otf';
    default:
      return null;
  }
}

function isTextMimeType(mimeType: string): boolean {
  return mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/manifest+json' ||
    mimeType === 'image/svg+xml';
}

/**
 * Resolve one request into rawfile/dist. Null means malformed, unknown, or
 * unsupported and must become a local error response (never network fallback).
 */
export function resolveLocalResource(requestUrl: string): LocalResourceDescriptor | null {
  if (!isAppOriginRequest(requestUrl)) {
    return null;
  }

  const fragmentIndex: number = requestUrl.indexOf('#');
  const queryIndex: number = requestUrl.indexOf('?');
  if (fragmentIndex >= 0 || queryIndex >= 0) {
    return null;
  }

  const encodedPath: string = requestUrl.substring(APP_ORIGIN.length);
  // Reject encoded separators and encoded percent signs before one decode.
  // This closes single- and double-encoded traversal variants.
  if (/%2f|%5c|%25/i.test(encodedPath)) {
    return null;
  }

  let path: string;
  try {
    path = decodeURIComponent(encodedPath);
  } catch (_) {
    return null;
  }
  if (!path.startsWith('/') ||
    path.includes('\\') ||
    path.includes('\0') ||
    path.includes('//')) {
    return null;
  }

  if (path === APP_ENTRY_PATH) {
    return new LocalResourceDescriptor('dist/index.html', 'text/html', true);
  }

  const relativePath: string = path.substring(1);
  if (!(relativePath === 'favicon.svg' ||
    relativePath === 'icons.svg' ||
    relativePath.startsWith('assets/') ||
    relativePath.startsWith('icons/'))) {
    return null;
  }

  const segments: string[] = relativePath.split('/');
  for (let index: number = 0; index < segments.length; index++) {
    const segment: string = segments[index];
    if (segment.length === 0 ||
      segment === '.' ||
      segment === '..' ||
      !SAFE_PATH_SEGMENT.test(segment)) {
      return null;
    }
  }

  const mimeType: string | null = mimeTypeForPath(relativePath);
  if (mimeType === null) {
    return null;
  }
  return new LocalResourceDescriptor(
    `dist/${relativePath}`,
    mimeType,
    isTextMimeType(mimeType)
  );
}
