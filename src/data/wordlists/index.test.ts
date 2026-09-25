/**
 * 词表加载入口 × 例句字段契约测试 — v1.6.2 Stage 3
 *
 * 覆盖 SPEC §6.1 的 2 项（本文件 3 项）：
 *   T01 新字段**全可选** → 旧词表条目 / CSV 自定义词表继续满足 `WordlistEntry`
 *   T02 例句三字段的类型为 string
 *   T03 真实数据抽查：`en/a1.json` 的例句字段满足 R1（example 与 exampleTranslation 同生同灭）
 *
 * T01/T02 是**类型层**断言：`tsc --noEmit` 会编译本文件，故类型不成立时 CI 直接红。
 * 这比运行时断言更强 —— 契约是类型，就该在类型层被检查。
 */
import { describe, expect, it } from 'vitest';
import { clearWordlistCache, loadWordlist, type WordlistEntry } from './index';

describe('WordlistEntry 例句字段契约 (v1.6.2)', () => {
  it('T01: 旧词表条目（完全不带例句字段）仍满足 WordlistEntry', () => {
    // 编译期断言: 少了 example/exampleTranslation/exampleSource 也必须能赋值
    const legacy: WordlistEntry = { lemma: 'have', pos: 'verb', translation: '有', cefr: 'A2' };
    expect(legacy.lemma).toBe('have');
    expect(legacy.example).toBeUndefined();
    expect(legacy.exampleTranslation).toBeUndefined();
    expect(legacy.exampleSource).toBeUndefined();

    // 带 v2 字段但不带例句, 同样成立
    const v2Legacy: WordlistEntry = {
      lemma: 'hope',
      pos: 'verb',
      translation: '希望',
      cefr: 'A1',
      priority: 1,
      topic: 'emotion',
      frequency: 2,
      semanticConflicts: [],
    };
    expect(v2Legacy.priority).toBe(1);
  });

  it('T02: 例句三字段的类型为 string，可同时给出', () => {
    const full: WordlistEntry = {
      lemma: 'hope',
      pos: 'verb',
      translation: '希望',
      cefr: 'A1',
      example: 'I hope so.',
      exampleTranslation: '我希望如此。',
      exampleSource: 'tatoeba:42',
    };
    expect(typeof full.example).toBe('string');
    expect(typeof full.exampleTranslation).toBe('string');
    expect(typeof full.exampleSource).toBe('string');
    expect(full.exampleSource).toMatch(/^[a-z][a-z0-9-]*:.+$/i);
  });

  it('T03: 真实词表 en/a1 的例句字段满足 R1（同生同灭）', async () => {
    clearWordlistCache();
    const wl = await loadWordlist('en', 1);
    expect(wl).not.toBe(null);
    expect(wl!.words.length).toBe(wl!.total);
    const withExample = wl!.words.filter((w) => w.example !== undefined);
    expect(withExample.length).toBeGreaterThan(0);
    for (const w of wl!.words) {
      const has = w.example !== undefined;
      expect(has).toBe(w.exampleTranslation !== undefined);
      expect(has).toBe(w.exampleSource !== undefined);
    }
    clearWordlistCache();
  });
});
