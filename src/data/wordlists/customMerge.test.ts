/**
 * v1.6.5 S1 — mergeCustomEntries 纯函数单测 (SPEC §5 判据 1)
 *
 * 钉住的是「自定义词库并入官方等级词表」的全部边界: 等级过滤 / 官方优先去重 /
 * 批内去重 / C1 无官方词表 / 上限截断 / 脏 cefr 容错 / 空输入幂等。
 * 幂等性尤其重要: loadWordlist 会按 key 缓存合并结果, 同一输入必须永远得到同一输出。
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_CUSTOM_PER_LEVEL,
  mergeCustomEntries,
} from './customMerge';
import type { CsvWordlistEntry } from './csvLoader';
import type { Wordlist, WordlistEntry } from './index';
import type { DifficultyLevel } from '../../types';

function baseWordlist(lemmas: string[]): Wordlist {
  const words: WordlistEntry[] = lemmas.map((lemma) => ({
    lemma,
    pos: 'noun',
    translation: `译-${lemma}`,
    cefr: 'A1',
  }));
  return {
    language: 'en',
    level: 'A1',
    difficulty: 1 as DifficultyLevel,
    version: '1.0.0',
    total: words.length,
    words,
  };
}

function custom(
  lemma: string,
  cefr: string = 'A1',
  extra: Partial<CsvWordlistEntry> = {}
): CsvWordlistEntry {
  return {
    lemma,
    pos: 'noun',
    translation: `自定义-${lemma}`,
    cefr: cefr as CsvWordlistEntry['cefr'],
    ...extra,
  };
}

describe('v1.6.5 S1 mergeCustomEntries', () => {
  it('无自定义词条时原样返回官方词表 (同一引用, 幂等)', () => {
    const base = baseWordlist(['apple', 'baum']);
    const r = mergeCustomEntries(base, 'en', 1 as DifficultyLevel, []);
    expect(r.wordlist).toBe(base);
    expect(r.merged).toBe(0);
    expect(r.truncated).toBe(0);
  });

  it('并入后重算 total、标注 source=custom、官方词条不带 source', () => {
    const base = baseWordlist(['apple']);
    const r = mergeCustomEntries(base, 'en', 1 as DifficultyLevel, [
      custom('szó'),
    ]);
    const words = r.wordlist?.words ?? [];
    expect(r.merged).toBe(1);
    expect(words).toHaveLength(2);
    expect(r.wordlist?.total).toBe(2);
    expect(words[0].source).toBeUndefined();
    expect(words[1].source).toBe('custom');
    expect(words[1].lemma).toBe('szó');
  });

  it('只并入映射到目标 difficulty 的词条 (A2 词不进 A1 等级)', () => {
    const base = baseWordlist(['apple']);
    const r = mergeCustomEntries(base, 'en', 1 as DifficultyLevel, [
      custom('one', 'A1'),
      custom('two', 'A2'),
      custom('three', 'B2'),
    ]);
    expect(r.merged).toBe(1);
    expect(r.wordlist?.words.map((w) => w.lemma)).toEqual(['apple', 'one']);
  });

  it('官方词条优先: 同名 (忽略大小写与首尾空格) 的自定义条目被丢弃', () => {
    const base = baseWordlist(['Apple']);
    const r = mergeCustomEntries(base, 'en', 1 as DifficultyLevel, [
      custom('  apple '),
      custom('APPLE'),
      custom('genuine'),
    ]);
    expect(r.merged).toBe(1);
    expect(r.wordlist?.words.filter((w) => w.source === 'custom')).toHaveLength(1);
  });

  it('批内自身去重并保留首次出现顺序', () => {
    const base = baseWordlist([]);
    const r = mergeCustomEntries(base, 'en', 1 as DifficultyLevel, [
      custom('alpha'),
      custom('beta'),
      custom('ALPHA'),
    ]);
    expect(r.merged).toBe(2);
    expect(r.wordlist?.words.map((w) => w.lemma)).toEqual(['alpha', 'beta']);
  });

  it('官方词表为 null (C1 档) 时自定义词条可单独成表', () => {
    const r = mergeCustomEntries(null, 'de', 5 as DifficultyLevel, [
      custom('Haus', 'C1'),
    ]);
    expect(r.wordlist).not.toBeNull();
    expect(r.wordlist?.language).toBe('de');
    expect(r.wordlist?.difficulty).toBe(5);
    expect(r.wordlist?.version).toBe('custom-only');
    expect(r.merged).toBe(1);
  });

  it('C1 档官方词表为 null 且无匹配等级条目时仍返回 null', () => {
    const r = mergeCustomEntries(null, 'de', 5 as DifficultyLevel, [
      custom('Haus', 'A1'),
    ]);
    expect(r.wordlist).toBeNull();
    expect(r.merged).toBe(0);
  });

  it('超过 MAX_CUSTOM_PER_LEVEL 截断并报告被截条数', () => {
    const many = Array.from({ length: MAX_CUSTOM_PER_LEVEL + 5 }, (_, i) =>
      custom(`w${i}`)
    );
    const r = mergeCustomEntries(null, 'en', 1 as DifficultyLevel, many);
    expect(r.merged).toBe(MAX_CUSTOM_PER_LEVEL);
    expect(r.truncated).toBe(5);
    expect(r.wordlist?.total).toBe(MAX_CUSTOM_PER_LEVEL);
  });

  it('cefr 缺失或不可识别时跳过并计数, 不抛错 (CSV 是用户输入)', () => {
    const noCefr = { ...custom('n/a'), cefr: undefined } as unknown as CsvWordlistEntry;
    const r = mergeCustomEntries(baseWordlist(['apple']), 'en', 1 as DifficultyLevel, [
      custom('ok1', 'a1'),
      custom('bad', 'C2'),
      custom('empty', ''),
      noCefr,
    ]);
    expect(r.merged).toBe(1);
    expect(r.skippedUnknownCefr).toBe(3);
  });

  it('空 lemma / 纯空格 lemma 被跳过', () => {
    const r = mergeCustomEntries(baseWordlist(['apple']), 'en', 1 as DifficultyLevel, [
      custom(''),
      custom('   '),
      custom('real'),
    ]);
    expect(r.merged).toBe(1);
    expect(r.wordlist?.words.some((w) => w.lemma.trim() === '')).toBe(false);
  });

  it('priority / topic / semanticConflicts 透传, 缺失时不写 undefined 键', () => {
    const r = mergeCustomEntries(null, 'en', 1 as DifficultyLevel, [
      custom('rich', 'A1', { priority: 1, topic: 'food', semanticConflicts: ['apple'] }),
      custom('bare'),
    ]);
    const [rich, bare] = r.wordlist?.words ?? [];
    expect(rich.priority).toBe(1);
    expect(rich.topic).toBe('food');
    expect(rich.semanticConflicts).toEqual(['apple']);
    expect(Object.prototype.hasOwnProperty.call(bare, 'priority')).toBe(false);
  });
});
