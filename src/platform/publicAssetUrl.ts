/**
 * Resolve a file from `public/` against Vite's configured base URL.
 *
 * The regular web build uses `/`, while the Harmony rawfile build uses `./`.
 * Keeping public paths behind this helper prevents JSX string literals from
 * resolving against the ArkWeb origin root.
 */
export function publicAssetUrl(
  path: string,
  baseUrl: string = import.meta.env.BASE_URL,
): string {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const normalizedPath = path.replace(/^\/+/, '');
  return `${normalizedBase}${normalizedPath}`;
}
