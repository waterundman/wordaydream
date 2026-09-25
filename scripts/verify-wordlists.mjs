#!/usr/bin/env node
/**
 * v1.6.0 Stage 1 (S1): 词表数据契约校验
 *
 * 校验对象:
 *   1. src/data/wordlists/{en,de}/{a1,a2,b1,b2}.json — JSON Schema 契约
 *   2. src/data/courses/en.ts — 课程 Lesson targetLemmas 必须落在对应等级词表内
 *
 * 契约 (见 docs/spec/v1.6.0/main.md §4.1 / §16.2 与 src/data/wordlists/index.ts):
 *   - 顶层: language / level / difficulty / version / total / words
 *   - total === words.length
 *   - 每条: lemma 非空且 ≤100 字符; pos 非空; translation 非空; cefr ∈ {A1..B2} 且与 level 一致
 *   - 等级内 lemma 不重复
 *   - v2 (英语必须): priority ∈ {1,2,3}; topic 非空; frequency ∈ {1..5}
 *   - semanticConflicts: 字符串数组, 每一项必须存在于同一等级词表中, 且双向标注
 *   - v1.6.2 例句字段 (R1-R5):
 *       R1  example / exampleTranslation 同时存在或同时缺失; exampleSource 不得孤立存在
 *       R2  存在时非空 (trim 后)
 *       R3  example 须含 lemma 的某个可接受词形 (**弱校验/下界**, 见 scripts/lib/lemmaForms.mjs)
 *       R4  exampleTranslation 须含 CJK 字符
 *       R5  exampleSource 须形如 "<source>:<id>"
 *
 * 退出码: 0 = 全部通过; 1 = 存在违规
 *
 * 用法: node scripts/verify-wordlists.mjs    (或 npm run verify:wordlists)
 *
 * 单测可 import `validateWordlist` 并注入自己的收集器 (被直接执行时才跑 main, 见文件末尾) */
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// v1.6.2 Stage 1: 例句弱校验 (R3) 的词形逻辑必须与生成器**共用同一实现**, 否则必然漂移.
import { containsLemma } from './lib/lemmaForms.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WL_BASE = join(projectRoot, 'src', 'data', 'wordlists');
const COURSES_EN = join(projectRoot, 'src', 'data', 'courses', 'en.ts');

const LEVELS = [
  { key: 'a1', level: 'A1', difficulty: 1 },
  { key: 'a2', level: 'A2', difficulty: 2 },
  { key: 'b1', level: 'B1', difficulty: 3 },
  { key: 'b2', level: 'B2', difficulty: 4 },
];
const VALID_CEFR = new Set(['A1', 'A2', 'B1', 'B2']);
/** 英语词表为 v2 schema (v1.6.0 新生成), 必须带全部 v2 字段 */
const V2_LANGUAGES = new Set(['en']);

const errors = [];
const warnings = [];
const fail = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);
/** 默认收集器 —— 让 `validateWordlist` 可被单测注入自己的收集器 (不污染模块级 state) */
const defaultSink = { fail, warn };

/**
 * 等级内 lemma 唯一性强制范围.
 * en 为 v1.6.0 新生成词表, 强制唯一; de 为既有词表, 存在同形异义词素
 * (如 sein: 动词 "是" / 限定词 "他的"; Morgen: "早晨" / "明天"), 二者 pos 不同但 lemma 相同 —
 * 属既有数据特征, 记为 warning 而非 error (应用层 progress 以 language:lemma 为键, 同形词共享状态).
 */
const STRICT_UNIQUE_LEMMA_LANGUAGES = new Set(['en']);

async function readJson(p) {
  return JSON.parse(await readFile(p, 'utf8'));
}

/**
 * v1.6.2 Stage 1: 例句字段契约 (R1–R5).
 *
 * 设计原则: **弱校验（下界）**。R3 命中不等于例句正确, 但**不命中几乎一定是错配**
 * (数据生成是 lemma→句子 的 join, 真实风险是接错词)。不要把它当"例句质量保证"。
 *
 * @returns {boolean} 是否全部通过
 */
