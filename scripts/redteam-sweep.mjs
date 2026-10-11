/**
 * 用户行为全量红队探测 v2 (只读工具, 不进 CI)
 *
 * 用法: npm run build && npx vite preview --port 4173 --strictPort
 *       node scripts/redteam-sweep.mjs [--only=RT-04,RT-09] [--headed]
 *
 * 每探测一个独立 context (干净 localStorage/IndexedDB)。selector 全部走
 * aria-label / data-testid / role, 等足首屏 (实测 passage-token 首现 > 2.2s)。
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.env.SWEEP_BASE ?? 'http://localhost:4173';
const SHOT = '.tmp-sweep';
mkdirSync(SHOT, { recursive: true });
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const only = onlyArg ? onlyArg.slice(7).split(',') : null;
const headed = process.argv.includes('--headed');

const findings = [];
const ran = [];
function rec(id, sev, title, detail) {
  findings.push({ id, sev, title, detail: String(detail ?? '').slice(0, 400) });
  console.log(`    [${sev}] ${title} :: ${String(detail ?? '').slice(0, 160)}`);
}

async function withPage(fn, opts = {}) {
  const browser = await chromium.launch({ headless: !headed });
  const ctx = await browser.newContext({ viewport: opts.viewport ?? { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text().slice(0, 240)); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e.message).slice(0, 240)));
  const netOnly = (list) => list.filter((e) => !/net::ERR|REQFAIL|favicon/.test(e));
  try { await fn(page, { errors, ctx, netOnly }); }
  finally { await ctx.close(); await browser.close(); }
}

/** 冷启动到目标路由, 等 readySel 出现 (无则等正文可交互) */
async function open(page, hash, readySel, timeout = 25000) {
  await page.goto(BASE + '/' + hash, { waitUntil: 'domcontentloaded' });
  if (readySel) await page.waitForSelector(readySel, { timeout });
  else await page.waitForTimeout(3000);
  await page.waitForTimeout(600);
}

async function text(page, sel) {
  const el = await page.$(sel);
  return el ? ((await el.textContent()) ?? '').trim() : null;
}

const P = [];
const probe = (id, name, fn, opts) => P.push({ id, name, fn, opts });

// ---------- 启动与导航 ----------
probe('RT-01', '冷启动首屏', async (page, h) => {
  await open(page, '', '[data-testid="hero-cta"]');
  if (await page.$('[data-testid="loading-fallback"]')) rec('RT-01', 'P2', '首屏停在加载占位', 'LoadingFallback 仍可见');
  if (h.netOnly(h.errors).length) rec('RT-01', 'P1', '首屏报错', h.netOnly(h.errors).slice(0, 2).join(' | '));
});

probe('RT-02', '四条路由深链接 + 非法 hash', async (page, h) => {
  const routes = [
    ['#/reading', '[data-testid="passage-token"]'],
    ['#/review', 'body'],
    ['#/wordlist', '[aria-label="搜索词表"]'],
    ['#/course', '[data-testid="course-switch-btn"], [aria-label*="课程"]'],
  ];
  for (const [hash, sel] of routes) {
    const t0 = Date.now();
    try { await open(page, hash, sel === 'body' ? null : sel); }
    catch (e) { rec('RT-02', 'P0', `${hash} 未渲染预期内容`, `${String(e.message).slice(0, 80)}`); continue; }
    const ms = Date.now() - t0;
    if (ms > 8000) rec('RT-02', 'P2', `${hash} 首屏过慢`, `${ms}ms 才出现内容`);
  }
  await open(page, '#/bogus', null);
  const body = (await page.textContent('body')) ?? '';
  if (/页面出错|Something went wrong/.test(body)) rec('RT-02', 'P0', '非法 hash 落错误边界', body.slice(0, 120));
  const hash = await page.evaluate(() => location.hash);
  if (!/^#\/(home|reading|review|wordlist|course)$/.test(hash)) {
    rec('RT-02', 'P2', '非法 hash 留在 URL 上', `hash=${hash} 未归位 (用户会看到坏链接)`);
  }
  if (h.netOnly(h.errors).length) rec('RT-02', 'P1', '深链接报错', h.netOnly(h.errors).slice(0, 2).join(' | '));
});

