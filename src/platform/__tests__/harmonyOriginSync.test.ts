/**
 * H6: origin 白名单漂移守护 (纯只读比对, 不改三处实现).
 *
 * 同一套"受信任 origin"概念目前存在三份副本:
 * 1. harmony/server/llm-proxy.js 的 STATIC_ALLOWED_ORIGINS (CORS 运行时真源);
 * 2. index.html CSP 的 connect-src 指令 (Web 壳运行时真源; harmony 构建期由
 *    hardenHarmonyCsp 进一步收紧 http: 端点);
 * 3. src/platform/__tests__/bridgeInputValidator.test.ts T15 的断言副本.
 *
 * (BridgeInputValidator.ets 的 ALLOWED_ARKWEB_ORIGIN_REGEXES +
 * isAllowedArkWebOrigin 因生产零引用、且注释所述调用点不存在已作为死代码删除,
 *  不再是第四份副本.)
 *
 * 守护语义: 副本 1/2 归一后的 origin 家族集合必须完全相等 (除显式豁免);
 * 副本 3 必须覆盖全部家族 (断言副本只能少不能漏). 任一副本新增未知 origin
 * 家族即失败, 强制三处同步修改.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PROJECT_ROOT: string = process.cwd();
const PROXY_PATH: string = join(PROJECT_ROOT, 'harmony', 'server', 'llm-proxy.js');
const INDEX_HTML_PATH: string = join(PROJECT_ROOT, 'index.html');
const CSP_ASSERTION_PATH: string = join(
  PROJECT_ROOT,
  'src',
  'platform',
  '__tests__',
  'bridgeInputValidator.test.ts'
);

/** origin 家族识别表 (唯一的家族定义处; 新增家族需同步三处白名单). */
const ORIGIN_FAMILIES: Array<{ key: string; probe: string; match: (token: string) => boolean }> = [
  { key: 'localhost', probe: 'localhost', match: (t) => t.includes('localhost') },
  { key: 'loopback-ip', probe: '127', match: (t) => t.includes('127.0.0.1') },
  { key: 'arkweb', probe: 'arkweb', match: (t) => t.includes('arkweb') },
  { key: 'hapogo', probe: 'hapogo', match: (t) => t.includes('hapogo.com') },
  { key: 'file', probe: 'file:', match: (t) => t.startsWith('file:') },
];

/** 仅服务端 CORS 白名单使用: ArkWeb file:// 兼容 origin, CSP 壳不再走 file 协议. */
const SERVER_ONLY_FAMILIES: string[] = ['file'];

/** CSP connect-src 中的非应用 origin token (自身 + 外部词典抓取源). */
const CSP_NON_APP_TOKENS: string[] = ["'self'", 'https://*.wiktionary.org'];

/** 把正则字面量主体 / CSP token 统一成可比较的 origin 形态. */
function normalizeOriginToken(raw: string): string {
  return raw
    .replace(/\\\./g, '.')
    .replace(/\\\//g, '/')
    .replace(/\(:\d\+\)\?/g, '')
    .replace(/[\\^$]/g, '')
    .replace(/\[a-z0-9-]+\+/g, '*')
    .replace(/\.\*/g, '*')
    .trim()
    .toLowerCase();
}

function familiesOf(tokens: string[], ignored: string[] = []): Set<string> {
  const families = new Set<string>();
  const unknown: string[] = [];
  for (const raw of tokens) {
    const token = normalizeOriginToken(raw);
    if (token.length === 0 || ignored.includes(token)) {
      continue;
    }
    const hit = ORIGIN_FAMILIES.filter((f) => f.match(token));
    if (hit.length === 0) {
      unknown.push(token);
    } else {
      for (const family of hit) families.add(family.key);
    }
  }
  // 未知 origin 家族: 白名单被单点扩写, 需同步其余副本与本守护.
  expect(unknown).toEqual([]);
  return families;
}

/** 副本 1: llm-proxy.js 的 STATIC_ALLOWED_ORIGINS 正则数组 (去掉字面量分隔符). */
function readProxyOriginRegexes(): string[] {
  const source = readFileSync(PROXY_PATH, 'utf-8');
  const start = source.indexOf('const STATIC_ALLOWED_ORIGINS');
  expect(start).toBeGreaterThan(-1);
  const body = source.substring(start, source.indexOf('];', start));
  // 正则字面量: / 起始, 转义对 (\.) 或普通字符, / 结尾 + 可选 flags
  const literals = body.match(/\/(?:\\[\s\S]|[^/\n])+\/[a-z]*/g);
  expect(literals).not.toBeNull();
  return (literals ?? []).map((literal) => literal.replace(/^\/(.*)\/[a-z]*$/s, '$1'));
}

/** 副本 2: index.html CSP connect-src 指令 token 列表. */
function readCspConnectSrcTokens(): string[] {
  const html = readFileSync(INDEX_HTML_PATH, 'utf-8');
  const match = html.match(/connect-src([^;"]*)/i);
  expect(match).not.toBeNull();
  return (match ? match[1] : '')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

/** 副本 3: bridgeInputValidator.test.ts 的 CSP 断言中出现的 origin 片段. */
function readAssertionOriginText(): string {
  return readFileSync(CSP_ASSERTION_PATH, 'utf-8');
}

describe('H6: origin 白名单三处副本不漂移', () => {
  it('两份运行时白名单均非空且家族可识别', () => {
    expect(familiesOf(readProxyOriginRegexes()).size).toBeGreaterThan(0);
    expect(familiesOf(readCspConnectSrcTokens(), CSP_NON_APP_TOKENS).size).toBeGreaterThan(0);
  });

  it('llm-proxy CORS 白名单 == index.html CSP connect-src (除服务端专属豁免)', () => {
    const proxyFamilies = familiesOf(readProxyOriginRegexes());
    const cspFamilies = familiesOf(readCspConnectSrcTokens(), CSP_NON_APP_TOKENS);
    const comparable = [...proxyFamilies]
      .filter((key) => !SERVER_ONLY_FAMILIES.includes(key))
      .sort();
    expect(comparable).toEqual([...cspFamilies].sort());
  });

  it('file:// 仅存在于服务端白名单 (ArkWeb file 协议兼容, CSP 壳禁用)', () => {
    const proxyFamilies = familiesOf(readProxyOriginRegexes());
    const cspFamilies = familiesOf(readCspConnectSrcTokens(), CSP_NON_APP_TOKENS);
    expect(proxyFamilies.has('file')).toBe(true);
    expect(cspFamilies.has('file')).toBe(false);
  });

  it('bridgeInputValidator.test.ts 的 CSP 断言副本覆盖全部应用 origin 家族', () => {
    const cspFamilies = familiesOf(readCspConnectSrcTokens(), CSP_NON_APP_TOKENS);
    const assertionText = readAssertionOriginText();
    for (const descriptor of ORIGIN_FAMILIES) {
      if (!cspFamilies.has(descriptor.key)) continue;
      expect(assertionText).toContain(descriptor.probe);
    }
  });

  it('守护自身未漏掉任一已登记家族 (新增家族须同步三处实现)', () => {
    const covered = new Set([
      ...familiesOf(readCspConnectSrcTokens(), CSP_NON_APP_TOKENS),
      ...SERVER_ONLY_FAMILIES,
    ]);
    for (const descriptor of ORIGIN_FAMILIES) {
      expect(covered.has(descriptor.key)).toBe(true);
    }
  });
});
