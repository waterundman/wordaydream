#!/usr/bin/env node
/**
 * v1.6.0 Stage 1 (S1) + v1.6.2 (R1-R5) + v1.6.4 Stage 2 (S2): 词表数据契约与质量闸门
 *
 * 校验对象:
 *   1. src/data/wordlists/{en,de}/{a1,a2,b1,b2}.json — JSON Schema 契约
 *   2. src/data/courses/{en,de}.ts — 课程 Lesson targetLemmas 必须落在对应等级词表内
 *
 * 契约 (见 docs/spec/v1.6.0/main.md §4.1 / §16.2 与 src/data/wordlists/index.ts):
 *   - 顶层: language / level / difficulty / version / total / words
 *   - total === words.length
 *   - 每条: lemma 非空且 ≤100 字符; pos 非空; translation 非空; cefr ∈ {A1..B2} 且与 level 一致
 *   - 等级内 lemma 不重复 (en 强制; de 同形异义记 warning)
 *   - v2 (英语必须): priority ∈ {1,2,3}; topic 非空; frequency ∈ {1..5}
 *   - semanticConflicts: 字符串数组, 每一项必须存在于同一等级词表中, 且双向标注
 *   v1.6.2 例句字段 (R1-R5):
 *       R1  example / exampleTranslation 同时存在或同时缺失; exampleSource 不得孤立存在
 *       R2  存在时非空 (trim 后)
 *       R3  example 须含 lemma 的某个可接受词形 (**弱校验/下界**, 见 scripts/lib/lemmaForms.mjs)
 *       R4  exampleTranslation 须含 CJK 字符
 *       R5  exampleSource 须形如 "<source>:<id>"
 *
 * v1.6.4 Stage 2 (S2): 质量闸门 N1-N9 (把 R1-R5 的"字段级契约"扩到"数据质量级", SPEC §3 S2):
 *   N1  例句覆盖率下限        每文件 >=80%, priority=1 >=95%
 *   N2  translation 非空 + 含 CJK + trim 一致
 *   N3  跨等级重复 lemma (同语言)
 *   N4  同等级同 pos 重复条目 (未声明的; 已用 semanticConflicts 声明的同形异义不计)
 *   N5  例句跨词复用 (同句被 >=2 词引用)
 *   N6  弱命中率 (matchTier >= 2: 仅词干/派生/兜底)   占比 <= 10% (SPEC S3 验收口径)
 *   N7  exampleSource = `unknown:*` 占比 <= 20% + 例句缺出处 = 0
 *   N8  courses/*.ts 纳入校验 (en + de, 原先只覆盖 en)
 *   N9  courses 跨模块 targetLemma 重复
 *
 * ── 豁免机制 (N1-N9 共用, 关键设计) ───────────────────────────────────────
 * 「豁免」不是「放过」。清单项必须带 (a) 书面理由 (b) 复算基线 (ratchet)。
 *   在清单内 且 计数 <= 基线 → 打印 **EXEMPT 行 (含理由与基线)**, 不阻断
 *   不在清单 且 未达标     → 阻断 exit 1   (防止未来新增静默缺口)
 *   在清单内 但 计数 > 基线 → 阻断 exit 1   (防止既有缺口扩大)
 *   在清单内 但 已达标     → 打印「豁免已达标, 可移除」提示 (S3 回填成功后删除对应条目)
 * 判定逻辑抽成纯函数 `evaluateGate`, 单测可直接构造「正例/反例」。
 *
 * 退出码: 0 = 全部通过 (允许存在**已显式豁免**的缺口); 1 = 存在违规
 *
 * 用法: node scripts/verify-wordlists.mjs    (或 npm run verify:wordlists)
 *
 * 单测可 import `validateWordlist` 与 N1-N9 纯函数 (checkN1Coverage / checkN2Translations / ...)
 * 并注入自己的收集器 (被直接执行时才跑 main, 见文件末尾)。
 *
 * 0 emoji (项目硬约束): 输出用纯文本 (PASS / EXEMPT / BLOCK), 不引入 emoji。
 */
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// v1.6.2 Stage 1: 例句弱校验 (R3) 的词形逻辑必须与生成器**共用同一实现**, 否则必然漂移.
// v1.6.4 S2 (N6): `matchTier` 供弱命中率闸门使用 (由 `_matchTier` 恢复为正式使用).
import { containsLemma, matchTier } from './lib/lemmaForms.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WL_BASE = join(projectRoot, 'src', 'data', 'wordlists');