probe('RT-03', '前进/后退与视图一致', async (page, h) => {
  await open(page, '', '[data-testid="hero-cta"]');
  await page.evaluate(() => (location.hash = '#/wordlist'));
  await page.waitForSelector('[aria-label="搜索词表"]', { timeout: 20000 });
  await page.evaluate(() => (location.hash = '#/course'));
  await page.waitForTimeout(2500);
  await page.goBack();
  await page.waitForTimeout(2500);
  const hash = await page.evaluate(() => location.hash);
  const body = (await page.textContent('body')) ?? '';
  if (hash !== '#/wordlist') rec('RT-03', 'P1', '后退后 hash 不符', `期望 #/wordlist, 实得 ${hash}`);
  if (!/搜索词表|词表/.test(body)) rec('RT-03', 'P0', '后退后视图没跟上', `hash=${hash}, 正文无词表特征`);
  if (h.netOnly(h.errors).length) rec('RT-03', 'P1', '导航报错', h.netOnly(h.errors).slice(0, 2).join(' | '));
});

probe('RT-04', '连续快速切换 5 条路由 (过渡队列)', async (page, h) => {
  await open(page, '', '[data-testid="hero-cta"]');
  const seq = ['#/reading', '#/course', '#/wordlist', '#/review', '#/reading', '#/home'];
  for (const hash of seq) {
    await page.evaluate((hh) => (location.hash = hh), hash);
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(6000);
  const endHash = await page.evaluate(() => location.hash);
  const body = (await page.textContent('body')) ?? '';
  if (endHash !== '#/reading') rec('RT-04', 'P1', '连点后停在错误路由', `末次 #/reading, 实得 ${endHash}`);
  if (!(await page.$('[data-testid="passage-token"]'))) {
    rec('RT-04', 'P0', '连点后阅读页空', `hash=${endHash} 但无词位; 正文: ${body.slice(0, 80)}`);
  }
  if (await page.$('[data-testid="loading-fallback"]')) rec('RT-04', 'P1', '连点后卡在加载态', 'LoadingFallback 常驻');
  if (h.netOnly(h.errors).length) rec('RT-04', 'P1', '连点报错', h.netOnly(h.errors).slice(0, 3).join(' | '));
});

// ---------- 阅读 ----------
probe('RT-05', '阅读: 点词 → 释义 → 作答 → 进度', async (page, h) => {
  await open(page, '#/reading', '[data-testid="passage-token"]');
  const before = await text(page, '[aria-label*="学习进度"], [role="progressbar"]');
  const tokens = await page.$$('[data-testid="passage-token"]');
  if (!tokens.length) { rec('RT-05', 'P0', '阅读页无词位', 'passage-token = 0'); return; }
  await tokens[1].click();
  await page.waitForSelector('[aria-label="释义输入"]', { timeout: 8000 }).catch(() => {
    rec('RT-05', 'P0', '点词后无释义面板', '8s 内未出现 [aria-label="释义输入"]');
  });
  const body1 = (await page.textContent('body')) ?? '';
  if (/释义加载中/.test(body1)) rec('RT-05', 'P1', '释义停在「加载中」', '终态占位文案, 无重试入口');
  const area = await page.$('[aria-label="释义输入"]');
  if (area) {
    await area.fill('我的释义答案');
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1500);
    const after = await text(page, '[aria-label*="学习进度"], [role="progressbar"]');
    if (after === before) rec('RT-05', 'P2', '作答后进度未变化', `前=${before} 后=${after}`);
  }
  if (h.netOnly(h.errors).length) rec('RT-05', 'P1', '阅读主链路报错', h.netOnly(h.errors).slice(0, 3).join(' | '));
});

probe('RT-06', '阅读键盘: 方向键/空格/Escape 与锁死回归', async (page, h) => {
  await open(page, '#/reading', '[data-testid="passage-token"]');
  const cursor = await page.$('[aria-label*="阅读文本词位光标"]');
  if (!cursor) { rec('RT-06', 'P1', '词位光标容器缺失', '键盘用户无法用方向键浏览'); return; }
  await cursor.focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);
  await page.keyboard.press('Space');
  const opened = await page.waitForSelector('[aria-label="释义输入"]', { timeout: 4000 }).catch(() => null);
  if (!opened) rec('RT-06', 'P0', '空格打不开释义', '键盘主路径不可用');
  else {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
    if (await page.$('[aria-label="释义输入"]')) {
      rec('RT-06', 'P0', 'Escape 关不掉释义面板', '面板残留');
    }
    const focusAfterClose = await page.evaluate(() => ({
      tag: document.activeElement?.tagName,
      label: document.activeElement?.getAttribute('aria-label'),
    }));
    if (focusAfterClose.tag === 'BODY') rec('RT-06', 'P2', '关闭后焦点掉回 body', '键盘上下文丢失 (v1.6.5 曾修同类锁死)');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(400);
    await page.keyboard.press('ArrowRight');
    const re = await page.waitForSelector('[aria-label="释义输入"]', { timeout: 1500 }).catch(() => null);
    if (re) await page.keyboard.press('Escape');
    void re;
  }
  if (h.netOnly(h.errors).length) rec('RT-06', 'P1', '键盘链路报错', h.netOnly(h.errors).slice(0, 2).join(' | '));
});

