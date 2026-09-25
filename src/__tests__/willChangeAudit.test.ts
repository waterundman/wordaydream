/**
 * will-change 审计与收敛 (v1.6.1 Stage 4, P2-3)
 *
 * 背景
 * ----
 * `will-change: transform, opacity` 是一份**承诺**: 告诉浏览器「这个元素会改这两个
 * 属性, 请提前把它提升为独立合成层」。代价是永久性的 —— 只要声明在, 元素就常驻一个
 * 合成层 (GPU 内存 + 合成开销), 即使它一次都没动过。
 *
 * 因此它有两条纪律:
 * 1. **别撒谎**: 声明的属性必须真的是该元素会变化的属性。只为 `transform` 做过渡却
 *    声明 `opacity`, 是纯噪声 (也会误导后续读者以为这里还有透明度动画)。
 * 2. **别规模化**: 元素数量随数据增长的场景 (逐词 / 逐天 / 逐课 / 逐行重复渲染) 不能
 *    用永久 hint, 否则合成层数量 O(N) 增长, 而其中绝大多数在视口外且从不动画。
 *    这类元素应让浏览器在过渡**真正开始**时自行提升。
 *
 * 本测试把上述纪律编码成机械可验证的断言 (而不是靠人肉 review):
 * - T01 [critical]: 每个 `will-change` 声明的属性, 都能在该元素自身 / 其后代变体的
 *                   transition, 或它引用的 @keyframes 里找到依据。
 * - T02 [critical]: 5 处"数据规模相关"的站点必须保持无 will-change (锁定删除决定)。
 * - T03 [critical]: 判定保留的站点仍须声明 transform+opacity (锁定保留决定)。
 * - T04:            存在 `will-change: auto` 的显式释放分支 (reduced-motion)。
 * - T05:            内联站点 (useCursorGlow) 的属性由 JS 真实改写。
 *
 * 审计面 = src/ 下 13 个 .css 文件 + 1 处 TS 内联。`harmony/entry/.preview/…/rawfile/dist`
 * 下的 will-change 属于 hvigor 构建产物 (dist 打包结果), 不属源, 不在审计范围。
 * 逐站点判定记录见 docs/spec/v1.6.1/main.md §12。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = join(ROOT, 'src');

/** will-change 允许出现的属性白名单 —— 都是 compositor 友好属性。 */
const ALLOWED_WILL_CHANGE_PROPS = new Set(['transform', 'opacity', 'auto']);

/** 从 transition / animation 值里剔除的时序关键字 (它们不是属性名)。 */
const VALUE_KEYWORDS = new Set([
  'ease',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'linear',
  'step-start',
  'step-end',
  'steps',
  'cubic-bezier',
  'infinite',
  'normal',
  'reverse',
  'alternate',
  'alternate-reverse',
  'both',
  'forwards',
  'backwards',
  'running',
  'paused',
  'var',
  'none',
  'all',
  'inherit',
  'initial',
  'unset',
]);

interface Block {
  /** 相对 ROOT 的 posix 路径 */
  file: string;
  /** 原始选择器文本 (可能含逗号分组与换行) */
  selector: string;
  /** 已剥离注释的声明体 */
  body: string;
}

interface Site {
  file: string;
  selector: string;
  /** will-change 声明的属性 (未含 `auto` 时即有值) */
  props: string[];
  /** 其中"找不到动画依据"的属性 */
  unevidenced: string[];
}

/** 递归收集 src/ 下所有 .css 文件。 */
function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...cssFiles(full));
    else if (entry.name.endsWith('.css')) out.push(full);
  }
  return out.sort();
}

/** 剥离 CSS 注释 —— 注释里也会提到 `will-change`, 不剥离会产生幻影站点。 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * 解析出所有"最内层"声明块。嵌套 at-rule (@media / @keyframes) 的外层壳不会匹配
 * (因为它的体内含 `{`), 内层规则会被正常捕获 —— 这正是我们要的粒度。
 */
function parseBlocks(file: string, text: string): Block[] {
  const blocks: Block[] = [];
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const selector = (m[1] ?? '').trim();
    if (selector === '') continue;
    blocks.push({ file: rel, selector, body: m[2] ?? '' });
  }
  return blocks;
}

