export const HARMONY_APP_ORIGIN = 'https://app.wordaydream.invalid';
export const HARMONY_APP_ENTRY_URL = `${HARMONY_APP_ORIGIN}/index.html`;

const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

export interface HarmonyLocalResource {
  rawfilePath: string;
  mimeType: string;
}

function mimeTypeForPath(path: string): string | null {
  const extension = path.slice(path.lastIndexOf('.')).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.map': 'application/json',
    '.webmanifest': 'application/manifest+json',
    '.wasm': 'application/wasm',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
  };
  return mimeTypes[extension] ?? null;
}

export function isHarmonyAppOriginRequest(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    (value === HARMONY_APP_ORIGIN ||
      value.startsWith(`${HARMONY_APP_ORIGIN}/`))
  );
}

export function isTrustedHarmonyDocument(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const hashIndex = value.indexOf('#');
  const withoutHash = hashIndex < 0 ? value : value.slice(0, hashIndex);
  return withoutHash === HARMONY_APP_ENTRY_URL;
}

export function resolveHarmonyLocalResource(
  requestUrl: unknown,
): HarmonyLocalResource | null {
  if (!isHarmonyAppOriginRequest(requestUrl)) return null;
  if (requestUrl.includes('?') || requestUrl.includes('#')) return null;

  const encodedPath = requestUrl.slice(HARMONY_APP_ORIGIN.length);
  if (/%2f|%5c|%25/i.test(encodedPath)) return null;

  let path: string;
  try {
    path = decodeURIComponent(encodedPath);
  } catch {
    return null;
  }
  if (
    !path.startsWith('/') ||
    path.includes('\\') ||
    path.includes('\0') ||
    path.includes('//')
  ) {
    return null;
  }
  if (path === '/index.html') {
    return { rawfilePath: 'dist/index.html', mimeType: 'text/html' };
  }

  const relativePath = path.slice(1);
  if (
    !(
      relativePath === 'favicon.svg' ||
      relativePath === 'icons.svg' ||
      relativePath.startsWith('assets/') ||
      relativePath.startsWith('icons/')
    )
  ) {
    return null;
  }
  if (
    relativePath
      .split('/')
      .some(
        (segment) =>
          !segment || segment === '.' || segment === '..' || !SAFE_SEGMENT.test(segment),
      )
  ) {
    return null;
  }

  const mimeType = mimeTypeForPath(relativePath);
  return mimeType === null
    ? null
    : { rawfilePath: `dist/${relativePath}`, mimeType };
}