probe('RT-07', '连点不同词位的释义陈旧响应', async (page, h) => {
  await open(page, '#/reading', '[data-testid="passage-token"]');
  const tokens = await page.$$('[data-testid="passage-token"]');
  if (tokens.length < 5) { rec('RT-07', 'P3', '词位不足', `${tokens.length} 个`); return; }
  const idx = [0, 2, 4, 1, 6].filter((i) => i < tokens.length);
  let last = '';
  for (const i of idx) {
    last = ((await tokens[i].textContent()) ?? '').trim();
    await tokens[i].click();
    await page.waitForTimeout(80);
  }
  await page.waitForTimeout(2500);
  const panel = await page.$('[aria-label="释义输入"]');
  if (!panel) { rec('RT-07', 'P2', '连点后面板不在', `末次点击「${last}」`); return; }
  const body = (await page.textContent('body')) ?? '';
  if (last && !body.includes(last)) {
    await page.screenshot({ path: `${SHOT}/RT-07-stale.png` });
    rec('RT-07', 'P1', '面板不是末次点击的词', `末点「${last}」, 正文窗口内不含该词形`);
  }
  if (h.netOnly(h.errors).length) rec('RT-07', 'P1', '竞态报错', h.netOnly(h.errors).slice(0, 2).join(' | '));
});

probe('RT-08', '无可用语音时点朗读 + 语速切换', async (page) => {
  await open(page, '#/reading', '[data-testid="passage-token"]');
  await (await page.$('[data-testid="passage-token"]')).click();
  await page.waitForSelector('[aria-label="释义输入"]', { timeout: 8000 }).catch(() => {});
  const speak = await page.$('[aria-label="朗读单词"], [aria-label="朗读"]');
  if (!speak) { rec('RT-08', 'P2', '朗读入口缺失', '面板内无朗读按钮'); return; }
  const before = (await page.evaluate(() => navigator.userAgent)) ?? '';
  await speak.click();
  await page.waitForTimeout(1200);
  const rate = await page.$('[data-testid="tts-rate-selector"]');
  if (rate) {
    for (const i of [0, 1, 2, 3]) { await rate.selectOption({ index: i }).catch(() => {}); await page.waitForTimeout(150); }
  } else rec('RT-08', 'P3', '语速选择器缺失', 'tts-rate-selector 未找到');
  void before;
});

