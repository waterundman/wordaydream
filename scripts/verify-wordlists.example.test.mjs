/**
 * 词表例句字段契约 (R1–R5) 单测 — v1.6.2 Stage 1
 *
 * 覆盖 SPEC §6.1 声明的 5 项 (本文件为**超集**, 8 项): 半截数据 / 空串 / lemma 不命中 /
 * **不规则变形不得误报(反向用例)** / 译文无中文 / 非法 source。
 *
 * 两项刻意的设计：
 *  1. 每个用例**注入自己的收集器**, 不读模块级 `errors` —— 否则用例间互相污染。
 *  2. 文件顶部的 `import` 本身就是一条断言：若 `verify-wordlists.mjs` 没有 `invokedDirectly`
 *     守卫，import 时就会跑 main() 并 `process.exit(0)`，vitest worker 会直接挂掉。
 */
import { describe, expect, it } from 'vitest';
import { validateWordlist } from './verify-wordlists.mjs';

/** 用给定词条构造一份最小合法词表，返回全部 error 消息 */
function runErrors(entry) {
  const errors = [];
  validateWordlist(
    'de',
    { key: 'a1', level: 'A1', difficulty: 1 },
    {
      language: 'de',
      level: 'A1',
      difficulty: 1,
      version: '2.0.0',
      total: 1,
      words: [{ lemma: 'machen', pos: 'verb', translation: '做', cefr: 'A1', ...entry }],
    },
    { fail: (m) => errors.push(m), warn: () => {} }
  );
  return errors;
}

describe('词表例句字段契约 R1–R5 (v1.6.2)', () => {
  it('T01 [R1/R1b]: example 有而 exampleTranslation 无 → 半截数据', () => {
    const errs = runErrors({ example: 'Was machst du?' });
    expect(errs.some((e) => e.includes('必须同时存在或同时缺失'))).toBe(true);
  });

  it('T02 [R1b]: exampleSource 孤立存在 (无 example) → 报错', () => {
    const errs = runErrors({ exampleSource: 'tatoeba:1' });
    expect(errs.some((e) => e.includes('exampleSource 存在但 example 缺失'))).toBe(true);
  });

  it('T03 [R2]: example 为空串 / 全空白 → 报错', () => {
    const a = runErrors({ example: '', exampleTranslation: '做' });
    const b = runErrors({ example: '   ', exampleTranslation: '做' });
    expect(a.some((e) => e.includes('example 存在但为空'))).toBe(true);
    expect(b.some((e) => e.includes('example 存在但为空'))).toBe(true);
  });

  it('T04 [R3]: example 不含 lemma 任何词形 → 报错 (抓接错词)', () => {
    const errs = runErrors({
      example: 'Das Buch ist alt.',
      exampleTranslation: '这本书很旧。',
    });
    expect(errs.some((e) => e.includes('不含 lemma "machen"'))).toBe(true);
  });

  it('T05 [R3 反向]: 不规则/分离/复合变形**不得**误报', () => {
    // 每一条都是 de/a1 真实数据里踩过的形态，R3 转红即回归
    const cases = [
      { lemma: 'sein', example: 'Ich bin Student.' },
      { lemma: 'nehmen', example: 'Nimm den Stuhl.' },
      { lemma: 'laufen', example: 'Das Kind läuft schnell.' },
      { lemma: 'tragen', example: 'Sie trägt ein rotes Kleid.' },
      { lemma: 'können', example: 'Ich kann Deutsch.' },
      { lemma: 'mögen', example: 'Ich mag Kaffee.' },
      { lemma: 'wissen', example: 'Ich weiß die Antwort.' },
      { lemma: 'anfangen', example: 'Fangen wir an!' },
      { lemma: 'aufräumen', example: 'Ich räume mein Zimmer auf.' },
      { lemma: 'Saft', example: 'Ich trinke Apfelsaft.' },
      { lemma: 'E-Mail', example: 'Ich schreibe eine E-Mail.' },
      { lemma: 'zu', example: 'Ich gehe zum Bahnhof.' },
      { lemma: 'ja', example: 'Ja, ich verstehe das.' },
      { lemma: 'Gruß', example: 'Viele Grüße von meiner Familie.' },
      { lemma: 'drei', example: 'Wir sind zu dritt.' },
    ];
    const failed = [];
    for (const c of cases) {
      const errs = runErrors({ ...c, exampleTranslation: '译文。' });
      if (errs.some((e) => e.includes('不含 lemma'))) failed.push(c.lemma);
    }
    expect(failed, `以下 lemma 被 R3 误报: ${failed.join(', ')}`).toEqual([]);
  });

  it('T06 [R4]: exampleTranslation 不含中文 → 报错', () => {
    const errs = runErrors({
      example: 'Was machst du?',
      exampleTranslation: 'What are you doing?',
    });
    expect(errs.some((e) => e.includes('不含中文字符'))).toBe(true);
  });

  it('T07 [R5]: exampleSource 格式非法 → 报错', () => {
    const bad = ['tatoeba', '123', '', 'tatoeba:', ':1'];
    for (const s of bad) {
      const errs = runErrors({
        example: 'Was machst du?',
        exampleTranslation: '你在做什么？',
        exampleSource: s,
      });
      expect(errs.some((e) => e.includes('exampleSource 格式非法')), `source=${JSON.stringify(s)} 应被拒`).toBe(true);
    }
  });

  it('T08 [基线]: 合法例句字段不得产生任何 error', () => {
    const errs = runErrors({
      example: 'Was machst du?',
      exampleTranslation: '你在做什么？',
      exampleSource: 'tatoeba:413789',
    });
    expect(errs).toEqual([]);
  });
});
