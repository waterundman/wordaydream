/**
 * wrongWordsImport 测试 (v1.4.0 S1)
 *
 * 覆盖 SPEC v1.4.0 合同 C1.1-C1.5 (解析/校验) + C1.6 部分 (mergeEntries 纯函数):
 * - CSV roundtrip: buildCsv (v1.1.0 导出生产函数) → parseWrongWordsCsv → 逐一相等,
 *   含 RFC 4180 转义字段 (lemma 含逗号+双引号) [C1.1]
 * - JSON roundtrip: 导出 payload 结构 → parseWrongWordsJson → 相等 [C1.2]
 * - 非法行 rejected 不入账, 消息 "行 N: ..." [C1.3]
 * - 非本产品 JSON 整文件 rejected [C1.4]; CSV 表头缺列整文件 rejected [C1.5]
 * - mergeEntries: 追加 / skip 保留现有 / incoming 内部去重 / 超容量一次 FIFO 淘汰
 */
import { describe, expect, it } from 'vitest';
import type { WrongWordEntry } from './useWrongWordsStore';
import {
  parseWrongWordsCsv,
  parseWrongWordsJson,
  mergeEntries,
} from './wrongWordsImport';
import { buildCsv, CSV_HEADER } from '../../settings/wrongWordsCsvFormat';

const T0 = 1_726_000_000_000; // 2024-09-10T12:00:00.000Z 附近

function makeEntry(overrides: Partial<WrongWordEntry> = {}): WrongWordEntry {
  return {
    cardId: 'card-1',
    lexemeGroupId: 'lg-1',
    lemma: 'artisans',
    language: 'en',
    wrongCount: 2,
    firstWrongAt: T0,
    lastWrongAt: T0 + 86_400_000,
    ...overrides,
  };
}

/** 单行 CSV (调用方负责转义) */
function csvRow(fields: string[]): string {
  return fields.join(',');
}