probe('RT-09', '生僻/变形词位的释义兜底', async (page, h) => {
  await open(page, '#/reading', '[data-testid="passage-token"]');
  const tokens = await page.$$('[data-testid="passage-token"]');
  let stuck = 0;
  for (const t of tokens.slice(0, Math.min(8, tokens.length))) {
    const w = ((await t.textContent()) ?? '').trim();
    if (!/[a-zA-Zà-öø-ÿ]/.test(w)) continue;
    await t.click();
    await page.waitForTimeout(1400);
    const body = (await page.textContent('body')) ?? '';
    if (/释义加载中/.test(body)) { stuck++; await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
    else await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  }
  if (stuck > 0) rec('RT-09', 'P1', `${stuck} 个词的释义停在加载中`, 'mock provider 下无兜底释义, 且不会自愈');
  if (h.netOnly(h.errors).length) rec('RT-09', 'P2', '取词报错', h.netOnly(h.errors).slice(0, 2).join(' | '));
});

// ---------- 复习 ----------
probe('RT-10', '#/review 深链: 无到期卡时的落点', async (page, h) => {
  await open(page, '#/review', null);
  await page.waitForTimeout(4000);
  const hash = await page.evaluate(() => location.hash);
  const body = (await page.textContent('body')) ?? '';
  const hasRating = /重来|困难|良好|简单/.test(body);
  if (!hasRating && hash !== '#/wordlist') {
    rec('RT-10', 'P1', '无到期卡时未落词表', `hash=${hash} (设计口径 v1.6.5 S3 应转 #/wordlist)`);
  }
  if (!hasRating && !/无到期|暂无|没有.*复习|已学完|词表/.test(body)) {
    rec('RT-10', 'P2', '无到期卡缺少可读反馈', `正文: ${body.slice(0, 100)}`);
  }
  if (h.netOnly(h.errors).length) rec('RT-10', 'P1', '复习深链报错', h.netOnly(h.errors).slice(0, 2).join(' | '));
});

probe('RT-11', '复习: 造卡 → 评分 → 连点不重复计数', async (page, h) => {
  await open(page, '#/reading', '[data-testid="passage-token"]');
  const tokens = await page.$$('[data-testid="passage-token"]');
  let made = 0;
  for (const t of tokens.slice(0, 4)) {
    await t.click();
    const area = await page.waitForSelector('[aria-label="释义输入"]', { timeout: 5000 }).catch(() => null);
    if (!area) continue;
    await area.fill(`答案${made}`);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(900);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    made++;
  }
  await page.evaluate(() => (location.hash = '#/review'));
  await page.waitForTimeout(5000);
  const body = (await page.textContent('body')) ?? '';
  if (!/重来|困难|良好|简单/.test(body)) {
    rec('RT-11', 'P1', `${made} 次作答后仍进不了复习`, `正文: ${body.slice(0, 120)}`);
    return;
  }
  const again = await page.$('[aria-label^="重来"]');
  if (again) {
    await again.click();
    await page.waitForTimeout(120);
    const again2 = await page.$('[aria-label^="重来"]');
    if (again2) await again2.click();
    await page.waitForTimeout(1500);
  }
  const pause = await page.$('[aria-label="暂停复习"]');
  if (pause) {
    await pause.click();
    await page.waitForTimeout(800);
    const resume = await page.$('[aria-label="继续复习"]');
    if (!resume) rec('RT-11', 'P1', '暂停后没有继续入口', '「继续复习」未出现');
    else await resume.click();
  }
  const quit = await page.$('[aria-label="退出复习"]');
  if (quit) { await quit.click(); await page.waitForTimeout(1200); }
  if (h.netOnly(h.errors).length) rec('RT-11', 'P1', '复习链路报错', h.netOnly(h.errors).slice(0, 3).join(' | '));
});

// ---------- 词表 / 数据 ----------
probe('RT-12', 'CSV 导入畸形与注入文件', async (page, h) => {
  await open(page, '#/wordlist', '[aria-label="搜索词表"]');
  const input = await page.$('input[type="file"]');
  if (!input) { rec('RT-12', 'P0', '词表页无文件输入', 'input[type=file] 未找到'); return; }
  const cases = [
    ['empty', ''],
    ['header-only', 'word,translation\n'],
    ['one-col', 'only_one\n'],
    ['unclosed-quote', 'word,translation\n"abc,def\n'],
    ['bom-crlf', '﻿word,translation\r\napple,苹果\r\n'],
    ['xss', 'word,translation\n<img src=x onerror=window.__x=1>,<script>window.__y=1</script>\n'],
    ['de-umlaut', 'word,translation\nschlüßel,钥匙\n'],
    ['huge-field', 'word,translation\n' + 'a'.repeat(5000) + ',x\n'],
    ['binary', '\u0000\u0001\u0002\u0003binary\n'],
    ['many-rows', 'word,translation\n' + Array.from({ length: 300 }, (_, i) => `w${i},释义${i}`).join('\n') + '\n'],
    ['cefr-junk', 'word,translation,cefr\napple,苹果,NOT_A_LEVEL\n'],
  ];
  for (const [name, body] of cases) {
    const f = `${SHOT}/rt12-${name}.csv`;
    writeFileSync(f, body, 'utf8');
    await input.setInputFiles(f).catch((e) => rec('RT-12', 'P2', `${name} 上传被拒`, String(e.message).slice(0, 90)));
    await page.waitForTimeout(1200);
    const dom = (await page.textContent('body')) ?? '';
    const injected = await page.evaluate(() => Boolean(window.__x || window.__y));
    if (injected) rec('RT-12', 'P0', 'CSV 内容被执行 (XSS)', `case=${name}`);
    if (/undefined|NaN|\[object Object\]/.test(dom)) {
      rec('RT-12', 'P2', `导入 ${name} 后出现脏文案`, dom.match(/.{0,60}(undefined|NaN|\[object Object\]).{0,30}/)?.[0]);
    }
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await open(page, '#/wordlist', '[aria-label="搜索词表"]');
  const myLists = await text(page, '[data-testid="my-csv-wordlists"]');
  if (myLists === null) rec('RT-12', 'P1', '导入后「我的词库」区块消失', 'my-csv-wordlists 未渲染');
  if (h.netOnly(h.errors).length) rec('RT-12', 'P1', '导入过程未捕获错误', h.netOnly(h.errors).slice(0, 4).join(' | '));
});

probe('RT-13', '词表搜索的元字符与超长输入', async (page, h) => {
  await open(page, '#/wordlist', '[aria-label="搜索词表"]');
  const search = await page.$('[aria-label="搜索词表"]');
  for (const q of ['*', '(a|b)*', '[a-z', '\\', '.', 'a'.repeat(3000), '   ', '🎉', 'DROP TABLE--', 'apple OR 1=1']) {
    await search.fill(q);
    await page.waitForTimeout(280);
    const body = (await page.textContent('body')) ?? '';
    if (/SyntaxError|Invalid regular expression|页面出错/.test(body)) {
      rec('RT-13', 'P0', `搜索串「${q}」把页面搞崩`, body.match(/.{0,70}(SyntaxError|Invalid regular|出错).{0,40}/)?.[0]);
      break;
    }
  }
  await search.fill('');
  await page.waitForTimeout(600);
  const clearedLen = ((await page.textContent('body')) ?? '').length;
  await search.fill('apple');
  await page.waitForTimeout(600);
  const filteredLen = ((await page.textContent('body')) ?? '').length;
  await search.fill('');
  await page.waitForTimeout(800);
  const restoredLen = ((await page.textContent('body')) ?? '').length;
  if (filteredLen === clearedLen) rec('RT-13', 'P2', '搜索没有过滤任何内容', `搜前/搜中长度都是 ${clearedLen}`);
  if (Math.abs(restoredLen - clearedLen) > clearedLen * 0.2) {
    rec('RT-13', 'P1', '清空搜索后列表没恢复', `清空后 ${restoredLen} vs 原 ${clearedLen}`);
  }
  if (h.netOnly(h.errors).length) rec('RT-13', 'P1', '搜索报错', h.netOnly(h.errors).slice(0, 3).join(' | '));
});

probe('RT-14', '语言/难度切换在刷新后是否记住', async (page, h) => {
  await open(page, '#/wordlist', '[aria-label="搜索词表"]');
  const de = await page.$('[aria-label="语言"] >> text=DE, button:has-text("DE")');
  if (de) { await de.click(); await page.waitForTimeout(1500); }
  const b1 = await page.$('button:has-text("B1"), [aria-label="B1"]');
  if (b1) { await b1.click(); await page.waitForTimeout(1500); }
  const lsBefore = await page.evaluate(() => JSON.stringify(Object.entries(localStorage)));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await open(page, '#/wordlist', '[aria-label="搜索词表"]');
  const lsAfter = await page.evaluate(() => JSON.stringify(Object.entries(localStorage)));
  if (lsBefore !== lsAfter) rec('RT-14', 'P2', '筛选态未持久化', '刷新前 localStorage 与刷新后不一致 (语言/难度回滚)');
  const activeDe = await page.evaluate(() => {
    const on = [...document.querySelectorAll('[aria-pressed="true"], [aria-current="true"]')];
    return on.map((e) => e.textContent.trim()).join(',');
  });
  if (!/DE|B1/.test(activeDe)) rec('RT-14', 'P1', '刷新后未回到 DE/B1', `高亮项=${activeDe || '(无)'}`);
  if (h.netOnly(h.errors).length) rec('RT-14', 'P2', '切换报错', h.netOnly(h.errors).slice(0, 2).join(' | '));
});

probe('RT-15', '错词本批量选择与两步确认删除', async (page, h) => {
  await open(page, '#/wordlist', '[aria-label="搜索词表"]');
  const sec = await page.$('[data-testid="wrong-words-section"]');
  if (!sec) { rec('RT-15', 'P1', '错词本区块未渲染', 'wrong-words-section 不存在'); return; }
  const toggle = await page.$('[data-testid="wrong-words-select-toggle"]');
  if (!toggle) { rec('RT-15', 'P2', '错词本无多选入口', 'wrong-words-select-toggle 未找到 (可能需先有数据)'); return; }
  await toggle.click();
  await page.waitForTimeout(600);
  const bulk = await page.$('[data-testid="wrong-words-bulk-remove"]');
  if (bulk) {
    const st = await bulk.evaluate((e) => `${e.disabled}/${e.getAttribute('aria-disabled')}`);
    rec('RT-15', 'P3', '批量条已出现', `未选中时 disabled 状态=${st}`);
  }
  await toggle.click().catch(() => {});
  await page.waitForTimeout(400);
  if (h.netOnly(h.errors).length) rec('RT-15', 'P1', '错词操作报错', h.netOnly(h.errors).slice(0, 2).join(' | '));
});

// ---------- 设置 ----------
async function openSettings(page) {
  await open(page, '', '[data-testid="hero-cta"]');
  const gear = await page.$('[aria-label="设置"]');
  if (!gear) throw new Error('设置入口缺失');
  await gear.click();
  await page.waitForSelector('[role="dialog"], [aria-modal="true"]', { timeout: 15000 });
  await page.waitForTimeout(1200);
  for (const s of await page.$$('summary')) await s.click().catch(() => {});
  await page.waitForTimeout(600);
}

probe('RT-16', '设置面板: 焦点陷阱 / Escape / 焦点回归', async (page, h) => {
  await openSettings(page);
  let escaped = false, bodyFocus = false;
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const a = document.activeElement;
      return { tag: a?.tagName, inModal: !!a?.closest('[role="dialog"],[aria-modal="true"]') };
    });
    if (!info.inModal && info.tag !== 'BODY') escaped = true;
    if (info.tag === 'BODY') bodyFocus = true;
  }
  if (escaped) rec('RT-16', 'P1', 'Tab 能跳出设置面板', '焦点不再被对话框约束 (读屏/键盘用户会迷路)');
  if (bodyFocus) rec('RT-16', 'P2', 'Tab 过程出现焦点落空', 'activeElement = body');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(900);
  if (await page.$('[role="dialog"]')) rec('RT-16', 'P0', 'Escape 关不掉设置', '对话框仍在');
  const back = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  if (back !== '设置') rec('RT-16', 'P1', '关闭后焦点未回到设置按钮', `实得 ${back}`);
  if (h.netOnly(h.errors).length) rec('RT-16', 'P1', '设置面板报错', h.netOnly(h.errors).slice(0, 3).join(' | '));
});