/**
 * v1.6.4 S2 (N8): courses 校验范围 —— 由单文件 `COURSES_EN` 扩为全清单 (en + de)。
 * `language` 是课程的**目标语言** (targetLanguage), 用于把 moduleId 的等级段映射到对应词表。
 */
const COURSES = [
  { file: join(projectRoot, 'src', 'data', 'courses', 'en.ts'), label: 'courses/en.ts', language: 'en' },
  { file: join(projectRoot, 'src', 'data', 'courses', 'de.ts'), label: 'courses/de.ts', language: 'de' },
];

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

// ---------------------------------------------------------------- v1.6.4 S2 阈值与豁免

/** N1: 例句覆盖率下限 (每文件) / priority=1 覆盖率下限 */
export const N1_COVERAGE_MIN = 0.8;
export const N1_P1_COVERAGE_MIN = 0.95;
/** N6: 弱命中 (matchTier>=2) 占比上限 (SPEC S3 验收口径) */
export const N6_WEAK_RATIO_MAX = 0.1;
/** N7: `unknown:*` 出处占比上限 (SPEC 未给死值; 取 20% 为默认硬闸, de/a1 100% 已显式豁免) */
export const N7_UNKNOWN_RATIO_MAX = 0.2;
/**
 * N8: 每个 Lesson 的 targetLemmas 固定词数 (课程编排契约, 见 src/data/courses/*.ts buildLesson)。
 * 导出常量而非内联字面量: 单测需要构造合规 fixture, 否则测试会被这条隐式契约误判为违规。
 */
export const LESSON_LEMMA_COUNT = 15;

/**
 * v1.6.4 S2: N1-N9 豁免清单 (显式 / 可审计 / 带 ratchet 基线)。
 *
 * 语义: `baseline` = 允许的最大违规计数 (由本轮实测得出)。计数 > 基线 → 阻断 (防缺口扩大);
 *       达标 → 打印「豁免可移除」(S3 例句回填成功后删除对应条目)。
 * 口径: 全部为 SPEC §3 S2 显式裁定或既有数据特征, 逐条带书面理由 —— 没有静默通过。
 */
export const EXEMPTIONS = [
  // N1: de A2/B1/B2 例句覆盖率 0% (3366 条, SPEC §3 S2 基线) —— 待 S3 例句回填
  { check: 'N1', scope: 'de/a2.json', baseline: 797, baselineP1: 59, reason: '待 S3 例句回填: 该文件零例句语料 (覆盖率 0%)' },
  { check: 'N1', scope: 'de/b1.json', baseline: 1000, baselineP1: 67, reason: '待 S3 例句回填: 该文件零例句语料 (覆盖率 0%)' },
  { check: 'N1', scope: 'de/b2.json', baseline: 1569, baselineP1: 315, reason: '待 S3 例句回填: 该文件零例句语料 (覆盖率 0%)' },
  // N3: en 跨等级共享高频词 719 条 —— 分级词表既有设计
  { check: 'N3', scope: 'en', baseline: 719, reason: '跨等级共享高频词 (result/good/high/...), 属分级词表既有设计; 消除需全量重分级' },
  // N5: 例句跨词复用 —— 语料 join 固有现象 (SPEC §3 S2 基线 583 组; 本轮 de/a1 去重后 582 组)
  { check: 'N5', scope: 'global', baseline: 582, reason: '高频短句被相关词条共享 (一句含多词), 属语料 join 固有现象; S3 回填后按新基数复查' },
  // N6: de/a1 弱命中占比 15.6% > 10% —— S3 只覆盖 A2/B1/B2
  { check: 'N6', scope: 'de/a1.json', baseline: 100, reason: '既有 a1 词干兜底命中 (占比 15.6% > 10%); S3 只回填 A2/B1/B2, 此缺口待例句层整体轮换' },
  // N7: de/a1 出处 100% 为 unknown:de-a1 —— 来源不可考, 不伪造 id (v1.6.2 裁定; SPEC §3 S2 基线 645 条, 本轮 de/a1 去重后 642 条)
  { check: 'N7', scope: 'de/a1.json', baseline: 642, reason: 'de/a1 例句出处不可考 (v1.6.2 记 unknown:de-a1, 不伪造 tatoeba id); S3 探针若可行则统一替换' },
  // N9: en 课程跨模块共享词 11 个 —— 课程编排既有设计
  { check: 'N9', scope: 'en', baseline: 11, reason: '跨等级共享课程词 (film/fish/photograph/...), 属课程编排既有设计; 消除需课程重构' },
];