describe('parseWrongWordsCsv', () => {
  it('T01 [C1.1] roundtrip: buildCsv 导出 → 解析 → 逐一相等 (含 RFC 4180 引号字段)', async () => {
    // buildCsv 按 recent (lastWrongAt 倒序) 排序, fixtures 直接按此顺序构造
    const entries: WrongWordEntry[] = [
      // lemma 含逗号+双引号触发 RFC 4180 转义
      makeEntry({
        cardId: 'c1',
        lexemeGroupId: 'lg1',
        lemma: 'he said "hi", ok',
        lastWrongAt: T0 + 2 * 86_400_000,
        firstWrongAt: T0 + 86_400_000,
      }),
      makeEntry({ cardId: 'c2', lexemeGroupId: 'lg2', lastWrongAt: T0 + 86_400_000 }),
      makeEntry({ cardId: 'c3', lexemeGroupId: 'lg3', language: undefined, lastWrongAt: T0 }),
    ];
    const csv = buildCsv(entries);
    expect(csv.split('\n')[0]).toBe(CSV_HEADER);

    const result = await parseWrongWordsCsv(csv, 'export.csv');
    expect(result.fileName).toBe('export.csv');
    expect(result.rejected).toEqual([]);
    expect(result.valid).toEqual(entries);
  });

  it('T02 [C1.3] 非法行 rejected 不入账: 空 lemma / wrongCount 0 / 坏时间 / 非法 language', async () => {
    const iso = '2024-09-10T12:00:00.000Z';
    const csv = [
      CSV_HEADER,
      csvRow(['c1', 'lg1', 'alpha', 'en', '1', iso, iso]),
      csvRow(['c2', 'lg2', '', 'en', '1', iso, iso]), // 空 lemma
      csvRow(['c3', 'lg3', 'beta', 'en', '0', iso, iso]), // wrongCount 0
      csvRow(['c4', 'lg4', 'gamma', 'en', '1', 'not-a-date', iso]), // 坏 firstWrongAt
      csvRow(['c5', 'lg5', 'delta', 'fr', '1', iso, iso]), // language 非法
    ].join('\n');

    const result = await parseWrongWordsCsv(csv);
    expect(result.valid).toHaveLength(1);
    expect(result.valid[0]).toMatchObject({ cardId: 'c1', lemma: 'alpha' });
    expect(result.rejected).toHaveLength(4);
    expect(result.rejected.map((r) => r.row)).toEqual([2, 3, 4, 5]);
    expect(result.rejected[0].message).toBe('行 2: lemma 不能为空');
    expect(result.rejected[1].message).toBe('行 3: wrongCount 必须为正整数');
    expect(result.rejected[2].message).toContain('行 4: firstWrongAt');
    expect(result.rejected[3].message).toContain('行 5: language');
  });

  it('T03 [C1.5] 表头缺必需列 → 整文件 rejected (row 0)', async () => {
    const csv = 'cardId,lemma\n' + csvRow(['c1', 'alpha']);
    const result = await parseWrongWordsCsv(csv);
    expect(result.valid).toEqual([]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].row).toBe(0);
    expect(result.rejected[0].message).toContain('表头缺少必需列');
    expect(result.rejected[0].message).toContain('lexemeGroupId');
  });

  it('T04 空字符串 CSV → 整文件 rejected', async () => {
    const result = await parseWrongWordsCsv('');
    expect(result.valid).toEqual([]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].row).toBe(0);
  });

  it('T05 language 空串 → undefined (旧数据口径)', async () => {
    const iso = '2024-09-10T12:00:00.000Z';
    const csv = [CSV_HEADER, csvRow(['c1', 'lg1', 'alpha', '', '1', iso, iso])].join('\n');
    const result = await parseWrongWordsCsv(csv);
    expect(result.valid).toHaveLength(1);
    expect(result.valid[0].language).toBeUndefined();
  });

  it('T06 wrongCount 非整数 ("2.5") → rejected', async () => {
    const iso = '2024-09-10T12:00:00.000Z';
    const csv = [CSV_HEADER, csvRow(['c1', 'lg1', 'alpha', 'en', '2.5', iso, iso])].join('\n');
    const result = await parseWrongWordsCsv(csv);
    expect(result.valid).toEqual([]);
    expect(result.rejected[0].message).toContain('行 1: wrongCount');
  });
});

describe('parseWrongWordsJson', () => {
  it('T07 [C1.2] roundtrip: 导出 payload → 解析 → 逐一相等', () => {
    const entries: WrongWordEntry[] = [
      makeEntry(),
      makeEntry({ cardId: 'c2', lexemeGroupId: 'lg2', language: 'de', lemma: 'Haus' }),
      makeEntry({ cardId: 'c3', lexemeGroupId: 'lg3', language: undefined }),
    ];
    const payload = {
      schema: 'wordaydream-wrong-words',
      version: 1,
      exportedAt: '2026-09-13T00:00:00.000Z',
      entries,
    };
    const result = parseWrongWordsJson(JSON.stringify(payload), 'export.json');
    expect(result.fileName).toBe('export.json');
    expect(result.rejected).toEqual([]);
    expect(result.valid).toEqual(entries);
  });

  it('T08 [C1.4] 非本产品 JSON (schema 不符) → 整文件 rejected', () => {
    const result = parseWrongWordsJson(JSON.stringify({ schema: 'other', version: 1, entries: [] }));
    expect(result.valid).toEqual([]);
    expect(result.rejected[0].row).toBe(0);
    expect(result.rejected[0].message).toContain('schema 不符');
  });

  it('T09 [C1.4] version 不符 → 整文件 rejected', () => {
    const result = parseWrongWordsJson(
      JSON.stringify({ schema: 'wordaydream-wrong-words', version: 2, entries: [] }),
    );
    expect(result.rejected[0].message).toContain('version 不符');
  });

  it('T10 [C1.4] 非法 JSON 文本 → 整文件 rejected', () => {
    const result = parseWrongWordsJson('{not json');
    expect(result.valid).toEqual([]);
    expect(result.rejected[0].message).toContain('合法 JSON');
  });

  it('T11 entries 混合合法/非法 → 拆分 valid/rejected', () => {
    const entries = [
      { cardId: 'c1', lexemeGroupId: 'lg1', lemma: 'alpha', language: 'en', wrongCount: 1, firstWrongAt: T0, lastWrongAt: T0 },
      { cardId: '', lexemeGroupId: 'lg2', lemma: 'beta', wrongCount: 1, firstWrongAt: T0, lastWrongAt: T0 },
      { cardId: 'c3', lexemeGroupId: 'lg3', lemma: 'gamma', wrongCount: 1, firstWrongAt: T0, lastWrongAt: 'oops' },
    ];
    const result = parseWrongWordsJson(
      JSON.stringify({ schema: 'wordaydream-wrong-words', version: 1, entries }),
    );
    expect(result.valid).toHaveLength(1);
    expect(result.valid[0].cardId).toBe('c1');
    expect(result.rejected.map((r) => r.row)).toEqual([2, 3]);
  });

  it('T12 entries 缺失 → 整文件 rejected', () => {
    const result = parseWrongWordsJson(
      JSON.stringify({ schema: 'wordaydream-wrong-words', version: 1 }),
    );
    expect(result.rejected[0].message).toContain('entries');
  });
});

