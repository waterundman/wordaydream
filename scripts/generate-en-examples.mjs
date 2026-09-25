#!/usr/bin/env node
/**
 * v1.6.2 Stage 2 (S2-1): 英语例句语料生成
 *
 * 数据来源: `tatoeba-sentence-pairs-in-mandarin-chinese-english@0.20260520.0`
 *   npm pack tatoeba-sentence-pairs-in-mandarin-chinese-english@0.20260520.0
 *   解包到 .tmp-wl/tatoeba/ (gitignored, 不入库; 沿用 v1.6.0 的 .tmp-wl 约定)
 *   数据形态: [zhSentenceId, zhSentence, enSentenceId, enSentence] 四元组数组
 *
 * ⚠️ 许可 (D4): 包声明 MIT, 但上游 Tatoeba 句子是 **CC-BY 2.0 FR (署名义务)**,
 *    且包内**未附 LICENSE 文件**。署名义务靠每条例句的 `exampleSource = "tatoeba:<enSentenceId>"`
 *    落地 —— 这不是可选项, 是许可条件。来源不可考时记 `unknown:<batch>` 而不是伪造 id。
 *
 * 用法:
 *   node scripts/generate-en-examples.mjs                     # dry-run (默认): 只打印统计
 *   node scripts/generate-en-examples.mjs --report            # 额外输出覆盖率 JSON 到 .tmp-wl/
 *   node scripts/generate-en-examples.mjs --write             # 写入 src/data/wordlists/en/*.json
 *   WL_SRC=<dir> node scripts/generate-en-examples.mjs        # 覆盖源目录 (默认 .tmp-wl)
 *
 * 选句策略 (SPEC D3 + §12 细化):
 *   过滤 (硬性): 句长 ≤ 12 词 / 中文侧含 CJK / 排除 Tom|Mary|... 开头的 Tatoeba 高噪声句
 *   排序 (取 Top-1): ① 原形命中优先 ② 精确词形命中次之 ③ 词干兜底 ④ 句短优先 ⑤ id 升序(确定性)
 *   繁简: 译文经 opencc-js (tw→cn) 归一化 —— **仅生成期**, 不进产物、不加运行时依赖
 *
 * **与校验器的一致性 (key invariant)**:
 *   选句与 `verify-wordlists.mjs` 的 R3 共用 `scripts/lib/lemmaForms.mjs`。
 *   生成期用 `containsLemma` 终判 ⇒ **生成出来的例句必过 R3**, 不可能出现"生成即校验失败"。
 *
 * 单测可 import 本文件的纯函数; 被直接执行时才跑 main (见文件末尾 invokedDirectly 守卫)。
 */
import fs from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import OpenCC from 'opencc-js';
import { containsLemma, forms, isMultiWord, matchTier, stems, tokenize } from './lib/lemmaForms.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = process.env.WL_SRC ? resolve(process.env.WL_SRC) : join(projectRoot, '.tmp-wl');
const TATOEBA_JSON = join(SRC, 'tatoeba', 'package', 'sentences.json');
const OUT_DIR = join(projectRoot, 'src', 'data', 'wordlists', 'en');
const REPORT_PATH = join(SRC, 'en-examples-report.json');

/** 语料包固定版本 —— 上游持续更新, 浮动版本会让生成不可复现 (SPEC §8.5) */
export const CORPUS_PACKAGE = 'tatoeba-sentence-pairs-in-mandarin-chinese-english';
export const CORPUS_VERSION = '0.20260520.0';

/** 句长上限 (词数)。超过则视为"非教材式长句", 弃用。 */
export const MAX_WORDS = 12;

/**
 * 句长下限 (词数), 由 `--min-words=N` 覆盖, 默认 1 (= 不设下限, 严格按 SPEC D3)。
 *
 * 为什么做成开关而不是直接写死: 实测发现只按 D3 的「句短优先」会产生 686 条 (17.5%)
 * 的 ≤2 词碎片句 (如 `Jump. | 跳。`)。是否加下限属**设计取舍**, 不该由实现者静默决定,
 * 故做成可切换 + 两种口径都出数, 把决定权交回审批。
 */
export const DEFAULT_MIN_WORDS = 1;

const LEVELS = [
  { key: 'a1', level: 'A1', difficulty: 1 },
  { key: 'a2', level: 'A2', difficulty: 2 },
  { key: 'b1', level: 'B1', difficulty: 3 },
  { key: 'b2', level: 'B2', difficulty: 4 },
];