function validateExampleFields(w, at, fail) {
  const hasExample = w.example !== undefined;
  const hasTranslation = w.exampleTranslation !== undefined;
  const hasSource = w.exampleSource !== undefined;
  let ok = true;

  // R1: example / exampleTranslation 同时存在或同时缺失 (禁止半截数据)
  if (hasExample !== hasTranslation) {
    fail(`${at}: example 与 exampleTranslation 必须同时存在或同时缺失 (example=${hasExample}, exampleTranslation=${hasTranslation})`);
    ok = false;
  }
  // R1b: exampleSource 不得孤立存在
  if (hasSource && !hasExample) {
    fail(`${at}: exampleSource 存在但 example 缺失 (出处附着在不存在的内容上)`);
    ok = false;
  }
  // R2: 存在时非空 (trim 后)
  if (hasExample) {
    if (typeof w.example !== 'string' || w.example.trim() === '') {
      fail(`${at}: example 存在但为空/非字符串`);
      ok = false;
    }
    if (typeof w.exampleTranslation !== 'string' || w.exampleTranslation.trim() === '') {
      fail(`${at}: exampleTranslation 存在但为空/非字符串`);
      ok = false;
    }
  }
  // R4: exampleTranslation 须含 CJK 字符
  if (hasTranslation && typeof w.exampleTranslation === 'string' && w.exampleTranslation.trim() !== '') {
    if (!/[\u4e00-\u9fff]/.test(w.exampleTranslation)) {
      fail(`${at}: exampleTranslation 不含中文字符 ("${w.exampleTranslation.slice(0, 30)}")`);
      ok = false;
    }
  }
  // R3: example 须含 lemma 的某个可接受词形 (弱匹配, 见 lemmaForms.mjs)
  if (hasExample && typeof w.example === 'string' && w.example.trim() !== '') {
    if (!containsLemma(String(w.lemma ?? ''), w.example)) {
      fail(`${at}: example 不含 lemma "${w.lemma}" 的任何可接受词形 ("${w.example.slice(0, 40)}")`);
      ok = false;
    }
  }
  // R5: exampleSource 若存在须形如 <source>:<id>
  if (hasSource) {
    if (typeof w.exampleSource !== 'string' || !/^[a-z][a-z0-9-]*:.+$/i.test(w.exampleSource)) {
      fail(`${at}: exampleSource 格式非法 (需形如 "<source>:<id>", 实为 ${JSON.stringify(w.exampleSource)})`);
      ok = false;
    }
  }
  return ok;
}

export function validateWordlist(language, { key, level, difficulty }, data, sink = defaultSink) {
  // 函数级遮蔽模块级收集器, 使单测可注入自己的 sink
  const { fail, warn } = sink;
  const where = `${language}/${key}.json`;
  const isV2 = V2_LANGUAGES.has(language);

  // --- 顶层 ---
  if (data.language !== language) fail(`${where}: language 应为 "${language}", 实为 "${data.language}"`);
  if (data.level !== level) fail(`${where}: level 应为 "${level}", 实为 "${data.level}"`);
  if (data.difficulty !== difficulty) fail(`${where}: difficulty 应为 ${difficulty}, 实为 ${data.difficulty}`);
  if (typeof data.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(data.version)) {
    fail(`${where}: version 非法 ("${data.version}")`);
  }
  if (!Array.isArray(data.words)) {
    fail(`${where}: words 必须为数组`);
    return { lemmas: new Set(), conflicts: new Map() };
  }
  if (data.total !== data.words.length) {
    fail(`${where}: total=${data.total} 与 words.length=${data.words.length} 不一致`);
  }

  // --- 逐条 ---
  const seen = new Set();
  const conflicts = new Map();
  data.words.forEach((w, i) => {
    const at = `${where}[${i}] (lemma=${w && w.lemma})`;
    if (typeof w.lemma !== 'string' || w.lemma.trim() === '') fail(`${at}: lemma 缺失或为空`);
    else if (w.lemma.length > 100) fail(`${at}: lemma 超过 100 字符`);
    if (typeof w.pos !== 'string' || w.pos.trim() === '') fail(`${at}: pos 缺失或为空`);
    if (typeof w.translation !== 'string' || w.translation.trim() === '') fail(`${at}: translation 缺失或为空`);
    if (!VALID_CEFR.has(w.cefr)) fail(`${at}: cefr "${w.cefr}" 非法`);
    else if (w.cefr !== level) fail(`${at}: cefr "${w.cefr}" 与等级 "${level}" 不一致`);

    const lemmaKey = String(w.lemma).toLowerCase();
    if (seen.has(lemmaKey)) {
      const msg = `${at}: 等级内 lemma 重复`;
      if (STRICT_UNIQUE_LEMMA_LANGUAGES.has(language)) fail(msg);
      else warn(`${msg} (同形异义, pos=${w.pos})`);
    }
    seen.add(lemmaKey);

    if (isV2) {
      if (![1, 2, 3].includes(w.priority)) fail(`${at}: priority "${w.priority}" 非法 (需 1/2/3)`);
      if (typeof w.topic !== 'string' || w.topic.trim() === '') fail(`${at}: topic 缺失或为空`);
      if (![1, 2, 3, 4, 5].includes(w.frequency)) fail(`${at}: frequency "${w.frequency}" 非法 (需 1..5)`);
    }

    if (w.semanticConflicts !== undefined) {
      if (!Array.isArray(w.semanticConflicts) || w.semanticConflicts.some((s) => typeof s !== 'string' || !s)) {
        fail(`${at}: semanticConflicts 必须为非空字符串数组`);
      } else {
        conflicts.set(lemmaKey, w.semanticConflicts.map((s) => s.toLowerCase()));
      }
    }

    // v1.6.2 Stage 1: 例句字段契约 (R1-R5)
    validateExampleFields(w, at, fail);
  });

  // --- semanticConflicts 引用完整性 + 双向标注 ---
  for (const [lemma, targets] of conflicts) {
    for (const t of targets) {
      if (!seen.has(t)) fail(`${where}: "${lemma}" 的 semanticConflicts 指向不存在的词 "${t}"`);
      else if (!conflicts.get(t)?.includes(lemma)) {
        fail(`${where}: semanticConflicts 非双向 — "${lemma}"→"${t}" 但 "${t}"→[${(conflicts.get(t) ?? []).join(',')}]`);
      }
    }
  }

  return { lemmas: seen, conflicts };
}