/**
 * 已知数据缺口 (非豁免、非阻断, 仅如实列出) 的**根因说明**。
 *
 * 缺口的**清单不写在这里**: 由 `collectPriority1Gaps` 从当前 8 个词表现算,
 * 否则 S3 回填后这份快照会继续宣称"缺 13 条"——报告与数据脱钩即静默失效。
 * 实测: 固定语料包 (tatoeba 中英 0.20260520.0) 对这些词零候选 (collectCandidates = 0),
 * 在不伪造 `tatoeba:<id>` 的前提下无法补齐。
 */
export const PENDING_BACKFILL_REASON =
  '缺例句且 priority=1; 固定语料包 (tatoeba 中英 0.20260520.0) 对这些词零候选, 补齐需新语料源 (同 S3 探针)';

// ---------------------------------------------------------------- R1-R5 契约

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

// ---------------------------------------------------------------- N1-N9 纯函数 (可单测)

/** 有例句 (存在且 trim 后非空) */
const hasExample = (w) => typeof w.example === 'string' && w.example.trim() !== '';

/** N1: 例句覆盖率 (全量 / priority=1) */
export function checkN1Coverage(words) {
  const total = words.length;
  const ex = words.filter(hasExample).length;
  const p1 = words.filter((w) => w.priority === 1);
  const p1Ex = p1.filter(hasExample).length;
  return {
    total,
    ex,
    uncovered: total - ex,
    coverage: total ? ex / total : 0,
    p1Total: p1.length,
    p1Ex,
    p1Uncovered: p1.length - p1Ex,
    p1Coverage: p1.length ? p1Ex / p1.length : 0,
  };
}

/**
 * N1 附属: priority=1 且缺例句的词条清单 (按等级分组)。
 * 由数据**现算**而非硬编码快照 —— 硬编码会在 S3 回填后变成一句谎话 (缺口已补却仍被列出),
 * 而这类"报告与数据脱钩"正是本轮要消除的静默失效。
 * @param {Array<{key:string, words:Array}>} levelWordArrays
 * @returns {Array<{key:string, lemmas:string[]}>} 只含存在缺口的等级
 */
export function collectPriority1Gaps(levelWordArrays) {
  const out = [];
  for (const { key, words } of levelWordArrays) {
    const lemmas = words.filter((w) => w.priority === 1 && !hasExample(w)).map((w) => w.lemma);
    if (lemmas.length > 0) out.push({ key, lemmas });
  }
  return out;
}

/** N2: translation 非空 + 含 CJK + trim 一致 */
export function checkN2Translations(words) {
  let blank = 0;
  let noCjk = 0;
  let untrimmed = 0;
  for (const w of words) {
    if (typeof w.translation !== 'string' || w.translation.trim() === '') {
      blank++;
      continue;
    }
    if (!/[\u4e00-\u9fff]/.test(w.translation)) noCjk++;
    if (w.translation !== w.translation.trim()) untrimmed++;
  }
  return { blank, noCjk, untrimmed, total: blank + noCjk + untrimmed };
}