const CJK = /[\u4e00-\u9fff]/;
/**
 * Tatoeba 的高频噪声主语 —— 该语料里大量以人名开头的造句练习句
 * (如 "Tom is Mary's former husband."), 对词典例句毫无价值。
 * 这是**人工确认的封闭名单**, 不是猜测。
 *
 * ⚠️ `mr\.` / `mrs\.` 必须与前面的名字**分开写**: `mr\.\b` 永远不成立 ——
 * 正则踩到: `.` 是非单词字符, 其后的空格也是非单词字符 ⇒ 二者之间没有词边界,
 * 于是 `\b` 恒不匹配, "Mr. Smith is here." 这条分支等于**死代码** (单测 T01 抓出来的)。
 */
const NOISE_SUBJECT = /^(tom|mary|john|peter|jane|bob|alice|jack|sam|bill|sue)\b|^(mr|mrs)\./i;

/** 命中层级名称 (下标 = `matchTier` 返回值)。见 scripts/lib/lemmaForms.mjs → matchTier */
const TIER_NAMES = ['base', 'inflection', 'derived', 'fallback'];

const WRITE = process.argv.includes('--write');
const REPORT = process.argv.includes('--report');

// ---------------------------------------------------------------- 纯函数 (可单测)

/** 是否 Tatoeba 人名噪声句 (以封闭人名名单开头) */
export function isNoiseSentence(en) {
  return NOISE_SUBJECT.test(String(en).trim());
}

/** 词数 (与词形匹配共用同一 tokenize, 避免两套口径) */
export function countWords(en) {
  return tokenize(en).length;
}

/**
 * 句子是否进入候选池 (D3 硬性过滤)。
 * @param {string} en 英语句
 * @param {string} zh 中文句 (可为 null/undefined → 直接淘汰: 不许无译文的例句进池)
 * @param {{minWords?:number, maxWords?:number}} [opts]
 */
export function isEligible(en, zh, opts = {}) {
  const minWords = opts.minWords ?? DEFAULT_MIN_WORDS;
  const maxWords = opts.maxWords ?? MAX_WORDS;
  if (typeof en !== 'string' || typeof zh !== 'string') return false;
  if (!CJK.test(zh)) return false;                 // 译文必须含中文
  if (en.trim() === '') return false;
  const n = countWords(en);
  if (n === 0 || n > maxWords) return false;       // 句长上限
  if (n < minWords) return false;                  // 句长下限 (默认 1 = 不设)
  if (isNoiseSentence(en)) return false;           // 人名噪声
  return true;
}

let _converter = null;
/**
 * 译文归一化 (**两道**)：
 *   1. 繁体 → 简体 (opencc-js, tw→cn)。**幂等**：已是简体的输入原样返回 (已实测)。
 *   2. **句末半角标点 → 全角** (`.`→`。` / `?`→`？` / `!`→`！`)。
 *
 * 为什么第 2 步也放在这里：实测 3928 条译文里有 **64 条**以 `.`/`?` 结尾
 * (Tatoeba 中英混排的产物)。既已对字符做规范化，就**没有理由**留着明显的中文排版错误 ——
 * 学习者界面里 `他的家在哪儿?` 与 `一切正常。` 并存是可见的不一致。
 * 变换是确定性的、可逆的，且**只动句末一个字符** (不触碰句内标点，避免误伤小数/省略号)。
 */
export function normalizeZh(zh) {
  if (!_converter) _converter = OpenCC.Converter({ from: 'tw', to: 'cn' });
  const s = _converter(String(zh));
  const last = s.slice(-1);
  const map = { '.': '。', '?': '？', '!': '！' };
  return map[last] ? s.slice(0, -1) + map[last] : s;
}

let _verifyConverter = null;
/**
 * 独立复核用的转换器: 走 `{from:'t',to:'cn'}` (通用繁体口径), **与 normalizeZh 的 tw 口径不同**。
 *
 * 为什么需要它: 只用自己的转换器验证自己 = 循环论证。
 * 换一个配置再跑一遍, 若仍能改动文本, 说明 tw→cn 留下了繁体 —— 这才是独立证据。
 */
export function toSimplifiedStrict(zh) {
  if (!_verifyConverter) _verifyConverter = OpenCC.Converter({ from: 't', to: 'cn' });
  return _verifyConverter(String(zh));
}

/**
 * 从候选句中挑出该 lemma 的 Top-1 例句。
 *
 * @param {string} lemma
 * @param {Array<{en:string, zh:string, enId:string}>} candidates 已归一化的候选句
 * @returns {{example:string, exampleTranslation:string, exampleSource:string, tier:number}|null}
 */
