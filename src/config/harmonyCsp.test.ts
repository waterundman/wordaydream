import { describe, expect, it } from 'vitest';
import {
  HARMONY_PROXY_ENV_NAME,
  hardenHarmonyCsp,
  parseHarmonyProxyUrl,
} from './harmonyCsp';

const CSP_HTML = `<!doctype html><html><head>
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'self' arkweb://*; img-src 'self' data:;" />
</head></html>`;

describe('parseHarmonyProxyUrl', () => {
  it('derives an origin while preserving the configured endpoint', () => {
    expect(
      parseHarmonyProxyUrl('  https://proxy.example.com:8443/api/llm?model=fast  '),
    ).toEqual({
      proxyUrl: 'https://proxy.example.com:8443/api/llm?model=fast',
      origin: 'https://proxy.example.com:8443',
    });
  });

  it.each([
    '/api/llm',
    'http://192.168.1.100:3001/api/llm',
    'ftp://proxy.example.com/api',
    'not a url',
    '',
  ])(
    'rejects a non-HTTPS absolute proxy URL: %s',
    (value) => {
      expect(() => parseHarmonyProxyUrl(value)).toThrow(HARMONY_PROXY_ENV_NAME);
    },
  );
});

describe('hardenHarmonyCsp', () => {
  it('removes insecure HTTP sources and keeps the configured HTTPS proxy', () => {
    const source = CSP_HTML.replace(
      "connect-src 'self' arkweb://*",
      "connect-src 'self' http://localhost:* http://127.0.0.1:* arkweb://*",
    );

    const html = hardenHarmonyCsp(source, 'https://proxy.example.com');

    expect(html).not.toContain('http://localhost');
    expect(html).not.toContain('http://127.0.0.1');
    expect(html).toContain("connect-src 'self' arkweb://* https://proxy.example.com;");
    expect(html).toContain("default-src 'self';");
    expect(html).toContain("img-src 'self' data:;");
  });

  it('removes duplicate connect-src tokens (idempotent hardening)', () => {
    const duplicated = CSP_HTML.replace(
      "connect-src 'self' arkweb://*",
      "connect-src 'self' arkweb://* https://proxy.example.com https://proxy.example.com",
    );

    const html = hardenHarmonyCsp(duplicated, 'https://proxy.example.com');

    expect(html.match(/https:\/\/proxy\.example\.com/g)).toHaveLength(1);
  });

  it('fails closed when the CSP meta or connect-src directive is missing', () => {
    expect(() => hardenHarmonyCsp('<html></html>', 'https://proxy.example.com')).toThrow(
      'Content-Security-Policy meta tag',
    );
    expect(() =>
      hardenHarmonyCsp(
        '<meta http-equiv="Content-Security-Policy" content="default-src \'self\';">',
        'https://proxy.example.com',
      ),
    ).toThrow('connect-src');
  });
});