/**
 * N3: 跨等级重复 lemma (同语言).
 * @param {Array<{key:string, words:Array}>} levelWordArrays
 */
export function checkN3CrossLevelDuplicates(levelWordArrays) {
  const map = new Map();
  for (const { key, words } of levelWordArrays) {
    for (const w of words) {
      const k = String(w.lemma).toLowerCase();
      if (!map.has(k)) map.set(k, new Set());
      map.get(k).add(key);
    }
  }
  const groups = [...map.entries()].filter(([, v]) => v.size >= 2);
  return {
    lemmaCount: groups.length,
    entryCount: groups.reduce((a, [, v]) => a + v.size, 0),
    groups: groups.map(([lemma, levels]) => ({ lemma, levels: [...levels] })),
  };
}

/** N4: 同等级同 pos 重复条目 (未声明的; 以自指 semanticConflicts 声明的同形异义不计) */
export function checkN4SameLevelSamePosDuplicates(words) {
  const map = new Map();
  words.forEach((w, i) => {
    const k = `${String(w.lemma).toLowerCase()}|${w.pos}`;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(i);
  });
  const undeclared = [];
  for (const [key, idxs] of map) {
    if (idxs.length < 2) continue;
    const lemma = key.split('|')[0];
    const declared = idxs.every((i) => (words[i].semanticConflicts ?? []).some((s) => s.toLowerCase() === lemma));
    if (!declared) undeclared.push({ key, idxs });
  }
  return { count: undeclared.length, groups: undeclared };
}

/**
 * N5: 例句跨词复用 (同句被 >=2 词引用).
 * @param {Array<{key:string, words:Array}>} levelWordArrays
 */
export function checkN5ExampleReuse(levelWordArrays) {
  const map = new Map();
  for (const { key, words } of levelWordArrays) {
    for (const w of words) {
      if (!hasExample(w)) continue;
      const k = w.example.trim();
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(`${key}:${w.lemma}`);
    }
  }
  const groups = [...map.entries()].filter(([, v]) => v.length >= 2);
  return { groups: groups.length, distinctExamples: map.size };
}

/** N6: 弱命中率 (matchTier >= 2: 仅词干/派生/兜底) */
export function checkN6WeakHits(words) {
  let weak = 0;
  let total = 0;
  for (const w of words) {
    if (!hasExample(w)) continue;
    total++;
    if (matchTier(String(w.lemma ?? ''), w.example) >= 2) weak++;
  }
  return { weak, total, ratio: total ? weak / total : 0 };
}

/** N7: exampleSource = `unknown:*` 占比 + 例句缺出处 */
export function checkN7UnknownSources(words) {
  let unknown = 0;
  let withExample = 0;
  let missingSource = 0;
  for (const w of words) {
    if (!hasExample(w)) continue;
    withExample++;
    if (typeof w.exampleSource !== 'string' || w.exampleSource === '') missingSource++;
    else if (w.exampleSource.startsWith('unknown')) unknown++;
  }
  return { unknown, withExample, missingSource, ratio: withExample ? unknown / withExample : 0 };
}

/** 解析 courses/*.ts 中每个 Lesson 的 (moduleId, order, title, theme, targetLemmas) */
export function parseCourseLessons(src) {
  const out = [];
  const re = /buildLesson\(\s*'([^']+)'\s*,\s*(\d+)\s*,\s*'((?:[^'\\]|\\.)*)'\s*,\s*'((?:[^'\\]|\\.)*)'\s*,\s*\[([\s\S]*?)\]\s*,?\s*\)/g;
  let m;
  while ((m = re.exec(src))) {
    out.push({
      moduleId: m[1],
      order: Number(m[2]),
      title: m[3],
      theme: m[4],
      lemmas: (m[5].match(/'([^']+)'/g) ?? []).map((s) => s.slice(1, -1)),
    });
  }
  return out;
}