export function pickExample(lemma, candidates) {
  const ranked = [];
  for (const c of candidates) {
    // 与校验器 R3 同一判据 —— 生成即校验通过
    if (!containsLemma(lemma, c.en)) continue;
    const id = Number(c.enId);
    ranked.push({ c, tier: matchTier(lemma, c.en), words: tokenize(c.en).length, id: Number.isFinite(id) ? id : Number.MAX_SAFE_INTEGER });
  }
  if (ranked.length === 0) return null;
  // ① 命中层级(原形 > 屈折 > 同根派生 > 兜底)  ② 句短优先  ③ id 升序 (确定性, 不是质量信号)
  ranked.sort((a, b) => a.tier - b.tier || a.words - b.words || a.id - b.id);
  const { c, tier } = ranked[0];
  return { example: c.en, exampleTranslation: c.zh, exampleSource: `tatoeba:${c.enId}`, tier };
}

// ---------------------------------------------------------------- 索引

/**
 * 建 token 索引。
 * `byToken` 支持精确词形查询; `sortedTokens` / `sortedReversed` 支持词干前缀/复合后缀
 * 的二分查找 —— 后者是德语式变形（英语里如 country→countries, art→article）的兜底。
 */
export function buildIndex(tuples, opts = {}) {
  const minWords = opts.minWords ?? DEFAULT_MIN_WORDS;
  const maxWords = opts.maxWords ?? MAX_WORDS;
  const byToken = new Map();
  const records = [];
  const stats = { tuples: 0, eligible: 0, excludedLong: 0, excludedShort: 0, excludedNoise: 0, excludedNoCjk: 0, excludedEmpty: 0, converted: 0 };

  for (const t of tuples) {
    stats.tuples++;
    if (!Array.isArray(t) || t.length < 4) continue;
    const zhRaw = t[1];
    const enId = t[2];
    const en = t[3];
    if (typeof zhRaw !== 'string' || typeof en !== 'string') continue;
    if (!CJK.test(zhRaw)) { stats.excludedNoCjk++; continue; }
    if (en.trim() === '') { stats.excludedEmpty++; continue; }
    const words = tokenize(en);
    if (words.length > maxWords) { stats.excludedLong++; continue; }
    if (words.length === 0) { stats.excludedEmpty++; continue; }
    if (words.length < minWords) { stats.excludedShort++; continue; }
    if (isNoiseSentence(en)) { stats.excludedNoise++; continue; }

    const zh = normalizeZh(zhRaw);
    if (zh !== zhRaw) stats.converted++;
    const recIdx = records.length;
    records.push({ en, zh, enId: String(enId), words: words.length });
    stats.eligible++;
    for (const w of new Set(words)) {
      let arr = byToken.get(w);
      if (!arr) byToken.set(w, (arr = []));
      arr.push(recIdx);
    }
  }

  const sortedTokens = [...byToken.keys()].sort();
  const reversed = sortedTokens.map((t) => ({ rev: [...t].reverse().join(''), t })).sort((a, b) => (a.rev < b.rev ? -1 : a.rev > b.rev ? 1 : 0));

  return { byToken, records, sortedTokens, reversed, stats };
}

/** 二分查找: 返回所有以 prefix 开头的 token 区间起点 (无匹配返回 length) */
function lowerBound(list, pred) {
  let lo = 0, hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pred(list[mid])) hi = mid; else lo = mid + 1;
  }
  return lo;
}

/** 含该词干前缀的全部记录下标 */
function prefixRecords(index, stem) {
  const out = [];
  const start = lowerBound(index.sortedTokens, (t) => t >= stem);
  for (let i = start; i < index.sortedTokens.length; i++) {
    const t = index.sortedTokens[i];
    if (!t.startsWith(stem)) break;
    out.push(...(index.byToken.get(t) ?? []));
  }
  return out;
}

/** 以该词干**结尾**（复合词）的全部记录下标 */
function suffixRecords(index, stem, minSurplus) {
  const out = [];
  const revStem = [...stem].reverse().join('');
  const start = lowerBound(index.reversed, (e) => e.rev >= revStem);
  for (let i = start; i < index.reversed.length; i++) {
    const e = index.reversed[i];
    if (!e.rev.startsWith(revStem)) break;
    if (e.t.length - stem.length < minSurplus) continue;
    out.push(...(index.byToken.get(e.t) ?? []));
  }
  return out;
}

/**
 * 多词短语的候选收集：以**倒排表最短的词**作锚点，避免 `to` 这类高频词把候选池撑爆。
 * 锚点词若在语料里根本不存在，则任何短语都不可能命中 → 直接空集。
 */