describe('mergeEntries', () => {
  it('T13 [C1.6] 新 cardId 追加, imported/skipped 计数正确', () => {
    const existing = [makeEntry()];
    const incoming = [makeEntry({ cardId: 'c2' })];
    const { merged, imported, skipped, evicted } = mergeEntries(existing, incoming);
    expect(merged).toHaveLength(2);
    expect(imported).toBe(1);
    expect(skipped).toBe(0);
    expect(evicted).toBe(0);
  });

  it('T14 [C1.6] cardId 冲突 → skip 保留现有 (wrongCount 不变)', () => {
    const existing = [makeEntry({ wrongCount: 5 })];
    const incoming = [makeEntry({ wrongCount: 99 })];
    const { merged, imported, skipped } = mergeEntries(existing, incoming);
    expect(merged).toHaveLength(1);
    expect(merged[0].wrongCount).toBe(5);
    expect(imported).toBe(0);
    expect(skipped).toBe(1);
  });

  it('T15 [C1.6] incoming 内部重复 cardId → 首条计入, 其余 skip', () => {
    const incoming = [makeEntry({ cardId: 'c1' }), makeEntry({ cardId: 'c1', wrongCount: 9 })];
    const { merged, imported, skipped } = mergeEntries([], incoming);
    expect(merged).toHaveLength(1);
    expect(imported).toBe(1);
    expect(skipped).toBe(1);
  });

  it('T16 [C1.6] 超容量 → 按 lastWrongAt 降序一次淘汰到位, evicted 含既有条目', () => {
    const existing = [
      makeEntry({ cardId: 'e1', lastWrongAt: 100, firstWrongAt: 90 }),
      makeEntry({ cardId: 'e2', lastWrongAt: 200, firstWrongAt: 190 }),
    ];
    const incoming = [
      makeEntry({ cardId: 'n1', lastWrongAt: 300, firstWrongAt: 290 }),
      makeEntry({ cardId: 'n2', lastWrongAt: 50, firstWrongAt: 40 }), // 比所有都旧 → 淘汰
    ];
    const { merged, imported, skipped, evicted } = mergeEntries(existing, incoming, 3);
    expect(merged.map((e) => e.cardId)).toEqual(['n1', 'e2', 'e1']);
    expect(imported).toBe(1); // n1 存活, n2 被淘汰不计入
    expect(skipped).toBe(0);
    expect(evicted).toBe(1);
  });

  it('T17 空数组 noop: imported=0, entries 内容不变', () => {
    const existing = [makeEntry()];
    const { merged, imported, skipped, evicted } = mergeEntries(existing, []);
    expect(merged).toEqual(existing);
    expect(imported).toBe(0);
    expect(skipped).toBe(0);
    expect(evicted).toBe(0);
  });
});
