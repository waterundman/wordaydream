/**
 * v1.6.5 S1 集成测试 — 自定义词库经 loadWordlist 真正进入学习 (SPEC §5 判据 2/3)
 *
 * 这条链正是 v1.6.4 探测判定的死功能: 词库能导入、能列出, 但 `custom:csv` loader 的键
 * 永远不可能被 `${language}:${difficulty}` 命中, 所以阅读生成与复习队列看不到这些词。
 * 本文件用 fake-indexeddb 跑真实读写路径, 锁三件事:
 * 1. 启用后词条出现在对应 language+CEFR 等级的词表里, 且带 source='custom';
 * 2. 关掉开关并清缓存后, 词条不再出现 (不脏读);
 * 3. 语言归属正确 —— 德语词库不会污染英语词表。
 */

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearWordlistCache, loadWordlist } from './index';
import {
  saveCsvWordlist,
  setCsvWordlistEnabled,
  deleteCsvWordlist,
  listCsvWordlists,
} from './csvStorage';
import type { CsvImportResult, CsvWordlistEntry } from './csvLoader';

function importResult(
  fileName: string,
  entries: CsvWordlistEntry[],
  importedAt: number
): CsvImportResult {
  return {
    success: true,
    entries,
    errors: [],
    fileName,
    importedAt,
  };
}

function entry(lemma: string, cefr: CsvWordlistEntry['cefr']): CsvWordlistEntry {
  return { lemma, pos: 'noun', translation: `译-${lemma}`, cefr };
}

/**
 * fake-indexeddb 的 DB 在整个文件内共享, 且 listCsvWordlists 按 importedAt 排序 ——
 * 每个用例必须自己清场并用不同 importedAt, 否则 [0] 会取到上一条用例留下的词库。
 */
async function wipeAllWordlists(): Promise<void> {
  const all = await listCsvWordlists();
  await Promise.all(all.map((w) => deleteCsvWordlist(w.id)));
}

describe('v1.6.5 S1 自定义词库并入等级词表', () => {
  beforeEach(async () => {
    clearWordlistCache();
    await wipeAllWordlists();
    clearWordlistCache();
  });

  it('启用词库后, 词条进入对应语言+等级词表并标注 source=custom', async () => {
    await saveCsvWordlist(
      importResult('my-a2-words.csv', [entry('szó', 'A2'), entry('használ', 'A2')], 1),
      'en'
    );
    clearWordlistCache();

    const a2 = await loadWordlist('en', 2);
    const custom = (a2?.words ?? []).filter((w) => w.source === 'custom');
    expect(custom.map((w) => w.lemma).sort()).toEqual(['használ', 'szó']);
    expect(a2?.total).toBe((a2?.words ?? []).length);

    // 别的等级不应看到它
    const a1 = await loadWordlist('en', 1);
    expect((a1?.words ?? []).some((w) => w.lemma === 'szó')).toBe(false);
  });

  it('关掉启用开关并清缓存后词条消失; 重新开启又回来', async () => {
    await saveCsvWordlist(importResult('toggle.csv', [entry('kukac', 'A1')], 2), 'de');
    clearWordlistCache();

    const before = await loadWordlist('de', 1);
    expect((before?.words ?? []).some((w) => w.lemma === 'kukac')).toBe(true);

    const [wl] = await listCsvWordlists();
    await setCsvWordlistEnabled(wl.id, false);
    clearWordlistCache();

    const off = await loadWordlist('de', 1);
    expect((off?.words ?? []).some((w) => w.lemma === 'kukac')).toBe(false);

    await setCsvWordlistEnabled(wl.id, true);
    clearWordlistCache();
    const on = await loadWordlist('de', 1);
    expect((on?.words ?? []).some((w) => w.lemma === 'kukac')).toBe(true);
  });

  it('语言归属: 德语词库不污染英语词表', async () => {
    // 用一个必然不在官方词表里的合成词形 —— 'Apfel' 本身在 de/A1 里, 会触上去重分支。
    await saveCsvWordlist(
      importResult('de-only.csv', [entry('zquxabfel', 'A1')], 3),
      'de'
    );
    clearWordlistCache();

    const en = await loadWordlist('en', 1);
    expect((en?.words ?? []).some((w) => w.lemma === 'zquxabfel')).toBe(false);
    const de = await loadWordlist('de', 1);
    expect((de?.words ?? []).some((w) => w.lemma === 'zquxabfel')).toBe(true);
  });

  it('删除词库后对应词条从词表消失', async () => {
    await saveCsvWordlist(importResult('todelete.csv', [entry('loose', 'B1')], 4), 'en');
    clearWordlistCache();
    const all = await listCsvWordlists();
    const target = all.find((w) => w.fileName === 'todelete.csv');
    expect(target).toBeDefined();

    await deleteCsvWordlist((target as { id: string }).id);
    clearWordlistCache();

    const b1 = await loadWordlist('en', 3);
    expect((b1?.words ?? []).some((w) => w.lemma === 'loose')).toBe(false);
  });

  it('与官方词表重名的自定义条目被丢弃 (避免同一 lemma 双进度语义)', async () => {
    const official = await loadWordlist('en', 1);
    const firstOfficial = official?.words[0]?.lemma as string;
    expect(firstOfficial).toBeTruthy();

    await saveCsvWordlist(
      importResult('dup.csv', [entry(firstOfficial.toUpperCase(), 'A1')], 5),
      'en'
    );
    clearWordlistCache();

    const merged = await loadWordlist('en', 1);
    const hits = (merged?.words ?? []).filter(
      (w) => w.lemma.toLowerCase() === firstOfficial.toLowerCase()
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].source).toBeUndefined();
  });
});