function collectPhraseCandidates(lemma, index) {
  const parts = [...new Set(tokenize(lemma))];
  if (parts.length === 0) return [];
  let anchor = null;
  for (const p of parts) {
    const list = index.byToken.get(p);
    if (!list) return [];
    if (!anchor || list.length < anchor.length) anchor = list;
  }
  return anchor.map((i) => index.records[i]);
}

/**
 * 收集某 lemma 的全部候选句 (精确 ∪ 词干前缀 ∪ 复合后缀), 去重后返回。
 * 与 `containsLemma` 的三段式一一对应 —— 收集面**等于**判定面。
 * 多词短语走独立路径 (逐 token 机制结构性不适用, 见 lemmaForms.isMultiWord)。
 */
export function collectCandidates(lemma, index) {
  if (isMultiWord(lemma)) return collectPhraseCandidates(lemma, index);
  const ids = new Set();
  for (const f of forms(lemma)) for (const i of index.byToken.get(f) ?? []) ids.add(i);
  for (const s of stems(lemma)) {
    if (s.length < 3) continue;
    for (const i of prefixRecords(index, s)) ids.add(i);
    for (const i of suffixRecords(index, s, 3)) ids.add(i);
  }
  return [...ids].map((i) => index.records[i]);
}

// ---------------------------------------------------------------- CLI

/** 解析 `--min-words=N`; 缺省则用 DEFAULT_MIN_WORDS */
function parseMinWords(argv = process.argv) {
  const hit = argv.find((a) => a.startsWith('--min-words='));
  if (!hit) return DEFAULT_MIN_WORDS;
  const n = Number(hit.slice('--min-words='.length));
  if (!Number.isInteger(n) || n < 1) {
    console.error(`✗ --min-words 需为 ≥1 的整数, 实为 "${hit}"`);
    process.exit(1);
  }
  return n;
}