probe('RT-17', '设置: 通知时段的合法跨日与非法区间', async (page, h) => {
  await openSettings(page);
  const sec = await page.$('[data-testid="notifications-section"]');
  if (!sec) { rec('RT-17', 'P0', '通知分组未渲染', 'notifications-section 不存在'); return; }
  const sw = await page.$('[data-testid="notifications-section"] [role="switch"], [data-testid="notifications-section"] [aria-checked]');
  if (sw && (await sw.getAttribute('aria-checked')) === 'false') { await sw.click(); await page.waitForTimeout(800); }
  const start = await page.$('#notifications-start-hour');
  const end = await page.$('#notifications-end-hour');
  if (!start || !end) { rec('RT-17', 'P1', '时段下拉不可操作', 'start/end select 缺失或被禁用'); return; }
  await start.selectOption('22'); await end.selectOption('6');
  await page.waitForTimeout(900);
  const crossWarn = await page.$('[data-testid="notifications-window-warning"]');
  if (crossWarn) rec('RT-17', 'P1', '跨零点时段被判非法', '22:00→06:00 是合理夜间窗口, 不应告警');
  await start.selectOption('9'); await end.selectOption('8');
  await page.waitForTimeout(900);
  if (!(await page.$('[data-testid="notifications-window-warning"]'))) {
    rec('RT-17', 'P1', '非法时段 (09→08) 无告警', '用户会以为通知已生效');
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await openSettings(page);
  const kept = await start.evaluate((e) => e.value).catch(() => null);
  void kept;
  if (h.netOnly(h.errors).length) rec('RT-17', 'P1', '通知设置报错', h.netOnly(h.errors).slice(0, 3).join(' | '));
});

probe('RT-18', '设置: LLM 非法值与密钥泄露面', async (page, h) => {
  await openSettings(page);
  const inputs = await page.$$('input');
  const kinds = await Promise.all(inputs.map(async (i) => ({ type: await i.getAttribute('type'), ph: await i.getAttribute('placeholder'), label: await i.getAttribute('aria-label') })));
  const secret = inputs.find((_, idx) => kinds[idx].type === 'password');
  if (!secret) rec('RT-18', 'P1', 'API Key 输入框非 password 型', `字段=${JSON.stringify(kinds.map((k) => k.ph || k.label)).slice(0, 200)}`);
  else {
    await secret.fill('sk-TESTVALUE-1234');
    await page.waitForTimeout(1200);
    const leak = await page.evaluate(() => {
      const out = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if ((localStorage.getItem(k) ?? '').includes('sk-TESTVALUE')) out.push(k);
      }
      return out;
    });
    rec('RT-18', leak.length ? 'P2' : 'P3', '密钥落盘位置', `含密钥的存储键: ${leak.join(',') || '(不在 localStorage)'}`);
    const visible = await page.evaluate(() => document.body.innerText.includes('sk-TESTVALUE'));
    if (visible) rec('RT-18', 'P2', '明文密钥出现在界面文本', '可能被截图/读屏带出');
    await secret.fill('');
  }
  const proxy = inputs.find((_, idx) => /http|代理|proxy|url/i.test((kinds[idx].ph ?? '') + (kinds[idx].label ?? '')));
  if (proxy) {
    for (const bad of ['javascript:alert(1)', 'not a url', 'http://', 'x'.repeat(2000)]) {
      await proxy.fill(bad);
      await page.waitForTimeout(400);
    }
    const body = (await page.textContent('body')) ?? '';
    const judged = /格式|非法|无效|必须以|https/.test(body);
    if (!judged) rec('RT-18', 'P1', '代理地址无校验反馈', 'javascript:/明文 http 均可提交');
  } else rec('RT-18', 'P3', '未找到代理地址输入', `字段=${JSON.stringify(kinds.map((k) => k.ph)).slice(0, 160)}`);
  if (h.netOnly(h.errors).length) rec('RT-18', 'P1', '设置写入报错', h.netOnly(h.errors).slice(0, 3).join(' | '));
});

