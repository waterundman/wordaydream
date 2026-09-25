#!/usr/bin/env node
/**
 * v1.6.0 Stage 1 (S1): 英语课程 Lesson 词表重建
 *
 * 背景: src/data/courses/en.ts 的 targetLemmas 原本是从旧 80 词占位词表切片
 *       ("每 level 80 词, 取前 75"), v1.6.0 替换为真实 CEFR 词表后已脱节 —
 *       19/20 个 Lesson 含该等级词表之外的词, 违背 "词表驱动的课程" 设计.
 *
 * 本脚本按新词表重建每个 Lesson 的 15 个 targetLemmas:
 *   - 保持 lesson 的 moduleId / order / title / theme 不变 (id 由 theme 派生, 保证既有用户进度不失效)
 *   - 每个 Lesson 按自身 theme 优选主题簇内的词 (topic 字段), 不足则按词表顺序补足
 *   - 同等级内 5 个 Lesson 的词互不重复; 排除多词词形 (避免 passage 命中率校验失真)
 *
 * 用法: node scripts/generate-en-courses.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';

const EN_TS = path.resolve('src/data/courses/en.ts');
const WL_DIR = path.resolve('src/data/wordlists/en');
const WRITE = process.argv.includes('--write');

const LEVELS = ['a1', 'a2', 'b1', 'b2'];

// 每个 Lesson 的主题优选池 (按先后顺序优先取词; topic 取值见词表 topic 字段)
const LESSON_TOPICS = {
  a1: [
    ['sport', 'leisure', 'nature', 'movement', 'greeting'],
    ['family', 'food', 'house'],
    ['animal', 'body', 'house'],
    ['school', 'time', 'communication', 'thinking'],
    ['relationship', 'leisure', 'emotion', 'greeting'],
  ],
  a2: [
    ['shopping', 'food', 'quantity'],
    ['work', 'technology', 'business', 'time'],
    ['communication', 'relationship', 'greeting', 'emotion'],
    ['transport', 'movement', 'city', 'time'],
    ['food', 'leisure', 'emotion', 'thinking'],
  ],
  b1: [
    ['society', 'business', 'communication'],
    ['emotion', 'thinking', 'relationship'],
    ['travel', 'transport', 'city', 'nature'],
    ['work', 'business', 'communication', 'technology'],
    ['society', 'art', 'travel', 'academic'],
  ],
  b2: [
    ['society', 'business', 'quantity'],
    ['thinking', 'emotion', 'academic'],
    ['science', 'health', 'technology'],
    ['thinking', 'time', 'quantity', 'movement'],
    ['art', 'academic', 'emotion'],
  ],
};

const LESSON_WORDS = 15;

/** 解析现有 en.ts 中每个 level 的 buildLesson 元数据 (moduleId/order/title/theme) */
function parseLessons(src, level) {
  const blockRe = new RegExp(`const en${level.toUpperCase()}Lessons: Lesson\\[\\] = \\[([\\s\\S]*?)\\n\\];`);
  const block = blockRe.exec(src);
  if (!block) throw new Error(`未找到 en${level.toUpperCase()}Lessons 块`);
  const callRe = /buildLesson\(\s*'([^']+)'\s*,\s*(\d+)\s*,\s*'((?:[^'\\]|\\.)*)'\s*,\s*'((?:[^'\\]|\\.)*)'\s*,\s*\[[\s\S]*?\]\s*,?\s*\)/g;
  const out = [];
  let m;
  while ((m = callRe.exec(block[1]))) {
    out.push({ moduleId: m[1], order: Number(m[2]), title: m[3], theme: m[4] });
  }
  return out;
}

/**
 * 为一个 Lesson 选词: 严格按 preferTopics 先后顺序取 (前一个主题取尽再取下一个),
 * 仍不足则按词表顺序补足; 保证同级 Lesson 间不重复.
 */
function selectLemmas(words, preferTopics, used, n) {
  const picked = [];
  const localSeen = new Set();
  const ok = (w) => !/\s/.test(w.lemma) && !used.has(w.lemma.toLowerCase()) && !localSeen.has(w.lemma.toLowerCase());
  const take = (w) => { picked.push(w.lemma); localSeen.add(w.lemma.toLowerCase()); used.add(w.lemma.toLowerCase()); };
  for (const topic of preferTopics) {
    if (picked.length >= n) break;
    for (const w of words) { if (picked.length >= n) break; if (ok(w) && w.topic === topic) take(w); }
  }
  for (const w of words) { if (picked.length >= n) break; if (ok(w)) take(w); }
  return picked;
}

