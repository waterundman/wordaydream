#!/usr/bin/env node
/**
 * v1.6.2 Stage 2 (S2-2): 激活 de/a1 的 645 条既有例句 (死数据 → 受契约保护的数据)
 *
 * 背景: `de/a1.json` 的 645 条例句在 v1.6.2 之前既不被 `WordlistEntry` 承认、
 *       也无消费方、也无校验保护 —— 生成脚本一旦重跑就静默丢失 (v1.6.2 SPEC §3 P0-1)。
 *       本脚本把它们纳入契约:
 *         1. 补 `exampleSource` (provenance) —— CC-BY 类语料的署名是许可条件 (SPEC D4)
 *         2. 译文过 `normalizeZh` (tw→cn) 归一化, 与英语侧同一口径
 *
 * ⚠️ 出处诚实性: 本仓库**没有**德语词表的生成脚本, 也没有任何记录说明这 645 条例句来自哪里
 *    (`docs/vault/v1.6.0-S1-WORDLIST-DATA-REPORT.md` 只声明英语词表"未产出 example")。
 *    因此这里**不伪造** tatoeba id, 记 `unknown:de-a1`:
 *      - `<source>` = `unknown`  → 来源不可考
 *      - `<id>`     = `de-a1`    → 批次标识, 不是伪造的上游 id
 *    写成 `unknown:de-a1` 而不是裸 `unknown`, 是为了保住"exampleSource 恒为 `<source>:<id>`"
 *    这条数据契约 (verify-wordlists R5 的格式要求)。裸 `legacy` / `unknown` 会被 R5 拒。
 *
 * 用法:
 *   node scripts/activate-de-a1-examples.mjs            # dry-run: 只打印将要做的改动
 *   node scripts/activate-de-a1-examples.mjs --write    # 原地改写 src/data/wordlists/de/a1.json
 *
 * 改写策略: **逐行改写**, 只动含 `"lemma"` 的行, 保留文件既有的每行一条目风格与分组空行
 *   (该文件与 en/*.json 的 pretty-print 风格不同, 整体重排会产生无意义的全文件 diff)。
 */
import fs from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeZh } from './generate-en-examples.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = join(projectRoot, 'src', 'data', 'wordlists', 'de', 'a1.json');
const SOURCE_TAG = 'unknown:de-a1';

const WRITE = process.argv.includes('--write');

/** 逐行改写: 仅处理 "缩进 + JSON 对象 + 可选逗号" 的行, 其余原样保留 */
export function rewriteLines(text, mutate) {
  let touched = 0;
  const out = text.split('\n').map((line) => {
    const m = /^(\s*)(\{.*\})(,?)\s*$/.exec(line);
    if (!m) return line;
    let obj;
    try {
      obj = JSON.parse(m[2]);
    } catch {
      return line; // 不是合法 JSON 单行对象 → 不动
    }
    if (typeof obj.lemma !== 'string') return line;
    const changed = mutate(obj);
    if (!changed) return line;
    touched++;
    return m[1] + JSON.stringify(obj) + m[3];
  });
  return { text: out.join('\n'), touched };
}

/**
 * 单条改写规则: 补 exampleSource + 译文归一化。
 * @returns {boolean} 是否有改动
 */
export function activateEntry(w, stats) {
  let changed = false;
  if (typeof w.example === 'string' && w.example.trim() !== '') {
    if (w.exampleSource === undefined) { w.exampleSource = SOURCE_TAG; changed = true; }
    if (typeof w.exampleTranslation === 'string') {
      const fixed = normalizeZh(w.exampleTranslation);
      if (fixed !== w.exampleTranslation) {
        stats.zhFixed.push({ lemma: w.lemma, from: w.exampleTranslation, to: fixed });
        w.exampleTranslation = fixed;
        changed = true;
      }
    }
  } else if (w.exampleSource !== undefined) {
    // 契约要求 exampleSource 不得孤立存在 (R1b) —— 顺手清掉
    delete w.exampleSource;
    changed = true;
  }
  return changed;
}

function main() {
  const src = fs.readFileSync(TARGET, 'utf8');
  const stats = { zhFixed: [], addedSource: 0, noExample: 0, noTranslation: 0 };
  let total = 0;

  const { text, touched } = rewriteLines(src, (w) => {
    total++;
    if (typeof w.example !== 'string' || w.example.trim() === '') { stats.noExample++; return false; }
    if (typeof w.exampleTranslation !== 'string' || w.exampleTranslation.trim() === '') stats.noTranslation++;
    if (w.exampleSource === undefined) stats.addedSource++;
    return activateEntry(w, stats);
  });

  console.log(`目标: ${TARGET}`);
  console.log(`词条 ${total}  有 example ${total - stats.noExample}  无 example ${stats.noExample}`);
  console.log(`补 exampleSource (${SOURCE_TAG}): ${stats.addedSource}`);
  console.log(`译文经 normalizeZh 需修正: ${stats.zhFixed.length}`);
  for (const x of stats.zhFixed) console.log(`    ${x.lemma}: ${x.from} → ${x.to}`);
  console.log(`有 example 但无 exampleTranslation (R1 隐患): ${stats.noTranslation}`);
  console.log(`改写行数: ${touched}`);

  if (WRITE) {
    fs.writeFileSync(TARGET, text, 'utf8');
    console.log(`\nwritten ${TARGET} (${(fs.statSync(TARGET).size / 1024).toFixed(1)} KB)`);
  } else {
    console.log('\n[dry-run] 未写文件 (加 --write 应用改动)');
  }
}

const invokedDirectly =
  typeof process.argv[1] === 'string' && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main();
}