// ---------- 韧性与呈现 ----------
probe('RT-19', '离线横幅 (含冷启动) 与恢复', async (page, h) => {
  await open(page, '', '[data-testid="hero-cta"]');
  await h.ctx.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.waitForTimeout(1500);
  let banner = await page.$('[data-testid="offline-banner"]');
  if (!banner) rec('RT-19', 'P1', '断网后无横幅', 'offline-banner 未出现');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  banner = await page.$('[data-testid="offline-banner"]');
  if (!banner) rec('RT-19', 'P0', '离线冷启动无横幅', 'v1.6.5 S5 修过的场景再次不可见');
  else {
    const close = await page.$('[data-testid="offline-banner-close"]');
    if (!close) rec('RT-19', 'P2', '离线横幅无关闭入口', '用户无法收起');
    else await close.click();
  }
  await h.ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(2000);
  const body = (await page.textContent('body')) ?? '';
  if (/离线|无法连接|不在线/.test(body) && !(await page.$('[data-testid="offline-banner"]'))) {
    rec('RT-19', 'P2', '恢复在线后仍提示离线', body.match(/.{0,60}(离线|无法连接).{0,30}/)?.[0]);
  }
  if (h.netOnly(h.errors).filter((e) => !/ERR_INTERNET|ERR_NAME/.test(e)).length) {
    rec('RT-19', 'P1', '离线切换抛非网络错误', h.netOnly(h.errors).slice(0, 2).join(' | '));
  }
});