/** 选择器的各分组 (trim 后)。 */
function selectorParts(selector: string): string[] {
  return selector
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

/**
 * 在括号深度 0 处切出值里的裸 token。
 * 必须处理深度: `transition: transform 400ms cubic-bezier(0.22, 1, 0.36, 1);` 里的逗号
 * 属于函数实参, 不能当作多属性分隔符。
 */
function depthZeroTokens(value: string): string[] {
  const tokens: string[] = [];
  let depth = 0;
  let current = '';
  const flush = (): void => {
    const token = current.trim();
    current = '';
    if (token !== '') tokens.push(token);
  };
  for (const ch of value) {
    if (ch === '(') {
      depth += 1;
      current += ch;
    } else if (ch === ')') {
      depth = Math.max(0, depth - 1);
      current += ch;
    } else if (depth === 0 && /[\s,]/.test(ch)) {
      flush();
    } else {
      current += ch;
    }
  }
  flush();
  return tokens;
}

/** 抽取声明体里 transition / transition-property / animation / animation-name 提到的名字。 */
function animationTargets(body: string): Set<string> {
  const names = new Set<string>();
  const declRe = /(?:^|;)\s*(transition(?:-property)?|animation(?:-name)?)\s*:\s*([^;]*)/g;
  for (const decl of body.matchAll(declRe)) {
    for (const token of depthZeroTokens(decl[2] ?? '')) {
      // 只保留形如 CSS 属性名 / 动画名的 token, 排除时序关键字与时间数值
      if (!/^[a-z][a-z-]*$/.test(token)) continue;
      if (VALUE_KEYWORDS.has(token)) continue;
      names.add(token);
    }
  }
  return names;
}

/** 收集文件内所有 @keyframes 名字 → 该动画真实变化的属性集合。 */
function keyframesMap(text: string): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const re = /@keyframes\s+([\w-]+)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const name = m[1];
    if (name === undefined) continue;
    // 从 `{` 起花括号配平, 取出整个 keyframes 体
    let depth = 0;
    let i = m.index + m[0].length - 1;
    const start = i;
    for (; i < text.length; i += 1) {
      if (text[i] === '{') depth += 1;
      else if (text[i] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    const body = text.slice(start, i + 1);
    const props = new Set<string>();
    for (const step of body.matchAll(/\{[^{}]*\}/g)) {
      for (const decl of (step[0] ?? '').matchAll(/([a-z-]+)\s*:/g)) {
        const prop = decl[1];
        if (prop) props.add(prop);
      }
    }
    map.set(name, props);
  }
  return map;
}

/** other 是否为 base 的"变体/后代"选择器 (如 `.overlay` → `.overlay.covering`)。 */
function isVariantOf(other: string, base: string): boolean {
  if (other === base) return false;
  if (!other.startsWith(base)) return false;
  return /^[.:[ >+~]/.test(other.slice(base.length));
}

/** 全量审计: src/ 下每个 will-change 站点及其属性。 */
function collectSites(): Site[] {
  const sites: Site[] = [];
  for (const file of cssFiles(SRC)) {
    const text = stripComments(readFileSync(file, 'utf-8'));
    const kf = keyframesMap(text);
    const blocks = parseBlocks(file, text);

    for (const block of blocks) {
      const decl = block.body.match(/will-change\s*:\s*([^;]*)/);
      if (!decl) continue;

      const props = (decl[1] ?? '')
        .split(',')
        .map((p) => p.trim())
        .filter((p) => p !== '');

      // 动画依据 = 自身 + 变体/后代块的 transition/animation + 被引用的 @keyframes 属性
      const evidence = animationTargets(block.body);
      const baseParts = selectorParts(block.selector);
      for (const other of blocks) {
        if (other === block) continue;
        const otherParts = selectorParts(other.selector);
        const extendsBase = otherParts.some((o) => baseParts.some((b) => isVariantOf(o, b)));
        if (!extendsBase) continue;
        for (const t of animationTargets(other.body)) evidence.add(t);
      }
      for (const [name, animated] of kf) {
        if (!evidence.has(name)) continue;
        for (const p of animated) evidence.add(p);
      }

      sites.push({
        file: block.file,
        selector: block.selector,
        props,
        unevidenced: props.filter((p) => p !== 'auto' && !evidence.has(p)),
      });
    }
  }
  return sites;
}

const SITES = collectSites();

/**
 * 找到指定文件下、**包含**期望分组的站点。
 *
 * 用"包含"而非"整组相等": 站点可能写成分组选择器, 例如
 * `animations.css` 的 `.breathing-effect, [data-breathing]` —— 我们要定位的是
 * `[data-breathing]` 这个分组本身, 而不要求它独占选择器。
 * 分组内是复杂选择器 (如 `.completed .progressFill`) 时不会与单类名 `.progressFill`
 * 混同, 因为比较的是分组字符串的**全等**。
 */
function findSite(file: string, selector: string): Site | undefined {
  const wanted = selectorParts(selector);
  return SITES.find((s) => {
    if (s.file !== file) return false;
    const parts = selectorParts(s.selector);
    return wanted.every((w) => parts.includes(w));
  });
}

describe('will-change 审计 (v1.6.1 Stage 4 P2-3)', () => {
  it('T01 [critical]: 每个 will-change 属性都能在该元素的 transition / animation 中找到依据', () => {
    expect(SITES.length, '应至少审计到若干站点 (否则解析器失效)').toBeGreaterThan(8);

    const violations: string[] = [];
    for (const site of SITES) {
      for (const prop of site.props) {
        if (!ALLOWED_WILL_CHANGE_PROPS.has(prop)) {
          violations.push(
            `${site.file} :: ${site.selector} —— "${prop}" 不在白名单 {transform, opacity, auto}`,
          );
        }
      }
      for (const prop of site.unevidenced) {
        violations.push(
          `${site.file} :: ${site.selector} —— 声明 "${prop}" 但在本元素上看不到对应 transition/@keyframes`,
        );
      }
    }

    expect(
      violations,
      `will-change 撒谎 / 失据站点:\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  it('T02 [critical]: 数据规模相关的 5 处站点保持无 will-change', () => {
    const dropped: ReadonlyArray<readonly [string, string, string]> = [
      [
        'src/features/reading/components/LinkedOccurrenceHighlight.module.css',
        '.highlight::after',
        '逐词重复 —— 一篇 A2 文章可命中数十个词',
      ],
      [
        'src/features/analytics/components/AnalyticsPanel.module.css',
        '.accuracyBar,.durationBar',
        '逐天重复 —— 最多 30 根柱',
      ],
      [
        'src/features/analytics/components/AnalyticsPanel.module.css',
        '.distributionFill',
        '按 FSRS 状态逐桶重复',
      ],
      ['src/features/course/components/LessonCard.module.css', '.progressFill', '逐课重复'],
      [
        'src/features/reading/components/ReadingHistoryPanel.module.css',
        '.progressFill',
        '逐历史行重复',
      ],
    ];

    const offenders: string[] = [];
    for (const [file, selector, why] of dropped) {
      const hit = findSite(file, selector);
      if (hit) {
        offenders.push(
          `${file} :: ${selector} (${why}) 仍声明 will-change: ${hit.props.join(', ')}`,
        );
      }
    }

    expect(
      offenders,
      `以下站点数量随数据规模增长, 永久 will-change 会让合成层 O(N) 增长:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('T03 [critical]: 判定保留的站点仍声明 transform 与 opacity', () => {
    const keeps: ReadonlyArray<readonly [string, string]> = [
      ['src/styles/animations.css', '[data-breathing]'],
      ['src/features/home/components/HeroSection.module.css', '.hero'],
      ['src/features/home/HomePage.module.css', '.reveal'],
    ];

    const problems: string[] = [];
    for (const [file, selector] of keeps) {
      const site = findSite(file, selector);
      if (!site) {
        problems.push(`${file} :: ${selector} —— 站点消失或选择器改名`);
        continue;
      }
      for (const need of ['transform', 'opacity']) {
        if (!site.props.includes(need)) {
          problems.push(
            `${file} :: ${selector} —— 缺少 "${need}" (实际: ${site.props.join(', ')})`,
          );
        }
      }
    }

    expect(
      problems,
      `以下站点的两条声明均为真动画, 属判定保留项, 不应被顺手清掉:\n${problems.join('\n')}`,
    ).toEqual([]);
  });

  it('T04: 存在 `will-change: auto` 的显式释放分支 (reduced-motion)', () => {
    const homePage = stripComments(
      readFileSync(join(SRC, 'features/home/HomePage.module.css'), 'utf-8'),
    );
    // reduced-motion 下 transition 被关掉, 此时必须把 hint 一并释放
    expect(homePage).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*will-change:\s*auto/,
    );
  });

  it('T05: 内联站点 useCursorGlow 的两条声明都由 JS 真实改写', () => {
    const hook = readFileSync(join(SRC, 'hooks/useCursorGlow.ts'), 'utf-8');
    expect(hook, '内联样式应声明 transform + opacity').toMatch(
      /will-change:\s*transform,\s*opacity/,
    );
    // 光晕的 transform 与 opacity 必须真的有写入口, 否则 declaration 是假的
    expect(hook, 'mousemove 应写 transform').toMatch(/glow\.style\.transform\s*=/);
    expect(hook, '应写 opacity').toMatch(/glow\.style\.opacity\s*=/);
  });
});
