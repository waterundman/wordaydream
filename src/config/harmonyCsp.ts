export const HARMONY_PROXY_ENV_NAME = 'VITE_LLM_PROXY_URL_HARMONY';
export const HARMONY_PROXY_DISABLED = '__WORDAYDREAM_HARMONY_PROXY_DISABLED__';

export interface HarmonyProxyConfig {
  proxyUrl: string;
  origin: string;
}

/** Validate the Harmony proxy once, then derive both runtime and CSP values. */
export function parseHarmonyProxyUrl(rawValue: string): HarmonyProxyConfig {
  const proxyUrl = rawValue.trim();
  if (!/^https:\/\//i.test(proxyUrl)) {
    throw new Error(
      `[harmony] ${HARMONY_PROXY_ENV_NAME} must be an absolute https:// URL`,
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(proxyUrl);
  } catch {
    throw new Error(
      `[harmony] ${HARMONY_PROXY_ENV_NAME} must be an absolute https:// URL`,
    );
  }

  if (
    parsedUrl.protocol !== 'https:' ||
    !parsedUrl.hostname ||
    parsedUrl.origin === 'null'
  ) {
    throw new Error(
      `[harmony] ${HARMONY_PROXY_ENV_NAME} must be an absolute https:// URL`,
    );
  }

  return { proxyUrl, origin: parsedUrl.origin };
}

/** Add one normalized proxy origin to the CSP connect-src directive. */
export function injectConnectSrcOrigin(html: string, origin: string): string {
  return updateConnectSrc(html, (sources) => [...sources, origin]);
}

/** Remove insecure HTTP endpoints from the Harmony shell and add its HTTPS proxy. */
export function hardenHarmonyCsp(
  html: string,
  proxyOrigin?: string,
): string {
  return updateConnectSrc(html, (sources) => {
    const secureSources = sources.filter((source) => !/^http:/i.test(source));
    return proxyOrigin ? [...secureSources, proxyOrigin] : secureSources;
  });
}

function updateConnectSrc(
  html: string,
  updateSources: (sources: string[]) => string[],
): string {
  const cspMetaPattern = /<meta\b(?=[^>]*\bhttp-equiv\s*=\s*(["'])Content-Security-Policy\1)[^>]*>/i;
  const cspMeta = html.match(cspMetaPattern)?.[0];
  if (!cspMeta) {
    throw new Error('[harmony] index.html is missing its Content-Security-Policy meta tag');
  }

  const contentPattern = /\bcontent\s*=\s*"([^"]*)"/i;
  const contentMatch = cspMeta.match(contentPattern);
  if (!contentMatch) {
    throw new Error('[harmony] Content-Security-Policy meta tag is missing a content attribute');
  }

  const directives = contentMatch[1]
    .split(';')
    .map((directive) => directive.trim())
    .filter(Boolean);
  const connectSrcIndex = directives.findIndex((directive) =>
    /^connect-src(?:\s|$)/i.test(directive),
  );
  if (connectSrcIndex < 0) {
    throw new Error('[harmony] Content-Security-Policy is missing its connect-src directive');
  }

  const [directiveName, ...sources] = directives[connectSrcIndex].split(/\s+/);
  const uniqueSources = [...new Set(updateSources(sources))];
  directives[connectSrcIndex] = [directiveName, ...uniqueSources].join(' ');

  const transformedMeta = cspMeta.replace(
    contentPattern,
    `content="${directives.join('; ')};"`,
  );
  return html.replace(cspMeta, transformedMeta);
}