probe('RT-20', '持久化数据损坏下能否启动', async (page, h) => {
  await page.addInitScript(() => {
    const junk = ['wordaydream', 'wordaydream.settings', 'wordaydream.memory', 'wordaydream.review', 'wordaydream.wordlist'];
    for (const k of junk) localStorage.setItem(k, '{oops not json');
    localStorage.setItem('wordaydream.store', JSON.stringify({ state: null, version: 99999 }));
    localStorage.setItem('zzz-bulk', 'x'.repeat(400000));
  });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  const body = (await page.textContent('body')) ?? '';
  if (body.trim().length < 20) rec('RT-20', 'P0', '脏数据白屏', 'body 无可见内容');
  else if (/页面出错|出错|Something went wrong/.test(body)) rec('RT-20', 'P1', '脏数据落错误边界', body.slice(0, 140));
  const fatal = h.errors.filter((e) => /PAGEERROR/.test(e));
  if (fatal.length) rec('RT-20', 'P0', '脏数据抛未捕获异常', fatal.slice(0, 2).join(' | '));
});

probe('RT-21', '窄屏 320 / 手机视口横向溢出', async (page, h) => {
  for (const vp of [{ width: 320, height: 640 }, { width: 412, height: 915 }]) {
    for (const [hash, sel] of [['', '[data-testid="hero-cta"]'], ['#/reading', '[data-testid="passage-token"]'], ['#/wordlist', '[aria-label="搜索词表"]'], ['#/course', null]]) {
      const browser = await chromium.launch({ headless: !headed });
      const ctx = await browser.newContext({ viewport: vp });
      const p2 = await ctx.newPage();
      const errs = [];
      p2.on('pageerror', (e) => errs.push(String(e.message).slice(0, 100)));
      await p2.goto(BASE + '/' + hash, { waitUntil: 'domcontentloaded' });
      if (sel) await p2.waitForSelector(sel, { timeout: 25000 }).catch(() => {});
      await p2.waitForTimeout(1500);
      const o = await p2.evaluate(() => {
        const de = document.documentElement;
        let worst = null;
        for (const el of document.querySelectorAll('body *')) {
          const r = el.getBoundingClientRect();
          if (r.right > window.innerWidth + 2 && r.width > 30) {
            worst = `${el.tagName}.${String(el.className).slice(0, 26)}=${Math.round(r.right)}`;
            break;
          }
        }
        return { dx: de.scrollWidth - de.clientWidth, worst };
      });
      if (o.dx > 2) {
        await p2.screenshot({ path: `${SHOT}/RT-21-${vp.width}-${hash.replace(/[^\w]/g, '')}.png` });
        rec('RT-21', 'P1', `${vp.width}px ${hash || 'home'} 横向溢出`, `溢出 ${o.dx}px, 首个越界 ${o.worst}`);
      }
      if (errs.length) rec('RT-21', 'P2', `${vp.width}px ${hash} 报错`, errs.slice(0, 2).join(' | '));
      await ctx.close();
      await browser.close();
    }
  }
  void page; void h;
});