const src = fs.readFileSync(EN_TS, 'utf8');
const wordlists = {};
for (const lv of LEVELS) wordlists[lv] = JSON.parse(fs.readFileSync(path.join(WL_DIR, `${lv}.json`), 'utf8'));

const rebuilt = {};
for (const lv of LEVELS) {
  const lessons = parseLessons(src, lv);
  if (lessons.length !== LESSON_TOPICS[lv].length) {
    throw new Error(`${lv}: 现有 Lesson 数 ${lessons.length} 与主题池数 ${LESSON_TOPICS[lv].length} 不匹配`);
  }
  const used = new Set();
  rebuilt[lv] = lessons.map((l, i) => ({
    ...l,
    lemmas: selectLemmas(wordlists[lv].words, LESSON_TOPICS[lv][i], used, LESSON_WORDS),
  }));
}

// 校验: 全部命中词表 + 同级不重复
let errors = 0;
for (const lv of LEVELS) {
  const present = new Set(wordlists[lv].words.map((w) => w.lemma.toLowerCase()));
  const all = [];
  for (const l of rebuilt[lv]) {
    for (const lemma of l.lemmas) {
      if (!present.has(lemma.toLowerCase())) { console.error(`✗ ${lv} "${l.title}": ${lemma} 不在词表`); errors++; }
      all.push(lemma.toLowerCase());
    }
    if (l.lemmas.length !== LESSON_WORDS) { console.error(`✗ ${lv} "${l.title}": 仅 ${l.lemmas.length} 词`); errors++; }
  }
  if (new Set(all).size !== all.length) { console.error(`✗ ${lv}: 同级 Lesson 间词重复`); errors++; }
}
if (errors > 0) { console.error(`校验失败 (${errors} 处), 未写入`); process.exit(1); }

// 重写各 Lesson 块
let out = src;
for (const lv of LEVELS) {
  const blockRe = new RegExp(`(const en${lv.toUpperCase()}Lessons: Lesson\\[\\] = \\[)[\\s\\S]*?(\\n\\];)`);
  const body = rebuilt[lv].map((l) => {
    const lines = [];
    for (let i = 0; i < l.lemmas.length; i += 10) {
      lines.push(`    ${l.lemmas.slice(i, i + 10).map((w) => `'${w}'`).join(', ')},`);
    }
    return `  buildLesson('${l.moduleId}', ${l.order}, '${l.title}', '${l.theme}', [\n${lines.join('\n')}\n  ]),`;
  }).join('\n');
  out = out.replace(blockRe, `$1\n${body}$2`);
}

// 更新头部与各 Module 的注释 (措辞与实现对齐)
out = out
  .replace(
    / \* - targetLemmas 从 src\/data\/wordlists\/en\/\{level\}\.json 切片 \(每 level 80 词, 取前 75\)/,
    ' * - targetLemmas 按 Lesson 主题优选自 src/data/wordlists/en/{level}.json (每 Lesson 15 词, 同级不重复)'
  )
  .replace(/\/\/ lemma 来源: en\/(\w+)\.json 前 75 词/g, '// lemma 来源: 按主题优选自 en/$1.json (15 词)');

if (WRITE) {
  fs.writeFileSync(EN_TS, out, 'utf8');
  console.log(`written ${EN_TS}`);
  for (const lv of LEVELS) {
    const n = rebuilt[lv].reduce((s, l) => s + l.lemmas.length, 0);
    console.log(` ${lv.toUpperCase()}: ${rebuilt[lv].length} Lesson / ${n} 词`);
    for (const l of rebuilt[lv]) console.log(`   #${l.order} ${l.title}: ${l.lemmas.join(' ')}`);
  }
} else {
  console.log('[dry-run] 校验通过; 加 --write 写入');
  for (const lv of LEVELS) for (const l of rebuilt[lv]) console.log(` ${lv} #${l.order} ${l.title}: ${l.lemmas.join(' ')}`);
}