async function main() {
  if (!fs.existsSync(TATOEBA_JSON)) {
    console.error(`✗ 找不到语料: ${TATOEBA_JSON}`);
    console.error(`  请先: npm pack ${CORPUS_PACKAGE}@${CORPUS_VERSION} 并解包到 .tmp-wl/tatoeba/`);
    process.exit(1);
  }
  const minWords = parseMinWords();
  const tuples = JSON.parse(fs.readFileSync(TATOEBA_JSON, 'utf8'));
  const index = buildIndex(tuples, { minWords });
  const s = index.stats;
  console.log(`语料: ${CORPUS_PACKAGE}@${CORPUS_VERSION}`);
  console.log(`过滤: ${minWords} ≤ 词数 ≤ ${MAX_WORDS} / 译文含 CJK / 排除人名噪声句`);
  console.log(`四元组 ${s.tuples} → 候选池 ${s.eligible}  (排除 超长 ${s.excludedLong} / 过短 ${s.excludedShort} / 噪声 ${s.excludedNoise} / 无中文 ${s.excludedNoCjk} / 空 ${s.excludedEmpty})`);
  console.log(`其中经 opencc 繁简修正 ${s.converted} 条\n`);

  const levels = {};
  const out = {};
  const tierTotals = { base: 0, inflection: 0, derived: 0, fallback: 0 };
  let sumTotal = 0, sumCovered = 0, sumBytes = 0;
  // 质量自检口径 (不参与选句, 只如实记录 —— SPEC §8.2 要求抽查并记录问题)
  const quality = { minWords2: 0, maxWords10: 0, zhNeedsStrictFix: 0, noPunct: 0 };
  const zhViolations = [];
  const derivedSamples = [];

  for (const { key, level } of LEVELS) {
    const wlPath = join(OUT_DIR, `${key}.json`);
    const wl = JSON.parse(fs.readFileSync(wlPath, 'utf8'));
    const tiers = { base: 0, inflection: 0, derived: 0, fallback: 0 };
    let covered = 0, bytes = 0;
    const samples = [];

    for (const w of wl.words) {
      const picked = pickExample(w.lemma, collectCandidates(w.lemma, index));
      if (!picked) continue;
      covered++;
      const tier = TIER_NAMES[picked.tier];
      tiers[tier]++;
      bytes += Buffer.byteLength('"example":' + JSON.stringify(picked.example) + ',"exampleTranslation":' + JSON.stringify(picked.exampleTranslation) + ',"exampleSource":' + JSON.stringify(picked.exampleSource), 'utf8');

      // --- 质量自检 (记录, 不干预) ---
      const toks = tokenize(picked.example);
      if (toks.length <= 2) quality.minWords2++;
      if (toks.length >= 10) quality.maxWords10++;
      if (picked.exampleTranslation === toSimplifiedStrict(picked.exampleTranslation)) {
        // 通用繁体口径也无改动 ⇒ 译文确为简体
      } else {
        quality.zhNeedsStrictFix++;
        if (zhViolations.length < 10) zhViolations.push({ lemma: w.lemma, zh: picked.exampleTranslation, fixed: toSimplifiedStrict(picked.exampleTranslation) });
      }
      if (!/[.!?。！？]$/.test(picked.example.trim())) quality.noPunct++;
      if (tier === 'derived' && derivedSamples.length < 20) derivedSamples.push({ level, lemma: w.lemma, example: picked.example });

      if (samples.length < 6 && (covered <= 2 || covered % 131 === 0)) samples.push({ lemma: w.lemma, tier, ...picked });
      // tier 是生成期诊断, **不入数据契约** —— 只取三个 example* 字段
      w.example = picked.example;
      w.exampleTranslation = picked.exampleTranslation;
      w.exampleSource = picked.exampleSource;
    }

    for (const k of Object.keys(tiers)) tierTotals[k] += tiers[k];
    const total = wl.words.length;
    out[key] = wl;
    levels[key] = {
      level, total, covered, uncovered: total - covered,
      coverage: Number(((covered / total) * 100).toFixed(1)),
      tiers, addedBytes: bytes,
    };
    sumTotal += total; sumCovered += covered; sumBytes += bytes;

    console.log(`=== ${level} (${key}.json) ===`);
    console.log(`  词条 ${total}  有例句 ${covered}  覆盖 ${(covered / total * 100).toFixed(1)}%  无例句 ${total - covered}`);
    console.log(`  命中层级: 原形 ${tiers.base} / 屈折 ${tiers.inflection} / 同根派生 ${tiers.derived} / 兜底 ${tiers.fallback}`);
    console.log(`  新增字段体积 ${(bytes / 1024).toFixed(1)} KB`);
    console.log('  抽样:');
    for (const x of samples) console.log(`    [${x.tier}] ${x.lemma} → ${x.example} | ${x.exampleTranslation} | ${x.exampleSource}`);
    console.log('');
  }

  const totals = {
    total: sumTotal, covered: sumCovered,
    coverage: Number(((sumCovered / sumTotal) * 100).toFixed(1)),
    uncovered: sumTotal - sumCovered,
    addedBytes: sumBytes,
  };
  console.log(`合计: ${sumTotal} 词条, 覆盖 ${sumCovered} (${totals.coverage}%), 未覆盖 ${totals.uncovered}`);
  console.log(`命中层级合计: 原形 ${tierTotals.base} / 屈折 ${tierTotals.inflection} / 同根派生 ${tierTotals.derived} / 兜底 ${tierTotals.fallback}`);
  console.log(`例句字段体积: +${(sumBytes / 1024).toFixed(1)} KB`);
  console.log(`质量自检: ≤2 词句 ${quality.minWords2} / ≥10 词句 ${quality.maxWords10} / 无句末标点 ${quality.noPunct}`);
  console.log(`译文繁体独立复核 (from:'t'→cn 仍可改动): ${quality.zhNeedsStrictFix}`);
  for (const v of zhViolations) console.log(`    ${v.lemma}: ${v.zh} → ${v.fixed}`);
  if (derivedSamples.length) {
    console.log(`同根派生命中抽样 (示例中出现的是同根词而非该词本身, 共 ${tierTotals.derived} 条):`);
    for (const d of derivedSamples) console.log(`    [${d.level}] ${d.lemma} → ${d.example}`);
  }

  const report = {
    corpus: { package: CORPUS_PACKAGE, version: CORPUS_VERSION },
    filter: { minWords, maxWords: MAX_WORDS, pool: s.eligible, excludedLong: s.excludedLong, excludedShort: s.excludedShort, excludedNoise: s.excludedNoise, excludedNoCjk: s.excludedNoCjk, excludedEmpty: s.excludedEmpty, zhConverted: s.converted },
    levels, totals, tierTotals, quality, zhViolations, derivedSamples,
  };
  if (REPORT) {
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n', 'utf8');
    console.log(`\n--report → ${REPORT_PATH}`);
  }

  if (WRITE) {
    for (const { key } of LEVELS) {
      const p = join(OUT_DIR, `${key}.json`);
      fs.writeFileSync(p, JSON.stringify(out[key], null, 2) + '\n', 'utf8');
      console.log(`written ${p} (${(fs.statSync(p).size / 1024).toFixed(1)} KB)`);
    }
  } else {
    console.log('\n[dry-run] 未写文件 (加 --write 生成正式文件)');
  }
}

const invokedDirectly =
  typeof process.argv[1] === 'string' && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  await main();
}