/**
 * N8: 课程 ↔ 词表一致性 (每 Lesson 恰 LESSON_LEMMA_COUNT 词 / targetLemmas 落在对应等级词表内 / 等级内 Lesson 间不重复).
 * @param {Array<{moduleId:string,title:string,lemmas:string[]}>} lessons
 * @param {Map<string,Set<string>>} levelLemmas key = `${levelKey}`
 */
export function checkN8CourseMembership(lessons, levelLemmas) {
  const missing = [];
  const perLevelDups = [];
  let badModule = 0;
  let badLen = 0;
  const usedPerLevel = new Map();
  for (const l of lessons) {
    const lvKey = l.moduleId.split('-')[1];
    const present = levelLemmas.get(lvKey);
    if (!present) {
      badModule++;
      continue;
    }
    if (l.lemmas.length !== LESSON_LEMMA_COUNT) badLen++;
    for (const lemma of l.lemmas) {
      if (!present.has(String(lemma).toLowerCase())) missing.push(`${l.title}:${lemma}`);
    }
    const used = usedPerLevel.get(lvKey) ?? { seen: new Set(), dups: [] };
    for (const lemma of l.lemmas) {
      const k = String(lemma).toLowerCase();
      if (used.seen.has(k)) used.dups.push(k);
      used.seen.add(k);
    }
    usedPerLevel.set(lvKey, used);
  }
  for (const used of usedPerLevel.values()) {
    if (used.dups.length > 0) perLevelDups.push(...[...new Set(used.dups)]);
  }
  return {
    lessonCount: lessons.length,
    badModule,
    badLen,
    missing,
    perLevelDups,
    violationCount: badModule + badLen + missing.length + perLevelDups.length,
  };
}

/** N9: courses 跨模块 (跨等级) targetLemma 重复 —— 同一 lemma 出现在 >=2 个 module 等级段 */
export function checkN9CrossModuleDuplicates(lessons) {
  const map = new Map();
  for (const l of lessons) {
    const lvKey = l.moduleId.split('-')[1];
    for (const lemma of l.lemmas) {
      const k = String(lemma).toLowerCase();
      if (!map.has(k)) map.set(k, new Set());
      map.get(k).add(lvKey);
    }
  }
  const dups = [...map.entries()]
    .filter(([, v]) => v.size >= 2)
    .map(([lemma]) => lemma)
    .sort();
  return { count: dups.length, dups };
}

/**
 * 闸门判定 (纯函数, 可单测). 三态语义:
 *   PASS   —— 达标 (豁免项若已达标, 打印「可移除」提示)
 *   EXEMPT —— 未达标但在豁免清单内且计数 <= 基线 (不阻断, 必须打印理由与基线)
 *   BLOCK  —— 未达标且 (无豁免 或 计数 > 基线) → 阻断 exit 1
 *
 * @param {{check:string, scope:string, ok:boolean, violations:number, violationsP1?:number,
 *          exempt?:{baseline:number, baselineP1?:number, reason:string}}} row
 * @returns {{status:'PASS'|'EXEMPT'|'BLOCK', blocking:boolean, detail:string}}
 */
export function evaluateGate(row) {
  const { ok, violations, violationsP1, exempt } = row;
  if (ok) {
    if (exempt) return { status: 'PASS', blocking: false, detail: '豁免项已达标, 可移除该豁免' };
    return { status: 'PASS', blocking: false, detail: '' };
  }
  if (!exempt) {
    return { status: 'BLOCK', blocking: true, detail: `未达标 (${violations}) 且不在豁免清单内` };
  }
  const overBase = violations > exempt.baseline;
  const overBaseP1 =
    violationsP1 !== undefined && exempt.baselineP1 !== undefined && violationsP1 > exempt.baselineP1;
  if (overBase || overBaseP1) {
    const detail = overBaseP1
      ? `豁免缺口扩大: ${violations} > 基线 ${exempt.baseline} / p1 ${violationsP1} > 基线 ${exempt.baselineP1}`
      : `豁免缺口扩大: ${violations} > 基线 ${exempt.baseline}`;
    return { status: 'BLOCK', blocking: true, detail };
  }
  const base = exempt.baselineP1 !== undefined ? `${exempt.baseline} (p1 ${exempt.baselineP1})` : `${exempt.baseline}`;
  return { status: 'EXEMPT', blocking: false, detail: `基线 ${base}; 原因: ${exempt.reason}` };
}