/** 解析 courses/en.ts 中每个 Lesson 的 (moduleId, title, targetLemmas) */
function parseEnCourseLessons(src) {
  const out = [];
  const re = /buildLesson\(\s*'([^']+)'\s*,\s*(\d+)\s*,\s*'((?:[^'\\]|\\.)*)'\s*,\s*'((?:[^'\\]|\\.)*)'\s*,\s*\[([\s\S]*?)\]\s*,?\s*\)/g;
  let m;
  while ((m = re.exec(src))) {
    out.push({
      moduleId: m[1],
      order: Number(m[2]),
      title: m[3],
      lemmas: (m[5].match(/'([^']+)'/g) ?? []).map((s) => s.slice(1, -1)),
    });
  }
  return out;
}

async function main() {
  const levelLemmas = {}; // `${language}:${key}` -> Set

  for (const language of ['en', 'de']) {
    for (const lv of LEVELS) {
      const path = join(WL_BASE, language, `${lv.key}.json`);
      let data;
      try {
        data = await readJson(path);
      } catch (e) {
        fail(`${language}/${lv.key}.json: 无法读取 (${e.message})`);
        continue;
      }
      const { lemmas } = validateWordlist(language, lv, data);
      levelLemmas[`${language}:${lv.key}`] = lemmas;
      console.log(`  ${language}/${lv.key}.json  words=${data.words.length}  version=${data.version}`);
    }
  }

  // --- 课程 ↔ 词表一致性 (英语) ---
  const courseSrc = await readFile(COURSES_EN, 'utf8');
  const lessons = parseEnCourseLessons(courseSrc);
  if (lessons.length === 0) fail('courses/en.ts: 未解析到任何 buildLesson');
  const usedPerLevel = new Map();
  for (const l of lessons) {
    const lvKey = l.moduleId.split('-')[1];
    const present = levelLemmas[`en:${lvKey}`];
    if (!present) {
      fail(`courses/en.ts: Lesson "${l.title}" 的 moduleId "${l.moduleId}" 无法对应词表`);
      continue;
    }
    if (l.lemmas.length !== 15) fail(`courses/en.ts: Lesson "${l.title}" 有 ${l.lemmas.length} 个 targetLemmas (应为 15)`);
    for (const lemma of l.lemmas) {
      if (!present.has(lemma.toLowerCase())) {
        fail(`courses/en.ts: Lesson "${l.title}" 的 targetLemmas 含等级 ${lvKey.toUpperCase()} 词表外的词 "${lemma}"`);
      }
    }
    const used = usedPerLevel.get(lvKey) ?? { seen: new Set(), dups: [] };
    for (const lemma of l.lemmas) {
      const k = lemma.toLowerCase();
      if (used.seen.has(k)) used.dups.push(k);
      used.seen.add(k);
    }
    usedPerLevel.set(lvKey, used);
  }
  for (const [lvKey, used] of usedPerLevel) {
    if (used.dups.length > 0) {
      fail(`courses/en.ts: 等级 ${lvKey.toUpperCase()} 的 Lesson 间 targetLemmas 重复 (${[...new Set(used.dups)].join(', ')})`);
    }
  }
  console.log(`  courses/en.ts  lessons=${lessons.length}  targetLemmas 全部命中对应等级词表`);

  if (warnings.length > 0) {
    console.warn(`\n⚠ ${warnings.length} 处提示 (不阻断):`);
    for (const w of warnings.slice(0, 20)) console.warn(`  - ${w}`);
    if (warnings.length > 20) console.warn(`  ... 另有 ${warnings.length - 20} 处`);
  }

  if (errors.length > 0) {
    console.error(`\n✗ 词表契约校验失败, 共 ${errors.length} 处:`);
    for (const e of errors.slice(0, 40)) console.error(`  - ${e}`);
    if (errors.length > 40) console.error(`  ... 另有 ${errors.length - 40} 处`);
    process.exit(1);
  }
  console.log('\n✓ 词表契约校验通过');
}

/**
 * 只有**直接执行本文件**时才跑 main()；被 `import`（单测）时只暴露 `validateWordlist`，
 * 否则 import 会导致进程真的去校验并 `process.exit()`。
 */
const invokedDirectly =
  typeof process.argv[1] === 'string' && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  await main();
}