probe('RT-22', '界面语言一致性 (中文界面里的外语标签)', async (page) => {
  for (const [hash, sel] of [['', '[data-testid="hero-cta"]'], ['#/reading', '[data-testid="passage-token"]'], ['#/wordlist', '[aria-label="搜索词表"]'], ['#/course', null]]) {
    await open(page, hash, sel);
    const foreign = await page.evaluate(() => {
      const skip = /^(EN|DE|A1|A2|B1|B2|C1|FSRS|CSV|JSON|PWA|ID|URL|TTS|L\d)$/;
      const out = new Set();
      for (const el of document.querySelectorAll('[aria-label], [title], button, label')) {
        const s = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim();
        if (!s || s.length > 28 || skip.test(s)) continue;
        const hasCJK = /[一-鿿]/.test(s);
        const latin = /[A-Za-z][A-Za-z\s:.-]{3,}/.test(s);
        if (!hasCJK && latin && !/^https?/.test(s)) out.add(s.slice(0, 28));
      }
      return [...out];
    });
    if (foreign.length) rec('RT-22', 'P2', `${hash || 'home'} 存在纯外语可见标签`, foreign.slice(0, 8).join(' / '));
  }
});

probe('RT-23', '课程: 连点进课与完成弹窗导航', async (page, h) => {
  await open(page, '#/course', '[data-testid="course-switch-btn"], [aria-label*="课程"]');
  const start = await page.$('button:has-text("开始学习")');
  if (!start) { rec('RT-23', 'P2', '课程页无「开始学习」', '入口文案或结构变化'); return; }
  await start.click();
  await page.waitForTimeout(2500);
  for (let i = 0; i < 4; i++) { await start.click().catch(() => {}); await page.waitForTimeout(300); }
  await page.waitForTimeout(3000);
  const cont = await page.$('[data-testid="current-lesson-continue"]');
  if (cont) { await cont.click(); await page.waitForTimeout(2000); }
  const body = (await page.textContent('body')) ?? '';
  if (/页面出错|出错啦/.test(body)) rec('RT-23', 'P0', '课程连点后崩溃', body.slice(0, 120));
  const back = await page.$('[data-testid="lesson-complete-back"]');
  const next = await page.$('[data-testid="lesson-complete-next"]');
  if (back && next) {
    await next.click(); await page.waitForTimeout(700);
    await back.click(); await page.waitForTimeout(700);
  }
  if (h.netOnly(h.errors).length) rec('RT-23', 'P1', '课程链路报错', h.netOnly(h.errors).slice(0, 3).join(' | '));
});

const t0 = Date.now();
for (const p of P) {
  if (only && !only.includes(p.id)) continue;
  console.log(`\n=== ${p.id} ${p.name} ===`);
  try { await withPage(p.fn, p.opts); ran.push({ id: p.id, status: 'ran' }); }
  catch (e) { ran.push({ id: p.id, status: 'ERROR' }); rec(p.id, 'P0', '探测脚本自身异常', String(e.message).slice(0, 160)); }
}
const order = { P0: 0, P1: 1, P2: 2, P3: 3 };
findings.sort((a, b) => order[a.sev] - order[b.sev]);
writeFileSync(`${SHOT}/findings.json`, JSON.stringify({ findings, ran }, null, 2));
console.log(`\n===== 汇总 (${((Date.now() - t0) / 1000).toFixed(0)}s / ${ran.length} 探测 / ${findings.length} finding) =====`);
for (const f of findings) console.log(`${f.sev} | ${f.id} | ${f.title} | ${f.detail}`.slice(0, 240));