// ---------------------------------------------------------------- main

const pct = (x) => `${(x * 100).toFixed(1)}%`;
const findExempt = (check, scope) => EXEMPTIONS.find((x) => x.check === check && x.scope === scope);

async function main() {
  const levelLemmas = new Map(); // `${language}:${key}` -> Set
  const allWords = {}; // `${language}:${key}` -> words[]

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
      levelLemmas.set(`${language}:${lv.key}`, lemmas);
      allWords[`${language}:${lv.key}`] = data.words;
      console.log(`  ${language}/${lv.key}.json  words=${data.words.length}  version=${data.version}`);
    }
  }

  console.log('\n--- N1-N9 质量闸门 (v1.6.4 S2; 阈值与豁免见 SPEC §3 S2) ---');
  const rows = [];
  /** 记录一行闸门结果; 阻断项同时写入 errors (供统一 exit 1) */
  const record = (row) => {
    const verdict = evaluateGate(row);
    rows.push({ ...row, verdict });
    if (verdict.blocking) fail(`[${row.check}] ${row.scope}: ${verdict.detail}`);
    return verdict;
  };
  const tail = (v) => `  ${v.status}${v.detail ? ` (${v.detail})` : ''}`;

  // N1 例句覆盖率下限
  console.log('[N1] 例句覆盖率 (每文件 >=80%, priority=1 >=95%)');
  for (const language of ['en', 'de']) {
    for (const lv of LEVELS) {
      const scope = `${language}/${lv.key}.json`;
      const r = checkN1Coverage(allWords[`${language}:${lv.key}`]);
      const v = record({
        check: 'N1',
        scope,
        ok: r.coverage >= N1_COVERAGE_MIN && r.p1Coverage >= N1_P1_COVERAGE_MIN,
        violations: r.uncovered,
        violationsP1: r.p1Uncovered,
        exempt: findExempt('N1', scope),
      });
      console.log(
        `  ${scope}  coverage=${pct(r.coverage)} (${r.ex}/${r.total})  p1=${pct(r.p1Coverage)} (${r.p1Ex}/${r.p1Total})${tail(v)}`
      );
    }
  }

  // N2 translation 质量
  console.log('[N2] translation 非空 + 含 CJK + trim 一致');
  for (const language of ['en', 'de']) {
    for (const lv of LEVELS) {
      const scope = `${language}/${lv.key}.json`;
      const r = checkN2Translations(allWords[`${language}:${lv.key}`]);
      const v = record({ check: 'N2', scope, ok: r.total === 0, violations: r.total, exempt: findExempt('N2', scope) });
      console.log(`  ${scope}  blank=${r.blank}  noCjk=${r.noCjk}  untrimmed=${r.untrimmed}${tail(v)}`);
    }
  }

  // N3 跨等级重复 lemma
  console.log('[N3] 跨等级重复 lemma (同语言)');
  for (const language of ['en', 'de']) {
    const r = checkN3CrossLevelDuplicates(
      LEVELS.map((lv) => ({ key: lv.key, words: allWords[`${language}:${lv.key}`] }))
    );
    const v = record({
      check: 'N3',
      scope: language,
      ok: r.entryCount === 0,
      violations: r.entryCount,
      exempt: findExempt('N3', language),
    });
    console.log(`  ${language}  lemma=${r.lemmaCount}  entries=${r.entryCount}${tail(v)}`);
  }

  // N4 同等级同 pos 重复条目
  console.log('[N4] 同等级同 pos 重复条目 (未声明的)');
  for (const language of ['en', 'de']) {
    for (const lv of LEVELS) {
      const scope = `${language}/${lv.key}.json`;
      const r = checkN4SameLevelSamePosDuplicates(allWords[`${language}:${lv.key}`]);
      const v = record({ check: 'N4', scope, ok: r.count === 0, violations: r.count, exempt: findExempt('N4', scope) });
      console.log(
        `  ${scope}  undeclared=${r.count}${r.count ? ` (${r.groups.map((g) => g.key).join(', ')})` : ''}${tail(v)}`
      );
    }
  }

  // 全量等级数组: N5 (例句复用) 与 N1 缺口清单 (collectPriority1Gaps) 共用同一份, 口径不可能漂移
  const levelWordArrays = [];
  for (const language of ['en', 'de']) {
    for (const lv of LEVELS) levelWordArrays.push({ key: `${language}:${lv.key}`, words: allWords[`${language}:${lv.key}`] });
  }

  // N5 例句跨词复用
  console.log('[N5] 例句跨词复用 (同句被 >=2 词引用)');
  {
    const r = checkN5ExampleReuse(levelWordArrays);
    const v = record({
      check: 'N5',
      scope: 'global',
      ok: r.groups === 0,
      violations: r.groups,
      exempt: findExempt('N5', 'global'),
    });
    console.log(`  global  groups=${r.groups}  distinctExamples=${r.distinctExamples}${tail(v)}`);
  }

  // N6 弱命中率
  console.log(`[N6] 弱命中率 (matchTier>=2, 占比 <= ${pct(N6_WEAK_RATIO_MAX)})`);
  for (const language of ['en', 'de']) {
    for (const lv of LEVELS) {
      const scope = `${language}/${lv.key}.json`;
      const r = checkN6WeakHits(allWords[`${language}:${lv.key}`]);
      const v = record({
        check: 'N6',
        scope,
        ok: r.total === 0 || r.ratio <= N6_WEAK_RATIO_MAX,
        violations: r.weak,
        exempt: findExempt('N6', scope),
      });
      console.log(`  ${scope}  weak=${r.weak}/${r.total} (${pct(r.ratio)})${tail(v)}`);
    }
  }

  // N7 出处可信度
  console.log(`[N7] exampleSource=unknown:* 占比 (<= ${pct(N7_UNKNOWN_RATIO_MAX)}; 缺出处 = 0)`);
  for (const language of ['en', 'de']) {
    for (const lv of LEVELS) {
      const scope = `${language}/${lv.key}.json`;
      const r = checkN7UnknownSources(allWords[`${language}:${lv.key}`]);
      const v = record({
        check: 'N7',
        scope,
        ok: r.missingSource === 0 && r.ratio <= N7_UNKNOWN_RATIO_MAX,
        violations: r.unknown,
        exempt: findExempt('N7', scope),
      });
      console.log(
        `  ${scope}  unknown=${r.unknown}/${r.withExample} (${pct(r.ratio)})  missingSource=${r.missingSource}${tail(v)}`
      );
    }
  }

  // N8 + N9 课程
  const lessonsByLang = {};
  console.log('[N8] 课程 ↔ 词表一致性 (courses/en.ts + courses/de.ts)');
  for (const c of COURSES) {
    const src = await readFile(c.file, 'utf8');
    const lessons = parseCourseLessons(src);
    lessonsByLang[c.language] = lessons;
    const lvMap = new Map(LEVELS.map((lv) => [lv.key, levelLemmas.get(`${c.language}:${lv.key}`)]));
    const r = checkN8CourseMembership(lessons, lvMap);
    const v = record({
      check: 'N8',
      scope: c.label,
      ok: lessons.length > 0 && r.violationCount === 0,
      violations: lessons.length === 0 ? 1 : r.violationCount,
      exempt: findExempt('N8', c.label),
    });
    if (lessons.length === 0) {
      console.log(`  ${c.label}  lessons=0${tail(v)}`);
    } else {
      console.log(
        `  ${c.label}  lessons=${r.lessonCount}  badModule=${r.badModule}  badLen=${r.badLen}  outOfList=${r.missing.length}  dupInLevel=${r.perLevelDups.length}${tail(v)}`
      );
      for (const m of r.missing.slice(0, 10)) fail(`${c.label}: targetLemmas 含对应等级词表外的词 "${m}"`);
      for (const d of r.perLevelDups.slice(0, 10)) fail(`${c.label}: 等级内 Lesson 间 targetLemmas 重复 ("${d}")`);
    }
  }

  console.log('[N9] courses 跨模块 targetLemma 重复');
  for (const language of ['en', 'de']) {
    const r = checkN9CrossModuleDuplicates(lessonsByLang[language] ?? []);
    const v = record({
      check: 'N9',
      scope: language,
      ok: r.count === 0,
      violations: r.count,
      exempt: findExempt('N9', language),
    });
    console.log(`  ${language}  count=${r.count}${r.count ? ` (${r.dups.join(', ')})` : ''}${tail(v)}`);
  }

  // --- 豁免清单 (显式列出, 不静默) ---
  const exempted = rows.filter((r) => r.verdict.status === 'EXEMPT');
  console.log(`\n--- 豁免清单 (${exempted.length} 项, 全部带理由与 ratchet 基线) ---`);
  for (const r of exempted) console.log(`  [${r.check}] ${r.scope}: ${r.verdict.detail}`);
  const stale = rows.filter((r) => r.verdict.status === 'PASS' && r.verdict.detail);
  if (stale.length > 0) {
    console.log(`--- 可移除的豁免 (${stale.length} 项, 数据已达标) ---`);
    for (const r of stale) console.log(`  [${r.check}] ${r.scope}`);
  }
  console.log('--- 已知数据缺口 (非阻断, 如实列出) ---');
  const gaps = collectPriority1Gaps(levelWordArrays);
  const gapTotal = gaps.reduce((n, g) => n + g.lemmas.length, 0);
  if (gapTotal === 0) {
    console.log('  priority=1 缺例句: 0 条 (全部达标)');
  } else {
    console.log(`  priority=1 且缺例句: ${gapTotal} 条 (现算自 8 个词表; 全量清单可由 collectPriority1Gaps 复算)`);
    for (const g of gaps) {
      const head = g.lemmas.slice(0, 8).join(', ');
      const more = g.lemmas.length > 8 ? ` 等 ${g.lemmas.length} 条` : '';
      console.log(`    ${g.key}: ${g.lemmas.length} 条 —— ${head}${more}`);
    }
    console.log(`    原因: ${PENDING_BACKFILL_REASON}`);
  }

  // --- 汇总 ---
  const passCount = rows.filter((r) => r.verdict.status === 'PASS').length;
  const blockCount = rows.filter((r) => r.verdict.status === 'BLOCK').length;
  console.log(`\n--- 闸门汇总: PASS ${passCount} / EXEMPT ${exempted.length} / BLOCK ${blockCount} (共 ${rows.length} 项) ---`);

  if (warnings.length > 0) {
    console.warn(`\n⚠ ${warnings.length} 处提示 (不阻断):`);
    for (const w of warnings.slice(0, 20)) console.warn(`  - ${w}`);
    if (warnings.length > 20) console.warn(`  ... 另有 ${warnings.length - 20} 处`);
  }

  if (errors.length > 0) {
    console.error(`\n✗ 词表校验失败 (含 N1-N9 闸门), 共 ${errors.length} 处:`);
    for (const e of errors.slice(0, 40)) console.error(`  - ${e}`);
    if (errors.length > 40) console.error(`  ... 另有 ${errors.length - 40} 处`);
    process.exit(1);
  }
  console.log('\n✓ 词表契约校验通过 (R1-R5 + N1-N9; 未达标项仅为上方显式豁免)');
}

/**
 * 只有**直接执行本文件**时才跑 main()；被 `import`（单测）时只暴露纯函数，
 * 否则 import 会导致进程真的去校验并 `process.exit()`。
 */
const invokedDirectly =
  typeof process.argv[1] === 'string' && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  await main();
}